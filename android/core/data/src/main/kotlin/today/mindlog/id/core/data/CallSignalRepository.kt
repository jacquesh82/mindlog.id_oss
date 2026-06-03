package today.mindlog.id.core.data

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import today.mindlog.id.core.datastore.SessionStore
import today.mindlog.id.core.model.CallSignal
import today.mindlog.id.core.network.MindlogApi
import today.mindlog.id.core.network.dto.SignalBody
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Signalisation WebRTC chiffrée de bout en bout. Le serveur ne fait que relayer
 * des blobs (event SSE `signal`) ; le média audio/vidéo, lui, circule en P2P
 * direct et ne passe jamais ici.
 */
@Singleton
class CallSignalRepository @Inject constructor(
    private val api: MindlogApi,
    private val e2e: E2eRepository,
    private val realtime: RealtimeRepository,
    private val sessionStore: SessionStore,
) {
    private val json = Json { ignoreUnknownKeys = true }

    /** Chiffre puis relaie un message de signalisation (offer/answer/ice/…). */
    suspend fun sendSignal(handle: String, peerPub: String, payloadJson: String) {
        sessionStore.session.value?.handle?.let { e2e.ensure(it) }
        val blob = e2e.encrypt(peerPub, payloadJson) ?: error("Clé indisponible pour l'appel.")
        api.signal(handle, SignalBody(blob.iv, blob.ciphertext))
    }

    /** Flux des signaux entrants déchiffrés (capté globalement pour les appels). */
    fun incomingSignals(): Flow<CallSignal> =
        realtime.events
            .filter { it.event == "signal" }
            .mapNotNull { ev ->
                sessionStore.session.value?.handle?.let { e2e.ensure(it) }
                val o = runCatching { json.parseToJsonElement(ev.data) as JsonObject }.getOrNull()
                    ?: return@mapNotNull null
                val from = o.strOrNull("from") ?: return@mapNotNull null
                val pub = o.strOrNull("pub") ?: return@mapNotNull null
                val iv = o.strOrNull("iv") ?: return@mapNotNull null
                val ct = o.strOrNull("ciphertext") ?: return@mapNotNull null
                val plain = e2e.decrypt(pub, iv, ct) ?: return@mapNotNull null
                CallSignal(from = from, peerPub = pub, payload = plain)
            }

    private fun JsonObject.strOrNull(k: String) = (this[k] as? JsonPrimitive)?.content
}
