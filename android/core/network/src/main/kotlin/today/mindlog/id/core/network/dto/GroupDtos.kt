package today.mindlog.id.core.network.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class GroupMemberDto(val handle: String = "", val role: String = "member")

/** Groupe (métadonnée ; le contenu reste E2E). src/store.ts GroupInfo. */
@Serializable
data class GroupDto(
    val id: String = "",
    val name: String = "",
    val members: List<GroupMemberDto> = emptyList(),
    /** Mon rôle dans ce groupe (admin|member). */
    val role: String = "member",
)

@Serializable
data class GroupsResponseDto(val groups: List<GroupDto> = emptyList())

/** Message de groupe : comme MessageDto + handle de l'expéditeur (src/messages.ts). */
@Serializable
data class GroupMessageDto(
    val id: Long = 0,
    @SerialName("sender_id") val senderId: Long = 0,
    @SerialName("sender_handle") val senderHandle: String = "",
    val iv: String = "",
    val ciphertext: String = "",
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("expires_at") val expiresAt: String = "",
    @SerialName("read_once") val readOnce: Int = 0,
    val reactions: List<ReactionDto> = emptyList(),
)

@Serializable
data class GroupMessagesResponseDto(
    val me: Long = 0,
    val ttlHours: Int = 24,
    val messages: List<GroupMessageDto> = emptyList(),
)

@Serializable
data class CreateGroupBody(val name: String, val members: List<String> = emptyList())

/** Envoi groupe : ttl (secondes) + readOnce alignés sur public/crypto/groups.js. */
@Serializable
data class GroupMessageBody(
    val iv: String,
    val ciphertext: String,
    val ttl: Int? = null,
    val readOnce: Boolean? = null,
)

@Serializable
data class GroupReactBody(val emoji: String)

@Serializable
data class AddMemberBody(val handle: String)
