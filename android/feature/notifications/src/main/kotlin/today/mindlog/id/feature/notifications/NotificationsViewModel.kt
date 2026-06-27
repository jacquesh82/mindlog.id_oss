package today.mindlog.id.feature.notifications

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import today.mindlog.id.core.data.ActivityEntry
import today.mindlog.id.core.data.ActivityLog
import today.mindlog.id.core.data.NavigationBus
import today.mindlog.id.core.data.NotificationsRepository
import today.mindlog.id.core.model.AppNotification
import javax.inject.Inject

data class NotificationsUiState(
    val notifications: List<AppNotification> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class NotificationsViewModel @Inject constructor(
    private val repository: NotificationsRepository,
    private val navigationBus: NavigationBus,
    private val activityLog: ActivityLog,
) : ViewModel() {

    private val _uiState = MutableStateFlow(NotificationsUiState(loading = true))
    val uiState: StateFlow<NotificationsUiState> = _uiState.asStateFlow()

    /** Journal d'actions local (échecs d'appel, etc.) — onglet « Journal des actions ». */
    val activity: StateFlow<List<ActivityEntry>> = activityLog.entries

    init {
        activityLog.reload()
        load()
    }

    fun clearActivity() = activityLog.clear()

    fun load() {
        _uiState.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching { repository.list() }
                .onSuccess { list -> _uiState.update { it.copy(loading = false, notifications = list) } }
                .onFailure { e -> _uiState.update { it.copy(loading = false, error = e.message) } }
        }
    }

    fun markAllRead() {
        viewModelScope.launch {
            runCatching { repository.markAllRead() }
                .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
            _uiState.update { st ->
                st.copy(notifications = st.notifications.map { it.copy(read = true) })
            }
        }
    }

    /**
     * Gère le tap sur une notification : si le lien pointe vers un profil
     * (`/@handle`), demande son ouverture via le bus de navigation. Renvoie true
     * si une navigation a été déclenchée.
     */
    fun onNotificationClick(notif: AppNotification): Boolean {
        val handle = notif.link?.let { extractHandle(it) } ?: return false
        navigationBus.requestProfile(handle)
        return true
    }

    private fun extractHandle(link: String): String? {
        val marker = "/@"
        val idx = link.indexOf(marker)
        if (idx < 0) return null
        return link.substring(idx + marker.length)
            .substringBefore('/').substringBefore('?').substringBefore('#')
            .ifBlank { null }
    }

    fun clearError() = _uiState.update { it.copy(error = null) }
}
