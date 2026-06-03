package today.mindlog.id.feature.call

import androidx.lifecycle.ViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import org.webrtc.EglBase
import today.mindlog.id.core.data.CallBus
import today.mindlog.id.core.data.OutgoingCall
import javax.inject.Inject

@HiltViewModel
class CallViewModel @Inject constructor(
    private val callManager: CallManager,
    callBus: CallBus,
) : ViewModel() {

    val state: StateFlow<CallState> = callManager.state
    val outgoing: SharedFlow<OutgoingCall> = callBus.outgoing

    fun eglContext(): EglBase.Context = callManager.eglContext()

    fun startOutgoing(o: OutgoingCall) = callManager.startOutgoing(o.handle, o.peerPub, o.video)
    fun accept() = callManager.accept()
    fun decline() = callManager.decline()
    fun hangup() = callManager.hangup()
    fun toggleMic() = callManager.toggleMic()
    fun toggleCam() = callManager.toggleCam()
    fun dismiss() = callManager.dismiss()
}
