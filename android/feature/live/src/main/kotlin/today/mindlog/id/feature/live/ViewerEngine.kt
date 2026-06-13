package today.mindlog.id.feature.live

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpTransceiver
import org.webrtc.SessionDescription
import org.webrtc.VideoTrack
import today.mindlog.id.core.data.LiveRepository
import today.mindlog.id.core.data.di.AppScope
import today.mindlog.id.core.network.dto.LiveJoinDto
import today.mindlog.id.core.network.dto.LiveSignalEventDto
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Moteur WebRTC du viewer — un seul PeerConnection (recv-only) vers le
 * broadcaster. Émet l'offre, accepte l'answer, échange les ICE candidates.
 *
 * Limite : ne fonctionne qu'avec un broadcaster Android (qui utilise les
 * media tracks standards). Les broadcasters Web mesh-E2E doivent passer par
 * `/live/{id}` dans le navigateur.
 */
@Singleton
class ViewerEngine @Inject constructor(
    @ApplicationContext private val context: Context,
    private val live: LiveRepository,
    @AppScope private val scope: CoroutineScope,
) {
    private val json = Json { ignoreUnknownKeys = true }

    private val defaultIceServers = listOf(
        PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
        PeerConnection.IceServer.builder("stun:stun1.l.google.com:19302").createIceServer(),
    )

    private val eglBase: EglBase by lazy { EglBase.create() }
    fun eglContext(): EglBase.Context = eglBase.eglBaseContext

    private val factory: PeerConnectionFactory by lazy {
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context).createInitializationOptions(),
        )
        PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
            .createPeerConnectionFactory()
    }

    private var pc: PeerConnection? = null
    private var liveId: String = ""
    private var myDeviceId: String = ""
    private var hostDeviceId: String = ""
    private var signalJob: Job? = null
    private var remoteDescSet: Boolean = false
    private val pendingIce = mutableListOf<IceCandidate>()

    private val _remoteVideo = MutableStateFlow<VideoTrack?>(null)
    val remoteVideo: StateFlow<VideoTrack?> = _remoteVideo.asStateFlow()

    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected.asStateFlow()

    /**
     * Initialise le PC à partir du résultat de /api/live/:id/join. Le host est
     * trouvé dans le roster (role="broadcaster"). On utilise des STUN par défaut
     * car le serveur n'expose pas d'ICE servers.
     */
    fun start(liveId: String, myDeviceId: String, join: LiveJoinDto) {
        stop()
        this.liveId = liveId
        this.myDeviceId = myDeviceId
        this.hostDeviceId = join.roster.firstOrNull { it.role == "broadcaster" }?.deviceId.orEmpty()
        if (hostDeviceId.isBlank()) {
            android.util.Log.w("MindlogLive", "Viewer: pas de broadcaster dans le roster, peer-connection sans cible.")
            return
        }
        val ice = defaultIceServers

        val config = PeerConnection.RTCConfiguration(ice).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }
        pc = factory.createPeerConnection(config, object : PeerConnection.Observer {
            override fun onIceCandidate(candidate: IceCandidate) {
                sendSignal("ice", iceToJson(candidate))
            }
            override fun onTrack(transceiver: RtpTransceiver) {
                (transceiver.receiver.track() as? VideoTrack)?.let { vt ->
                    scope.launch { _remoteVideo.update { vt } }
                }
            }
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
                when (state) {
                    PeerConnection.IceConnectionState.CONNECTED,
                    PeerConnection.IceConnectionState.COMPLETED ->
                        scope.launch { _connected.update { true } }
                    PeerConnection.IceConnectionState.FAILED,
                    PeerConnection.IceConnectionState.DISCONNECTED,
                    PeerConnection.IceConnectionState.CLOSED ->
                        scope.launch { _connected.update { false } }
                    else -> Unit
                }
            }
            override fun onSignalingChange(p0: PeerConnection.SignalingState?) {}
            override fun onIceConnectionReceivingChange(p0: Boolean) {}
            override fun onIceGatheringChange(p0: PeerConnection.IceGatheringState?) {}
            override fun onIceCandidatesRemoved(p0: Array<out IceCandidate>?) {}
            override fun onAddStream(p0: org.webrtc.MediaStream?) {}
            override fun onRemoveStream(p0: org.webrtc.MediaStream?) {}
            override fun onDataChannel(p0: org.webrtc.DataChannel?) {}
            override fun onRenegotiationNeeded() {}
        })

        // recv-only : on déclare deux transceivers entrants (audio + vidéo).
        pc?.addTransceiver(
            org.webrtc.MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO,
            RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.RECV_ONLY),
        )
        pc?.addTransceiver(
            org.webrtc.MediaStreamTrack.MediaType.MEDIA_TYPE_AUDIO,
            RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.RECV_ONLY),
        )

        // Démarrer l'écoute SSE AVANT d'envoyer l'offre pour ne pas rater l'answer.
        signalJob = scope.launch {
            live.subscribeSignals(liveId, myDeviceId).collect { onSignal(it) }
        }

        // Créer + envoyer l'offre au broadcaster.
        pc?.createOffer(object : SimpleSdp() {
            override fun onCreateSuccess(desc: SessionDescription) {
                pc?.setLocalDescription(SimpleSdp(), desc)
                sendSignal("offer", sdpToJson(desc))
            }
        }, MediaConstraints())
    }

    private fun onSignal(packet: LiveSignalEventDto) {
        if (packet.to != myDeviceId || packet.from != hostDeviceId) return
        val payload = parsePayload(packet.payload) ?: return
        when (packet.kind) {
            "answer" -> handleAnswer(payload)
            "ice" -> handleIce(payload)
            "bye" -> stop()
        }
    }

    private fun handleAnswer(payload: JsonObject) {
        val sdp = sdpFromJson(payload) ?: return
        pc?.setRemoteDescription(object : SimpleSdp() {
            override fun onSetSuccess() {
                remoteDescSet = true
                pendingIce.forEach { runCatching { pc?.addIceCandidate(it) } }
                pendingIce.clear()
            }
        }, sdp)
    }

    private fun handleIce(payload: JsonObject) {
        val cand = iceFromJson(payload) ?: return
        if (remoteDescSet) pc?.addIceCandidate(cand) else pendingIce.add(cand)
    }

    private fun sendSignal(kind: String, payload: JsonObject) {
        val id = liveId; val me = myDeviceId; val to = hostDeviceId
        if (id.isBlank() || me.isBlank() || to.isBlank()) return
        scope.launch {
            runCatching {
                live.sendSignal(id, from = me, to = to, kind = kind, payloadJson = json.encodeToString(JsonObject.serializer(), payload))
            }
        }
    }

    fun stop() {
        signalJob?.cancel(); signalJob = null
        runCatching { pc?.close() }
        pc = null
        remoteDescSet = false
        pendingIce.clear()
        _remoteVideo.update { null }
        _connected.update { false }
        liveId = ""
        myDeviceId = ""
        hostDeviceId = ""
    }

    /* -------------------------- (dé)sérialisation ------------------------- */

    private fun parsePayload(p: String?): JsonObject? = runCatching {
        if (p.isNullOrBlank()) return@runCatching null
        json.parseToJsonElement(p).jsonObject
    }.getOrNull()
    private fun sdpToJson(desc: SessionDescription) = buildJsonObject {
        put("type", JsonPrimitive(desc.type.canonicalForm()))
        put("sdp", JsonPrimitive(desc.description))
    }
    private fun sdpFromJson(o: JsonObject): SessionDescription? = runCatching {
        SessionDescription(
            SessionDescription.Type.fromCanonicalForm(o["type"]!!.jsonPrimitive.content),
            o["sdp"]!!.jsonPrimitive.content,
        )
    }.getOrNull()
    private fun iceToJson(c: IceCandidate) = buildJsonObject {
        put("candidate", JsonPrimitive(c.sdp))
        put("sdpMid", JsonPrimitive(c.sdpMid))
        put("sdpMLineIndex", JsonPrimitive(c.sdpMLineIndex))
    }
    private fun iceFromJson(o: JsonObject): IceCandidate? = runCatching {
        IceCandidate(
            o["sdpMid"]?.jsonPrimitive?.content,
            o["sdpMLineIndex"]?.jsonPrimitive?.int ?: 0,
            o["candidate"]!!.jsonPrimitive.content,
        )
    }.getOrNull()
}
