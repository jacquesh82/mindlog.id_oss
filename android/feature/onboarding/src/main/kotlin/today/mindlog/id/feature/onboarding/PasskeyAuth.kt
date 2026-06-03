package today.mindlog.id.feature.onboarding

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.GetCredentialException

/**
 * Lance Credential Manager pour signer le défi WebAuthn [requestJson] (options
 * d'authentification renvoyées par `/api/passkeys/auth/begin`) et renvoie
 * l'`authenticationResponseJson` à transmettre à `/api/passkeys/auth/finish`.
 *
 * Renvoie `null` si l'utilisateur annule ou si aucune passkey n'est disponible
 * (pas de fournisseur, domaine non associé via assetlinks, etc.). Le [context]
 * doit être une Activity (UI de sélection de passkey).
 */
internal suspend fun getPasskeyAssertion(context: Context, requestJson: String): String? {
    val manager = CredentialManager.create(context)
    val request = GetCredentialRequest(listOf(GetPublicKeyCredentialOption(requestJson)))
    return try {
        val result = manager.getCredential(context, request)
        (result.credential as? PublicKeyCredential)?.authenticationResponseJson
    } catch (e: GetCredentialException) {
        null
    }
}
