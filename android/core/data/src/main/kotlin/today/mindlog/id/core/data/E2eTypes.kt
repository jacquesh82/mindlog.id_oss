package today.mindlog.id.core.data

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import today.mindlog.id.core.network.dto.EnvelopeBody
import java.util.Base64

/** Appareil enrôlé du compte (multi-appareils). Exposé à l'UI (feature:chat). */
data class DeviceInfo(val id: Long, val deviceId: String, val name: String, val approved: Boolean, val isMe: Boolean)

/** Résultat d'un chiffrement v2 prêt pour POST (ciphertext empaqueté). */
data class V2(val iv: String, val ciphertext: String)

/** Résultat d'un chiffrement fan-out multi-appareils. */
data class Fanout(val clientMsgId: String, val envelopes: List<EnvelopeBody>)

/** Statut de vérification d'identité anti-MITM. */
enum class VerifyState { NONE, VERIFIED, CHANGED }

// ----------- Extensions communes (copiées dans chaque manager, 3 lignes) -----------

internal fun JsonObject.str(k: String) = (this[k] as JsonPrimitive).content
internal fun b64(b: ByteArray): String = Base64.getEncoder().encodeToString(b)
internal fun b64d(s: String): ByteArray = Base64.getDecoder().decode(s)
