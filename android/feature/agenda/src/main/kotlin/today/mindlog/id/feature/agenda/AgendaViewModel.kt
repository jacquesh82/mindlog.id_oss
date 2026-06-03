package today.mindlog.id.feature.agenda

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import today.mindlog.id.core.data.CardRepository
import today.mindlog.id.core.model.AgendaEvent
import javax.inject.Inject

/** Liste d'agenda offline-first ([events] vient du cache Room). */
data class AgendaUiState(
    val events: List<AgendaEvent> = emptyList(),
    val refreshing: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class AgendaViewModel @Inject constructor(
    private val cardRepository: CardRepository,
) : ViewModel() {

    private val refreshing = MutableStateFlow(false)
    private val error = MutableStateFlow<String?>(null)

    val uiState = combine(cardRepository.myEvents(), refreshing, error) { events, refreshing, error ->
        AgendaUiState(events = events, refreshing = refreshing, error = error)
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = AgendaUiState(refreshing = true),
    )

    init { refresh() }

    fun refresh() {
        if (refreshing.value) return
        refreshing.value = true
        error.value = null
        viewModelScope.launch {
            runCatching { cardRepository.refresh() }
                .onFailure { error.value = it.message ?: "Erreur réseau" }
            refreshing.value = false
        }
    }

    /** [startsAtIso] et [endsAtIso] au format ISO 8601 (ex. 2026-06-01T14:00:00Z). */
    fun addEvent(title: String, startsAtIso: String, endsAtIso: String?, location: String?) {
        viewModelScope.launch {
            runCatching {
                cardRepository.addEvent(
                    title = title,
                    startsAt = startsAtIso,
                    endsAt = endsAtIso,
                    location = location?.ifBlank { null },
                    link = null,
                )
            }.onFailure { error.value = it.message ?: "Ajout impossible" }
        }
    }

    fun deleteEvent(id: Long) {
        viewModelScope.launch {
            runCatching { cardRepository.deleteEvent(id) }
                .onFailure { error.value = it.message ?: "Suppression impossible" }
        }
    }

    fun clearError() { error.value = null }
}
