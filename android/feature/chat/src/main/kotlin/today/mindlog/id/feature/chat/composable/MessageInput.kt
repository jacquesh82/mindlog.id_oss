package today.mindlog.id.feature.chat

import android.Manifest
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import java.io.File

@Composable
internal fun MessageInput(
    onSend: (String) -> Unit,
    onAttach: () -> Unit,
    onSendVoice: (ByteArray, Long) -> Unit,
    onceArmed: Boolean,
    onToggleOnce: () -> Unit,
) {
    var text by remember { mutableStateOf("") }
    val ctx = LocalContext.current

    // Enregistrement vocal : MediaRecorder → fichier temp m4a (AAC/MPEG_4).
    var recorder by remember { mutableStateOf<MediaRecorder?>(null) }
    var recFile by remember { mutableStateOf<File?>(null) }
    var recStart by remember { mutableStateOf(0L) }
    val recording = recorder != null

    fun startRecording() {
        val file = File(ctx.cacheDir, "voice-${System.currentTimeMillis()}.m4a")
        @Suppress("DEPRECATION")
        val r = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(ctx) else MediaRecorder()
        runCatching {
            r.setAudioSource(MediaRecorder.AudioSource.MIC)
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioEncodingBitRate(64000)
            r.setAudioSamplingRate(44100)
            r.setOutputFile(file.absolutePath)
            r.prepare()
            r.start()
        }.onSuccess {
            recorder = r; recFile = file; recStart = SystemClock.elapsedRealtime()
        }.onFailure { runCatching { r.release() } }
    }
    fun stopRecording(send: Boolean) {
        val r = recorder ?: return
        val file = recFile
        val dur = SystemClock.elapsedRealtime() - recStart
        runCatching { r.stop() }
        runCatching { r.release() }
        recorder = null; recFile = null
        if (send && file != null && dur >= 500) {
            val bytes = runCatching { file.readBytes() }.getOrNull()
            if (bytes != null && bytes.size <= 10 * 1024 * 1024) onSendVoice(bytes, dur)
        }
        runCatching { file?.delete() }
    }

    val micPermLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startRecording()
    }
    val onMic = {
        if (recording) stopRecording(send = true)
        else if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) startRecording()
        else micPermLauncher.launch(Manifest.permission.RECORD_AUDIO)
    }
    DisposableEffect(Unit) { onDispose { recorder?.let { runCatching { it.release() } } } }

    Row(
        Modifier.fillMaxWidth().padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        IconButton(onClick = onAttach, enabled = !recording) {
            Icon(Icons.Default.AttachFile, contentDescription = "Joindre un fichier")
        }
        IconButton(onClick = onMic) {
            Icon(
                if (recording) Icons.Default.Stop else Icons.Default.Mic,
                contentDescription = if (recording) "Arrêter et envoyer" else "Message vocal",
                tint = if (recording) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        IconButton(onClick = onToggleOnce, enabled = !recording) {
            Icon(
                Icons.Default.Visibility,
                contentDescription = "Lecture unique",
                tint = if (onceArmed) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (recording) {
            Text("Enregistrement…", Modifier.weight(1f), color = MaterialTheme.colorScheme.error)
        } else {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it.take(1000) },
                modifier = Modifier.weight(1f),
                placeholder = { Text("Votre message…") },
                maxLines = 4,
            )
        }
        IconButton(
            onClick = { if (text.isNotBlank()) { onSend(text); text = "" } },
            enabled = !recording,
        ) {
            Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Envoyer")
        }
    }
}
