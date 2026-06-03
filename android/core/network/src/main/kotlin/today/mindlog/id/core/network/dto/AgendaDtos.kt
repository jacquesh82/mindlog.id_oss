package today.mindlog.id.core.network.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Événement d'agenda renvoyé par le backend (src/store.ts CardEvent). */
@Serializable
data class EventDto(
    val id: Long,
    val title: String,
    @SerialName("starts_at") val startsAt: String,
    @SerialName("ends_at") val endsAt: String? = null,
    val location: String = "",
    val link: String = "",
    val notes: String = "",
    @SerialName("is_public") val isPublic: Int = 0,
)

@Serializable
data class AddEventBody(
    val title: String,
    @SerialName("starts_at") val startsAt: String,
    @SerialName("ends_at") val endsAt: String? = null,
    val location: String? = null,
    val link: String? = null,
    val notes: String? = null,
    @SerialName("is_public") val isPublic: Boolean? = null,
)

@Serializable
data class AvailabilityBody(val status: String)

/** Créneaux d'un jour pour un profil (GET /api/identities/:handle/slots). */
@Serializable
data class SlotsDto(
    val day: String,
    val status: String,
    val slotMinutes: Int? = null,
    val slots: List<SlotDto> = emptyList(),
)

@Serializable
data class SlotDto(
    val time: String,
    val taken: Boolean = false,
)
