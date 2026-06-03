package today.mindlog.id.feature.relations

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.EventAvailable
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.PersonRemove
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import today.mindlog.id.core.model.PublicProfile

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ProfileScreen(
    profile: PublicProfile?,
    loading: Boolean,
    onBack: () -> Unit,
    onAdd: (String) -> Unit,
    onRemove: (String) -> Unit,
    onRequestMeeting: (String) -> Unit,
    onChat: (String) -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(profile?.let { "@${it.handle}" } ?: "Profil") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Retour")
                    }
                },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                profile == null -> Text(
                    "Profil indisponible.",
                    modifier = Modifier.align(Alignment.Center),
                )
                else -> ProfileContent(profile, onAdd, onRemove, onRequestMeeting, onChat)
            }
        }
    }
}

@Composable
private fun ProfileContent(
    profile: PublicProfile,
    onAdd: (String) -> Unit,
    onRemove: (String) -> Unit,
    onRequestMeeting: (String) -> Unit,
    onChat: (String) -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        item {
            Avatar(profile.handle, profile.hasPhoto, size = 96)
            Text(
                text = profile.displayName ?: "@${profile.handle}",
                style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.padding(top = 8.dp),
            )
            Text("@${profile.handle}", style = MaterialTheme.typography.bodyMedium)

            if (profile.isRelated) {
                OutlinedButton(
                    onClick = { onRemove(profile.handle) },
                    modifier = Modifier.padding(top = 12.dp),
                ) {
                    Icon(Icons.Default.PersonRemove, contentDescription = null)
                    Text("  Retirer des relations")
                }
            } else {
                Button(
                    onClick = { onAdd(profile.handle) },
                    modifier = Modifier.padding(top = 12.dp),
                ) {
                    Icon(Icons.Default.PersonAdd, contentDescription = null)
                    Text("  Ajouter aux relations")
                }
            }

            if (profile.allowRequests) {
                OutlinedButton(
                    onClick = { onRequestMeeting(profile.handle) },
                    modifier = Modifier.padding(top = 8.dp),
                ) {
                    Icon(Icons.Default.EventAvailable, contentDescription = null)
                    Text("  Demander un RDV")
                }
            }

            // La messagerie chiffrée est réservée aux contacts réciproques.
            if (profile.isContact) {
                Button(
                    onClick = { onChat(profile.handle) },
                    modifier = Modifier.padding(top = 8.dp),
                ) {
                    Icon(Icons.AutoMirrored.Filled.Chat, contentDescription = null)
                    Text("  Discuter 🔒")
                }
            }
        }
        items(profile.fields.filter { !it.value.isNullOrBlank() }, key = { it.key }) { field ->
            ListItem(
                headlineContent = { Text(field.value.orEmpty()) },
                overlineContent = { Text(field.label) },
            )
        }
    }
}
