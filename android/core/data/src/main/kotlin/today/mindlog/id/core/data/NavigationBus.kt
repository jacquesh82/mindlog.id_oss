package today.mindlog.id.core.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Bus de navigation inter-features. Une notification (feature:notifications) peut
 * demander l'ouverture d'un profil ; l'app bascule sur l'onglet Réseau et
 * feature:relations consomme la cible. Évite une dépendance directe entre features.
 */
@Singleton
class NavigationBus @Inject constructor() {
    private val _openProfile = MutableStateFlow<String?>(null)
    val openProfile: StateFlow<String?> = _openProfile.asStateFlow()

    private val _openChat = MutableStateFlow<String?>(null)
    val openChat: StateFlow<String?> = _openChat.asStateFlow()

    /** Demande l'ouverture du profil [handle] (avec ou sans @). */
    fun requestProfile(handle: String) {
        _openProfile.value = handle.removePrefix("@")
    }

    /** À appeler une fois la cible profil traitée. */
    fun consume() {
        _openProfile.value = null
    }

    /** Demande l'ouverture de la conversation avec [handle]. */
    fun requestChat(handle: String) {
        _openChat.value = handle.removePrefix("@")
    }

    /** À appeler une fois la cible chat traitée. */
    fun consumeChat() {
        _openChat.value = null
    }
}
