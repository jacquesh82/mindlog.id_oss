package today.mindlog.id.core.data

import kotlinx.coroutines.flow.StateFlow
import today.mindlog.id.core.crypto.E2eCrypto
import today.mindlog.id.core.crypto.EncBlob
import today.mindlog.id.core.datastore.SessionStore
import today.mindlog.id.core.network.MindlogApi
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Façade publique E2E.
 * L'API publique est inchangée — tous les appelants (ChatRepository, ChatViewModel,
 * SettingsViewModel, DevicesViewModel…) continuent de fonctionner sans modification.
 *
 * La logique est déléguée aux managers spécialisés :
 *  - [KeyManager]           : clé locale + coffre + cache ratchet
 *  - [MultiDeviceManager]   : X3DH fan-out multi-appareils
 *  - [RatchetManager]       : Double Ratchet v2 pair-à-pair
 *  - [VerificationManager]  : numéro de sécurité anti-MITM
 */
@Singleton
class E2eRepository @Inject constructor(
    private val keyState: E2eKeyState,
    private val keyManager: KeyManager,
    private val mdManager: MultiDeviceManager,
    private val ratchetManager: RatchetManager,
    private val verificationManager: VerificationManager,
    private val crypto: E2eCrypto,
    private val api: MindlogApi,
    private val sessionStore: SessionStore,
) {
    // ----------------------------- StateFlows --------------------------------

    val needsRestore: StateFlow<Boolean> = keyState.needsRestore
    val needsBackup: StateFlow<Boolean> = keyState.needsBackup

    // ----------------------------- Key lifecycle -----------------------------

    suspend fun ensure(handle: String): Boolean = keyManager.ensure(handle)

    fun myPub(): String? = keyState.pubStr

    val isReady: Boolean get() = keyState.isReady

    // ----------------------------- Static E2E (v1) ---------------------------

    fun encrypt(peerPub: String, text: String): EncBlob? =
        keyState.pair?.let { crypto.encrypt(it, peerPub, text) }

    fun decrypt(peerPub: String, iv: String, ciphertext: String): String? =
        keyState.pair?.let { crypto.decrypt(it, peerPub, iv, ciphertext) }

    // ----------------------------- Vault / coffre ----------------------------

    suspend fun saveVaultPassphrase(passphrase: String): Boolean = keyManager.saveVaultPassphrase(passphrase)
    suspend fun saveVaultPin(pin: String): Boolean = keyManager.saveVaultPin(pin)
    suspend fun saveVaultBiometric(): Boolean = keyManager.saveVaultBiometric()
    fun hasBiometricVaultPass(): Boolean = keyManager.hasBiometricVaultPass()
    suspend fun restoreWithPassphrase(passphrase: String): Boolean = keyManager.restoreWithPassphrase(passphrase)
    suspend fun restoreWithPin(pin: String): Boolean = keyManager.restoreWithPin(pin)

    // ----------------------------- Ratchet cache -----------------------------

    suspend fun pushCache(): Boolean = keyManager.pushCache()
    suspend fun pullCache(): Boolean = keyManager.pullCache()
    suspend fun pullCacheRetry(): Boolean = keyManager.pullCacheRetry()

    fun rememberSent(me: String, iv: String, text: String) = keyManager.rememberSent(me, iv, text)
    fun recallSent(me: String, iv: String): String? = keyManager.recallSent(me, iv)

    // ----------------------------- Prekeys / multi-device --------------------

    suspend fun ensurePrekeys(handle: String) = mdManager.ensurePrekeys(handle)
    suspend fun mdRegisterDevice(handle: String) = mdManager.mdRegisterDevice(handle)
    suspend fun mdFanoutEncrypt(me: String, peerHandle: String, text: String): Fanout? =
        mdManager.mdFanoutEncrypt(me, peerHandle, text)
    suspend fun mdDecryptEnvelope(me: String, senderDeviceId: String?, iv: String, packed: String): String? =
        mdManager.mdDecryptEnvelope(me, senderDeviceId, iv, packed)
    fun mdSelfDecrypt(iv: String, ciphertext: String): String? = mdManager.mdSelfDecrypt(iv, ciphertext)
    fun mdRecallSent(me: String, cmid: String): String? = mdManager.mdRecallSent(me, cmid)

    // ----------------------------- Double Ratchet (v2) -----------------------

    suspend fun ratchetEncrypt(me: String, peerHandle: String, peerPub: String, text: String): V2? =
        ratchetManager.ratchetEncrypt(me, peerHandle, peerPub, text)
    suspend fun ratchetDecrypt(me: String, peerHandle: String, iv: String, packed: String): String? =
        ratchetManager.ratchetDecrypt(me, peerHandle, iv, packed)
    fun isV2(ciphertext: String): Boolean = ratchetManager.isV2(ciphertext)

    // ----------------------------- Verification ------------------------------

    fun safetyNumber(peerHandle: String, peerPub: String): String? =
        verificationManager.safetyNumber(peerHandle, peerPub)
    suspend fun verifyStatus(peerHandle: String, peerPub: String): VerifyState =
        verificationManager.verifyStatus(peerHandle, peerPub)
    suspend fun markVerified(peerHandle: String, peerPub: String): Boolean =
        verificationManager.markVerified(peerHandle, peerPub)
    suspend fun clearVerified(peerHandle: String) = verificationManager.clearVerified(peerHandle)

    // ----------------------------- Devices -----------------------------------

    suspend fun listDevices(): List<DeviceInfo> {
        val myDeviceId = sessionStore.deviceId()
        return runCatching {
            api.listDevices().devices.map { d ->
                DeviceInfo(d.id, d.deviceId, d.name, d.approved, d.deviceId == myDeviceId)
            }
        }.getOrDefault(emptyList())
    }

    suspend fun approveDevice(pk: Long): Boolean = runCatching { api.approveDevice(pk).ok }.getOrDefault(false)
    suspend fun revokeDevice(pk: Long): Boolean = runCatching { api.revokeDevice(pk).ok }.getOrDefault(false)

    // ----------------------------- Backward compat ---------------------------

    /** Alias conservés pour les callers qui utilisaient E2eRepository.VerifyState. */
    @Suppress("unused")
    object LegacyVerifyState {
        val NONE = VerifyState.NONE
        val VERIFIED = VerifyState.VERIFIED
        val CHANGED = VerifyState.CHANGED
    }
}
