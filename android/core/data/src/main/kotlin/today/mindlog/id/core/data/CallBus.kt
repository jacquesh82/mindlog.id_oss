package today.mindlog.id.core.data

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import javax.inject.Inject
import javax.inject.Singleton

/** Demande d'appel sortant émise depuis le chat (handle, clé pub du pair, vidéo ?). */
data class OutgoingCall(val handle: String, val peerPub: String, val video: Boolean)

/**
 * Bus d'appels sortants : feature:chat émet une demande, l'hôte d'appel (app +
 * feature:call) la consomme et démarre la connexion WebRTC. Évite une dépendance
 * directe feature:chat → feature:call.
 */
@Singleton
class CallBus @Inject constructor() {
    private val _outgoing = MutableSharedFlow<OutgoingCall>(extraBufferCapacity = 1)
    val outgoing: SharedFlow<OutgoingCall> = _outgoing.asSharedFlow()

    fun requestCall(handle: String, peerPub: String, video: Boolean) {
        _outgoing.tryEmit(OutgoingCall(handle, peerPub, video))
    }
}
