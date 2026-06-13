package today.mindlog.id.feature.live

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
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
import org.webrtc.AudioTrack
import org.webrtc.Camera2Enumerator
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import today.mindlog.id.core.data.LiveRepository
import today.mindlog.id.core.data.di.AppScope
import today.mindlog.id.core.network.dto.LiveSignalEventDto
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Moteur WebRTC du broadcaster — capture caméra + audio + diffusion vers N
 * viewers via PeerConnection standard (un PC par viewer, attache des tracks
 * sortants). Le viewer initie l'offre ; le broadcaster répond.
 *
 * Limite connue : **incompatible avec le mesh DataChannel E2E du Web**
 * (public/live/broadcaster.js wrap Ks + chunks chiffrés). L'Android↔Android
 * fonctionne via SRTP standard ; l'Android↔Web nécessitera de répliquer la
 * couche E2E (ECDH wrap + DataChannel) dans une itération dédiée.
 *
 * Singleton car PeerConnectionFactory + EglBase sont coûteux à instancier.
 */
@Singleton
class BroadcasterEngine @Inject constructor(
    @ApplicationContext private val context: Context,
    private val live: LiveRepository,
    @AppScope private val scope: CoroutineScope,
) {
    private val json = Json { ignoreUnknownKeys = true }

    // STUN gratuits par défaut ; les ICE servers du serveur seront utilisés si fournis.
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

    private var capturer: VideoCapturer? = null
    private var surfaceHelper: SurfaceTextureHelper? = null
    private var source: VideoSource? = null
    private var videoTrack: VideoTrack? = null
    private var audioTrack: AudioTrack? = null
    private val peers = mutableMapOf<String, PeerConnection>()
    private val pendingIce = mutableMapOf<String, MutableList<IceCandidate>>()

    private var liveId: String = ""
    private var myDeviceId: String = ""
    private var iceServers: List<PeerConnection.IceServer> = defaultIceServers

    // Métriques publiées vers le ViewModel (compteur de viewers connectés).
    private val _connected = MutableStateFlow(0)
    val connectedPeers: StateFlow<Int> = _connected.asStateFlow()

    /** Active la caméra + (optionnel) audio. Retourne le track vidéo local rendu. */
    fun startCapture(
        facingFront: Boolean = true,
        withAudio: Boolean = true,
        width: Int = 1280,
        height: Int = 720,
        fps: Int = 30,
    ): VideoTrack? {
        stopCapture()
        val enumerator = Camera2Enumerator(context)
        val deviceName = enumerator.deviceNames.firstOrNull { enumerator.isFrontFacing(it) == facingFront }
            ?: enumerator.deviceNames.firstOrNull()
            ?: return null
        val cap = enumerator.createCapturer(deviceName, null) ?: return null
        val helper = SurfaceTextureHelper.create("BroadcastCapture", eglBase.eglBaseContext)
        val src = factory.createVideoSource(cap.isScreencast)
        cap.initialize(helper, context, src.capturerObserver)
        cap.startCapture(width, height, fps)
        val vt = factory.createVideoTrack("broadcast_video", src).apply { setEnabled(true) }
        capturer = cap
        surfaceHelper = helper
        source = src
        videoTrack = vt
        if (withAudio) {
            audioTrack = factory.createAudioTrack(
                "broadcast_audio",
                factory.createAudioSource(MediaConstraints()),
            ).apply { setEnabled(true) }
        }
        // Si on était déjà en train de diffuser, re-attache les nouveaux tracks aux peers en place.
        for ((_, pc) in peers) attachLocalTracks(pc)
        return vt
    }

    fun setMicEnabled(enabled: Boolean) { audioTrack?.setEnabled(enabled) }
    fun isMicEnabled(): Boolean = audioTrack?.enabled() ?: false

    fun stopCapture() {
        runCatching { capturer?.stopCapture() }
        capturer?.dispose(); capturer = null
        surfaceHelper?.dispose(); surfaceHelper = null
        source?.dispose(); source = null
        videoTrack = null
        audioTrack = null
    }

    /* -------------------------- Mesh signaling -------------------------- */

    /** Démarre l'écoute des signaux entrants pour ce live (à appeler après /api/live/start + /join). */
    fun startSignaling(liveId: String, hostDeviceId: String, ice: List<PeerConnection.IceServer> = emptyList()) {
        this.liveId = liveId
        this.myDeviceId = hostDeviceId
        this.iceServers = ice.ifEmpty { defaultIceServers }
        scope.launch {
            live.subscribeSignals(liveId, hostDeviceId).collect { onSignal(it) }
        }
    }

    private fun onSignal(packet: LiveSignalEventDto) {
        if (packet.to != myDeviceId) return // le routeur serveur filtre, mais ceinture/bretelles.
        val payload = parsePayload(packet.payload) ?: return
        when (packet.kind) {
            "offer" -> handleOffer(packet.from, payload)
            "ice" -> handleIce(packet.from, payload)
            "bye" -> closePeer(packet.from)
        }
    }

    private fun handleOffer(viewerDeviceId: String, payload: JsonObject) {
        val sdp = sdpFromJson(payload) ?: return
        val pc = ensurePeer(viewerDeviceId)
        attachLocalTracks(pc)
        pc.setRemoteDescription(object : SimpleSdp() {
            override fun onSetSuccess() {
                flushIce(viewerDeviceId, pc)
                pc.createAnswer(object : SimpleSdp() {
                    override fun onCreateSuccess(desc: SessionDescription) {
                        pc.setLocalDescription(SimpleSdp(), desc)
                        sendSignal(viewerDeviceId, "answer", sdpToJson(desc))
                    }
                }, MediaConstraints())
            }
        }, sdp)
    }

    private fun handleIce(viewerDeviceId: String, payload: JsonObject) {
        val cand = iceFromJson(payload) ?: return
        val pc = peers[viewerDeviceId]
        if (pc != null && pc.remoteDescription != null) pc.addIceCandidate(cand)
        else pendingIce.getOrPut(viewerDeviceId) { mutableListOf() }.add(cand)
    }

    private fun ensurePeer(viewerDeviceId: String): PeerConnection {
        peers[viewerDeviceId]?.let { return it }
        val config = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }
        val pc = factory.createPeerConnection(config, object : PeerConnection.Observer {
            override fun onIceCandidate(candidate: IceCandidate) {
                sendSignal(viewerDeviceId, "ice", iceToJson(candidate))
            }
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
                when (state) {
                    PeerConnection.IceConnectionState.CONNECTED,
                    PeerConnection.IceConnectionState.COMPLETED ->
                        _connected.update { peers.size }
                    PeerConnection.IceConnectionState.FAILED,
                    PeerConnection.IceConnectionState.DISCONNECTED,
                    PeerConnection.IceConnectionState.CLOSED -> closePeer(viewerDeviceId)
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
            override fun onTrack(p0: org.webrtc.RtpTransceiver?) {}
        })!!
        peers[viewerDeviceId] = pc
        return pc
    }

    private fun attachLocalTracks(pc: PeerConnection) {
        val ids = listOf("broadcast_stream")
        // Évite les doublons : si un sender existe déjà pour ce track, ne pas ré-ajouter.
        val senders = pc.senders.mapNotNull { it.track()?.id() }.toSet()
        videoTrack?.let { if (it.id() !in senders) pc.addTrack(it, ids) }
        audioTrack?.let { if (it.id() !in senders) pc.addTrack(it, ids) }
    }

    private fun flushIce(viewerDeviceId: String, pc: PeerConnection) {
        val list = pendingIce.remove(viewerDeviceId) ?: return
        list.forEach { runCatching { pc.addIceCandidate(it) } }
    }

    private fun closePeer(viewerDeviceId: String) {
        val pc = peers.remove(viewerDeviceId) ?: return
        runCatching { pc.close() }
        pendingIce.remove(viewerDeviceId)
        _connected.update { peers.size }
    }

    private fun sendSignal(to: String, kind: String, payload: JsonObject) {
        val id = liveId; val me = myDeviceId
        if (id.isBlank() || me.isBlank()) return
        scope.launch {
            runCatching {
                live.sendSignal(id, from = me, to = to, kind = kind, payloadJson = json.encodeToString(JsonObject.serializer(), payload))
            }
        }
    }

    /** Coupe tous les peers et arrête la capture. À appeler quand on quitte le live. */
    fun stopAll() {
        peers.keys.toList().forEach { closePeer(it) }
        stopCapture()
        liveId = ""
        myDeviceId = ""
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

internal open class SimpleSdp : SdpObserver {
    override fun onCreateSuccess(desc: SessionDescription) {}
    override fun onSetSuccess() {}
    override fun onCreateFailure(error: String?) {}
    override fun onSetFailure(error: String?) {}
}
