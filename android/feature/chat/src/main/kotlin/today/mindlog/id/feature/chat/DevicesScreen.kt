package today.mindlog.id.feature.chat

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import today.mindlog.id.core.data.DeviceInfo
import today.mindlog.id.core.data.E2eRepository
import javax.inject.Inject

@HiltViewModel
class DevicesViewModel @Inject constructor(
    private val e2e: E2eRepository,
) : ViewModel() {
    private val _devices = MutableStateFlow<List<DeviceInfo>>(emptyList())
    val devices: StateFlow<List<DeviceInfo>> = _devices

    private val _iAmApproved = MutableStateFlow(false)
    val iAmApproved: StateFlow<Boolean> = _iAmApproved

    fun load() = viewModelScope.launch {
        val list = e2e.listDevices()
        _devices.value = list
        _iAmApproved.value = list.any { it.isMe && it.approved }
    }

    fun approve(pk: Long) = viewModelScope.launch {
        e2e.approveDevice(pk)
        load()
    }

    fun revoke(pk: Long) = viewModelScope.launch {
        e2e.revokeDevice(pk)
        load()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DevicesScreen(
    onBack: () -> Unit,
    vm: DevicesViewModel = hiltViewModel(),
) {
    val devices by vm.devices.collectAsState()
    val iAmApproved by vm.iAmApproved.collectAsState()
    var confirmRevokeId by remember { mutableStateOf<Long?>(null) }

    LaunchedEffect(Unit) { vm.load() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Mes appareils") },
                navigationIcon = { IconButton(onClick = onBack) { Text("←") } },
            )
        }
    ) { padding ->
        LazyColumn(modifier = Modifier.padding(padding).fillMaxSize()) {
            items(devices, key = { it.id }) { d ->
                ListItem(
                    headlineContent = { Text(d.name.ifBlank { "Appareil" }) },
                    supportingContent = {
                        Text(when {
                            d.isMe -> "cet appareil · ${if (d.approved) "approuvé" else "en attente"}"
                            d.approved -> "approuvé"
                            else -> "en attente d'approbation"
                        })
                    },
                    trailingContent = if (!d.isMe) {
                        {
                            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                if (!d.approved && iAmApproved) {
                                    TextButton(onClick = { vm.approve(d.id) }) { Text("Approuver") }
                                }
                                TextButton(onClick = { confirmRevokeId = d.id }) {
                                    Text("Révoquer", color = MaterialTheme.colorScheme.error)
                                }
                            }
                        }
                    } else null,
                )
                HorizontalDivider()
            }
        }
    }

    confirmRevokeId?.let { pk ->
        AlertDialog(
            onDismissRequest = { confirmRevokeId = null },
            title = { Text("Révoquer cet appareil ?") },
            text = { Text("Il ne pourra plus lire ni écrire vos messages.") },
            confirmButton = {
                TextButton(onClick = { vm.revoke(pk); confirmRevokeId = null }) { Text("Révoquer") }
            },
            dismissButton = {
                TextButton(onClick = { confirmRevokeId = null }) { Text("Annuler") }
            },
        )
    }
}
