package today.mindlog.id.core.data

import today.mindlog.id.core.network.MindlogApi
import today.mindlog.id.core.network.dto.LiveDto
import today.mindlog.id.core.network.dto.LiveFeedDto
import today.mindlog.id.core.network.dto.LiveJoinDto
import today.mindlog.id.core.network.dto.LiveSignalBody
import today.mindlog.id.core.network.dto.LiveStartBody
import javax.inject.Inject
import javax.inject.Singleton

/** Lives : feed public, mes lives, join/leave, signalisation WebRTC. */
@Singleton
class LiveRepository @Inject constructor(
    private val api: MindlogApi,
) {
    suspend fun feed(): LiveFeedDto = api.liveFeed()
    suspend fun mine(): LiveFeedDto = api.myLives()
    suspend fun detail(id: Long): LiveDto = api.liveDetail(id)

    suspend fun start(title: String, scheduledAt: String? = null): LiveDto =
        api.startLive(LiveStartBody(title = title, scheduledAt = scheduledAt))

    suspend fun end(id: Long) { api.endLive(id) }

    suspend fun join(id: Long): LiveJoinDto = api.joinLive(id)
    suspend fun leave(id: Long) { api.leaveLive(id) }
    suspend fun heartbeat(id: Long) { runCatching { api.liveHeartbeat(id) } }
    suspend fun roster(id: Long): Int = api.liveRoster(id).count

    suspend fun signal(id: Long, to: String, kind: String, sdp: String? = null, candidate: String? = null) {
        api.sendLiveSignal(id, LiveSignalBody(to = to, kind = kind, sdp = sdp, candidate = candidate))
    }
}
