package today.mindlog.id.core.data

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import retrofit2.HttpException
import today.mindlog.id.core.database.CardDao
import today.mindlog.id.core.database.RelationDao
import today.mindlog.id.core.database.RequestDao
import today.mindlog.id.core.datastore.SessionStore
import today.mindlog.id.core.datastore.ServerStore
import today.mindlog.id.core.network.MindlogApi
import today.mindlog.id.core.network.dto.PasskeyAuthBeginBody
import today.mindlog.id.core.network.dto.PasskeyAuthFinishBody
import today.mindlog.id.core.network.dto.RedeemPinBody
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

/** État d'authentification observable par l'app pour router onboarding ↔ contenu. */
sealed interface AuthState {
    data object Unknown : AuthState
    data object LoggedOut : AuthState
    data class LoggedIn(val handle: String) : AuthState
}

@Singleton
class AuthRepository @Inject constructor(
    private val api: MindlogApi,
    private val sessionStore: SessionStore,
    private val cardDao: CardDao,
    private val relationDao: RelationDao,
    private val requestDao: RequestDao,
    private val json: Json,
    private val serverStore: ServerStore,
) {
    val authState: Flow<AuthState> = sessionStore.session.map { session ->
        if (session == null) AuthState.LoggedOut else AuthState.LoggedIn(session.handle)
    }

    /**
     * Valide une clé d'accès collée/scannée puis la persiste. On stocke la clé
     * d'abord (l'intercepteur la lit ensuite) et on tente GET /api/session ;
     * en cas d'échec on nettoie. Accepte aussi un lien complet /k/{clé}.
     */
    suspend fun signInWithKey(raw: String): Result<String> {
        val key = extractKey(raw)
        if (key.isBlank()) return Result.failure(IllegalArgumentException("Clé vide"))
        // Stockage provisoire avec un handle inconnu pour activer l'intercepteur.
        sessionStore.save(accessKey = key, handle = "")
        return runCatching {
            val session = api.session()
            val handle = session.handle
            if (!session.authenticated || handle.isNullOrBlank()) {
                error("Clé invalide")
            }
            sessionStore.save(accessKey = key, handle = handle)
            handle
        }.onFailure { sessionStore.clear() }
    }

    /**
     * Échange un code PIN d'appairage (généré sur le web) contre la clé d'accès,
     * puis se connecte comme avec une clé. Le PIN est à 6 chiffres, usage unique.
     */
    suspend fun signInWithPin(rawPin: String): Result<String> {
        val pin = rawPin.filter { it.isDigit() }
        if (pin.length != 6) return Result.failure(IllegalArgumentException("Code à 6 chiffres requis"))
        return runCatching {
            val res = api.redeemPin(RedeemPinBody(pin))
            sessionStore.save(accessKey = res.accessKey, handle = res.handle)
            res.handle
        }.recoverCatching { e ->
            sessionStore.clear()
            throw IllegalStateException(mapPinError(e), e)
        }
    }

    private fun mapPinError(e: Throwable): String {
        val code = (e as? HttpException)?.code()
        return when (code) {
            404, 400 -> "Code PIN invalide ou expiré"
            429 -> "Trop de tentatives, réessayez plus tard"
            else -> "Connexion impossible"
        }
    }

    /** Vide la clé (bascule l'UI vers l'onboarding) puis purge le cache local. */
    suspend fun signOut() {
        sessionStore.clear()
        cardDao.clearAll()
        relationDao.clearAll()
        requestDao.clearAll()
    }

    /**
     * Régénère la clé d'accès : l'ancienne clé et toutes les sessions sont invalidées
     * côté serveur. On persiste IMMÉDIATEMENT la nouvelle clé (l'app s'authentifie par
     * en-tête `x-access-key`, pas par cookie) sinon la requête suivante échouerait.
     * Renvoie la nouvelle clé pour que l'utilisateur puisse la sauvegarder.
     */
    suspend fun rotateAccessKey(): Result<String> = runCatching {
        val handle = sessionStore.session.value?.handle ?: error("Non connecté")
        val res = api.rotateAccessKey()
        if (res.accessKey.isBlank()) error("Rotation impossible")
        sessionStore.save(accessKey = res.accessKey, handle = handle)
        res.accessKey
    }

    /** Supprime définitivement le compte côté serveur puis purge l'état local. */
    suspend fun deleteAccount(): Result<Unit> = runCatching {
        api.deleteAccount()
        signOut()
    }

    /* ----------------------------- Accès & sessions ------------------------ */

    /** Handle du compte connecté (depuis le stockage chiffré local). */
    fun currentHandle(): String? = sessionStore.session.value?.handle

    /** Clé d'accès courante (pour affichage/copie dans Options › Accès). */
    fun currentKey(): String? = sessionStore.accessKey()

    /** URL publique partageable de la page (baseUrl + @handle). */
    fun publicUrl(): String? = currentHandle()?.let { serverStore.baseUrl() + "@" + it }

    /** Sessions actives du compte (web/cookie). */
    suspend fun listSessions(): Result<List<SessionInfo>> = runCatching {
        api.sessions().sessions.map {
            SessionInfo(id = it.id, userAgent = it.userAgent, lastSeen = it.lastSeen, current = it.current)
        }
    }

    /** Révoque une session par identifiant. */
    suspend fun revokeSession(id: String): Result<Unit> = runCatching { api.revokeSession(id); Unit }

    /** Déconnecte toutes les autres sessions (la clé d'accès de cet appareil reste valide). */
    suspend fun logoutOtherSessions(): Result<Unit> = runCatching { api.logoutAllSessions(); Unit }

    /** Génère un code PIN à usage unique pour appairer un autre appareil. */
    suspend fun generateLinkPin(): Result<String> = runCatching { api.generateLinkPin().pin }

    /* ----------------------------- Passkey (WebAuthn) ---------------------- */

    /**
     * Démarre l'authentification passkey : renvoie les options WebAuthn en JSON,
     * à passer à Credential Manager (côté UI, qui a le contexte Activity).
     */
    suspend fun passkeyBeginAuth(handle: String): Result<String> = runCatching {
        val h = handle.trim().removePrefix("@")
        if (h.isBlank()) error("Identifiant requis")
        api.passkeyAuthBegin(PasskeyAuthBeginBody(h)).toString()
    }

    /**
     * Termine l'auth passkey avec l'assertion produite par Credential Manager
     * (`authenticationResponseJson`), puis persiste la clé d'accès renvoyée par le
     * serveur (Android s'authentifie par clé, pas par cookie). Renvoie le handle.
     */
    suspend fun passkeyFinishAuth(handle: String, responseJson: String): Result<String> = runCatching {
        val h = handle.trim().removePrefix("@")
        val response = json.parseToJsonElement(responseJson)
        val res = api.passkeyAuthFinish(PasskeyAuthFinishBody(h, response))
        if (res.accessKey.isBlank()) error("Réponse serveur invalide")
        val handleOut = res.handle.ifBlank { h }
        sessionStore.save(accessKey = res.accessKey, handle = handleOut)
        handleOut
    }

    /** Extrait la clé d'un lien `https://.../k/<clé>` ou renvoie l'entrée brute. */
    private fun extractKey(raw: String): String {
        val trimmed = raw.trim()
        val marker = "/k/"
        val idx = trimmed.indexOf(marker)
        return if (idx >= 0) {
            trimmed.substring(idx + marker.length).substringBefore('?').substringBefore('#').trim()
        } else {
            trimmed
        }
    }
}

/** Session active affichée dans Options › Accès. */
data class SessionInfo(
    val id: String,
    val userAgent: String,
    val lastSeen: String,
    val current: Boolean,
)
