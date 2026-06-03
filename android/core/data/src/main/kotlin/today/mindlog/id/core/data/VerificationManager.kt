package today.mindlog.id.core.data

import today.mindlog.id.core.crypto.E2eCrypto
import today.mindlog.id.core.network.MindlogApi
import today.mindlog.id.core.network.dto.VerifyBody
import javax.inject.Inject
import javax.inject.Singleton

/** Vérification d'identité anti-MITM (numéro de sécurité). */
@Singleton
class VerificationManager @Inject constructor(
    private val state: E2eKeyState,
    private val crypto: E2eCrypto,
    private val api: MindlogApi,
) {
    /** Numéro de sécurité (60 chiffres) avec un contact, ou null si clés indispo. */
    fun safetyNumber(peerHandle: String, peerPub: String): String? {
        val h = state.handle ?: return null
        val mine = state.pubStr ?: return null
        if (peerPub.isBlank()) return null
        return crypto.safetyNumber(h, mine, peerHandle, peerPub)
    }

    /** Statut de vérification : aucun, vérifié (à jour), ou clé changée (re-vérifier). */
    suspend fun verifyStatus(peerHandle: String, peerPub: String): VerifyState {
        val serverHash = runCatching { api.getVerify(peerHandle).safety }.getOrNull() ?: return VerifyState.NONE
        val sn = safetyNumber(peerHandle, peerPub) ?: return VerifyState.NONE
        return if (crypto.sha256Hex(sn) == serverHash) VerifyState.VERIFIED else VerifyState.CHANGED
    }

    /** Marque un contact comme vérifié (enregistre le hash du numéro courant). */
    suspend fun markVerified(peerHandle: String, peerPub: String): Boolean {
        val sn = safetyNumber(peerHandle, peerPub) ?: return false
        return runCatching { api.putVerify(peerHandle, VerifyBody(crypto.sha256Hex(sn))) }.isSuccess
    }

    suspend fun clearVerified(peerHandle: String) {
        runCatching { api.deleteVerify(peerHandle) }
    }
}
