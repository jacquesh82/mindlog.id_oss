package today.mindlog.id.feature.live

import androidx.lifecycle.SavedStateHandle
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
import today.mindlog.id.core.network.dto.LiveJoinDto
import java.util.UUID
import javax.inject.Inject

data class ViewerUiState(
    val liveId: String = "",
    val handle: String = "",
    val title: String = "",
    val joined: Boolean = false,
    val connected: Boolean = false,
    val viewers: Int = 0,
    val remoteVideo: VideoTrack? = null,
    val joinPayload: LiveJoinDto? = null,
    val error: String? = null,
    val loading: Boolean = false,
)

@HiltViewModel
class ViewerViewModel @Inject constructor(
    private val live: LiveRepository,
    private val engine: ViewerEngine,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val _state = MutableStateFlow(ViewerUiState())
    val state: StateFlow<ViewerUiState> = _state.asStateFlow()

    fun eglContext() = engine.eglContext()

    private val deviceId: String = UUID.randomUUID().toString()
    private var heartbeatJob: Job? = null

    init {
        viewModelScope.launch {
            engine.remoteVideo.collectLatest { vt -> _state.update { it.copy(remoteVideo = vt) } }
        }
        viewModelScope.launch {
            engine.connected.collectLatest { c -> _state.update { it.copy(connected = c) } }
        }
    }

    fun bind(liveId: String, handle: String, title: String) {
        _state.update { it.copy(liveId = liveId, handle = handle, title = title) }
        join()
    }

    fun join() {
        val id = _state.value.liveId
        if (id.isBlank() || _state.value.joined) return
        viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null) }
            runCatching { live.join(id, deviceId) }
                .onSuccess { payload ->
                    _state.update { it.copy(loading = false, joined = true, joinPayload = payload) }
                    engine.start(id, deviceId, payload)
                    startHeartbeat(id)
                }
                .onFailure { e ->
                    _state.update { it.copy(loading = false, error = e.message ?: "Connexion refusée.") }
                }
        }
    }

    fun leave() {
        val id = _state.value.liveId
        if (id.isBlank()) return
        viewModelScope.launch { live.leave(id, deviceId) }
        engine.stop()
        stopHeartbeat()
        _state.update { it.copy(joined = false) }
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

    fun clearError() = _state.update { it.copy(error = null) }

    override fun onCleared() {
        stopHeartbeat()
        engine.stop()
        val id = _state.value.liveId
        if (id.isNotBlank()) {
            kotlinx.coroutines.GlobalScope.launch { runCatching { live.leave(id, deviceId) } }
        }
    }
}
