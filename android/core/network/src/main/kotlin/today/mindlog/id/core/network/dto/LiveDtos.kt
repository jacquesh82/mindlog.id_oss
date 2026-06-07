package today.mindlog.id.core.network.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Un live référencé dans le feed. */
@Serializable
data class LiveDto(
    val id: Long,
    val handle: String = "",
    val title: String = "",
    val status: String = "scheduled", // "scheduled" | "live" | "ended"
    @SerialName("scheduled_at") val scheduledAt: String? = null,
    @SerialName("started_at") val startedAt: String? = null,
    @SerialName("ended_at") val endedAt: String? = null,
    val viewers: Int = 0,
)

@Serializable
data class LiveFeedDto(
    val live: List<LiveDto> = emptyList(),
    val upcoming: List<LiveDto> = emptyList(),
    val ended: List<LiveDto> = emptyList(),
)

@Serializable
data class LiveStartBody(
    val title: String,
    @SerialName("scheduled_at") val scheduledAt: String? = null,
)

@Serializable
data class LiveJoinDto(
    val id: Long,
    val handle: String = "",
    @SerialName("host_id") val hostId: String = "",
    @SerialName("client_id") val clientId: String = "",
    @SerialName("ice_servers") val iceServers: List<IceServerDto> = emptyList(),
)

@Serializable
data class IceServerDto(
    val urls: List<String> = emptyList(),
    val username: String? = null,
    val credential: String? = null,
)

@Serializable
data class LiveRosterDto(
    val count: Int = 0,
    val viewers: List<String> = emptyList(),
)

/** Paquet de signalisation WebRTC (offre, réponse, ICE). */
@Serializable
data class LiveSignalBody(
    val to: String,
    val kind: String, // "offer" | "answer" | "ice"
    val sdp: String? = null,
    val candidate: String? = null,
)
