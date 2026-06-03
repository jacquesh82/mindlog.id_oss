package today.mindlog.id.feature.card

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import today.mindlog.id.core.model.CardField
import today.mindlog.id.core.model.Visibility

private fun Visibility.toApi(): String = when (this) {
    Visibility.PUBLIC -> "public"
    Visibility.CONTACT -> "contact"
    Visibility.PRIVATE -> "private"
}

private fun Visibility.label(): String = when (this) {
    Visibility.PUBLIC -> "Public"
    Visibility.CONTACT -> "Contacts"
    Visibility.PRIVATE -> "Privé"
}

/**
 * Dialogue d'édition ([existing] != null) ou de création ([existing] == null)
 * d'un attribut de carte.
 */
@Composable
internal fun FieldEditDialog(
    existing: CardField?,
    onDismiss: () -> Unit,
    onSave: (key: String, value: String, label: String?, visibility: String) -> Unit,
    onDelete: (String) -> Unit,
) {
    var label by remember { mutableStateOf(existing?.label ?: "") }
    var value by remember { mutableStateOf(existing?.value ?: "") }
    var visibility by remember { mutableStateOf(existing?.visibility ?: Visibility.PUBLIC) }

    val isNew = existing == null
    val canSave = value.isNotBlank() && (!isNew || label.isNotBlank())

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (isNew) "Nouvel attribut" else existing!!.label) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (isNew) {
                    OutlinedTextField(
                        value = label,
                        onValueChange = { label = it },
                        label = { Text("Libellé (ex. Site web)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                OutlinedTextField(
                    value = value,
                    onValueChange = { value = it },
                    label = { Text("Valeur") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Text("Visibilité")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Visibility.entries.forEach { v ->
                        FilterChip(
                            selected = visibility == v,
                            onClick = { visibility = v },
                            label = { Text(v.label()) },
                        )
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = canSave,
                onClick = {
                    val key = existing?.key ?: slugifyKey(label)
                    onSave(key, value.trim(), if (isNew) label.trim() else null, visibility.toApi())
                },
            ) { Text("Enregistrer") }
        },
        dismissButton = {
            Row {
                if (!isNew) {
                    TextButton(onClick = { onDelete(existing!!.key) }) { Text("Supprimer") }
                }
                TextButton(onClick = onDismiss) { Text("Annuler") }
            }
        },
    )
}
