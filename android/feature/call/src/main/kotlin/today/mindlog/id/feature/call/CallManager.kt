package today.mindlog.id.feature.call

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
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
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import org.webrtc.VideoTrack
import today.mindlog.id.core.data.CallSignalRepository
import today.mindlog.id.core.data.ChatRepository
import today.mindlog.id.core.data.di.AppScope
import javax.inject.Inject
import javax.inject.Singleton

enum class CallStage { IDLE, OUTGOING, INCOMING, CONNECTING, CONNECTED, ENDED }

data class CallState(
    val stage: CallStage = CallStage.IDLE,
    val handle: String = "",
    val video: Boolean = true,
    val micOn: Boolean = true,
    val camOn: Boolean = true,
    val localTrack: VideoTrack? = null,
    val remoteTrack: VideoTrack? = null,
)

/**
 * Moteur d'appel WebRTC pair-à-pair. Le média (audio/vidéo) circule en P2P
 * direct (STUN seulement) ; seule la signalisation transite, chiffrée E2E, via
 * [CallSignalRepository]. Miroir Android de public/plugins/call.js.
 *
 * Les permissions micro/caméra sont demandées par l'UI AVANT startOutgoing /
 * accept — ce moteur suppose qu'elles sont accordées.
 */
@Singleton
class CallManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val signalRepo: CallSignalRepository,
    private val chatRepository: ChatRepository,
    @AppScope private val scope: CoroutineScope,
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val iceServers = listOf(
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

    private val _state = MutableStateFlow(CallState())
    val state: StateFlow<CallState> = _state.asStateFlow()

    // État interne de l'appel courant.
    private var pc: PeerConnection? = null
    private var audioTrack: AudioTrack? = null
    private var videoTrack: VideoTrack? = null
    private var capturer: VideoCapturer? = null
    private var surfaceHelper: SurfaceTextureHelper? = null
    private var peerPub: String = ""
    private var handle: String = ""
    private var pendingOffer: SessionDescription? = null
    private val pendingIce = mutableListOf<IceCandidate>()
    private var remoteDescSet = false
    // Historique d'appel : seul l'APPELANT journalise (évite les doublons ; le pair le voit).
    private var outgoing = false
    private var connectedAtMs = 0L
    private var declined = false

    init {
        // Capte globalement la signalisation entrante.
        scope.launch {
            signalRepo.incomingSignals().collect { onSignal(it.from, it.peerPub, it.payload) }
        }
    }

    /* ----------------------------- API publique --------------------------- */

    /** Démarre un appel sortant (permissions déjà accordées). */
    fun startOutgoing(handle: String, peerPub: String, video: Boolean) {
        if (_state.value.stage != CallStage.IDLE && _state.value.stage != CallStage.ENDED) return
        this.handle = handle
        this.peerPub = peerPub
        resetTransient()
        outgoing = true
        _state.value = CallState(stage = CallStage.OUTGOING, handle = handle, video = video)
        scope.launch {
            createMedia(video)
            val conn = createPeerConnection() ?: return@launch
            attachTracks(conn)
            conn.createOffer(object : SimpleSdp() {
                override fun onCreateSuccess(desc: SessionDescription) {
                    conn.setLocalDescription(SimpleSdp(), desc)
                    sendSignal(buildJsonObject {
                        put("k", JsonPrimitive("offer"))
                        put("sdp", sdpJson(desc))
                    })
                }
            }, MediaConstraints())
        }
    }

    /** Accepte l'appel entrant (permissions déjà accordées). */
    fun accept() {
        val offer = pendingOffer ?: return
        val video = _state.value.video
        cancelCallNotification()
        _state.update { it.copy(stage = CallStage.CONNECTING) }
        scope.launch {
            createMedia(video)
            val conn = createPeerConnection() ?: return@launch
            attachTracks(conn)
            conn.setRemoteDescription(object : SimpleSdp() {
                override fun onSetSuccess() {
                    remoteDescSet = true
                    flushIce()
                    conn.createAnswer(object : SimpleSdp() {
                        override fun onCreateSuccess(desc: SessionDescription) {
                            conn.setLocalDescription(SimpleSdp(), desc)
                            sendSignal(buildJsonObject {
                                put("k", JsonPrimitive("answer"))
                                put("sdp", sdpJson(desc))
                            })
                        }
                    }, MediaConstraints())
                }
            }, offer)
        }
    }

    fun decline() {
        sendSignal(buildJsonObject { put("k", JsonPrimitive("decline")) })
        cleanup(CallStage.ENDED)
    }

    fun hangup() {
        sendSignal(buildJsonObject { put("k", JsonPrimitive("hangup")) })
        cleanup(CallStage.ENDED)
    }

    fun toggleMic() {
        val on = !_state.value.micOn
        audioTrack?.setEnabled(on)
        _state.update { it.copy(micOn = on) }
    }

    fun toggleCam() {
        val on = !_state.value.camOn
        videoTrack?.setEnabled(on)
        _state.update { it.copy(camOn = on) }
    }

    /** Permet à l'UI de revenir à l'état IDLE après ENDED. */
    fun dismiss() {
        if (_state.value.stage == CallStage.ENDED) _state.value = CallState()
    }

    /* ----------------------- Réception signalisation ---------------------- */

    private fun onSignal(from: String, fromPub: String, payload: String) {
        val msg = runCatching { json.parseToJsonElement(payload).jsonObject }.getOrNull() ?: return
        when (msg["k"]?.jsonPrimitive?.content) {
            "offer" -> {
                if (_state.value.stage != CallStage.IDLE && _state.value.stage != CallStage.ENDED) {
                    // Occupé : refuse.
                    this.handle = from; this.peerPub = fromPub
                    sendSignal(buildJsonObject { put("k", JsonPrimitive("decline")) })
                    return
                }
                handle = from
                peerPub = fromPub
                resetTransient()
                outgoing = false // appel entrant : c'est le pair (appelant) qui journalisera
                pendingOffer = msg["sdp"]?.jsonObject?.let { sdpFrom(it) }
                val hasVideo = pendingOffer?.description?.contains("m=video") == true
                _state.value = CallState(stage = CallStage.INCOMING, handle = from, video = hasVideo)
                postIncomingCallNotification(from) // sonne même app fermée
            }
            "answer" -> {
                if (from != handle) return
                val desc = msg["sdp"]?.jsonObject?.let { sdpFrom(it) } ?: return
                pc?.setRemoteDescription(object : SimpleSdp() {
                    override fun onSetSuccess() { remoteDescSet = true; flushIce() }
                }, desc)
                _state.update { it.copy(stage = CallStage.CONNECTING) }
            }
            "ice" -> {
                if (from != handle) return
                val cand = msg["cand"]?.jsonObject?.let { iceFrom(it) } ?: return
                if (remoteDescSet) pc?.addIceCandidate(cand) else pendingIce.add(cand)
            }
            "hangup" -> if (from == handle) cleanup(CallStage.ENDED)
            "decline" -> if (from == handle) { declined = true; cleanup(CallStage.ENDED) }
        }
    }

    /* ------------------------------- WebRTC ------------------------------- */

    private fun createPeerConnection(): PeerConnection? {
        val config = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }
        val conn = factory.createPeerConnection(config, object : PeerConnection.Observer {
            override fun onIceCandidate(candidate: IceCandidate) {
                sendSignal(buildJsonObject {
                    put("k", JsonPrimitive("ice"))
                    put("cand", iceJson(candidate))
                })
            }
            override fun onTrack(transceiver: org.webrtc.RtpTransceiver) {
                (transceiver.receiver.track() as? VideoTrack)?.let { vt ->
                    scope.launch { _state.update { it.copy(remoteTrack = vt, stage = CallStage.CONNECTED) } }
                }
            }
            override fun onIceConnectionChange(newState: PeerConnection.IceConnectionState) {
                when (newState) {
                    PeerConnection.IceConnectionState.CONNECTED,
                    PeerConnection.IceConnectionState.COMPLETED -> {
                        if (connectedAtMs == 0L) connectedAtMs = System.currentTimeMillis() // début communication
                        scope.launch { _state.update { it.copy(stage = CallStage.CONNECTED) } }
                    }
                    PeerConnection.IceConnectionState.FAILED -> cleanup(CallStage.ENDED)
                    else -> {}
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
        pc = conn
        return conn
    }

    private fun createMedia(video: Boolean) {
        audioTrack = factory.createAudioTrack("audio0", factory.createAudioSource(MediaConstraints()))
            .apply { setEnabled(true) }
        if (!video) return
        val enumerator = Camera2Enumerator(context)
        val deviceName = enumerator.deviceNames.firstOrNull { enumerator.isFrontFacing(it) }
            ?: enumerator.deviceNames.firstOrNull()
        if (deviceName == null) { // pas de caméra → audio seul
            _state.update { it.copy(video = false) }
            return
        }
        val cap = enumerator.createCapturer(deviceName, null) ?: return
        val helper = SurfaceTextureHelper.create("CaptureThread", eglBase.eglBaseContext)
        val source = factory.createVideoSource(cap.isScreencast)
        cap.initialize(helper, context, source.capturerObserver)
        cap.startCapture(1280, 720, 30)
        val vt = factory.createVideoTrack("video0", source).apply { setEnabled(true) }
        capturer = cap
        surfaceHelper = helper
        videoTrack = vt
        scope.launch { _state.update { it.copy(localTrack = vt) } }
    }

    private fun attachTracks(conn: PeerConnection) {
        val ids = listOf("stream0")
        audioTrack?.let { conn.addTrack(it, ids) }
        videoTrack?.let { conn.addTrack(it, ids) }
    }

    private fun flushIce() {
        pendingIce.forEach { runCatching { pc?.addIceCandidate(it) } }
        pendingIce.clear()
    }

    private fun sendSignal(obj: JsonObject) {
        val h = handle
        val p = peerPub
        if (h.isEmpty() || p.isEmpty()) return
        scope.launch {
            runCatching { signalRepo.sendSignal(h, p, json.encodeToString(JsonObject.serializer(), obj)) }
        }
    }

    private fun cleanup(finalStage: CallStage) {
        cancelCallNotification()
        scope.launch {
            // Historique : l'APPELANT journalise l'appel (message E2E « call:{json} ») dans la
            // conversation, avant de tout réinitialiser. Best-effort.
            if (outgoing && handle.isNotEmpty() && peerPub.isNotEmpty()) {
                val status = if (connectedAtMs > 0L) "answered" else if (declined) "declined" else "missed"
                val dur = if (connectedAtMs > 0L) ((System.currentTimeMillis() - connectedAtMs) / 1000).toInt() else 0
                val sentinel = "call:" + json.encodeToString(JsonObject.serializer(), buildJsonObject {
                    put("k", JsonPrimitive(if (_state.value.video) "video" else "audio"))
                    put("s", JsonPrimitive(status))
                    put("d", JsonPrimitive(dur))
                })
                val h = handle; val p = peerPub
                runCatching { chatRepository.send(h, p, sentinel) }
            }
            outgoing = false
            runCatching { capturer?.stopCapture() }
            capturer?.dispose(); capturer = null
            surfaceHelper?.dispose(); surfaceHelper = null
            runCatching { pc?.close() }
            pc = null
            audioTrack = null
            videoTrack = null
            pendingOffer = null
            remoteDescSet = false
            pendingIce.clear()
            _state.value = CallState(stage = finalStage, handle = handle)
        }
    }

    private fun resetTransient() {
        pendingOffer = null
        remoteDescSet = false
        pendingIce.clear()
        connectedAtMs = 0L
        declined = false
    }

    /* --------------------- Notification d'appel entrant ------------------- */
    // Notification haute priorité avec intent plein écran : fait « sonner »
    // l'appel même si l'app est fermée. Le tap rouvre l'app, qui affiche le
    // CallHost (état INCOMING déjà en place).

    private fun postIncomingCallNotification(from: String) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(CALL_CHANNEL, "Appels entrants", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Appels audio/vidéo entrants"
                    enableVibration(true)
                },
            )
        }
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        val pending = PendingIntent.getActivity(
            context, 7, launch ?: Intent(),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notif = NotificationCompat.Builder(context, CALL_CHANNEL)
            .setSmallIcon(android.R.drawable.sym_action_call)
            .setContentTitle("Appel entrant")
            .setContentText("@$from vous appelle 🔒")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .setFullScreenIntent(pending, true) // affichage plein écran si possible
            .build()
        nm.notify(CALL_NOTIF_ID, notif)
    }

    private fun cancelCallNotification() {
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(CALL_NOTIF_ID)
    }

    /* --------------------------- (dé)sérialisation ------------------------ */

    private fun sdpJson(desc: SessionDescription) = buildJsonObject {
        put("type", JsonPrimitive(desc.type.canonicalForm()))
        put("sdp", JsonPrimitive(desc.description))
    }

    private fun sdpFrom(o: JsonObject): SessionDescription {
        val type = SessionDescription.Type.fromCanonicalForm(o["type"]!!.jsonPrimitive.content)
        return SessionDescription(type, o["sdp"]!!.jsonPrimitive.content)
    }

    private fun iceJson(c: IceCandidate) = buildJsonObject {
        put("candidate", JsonPrimitive(c.sdp))
        put("sdpMid", JsonPrimitive(c.sdpMid))
        put("sdpMLineIndex", JsonPrimitive(c.sdpMLineIndex))
    }

    private fun iceFrom(o: JsonObject) = IceCandidate(
        o["sdpMid"]?.jsonPrimitive?.content,
        o["sdpMLineIndex"]?.jsonPrimitive?.int ?: 0,
        o["candidate"]!!.jsonPrimitive.content,
    )

    private companion object {
        const val CALL_CHANNEL = "calls"
        const val CALL_NOTIF_ID = 7001
    }
}

/** SdpObserver à no-op partiel (on ne surcharge que ce qui sert). */
private open class SimpleSdp : SdpObserver {
    override fun onCreateSuccess(desc: SessionDescription) {}
    override fun onSetSuccess() {}
    override fun onCreateFailure(error: String?) {}
    override fun onSetFailure(error: String?) {}
}

@Suppress("unused")
private fun MediaStreamTrack.noop() = Unit
