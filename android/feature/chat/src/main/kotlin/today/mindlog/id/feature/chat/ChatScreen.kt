package today.mindlog.id.feature.chat

import android.Manifest
import android.content.ContentValues
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.media.MediaPlayer
import android.os.Build
import android.provider.MediaStore
import android.provider.OpenableColumns
import java.io.File
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import today.mindlog.id.core.model.Attachment
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import today.mindlog.id.core.data.VerifyState
import today.mindlog.id.core.designsystem.QrScanner
import today.mindlog.id.core.model.ChatMessage
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

internal val QUICK_EMOJIS = listOf("👍", "❤️", "😂", "😮", "😢", "🙏")

// Historique d'appel : message E2E sentinel « call:{json} » écrit par l'appelant en
// fin d'appel (cf. CallManager). Rendu comme une ligne d'info centrée. Interop web.
internal data class CallInfo(val k: String, val s: String, val d: Int)
// Parsing léger par regex (le module feature:chat n'a pas kotlinx-serialization).
internal fun parseCallLog(text: String?): CallInfo? {
    if (text == null) return null
    val t = if (text.isNotEmpty() && text[0].code == 6) text.substring(1) else text // tolere un U+0006 herite (ancien bug de prefixe)
    if (!t.startsWith("call:")) return null
    val body = t.removePrefix("call:")
    val s = Regex("\"s\"\\s*:\\s*\"([^\"]*)\"").find(body)?.groupValues?.get(1) ?: return null
    if (s != "answered" && s != "missed" && s != "declined") return null
    val k = Regex("\"k\"\\s*:\\s*\"([^\"]*)\"").find(body)?.groupValues?.get(1) ?: "audio"
    val d = Regex("\"d\"\\s*:\\s*(\\d+)").find(body)?.groupValues?.get(1)?.toIntOrNull() ?: 0
    return CallInfo(k, s, d)
}
internal fun callLabel(c: CallInfo, mine: Boolean, time: String): String {
    val video = c.k == "video"
    val kind = if (video) "Appel vidéo" else "Appel audio"
    val icon = if (c.s == "answered") (if (video) "🎥" else "📞") else if (c.s == "declined") "🚫" else "📵"
    val dir = if (mine) "sortant" else "entrant"
    val detail = when (c.s) {
        "answered" -> "${c.d / 60}:${(c.d % 60).toString().padStart(2, '0')}"
        "declined" -> "refusé"
        else -> if (mine) "sans réponse" else "manqué"
    }
    return "$icon $kind $dir · $detail" + if (time.isNotBlank()) " · $time" else ""
}

@Composable
fun ChatRoute(
    onBack: () -> Unit,
    onOpenDevices: () -> Unit = {},
    viewModel: ChatViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    ChatScreen(
        state = state,
        onBack = onBack,
        onSend = viewModel::send,
        onReact = viewModel::react,
        onDelete = viewModel::delete,
        onRestore = viewModel::restore,
        onCall = viewModel::startCall,
        onErrorShown = viewModel::clearError,
        onOpenVerify = viewModel::openVerify,
        onCloseVerify = viewModel::closeVerify,
        onMarkVerified = viewModel::markVerified,
        onUnverify = viewModel::unverify,
        onScan = viewModel::onScanResult,
        onAttach = viewModel::sendAttachment,
        onSendVoice = viewModel::sendVoice,
        onSetTimer = viewModel::setTimer,
        onToggleOnce = viewModel::toggleOnce,
        onReveal = viewModel::reveal,
        loadAttachment = viewModel::loadAttachment,
        onOpenDevices = onOpenDevices,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ChatScreen(
    state: ChatUiState,
    onBack: () -> Unit,
    onSend: (String) -> Unit,
    onReact: (Long, String) -> Unit,
    onDelete: (Long) -> Unit,
    onRestore: (String, Boolean) -> Unit,
    onCall: (Boolean) -> Unit,
    onErrorShown: () -> Unit,
    onOpenVerify: () -> Unit = {},
    onCloseVerify: () -> Unit = {},
    onMarkVerified: () -> Unit = {},
    onUnverify: () -> Unit = {},
    onScan: (String) -> Unit = {},
    onAttach: (ByteArray, String, String) -> Unit = { _, _, _ -> },
    onSendVoice: (ByteArray, Long) -> Unit = { _, _ -> },
    onSetTimer: (Int) -> Unit = {},
    onToggleOnce: () -> Unit = {},
    onReveal: (Long) -> Unit = {},
    loadAttachment: suspend (Attachment) -> ByteArray? = { null },
    onOpenDevices: () -> Unit = {},
) {
    val ctx = LocalContext.current
    val attachPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri ?: return@rememberLauncherForActivityResult
        val mime = ctx.contentResolver.getType(uri) ?: "application/octet-stream"
        var name = "fichier"
        runCatching {
            ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0)?.let { name = it }
            }
        }
        val bytes = runCatching { ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() } }.getOrNull()
        if (bytes != null) onAttach(bytes, name, mime)
    }
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(state.error) {
        state.error?.let { snackbar.showSnackbar(it); onErrorShown() }
    }
    if (state.showVerify) {
        VerifyIdentityDialog(state, onClose = onCloseVerify, onMark = onMarkVerified, onUnverify = onUnverify, onScan = onScan)
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("@${state.handle}")
                        val sub = when (state.verifyState) {
                            VerifyState.VERIFIED -> "vérifié ✓ · éphémère 🔒"
                            VerifyState.CHANGED -> "clé changée ⚠️ · à re-vérifier"
                            else -> "chiffré · éphémère 🔒"
                        }
                        Text(sub, style = MaterialTheme.typography.labelSmall)
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Retour")
                    }
                },
                actions = {
                    if (state.peerHasKey && !state.needsRestore) {
                        var timerMenu by remember { mutableStateOf(false) }
                        Box {
                            IconButton(onClick = { timerMenu = true }) {
                                Icon(
                                    Icons.Default.Timer,
                                    contentDescription = "Minuterie de disparition",
                                    tint = if (state.ttlSeconds < 86400) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            DropdownMenu(expanded = timerMenu, onDismissRequest = { timerMenu = false }) {
                                listOf(86400 to "Désactivée", 28800 to "8 h", 3600 to "1 h", 1800 to "30 min", 300 to "5 min").forEach { (sec, label) ->
                                    DropdownMenuItem(
                                        text = { Text((if (state.ttlSeconds == sec) "✓ " else "") + label) },
                                        onClick = { timerMenu = false; onSetTimer(sec) },
                                    )
                                }
                            }
                        }
                        IconButton(onClick = onOpenDevices) {
                            Icon(
                                Icons.Default.Devices,
                                contentDescription = "Appareils chiffrés",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        IconButton(onClick = onOpenVerify) {
                            Icon(
                                Icons.Default.Verified,
                                contentDescription = "Vérifier l'identité",
                                tint = when (state.verifyState) {
                                    VerifyState.VERIFIED -> MaterialTheme.colorScheme.primary
                                    VerifyState.CHANGED -> MaterialTheme.colorScheme.error
                                    else -> MaterialTheme.colorScheme.onSurfaceVariant
                                },
                            )
                        }
                        IconButton(onClick = { onCall(false) }) {
                            Icon(Icons.Default.Call, contentDescription = "Appel audio")
                        }
                        IconButton(onClick = { onCall(true) }) {
                            Icon(Icons.Default.Videocam, contentDescription = "Appel vidéo")
                        }
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            if (state.needsBackup && !state.needsRestore) KeyBackupBanner()
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when {
                    state.needsRestore -> RestorePane(onRestore)
                    !state.peerHasKey -> Hint(
                        "@${state.handle} doit ouvrir son espace une fois pour activer la messagerie chiffrée.",
                    )
                    state.messages.isEmpty() && !state.loading -> Hint("Aucun message. Dites bonjour 👋")
                    else -> MessageList(state.messages, state.revealed, onReact, onDelete, onReveal, loadAttachment)
                }
            }
            if (state.peerHasKey && !state.needsRestore) {
                MessageInput(
                    onSend = onSend,
                    onAttach = { attachPicker.launch("*/*") },
                    onSendVoice = onSendVoice,
                    onceArmed = state.onceArmed,
                    onToggleOnce = onToggleOnce,
                )
            }
        }
    }
}

@Composable
private fun RestorePane(onRestore: (String, Boolean) -> Unit) {
    var usePin by remember { mutableStateOf(false) }
    var secret by remember { mutableStateOf("") }
    val minLen = if (usePin) 4 else 8
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(Icons.Default.Lock, contentDescription = null)
        Text(
            if (usePin)
                "Vos clés ne sont pas sur cet appareil. Restaurez-les avec votre code PIN pour relire vos messages chiffrés."
            else
                "Vos clés ne sont pas sur cet appareil. Restaurez-les avec votre passphrase pour relire vos messages chiffrés.",
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(vertical = 12.dp),
        )
        OutlinedTextField(
            value = secret,
            // En mode PIN : on ne garde que les chiffres (clavier numérique).
            onValueChange = { input -> secret = if (usePin) input.filter { it.isDigit() }.take(12) else input },
            label = { Text(if (usePin) "Code PIN" else "Passphrase") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(
                keyboardType = if (usePin) KeyboardType.Number else KeyboardType.Text,
            ),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedButton(
            onClick = { onRestore(secret, usePin) },
            modifier = Modifier.padding(top = 12.dp),
            enabled = secret.length >= minLen,
        ) { Text("Restaurer mes clés") }
        // Bascule entre les deux méthodes du coffre (parité web / écran Options).
        TextButton(
            onClick = { usePin = !usePin; secret = "" },
            modifier = Modifier.padding(top = 4.dp),
        ) { Text(if (usePin) "Utiliser une passphrase" else "Utiliser un code PIN") }
    }
}

/** Bandeau non bloquant : la clé n'est pas sauvegardée → renvoie vers « Ma carte ». */
@Composable
private fun KeyBackupBanner() {
    Surface(color = MaterialTheme.colorScheme.tertiaryContainer, modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(
                Icons.Default.Lock,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onTertiaryContainer,
            )
            Text(
                "Sauvegardez votre clé dans « Ma carte » pour relire ces messages sur vos autres appareils.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onTertiaryContainer,
            )
        }
    }
}

/**
 * Dialogue de vérification d'identité : affiche le numéro de sécurité (60 chiffres)
 * à comparer avec le contact, et permet de scanner son QR pour comparer automatiquement.
 */
@Composable
private fun VerifyIdentityDialog(
    state: ChatUiState,
    onClose: () -> Unit,
    onMark: () -> Unit,
    onUnverify: () -> Unit,
    onScan: (String) -> Unit,
) {
    val context = LocalContext.current
    var scanning by remember { mutableStateOf(false) }
    val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) scanning = true
    }
    val startScan = {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            scanning = true
        } else {
            permLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    if (scanning) {
        Dialog(onDismissRequest = { scanning = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            Box(Modifier.fillMaxSize()) {
                QrScanner(onResult = { scanning = false; onScan(it) }, modifier = Modifier.fillMaxSize())
                TextButton(onClick = { scanning = false }, modifier = Modifier.align(Alignment.TopStart).padding(12.dp)) {
                    Text("Annuler")
                }
            }
        }
        return
    }

    val verified = state.verifyState == VerifyState.VERIFIED
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("Vérifier @${state.handle}") },
        text = {
            Column {
                Text(
                    "Comparez ce numéro avec @${state.handle} (en personne, par appel, ou en scannant son QR). " +
                        "S'ils sont identiques, personne n'intercepte vos messages.",
                    style = MaterialTheme.typography.bodySmall,
                )
                Text(
                    state.safetyNumber?.chunked(5)?.joinToString(" ") ?: "Numéro indisponible.",
                    style = MaterialTheme.typography.titleMedium,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
                )
                if (verified) {
                    Text("✓ Vérifié.", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge)
                }
                state.verifyMessage?.let {
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelMedium)
                }
                OutlinedButton(onClick = startScan, modifier = Modifier.padding(top = 8.dp)) {
                    Text("Scanner le QR du contact")
                }
            }
        },
        confirmButton = {
            if (verified) {
                TextButton(onClick = onUnverify) { Text("Retirer") }
            } else {
                Button(onClick = onMark) { Text("Marquer comme vérifié") }
            }
        },
        dismissButton = { TextButton(onClick = onClose) { Text("Fermer") } },
    )
}

/** Affiche une pièce jointe : aperçu image (déchiffré) ou puce fichier + enregistrement. */
@Composable
internal fun AttachmentView(att: Attachment, loadAttachment: suspend (Attachment) -> ByteArray?) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    if (att.mime.startsWith("audio/")) {
        VoicePlayer(att, loadAttachment)
        return
    }
    if (att.mime.startsWith("image/")) {
        val bmp by produceState<androidx.compose.ui.graphics.ImageBitmap?>(null, att.id) {
            val bytes = loadAttachment(att)
            value = bytes?.let {
                runCatching { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() }.getOrNull()
            }
        }
        val img = bmp
        if (img != null) {
            Image(bitmap = img, contentDescription = att.name, modifier = Modifier.widthIn(max = 240.dp))
        } else {
            Text("📎 ${att.name} — chargement…", style = MaterialTheme.typography.bodyMedium)
        }
    } else {
        Column {
            Text("📎 ${att.name}", style = MaterialTheme.typography.bodyLarge)
            OutlinedButton(onClick = {
                scope.launch {
                    val bytes = loadAttachment(att)
                    if (bytes != null) saveToDownloads(ctx, att.name, att.mime, bytes)
                }
            }) { Text("Enregistrer") }
        }
    }
}

/** Lecteur de message vocal : télécharge+déchiffre à la demande, joue via MediaPlayer. */
@Composable
private fun VoicePlayer(att: Attachment, loadAttachment: suspend (Attachment) -> ByteArray?) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var player by remember { mutableStateOf<MediaPlayer?>(null) }
    var playing by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    DisposableEffect(Unit) { onDispose { runCatching { player?.release() } } }

    val durLabel = att.dur?.let { val s = (it / 1000).toInt(); "${s / 60}:${(s % 60).toString().padStart(2, '0')}" } ?: ""
    Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = {
            val p = player
            if (playing && p != null) {
                runCatching { p.pause() }; playing = false
            } else if (p != null) {
                runCatching { p.start() }; playing = true
            } else if (!loading) {
                loading = true
                scope.launch {
                    val bytes = loadAttachment(att)
                    loading = false
                    if (bytes == null) return@launch
                    runCatching {
                        val f = File(ctx.cacheDir, "play-${att.id}.m4a").apply { writeBytes(bytes) }
                        val mp = MediaPlayer().apply {
                            setDataSource(f.absolutePath); prepare()
                            setOnCompletionListener { playing = false }
                        }
                        player = mp; mp.start(); playing = true
                    }
                }
            }
        }) {
            Icon(if (playing) Icons.Default.Stop else Icons.Default.PlayArrow, contentDescription = if (playing) "Pause" else "Lire")
        }
        Text(if (loading) "🎤 chargement…" else "🎤 Message vocal $durLabel", style = MaterialTheme.typography.bodyMedium)
    }
}

/** Écrit des octets dans le dossier Téléchargements via MediaStore (sans permission, API 29+). */
private suspend fun saveToDownloads(ctx: android.content.Context, name: String, mime: String, bytes: ByteArray) {
    withContext(Dispatchers.IO) {
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, name)
                    put(MediaStore.Downloads.MIME_TYPE, mime.ifBlank { "application/octet-stream" })
                }
                val resolver = ctx.contentResolver
                val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                uri?.let { resolver.openOutputStream(it)?.use { os -> os.write(bytes) } }
            } else {
                // API 26-28 : écrit dans le dossier privé de l'app (pas de permission requise).
                java.io.File(ctx.getExternalFilesDir(null), name).writeBytes(bytes)
            }
        }
    }
}

@Composable
private fun Hint(text: String) {
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Text(text, textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

internal val timeFmt = DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault())
internal fun formatTime(iso: String): String =
    runCatching { timeFmt.format(Instant.parse(iso)) }.getOrDefault("")
