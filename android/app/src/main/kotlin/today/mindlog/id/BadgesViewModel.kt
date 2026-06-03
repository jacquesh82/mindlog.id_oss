package today.mindlog.id

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import today.mindlog.id.core.data.NavigationBus
import today.mindlog.id.core.data.NotificationsRepository
import today.mindlog.id.core.model.Badges
import javax.inject.Inject

@HiltViewModel
class BadgesViewModel @Inject constructor(
    private val notificationsRepository: NotificationsRepository,
    private val navigationBus: NavigationBus,
) : ViewModel() {

    val badges: StateFlow<Badges> = notificationsRepository.badges

    /** Cible de navigation (profil demandé par une notification), ou null. */
    val openProfile: StateFlow<String?> = navigationBus.openProfile

    /** Conversation à ouvrir (demandée par une notification de message), ou null. */
    val openChat: StateFlow<String?> = navigationBus.openChat

    /** Recharge les compteurs (appelé à chaque changement d'onglet). */
    fun refresh() {
        viewModelScope.launch { notificationsRepository.refreshBadges() }
    }

    /** Ouvre la page profil d'un contact (bascule sur Réseau + affiche le profil). */
    fun requestProfile(handle: String) = navigationBus.requestProfile(handle)

    fun consumeChat() = navigationBus.consumeChat()
}
