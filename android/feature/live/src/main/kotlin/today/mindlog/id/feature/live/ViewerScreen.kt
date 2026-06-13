package today.mindlog.id.feature.live

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.OpenInBrowser
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import today.mindlog.id.core.network.dto.LiveDto

/**
 * Viewer : connecte un PeerConnection au broadcaster du live (1-peer recv-only),
 * rend le track distant si disponible. Le « Ouvrir sur le Web » reste un
 * fallback pour les broadcasters Web (incompatibles avec ce client Android).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ViewerRoute(
    live: LiveDto,
    onClose: () -> Unit,
    viewModel: ViewerViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(live.id) { viewModel.bind(live.id, live.handle, live.title) }
    DisposableEffect(live.id) { onDispose { viewModel.leave() } }

    val snackbarHost = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    LaunchedEffect(state.error) {
        state.error?.let { scope.launch { snackbarHost.showSnackbar(it) } }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(state.title.ifBlank { "Live" }) },
                navigationIcon = {
                    IconButton(onClick = onClose) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Fermer")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color.Black.copy(alpha = 0.6f),
                    titleContentColor = Color.White,
                    navigationIconContentColor = Color.White,
                ),
            )
        },
        snackbarHost = { SnackbarHost(snackbarHost) },
        containerColor = Color.Black,
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding).background(Color.Black)) {
            // Rendu vidéo distant — plein écran quand on a reçu un track du broadcaster.
            val remote = state.remoteVideo
            if (remote != null) {
                LiveVideoRenderer(
                    track = remote,
                    eglContext = viewModel.eglContext(),
                    modifier = Modifier.fillMaxSize(),
                )
            }

            if (state.loading) {
                LinearProgressIndicator(Modifier.fillMaxWidth().align(Alignment.TopCenter))
            }

            // Badge LIVE + viewers en haut droite.
            if (state.joined) {
                Surface(
                    color = Color(0xFFE8503A),
                    contentColor = Color.White,
                    shape = RoundedCornerShape(50),
                    modifier = Modifier.align(Alignment.TopEnd).padding(16.dp),
                ) {
                    Row(Modifier.padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("LIVE", fontWeight = FontWeight.SemiBold)
                        Box(Modifier.size(8.dp))
                        Icon(Icons.Default.Visibility, contentDescription = null, modifier = Modifier.size(16.dp))
                        Text("  ${state.viewers}")
                        if (state.connected) Text("  ✓")
                    }
                }
            }

            // Placeholder centré quand pas encore connecté ni de stream rendu.
            if (remote == null) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.align(Alignment.Center).padding(24.dp),
                ) {
                    Icon(
                        Icons.Default.PlayCircle,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(56.dp),
                    )
                    Text(
                        "@${state.handle}",
                        style = MaterialTheme.typography.titleLarge,
                        color = Color.White,
                    )
                    Text(
                        when {
                            !state.joined -> "Connexion au live…"
                            !state.connected -> "Négociation WebRTC en cours…"
                            else -> "En attente du flux vidéo. Si le broadcaster est sur le Web, ouvre le live dans ton navigateur."
                        },
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color.White.copy(alpha = 0.85f),
                    )
                    if (state.joined && !state.connected) {
                        Button(
                            onClick = {
                                val url = "https://id.mindlog.today/live/${live.id}".toUri()
                                runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, url)) }
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
                        ) {
                            Icon(Icons.Default.OpenInBrowser, contentDescription = null)
                            Text("  Ouvrir sur le Web")
                        }
                    }
                    if (state.error != null) {
                        OutlinedButton(onClick = viewModel::join, colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White)) {
                            Text("Retenter la connexion")
                        }
                    }
                }
            }
        }
    }
}
