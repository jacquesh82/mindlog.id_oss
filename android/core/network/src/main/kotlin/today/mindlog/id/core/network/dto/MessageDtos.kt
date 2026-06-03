package today.mindlog.id.core.network.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Réaction agrégée sur un message (src/messages.ts). */
@Serializable
data class ReactionDto(val emoji: String, val count: Int = 0, val mine: Boolean = false)

/** Blob de message chiffré + statuts (src/messages.ts MessageWithReactions). */
@Serializable
data class MessageDto(
    val id: Long,
    @SerialName("sender_id") val senderId: Long,
    val iv: String = "",
    val ciphertext: String = "",
    @SerialName("sender_pub") val senderPub: String = "",
    @SerialName("recipient_pub") val recipientPub: String = "",
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("expires_at") val expiresAt: String = "",
    val delivered: Int = 0,
    val read: Int = 0,
    @SerialName("read_once") val readOnce: Int = 0,
    val reactions: List<ReactionDto> = emptyList(),
    // Multi-appareils : message logique fan-out + device-id de l'émetteur (pour keyer
    // la session ratchet au déchiffrement). Null pour le legacy mono-session.
    @SerialName("client_msg_id") val clientMsgId: String? = null,
    @SerialName("sender_device_id") val senderDeviceId: String? = null,
)

/** Réponse de GET /api/messages/:handle. */
@Serializable
data class MessagesResponseDto(
    val ttlHours: Int = 24,
    /** Mon identity_id (pour distinguer mes messages). */
    val me: Long = 0,
    /** Clé publique courante du pair (repli si une JWK figée manque). */
    val peerPubkey: String = "",
    val messages: List<MessageDto> = emptyList(),
)

@Serializable
data class SendMessageBody(
    val iv: String? = null,
    val ciphertext: String? = null,
    val senderPub: String = "",
    val recipientPub: String = "",
    val ttl: Int? = null, // minuterie de disparition (secondes), bornée serveur
    val readOnce: Boolean? = null, // message à lecture unique
    // Fan-out multi-appareils : un message LOGIQUE (clientMsgId) + une enveloppe par appareil.
    val clientMsgId: String? = null,
    val envelopes: List<EnvelopeBody>? = null,
)

@Serializable
data class EnvelopeBody(val recipientDeviceId: String, val iv: String, val ciphertext: String)

@Serializable
data class AckBody(val read: Boolean)

@Serializable
data class ReactBody(val messageId: Long, val emoji: String)

@Serializable
data class AttachmentDto(val id: Long = 0, val expiresAt: String = "")

/* ----------------------- Signalisation d'appel (WebRTC) ------------------ */

@Serializable
data class SignalBody(val iv: String, val ciphertext: String)
