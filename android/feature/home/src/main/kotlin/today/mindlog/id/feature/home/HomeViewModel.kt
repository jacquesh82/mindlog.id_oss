package today.mindlog.id.feature.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import today.mindlog.id.core.data.CardRepository
import today.mindlog.id.core.data.ChatRepository
import today.mindlog.id.core.data.RelationsRepository
import today.mindlog.id.core.model.AgendaEvent
import today.mindlog.id.core.model.Card
import today.mindlog.id.core.model.ConversationSummary
import javax.inject.Inject

data class HomeUiState(
    val card: Card? = null,
    val events: List<AgendaEvent> = emptyList(),
    val conversations: List<ConversationSummary> = emptyList(),
    val hasVault: Boolean = false,
    val pagePublic: Boolean = true,
    val loading: Boolean = true,
    val error: String? = null,
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val cardRepository: CardRepository,
    private val relationsRepository: RelationsRepository,
    private val chatRepository: ChatRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(HomeUiState())
    val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()

    init {
        // Cache local (Room) → réactif.
        viewModelScope.launch { cardRepository.myCard().collect { c -> _uiState.update { it.copy(card = c) } } }
        viewModelScope.launch { cardRepository.myEvents().collect { e -> _uiState.update { it.copy(events = e) } } }
        refresh()
    }

    /** Synchronise depuis le réseau (carte, relations, conversations, drapeaux). */
    fun refresh() {
        viewModelScope.launch {
            val err = runCatching {
                cardRepository.refresh()
                relationsRepository.refresh()
            }.exceptionOrNull()
            val convs = runCatching { chatRepository.conversationSummaries() }.getOrNull()
            val flags = runCatching { cardRepository.accountFlags() }.getOrNull()
            _uiState.update {
                it.copy(
                    loading = false,
                    conversations = convs ?: it.conversations,
                    hasVault = flags?.hasVault ?: it.hasVault,
                    pagePublic = flags?.pagePublic ?: it.pagePublic,
                    error = if (it.card == null) err?.message else null,
                )
            }
        }
    }

    /** Bascule la visibilité de la page (bouton « Secret »). */
    fun toggleSecret() {
        viewModelScope.launch {
            val next = !_uiState.value.pagePublic
            runCatching { cardRepository.setPagePublic(next) }
                .onSuccess { _uiState.update { it.copy(pagePublic = next) } }
        }
    }
}
