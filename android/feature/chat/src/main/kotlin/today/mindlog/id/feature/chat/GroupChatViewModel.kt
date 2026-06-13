package today.mindlog.id.feature.chat

import androidx.lifecycle.SavedStateHandle
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
import today.mindlog.id.core.model.GroupMessage
import javax.inject.Inject

data class GroupChatUiState(
    val gid: String = "",
    val loading: Boolean = true,
    val group: Group? = null,
    val ttlHours: Int = 24,
    val messages: List<GroupMessage> = emptyList(),
    val error: String? = null,
    val left: Boolean = false, // a quitté / a été retiré → revenir en arrière
)

@HiltViewModel
class GroupChatViewModel @Inject constructor(
    private val repository: GroupsRepository,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    val gid: String = savedStateHandle.get<String>("gid").orEmpty()

    private val _uiState = MutableStateFlow(GroupChatUiState(gid = gid))
    val uiState: StateFlow<GroupChatUiState> = _uiState.asStateFlow()

    init {
        refresh()
        viewModelScope.launch { repository.groupEvents(gid).collect { refresh() } }
    }

    fun refresh() {
        viewModelScope.launch {
            runCatching { repository.loadConversation(gid) }
                .onSuccess { conv ->
                    _uiState.update {
                        it.copy(loading = false, group = conv.group, ttlHours = conv.ttlHours, messages = conv.messages, error = null)
                    }
                }
                .onFailure { e -> _uiState.update { it.copy(loading = false, error = e.message ?: "Erreur") } }
        }
    }

    fun send(text: String, ttlSeconds: Int? = null, readOnce: Boolean = false) {
        val t = text.trim(); if (t.isBlank()) return
        viewModelScope.launch {
            runCatching { repository.send(gid, t, ttlSeconds, readOnce) }
                .onSuccess { refresh() }
                .onFailure { e -> _uiState.update { it.copy(error = e.message ?: "Envoi impossible") } }
        }
    }

    /** Suppression (expéditeur) ou brûlure (readOnce reçu) — l'UI choisit l'action. */
    fun deleteMessage(mid: Long) {
        viewModelScope.launch {
            runCatching { repository.deleteMessage(gid, mid) }
                .onSuccess { refresh() }
                .onFailure { e -> _uiState.update { it.copy(error = e.message ?: "Suppression impossible") } }
        }
    }

    fun burnMessage(mid: Long) {
        viewModelScope.launch {
            runCatching { repository.burnMessage(gid, mid) }
                .onSuccess { refresh() }
                .onFailure { e -> _uiState.update { it.copy(error = e.message ?: "Brûlure impossible") } }
        }
    }

    fun react(mid: Long, emoji: String) {
        viewModelScope.launch {
            runCatching { repository.react(gid, mid, emoji) }
                .onSuccess { refresh() }
                .onFailure { e -> _uiState.update { it.copy(error = e.message ?: "Réaction impossible") } }
        }
    }

    fun addMember(handle: String) {
        viewModelScope.launch {
            runCatching { repository.addMember(gid, handle) }
                .onSuccess { refresh() }
                .onFailure { e -> _uiState.update { it.copy(error = e.message ?: "Ajout impossible") } }
        }
    }

    /** Retrait d'un membre (admin) puis rotation de ma sender key vers les restants. */
    fun removeMember(handle: String) {
        viewModelScope.launch {
            runCatching {
                repository.removeMember(gid, handle)
                val remaining = repository.loadConversation(gid).group.members.map { it.handle }
                repository.rotate(gid, remaining)
            }
                .onSuccess { refresh() }
                .onFailure { e -> _uiState.update { it.copy(error = e.message ?: "Retrait impossible") } }
        }
    }

    fun leave() {
        viewModelScope.launch {
            runCatching { repository.leave(gid) }
                .onSuccess { _uiState.update { it.copy(left = true) } }
                .onFailure { e -> _uiState.update { it.copy(error = e.message ?: "Impossible de quitter") } }
        }
    }

    fun clearError() = _uiState.update { it.copy(error = null) }
}
