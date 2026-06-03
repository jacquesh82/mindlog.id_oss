package today.mindlog.id.core.datastore

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Conserve la couleur d'accentuation choisie (hex "#RRGGBB"). Non secret →
 * SharedPreferences simples. `null` tant qu'aucune couleur n'a été fixée.
 */
@Singleton
class AccentStore @Inject constructor(
    @ApplicationContext context: Context,
) {
    private val prefs = context.getSharedPreferences("mindlog_accent", Context.MODE_PRIVATE)
    private val _accent = MutableStateFlow(prefs.getString(KEY, null))
    val accent: StateFlow<String?> = _accent.asStateFlow()

    fun current(): String? = _accent.value

    fun set(hex: String) {
        prefs.edit().putString(KEY, hex).apply()
        _accent.value = hex
    }

    private companion object {
        const val KEY = "accent_hex"
    }
}
