package today.mindlog.id.feature.card

import androidx.compose.foundation.clickable
import androidx.compose.material3.ListItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import today.mindlog.id.core.model.CardField
import today.mindlog.id.core.model.Visibility

@Composable
internal fun FieldRow(field: CardField, onClick: () -> Unit) {
    ListItem(
        modifier = Modifier.clickable(onClick = onClick),
        headlineContent = { Text(field.value?.ifBlank { "—" } ?: "—") },
        overlineContent = { Text(field.label) },
        supportingContent = { Text(visibilityLabel(field.visibility)) },
    )
}

internal fun visibilityLabel(v: Visibility): String = when (v) {
    Visibility.PUBLIC -> "Public"
    Visibility.CONTACT -> "Contacts"
    Visibility.PRIVATE -> "Privé"
}
