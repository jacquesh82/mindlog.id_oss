package today.mindlog.id.core.datastore

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Conserve la clé d'accès (`x-access-key`) et le handle dans un stockage chiffré
 * (Android Keystore via EncryptedSharedPreferences). La clé est le seul secret
 * d'authentification de l'app : aucune session cookie, aucun CSRF côté mobile.
 */
@Singleton
class SessionStore @Inject constructor(
    @ApplicationContext context: Context,
) {
    private val prefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            FILE_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    private val _session = MutableStateFlow(read())
    val session: StateFlow<Session?> = _session.asStateFlow()

    fun accessKey(): String? = _session.value?.accessKey

    /** Identifiant STABLE de cet appareil (multi-appareils E2E). Généré une fois,
     *  conservé même après déconnexion (sinon chaque login créerait un appareil « en
     *  attente »). Format compatible serveur ([A-Za-z0-9_-]{8,64}). */
    fun deviceId(): String {
        prefs.getString(KEY_DEVICE, null)?.let { return it }
        val id = "dev-" + java.util.UUID.randomUUID().toString()
        prefs.edit().putString(KEY_DEVICE, id).apply()
        return id
    }

    fun save(accessKey: String, handle: String) {
        prefs.edit()
            .putString(KEY_ACCESS, accessKey)
            .putString(KEY_HANDLE, handle)
            .apply()
        _session.value = Session(accessKey, handle)
    }

    fun clear() {
        // Conserve l'identifiant d'appareil au-delà de la déconnexion.
        val dev = prefs.getString(KEY_DEVICE, null)
        prefs.edit().clear().apply()
        if (dev != null) prefs.edit().putString(KEY_DEVICE, dev).apply()
        _session.value = null
    }

    private fun read(): Session? {
        val key = prefs.getString(KEY_ACCESS, null) ?: return null
        val handle = prefs.getString(KEY_HANDLE, null) ?: return null
        return Session(key, handle)
    }

    private companion object {
        const val FILE_NAME = "mindlog_session"
        const val KEY_ACCESS = "access_key"
        const val KEY_HANDLE = "handle"
        const val KEY_DEVICE = "device_id"
    }
}

data class Session(val accessKey: String, val handle: String)
