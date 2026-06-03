package today.mindlog.id.feature.chat

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import today.mindlog.id.core.model.Attachment
import today.mindlog.id.core.model.ChatMessage

@Composable
internal fun MessageList(
    messages: List<ChatMessage>,
    revealed: Set<Long>,
    onReact: (Long, String) -> Unit,
    onDelete: (Long) -> Unit,
    onReveal: (Long) -> Unit,
    loadAttachment: suspend (Attachment) -> ByteArray?,
) {
    val listState = rememberLazyListState()
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.lastIndex)
    }
    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        items(messages, key = { it.id }) { m -> MessageBubble(m, m.id in revealed, onReact, onDelete, onReveal, loadAttachment) }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun MessageBubble(
    m: ChatMessage,
    revealed: Boolean,
    onReact: (Long, String) -> Unit,
    onDelete: (Long) -> Unit,
    onReveal: (Long) -> Unit,
    loadAttachment: suspend (Attachment) -> ByteArray?,
) {
    // Note système (changement de minuterie) : ligne centrée grise, non interactive.
    val sys = m.systemText
    if (sys != null) {
        Text(
            sys,
            Modifier.fillMaxWidth().padding(vertical = 4.dp),
            textAlign = TextAlign.Center,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        return
    }
    // Historique d'appel : ligne d'info centrée (comme une note système).
    val callLog = parseCallLog(m.text)
    if (callLog != null) {
        Text(
            callLabel(callLog, m.mine, formatTime(m.createdAt)),
            Modifier.fillMaxWidth().padding(vertical = 4.dp),
            textAlign = TextAlign.Center,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        return
    }
    var menuOpen by remember { mutableStateOf(false) }
    val bubbleColor = if (m.mine) MaterialTheme.colorScheme.primaryContainer
    else MaterialTheme.colorScheme.surfaceVariant
    val align = if (m.mine) Alignment.End else Alignment.Start

    Column(Modifier.fillMaxWidth(), horizontalAlignment = align) {
        Box {
            Column(
                Modifier
                    .widthIn(max = 300.dp)
                    .background(bubbleColor, RoundedCornerShape(14.dp))
                    .combinedClickable(onClick = {}, onLongClick = { menuOpen = true })
                    .padding(horizontal = 12.dp, vertical = 8.dp),
            ) {
                val att = m.attachment
                when {
                    // Lecture unique côté émetteur : tombstone (non re-lisible).
                    m.readOnce && m.mine ->
                        Text("👁 Message à lecture unique", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    // Reçu, pas encore révélé : cache cliquable → révèle + brûle.
                    m.readOnce && !revealed ->
                        Text(
                            "👁 Message à lecture unique — toucher pour voir",
                            Modifier.combinedClickable(onClick = { onReveal(m.id) }, onLongClick = {}),
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.primary,
                        )
                    att != null -> AttachmentView(att, loadAttachment)
                    else -> Text(m.text ?: "🔒 (indéchiffrable)", style = MaterialTheme.typography.bodyLarge)
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(formatTime(m.createdAt), style = MaterialTheme.typography.labelSmall)
                    if (m.mine) {
                        Text(
                            "  " + if (m.read || m.delivered) "✓✓" else "✓",
                            style = MaterialTheme.typography.labelSmall,
                        )
                    }
                }
            }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                Row(Modifier.padding(horizontal = 8.dp)) {
                    QUICK_EMOJIS.forEach { em ->
                        IconButton(onClick = { onReact(m.id, em); menuOpen = false }) { Text(em) }
                    }
                }
                if (m.mine) {
                    DropdownMenuItem(
                        text = { Text("Supprimer") },
                        onClick = { onDelete(m.id); menuOpen = false },
                    )
                }
            }
        }
        if (m.reactions.isNotEmpty()) {
            Text(
                m.reactions.joinToString(" ") { it.emoji + if (it.count > 1) " ${it.count}" else "" },
                style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.padding(horizontal = 4.dp),
            )
        }
    }
}
