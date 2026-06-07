package today.mindlog.id.core.datastore

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Préférences UI : couleur d'accentuation, mode de thème (system/light/dark),
 * et flag de tour Milo. Non secret → SharedPreferences simples.
 */
@Singleton
class AccentStore @Inject constructor(
    @ApplicationContext context: Context,
) {
    private val prefs = context.getSharedPreferences("mindlog_accent", Context.MODE_PRIVATE)

    private val _accent = MutableStateFlow(prefs.getString(KEY_ACCENT, null))
    val accent: StateFlow<String?> = _accent.asStateFlow()

    fun current(): String? = _accent.value

    fun set(hex: String) {
        prefs.edit().putString(KEY_ACCENT, hex).apply()
        _accent.value = hex
    }

    private val _themeMode = MutableStateFlow(prefs.getString(KEY_THEME_MODE, null))
    val themeMode: StateFlow<String?> = _themeMode.asStateFlow()

    fun setThemeMode(mode: String) {
        prefs.edit().putString(KEY_THEME_MODE, mode).apply()
        _themeMode.value = mode
    }

    private val _miloTourSeen = MutableStateFlow(prefs.getBoolean(KEY_TOUR_SEEN, false))
    val miloTourSeen: StateFlow<Boolean> = _miloTourSeen.asStateFlow()

    fun setMiloTourSeen(seen: Boolean) {
        prefs.edit().putBoolean(KEY_TOUR_SEEN, seen).apply()
        _miloTourSeen.value = seen
    }

    /**
     * Dernier affichage de la modale d'invitation Premium (epoch ms). Sert au
     * cooldown du workflow d'upsell (cible ~1-3 affichages/mois).
     */
    fun premiumUpsellShownAt(): Long = prefs.getLong(KEY_UPSELL_AT, 0L)

    fun setPremiumUpsellShownAt(epochMs: Long) {
        prefs.edit().putLong(KEY_UPSELL_AT, epochMs).apply()
    }

    /**
     * Identifiant anonyme stable pour les actions sans authentification (likes
     * de galerie, par exemple). Persisté à la 1re lecture.
     */
    fun deviceFingerprint(): String {
        prefs.getString(KEY_FP, null)?.let { return it }
        val fp = java.util.UUID.randomUUID().toString().replace("-", "").take(32)
        prefs.edit().putString(KEY_FP, fp).apply()
        return fp
    }

    private companion object {
        const val KEY_ACCENT = "accent_hex"
        const val KEY_THEME_MODE = "theme_mode"
        const val KEY_TOUR_SEEN = "milo_tour_seen"
        const val KEY_FP = "device_fp"
        const val KEY_UPSELL_AT = "premium_upsell_at"
    }
}
