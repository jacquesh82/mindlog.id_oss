package today.mindlog.id.core.network.dto

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/** Réponse de GET /api/session — vérification rapide d'authentification. */
@Serializable
data class SessionDto(
    val authenticated: Boolean = false,
    val handle: String? = null,
    val accessKey: String? = null,
    val displayName: String? = null,
    val hasPhoto: Boolean = false,
)

/** Corps de POST /api/auth/redeem-pin — échange un code PIN contre la clé d'accès. */
@Serializable
data class RedeemPinBody(
    val pin: String,
)

/** Réponse de POST /api/auth/redeem-pin. */
@Serializable
data class RedeemPinResponse(
    val accessKey: String,
    val handle: String,
)

/** Une session active du compte (GET /api/sessions). L'`id` est le hash du token. */
@Serializable
data class ActiveSessionDto(
    val id: String = "",
    val createdAt: String = "",
    val lastSeen: String = "",
    val userAgent: String = "",
    val current: Boolean = false,
)

/** Réponse de GET /api/sessions. */
@Serializable
data class ActiveSessionsDto(val sessions: List<ActiveSessionDto> = emptyList())

/** Réponse de POST /api/auth/pin : code PIN à usage unique pour lier un appareil. */
@Serializable
data class PinDto(val pin: String = "", val expiresAt: String = "")

/** Réponse de POST /api/access-key/rotate : nouvelle clé d'accès. */
@Serializable
data class RotateKeyDto(val accessKey: String = "")

/** Corps de POST /api/passkeys/auth/begin. */
@Serializable
data class PasskeyAuthBeginBody(val handle: String)

/** Corps de POST /api/passkeys/auth/finish (response = authenticationResponseJSON). */
@Serializable
data class PasskeyAuthFinishBody(val handle: String, val response: JsonElement)

/** Réponse de POST /api/passkeys/auth/finish : handle + clé d'accès (pour clients natifs). */
@Serializable
data class PasskeyAuthFinishResponse(val handle: String = "", val accessKey: String = "")
