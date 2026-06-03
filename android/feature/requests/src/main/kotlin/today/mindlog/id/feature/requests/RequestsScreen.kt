package today.mindlog.id.feature.requests

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import today.mindlog.id.core.model.MeetingRequest
import today.mindlog.id.core.model.RequestStatus

@Composable
fun RequestsRoute(
    onBack: () -> Unit,
    viewModel: RequestsViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    // Resynchronise à chaque entrée sur l'onglet (le ViewModel survit aux changements
    // d'onglet, donc init ne suffit pas à rattraper une demande arrivée entre-temps).
    LaunchedEffect(Unit) { viewModel.refresh() }
    RequestsScreen(
        uiState = uiState,
        onAccept = viewModel::accept,
        onDecline = viewModel::decline,
        onDelete = viewModel::delete,
        onErrorShown = viewModel::clearError,
        onBack = onBack,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun RequestsScreen(
    uiState: RequestsUiState,
    onAccept: (Long) -> Unit,
    onDecline: (Long) -> Unit,
    onDelete: (Long) -> Unit,
    onErrorShown: () -> Unit,
    onBack: () -> Unit,
) {
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
                title = { Text("Demandes de RDV") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Retour")
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                uiState.requests.isNotEmpty() -> LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(uiState.requests, key = { it.id }) { req ->
                        RequestCard(req, onAccept, onDecline, onDelete)
                    }
                }

                uiState.loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))

                else -> Text(
                    "Aucune demande pour le moment. 🦎",
                    modifier = Modifier.align(Alignment.Center),
                )
            }
        }
    }
}

@Composable
private fun RequestCard(
    req: MeetingRequest,
    onAccept: (Long) -> Unit,
    onDecline: (Long) -> Unit,
    onDelete: (Long) -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(req.name, style = MaterialTheme.typography.titleMedium)
                StatusChip(req.status)
            }
            slotLabel(req.day, req.time)?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
            req.message?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            req.email?.let { Text(it, style = MaterialTheme.typography.bodySmall) }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (req.status == RequestStatus.PENDING) {
                    TextButton(onClick = { onAccept(req.id) }) { Text("Accepter") }
                    TextButton(onClick = { onDecline(req.id) }) { Text("Refuser") }
                }
                OutlinedButton(onClick = { onDelete(req.id) }) { Text("Supprimer") }
            }
        }
    }
}

@Composable
private fun StatusChip(status: RequestStatus) {
    val label = when (status) {
        RequestStatus.PENDING -> "En attente"
        RequestStatus.ACCEPTED -> "Accepté"
        RequestStatus.DECLINED -> "Refusé"
    }
    AssistChip(onClick = {}, label = { Text(label) })
}

private fun slotLabel(day: String?, time: String?): String? = when {
    day != null && time != null -> "Créneau souhaité : $day à $time"
    day != null -> "Jour souhaité : $day"
    else -> null
}
