package today.mindlog.id.feature.agenda

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import today.mindlog.id.core.data.CardRepository
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth
import javax.inject.Inject

data class AvailabilityUiState(
    val month: YearMonth = YearMonth.now(),
    /** jour (YYYY-MM-DD) -> "free" | "busy" (exceptions explicites). */
    val overrides: Map<String, String> = emptyMap(),
    val loading: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class AvailabilityViewModel @Inject constructor(
    private val cardRepository: CardRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(AvailabilityUiState(loading = true))
    val uiState: StateFlow<AvailabilityUiState> = _uiState.asStateFlow()

    init { load() }

    fun load() {
        _uiState.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching { cardRepository.overrides() }
                .onSuccess { ov -> _uiState.update { it.copy(loading = false, overrides = ov) } }
                .onFailure { e -> _uiState.update { it.copy(loading = false, error = e.message) } }
        }
    }

    fun prevMonth() = _uiState.update { it.copy(month = it.month.minusMonths(1)) }
    fun nextMonth() = _uiState.update { it.copy(month = it.month.plusMonths(1)) }

    /** Inverse l'état effectif d'un jour (le backend supprime l'override si redondant). */
    fun toggleDay(date: LocalDate) {
        val day = date.toString()
        val target = if (effectiveStatus(date, _uiState.value.overrides) == "free") "busy" else "free"
        // Optimiste : on reflète tout de suite, puis on resynchronise.
        _uiState.update { it.copy(overrides = it.overrides + (day to target)) }
        viewModelScope.launch {
            runCatching { cardRepository.setDayStatus(day, target) }
                .onFailure { e -> _uiState.update { it.copy(error = e.message ?: "Modification impossible") } }
            runCatching { cardRepository.overrides() }
                .onSuccess { ov -> _uiState.update { it.copy(overrides = ov) } }
        }
    }

    fun clearError() = _uiState.update { it.copy(error = null) }
}

/** Règle par défaut (miroir backend) : libre en semaine, occupé le week-end. */
internal fun defaultStatus(date: LocalDate): String =
    if (date.dayOfWeek == DayOfWeek.SATURDAY || date.dayOfWeek == DayOfWeek.SUNDAY) "busy" else "free"

internal fun effectiveStatus(date: LocalDate, overrides: Map<String, String>): String =
    overrides[date.toString()] ?: defaultStatus(date)
