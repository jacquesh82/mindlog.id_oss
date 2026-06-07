package today.mindlog.id.feature.live

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Construction
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import today.mindlog.id.core.network.dto.LiveDto

/**
 * Viewer placeholder : la mécanique WebRTC mesh (join → SDP exchange via
 * /api/live/{id}/signal → RTCPeerConnection → render SurfaceViewRenderer) est
 * câblée dans une itération suivante (refonte CallManager en MeshSession).
 * Cette vue valide l'arborescence + le passage de paramètres.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ViewerScreen(live: LiveDto, onClose: () -> Unit) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("@${live.handle}") },
                navigationIcon = {
                    IconButton(onClick = onClose) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Fermer")
                    }
                },
            )
        },
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(Color.Black),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.padding(24.dp),
            ) {
                Icon(
                    Icons.Default.Construction,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(48.dp),
                )
                Text(
                    live.title.ifBlank { "Live #${live.id}" },
                    style = MaterialTheme.typography.titleLarge,
                    color = Color.White,
                )
                Text(
                    "Viewer mesh P2P en cours de câblage. Pour regarder maintenant, ouvre le live sur le Web. 🦎",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color.White.copy(alpha = 0.85f),
                )
                Button(onClick = onClose) { Text("Retour") }
            }
        }
    }
}
