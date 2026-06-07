package today.mindlog.id.feature.agenda

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.TextStyle
import java.util.Locale

@Composable
fun AvailabilityRoute(
    onBack: () -> Unit,
    showBack: Boolean = true,
    viewModel: AvailabilityViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    AvailabilityScreen(
        uiState = uiState,
        onBack = onBack,
        showBack = showBack,
        onPrev = viewModel::prevMonth,
        onNext = viewModel::nextMonth,
        onToggleDay = viewModel::toggleDay,
        onErrorShown = viewModel::clearError,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun AvailabilityScreen(
    uiState: AvailabilityUiState,
    onBack: () -> Unit,
    onPrev: () -> Unit,
    onNext: () -> Unit,
    onToggleDay: (LocalDate) -> Unit,
    onErrorShown: () -> Unit,
    showBack: Boolean = true,
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
                title = { Text("Disponibilités") },
                navigationIcon = {
                    if (showBack) {
                        IconButton(onClick = onBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Retour")
                        }
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            if (uiState.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            MonthHeader(uiState.month, onPrev, onNext)
            WeekdayLabels()
            MonthGrid(uiState.month, uiState.overrides, onToggleDay)
            Legend()
        }
    }
}

@Composable
private fun MonthHeader(month: YearMonth, onPrev: () -> Unit, onNext: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        IconButton(onClick = onPrev) { Icon(Icons.Default.ChevronLeft, contentDescription = "Mois précédent") }
        val label = month.month.getDisplayName(TextStyle.FULL, Locale.getDefault())
            .replaceFirstChar { it.uppercase() } + " " + month.year
        Text(label, style = MaterialTheme.typography.titleMedium)
        IconButton(onClick = onNext) { Icon(Icons.Default.ChevronRight, contentDescription = "Mois suivant") }
    }
}

@Composable
private fun WeekdayLabels() {
    val labels = listOf("Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim")
    Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp)) {
        labels.forEach { l ->
            Text(
                text = l,
                modifier = Modifier.weight(1f),
                textAlign = TextAlign.Center,
                style = MaterialTheme.typography.labelSmall,
            )
        }
    }
}

@Composable
private fun MonthGrid(
    month: YearMonth,
    overrides: Map<String, String>,
    onToggleDay: (LocalDate) -> Unit,
) {
    val first = month.atDay(1)
    val leading = first.dayOfWeek.value - 1 // lundi = 0
    val daysInMonth = month.lengthOfMonth()
    val cells = leading + daysInMonth
    val rows = (cells + 6) / 7

    Column(Modifier.fillMaxWidth().padding(4.dp)) {
        for (r in 0 until rows) {
            Row(Modifier.fillMaxWidth()) {
                for (c in 0 until 7) {
                    val index = r * 7 + c
                    val dayNum = index - leading + 1
                    if (dayNum in 1..daysInMonth) {
                        DayCell(month.atDay(dayNum), overrides, onToggleDay, Modifier.weight(1f))
                    } else {
                        Box(Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

@Composable
private fun DayCell(
    date: LocalDate,
    overrides: Map<String, String>,
    onToggleDay: (LocalDate) -> Unit,
    modifier: Modifier = Modifier,
) {
    val free = effectiveStatus(date, overrides) == "free"
    val bg = if (free) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant
    val fg = if (free) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant
    val isOverride = overrides.containsKey(date.toString())

    Box(
        modifier = modifier
            .padding(2.dp)
            .aspectRatio(1f)
            .clip(RoundedCornerShape(8.dp))
            .clickable { onToggleDay(date) },
        contentAlignment = Alignment.Center,
    ) {
        Surface(color = bg, modifier = Modifier.fillMaxSize()) {
            Box(contentAlignment = Alignment.Center) {
                Text(
                    text = date.dayOfMonth.toString(),
                    color = fg,
                    fontWeight = if (isOverride) FontWeight.Bold else FontWeight.Normal,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
    }
}

@Composable
private fun Legend() {
    Row(
        modifier = Modifier.fillMaxWidth().padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        LegendItem(MaterialTheme.colorScheme.primaryContainer, "Libre")
        LegendItem(MaterialTheme.colorScheme.surfaceVariant, "Occupé")
        Text(
            "Touchez un jour pour basculer. Gras = exception.",
            style = MaterialTheme.typography.labelSmall,
        )
    }
}

@Composable
private fun LegendItem(color: androidx.compose.ui.graphics.Color, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Surface(color = color, shape = RoundedCornerShape(4.dp), modifier = Modifier.padding(2.dp)) {
            Box(Modifier.padding(8.dp))
        }
        Text(label, style = MaterialTheme.typography.labelSmall)
    }
}
