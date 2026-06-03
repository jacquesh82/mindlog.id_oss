package today.mindlog.id.feature.card

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import today.mindlog.id.core.model.Card
import today.mindlog.id.core.model.CardField
import androidx.compose.foundation.layout.Arrangement

@Composable
internal fun CardContent(
    card: Card,
    photoVersion: Long,
    pagePublic: Boolean,
    tags: List<String>,
    onFieldClick: (CardField) -> Unit,
    onPickPhoto: () -> Unit,
    onToggleSecret: () -> Unit,
    onAddTag: (String) -> Unit,
    onRemoveTag: (String) -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        item {
            Box(contentAlignment = Alignment.BottomEnd) {
                if (card.hasPhoto) {
                    AsyncImage(
                        // ?v=… casse le cache de Coil après un nouvel upload.
                        model = "https://id.mindlog.today/api/identities/${card.handle}/photo?v=$photoVersion",
                        contentDescription = "Photo de profil",
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.size(96.dp).clip(CircleShape).clickable(onClick = onPickPhoto),
                    )
                } else {
                    Box(
                        modifier = Modifier
                            .size(96.dp)
                            .clip(CircleShape)
                            .background(MaterialTheme.colorScheme.primaryContainer)
                            .clickable(onClick = onPickPhoto),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = card.handle.firstOrNull()?.uppercase() ?: "?",
                            style = MaterialTheme.typography.headlineMedium,
                            color = MaterialTheme.colorScheme.onPrimaryContainer,
                        )
                    }
                }
                Surface(
                    color = MaterialTheme.colorScheme.secondary,
                    shape = CircleShape,
                    modifier = Modifier.clickable(onClick = onPickPhoto),
                ) {
                    Icon(
                        Icons.Default.PhotoCamera,
                        contentDescription = "Changer la photo",
                        tint = MaterialTheme.colorScheme.onSecondary,
                        modifier = Modifier.padding(6.dp).size(18.dp),
                    )
                }
            }
            Text(
                text = card.displayName ?: "@${card.handle}",
                style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.padding(top = 8.dp),
            )
            Text("@${card.handle}", style = MaterialTheme.typography.bodyMedium)
        }
        item {
            PublicPageRow(
                handle = card.handle,
                pagePublic = pagePublic,
                onToggleSecret = onToggleSecret,
            )
        }
        item {
            TagsSection(tags = tags, onAdd = onAddTag, onRemove = onRemoveTag)
        }
        items(card.fields, key = { it.key }) { field ->
            FieldRow(field, onClick = { onFieldClick(field) })
        }
    }
}
