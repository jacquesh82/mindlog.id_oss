package today.mindlog.id.core.crypto

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Stocke la JWK PRIVÉE E2E par handle dans un fichier chiffré (Android Keystore).
 * La clé privée ne quitte jamais l'appareil en clair ; seule sa version chiffrée
 * par passphrase (coffre serveur) est portable. Miroir de `mindlog.e2e.<handle>`
 * du localStorage web.
 */
@Singleton
class E2eKeyStore @Inject constructor(
    @ApplicationContext context: Context,
) {
    private val prefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "mindlog_e2e",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    fun get(handle: String): String? = prefs.getString(key(handle), null)

    fun put(handle: String, privJwk: String) {
        prefs.edit().putString(key(handle), privJwk).apply()
    }

    fun remove(handle: String) {
        prefs.edit().remove(key(handle)).apply()
    }

    /**
     * Passphrase auto-générée du coffre, stockée localement (chiffrée au repos par
     * l'Android Keystore) lorsque l'utilisateur choisit la protection biométrique.
     * Évite de mémoriser une passphrase tout en gardant la clé dans le coffre
     * serveur. NB : locale à l'appareil — non récupérable sur un autre téléphone
     * (pour ça l'utilisateur définit une passphrase qu'il connaît).
     */
    fun getVaultPass(handle: String): String? = prefs.getString(vaultKey(handle), null)

    fun putVaultPass(handle: String, pass: String) {
        prefs.edit().putString(vaultKey(handle), pass).apply()
    }

    private fun key(handle: String) = "e2e.${handle.removePrefix("@")}"
    private fun vaultKey(handle: String) = "vaultpass.${handle.removePrefix("@")}"
}
