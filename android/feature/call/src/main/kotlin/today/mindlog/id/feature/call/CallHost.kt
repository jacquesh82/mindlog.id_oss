package today.mindlog.id.feature.call

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.VideocamOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.runtime.LaunchedEffect

/**
 * Hôte d'appel global : monté une fois au niveau de l'app (au-dessus de la
 * navigation). Affiche l'interface d'appel entrant/sortant en surimpression,
 * gère les permissions micro/caméra et démarre les appels demandés via le bus.
 */
@Composable
fun CallHost(viewModel: CallViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    // Action à exécuter une fois les permissions accordées.
    val pendingAction = remember { mutableStateOf<(() -> Unit)?>(null) }
    val permLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { result ->
        val granted = result[Manifest.permission.RECORD_AUDIO] == true
        if (granted) pendingAction.value?.invoke()
        pendingAction.value = null
    }
    fun withPermissions(video: Boolean, action: () -> Unit) {
        pendingAction.value = action
        val perms = if (video) {
            arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA)
        } else {
            arrayOf(Manifest.permission.RECORD_AUDIO)
        }
        permLauncher.launch(perms)
    }

    // Demandes d'appel sortant (depuis le chat) : permission puis démarrage.
    LaunchedEffect(Unit) {
        viewModel.outgoing.collect { o ->
            withPermissions(o.video) { viewModel.startOutgoing(o) }
        }
    }

    // Fin d'appel : ferme automatiquement la fenêtre après un bref instant (affiche
    // « Appel terminé » ~1,5 s, puis disparaît — plus besoin de toucher « Fermer »).
    LaunchedEffect(state.stage) {
        if (state.stage == CallStage.ENDED) {
            kotlinx.coroutines.delay(1500)
            viewModel.dismiss()
        }
    }

    if (state.stage == CallStage.IDLE) return

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = Color(0xFF101418),
    ) {
        Box(Modifier.fillMaxSize()) {
            // Vidéo distante en plein écran (si présente).
            state.remoteTrack?.let { track ->
                VideoRenderer(
                    track = track,
                    eglContext = viewModel.eglContext(),
                    modifier = Modifier.fillMaxSize(),
                )
            }
            // Aperçu local en médaillon.
            state.localTrack?.let { track ->
                VideoRenderer(
                    track = track,
                    eglContext = viewModel.eglContext(),
                    mirror = true,
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(16.dp)
                        .width(110.dp)
                        .height(160.dp),
                )
            }

            Column(
                Modifier.fillMaxSize().padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.SpaceBetween,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        "@${state.handle}",
                        style = MaterialTheme.typography.headlineSmall,
                        color = Color.White,
                        modifier = Modifier.padding(top = 32.dp),
                    )
                    Text(statusLabel(state.stage), color = Color(0xFFB0BEC5))
                    Text("🔒 pair-à-pair chiffré", color = Color(0xFF80CBC4), textAlign = TextAlign.Center)
                }

                Controls(viewModel, state)
            }
        }
    }
}

@Composable
private fun Controls(viewModel: CallViewModel, state: CallState) {
    if (state.stage == CallStage.INCOMING) {
        Row(horizontalArrangement = Arrangement.spacedBy(32.dp)) {
            RoundButton(Icons.Default.CallEnd, "Refuser", Color(0xFFE53935)) { viewModel.decline() }
            RoundButton(Icons.Default.Call, "Accepter", Color(0xFF43A047)) { viewModel.accept() }
        }
        return
    }
    if (state.stage == CallStage.ENDED) {
        Button(onClick = { viewModel.dismiss() }) { Text("Fermer") }
        return
    }
    Row(horizontalArrangement = Arrangement.spacedBy(20.dp), verticalAlignment = Alignment.CenterVertically) {
        ToggleButton(state.micOn, Icons.Default.Mic, Icons.Default.MicOff, "Micro") { viewModel.toggleMic() }
        if (state.video) {
            ToggleButton(state.camOn, Icons.Default.Videocam, Icons.Default.VideocamOff, "Caméra") { viewModel.toggleCam() }
        }
        RoundButton(Icons.Default.CallEnd, "Raccrocher", Color(0xFFE53935)) { viewModel.hangup() }
    }
}

@Composable
private fun RoundButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    color: Color,
    onClick: () -> Unit,
) {
    FilledIconButton(
        onClick = onClick,
        modifier = Modifier.size(64.dp),
        shape = CircleShape,
        colors = IconButtonDefaults.filledIconButtonColors(containerColor = color),
    ) {
        Icon(icon, contentDescription = label, tint = Color.White)
    }
}

@Composable
private fun ToggleButton(
    on: Boolean,
    onIcon: androidx.compose.ui.graphics.vector.ImageVector,
    offIcon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    onClick: () -> Unit,
) {
    FilledIconButton(
        onClick = onClick,
        modifier = Modifier.size(56.dp),
        shape = CircleShape,
        colors = IconButtonDefaults.filledIconButtonColors(
            containerColor = if (on) Color(0xFF37474F) else Color(0xFF78909C),
        ),
    ) {
        Icon(if (on) onIcon else offIcon, contentDescription = label, tint = Color.White)
    }
}

private fun statusLabel(stage: CallStage): String = when (stage) {
    CallStage.OUTGOING -> "Appel en cours…"
    CallStage.INCOMING -> "Appel entrant"
    CallStage.CONNECTING -> "Connexion…"
    CallStage.CONNECTED -> "En communication"
    CallStage.ENDED -> "Appel terminé"
    CallStage.IDLE -> ""
}
