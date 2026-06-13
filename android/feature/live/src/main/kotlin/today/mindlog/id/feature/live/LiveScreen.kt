package today.mindlog.id.feature.live

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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.Radio
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import today.mindlog.id.core.network.dto.LiveDto

private enum class Screen { LIST, BROADCASTER, VIEWER }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LiveRoute(
    viewModel: LiveViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val snackbarHost = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var screen by remember { mutableStateOf(Screen.LIST) }
    var openedLive by remember { mutableStateOf<LiveDto?>(null) }

    LaunchedEffect(state.error) {
        state.error?.let { scope.launch { snackbarHost.showSnackbar(it) }; viewModel.clearError() }
    }

    when (screen) {
        Screen.BROADCASTER -> {
            BroadcasterRoute(onBack = { screen = Screen.LIST; viewModel.refresh() })
            return
        }
        Screen.VIEWER -> {
            ViewerRoute(live = openedLive!!, onClose = { screen = Screen.LIST; openedLive = null })
            return
        }
        Screen.LIST -> Unit
    }

    var selected by remember { mutableStateOf(0) }
    val tabs = listOf(
        Triple("Direct", Icons.Default.Radio, state.live),
        Triple("À venir", Icons.Default.Schedule, state.upcoming),
        Triple("Mes lives", Icons.Default.Videocam, state.mine),
    )

    Scaffold(
        topBar = { TopAppBar(title = { Text("Live") }) },
        snackbarHost = { SnackbarHost(snackbarHost) },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { screen = Screen.BROADCASTER },
                icon = { Icon(Icons.Default.Add, contentDescription = null) },
                text = { Text("Démarrer un live") },
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            TabRow(selectedTabIndex = selected) {
                tabs.forEachIndexed { index, (label, icon, list) ->
                    Tab(
                        selected = index == selected,
                        onClick = { selected = index },
                        text = { Text(label) },
                        icon = {
                            BadgedBox(badge = {
                                if (list.isNotEmpty() && index != 2) Badge { Text("${list.size}") }
                            }) {
                                Icon(icon, contentDescription = label)
                            }
                        },
                    )
                }
            }
            if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            LiveList(
                items = tabs[selected].third,
                onOpen = { openedLive = it; screen = Screen.VIEWER },
            )
        }
    }
}

@Composable
private fun LiveList(items: List<LiveDto>, onOpen: (LiveDto) -> Unit) {
    if (items.isEmpty()) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("Rien à afficher pour le moment.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        return
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(items, key = { it.id }) { live ->
            LiveCard(live = live, onClick = { onOpen(live) })
        }
    }
}

@Composable
private fun LiveCard(live: LiveDto, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Box(modifier = Modifier.padding(14.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        Icons.Default.PlayCircle,
                        contentDescription = null,
                        tint = if (live.status == "live") Color(0xFFE8503A) else MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(24.dp),
                    )
                    Text(
                        live.title.ifBlank { "Live #${live.id}" },
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(start = 8.dp),
                    )
                }
                Text(
                    "@${live.handle}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (live.status == "live") {
                    Text(
                        "EN DIRECT · ${live.viewers} viewers",
                        style = MaterialTheme.typography.labelMedium,
                        color = Color(0xFFE8503A),
                        fontWeight = FontWeight.SemiBold,
                    )
                } else if (live.status == "scheduled") {
                    live.scheduledAt?.let {
                        Text(
                            "Prévu : $it",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                } else {
                    Text(
                        "Terminé",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}
