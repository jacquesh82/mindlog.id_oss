package today.mindlog.id.feature.chat

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import today.mindlog.id.core.model.Group
import today.mindlog.id.core.model.GroupMessage

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun GroupChatRoute(
    onBack: () -> Unit,
    viewModel: GroupChatViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var input by remember { mutableStateOf("") }
    var readOnce by remember { mutableStateOf(false) }
    var showManage by remember { mutableStateOf(false) }
    // Messages readOnce reçus déjà révélés (in-memory ; après refresh ils sont brûlés serveur).
    var revealed by remember { mutableStateOf(setOf<Long>()) }
    val listState = rememberLazyListState()

    LaunchedEffect(state.left) { if (state.left) onBack() }
    LaunchedEffect(state.error) {
        state.error?.let { scope.launch { snackbar.showSnackbar(it) }; viewModel.clearError() }
    }
    LaunchedEffect(state.messages.size) {
        if (state.messages.isNotEmpty()) listState.animateScrollToItem(state.messages.size - 1)
    }
    BackHandler { onBack() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(state.group?.name?.ifBlank { "Groupe" } ?: "Groupe") },
                navigationIcon = {
                    TextButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Retour") }
                },
                actions = {
                    IconButton(onClick = { showManage = true }) {
                        Icon(Icons.Default.Group, contentDescription = "Membres")
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            Row(
                Modifier.fillMaxWidth().padding(8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                // Toggle « lecture unique » — un seul membre verra le message, puis brûlure.
                IconButton(onClick = { readOnce = !readOnce }) {
                    Icon(
                        if (readOnce) Icons.Default.Visibility else Icons.Default.VisibilityOff,
                        contentDescription = "Lecture unique",
                        tint = if (readOnce) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                OutlinedTextField(
                    value = input,
                    onValueChange = { input = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text(if (readOnce) "Message à lecture unique…" else "Message chiffré…") },
                )
                IconButton(
                    onClick = {
                        viewModel.send(input, readOnce = readOnce)
                        input = ""; readOnce = false
                    },
                    enabled = input.isNotBlank(),
                ) {
                    Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Envoyer")
                }
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            if (state.loading) {
                CircularProgressIndicator(Modifier.align(Alignment.Center))
            } else {
                LazyColumn(Modifier.fillMaxSize().padding(horizontal = 12.dp), state = listState) {
                    items(state.messages, key = { it.id }) { m ->
                        GroupBubble(
                            m = m,
                            revealed = m.id in revealed,
                            onReact = { mid, emoji -> viewModel.react(mid, emoji) },
                            onDelete = { mid -> viewModel.deleteMessage(mid) },
                            onReveal = { mid -> revealed = revealed + mid; viewModel.burnMessage(mid) },
                        )
                    }
                }
            }
        }
    }

    if (showManage) {
        state.group?.let { g ->
            ManageMembersDialog(
                group = g,
                onAdd = { viewModel.addMember(it) },
                onRemove = { viewModel.removeMember(it) },
                onLeave = { viewModel.leave(); showManage = false },
                onDismiss = { showManage = false },
            )
        }
    }
}

/** Bulle de message de groupe — pattern aligné sur MessageBubble (chat 1:1) :
 *  long-press → menu emoji + suppression/brûlure ; readOnce → tombstone ou cache cliquable. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun GroupBubble(
    m: GroupMessage,
    revealed: Boolean,
    onReact: (Long, String) -> Unit,
    onDelete: (Long) -> Unit,
    onReveal: (Long) -> Unit,
) {
    var menuOpen by remember { mutableStateOf(false) }
    val bubbleColor = if (m.mine) MaterialTheme.colorScheme.primaryContainer
    else MaterialTheme.colorScheme.surfaceVariant
    val align = if (m.mine) Alignment.End else Alignment.Start

    Column(Modifier.fillMaxWidth().padding(vertical = 3.dp), horizontalAlignment = align) {
        if (!m.mine) {
            Text(
                "@${m.sender}",
                fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Start,
                style = MaterialTheme.typography.labelMedium,
            )
        }
        Box {
            Column(
                Modifier
                    .widthIn(max = 300.dp)
                    .background(bubbleColor, RoundedCornerShape(14.dp))
                    .combinedClickable(onClick = {}, onLongClick = { menuOpen = true })
                    .padding(horizontal = 12.dp, vertical = 8.dp),
            ) {
                val body: @Composable () -> Unit = when {
                    // Émetteur : tombstone (mon message à lecture unique).
                    m.readOnce && m.mine -> { {
                        Text(
                            "👁 Message à lecture unique",
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    } }
                    // Reçu, pas encore révélé : cache cliquable → révèle + brûle côté serveur.
                    m.readOnce && !revealed -> { {
                        Text(
                            "👁 Message à lecture unique — toucher pour voir",
                            Modifier.combinedClickable(onClick = { onReveal(m.id) }, onLongClick = {}),
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.primary,
                        )
                    } }
                    else -> { {
                        val t = m.text
                        val label = when {
                            t != null -> t
                            m.pending -> "🔒 en attente de la clé d'expéditeur…"
                            else -> "⚠️ indéchiffrable"
                        }
                        Text(label, style = MaterialTheme.typography.bodyLarge)
                    } }
                }
                body()
            }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                Row(Modifier.padding(horizontal = 8.dp)) {
                    QUICK_EMOJIS.forEach { em ->
                        IconButton(onClick = { onReact(m.id, em); menuOpen = false }) { Text(em) }
                    }
                }
                if (m.mine) {
                    DropdownMenuItem(
                        text = { Text("Supprimer") },
                        onClick = { onDelete(m.id); menuOpen = false },
                    )
                }
            }
        }
        if (m.reactions.isNotEmpty()) {
            Text(
                m.reactions.joinToString(" ") { it.emoji + if (it.count > 1) " ${it.count}" else "" },
                style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.padding(horizontal = 4.dp),
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ManageMembersDialog(
    group: Group,
    onAdd: (String) -> Unit,
    onRemove: (String) -> Unit,
    onLeave: () -> Unit,
    onDismiss: () -> Unit,
) {
    var newHandle by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(group.name.ifBlank { "Membres" }) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                group.members.forEach { mb ->
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text("@${mb.handle}" + if (mb.role == "admin") " ★" else "", Modifier.weight(1f))
                        if (group.isAdmin && mb.role != "admin") {
                            TextButton(onClick = { onRemove(mb.handle) }) { Text("Retirer") }
                        }
                    }
                }
                if (group.isAdmin) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(newHandle, { newHandle = it }, label = { Text("Ajouter @handle") }, singleLine = true, modifier = Modifier.weight(1f))
                        TextButton(onClick = { onAdd(newHandle.trim().removePrefix("@")); newHandle = "" }, enabled = newHandle.isNotBlank()) { Text("Ajouter") }
                    }
                }
                OutlinedButton(onClick = onLeave, modifier = Modifier.fillMaxWidth()) { Text("Quitter le groupe") }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Fermer") } },
    )
}
