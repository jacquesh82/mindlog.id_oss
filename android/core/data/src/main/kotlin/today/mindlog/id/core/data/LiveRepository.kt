package today.mindlog.id.core.data

import kotlinx.coroutines.flow.Flow
import today.mindlog.id.core.datastore.ServerStore
import today.mindlog.id.core.network.LiveSignalStream
import today.mindlog.id.core.network.MindlogApi
import today.mindlog.id.core.network.dto.LiveDeviceBody
import today.mindlog.id.core.network.dto.LiveDto
import today.mindlog.id.core.network.dto.LiveFeedDto
import today.mindlog.id.core.network.dto.LiveJoinDto
import today.mindlog.id.core.network.dto.LiveRosterDto
import today.mindlog.id.core.network.dto.LiveSignalBody
import today.mindlog.id.core.network.dto.LiveSignalEventDto
import today.mindlog.id.core.network.dto.LiveStartBody
import javax.inject.Inject
import javax.inject.Singleton

/** Lives : feed public, mes lives, join/leave, signalisation WebRTC mesh. */
@Singleton
class LiveRepository @Inject constructor(
    private val api: MindlogApi,
    private val signalStream: LiveSignalStream,
    private val serverStore: ServerStore,
) {
    /** Lien public partageable d'un live (`<base>/live/<id>`). */
    fun shareUrl(id: String): String = serverStore.baseUrl().trimEnd('/') + "/live/" + id

    suspend fun feed(): LiveFeedDto = api.liveFeed()
    suspend fun mine(): LiveFeedDto = api.myLives()
    suspend fun detail(id: String): LiveDto = api.liveDetail(id)

    /** Démarre un live. [broadcasterPub] = pubkey opaque (E2E Web ; Android passe un placeholder). */
    suspend fun start(title: String, broadcasterPub: String, scheduledAt: String? = null): LiveDto =
        api.startLive(LiveStartBody(title = title, broadcasterPub = broadcasterPub, scheduledAt = scheduledAt))

    suspend fun end(id: String) { api.endLive(id) }

    suspend fun join(id: String, deviceId: String): LiveJoinDto =
        api.joinLive(id, LiveDeviceBody(deviceId = deviceId))

    suspend fun leave(id: String, deviceId: String) {
        runCatching { api.leaveLive(id, LiveDeviceBody(deviceId = deviceId)) }
    }

    suspend fun heartbeat(id: String, deviceId: String) {
        runCatching { api.liveHeartbeat(id, LiveDeviceBody(deviceId = deviceId)) }
    }

    /** Renotifie manuellement les abonné·e·s (owner-only). */
    suspend fun notify(id: String) { api.notifyLive(id) }

    suspend fun roster(id: String): LiveRosterDto = api.liveRoster(id)

    /** Envoie un paquet de signalisation au mesh — [payloadJson] est opaque côté serveur. */
    suspend fun sendSignal(id: String, from: String, to: String, kind: String, payloadJson: String? = null) {
        api.sendLiveSignal(id, LiveSignalBody(from = from, to = to, kind = kind, payload = payloadJson))
    }

    /** Flux SSE des paquets adressés à [deviceId] pour ce live. */
    fun subscribeSignals(id: String, deviceId: String): Flow<LiveSignalEventDto> =
        signalStream.events(id, deviceId)
}
