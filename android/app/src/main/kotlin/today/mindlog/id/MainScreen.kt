package today.mindlog.id

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.Message
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Event
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import today.mindlog.id.core.model.Badges
import today.mindlog.id.feature.agenda.AgendaRoute
import today.mindlog.id.feature.agenda.AvailabilityRoute
import today.mindlog.id.feature.card.CardRoute
import today.mindlog.id.feature.chat.ChatListRoute
import today.mindlog.id.feature.chat.ChatRoute
import today.mindlog.id.feature.chat.DevicesScreen
import today.mindlog.id.feature.chat.GroupChatRoute
import today.mindlog.id.feature.chat.GroupListRoute
import today.mindlog.id.feature.home.HomeRoute
import today.mindlog.id.feature.home.SettingsRoute
import today.mindlog.id.feature.notifications.NotificationsRoute
import today.mindlog.id.feature.relations.RelationsRoute
import today.mindlog.id.feature.requests.RequestsRoute

private enum class TopLevelDestination(
    val route: String,
    val label: String,
    val icon: ImageVector,
    val badge: (Badges) -> Int,
) {
    HOME("home", "Accueil", Icons.Default.Home, { 0 }),
    CHAT("chat", "Chat", Icons.AutoMirrored.Filled.Chat, { 0 }),
    RELATIONS("relations", "Réseau", Icons.Default.Group, { it.incoming }),
    PROFILE("profile", "Profil", Icons.Default.Person, { 0 }),
}

/** Conteneur principal (utilisateur connecté) : barre custom + FAB central + badges. */
@Composable
fun MainScreen(
    onSignedOut: () -> Unit,
    badgesViewModel: BadgesViewModel = hiltViewModel(),
) {
    val navController = rememberNavController()
    val badges by badgesViewModel.badges.collectAsStateWithLifecycle()
    val openProfile by badgesViewModel.openProfile.collectAsStateWithLifecycle()
    val openChat by badgesViewModel.openChat.collectAsStateWithLifecycle()
    val backStack by navController.currentBackStackEntryAsState()
    val current = backStack?.destination
    var showCompose by remember { mutableStateOf(false) }

    LaunchedEffect(current?.route) { badgesViewModel.refresh() }

    LaunchedEffect(openProfile) {
        if (openProfile != null) navController.navigateTopLevel(TopLevelDestination.RELATIONS.route)
    }

    LaunchedEffect(openChat) {
        openChat?.let { handle ->
            navController.navigate("chat/$handle") { launchSingleTop = true }
            badgesViewModel.consumeChat()
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        bottomBar = {
            MindlogBottomBar(
                current = current?.route,
                badges = badges,
                onNavigate = { navController.navigateTopLevel(it) },
                onCompose = { showCompose = true },
            )
        },
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = TopLevelDestination.HOME.route,
            modifier = Modifier.padding(padding),
        ) {
            composable(TopLevelDestination.HOME.route) {
                HomeRoute(
                    onOpenCard = { navController.navigateTopLevel(TopLevelDestination.PROFILE.route) },
                    onOpenAgenda = { navController.navigate("agenda") },
                    onOpenAvailability = { navController.navigate("availability") },
                    onOpenRequests = { navController.navigate("requests") },
                    onOpenNotifications = { navController.navigate("notifications") },
                    onOpenSettings = { navController.navigate("settings") },
                    onOpenChatTab = { navController.navigateTopLevel(TopLevelDestination.CHAT.route) },
                    onOpenChat = { handle -> navController.navigate("chat/$handle") },
                )
            }
            composable(TopLevelDestination.CHAT.route) {
                ChatListRoute(
                    onOpenChat = { handle -> navController.navigate("chat/$handle") },
                    onOpenGroups = { navController.navigate("groups") },
                )
            }
            composable(TopLevelDestination.RELATIONS.route) {
                RelationsRoute(onOpenGroups = { navController.navigate("groups") })
            }
            composable(TopLevelDestination.PROFILE.route) { CardRoute(onSignedOut = onSignedOut) }

            composable(
                route = "agenda?add={add}",
                arguments = listOf(navArgument("add") { type = NavType.BoolType; defaultValue = false }),
            ) { entry ->
                AgendaRoute(
                    onBack = { navController.popBackStack() },
                    openAddOnStart = entry.arguments?.getBoolean("add") == true,
                )
            }
            composable("availability") { AvailabilityRoute(onBack = { navController.popBackStack() }) }
            composable("requests") { RequestsRoute(onBack = { navController.popBackStack() }) }
            composable("notifications") { NotificationsRoute() }
            composable("settings") {
                SettingsRoute(
                    onBack = { navController.popBackStack() },
                    onSignedOut = onSignedOut,
                )
            }
            composable(
                route = "chat/{handle}",
                arguments = listOf(navArgument("handle") { type = NavType.StringType }),
            ) {
                ChatRoute(
                    onBack = { navController.popBackStack() },
                    onOpenDevices = { navController.navigate("devices") },
                )
            }
            composable("devices") {
                DevicesScreen(onBack = { navController.popBackStack() })
            }
            composable("groups") {
                GroupListRoute(
                    onBack = { navController.popBackStack() },
                    onOpenGroup = { gid -> navController.navigate("group/$gid") },
                )
            }
            composable(
                route = "group/{gid}",
                arguments = listOf(navArgument("gid") { type = NavType.StringType }),
            ) {
                GroupChatRoute(onBack = { navController.popBackStack() })
            }
        }
    }

    if (showCompose) {
        ComposeSheet(
            onDismiss = { showCompose = false },
            onNewMessage = { showCompose = false; navController.navigateTopLevel(TopLevelDestination.CHAT.route) },
            onNewConnection = { showCompose = false; navController.navigateTopLevel(TopLevelDestination.RELATIONS.route) },
            onNewEvent = { showCompose = false; navController.navigate("agenda?add=true") },
        )
    }
}

/** Navigue vers une destination de premier niveau.
 *  Si cet onglet (ou une de ses sous-pages : agenda, paramètres, chat/{handle}…)
 *  est déjà dans la pile, on dépile jusqu'à sa racine → ferme les pages ouvertes
 *  et revient à l'onglet (corrige « Accueil ne fait rien » depuis une sous-page).
 *  Sinon, bascule d'onglet classique en préservant l'état sauvegardé. */
private fun NavHostController.navigateTopLevel(route: String) {
    if (popBackStack(route, inclusive = false)) return
    navigate(route) {
        popUpTo(graph.findStartDestination().id) {
            saveState = true
            inclusive = false
        }
        launchSingleTop = true
        restoreState = true
    }
}

@Composable
private fun MindlogBottomBar(
    current: String?,
    badges: Badges,
    onNavigate: (String) -> Unit,
    onCompose: () -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        tonalElevation = 3.dp,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(68.dp)
                .padding(horizontal = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceEvenly,
        ) {
            BottomItem(TopLevelDestination.HOME, current, badges, onNavigate, Modifier.weight(1f))
            BottomItem(TopLevelDestination.CHAT, current, badges, onNavigate, Modifier.weight(1f))
            Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                Surface(
                    onClick = onCompose,
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                    modifier = Modifier.size(52.dp),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(Icons.Default.Add, contentDescription = "Nouveau", modifier = Modifier.size(26.dp))
                    }
                }
            }
            BottomItem(TopLevelDestination.RELATIONS, current, badges, onNavigate, Modifier.weight(1f))
            BottomItem(TopLevelDestination.PROFILE, current, badges, onNavigate, Modifier.weight(1f))
        }
    }
}

@Composable
private fun BottomItem(
    dest: TopLevelDestination,
    current: String?,
    badges: Badges,
    onNavigate: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val selected = current == dest.route
    val tint = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
    val count = dest.badge(badges)
    Column(
        modifier = modifier
            .height(68.dp)
            .clickable { onNavigate(dest.route) },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        BadgedBox(badge = { if (count > 0) Badge { Text(if (count > 99) "99+" else "$count") } }) {
            Icon(dest.icon, contentDescription = dest.label, tint = tint, modifier = Modifier.size(24.dp))
        }
        Text(
            dest.label,
            style = MaterialTheme.typography.labelSmall,
            color = tint,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            modifier = Modifier.padding(top = 2.dp),
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ComposeSheet(
    onDismiss: () -> Unit,
    onNewMessage: () -> Unit,
    onNewConnection: () -> Unit,
    onNewEvent: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(bottom = 24.dp)) {
            ListItem(
                headlineContent = { Text("Nouveau message") },
                leadingContent = { Icon(Icons.AutoMirrored.Filled.Message, contentDescription = null) },
                modifier = Modifier.clickable(onClick = onNewMessage),
            )
            ListItem(
                headlineContent = { Text("Ajouter une connexion") },
                leadingContent = { Icon(Icons.Default.PersonAdd, contentDescription = null) },
                modifier = Modifier.clickable(onClick = onNewConnection),
            )
            ListItem(
                headlineContent = { Text("Nouvel événement") },
                leadingContent = { Icon(Icons.Default.Event, contentDescription = null) },
                modifier = Modifier.clickable(onClick = onNewEvent),
            )
        }
    }
}
