package today.mindlog.id.core.datastore

import android.content.Context
import android.content.SharedPreferences
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Mémorise le serveur mindlog choisi par l'utilisateur (URL de base). Persiste
 * indépendamment de la session (n'est PAS effacé au logout) pour ne pas avoir à
 * resaisir l'adresse. Non secret → SharedPreferences en clair. L'URL est lue à
 * chaque requête par le `ServerUrlInterceptor`.
 */
@Singleton
class ServerStore @Inject constructor(
    @ApplicationContext context: Context,
) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences(FILE_NAME, Context.MODE_PRIVATE)

    private val _baseUrl = MutableStateFlow(prefs.getString(KEY_BASE_URL, null) ?: DEFAULT_BASE_URL)
    val baseUrlFlow: StateFlow<String> = _baseUrl.asStateFlow()

    /** URL de base courante, terminée par « / » (lecture synchrone). */
    fun baseUrl(): String = _baseUrl.value

    /** true si on est sur le serveur par défaut (id.mindlog.today). */
    fun isDefault(): Boolean = _baseUrl.value == DEFAULT_BASE_URL

    /**
     * Enregistre un nouveau serveur à partir d'une saisie libre (« id.mindlog.today »,
     * « monserveur.fr:8443 », « http://192.168.1.10:8787 »). Renvoie l'URL normalisée,
     * ou null si la saisie est invalide. Sans schéma explicite → https.
     */
    fun setServer(raw: String): String? {
        val normalized = normalize(raw) ?: return null
        prefs.edit().putString(KEY_BASE_URL, normalized).apply()
        _baseUrl.value = normalized
        return normalized
    }

    fun resetToDefault() {
        prefs.edit().remove(KEY_BASE_URL).apply()
        _baseUrl.value = DEFAULT_BASE_URL
    }

    companion object {
        // Prod en release ; serveur de dev local en debug (cf. buildConfigField DEFAULT_SERVER).
        val DEFAULT_BASE_URL: String = BuildConfig.DEFAULT_SERVER
        private const val FILE_NAME = "mindlog_server"
        private const val KEY_BASE_URL = "base_url"

        /** Normalise une saisie en URL de base valide (https par défaut, « / » final). */
        fun normalize(raw: String): String? {
            var s = raw.trim()
            if (s.isEmpty()) return null
            if (!s.startsWith("http://") && !s.startsWith("https://")) s = "https://$s"
            // Hôte non vide après le schéma.
            val rest = s.substringAfter("://")
            if (rest.isBlank() || rest.startsWith("/") || rest.startsWith(":")) return null
            return s.trimEnd('/') + "/"
        }

        /** Affichage compact : hôte (+ port) sans le schéma ni le « / » final. */
        fun displayHost(baseUrl: String): String =
            baseUrl.substringAfter("://").trimEnd('/')
    }
}
