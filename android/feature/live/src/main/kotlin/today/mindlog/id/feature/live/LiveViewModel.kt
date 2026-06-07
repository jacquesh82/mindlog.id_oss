package today.mindlog.id.feature.live

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import today.mindlog.id.core.data.LiveRepository
import today.mindlog.id.core.network.dto.LiveDto
import javax.inject.Inject

/** État UI consolidant feed public + mes lives. */
data class LiveUiState(
    val live: List<LiveDto> = emptyList(),
    val upcoming: List<LiveDto> = emptyList(),
    val mine: List<LiveDto> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class LiveViewModel @Inject constructor(
    private val repo: LiveRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(LiveUiState())
    val state: StateFlow<LiveUiState> = _state.asStateFlow()

    init { refresh() }

    fun refresh() {
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            val feed = runCatching { repo.feed() }.getOrNull()
            val mine = runCatching { repo.mine() }.getOrNull()
            _state.update {
                it.copy(
                    live = feed?.live.orEmpty(),
                    upcoming = feed?.upcoming.orEmpty(),
                    mine = (mine?.live.orEmpty() + mine?.upcoming.orEmpty() + mine?.ended.orEmpty())
                        .sortedByDescending { l -> l.startedAt ?: l.scheduledAt },
                    loading = false,
                    error = if (feed == null && mine == null) "Impossible de récupérer les lives." else null,
                )
            }
        }
    }

    fun clearError() = _state.update { it.copy(error = null) }
}
