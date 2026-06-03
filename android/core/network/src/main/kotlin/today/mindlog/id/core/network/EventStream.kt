package today.mindlog.id.core.network

import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import today.mindlog.id.core.datastore.ServerStore
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/** Un événement temps réel reçu du serveur : `event:` SSE + payload JSON brut. */
data class SseEvent(val event: String, val data: String)

/**
 * Flux temps réel SSE (`GET /api/events`) : notifications, `message`, `ack`,
 * `signal`. Le serveur pousse aussi un `ping` périodique (gardé vivant). La
 * reconnexion est gérée par l'appelant (le flux se termine sur coupure).
 */
@Singleton
class EventStream @Inject constructor(
    private val accessKeyInterceptor: AccessKeyInterceptor,
    private val serverStore: ServerStore,
) {
    // Client dédié : aucun timeout de lecture (le flux SSE reste ouvert).
    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .addInterceptor(accessKeyInterceptor)
            .dns(mindlogDns)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }

    fun events(): Flow<SseEvent> = callbackFlow {
        val request = Request.Builder()
            .url(serverStore.baseUrl() + "api/events")
            .header("Accept", "text/event-stream")
            .build()

        val listener = object : EventSourceListener() {
            override fun onOpen(eventSource: EventSource, response: Response) {
                android.util.Log.i("MindlogRT", "SSE ouvert (${response.code})")
            }
            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                if (type != null && type != "ping") trySend(SseEvent(type, data))
            }
            override fun onClosed(eventSource: EventSource) {
                android.util.Log.i("MindlogRT", "SSE fermé")
                close()
            }
            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                android.util.Log.w("MindlogRT", "SSE échec code=${response?.code} err=${t?.message}")
                close(t ?: RuntimeException("SSE failure ${response?.code}"))
            }
        }

        val source = EventSources.createFactory(client).newEventSource(request, listener)
        awaitClose { source.cancel() }
    }
}
