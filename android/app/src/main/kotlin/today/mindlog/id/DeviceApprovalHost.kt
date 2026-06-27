package today.mindlog.id

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Security
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle

/**
 * Popup d'approbation de nouvel appareil, montée globalement (au-dessus de la
 * navigation). N'apparaît que lorsqu'un appareil en attente est détecté et que
 * l'appareil courant est déjà approuvé. Miroir de showDeviceApprovalModal() web.
 */
@Composable
fun DeviceApprovalHost(vm: DeviceApprovalViewModel = hiltViewModel()) {
    val pending by vm.pending.collectAsStateWithLifecycle()
    if (pending.isEmpty()) return

    AlertDialog(
        onDismissRequest = { vm.dismiss() },
        icon = { Icon(Icons.Default.Security, contentDescription = null) },
        title = { Text("Nouvel appareil") },
        text = {
            Column {
                Text(
                    "Un nouvel appareil veut accéder à vos messages chiffrés. " +
                        "Approuvez-le seulement si c'est bien vous — sinon, refusez.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                pending.forEach { d ->
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(
                            d.name.ifBlank { "Appareil" },
                            fontWeight = FontWeight.Medium,
                            modifier = Modifier.weight(1f),
                        )
                        TextButton(onClick = { vm.reject(d.id) }) {
                            Text("Refuser", color = MaterialTheme.colorScheme.error)
                        }
                        TextButton(onClick = { vm.approve(d.id) }) { Text("Approuver") }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { vm.dismiss() }) { Text("Plus tard") }
        },
    )
}
