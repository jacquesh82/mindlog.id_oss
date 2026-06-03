package today.mindlog.id.feature.chat

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Group
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GroupChatRoute(
    onBack: () -> Unit,
    viewModel: GroupChatViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var input by remember { mutableStateOf("") }
    var showManage by remember { mutableStateOf(false) }
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
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedTextField(
                    value = input,
                    onValueChange = { input = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text("Message chiffré…") },
                )
                IconButton(onClick = { viewModel.send(input); input = "" }, enabled = input.isNotBlank()) {
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
                    items(state.messages, key = { it.id }) { m -> GroupBubble(m) }
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

@Composable
private fun GroupBubble(m: GroupMessage) {
    val align = if (m.mine) Alignment.End else Alignment.Start
    Column(Modifier.fillMaxWidth().padding(vertical = 3.dp), horizontalAlignment = align) {
        if (!m.mine) {
            Text("@${m.sender}", fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Start)
        }
        Surface(
            shape = RoundedCornerShape(14.dp),
            tonalElevation = if (m.mine) 3.dp else 1.dp,
        ) {
            val t = m.text
            val body = when {
                t != null -> t
                m.pending -> "🔒 en attente de la clé d'expéditeur…"
                else -> "⚠️ indéchiffrable"
            }
            Text(body, Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
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
