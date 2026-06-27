package today.mindlog.id.feature.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import today.mindlog.id.core.designsystem.component.Avatar
import today.mindlog.id.core.designsystem.component.UnreadBadge
import today.mindlog.id.core.designsystem.component.mindlogPhotoUrl
import today.mindlog.id.core.designsystem.relativeTimeLabel
import today.mindlog.id.core.model.ConversationSummary

@Composable
fun ChatListRoute(
    onOpenChat: (String) -> Unit,
    onOpenGroups: () -> Unit,
    viewModel: ChatListViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    ChatListScreen(uiState = uiState, onOpenChat = onOpenChat, onOpenGroups = onOpenGroups)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ChatListScreen(
    uiState: ChatListUiState,
    onOpenChat: (String) -> Unit,
    onOpenGroups: () -> Unit,
) {
    var showNewChat by remember { mutableStateOf(false) }
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Chat", fontWeight = FontWeight.SemiBold)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                Icons.Default.Lock,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.padding(end = 4.dp).size(14.dp),
                            )
                            Text(
                                "Chiffré de bout en bout",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                },
                actions = {
                    IconButton(onClick = onOpenGroups) {
                        Icon(Icons.Default.Group, contentDescription = "Groupes")
                    }
                },
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { showNewChat = true }) {
                Icon(Icons.Default.Add, contentDescription = "Nouvelle discussion")
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                uiState.loading && uiState.conversations.isEmpty() ->
                    CircularProgressIndicator(Modifier.align(Alignment.Center))

                uiState.conversations.isEmpty() ->
                    Text(
                        "Aucune conversation pour l'instant.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.align(Alignment.Center).padding(24.dp),
                    )

                else -> LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(vertical = 8.dp),
                ) {
                    items(uiState.conversations, key = { it.handle }) { conv ->
                        ConversationRow(conv, onClick = { onOpenChat(conv.handle) })
                    }
                }
            }
        }
    }

    if (showNewChat) {
        NewChatDialog(
            onDismiss = { showNewChat = false },
            onStart = { handle -> showNewChat = false; onOpenChat(handle) },
        )
    }
}

/** Saisie d'un @handle pour ouvrir/démarrer une discussion chiffrée. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NewChatDialog(onDismiss: () -> Unit, onStart: (String) -> Unit) {
    var input by remember { mutableStateOf("") }
    val handle = input.trim().removePrefix("@").lowercase()
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Nouvelle discussion") },
        text = {
            Column {
                Text(
                    "Saisis le @handle de la personne à contacter.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedTextField(
                    value = input,
                    onValueChange = { input = it },
                    singleLine = true,
                    placeholder = { Text("@handle") },
                    leadingIcon = {
                        Icon(Icons.Default.Lock, contentDescription = null, modifier = Modifier.size(16.dp))
                    },
                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                )
            }
        },
        confirmButton = {
            TextButton(enabled = handle.isNotBlank(), onClick = { onStart(handle) }) {
                Text("Discuter")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Annuler") } },
    )
}

@Composable
internal fun ConversationRow(conv: ConversationSummary, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Avatar(
            handle = conv.handle,
            photoUrl = if (conv.hasPhoto) mindlogPhotoUrl(conv.handle) else null,
            size = 44.dp,
        )
        Column(Modifier.weight(1f)) {
            Text(
                text = "@${conv.handle}",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                text = if (conv.lastMine) "Vous · chiffré" else "🔒 Message chiffré",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                text = relativeTimeLabel(conv.lastAt),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            UnreadBadge(conv.unread)
        }
    }
}
