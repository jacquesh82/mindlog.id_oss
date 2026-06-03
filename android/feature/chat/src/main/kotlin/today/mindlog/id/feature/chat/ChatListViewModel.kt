package today.mindlog.id.feature.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import today.mindlog.id.core.data.ChatRepository
import today.mindlog.id.core.data.RealtimeRepository
import today.mindlog.id.core.model.ConversationSummary
import javax.inject.Inject

data class ChatListUiState(
    val loading: Boolean = true,
    val conversations: List<ConversationSummary> = emptyList(),
    val error: String? = null,
)

@HiltViewModel
class ChatListViewModel @Inject constructor(
    private val repository: ChatRepository,
    private val realtime: RealtimeRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ChatListUiState())
    val uiState: StateFlow<ChatListUiState> = _uiState.asStateFlow()

    init {
        refresh()
        // Rafraîchit la liste à chaque message/ack temps réel.
        viewModelScope.launch {
            realtime.events.collect { ev ->
                if (ev.event == "message" || ev.event == "ack") refresh()
            }
        }
    }

    fun refresh() {
        viewModelScope.launch {
            runCatching { repository.conversationSummaries() }
                .onSuccess { list -> _uiState.update { it.copy(loading = false, conversations = list, error = null) } }
                .onFailure { e -> _uiState.update { it.copy(loading = false, error = e.message ?: "Erreur de chargement") } }
        }
    }

    fun clearError() = _uiState.update { it.copy(error = null) }
}
