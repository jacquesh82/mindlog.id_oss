package today.mindlog.id.core.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.retryWhen
import kotlinx.coroutines.flow.shareIn
import today.mindlog.id.core.data.di.AppScope
import today.mindlog.id.core.model.RealtimeEvent
import today.mindlog.id.core.network.EventStream
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Flux temps réel partagé (une seule connexion SSE pour toute l'app). Se
 * (re)connecte tant qu'il y a des abonnés et retente après coupure. Les features
 * (chat, appels, service de notifications) s'y branchent sans ouvrir leur propre
 * connexion.
 */
@Singleton
class RealtimeRepository @Inject constructor(
    eventStream: EventStream,
    @AppScope scope: CoroutineScope,
) {
    val events = eventStream.events()
        .map { RealtimeEvent(it.event, it.data) } // expose un type domaine (core:model)
        .retryWhen { _, _ -> delay(3000); true } // reconnexion sur coupure
        .shareIn(scope, SharingStarted.WhileSubscribed(5_000), replay = 0)

    companion object {
        fun isFrom(event: RealtimeEvent, handle: String): Boolean {
            // data minimal { "from": "<handle>" } — match permissif (refresh si inconnu).
            val from = Regex("\"from\"\\s*:\\s*\"([^\"]*)\"").find(event.data)?.groupValues?.get(1)
            return from == null || from == handle.removePrefix("@")
        }
    }
}
