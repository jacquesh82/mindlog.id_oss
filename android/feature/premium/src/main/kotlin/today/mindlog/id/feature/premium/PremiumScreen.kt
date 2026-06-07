package today.mindlog.id.feature.premium

import android.app.Activity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Article
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Workspaces
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import today.mindlog.id.core.network.dto.PaidPageDto

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PremiumRoute(
    viewModel: PremiumViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val activity = remember(context) {
        var c: android.content.Context? = context
        while (c is android.content.ContextWrapper) {
            if (c is Activity) return@remember c
            c = c.baseContext
        }
        null
    }
    val snackbarHost = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    LaunchedEffect(state.error) {
        state.error?.let { scope.launch { snackbarHost.showSnackbar(it) }; viewModel.clearError() }
    }
    LaunchedEffect(state.message) {
        state.message?.let { scope.launch { snackbarHost.showSnackbar(it) }; viewModel.clearMessage() }
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text("Premium") }) },
        snackbarHost = { SnackbarHost(snackbarHost) },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            if (state.processing) LinearProgressIndicator(Modifier.fillMaxWidth().align(Alignment.TopCenter))
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item {
                    PlanCard(
                        plan = state.plan,
                        priceLabel = state.productPriceLabel,
                        onUpgrade = { activity?.let(viewModel::launchPurchase) },
                    )
                }
                if (state.plan == "premium" || state.pages.isNotEmpty()) {
                    item {
                        Text(
                            "Mes pages payantes",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                    if (state.pages.isEmpty()) {
                        item {
                            Text(
                                "Aucune page pour l'instant. Crée-en depuis le Web pour démarrer.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    } else {
                        items(state.pages, key = { it.slug }) { page -> PageRow(page) }
                    }
                }
            }
        }
    }
}

@Composable
private fun PlanCard(
    plan: String,
    priceLabel: String?,
    onUpgrade: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer,
            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
        ),
    ) {
        Column(modifier = Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Icons.Default.Workspaces, contentDescription = null)
            Text(
                if (plan == "premium") "Premium actif 🦎" else "Passer à Premium",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                if (plan == "premium")
                    "Tu peux publier des pages payantes, lancer des lives et personnaliser ton espace."
                else
                    "Débloque ton espace abonné : pages payantes (markdown, galerie, lien, fichier), lives, custom buttons.",
                style = MaterialTheme.typography.bodyMedium,
            )
            if (plan != "premium") {
                Button(onClick = onUpgrade, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                    Text(priceLabel?.let { "S'abonner · $it / mois" } ?: "S'abonner")
                }
            }
        }
    }
}

@Composable
private fun PageRow(page: PaidPageDto) {
    val icon = when (page.type) {
        "gallery" -> Icons.Default.PhotoLibrary
        "link" -> Icons.Default.Link
        "file" -> Icons.Default.Folder
        "markdown" -> Icons.Default.Description
        else -> Icons.Default.Article
    }
    ListItem(
        leadingContent = { Icon(icon, contentDescription = null) },
        headlineContent = { Text(page.title.ifBlank { "@${page.slug}" }) },
        supportingContent = {
            Text(
                buildString {
                    append(page.type)
                    if (!page.published) append(" · brouillon")
                },
                style = MaterialTheme.typography.bodySmall,
            )
        },
    )
}
