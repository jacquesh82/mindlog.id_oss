package today.mindlog.id.core.network.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/* ----------------- Invitations de contact (sans annuaire) --------------- */

@Serializable
data class InviteDto(val token: String = "")

@Serializable
data class InvitePreviewDto(
    val handle: String = "",
    @SerialName("display_name") val displayName: String = "",
    @SerialName("has_photo") val hasPhoto: Boolean = false,
)

@Serializable
data class InviteAcceptDto(val handle: String = "")
