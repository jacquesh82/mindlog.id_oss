package today.mindlog.id.feature.notifications

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
import today.mindlog.id.core.model.AppNotification

@Composable
fun NotificationsRoute(
    viewModel: NotificationsViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    NotificationsScreen(
        uiState = uiState,
        onMarkAllRead = viewModel::markAllRead,
        onNotificationClick = viewModel::onNotificationClick,
        onErrorShown = viewModel::clearError,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun NotificationsScreen(
    uiState: NotificationsUiState,
    onMarkAllRead: () -> Unit,
    onNotificationClick: (AppNotification) -> Boolean,
    onErrorShown: () -> Unit,
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
                title = { Text("Alertes") },
                actions = {
                    if (uiState.notifications.any { !it.read }) {
                        IconButton(onClick = onMarkAllRead) {
                            Icon(Icons.Default.DoneAll, contentDescription = "Tout marquer lu")
                        }
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            when {
                uiState.notifications.isNotEmpty() -> LazyColumn(Modifier.fillMaxSize()) {
                    items(uiState.notifications, key = { it.id }) { notif ->
                        NotificationRow(notif, onClick = { onNotificationClick(notif) })
                        HorizontalDivider()
                    }
                }

                uiState.loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))

                else -> Text(
                    "Pas d'alerte. Tout est calme. 🦎",
                    modifier = Modifier.align(Alignment.Center),
                )
            }
        }
    }
}

@Composable
private fun NotificationRow(notif: AppNotification, onClick: () -> Unit) {
    ListItem(
        modifier = if (notif.link != null) Modifier.clickable(onClick = onClick) else Modifier,
        colors = if (notif.read) {
            ListItemDefaults.colors()
        } else {
            ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
        },
        leadingContent = {
            if (!notif.read) {
                Surface(
                    color = MaterialTheme.colorScheme.primary,
                    shape = CircleShape,
                    modifier = Modifier.size(10.dp),
                ) {}
            } else {
                Box(Modifier.size(10.dp))
            }
        },
        headlineContent = { Text(notif.text) },
        supportingContent = { Text(notif.createdAt, style = MaterialTheme.typography.labelSmall) },
    )
}
