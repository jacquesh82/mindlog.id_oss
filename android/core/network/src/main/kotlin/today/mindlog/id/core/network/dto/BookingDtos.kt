package today.mindlog.id.core.network.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Demande de RDV reçue, renvoyée par /api/me (src/store.ts BookingRequest). */
@Serializable
data class RequestDto(
    val id: Long,
    val day: String? = null,
    val time: String? = null,
    val name: String = "",
    val email: String = "",
    val message: String = "",
    val status: String = "pending",
    @SerialName("created_at") val createdAt: String = "",
)

/** Corps de création d'une demande de RDV vers quelqu'un. */
@Serializable
data class CreateRequestBody(
    val name: String,
    val email: String? = null,
    val message: String? = null,
    val day: String? = null,
    val time: String? = null,
)

@Serializable
data class RequestStatusBody(val status: String)
