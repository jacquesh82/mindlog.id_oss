package today.mindlog.id.core.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import today.mindlog.id.core.crypto.E2eCrypto
import today.mindlog.id.core.crypto.E2eKeyStore
import today.mindlog.id.core.crypto.RatchetStore
import today.mindlog.id.core.network.MindlogApi
import today.mindlog.id.core.network.dto.PubkeyBody
import today.mindlog.id.core.network.dto.RatchetCacheBody
import today.mindlog.id.core.network.dto.VaultBody
import java.security.KeyPair
import java.security.interfaces.ECPrivateKey
import javax.crypto.SecretKey
import javax.crypto.spec.SecretKeySpec
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Gestion de la clé locale et du coffre serveur.
 * Responsabilités : chargement/génération de la clé, sauvegarde/restauration du coffre,
 * cache ratchet multi-appareils (push/pull).
 */
@Singleton
class KeyManager @Inject constructor(
    private val state: E2eKeyState,
    private val crypto: E2eCrypto,
    private val keyStore: E2eKeyStore,
    private val api: MindlogApi,
    private val ratchetStore: RatchetStore,
) {
    private val json = Json { ignoreUnknownKeys = true }

    @Volatile private var lastPullAt = 0L

    /** Prépare la clé pour [handle]. Idempotent. Retourne true si prêt. */
    suspend fun ensure(handle: String): Boolean {
        if (state.pair != null && state.handle == handle) return true
        state.handle = handle
        state.setNeedsRestore(false)

        keyStore.get(handle)?.let { local ->
            runCatching { crypto.keyPairFromPrivateJwk(local) }.getOrNull()?.let { kp ->
                activate(kp)
                publishPubkey()
                state.setNeedsBackup(!hasVault())
                return true
            }
        }
        if (hasVault()) {
            state.setNeedsRestore(true)
            return false
        }
        val kp = crypto.generateKeyPair()
        keyStore.put(handle, crypto.privateJwk(kp))
        activate(kp)
        publishPubkey()
        state.setNeedsBackup(true)
        return true
    }

    suspend fun saveVaultPassphrase(passphrase: String): Boolean = saveVaultSecret(passphrase, "pass", 8)
    suspend fun saveVaultPin(pin: String): Boolean = saveVaultSecret(pin, "pin", 4)

    suspend fun saveVaultBiometric(): Boolean {
        val h = state.handle ?: return false
        val pass = keyStore.getVaultPass(h) ?: randomPassphrase()
        val ok = saveVaultPassphrase(pass)
        if (ok) keyStore.putVaultPass(h, pass)
        return ok
    }

    fun hasBiometricVaultPass(): Boolean = state.handle?.let { keyStore.getVaultPass(it) != null } ?: false

    suspend fun restoreWithPassphrase(passphrase: String): Boolean = restoreWithSecret(passphrase, "pass")
    suspend fun restoreWithPin(pin: String): Boolean = restoreWithSecret(pin, "pin")

    suspend fun pushCache(): Boolean {
        val key = ikCacheKey() ?: return false
        val me = state.handle?.removePrefix("@") ?: return false
        val tsKey = RatchetStore.cachePushKey(me)
        val lastPush = ratchetStore.get(tsKey)?.toLongOrNull() ?: 0L
        if (System.currentTimeMillis() - lastPush < 60_000L) return true
        runCatching { pullCache() }
        val entries = ratchetStore.allEntries()
            .filterKeys { it.startsWith("rcv:$me") || it.startsWith("sent:$me") }
        if (entries.isEmpty()) return true
        val payload = buildJsonObject { entries.forEach { (k, v) -> put(k, JsonPrimitive(v)) } }
        val payloadStr = json.encodeToString(JsonObject.serializer(), payload)
        if (payloadStr.length > 400_000) return false
        val blob = crypto.gcmEncrypt(key, payloadStr)
        val wrapper = buildJsonObject {
            put("v", JsonPrimitive(1)); put("iv", JsonPrimitive(blob.iv)); put("ct", JsonPrimitive(blob.ciphertext))
        }
        val ok = runCatching {
            api.putRatchetCache(RatchetCacheBody(json.encodeToString(JsonObject.serializer(), wrapper)))
        }.isSuccess
        if (ok) ratchetStore.put(tsKey, System.currentTimeMillis().toString())
        return ok
    }

    suspend fun pullCache(): Boolean {
        val key = ikCacheKey() ?: return false
        val raw = runCatching { api.getRatchetCache().cache }.getOrNull() ?: return true
        if (raw.isNullOrBlank()) return true
        val o = runCatching { json.parseToJsonElement(raw) as JsonObject }.getOrNull() ?: return false
        val decrypted = runCatching { crypto.gcmDecrypt(key, o.str("iv"), o.str("ct")) }.getOrNull() ?: return false
        val entries = runCatching { json.parseToJsonElement(decrypted) as JsonObject }.getOrNull() ?: return false
        entries.forEach { (k, v) ->
            val value = runCatching { v.jsonPrimitive.content }.getOrNull() ?: return@forEach
            if (ratchetStore.get(k) == null) ratchetStore.put(k, value)
        }
        return true
    }

    suspend fun pullCacheRetry(): Boolean {
        if (System.currentTimeMillis() - lastPullAt < 8_000L) return false
        lastPullAt = System.currentTimeMillis()
        return runCatching { pullCache() }.getOrDefault(false)
    }

    fun rememberSent(me: String, iv: String, text: String) {
        val obj = buildJsonObject {
            put("text", JsonPrimitive(text))
            put("exp", JsonPrimitive(System.currentTimeMillis() + 25L * 3600 * 1000))
        }
        ratchetStore.put(RatchetStore.sentKey(me, iv), json.encodeToString(JsonObject.serializer(), obj))
    }

    fun recallSent(me: String, iv: String): String? {
        val raw = ratchetStore.get(RatchetStore.sentKey(me, iv)) ?: return null
        val o = runCatching { json.parseToJsonElement(raw).jsonObject }.getOrNull() ?: return null
        val exp = o["exp"]?.jsonPrimitive?.content?.toLongOrNull() ?: 0
        if (exp < System.currentTimeMillis()) { ratchetStore.remove(RatchetStore.sentKey(me, iv)); return null }
        return o["text"]?.jsonPrimitive?.content
    }

    // --------------------------------- Private ----------------------------------

    private suspend fun hasVault(): Boolean =
        runCatching { api.getVault().vault }.getOrNull()?.isNotBlank() == true

    private suspend fun saveVaultSecret(secret: String, slot: String, minLen: Int): Boolean {
        val h = state.handle ?: return false
        if (secret.length < minLen) return false
        val privJwk = keyStore.get(h) ?: return false
        val salt = crypto.randomSalt()
        val blob = crypto.gcmEncrypt(crypto.passphraseKey(secret, salt), privJwk)
        val existing = runCatching { api.getVault().vault }.getOrNull()
            ?.let { runCatching { json.parseToJsonElement(it) as JsonObject }.getOrNull() }
        val vault = buildJsonObject {
            put("v", JsonPrimitive(1))
            existing?.get("prf")?.let { put("prf", it) }
            if (slot != "pass") existing?.get("pass")?.let { put("pass", it) }
            if (slot != "pin") existing?.get("pin")?.let { put("pin", it) }
            put(slot, buildJsonObject {
                put("salt", JsonPrimitive(b64(salt)))
                put("iv", JsonPrimitive(blob.iv))
                put("ct", JsonPrimitive(blob.ciphertext))
            })
        }
        api.putVault(VaultBody(json.encodeToString(JsonObject.serializer(), vault)))
        state.setNeedsBackup(false)
        return true
    }

    private suspend fun restoreWithSecret(secret: String, slot: String): Boolean {
        val h = state.handle ?: return false
        val raw = runCatching { api.getVault().vault }.getOrNull() ?: return false
        val vault = runCatching { json.parseToJsonElement(raw) as JsonObject }.getOrNull() ?: return false
        val env = vault[slot] as? JsonObject ?: return false
        val salt = b64d(env.str("salt"))
        val privJwk = runCatching {
            crypto.gcmDecrypt(crypto.passphraseKey(secret, salt), env.str("iv"), env.str("ct"))
        }.getOrNull() ?: return false
        val kp = runCatching { crypto.keyPairFromPrivateJwk(privJwk) }.getOrNull() ?: return false
        keyStore.put(h, privJwk)
        activate(kp)
        state.setNeedsRestore(false)
        state.setNeedsBackup(false)
        publishPubkey()
        pullCache()
        return true
    }

    private fun activate(kp: KeyPair) {
        state.pair = kp
        state.pubStr = crypto.publicJwk(kp)
        state.privJwk = crypto.privateJwk(kp)
    }

    private suspend fun publishPubkey() {
        state.pubStr?.let { runCatching { api.putPubkey(PubkeyBody(it)) } }
    }

    private fun randomPassphrase(): String {
        val bytes = ByteArray(24)
        java.security.SecureRandom().nextBytes(bytes)
        return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    private fun ikCacheKey(): SecretKey? {
        val ec = (state.pair?.private as? ECPrivateKey) ?: return null
        val raw = ec.s.toByteArray().let { b ->
            when {
                b.size == 32 -> b
                b.size == 33 && b[0] == 0.toByte() -> b.copyOfRange(1, 33)
                b.size < 32 -> ByteArray(32 - b.size) + b
                else -> b.copyOfRange(b.size - 32, b.size)
            }
        }
        val keyBytes = crypto.hkdf(raw, "mindlog-e2e-cache-v1".toByteArray(), "ratchet-cache".toByteArray(), 32)
        return SecretKeySpec(keyBytes, "AES")
    }
}
