package today.mindlog.id.feature.live

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.webrtc.VideoTrack
import today.mindlog.id.core.data.LiveRepository
import today.mindlog.id.core.network.dto.LiveDto
import java.util.UUID
import javax.inject.Inject

data class BroadcasterUiState(
    val title: String = "",
    val previewing: Boolean = false,
    val micOn: Boolean = true,
    val localTrack: VideoTrack? = null,
    val live: LiveDto? = null,
    val viewers: Int = 0,
    val connectedPeers: Int = 0,
    val facingFront: Boolean = true,
    val processing: Boolean = false,
    val error: String? = null,
    val message: String? = null,
    // RBAC : le serveur a refusé le démarrage faute d'abonnement Premium.
    val needsPremium: Boolean = false,
)

@HiltViewModel
class BroadcasterViewModel @Inject constructor(
    private val engine: BroadcasterEngine,
    private val live: LiveRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(BroadcasterUiState())
    val state: StateFlow<BroadcasterUiState> = _state.asStateFlow()

    // device_id local pour cette session — uuid persistant n'est pas utile (rosters
    // expirent à la fin du live).
    private val deviceId: String = UUID.randomUUID().toString()
    // broadcaster_pub : placeholder opaque (le serveur le stocke sans le vérifier).
    // La couche E2E Web (wrap/unwrap Ks) n'est pas implémentée côté Android.
    private val broadcasterPubPlaceholder: String = "and:${UUID.randomUUID()}"

    private var heartbeatJob: Job? = null

    fun eglContext() = engine.eglContext()

    init {
        viewModelScope.launch {
            engine.connectedPeers.collectLatest { count -> _state.update { it.copy(connectedPeers = count) } }
        }
    }

    fun setTitle(value: String) { _state.update { it.copy(title = value) } }

    /** Démarre la preview caméra + micro (pas encore live côté serveur). */
    fun startPreview(withAudio: Boolean = true) {
        if (_state.value.previewing) return
        val track = runCatching { engine.startCapture(facingFront = _state.value.facingFront, withAudio = withAudio) }.getOrNull()
        if (track == null) {
            _state.update { it.copy(error = "Caméra indisponible.") }
            return
        }
        _state.update { it.copy(previewing = true, localTrack = track, micOn = engine.isMicEnabled()) }
    }

    fun toggleFacing() {
        if (!_state.value.previewing) return
        val front = !_state.value.facingFront
        val track = runCatching { engine.startCapture(facingFront = front, withAudio = true) }.getOrNull()
        _state.update { it.copy(facingFront = front, localTrack = track, micOn = engine.isMicEnabled()) }
    }

    fun toggleMic() {
        val on = !_state.value.micOn
        engine.setMicEnabled(on)
        _state.update { it.copy(micOn = on) }
    }

    /** Crée le live côté serveur + enregistre dans le roster + démarre la signalisation. */
    fun goLive() {
        val title = _state.value.title.trim().ifBlank { return errorMsg("Titre requis.") }
        if (_state.value.live != null) return
        if (!_state.value.previewing) startPreview()
        viewModelScope.launch {
            _state.update { it.copy(processing = true) }
            val dto = runCatching { live.start(title, broadcasterPubPlaceholder) }.getOrElse { e ->
                // RBAC : 402 « premium required » → on ouvre l'upsell plutôt qu'une erreur brute.
                val msg = e.message ?: ""
                val premiumGate = msg.contains("402") || msg.contains("premium", ignoreCase = true)
                _state.update {
                    it.copy(
                        processing = false,
                        needsPremium = premiumGate,
                        error = if (premiumGate) null else (msg.ifBlank { "Démarrage refusé." }),
                    )
                }
                return@launch
            }
            // Enregistre le broadcaster dans le roster (sinon les signaux entrants sont refusés).
            runCatching { live.join(dto.id, deviceId) }
                .onFailure { e ->
                    _state.update { it.copy(processing = false, error = "Roster KO : ${e.message}") }
                    runCatching { live.end(dto.id) }
                    return@launch
                }
            engine.startSignaling(dto.id, deviceId)
            _state.update { it.copy(processing = false, live = dto, message = "Live démarré ! 🦎") }
            startHeartbeat(dto.id)
        }
    }

    fun endLive() {
        val l = _state.value.live ?: return
        viewModelScope.launch {
            _state.update { it.copy(processing = true) }
            engine.stopAll()
            live.leave(l.id, deviceId)
            runCatching { live.end(l.id) }
                .onSuccess { _state.update { it.copy(processing = false, live = null, viewers = 0, message = "Live terminé.") } }
                .onFailure { e -> _state.update { it.copy(processing = false, error = e.message ?: "Arrêt refusé.") } }
            stopHeartbeat()
        }
    }

    private fun startHeartbeat(id: String) {
        stopHeartbeat()
        heartbeatJob = viewModelScope.launch {
            while (true) {
                runCatching { live.heartbeat(id, deviceId) }
                runCatching { _state.update { it.copy(viewers = live.roster(id).count) } }
                delay(15_000)
            }
        }
    }
    private fun stopHeartbeat() { heartbeatJob?.cancel(); heartbeatJob = null }

    override fun onCleared() {
        stopHeartbeat()
        engine.stopAll()
    }

    /** Lien public partageable du live en cours (null si pas en live). */
    fun shareUrl(): String? = _state.value.live?.let { live.shareUrl(it.id) }

    /** Renotifie manuellement les abonné·e·s du live en cours. */
    fun notifySubscribers() {
        val l = _state.value.live ?: return
        viewModelScope.launch {
            runCatching { live.notify(l.id) }
                .onSuccess { _state.update { it.copy(message = "Abonné·e·s notifié·e·s 🦎") } }
                .onFailure { e -> _state.update { it.copy(error = e.message ?: "Notification impossible.") } }
        }
    }

    fun dismissPremiumGate() = _state.update { it.copy(needsPremium = false) }

    fun clearMessage() = _state.update { it.copy(message = null) }
    fun clearError() = _state.update { it.copy(error = null) }
    private fun errorMsg(m: String) { _state.update { it.copy(error = m) } }
}
