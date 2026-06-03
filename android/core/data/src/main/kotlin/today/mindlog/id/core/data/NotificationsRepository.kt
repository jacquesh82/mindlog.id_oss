package today.mindlog.id.core.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import today.mindlog.id.core.model.AppNotification
import today.mindlog.id.core.model.Badges
import today.mindlog.id.core.network.MindlogApi
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Notifications in-app et compteurs de badges. [badges] est un flux partagé
 * (singleton) observé par la barre de navigation ; toute partie de l'app peut
 * déclencher [refreshBadges] après une action (RDV accepté, relation ajoutée…).
 */
@Singleton
class NotificationsRepository @Inject constructor(
    private val api: MindlogApi,
) {
    private val _badges = MutableStateFlow(Badges())
    val badges: StateFlow<Badges> = _badges.asStateFlow()

    /** Recharge les compteurs depuis /api/me. */
    suspend fun refreshBadges() {
        runCatching { api.me() }.onSuccess { me ->
            _badges.value = Badges(
                unread = me.unread,
                pending = me.pending,
                incoming = me.incoming.size,
            )
        }
    }

    /** Liste des notifications (et met à jour les badges au passage). */
    suspend fun list(): List<AppNotification> {
        val me = api.me()
        _badges.value = Badges(me.unread, me.pending, me.incoming.size)
        return me.notifications.map { it.toModel() }
    }

    /** Marque tout comme lu côté serveur et remet le compteur non-lu à zéro. */
    suspend fun markAllRead() {
        api.markNotificationsRead()
        _badges.value = _badges.value.copy(unread = 0)
    }
}
