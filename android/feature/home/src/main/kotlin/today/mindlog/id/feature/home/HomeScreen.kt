package today.mindlog.id.feature.home

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Badge
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.EventAvailable
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import today.mindlog.id.core.designsystem.component.Avatar
import today.mindlog.id.core.designsystem.component.QuickActionTile
import today.mindlog.id.core.designsystem.component.SectionCard
import today.mindlog.id.core.designsystem.component.SectionHeader
import today.mindlog.id.core.designsystem.component.UnreadBadge
import today.mindlog.id.core.designsystem.component.VerifiedHandle
import today.mindlog.id.core.designsystem.component.mindlogPhotoUrl
import today.mindlog.id.core.model.AgendaEvent
import today.mindlog.id.core.model.Card
import today.mindlog.id.core.model.ConversationSummary
import java.time.format.DateTimeFormatter
import java.util.Locale

private const val HOST = "id.mindlog.today"

@Composable
fun HomeRoute(
    onOpenCard: () -> Unit,
    onOpenAgenda: () -> Unit,
    onOpenAvailability: () -> Unit,
    onOpenRequests: () -> Unit,
    onOpenNotifications: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenChatTab: () -> Unit,
    onOpenChat: (String) -> Unit,
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    HomeScreen(
        uiState = uiState,
        onOpenCard = onOpenCard,
        onOpenAgenda = onOpenAgenda,
        onOpenAvailability = onOpenAvailability,
        onOpenRequests = onOpenRequests,
        onOpenNotifications = onOpenNotifications,
        onOpenSettings = onOpenSettings,
        onOpenChatTab = onOpenChatTab,
        onOpenChat = onOpenChat,
    )
}

@Composable
internal fun HomeScreen(
    uiState: HomeUiState,
    onOpenCard: () -> Unit,
    onOpenAgenda: () -> Unit,
    onOpenAvailability: () -> Unit,
    onOpenRequests: () -> Unit,
    onOpenNotifications: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenChatTab: () -> Unit,
    onOpenChat: (String) -> Unit,
) {
    val card = uiState.card
    val handle = card?.handle ?: ""
    val context = LocalContext.current
    val publicUrl = "$HOST/@$handle"

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Spacer(Modifier.height(4.dp))
        TopHeader(
            onOpenNotifications = onOpenNotifications,
            onOpenSettings = onOpenSettings,
        )

        ProfileBlock(
            card = card,
            verified = uiState.hasVault,
            onShare = {
                val intent = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, "https://$publicUrl")
                }
                context.startActivity(Intent.createChooser(intent, "Partager ma page"))
            },
            onEdit = onOpenCard,
        )

        QuickActions(
            onOpenCard = onOpenCard,
            onOpenAgenda = onOpenAgenda,
            onOpenAvailability = onOpenAvailability,
            onOpenRequests = onOpenRequests,
        )

        TopContactsCard(
            conversations = uiState.conversations,
            onOpenChat = onOpenChat,
            onOpenChatTab = onOpenChatTab,
        )

        EventsCard(events = uiState.events, onOpenAgenda = onOpenAgenda)

        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun TopHeader(onOpenNotifications: () -> Unit, onOpenSettings: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Image(
                painter = painterResource(R.drawable.milo),
                contentDescription = "Milo, la mascotte",
                modifier = Modifier.size(34.dp),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                "mindlog",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary,
            )
            Text(
                " · id",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onBackground,
            )
        }
        Row {
            IconButton(onClick = onOpenNotifications) {
                Icon(Icons.Default.Notifications, contentDescription = "Alertes")
            }
            IconButton(onClick = onOpenSettings) {
                Icon(Icons.Default.Settings, contentDescription = "Réglages")
            }
        }
    }
}

@Composable
private fun ProfileBlock(card: Card?, verified: Boolean, onShare: () -> Unit, onEdit: () -> Unit) {
    val handle = card?.handle ?: "—"
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Avatar(
            handle = handle,
            photoUrl = if (card?.hasPhoto == true) mindlogPhotoUrl(handle) else null,
            size = 72.dp,
            presence = true,
        )
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            VerifiedHandle(handle = handle, verified = verified, style = MaterialTheme.typography.titleMedium)
            card?.displayName?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            card?.field("title", "role", "job")?.let { title ->
                val site = card.field("website", "site", "url", "domain")
                Text(
                    text = if (site != null) "$title · $site" else title,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            card?.field("location", "city", "place")?.let {
                Text("📍 $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            OutlinedButton(onClick = onShare, contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 6.dp)) {
                Icon(Icons.Default.Share, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text("Partager", style = MaterialTheme.typography.labelMedium)
            }
            OutlinedButton(onClick = onEdit, contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 6.dp)) {
                Icon(Icons.Default.Edit, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text("Éditer ma page", style = MaterialTheme.typography.labelMedium)
            }
        }
    }
}

@Composable
private fun QuickActions(
    onOpenCard: () -> Unit,
    onOpenAgenda: () -> Unit,
    onOpenAvailability: () -> Unit,
    onOpenRequests: () -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
        QuickActionTile(Icons.Default.Badge, "Ma carte", onOpenCard, Modifier.weight(1f))
        QuickActionTile(Icons.Default.CalendarMonth, "Agenda", onOpenAgenda, Modifier.weight(1f))
        QuickActionTile(Icons.Default.Schedule, "Disponibilités", onOpenAvailability, Modifier.weight(1f))
        QuickActionTile(Icons.Default.Inbox, "Demandes", onOpenRequests, Modifier.weight(1f))
    }
}

@Composable
private fun TopContactsCard(
    conversations: List<ConversationSummary>,
    onOpenChat: (String) -> Unit,
    onOpenChatTab: () -> Unit,
) {
    val top = remember(conversations) {
        conversations.sortedByDescending { it.msgCount }.take(10)
    }
    SectionCard {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Column {
                    Text("Top contacts", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            Icons.Default.Lock,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(12.dp),
                        )
                        Spacer(Modifier.width(4.dp))
                        Text(
                            "Chiffré de bout en bout",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                Text(
                    "Voir tout",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.clickable(onClick = onOpenChatTab),
                )
            }
            if (top.isEmpty()) {
                Text(
                    "Aucun échange pour l'instant.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                top.forEachIndexed { i, conv ->
                    TopContactRow(rank = i + 1, conv = conv, onClick = { onOpenChat(conv.handle) })
                }
            }
        }
    }
}

@Composable
private fun TopContactRow(rank: Int, conv: ConversationSummary, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            "#$rank",
            style = MaterialTheme.typography.labelSmall,
            color = if (rank <= 3) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = if (rank <= 3) FontWeight.Bold else FontWeight.Normal,
            modifier = Modifier.width(22.dp),
        )
        Avatar(
            handle = conv.handle,
            photoUrl = if (conv.hasPhoto) mindlogPhotoUrl(conv.handle) else null,
            size = 34.dp,
        )
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                "@${conv.handle}",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                MediaChip("TXT")
                if (conv.msgCount >= 4) MediaChip("🎵")
                if (conv.msgCount >= 10) MediaChip("📹")
            }
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                "${conv.msgCount}",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                "msgs",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            UnreadBadge(conv.unread)
        }
    }
}

@Composable
private fun MediaChip(label: String) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(4.dp),
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp),
        )
    }
}

@Composable
private fun EventsCard(events: List<AgendaEvent>, onOpenAgenda: () -> Unit) {
    val next = events.minByOrNull { it.startsAt }
    SectionCard {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            SectionHeader("Prochains événements", actionLabel = "Voir tout", onAction = onOpenAgenda)
            if (next == null) {
                Text(
                    "Aucun événement à venir.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                EventRow(next)
            }
            AvailableCard()
        }
    }
}

@Composable
private fun EventRow(event: AgendaEvent) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        DateBadge(event.startsAt)
        Column(Modifier.weight(1f)) {
            Text(event.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(timeRange(event), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (!event.link.isNullOrBlank()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Videocam, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(4.dp))
                Text("Visio", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun DateBadge(startsAt: String) {
    val dt = today.mindlog.id.core.designsystem.parseIsoLocal(startsAt)
    Column(
        modifier = Modifier
            .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(12.dp))
            .padding(horizontal = 14.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            dt?.format(DOW_FMT)?.uppercase(Locale.FRENCH) ?: "—",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.primary,
            fontWeight = FontWeight.Bold,
        )
        Text(dt?.dayOfMonth?.toString() ?: "", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Text(
            dt?.format(MON_FMT)?.uppercase(Locale.FRENCH) ?: "",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun AvailableCard() {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.primaryContainer, RoundedCornerShape(16.dp))
            .border(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.4f), RoundedCornerShape(16.dp))
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Column {
            Text("Disponible", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary)
            Text("Demain · toute la journée", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Icon(Icons.Default.EventAvailable, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
    }
}

/* ----------------------------- Helpers ---------------------------------- */

private val DOW_FMT = DateTimeFormatter.ofPattern("EEE", Locale.FRENCH)
private val MON_FMT = DateTimeFormatter.ofPattern("MMM", Locale.FRENCH)
private val HM_FMT = DateTimeFormatter.ofPattern("HH:mm", Locale.getDefault())

private fun Card.field(vararg keys: String): String? =
    keys.firstNotNullOfOrNull { k -> fields.firstOrNull { it.key == k }?.value?.takeIf { it.isNotBlank() } }

private fun timeRange(event: AgendaEvent): String {
    val start = today.mindlog.id.core.designsystem.parseIsoLocal(event.startsAt)?.format(HM_FMT) ?: ""
    val end = event.endsAt?.let { today.mindlog.id.core.designsystem.parseIsoLocal(it)?.format(HM_FMT) }
    return if (end != null) "$start - $end" else start
}
