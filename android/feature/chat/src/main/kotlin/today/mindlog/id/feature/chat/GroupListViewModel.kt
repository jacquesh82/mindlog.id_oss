package today.mindlog.id.feature.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import today.mindlog.id.core.data.GroupsRepository
import today.mindlog.id.core.model.Group
import javax.inject.Inject

data class GroupListUiState(
    val loading: Boolean = true,
    val groups: List<Group> = emptyList(),
    val error: String? = null,
)

@HiltViewModel
class GroupListViewModel @Inject constructor(
    private val repository: GroupsRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(GroupListUiState())
    val uiState: StateFlow<GroupListUiState> = _uiState.asStateFlow()

    init {
        refresh()
        viewModelScope.launch { repository.listEvents().collect { refresh() } }
    }

    fun refresh() {
        viewModelScope.launch {
            runCatching { repository.list() }
                .onSuccess { gs -> _uiState.update { it.copy(loading = false, groups = gs, error = null) } }
                .onFailure { e -> _uiState.update { it.copy(loading = false, error = e.message ?: "Erreur de chargement") } }
        }
    }

    fun create(name: String, members: List<String>) {
        viewModelScope.launch {
            runCatching { repository.create(name, members) }
                .onSuccess { refresh() }
                .onFailure { e -> _uiState.update { it.copy(error = e.message ?: "Création impossible") } }
        }
    }

    fun clearError() = _uiState.update { it.copy(error = null) }
}
