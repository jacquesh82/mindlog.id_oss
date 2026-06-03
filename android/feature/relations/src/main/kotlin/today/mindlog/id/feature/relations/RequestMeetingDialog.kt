package today.mindlog.id.feature.relations

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import today.mindlog.id.core.model.DaySlots
import java.time.Instant
import java.time.ZoneOffset

/**
 * Formulaire de demande de RDV vers un profil : nom (pré-rempli), message,
 * jour, et créneau optionnel parmi ceux renvoyés par le backend.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun RequestMeetingDialog(
    targetHandle: String,
    suggestedName: String,
    slots: DaySlots?,
    slotsLoading: Boolean,
    onLoadSlots: (String) -> Unit,
    onSubmit: (name: String, message: String?, day: String?, time: String?) -> Unit,
    onDismiss: () -> Unit,
) {
    var name by remember { mutableStateOf("") }
    var message by remember { mutableStateOf("") }
    var selectedDay by remember { mutableStateOf<String?>(null) }
    var selectedTime by remember { mutableStateOf<String?>(null) }
    var showDatePicker by remember { mutableStateOf(false) }

    // Pré-remplit le nom dès que le ViewModel a résolu le display name.
    LaunchedEffect(suggestedName) {
        if (name.isBlank() && suggestedName.isNotBlank()) name = suggestedName
    }

    val datePickerState = rememberDatePickerState()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Demander un RDV à @$targetHandle") },
        text = {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Votre nom") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = message,
                    onValueChange = { message = it },
                    label = { Text("Message (optionnel)") },
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedButton(onClick = { showDatePicker = true }) {
                    Text(selectedDay?.let { "Jour : $it" } ?: "Choisir un jour (optionnel)")
                }

                if (selectedDay != null) {
                    when {
                        slotsLoading -> CircularProgressIndicator()
                        slots != null && slots.status == "free" && slots.slots.isNotEmpty() -> {
                            Text("Créneau :")
                            Row(
                                modifier = Modifier.horizontalScroll(rememberScrollState()),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                slots.slots.forEach { slot ->
                                    FilterChip(
                                        selected = selectedTime == slot.time,
                                        enabled = !slot.taken,
                                        onClick = {
                                            selectedTime = if (selectedTime == slot.time) null else slot.time
                                        },
                                        label = { Text(slot.time) },
                                    )
                                }
                            }
                        }
                        slots != null -> Text(slotStatusLabel(slots.status))
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = name.isNotBlank(),
                onClick = { onSubmit(name.trim(), message.trim().ifBlank { null }, selectedDay, selectedTime) },
            ) { Text("Envoyer") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Annuler") } },
    )

    if (showDatePicker) {
        DatePickerDialog(
            onDismissRequest = { showDatePicker = false },
            confirmButton = {
                TextButton(onClick = {
                    datePickerState.selectedDateMillis?.let { millis ->
                        val day = Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).toLocalDate().toString()
                        selectedDay = day
                        selectedTime = null
                        onLoadSlots(day)
                    }
                    showDatePicker = false
                }) { Text("OK") }
            },
        ) {
            DatePicker(state = datePickerState)
        }
    }
}

private fun slotStatusLabel(status: String): String = when (status) {
    "busy" -> "Occupé ce jour-là."
    "private" -> "Disponibilités privées."
    "closed" -> "Ce profil n'accepte pas les demandes."
    else -> "Aucun créneau ce jour-là."
}
