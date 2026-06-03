package today.mindlog.id.feature.requests

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import today.mindlog.id.core.data.RealtimeRepository
import today.mindlog.id.core.data.RequestsRepository
import today.mindlog.id.core.model.MeetingRequest
import javax.inject.Inject

data class RequestsUiState(
    val requests: List<MeetingRequest> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class RequestsViewModel @Inject constructor(
    private val repository: RequestsRepository,
    realtime: RealtimeRepository,
) : ViewModel() {

    private val loading = MutableStateFlow(true)
    private val error = MutableStateFlow<String?>(null)

    val uiState = combine(repository.incoming(), loading, error) { requests, loading, error ->
        RequestsUiState(requests = requests, loading = loading, error = error)
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = RequestsUiState(loading = true),
    )

    init {
        refresh()
        // Une notification serveur (nouvelle demande, etc.) → resynchronise la liste
        // en direct, même si l'écran est déjà ouvert.
        viewModelScope.launch {
            realtime.events.filter { it.event == "notif" }.collect { refresh() }
        }
    }

    fun refresh() {
        loading.value = true
        error.value = null
        viewModelScope.launch {
            runCatching { repository.refresh() }
                .onFailure { e -> error.value = e.message }
            loading.value = false
        }
    }

    // Les mutations rafraîchissent le cache côté repo → le Flow met l'UI à jour.
    fun accept(id: Long) = mutate { repository.accept(id) }
    fun decline(id: Long) = mutate { repository.decline(id) }
    fun delete(id: Long) = mutate { repository.delete(id) }

    private fun mutate(action: suspend () -> Unit) {
        viewModelScope.launch {
            runCatching { action() }.onFailure { e -> error.value = e.message ?: "Action impossible" }
        }
    }

    fun clearError() { error.value = null }
}
