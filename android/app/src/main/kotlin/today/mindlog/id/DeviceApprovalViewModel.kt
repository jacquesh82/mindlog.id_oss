package today.mindlog.id

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import today.mindlog.id.core.data.DeviceInfo
import today.mindlog.id.core.data.E2eRepository
import today.mindlog.id.core.data.RealtimeRepository
import javax.inject.Inject

/**
 * Pilote la popup d'approbation d'un nouvel appareil. Ne propose à l'approbation
 * que si CET appareil est déjà approuvé (un appareil en attente ne peut pas en
 * approuver un autre — anti-bootstrap). Rafraîchit au démarrage et sur événement
 * SSE `device`. Miroir de showDeviceApprovalModal() côté web.
 */
@HiltViewModel
class DeviceApprovalViewModel @Inject constructor(
    private val e2e: E2eRepository,
    private val realtime: RealtimeRepository,
) : ViewModel() {

    private val _pending = MutableStateFlow<List<DeviceInfo>>(emptyList())
    val pending: StateFlow<List<DeviceInfo>> = _pending.asStateFlow()

    init {
        refresh()
        viewModelScope.launch {
            realtime.events.collect { ev -> if (ev.event == "device") refresh() }
        }
    }

    fun refresh() = viewModelScope.launch {
        val list = e2e.listDevices()
        val iAmApproved = list.any { it.isMe && it.approved }
        _pending.value = if (iAmApproved) list.filter { !it.isMe && !it.approved } else emptyList()
    }

    fun approve(pk: Long) = viewModelScope.launch {
        e2e.approveDevice(pk)
        refresh()
    }

    fun reject(pk: Long) = viewModelScope.launch {
        e2e.revokeDevice(pk)
        refresh()
    }

    /** Ferme la popup sans décider (réapparaîtra au prochain rafraîchissement). */
    fun dismiss() { _pending.value = emptyList() }
}
