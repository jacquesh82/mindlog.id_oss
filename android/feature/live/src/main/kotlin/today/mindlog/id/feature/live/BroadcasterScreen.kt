package today.mindlog.id.feature.live

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.Cameraswitch
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.TextButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch

/**
 * Écran broadcaster : preview caméra + audio + start/end live + viewer count
 * + mesh signaling (un PC par viewer connecté, attache les tracks sortants).
 *
 * Limite connue : non-interop avec les viewers Web (cf. [BroadcasterEngine]).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BroadcasterRoute(
    onBack: () -> Unit,
    viewModel: BroadcasterViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val snackbarHost = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    var hasCameraPerm by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED,
        )
    }
    var hasMicPerm by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED,
        )
    }
    val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        hasCameraPerm = granted[Manifest.permission.CAMERA] ?: hasCameraPerm
        hasMicPerm = granted[Manifest.permission.RECORD_AUDIO] ?: hasMicPerm
        if (hasCameraPerm) viewModel.startPreview(withAudio = hasMicPerm)
    }

    LaunchedEffect(hasCameraPerm, hasMicPerm) {
        val missing = mutableListOf<String>()
        if (!hasCameraPerm) missing.add(Manifest.permission.CAMERA)
        if (!hasMicPerm) missing.add(Manifest.permission.RECORD_AUDIO)
        if (missing.isNotEmpty()) {
            permLauncher.launch(missing.toTypedArray())
        } else if (!state.previewing) {
            viewModel.startPreview(withAudio = true)
        }
    }
    LaunchedEffect(state.error) {
        state.error?.let { scope.launch { snackbarHost.showSnackbar(it) }; viewModel.clearError() }
    }
    LaunchedEffect(state.message) {
        state.message?.let { scope.launch { snackbarHost.showSnackbar(it) }; viewModel.clearMessage() }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (state.live != null) "En direct" else "Nouveau live") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Retour")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color.Black.copy(alpha = 0.6f),
                    titleContentColor = Color.White,
                    navigationIconContentColor = Color.White,
                ),
                windowInsets = WindowInsets.statusBars,
            )
        },
        snackbarHost = { SnackbarHost(snackbarHost) },
        containerColor = Color.Black,
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding).background(Color.Black)) {
            // Preview caméra plein écran.
            val track = state.localTrack
            if (track != null) {
                LiveVideoRenderer(
                    track = track,
                    eglContext = viewModel.eglContext(),
                    modifier = Modifier.fillMaxSize(),
                    mirror = state.facingFront,
                )
            } else {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        when {
                            !hasCameraPerm -> "Autorisation caméra requise."
                            !hasMicPerm -> "Autorisation micro requise pour le son."
                            else -> "Initialisation caméra…"
                        },
                        color = Color.White,
                    )
                }
            }

            // Badge LIVE + viewers count (haut-droite).
            if (state.live != null) {
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
                        if (state.connectedPeers > 0 && state.connectedPeers != state.viewers) {
                            Text("  · ${state.connectedPeers} PC")
                        }
                    }
                }
            }

            // Barre du bas : titre + actions (mic / cam / start-stop).
            Surface(
                modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth(),
                color = Color.Black.copy(alpha = 0.55f),
                contentColor = Color.White,
            ) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = state.title,
                        onValueChange = viewModel::setTitle,
                        enabled = state.live == null,
                        placeholder = { Text("Titre du live…", color = Color.White.copy(alpha = 0.6f)) },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        colors = TextFieldDefaults.colors(
                            focusedTextColor = Color.White,
                            unfocusedTextColor = Color.White,
                            focusedContainerColor = Color.Transparent,
                            unfocusedContainerColor = Color.Transparent,
                        ),
                    )
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        IconButton(onClick = viewModel::toggleMic, enabled = state.previewing && hasMicPerm) {
                            Icon(
                                if (state.micOn) Icons.Default.Mic else Icons.Default.MicOff,
                                contentDescription = if (state.micOn) "Couper le micro" else "Activer le micro",
                                tint = if (state.micOn) Color.White else MaterialTheme.colorScheme.error,
                            )
                        }
                        IconButton(onClick = viewModel::toggleFacing, enabled = state.previewing) {
                            Icon(
                                Icons.Default.Cameraswitch,
                                contentDescription = "Inverser caméra",
                                tint = Color.White,
                            )
                        }
                        if (state.live == null) {
                            Button(
                                onClick = viewModel::goLive,
                                enabled = state.previewing && !state.processing && state.title.isNotBlank(),
                                modifier = Modifier.weight(1f),
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFE8503A)),
                            ) {
                                Icon(Icons.Default.PlayArrow, contentDescription = null)
                                Text("  Démarrer le live")
                            }
                        } else {
                            // Partager le lien public du live.
                            IconButton(onClick = {
                                viewModel.shareUrl()?.let { url ->
                                    val send = Intent(Intent.ACTION_SEND).apply {
                                        type = "text/plain"
                                        putExtra(Intent.EXTRA_TEXT, "Je suis en live sur mindlog : $url")
                                    }
                                    context.startActivity(Intent.createChooser(send, "Partager le live"))
                                }
                            }) {
                                Icon(Icons.Default.Share, contentDescription = "Partager le lien", tint = Color.White)
                            }
                            // Notifier (relancer) les abonné·e·s.
                            IconButton(onClick = viewModel::notifySubscribers, enabled = !state.processing) {
                                Icon(Icons.Default.Campaign, contentDescription = "Notifier les abonnés", tint = Color.White)
                            }
                            Button(
                                onClick = viewModel::endLive,
                                enabled = !state.processing,
                                modifier = Modifier.weight(1f),
                                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.errorContainer),
                            ) {
                                Icon(Icons.Default.Stop, contentDescription = null)
                                Text("  Arrêter le live")
                            }
                        }
                    }
                }
            }
        }
    }

    // RBAC : diffuser un live est réservé aux comptes Premium (refus serveur 402).
    if (state.needsPremium) {
        AlertDialog(
            onDismissRequest = viewModel::dismissPremiumGate,
            title = { Text("Premium requis") },
            text = {
                Text(
                    "Diffuser un live est réservé aux comptes Premium. " +
                        "Active Premium depuis le menu Compte pour démarrer ta diffusion.",
                )
            },
            confirmButton = {
                TextButton(onClick = { viewModel.dismissPremiumGate(); onBack() }) { Text("Compris") }
            },
        )
    }
}
