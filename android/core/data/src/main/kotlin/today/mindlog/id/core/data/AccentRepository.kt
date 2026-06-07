package today.mindlog.id.core.data

import kotlinx.coroutines.flow.StateFlow
import today.mindlog.id.core.datastore.AccentStore
import javax.inject.Inject
import javax.inject.Singleton

/** Accès aux préférences UI (accent, mode de thème, tour Milo). */
@Singleton
class AccentRepository @Inject constructor(
    private val accentStore: AccentStore,
) {
    val accent: StateFlow<String?> = accentStore.accent
    fun current(): String? = accentStore.current()
    fun set(hex: String) = accentStore.set(hex)

    /** Mode brut ("system"/"light"/"dark", ou null = system par défaut). */
    val themeMode: StateFlow<String?> = accentStore.themeMode
    fun setThemeMode(mode: String) = accentStore.setThemeMode(mode)

    val miloTourSeen: StateFlow<Boolean> = accentStore.miloTourSeen
    fun setMiloTourSeen(seen: Boolean) = accentStore.setMiloTourSeen(seen)

    /** Identifiant anonyme stable pour les likes de galerie. */
    fun deviceFingerprint(): String = accentStore.deviceFingerprint()
}
