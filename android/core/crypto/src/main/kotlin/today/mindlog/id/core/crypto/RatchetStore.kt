package today.mindlog.id.core.crypto

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Persistance chiffrée (Android Keystore) de l'état Double Ratchet : états de
 * session par conversation, prekeys privées locales, et clair de mes propres
 * envois (la forward secrecy détruit la clé message → je ne peux plus les
 * redéchiffrer). Per-appareil, JAMAIS synchronisé (≠ coffre de la clé d'identité).
 * Miroir de la couche IndexedDB du web.
 */
@Singleton
class RatchetStore @Inject constructor(
    @ApplicationContext context: Context,
) {
    private val prefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "mindlog_ratchet",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    fun get(key: String): String? = prefs.getString(key, null)
    fun put(key: String, value: String) = prefs.edit().putString(key, value).apply()
    fun remove(key: String) = prefs.edit().remove(key).apply()

    /** Toutes les entrées du store (pour sérialisation cache serveur). */
    @Suppress("UNCHECKED_CAST")
    fun allEntries(): Map<String, String> =
        (prefs.all as Map<String, Any?>)
            .mapNotNull { (k, v) -> if (v is String) k to v else null }
            .toMap()

    companion object {
        private fun h(handle: String) = handle.removePrefix("@")
        fun stateKey(me: String, peer: String) = "ratchet:${h(me)}:${h(peer)}"
        /** Session « inbound » archivée (multi-appareils) : déchiffre la chaîne X3DH
         *  PRÉ-ADOPTION du pair perdant le tiebreak, sans toucher à ma session d'envoi.
         *  Stocke un wrapper JSON {st, bootEk, peerIk}. */
        fun inboundKey(me: String, peer: String) = "ratchet-inb:${h(me)}:${h(peer)}"
        /** Empreinte d'identité du pair liée à la session (détection de session périmée). */
        fun peerIkKey(me: String, peer: String) = "peerik:${h(me)}:${h(peer)}"
        /** Empreinte de l'éphémère X3DH qui a établi la session : détecte un re-handshake
         *  du pair (reset ratchet à identité inchangée) sans boucler sur les renvois. */
        fun bootEkKey(me: String, peer: String) = "bootek:${h(me)}:${h(peer)}"
        fun prekeyKey(me: String) = "prekeys:${h(me)}"
        fun sentKey(me: String, iv: String) = "sent:${h(me)}:$iv"
        fun recvKey(me: String, peer: String, iv: String) = "rcv:${h(me)}:${h(peer)}:$iv"
        fun timerKey(me: String, peer: String) = "timer:${h(me)}:${h(peer)}"
        fun groupKey(me: String, gid: String) = "grp:${h(me)}:$gid"
        fun cachePushKey(me: String) = "cache_push:${h(me)}"
    }
}
