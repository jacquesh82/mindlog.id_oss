package today.mindlog.id.core.network

import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import today.mindlog.id.core.datastore.ServerStore
import today.mindlog.id.core.network.dto.LiveSignalEventDto
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Flux SSE dédié au mesh d'un live (`GET /api/live/:id/signal?device_id=…`).
 * Distinct du flux temps réel général [EventStream] (notifications/chat) :
 * un live ouvre sa propre connexion, fermée à la sortie.
 *
 * Le serveur émet :
 *   - `ready` à l'ouverture (handshake) — on l'ignore ici
 *   - `signal` avec un payload {from, to, kind, payload, ts}
 *   - `ping` toutes les ~25 s (filtré silencieusement)
 */
@Singleton
class LiveSignalStream @Inject constructor(
    private val accessKeyInterceptor: AccessKeyInterceptor,
    private val serverStore: ServerStore,
) {
    private val json = Json { ignoreUnknownKeys = true }

    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .addInterceptor(accessKeyInterceptor)
            .dns(mindlogDns)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }

    fun events(liveId: String, deviceId: String): Flow<LiveSignalEventDto> = callbackFlow {
        val url = serverStore.baseUrl() + "api/live/$liveId/signal?device_id=$deviceId"
        val request = Request.Builder()
            .url(url)
            .header("Accept", "text/event-stream")
            .build()

        val listener = object : EventSourceListener() {
            override fun onOpen(eventSource: EventSource, response: Response) {
                android.util.Log.i("MindlogLive", "Live SSE ouvert (code=${response.code}, live=$liveId)")
            }
            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                if (type != "signal") return // ready/ping ignorés
                runCatching {
                    val packet = json.decodeFromString(LiveSignalEventDto.serializer(), data)
                    trySend(packet)
                }
            }
            override fun onClosed(eventSource: EventSource) {
                android.util.Log.i("MindlogLive", "Live SSE fermé (live=$liveId)")
                close()
            }
            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                android.util.Log.w("MindlogLive", "Live SSE échec code=${response?.code} err=${t?.message}")
                close(t ?: RuntimeException("Live SSE failure ${response?.code}"))
            }
        }

        val source = EventSources.createFactory(client).newEventSource(request, listener)
        awaitClose { source.cancel() }
    }
}
