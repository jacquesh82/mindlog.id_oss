package today.mindlog.id.feature.notifications

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DeleteSweep
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
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import today.mindlog.id.core.data.ActivityEntry
import today.mindlog.id.core.model.AppNotification
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun NotificationsRoute(
    viewModel: NotificationsViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val activity by viewModel.activity.collectAsStateWithLifecycle()
    NotificationsScreen(
        uiState = uiState,
        activity = activity,
        onMarkAllRead = viewModel::markAllRead,
        onClearActivity = viewModel::clearActivity,
        onNotificationClick = viewModel::onNotificationClick,
        onErrorShown = viewModel::clearError,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun NotificationsScreen(
    uiState: NotificationsUiState,
    activity: List<ActivityEntry>,
    onMarkAllRead: () -> Unit,
    onClearActivity: () -> Unit,
    onNotificationClick: (AppNotification) -> Boolean,
    onErrorShown: () -> Unit,
) {
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var tab by remember { mutableIntStateOf(0) } // 0 = Activité récente, 1 = Journal des actions
    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            scope.launch { snackbarHostState.showSnackbar(it) }
            onErrorShown()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Activité") },
                actions = {
                    if (tab == 0 && uiState.notifications.any { !it.read }) {
                        IconButton(onClick = onMarkAllRead) {
                            Icon(Icons.Default.DoneAll, contentDescription = "Tout marquer lu")
                        }
                    }
                    if (tab == 1 && activity.isNotEmpty()) {
                        IconButton(onClick = onClearActivity) {
                            Icon(Icons.Default.DeleteSweep, contentDescription = "Vider le journal")
                        }
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            TabRow(selectedTabIndex = tab) {
                Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("Activité récente") })
                Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("Journal des actions") })
            }
            Box(Modifier.fillMaxSize()) {
                if (tab == 0) RecentPane(uiState, onNotificationClick) else JournalPane(activity)
            }
        }
    }
}

@Composable
private fun RecentPane(
    uiState: NotificationsUiState,
    onNotificationClick: (AppNotification) -> Boolean,
) {
    when {
        uiState.notifications.isNotEmpty() -> LazyColumn(Modifier.fillMaxSize()) {
            items(uiState.notifications, key = { it.id }) { notif ->
                NotificationRow(notif, onClick = { onNotificationClick(notif) })
                HorizontalDivider()
            }
        }

        uiState.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }

        else -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("Pas d'alerte. Tout est calme. 🦎")
        }
    }
}

@Composable
private fun JournalPane(activity: List<ActivityEntry>) {
    if (activity.isEmpty()) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("Aucune action enregistrée. 🦎", modifier = Modifier.padding(24.dp))
        }
        return
    }
    LazyColumn(Modifier.fillMaxSize()) {
        items(activity, key = { it.at }) { e ->
            ActivityRow(e)
            HorizontalDivider()
        }
    }
}

private val timeFmt = SimpleDateFormat("dd MMM HH:mm", Locale.FRENCH)

@Composable
private fun ActivityRow(e: ActivityEntry) {
    val accent = when (e.level) {
        "error" -> MaterialTheme.colorScheme.error
        "warn" -> Color(0xFFB58900)
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    ListItem(
        colors = when (e.level) {
            "error" -> ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.35f))
            else -> ListItemDefaults.colors()
        },
        leadingContent = {
            Surface(color = accent, shape = CircleShape, modifier = Modifier.size(10.dp)) {}
        },
        headlineContent = { Text(e.text, fontWeight = FontWeight.Medium) },
        supportingContent = {
            Column {
                if (e.detail.isNotBlank()) Text(e.detail, style = MaterialTheme.typography.bodySmall)
                Text(timeFmt.format(Date(e.at)), style = MaterialTheme.typography.labelSmall)
            }
        },
    )
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
