package today.mindlog.id.feature.agenda

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.activity.compose.BackHandler
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.EventAvailable
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
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
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import today.mindlog.id.core.model.AgendaEvent

@Composable
fun AgendaRoute(
    onBack: () -> Unit,
    openAddOnStart: Boolean = false,
    viewModel: AgendaViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    var showAvailability by remember { mutableStateOf(false) }

    if (showAvailability) {
        BackHandler { showAvailability = false }
        AvailabilityRoute(onBack = { showAvailability = false })
        return
    }

    AgendaScreen(
        uiState = uiState,
        onAdd = viewModel::addEvent,
        onDelete = viewModel::deleteEvent,
        onErrorShown = viewModel::clearError,
        onOpenAvailability = { showAvailability = true },
        onBack = onBack,
        openAddOnStart = openAddOnStart,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun AgendaScreen(
    uiState: AgendaUiState,
    onAdd: (title: String, startsAtIso: String, endsAtIso: String?, location: String?) -> Unit,
    onDelete: (Long) -> Unit,
    onErrorShown: () -> Unit,
    onOpenAvailability: () -> Unit,
    onBack: () -> Unit,
    openAddOnStart: Boolean = false,
) {
    var showDialog by remember { mutableStateOf(openAddOnStart) }
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            scope.launch { snackbarHostState.showSnackbar(it) }
            onErrorShown()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Agenda") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Retour")
                    }
                },
                actions = {
                    IconButton(onClick = onOpenAvailability) {
                        Icon(Icons.Default.EventAvailable, contentDescription = "Disponibilités")
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            Column(Modifier.fillMaxSize()) {
                if (uiState.refreshing) LinearProgressIndicator(Modifier.fillMaxWidth())
                when {
                    uiState.events.isNotEmpty() -> EventList(uiState.events, onDelete)
                    uiState.refreshing -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                        CircularProgressIndicator()
                    }
                    else -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                        Text("Aucun événement. Touche + pour en ajouter. 🦎")
                    }
                }
            }
        }
    }

    if (showDialog) {
        AddEventDialog(
            onDismiss = { showDialog = false },
            onConfirm = { title, startsAtIso, location ->
                onAdd(title, startsAtIso, null, location)
                showDialog = false
            },
        )
    }
}

@Composable
private fun EventList(events: List<AgendaEvent>, onDelete: (Long) -> Unit) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        items(events, key = { it.id }) { event ->
            ListItem(
                headlineContent = { Text(event.title) },
                supportingContent = {
                    Column {
                        Text(formatEvent(event.startsAt), style = MaterialTheme.typography.bodySmall)
                        event.location?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                    }
                },
                trailingContent = {
                    IconButton(onClick = { onDelete(event.id) }) {
                        Icon(Icons.Default.Delete, contentDescription = "Supprimer")
                    }
                },
            )
        }
    }
}
