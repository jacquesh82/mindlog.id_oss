package today.mindlog.id.core.data

import kotlinx.coroutines.flow.StateFlow
import today.mindlog.id.core.datastore.AccentStore
import javax.inject.Inject
import javax.inject.Singleton

/** Accès à la couleur d'accentuation (hex "#RRGGBB") pour le thème et Options. */
@Singleton
class AccentRepository @Inject constructor(
    private val accentStore: AccentStore,
) {
    val accent: StateFlow<String?> = accentStore.accent

    fun current(): String? = accentStore.current()

    fun set(hex: String) = accentStore.set(hex)
}
