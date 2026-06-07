package today.mindlog.id.core.designsystem.component

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/** Élément d'une subrail (icône verticale à gauche + body à droite). */
data class SubrailTab(
    val key: String,
    val label: String,
    val icon: ImageVector,
    val badge: Int = 0,
)

/**
 * Subrail mobile : barre d'icônes verticale (gauche, ~64dp) + corps scrollable.
 * Mirroir du pattern Web `.subrail` (Agenda Dispo/Événements/RDV, Identité Profil/Réseaux…).
 *
 * Le tab sélectionné est mémorisé via [rememberSaveable] (clé optionnelle pour
 * différencier plusieurs subrails dans la même nav backstack).
 */
@Composable
fun SubrailScaffold(
    tabs: List<SubrailTab>,
    modifier: Modifier = Modifier,
    saveKey: String = "subrail",
    initialIndex: Int = 0,
    body: @Composable (selectedKey: String) -> Unit,
) {
    var selected by rememberSaveable(saveKey) { mutableIntStateOf(initialIndex.coerceIn(0, tabs.lastIndex)) }
    Row(modifier = modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .width(64.dp)
                .fillMaxHeight()
                .background(MaterialTheme.colorScheme.surfaceContainer)
                .verticalScroll(rememberScrollState())
                .padding(vertical = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            tabs.forEachIndexed { index, tab ->
                SubrailButton(
                    tab = tab,
                    selected = index == selected,
                    onClick = { selected = index },
                )
            }
        }
        Box(modifier = Modifier.fillMaxSize()) {
            val key = tabs.getOrNull(selected)?.key ?: tabs.first().key
            body(key)
        }
    }
}

@Composable
private fun SubrailButton(
    tab: SubrailTab,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val container = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainer
    val content = if (selected) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant
    Column(
        modifier = Modifier
            .width(56.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(container)
            .clickable(onClick = onClick)
            .padding(vertical = 8.dp, horizontal = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        BadgedBox(badge = {
            if (tab.badge > 0) Badge { Text(if (tab.badge > 99) "99+" else "${tab.badge}") }
        }) {
            Icon(tab.icon, contentDescription = tab.label, tint = content, modifier = Modifier.size(22.dp))
        }
        Text(
            text = tab.label,
            style = MaterialTheme.typography.labelSmall,
            color = content,
            textAlign = TextAlign.Center,
            maxLines = 2,
        )
    }
}
