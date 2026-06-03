package today.mindlog.id.core.network.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Relation renvoyée par /api/me (src/store.ts RelationSummary). */
@Serializable
data class RelationDto(
    val handle: String,
    @SerialName("display_name") val displayName: String = "",
    @SerialName("has_photo") val hasPhoto: Boolean = false,
    val type: String? = null,
    val via: String? = null,
    val mutual: Boolean = false,
)

@Serializable
data class AddRelationBody(
    val handle: String,
    val type: String? = null,
)

/** Notification in-app (src/schema.ts notifications). */
@Serializable
data class NotificationDto(
    val id: Long,
    val type: String = "",
    val text: String = "",
    val link: String? = null,
    val read: Int = 0,
    @SerialName("created_at") val createdAt: String = "",
)

/** Métadonnée d'une conversation issue de /api/me (blobs non déchiffrés ici). */
@Serializable
data class ConversationDto(
    val handle: String,
    @SerialName("display_name") val displayName: String = "",
    @SerialName("has_photo") val hasPhoto: Boolean = false,
    val pubkey: String = "",
    val messages: List<ConvMessageMetaDto> = emptyList(),
)

/** Métadonnée minimale d'un message (pour aperçu de liste : date, lu, à moi). */
@Serializable
data class ConvMessageMetaDto(
    val id: Long = 0,
    @SerialName("created_at") val createdAt: String = "",
    val read: Int = 0,
    val mine: Boolean = false,
)
