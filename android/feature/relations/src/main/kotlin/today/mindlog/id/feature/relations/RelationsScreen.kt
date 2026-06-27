package today.mindlog.id.feature.relations

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.PersonAddAlt
import androidx.compose.material.icons.filled.PersonRemove
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import today.mindlog.id.core.designsystem.QrScanner
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import today.mindlog.id.core.model.IdentitySummary
import today.mindlog.id.core.model.Relation

@Composable
fun RelationsRoute(
    onOpenGroups: () -> Unit = {},
    viewModel: RelationsViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    // Le profil ouvert masque la liste ; le bouton retour le referme.
    if (uiState.profile != null || uiState.profileLoading) {
        BackHandler { viewModel.closeProfile() }
        ProfileScreen(
            profile = uiState.profile,
            loading = uiState.profileLoading,
            onBack = viewModel::closeProfile,
            onAdd = { viewModel.addRelation(it) },
            onRemove = { viewModel.removeRelation(it) },
            onRequestMeeting = { viewModel.openRequestDialog(it) },
            onChat = { viewModel.openChat(it) },
        )
    } else {
        RelationsScreen(
            uiState = uiState,
            onQueryChange = viewModel::onQueryChange,
            onOpenProfile = viewModel::openProfile,
            onAdd = { viewModel.addRelation(it) },
            onRemove = { viewModel.removeRelation(it) },
            onErrorShown = viewModel::clearError,
            onInfoShown = viewModel::clearInfo,
            onCreateInvite = viewModel::createInvite,
            onScanInvite = viewModel::startScan,
            onOpenGroups = onOpenGroups,
        )
    }

    // Invitation de contact : scanner, lien à partager, confirmation d'acceptation.
    InviteOverlays(
        scanning = uiState.scanning,
        inviteLink = uiState.inviteLink,
        inviteHandle = uiState.inviteHandle,
        onScanned = viewModel::onScanned,
        onStopScan = viewModel::stopScan,
        onDismissLink = viewModel::dismissInviteLink,
        onConfirm = viewModel::confirmInvite,
        onDismissConfirm = viewModel::dismissInviteConfirm,
    )

    uiState.requestTarget?.let { target ->
        RequestMeetingDialog(
            targetHandle = target.removePrefix("@"),
            suggestedName = uiState.myName,
            slots = uiState.slots,
            slotsLoading = uiState.slotsLoading,
            onLoadSlots = viewModel::loadSlots,
            onSubmit = viewModel::sendRequest,
            onDismiss = viewModel::closeRequestDialog,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun RelationsScreen(
    uiState: RelationsUiState,
    onQueryChange: (String) -> Unit,
    onOpenProfile: (String) -> Unit,
    onAdd: (String) -> Unit,
    onRemove: (String) -> Unit,
    onErrorShown: () -> Unit,
    onInfoShown: () -> Unit,
    onCreateInvite: () -> Unit = {},
    onScanInvite: () -> Unit = {},
    onOpenGroups: () -> Unit = {},
) {
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            scope.launch { snackbarHostState.showSnackbar(it) }
            onErrorShown()
        }
    }
    LaunchedEffect(uiState.info) {
        uiState.info?.let {
            scope.launch { snackbarHostState.showSnackbar(it) }
            onInfoShown()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Réseau") },
                actions = {
                    IconButton(onClick = onOpenGroups) {
                        Icon(Icons.Default.Groups, contentDescription = "Groupes")
                    }
                    IconButton(onClick = onScanInvite) {
                        Icon(Icons.Default.QrCodeScanner, contentDescription = "Scanner une invitation")
                    }
                    IconButton(onClick = onCreateInvite) {
                        Icon(Icons.Default.PersonAddAlt, contentDescription = "Inviter un contact")
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            LazyColumn(Modifier.fillMaxSize()) {
                item {
                    val typed = uiState.query.trim().removePrefix("@").lowercase()
                    OutlinedTextField(
                        value = uiState.query,
                        onValueChange = onQueryChange,
                        label = { Text("Rechercher ou ajouter un @handle") },
                        leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                        // Bouton « + » pour ajouter directement le @handle saisi (parité Web .rel-add-btn).
                        trailingIcon = {
                            if (typed.isNotBlank()) {
                                IconButton(onClick = { onAdd(typed) }) {
                                    Icon(Icons.Default.PersonAdd, contentDescription = "Ajouter @$typed")
                                }
                            }
                        },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth().padding(16.dp),
                    )
                }

                if (uiState.query.isNotBlank()) {
                    if (uiState.searching) {
                        item { CenteredSpinner() }
                    } else if (uiState.results.isEmpty()) {
                        item { EmptyHint("Aucun résultat.") }
                    } else {
                        items(uiState.results, key = { "r_" + it.handle }) { person ->
                            SearchResultRow(person, onOpenProfile, onAdd)
                        }
                    }
                } else {
                    if (uiState.incoming.isNotEmpty()) {
                        item { SectionHeader("Demandes entrantes") }
                        items(uiState.incoming, key = { "in_" + it.handle }) { rel ->
                            RelationRow(rel, onOpenProfile, onRemove, incoming = true, onAdd = onAdd)
                        }
                    }
                    item { SectionHeader("Mes relations") }
                    if (uiState.loading) {
                        item { CenteredSpinner() }
                    } else if (uiState.direct.isEmpty()) {
                        item { EmptyHint("Aucune relation. Cherche quelqu'un pour l'ajouter. 🦎") }
                    } else {
                        items(uiState.direct, key = { "d_" + it.handle }) { rel ->
                            RelationRow(rel, onOpenProfile, onRemove, incoming = false, onAdd = onAdd)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SearchResultRow(
    person: IdentitySummary,
    onOpenProfile: (String) -> Unit,
    onAdd: (String) -> Unit,
) {
    ListItem(
        modifier = Modifier.clickableRow { onOpenProfile(person.handle) },
        leadingContent = { Avatar(person.handle, person.hasPhoto) },
        headlineContent = { Text(person.displayName ?: "@${person.handle}") },
        supportingContent = { Text("@${person.handle}" + (person.title?.let { " · $it" } ?: "")) },
        trailingContent = {
            IconButton(onClick = { onAdd(person.handle) }) {
                Icon(Icons.Default.PersonAdd, contentDescription = "Ajouter")
            }
        },
    )
}

@Composable
private fun RelationRow(
    rel: Relation,
    onOpenProfile: (String) -> Unit,
    onRemove: (String) -> Unit,
    incoming: Boolean,
    onAdd: (String) -> Unit,
) {
    ListItem(
        modifier = Modifier.clickableRow { onOpenProfile(rel.handle) },
        leadingContent = { Avatar(rel.handle, rel.hasPhoto) },
        headlineContent = { Text(rel.displayName ?: "@${rel.handle}") },
        supportingContent = {
            val parts = buildList {
                add("@${rel.handle}")
                rel.type?.let { add(it) }
                if (rel.mutual) add("réciproque")
            }
            Text(parts.joinToString(" · "))
        },
        trailingContent = {
            if (incoming) {
                IconButton(onClick = { onAdd(rel.handle) }) {
                    Icon(Icons.Default.PersonAdd, contentDescription = "Ajouter en retour")
                }
            } else {
                IconButton(onClick = { onRemove(rel.handle) }) {
                    Icon(Icons.Default.PersonRemove, contentDescription = "Retirer")
                }
            }
        },
    )
}

@Composable
private fun SectionHeader(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
    )
}

@Composable
private fun EmptyHint(text: String) {
    Text(text, modifier = Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun CenteredSpinner() {
    Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}

/** Superpositions liées aux invitations : scanner QR, lien à partager, confirmation. */
@Composable
private fun InviteOverlays(
    scanning: Boolean,
    inviteLink: String?,
    inviteHandle: String?,
    onScanned: (String) -> Unit,
    onStopScan: () -> Unit,
    onDismissLink: () -> Unit,
    onConfirm: () -> Unit,
    onDismissConfirm: () -> Unit,
) {
    val ctx = LocalContext.current
    var granted by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { g ->
        granted = g
        if (!g) onStopScan()
    }
    LaunchedEffect(scanning) { if (scanning && !granted) permLauncher.launch(Manifest.permission.CAMERA) }

    if (scanning && granted) {
        Dialog(onDismissRequest = onStopScan, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Box(Modifier.fillMaxSize()) {
                QrScanner(onResult = onScanned, modifier = Modifier.fillMaxSize())
                TextButton(onClick = onStopScan, modifier = Modifier.align(Alignment.TopStart).padding(12.dp)) {
                    Text("Annuler")
                }
            }
        }
    }

    if (inviteLink != null) {
        AlertDialog(
            onDismissRequest = onDismissLink,
            title = { Text("Inviter un contact") },
            text = {
                Column {
                    Text("Partagez ce lien à usage unique. Au scan/clic, la personne devient votre contact.")
                    Text(inviteLink, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 8.dp))
                }
            },
            confirmButton = {
                Button(onClick = {
                    val send = Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"
                        putExtra(Intent.EXTRA_TEXT, "Rejoignez-moi sur mindlog : $inviteLink")
                    }
                    ctx.startActivity(Intent.createChooser(send, "Partager l'invitation"))
                    onDismissLink()
                }) { Text("Partager") }
            },
            dismissButton = { TextButton(onClick = onDismissLink) { Text("Fermer") } },
        )
    }

    if (inviteHandle != null) {
        AlertDialog(
            onDismissRequest = onDismissConfirm,
            title = { Text("Invitation de contact") },
            text = { Text("Devenir contact de @$inviteHandle ? La messagerie chiffrée sera activée.") },
            confirmButton = { Button(onClick = onConfirm) { Text("Accepter") } },
            dismissButton = { TextButton(onClick = onDismissConfirm) { Text("Annuler") } },
        )
    }
}
