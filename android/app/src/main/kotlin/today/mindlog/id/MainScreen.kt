package today.mindlog.id

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Radio
import androidx.compose.material.icons.filled.Workspaces
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import kotlinx.coroutines.launch
import today.mindlog.id.core.designsystem.component.SubrailScaffold
import today.mindlog.id.core.designsystem.component.SubrailTab
import today.mindlog.id.core.model.Badges
import today.mindlog.id.feature.agenda.AgendaRoute
import today.mindlog.id.feature.card.CardRoute
import today.mindlog.id.feature.chat.ChatListRoute
import today.mindlog.id.feature.chat.ChatRoute
import today.mindlog.id.feature.chat.DevicesScreen
import today.mindlog.id.feature.chat.GroupChatRoute
import today.mindlog.id.feature.chat.GroupListRoute
import today.mindlog.id.feature.gallery.GalleryRoute
import today.mindlog.id.feature.home.SettingsRoute
import today.mindlog.id.feature.live.LiveRoute
import today.mindlog.id.feature.notifications.NotificationsRoute
import today.mindlog.id.feature.premium.PremiumRoute
import today.mindlog.id.feature.relations.RelationsRoute
import today.mindlog.id.feature.requests.RequestsRoute

/**
 * 4 onglets du deck (strict mirroir du Web : `NAV = ["Chat", "Relations",
 * "Agenda", "Compte"]` dans `public/editor/index.js`).
 */
private enum class ColumnTab(
    val label: String,
    val icon: ImageVector,
    val badge: (Badges) -> Int = { 0 },
) {
    ECHANGES("Échanges", Icons.AutoMirrored.Filled.Chat, { it.unread }),
    RESEAU("Réseau", Icons.Default.Group, { it.incoming }),
    AGENDA("Agenda", Icons.Default.CalendarMonth, { it.pending }),
    COMPTE("Compte", Icons.Default.Person),
}

/** Routes hors-deck accessibles via le menu compte (header top-right). */
private enum class OverlayRoute { NOTIFICATIONS, IDENTITY, PREMIUM, GALLERY }

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MainScreen(
    onSignedOut: () -> Unit,
    badgesViewModel: BadgesViewModel = hiltViewModel(),
) {
    val pagerState = rememberPagerState(pageCount = { ColumnTab.entries.size })
    val scope = rememberCoroutineScope()
    val badges by badgesViewModel.badges.collectAsStateWithLifecycle()
    val openProfile by badgesViewModel.openProfile.collectAsStateWithLifecycle()
    val openChat by badgesViewModel.openChat.collectAsStateWithLifecycle()

    val echangesNav = rememberNavController()
    val reseauNav = rememberNavController()
    val agendaNav = rememberNavController()
    val compteNav = rememberNavController()

    var overlay by remember { mutableStateOf<OverlayRoute?>(null) }

    LaunchedEffect(pagerState.currentPage) { badgesViewModel.refresh() }
    LaunchedEffect(openProfile) {
        if (openProfile != null) scope.launch { pagerState.animateScrollToPage(ColumnTab.RESEAU.ordinal) }
    }
    LaunchedEffect(openChat) {
        openChat?.let { handle ->
            scope.launch { pagerState.animateScrollToPage(ColumnTab.ECHANGES.ordinal) }
            echangesNav.navigate("chat/$handle") { launchSingleTop = true }
            badgesViewModel.consumeChat()
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            MainTopBar(
                currentTab = ColumnTab.entries[pagerState.currentPage],
                unreadNotifs = badges.unread,
                onOpenNotifs = { overlay = OverlayRoute.NOTIFICATIONS },
                onOpenIdentity = { overlay = OverlayRoute.IDENTITY },
                onOpenPremium = { overlay = OverlayRoute.PREMIUM },
                onOpenGallery = { overlay = OverlayRoute.GALLERY },
            )
        },
        bottomBar = {
            DeckTabBar(
                selected = pagerState.currentPage,
                badges = badges,
                onSelect = { index -> scope.launch { pagerState.animateScrollToPage(index) } },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            HorizontalPager(
                state = pagerState,
                modifier = Modifier.fillMaxSize(),
                beyondViewportPageCount = 1,
            ) { page ->
                when (ColumnTab.entries[page]) {
                    ColumnTab.ECHANGES -> EchangesTabHost(echangesNav)
                    ColumnTab.RESEAU -> ReseauTabHost(reseauNav)
                    ColumnTab.AGENDA -> AgendaTabHost(agendaNav)
                    ColumnTab.COMPTE -> CompteTabHost(compteNav, onSignedOut)
                }
            }
            overlay?.let { route ->
                OverlayHost(route = route, onClose = { overlay = null })
            }
        }
    }
}

/* ───── Tab hosts ──────────────────────────────────────────────────── */

@Composable
private fun EchangesTabHost(nav: NavHostController) {
    NavHost(nav, startDestination = "root") {
        composable("root") {
            SubrailScaffold(
                tabs = listOf(
                    SubrailTab("chats", "Discussions", Icons.AutoMirrored.Filled.Chat),
                    SubrailTab("groups", "Groupes", Icons.Default.Group),
                    SubrailTab("live", "Live", Icons.Default.Radio),
                ),
                saveKey = "echanges-subrail",
            ) { key ->
                when (key) {
                    "chats" -> ChatListRoute(
                        onOpenChat = { handle -> nav.navigate("chat/$handle") },
                        onOpenGroups = { nav.navigate("groups") },
                    )
                    "groups" -> GroupListRoute(
                        onBack = {},
                        onOpenGroup = { gid -> nav.navigate("group/$gid") },
                    )
                    "live" -> LiveRoute()
                    else -> ChatListRoute(
                        onOpenChat = { handle -> nav.navigate("chat/$handle") },
                        onOpenGroups = { nav.navigate("groups") },
                    )
                }
            }
        }
        composable(
            route = "chat/{handle}",
            arguments = listOf(navArgument("handle") { type = NavType.StringType }),
        ) {
            ChatRoute(
                onBack = { nav.popBackStack() },
                onOpenDevices = { nav.navigate("devices") },
            )
        }
        composable("devices") { DevicesScreen(onBack = { nav.popBackStack() }) }
        composable("groups") {
            GroupListRoute(
                onBack = { nav.popBackStack() },
                onOpenGroup = { gid -> nav.navigate("group/$gid") },
            )
        }
        composable(
            route = "group/{gid}",
            arguments = listOf(navArgument("gid") { type = NavType.StringType }),
        ) { GroupChatRoute(onBack = { nav.popBackStack() }) }
    }
}

@Composable
private fun ReseauTabHost(nav: NavHostController) {
    NavHost(nav, startDestination = "root") {
        composable("root") {
            RelationsRoute(onOpenGroups = { nav.navigate("groups") })
        }
        composable("groups") {
            GroupListRoute(
                onBack = { nav.popBackStack() },
                onOpenGroup = { gid -> nav.navigate("group/$gid") },
            )
        }
        composable(
            route = "group/{gid}",
            arguments = listOf(navArgument("gid") { type = NavType.StringType }),
        ) { GroupChatRoute(onBack = { nav.popBackStack() }) }
    }
}

@Composable
private fun AgendaTabHost(nav: NavHostController) {
    NavHost(nav, startDestination = "root") {
        composable(
            route = "root?add={add}",
            arguments = listOf(navArgument("add") { type = NavType.BoolType; defaultValue = false }),
        ) { entry ->
            AgendaRoute(
                onBack = {},
                openAddOnStart = entry.arguments?.getBoolean("add") == true,
            )
        }
    }
}

/**
 * Compte = SettingsRoute existant (parité avec Web qui regroupe Activité /
 * Sécurité / Accès / Données dans une même page accordéon). L'extraction en
 * subrail 4 entrées est un follow-up de refactor de SettingsScreen.
 */
@Composable
private fun CompteTabHost(nav: NavHostController, onSignedOut: () -> Unit) {
    NavHost(nav, startDestination = "root") {
        composable("root") {
            SettingsRoute(
                onBack = {},
                onSignedOut = onSignedOut,
            )
        }
    }
}

/* ───── Overlay (Notifs / Mon ID / Premium / Galerie) ────────────────── */

@Composable
private fun OverlayHost(route: OverlayRoute, onClose: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        when (route) {
            OverlayRoute.NOTIFICATIONS -> NotificationsRoute()
            OverlayRoute.IDENTITY -> CardRoute(onSignedOut = onClose)
            OverlayRoute.PREMIUM -> PremiumRoute()
            OverlayRoute.GALLERY -> GalleryRoute()
        }
        // Bouton « Fermer » flottant en haut-droite : sortir de l'overlay.
        IconButton(
            onClick = onClose,
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(top = 4.dp, end = 4.dp),
        ) {
            Icon(Icons.Default.Close, contentDescription = "Fermer")
        }
    }
}

/* ───── Top app bar (cloche + menu compte) ──────────────────────────── */

@Composable
private fun MainTopBar(
    currentTab: ColumnTab,
    unreadNotifs: Int,
    onOpenNotifs: () -> Unit,
    onOpenIdentity: () -> Unit,
    onOpenPremium: () -> Unit,
    onOpenGallery: () -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        tonalElevation = 1.dp,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp)
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "mindlog · id",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(start = 4.dp),
            )
            Box(modifier = Modifier.fillMaxHeight().weight(1f))
            // Cloche Notifications (mirroir du header bell Web).
            IconButton(onClick = onOpenNotifs) {
                BadgedBox(badge = {
                    if (unreadNotifs > 0) Badge { Text(if (unreadNotifs > 99) "99+" else "$unreadNotifs") }
                }) {
                    Icon(Icons.Default.Notifications, contentDescription = "Notifications")
                }
            }
            // Menu compte (Mon ID / Premium / Galerie) — mirroir du menu compte Web.
            var menuOpen by remember { mutableStateOf(false) }
            IconButton(onClick = { menuOpen = true }) {
                Icon(Icons.Default.MoreVert, contentDescription = "Menu compte")
            }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                DropdownMenuItem(
                    text = { Text("Mon ID") },
                    leadingIcon = { Icon(Icons.Default.Person, contentDescription = null) },
                    onClick = { menuOpen = false; onOpenIdentity() },
                )
                DropdownMenuItem(
                    text = { Text("Premium") },
                    leadingIcon = { Icon(Icons.Default.Workspaces, contentDescription = null) },
                    onClick = { menuOpen = false; onOpenPremium() },
                )
                DropdownMenuItem(
                    text = { Text("Galerie") },
                    leadingIcon = { Icon(Icons.Default.PhotoLibrary, contentDescription = null) },
                    onClick = { menuOpen = false; onOpenGallery() },
                )
            }
        }
    }
}

/* ───── Bottom deck tab bar ─────────────────────────────────────────── */

@Composable
private fun DeckTabBar(
    selected: Int,
    badges: Badges,
    onSelect: (Int) -> Unit,
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
                .padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceEvenly,
        ) {
            ColumnTab.entries.forEachIndexed { index, tab ->
                DeckTabItem(
                    tab = tab,
                    selected = index == selected,
                    count = tab.badge(badges),
                    onClick = { onSelect(index) },
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun DeckTabItem(
    tab: ColumnTab,
    selected: Boolean,
    count: Int,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val tint = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
    val container = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface
    Column(
        modifier = modifier
            .height(60.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(container)
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        BadgedBox(badge = {
            if (count > 0) Badge { Text(if (count > 99) "99+" else "$count") }
        }) {
            Icon(tab.icon, contentDescription = tab.label, tint = tint, modifier = Modifier.size(22.dp))
        }
        Text(
            tab.label,
            style = MaterialTheme.typography.labelSmall,
            color = tint,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            modifier = Modifier.padding(top = 2.dp),
        )
    }
}
