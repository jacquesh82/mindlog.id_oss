package today.mindlog.id.core.network.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Un live référencé dans le feed. `id` est l'UUID string du stream. */
@Serializable
data class LiveDto(
    val id: String = "",
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

/** Création d'un live. `broadcasterPub` est une clé publique opaque (256 chars max),
 *  exigée par le serveur pour la couche E2E Web. Android peut envoyer un placeholder. */
@Serializable
data class LiveStartBody(
    val title: String,
    @SerialName("broadcaster_pub") val broadcasterPub: String,
    @SerialName("scheduled_at") val scheduledAt: String? = null,
)

/** Corps des endpoints scoped device (join/heartbeat/leave). */
@Serializable
data class LiveDeviceBody(
    @SerialName("device_id") val deviceId: String,
    val score: Int? = null,
)

/** Membre du roster d'un live. */
@Serializable
data class LiveRosterMemberDto(
    @SerialName("device_id") val deviceId: String = "",
    val role: String = "viewer", // "broadcaster" | "viewer"
    val score: Int = 0,
    val handle: String = "",
    @SerialName("has_photo") val hasPhoto: Boolean = false,
)

/** Réponse de POST /api/live/:id/join. */
@Serializable
data class LiveJoinDto(
    val id: String = "",
    val role: String = "viewer", // "broadcaster" | "viewer"
    val epoch: Int = 0,
    @SerialName("broadcaster_pub") val broadcasterPub: String = "",
    val roster: List<LiveRosterMemberDto> = emptyList(),
)

@Serializable
data class LiveRosterDto(
    val count: Int = 0,
    val roster: List<LiveRosterMemberDto> = emptyList(),
)

/**
 * Paquet de signalisation WebRTC envoyé au serveur (POST /api/live/:id/signal).
 * `payload` est opaque (string sérialisée JSON côté client) — typiquement
 * { type, sdp } pour offer/answer ou { candidate, sdpMid, sdpMLineIndex } pour ice.
 */
@Serializable
data class LiveSignalBody(
    val from: String,
    val to: String,
    val kind: String, // "offer" | "answer" | "ice" | "bye" | "wrap" | "chat"
    val payload: String? = null,
)

/** Événement SSE émis par GET /api/live/:id/signal (type "signal"). */
@Serializable
data class LiveSignalEventDto(
    val from: String = "",
    val to: String = "",
    val kind: String = "",
    /** Sérialisée en JSON arbitraire — laissé tel quel côté client pour parser à l'usage. */
    val payload: String? = null,
    val ts: Long = 0,
)
