package today.mindlog.id.feature.call

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
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
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
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
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.runtime.LaunchedEffect

private val Accent = Color(0xFF5B5FC7)

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

    val hasRemoteVideo = state.remoteTrack != null

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = Color(0xFF101418),
    ) {
        Box(Modifier.fillMaxSize()) {
            // Vidéo distante en plein écran (si le pair a activé sa caméra).
            state.remoteTrack?.let { track ->
                VideoRenderer(
                    track = track,
                    eglContext = viewModel.eglContext(),
                    modifier = Modifier.fillMaxSize(),
                )
            }
            // Aperçu local en médaillon (si notre caméra est active).
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

                // En audio (pas de vidéo distante) : avatar + halo animé + égaliseur.
                if (!hasRemoteVideo) {
                    CallOrb(
                        handle = state.handle,
                        connected = state.stage == CallStage.CONNECTED,
                    )
                }

                Controls(viewModel, state)
            }
        }
    }
}

/** Avatar central avec halo pulsé (anneaux concentriques) + égaliseur quand connecté. */
@Composable
private fun CallOrb(handle: String, connected: Boolean) {
    val transition = rememberInfiniteTransition(label = "orb")
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(contentAlignment = Alignment.Center, modifier = Modifier.size(180.dp)) {
            // 3 anneaux décalés (0, 0.8s, 1.6s) — scale 1→2.4, opacité 0.55→0.
            repeat(3) { i ->
                val p by transition.animateFloat(
                    initialValue = 0f,
                    targetValue = 1f,
                    animationSpec = infiniteRepeatable(
                        animation = tween(2400, delayMillis = i * 800, easing = FastOutSlowInEasing),
                        repeatMode = RepeatMode.Restart,
                    ),
                    label = "ring$i",
                )
                Surface(
                    color = Color.Transparent,
                    border = androidx.compose.foundation.BorderStroke(2.dp, Accent.copy(alpha = (0.55f * (1f - p)).coerceIn(0f, 0.55f))),
                    shape = CircleShape,
                    modifier = Modifier
                        .size(92.dp)
                        .graphicsLayer {
                            val s = 1f + p * 1.4f
                            scaleX = s; scaleY = s
                        },
                ) {}
            }
            // Pastille avatar (initiale du handle).
            Surface(color = Accent, shape = CircleShape, modifier = Modifier.size(84.dp)) {
                Box(contentAlignment = Alignment.Center) {
                    Text(
                        handle.firstOrNull()?.uppercase() ?: "?",
                        color = Color.White,
                        fontSize = 34.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }
        }
        if (connected) Equalizer(transition)
    }
}

/** Égaliseur 5 barres animées (visible uniquement en communication). */
@Composable
private fun Equalizer(transition: androidx.compose.animation.core.InfiniteTransition) {
    val delays = listOf(0, 180, 360, 120, 300)
    Row(
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.height(24.dp).padding(top = 10.dp),
    ) {
        delays.forEach { d ->
            val h by transition.animateFloat(
                initialValue = 0.35f,
                targetValue = 1f,
                animationSpec = infiniteRepeatable(
                    animation = tween(1000, delayMillis = d, easing = LinearEasing),
                    repeatMode = RepeatMode.Reverse,
                ),
                label = "eq$d",
            )
            Surface(color = Accent, shape = CircleShape, modifier = Modifier.width(4.dp).height((22 * h).dp)) {}
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
        // Caméra toujours disponible : en audio, l'appuyer active la vidéo en cours d'appel.
        ToggleButton(
            on = state.video && state.camOn,
            onIcon = Icons.Default.Videocam,
            offIcon = Icons.Default.VideocamOff,
            label = "Caméra",
        ) { viewModel.toggleCam() }
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
