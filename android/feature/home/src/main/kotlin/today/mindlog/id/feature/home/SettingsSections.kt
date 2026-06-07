package today.mindlog.id.feature.home

import android.widget.Toast
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.ChatBubble
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DeleteForever
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.EventAvailable
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.PhonelinkSetup
import androidx.compose.material.icons.filled.QrCode2
import androidx.compose.material.icons.filled.Restore
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import today.mindlog.id.core.designsystem.theme.MindlogAccents
import today.mindlog.id.core.designsystem.theme.accentFromHex
import today.mindlog.id.core.designsystem.theme.toHex
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import today.mindlog.id.core.data.AuthRepository
import today.mindlog.id.core.data.CardRepository
import today.mindlog.id.core.data.E2eRepository
import today.mindlog.id.core.data.SessionInfo
import java.io.File
import javax.inject.Inject

@Composable
internal fun AppearanceSection(
    state: SettingsUiState,
    onSetAccent: (String) -> Unit,
    onSetThemeMode: (today.mindlog.id.core.designsystem.theme.ThemeMode) -> Unit,
) {
        SettingsCard("Apparence", Icons.Default.Palette) {
            Text(
                "Mode",
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp),
            )
            Row(
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                ThemeModeChip(
                    label = "Système",
                    selected = state.themeMode == today.mindlog.id.core.designsystem.theme.ThemeMode.SYSTEM,
                    onClick = { onSetThemeMode(today.mindlog.id.core.designsystem.theme.ThemeMode.SYSTEM) },
                )
                ThemeModeChip(
                    label = "Clair",
                    selected = state.themeMode == today.mindlog.id.core.designsystem.theme.ThemeMode.LIGHT,
                    onClick = { onSetThemeMode(today.mindlog.id.core.designsystem.theme.ThemeMode.LIGHT) },
                )
                ThemeModeChip(
                    label = "Sombre",
                    selected = state.themeMode == today.mindlog.id.core.designsystem.theme.ThemeMode.DARK,
                    onClick = { onSetThemeMode(today.mindlog.id.core.designsystem.theme.ThemeMode.DARK) },
                )
            }
            Text(
                "Couleur d'accentuation",
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp),
            )
            Row(
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                val selected = accentFromHex(state.accentHex)
                MindlogAccents.forEach { a ->
                    val isSel = selected == a.color
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier
                            .size(36.dp)
                            .clip(CircleShape)
                            .background(a.color)
                            .border(
                                width = if (isSel) 3.dp else 0.dp,
                                color = MaterialTheme.colorScheme.onBackground,
                                shape = CircleShape,
                            )
                            .clickable { onSetAccent(a.color.toHex()) },
                    ) {
                        if (isSel) {
                            Icon(
                                Icons.Default.Check,
                                contentDescription = a.name,
                                tint = Color.Black,
                                modifier = Modifier.size(20.dp),
                            )
                        }
                    }
                }
            }
        }
}

@Composable
private fun ThemeModeChip(label: String, selected: Boolean, onClick: () -> Unit) {
    val container = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant
    val content = if (selected) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant
    Box(
        modifier = Modifier
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(20.dp))
            .background(container)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = MaterialTheme.typography.labelLarge, color = content)
    }
}

@Composable
internal fun VisibilitySection(
    state: SettingsUiState, onToggleAgendaPublic: () -> Unit,
) {
    val tileColors = ListItemDefaults.colors(containerColor = Color.Transparent)
        SettingsCard("Visibilité & Confidentialité", Icons.Default.Shield) {
            ListItem(
                colors = tileColors,
                headlineContent = { Text("Agenda public") },
                supportingContent = {
                    Text(
                        if (state.agendaPublic)
                            "Vos disponibilités sont visibles sur votre profil public"
                        else
                            "Votre agenda est masqué — les visiteurs ne voient pas vos créneaux"
                    )
                },
                leadingContent = { Icon(Icons.Default.CalendarMonth, contentDescription = null) },
                trailingContent = {
                    Switch(checked = state.agendaPublic, onCheckedChange = { onToggleAgendaPublic() })
                },
            )
        }
}

@Composable
internal fun MessagingSection(
    state: SettingsUiState, onToggleAllowChat: () -> Unit, onToggleAllowCall: () -> Unit, onToggleAllowVideo: () -> Unit,
) {
    val tileColors = ListItemDefaults.colors(containerColor = Color.Transparent)
        SettingsCard("Messagerie & Appels", Icons.Default.ChatBubble) {
            ListItem(
                colors = tileColors,
                headlineContent = { Text("Messagerie") },
                supportingContent = { Text("Permettre à vos contacts de vous écrire") },
                leadingContent = { Icon(Icons.Default.ChatBubble, contentDescription = null) },
                trailingContent = {
                    Switch(checked = state.allowChat, onCheckedChange = { onToggleAllowChat() })
                },
            )
            ListItem(
                colors = tileColors,
                headlineContent = { Text("Appels audio") },
                supportingContent = { Text("Autoriser les appels entrants pair-à-pair") },
                leadingContent = { Icon(Icons.Default.Call, contentDescription = null) },
                trailingContent = {
                    Switch(checked = state.allowCall, onCheckedChange = { onToggleAllowCall() })
                },
            )
            ListItem(
                colors = tileColors,
                headlineContent = { Text("Vidéo") },
                supportingContent = {
                    Text(
                        if (state.allowCall) "Autoriser les appels vidéo"
                        else "Activez d'abord les appels audio",
                    )
                },
                leadingContent = { Icon(Icons.Default.Videocam, contentDescription = null) },
                trailingContent = {
                    Switch(
                        checked = state.allowVideo && state.allowCall,
                        enabled = state.allowCall,
                        onCheckedChange = { onToggleAllowVideo() },
                    )
                },
            )
        }
}

@Composable
internal fun AgendaSection(
    state: SettingsUiState, onToggleAllowRequests: () -> Unit,
) {
    val tileColors = ListItemDefaults.colors(containerColor = Color.Transparent)
        SettingsCard("Agenda & Rendez-vous", Icons.Default.EventAvailable) {
            ListItem(
                colors = tileColors,
                headlineContent = { Text("Demandes de RDV") },
                supportingContent = { Text("Les visiteurs peuvent vous proposer un créneau") },
                leadingContent = { Icon(Icons.Default.EventAvailable, contentDescription = null) },
                trailingContent = {
                    Switch(checked = state.allowRequests, onCheckedChange = { onToggleAllowRequests() })
                },
            )
        }
}

@Composable
internal fun SecuritySection(
    state: SettingsUiState, onBackup: () -> Unit, onRestore: () -> Unit,
) {
    val tileColors = ListItemDefaults.colors(containerColor = Color.Transparent)
        SettingsCard("Sécurité & Chiffrement E2E", Icons.Default.Lock) {
            ListItem(
                colors = tileColors,
                headlineContent = { Text("Chiffrement E2E") },
                supportingContent = {
                    Text(
                        if (state.hasVault) "Clé sauvegardée dans le coffre ✓"
                        else "Aucune sauvegarde — vos messages seront perdus en cas de changement d'appareil",
                    )
                },
                leadingContent = { Icon(Icons.Default.Lock, contentDescription = null) },
            )
            ListItem(
                colors = tileColors,
                modifier = Modifier.clickable { onBackup() },
                headlineContent = {
                    Text(if (state.hasVault) "Mettre à jour le coffre" else "Sauvegarder ma clé")
                },
                supportingContent = { Text("Protéger la clé E2E par une passphrase ou un code PIN") },
                leadingContent = { Icon(Icons.Default.Download, contentDescription = null) },
            )
            ListItem(
                colors = tileColors,
                modifier = Modifier.clickable { onRestore() },
                headlineContent = { Text("Restaurer ma clé") },
                supportingContent = { Text("Récupérer la clé E2E avec votre passphrase ou code PIN") },
                leadingContent = { Icon(Icons.Default.Restore, contentDescription = null) },
            )
        }
}

@Composable
internal fun AccessSection(
    state: SettingsUiState, keyVisible: Boolean, onToggleKeyVisible: () -> Unit, onEditEmail: () -> Unit, onRotate: () -> Unit, onGeneratePin: () -> Unit, onRevokeSession: (String) -> Unit, onLogoutOthers: ((Boolean) -> Unit) -> Unit,
) {
    val tileColors = ListItemDefaults.colors(containerColor = Color.Transparent)
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
        SettingsCard("Accès & Sessions", Icons.Default.Key) {
            ListItem(
                colors = tileColors,
                modifier = Modifier.clickable {
                    clipboard.setText(AnnotatedString(state.publicUrl))
                    Toast.makeText(context, "URL copiée", Toast.LENGTH_SHORT).show()
                },
                headlineContent = { Text("URL publique") },
                supportingContent = { Text(state.publicUrl.ifBlank { "—" }) },
                leadingContent = { Icon(Icons.Default.Link, contentDescription = null) },
            )
            ListItem(
                colors = tileColors,
                modifier = Modifier.clickable { onToggleKeyVisible() },
                headlineContent = { Text("Clé d'accès") },
                supportingContent = {
                    Text(if (keyVisible) state.accessKey.ifBlank { "—" } else "•".repeat(12))
                },
                leadingContent = { Icon(Icons.Default.Key, contentDescription = null) },
                trailingContent = {
                    TextButton(onClick = {
                        clipboard.setText(AnnotatedString(state.accessKey))
                        Toast.makeText(context, "Clé copiée", Toast.LENGTH_SHORT).show()
                    }) { Text("Copier") }
                },
            )
            ListItem(
                colors = tileColors,
                modifier = Modifier.clickable { onEditEmail() },
                headlineContent = { Text("Email de récupération") },
                supportingContent = {
                    Text(
                        if (state.recoveryEmail.isBlank()) "Non défini — appuyez pour ajouter"
                        else state.recoveryEmail,
                    )
                },
                leadingContent = { Icon(Icons.Default.Email, contentDescription = null) },
            )
            ListItem(
                colors = tileColors,
                modifier = Modifier.clickable { onRotate() },
                headlineContent = { Text("Régénérer la clé d'accès") },
                supportingContent = { Text("Invalide l'ancienne clé et déconnecte les autres appareils") },
                leadingContent = { Icon(Icons.Default.Key, contentDescription = null) },
            )
            ListItem(
                colors = tileColors,
                modifier = Modifier.clickable { onGeneratePin() },
                headlineContent = { Text("Connecter un téléphone") },
                supportingContent = { Text("Générer un code PIN à usage unique pour un autre appareil") },
                leadingContent = { Icon(Icons.Default.PhonelinkSetup, contentDescription = null) },
            )
            ListItem(
                colors = tileColors,
                headlineContent = { Text("Sessions actives") },
                supportingContent = {
                    Text(
                        if (state.sessions.isEmpty()) "Aucune autre session web"
                        else "${state.sessions.size} session(s) — appuyez sur Révoquer pour fermer",
                    )
                },
                leadingContent = { Icon(Icons.Default.Devices, contentDescription = null) },
            )
            state.sessions.forEach { s ->
                ListItem(
                    colors = tileColors,
                    headlineContent = {
                        Text(s.userAgent.ifBlank { "Session" }, style = MaterialTheme.typography.bodyMedium)
                    },
                    supportingContent = {
                        Text(
                            (if (s.current) "Cette session · " else "") + "vue ${s.lastSeen.take(10)}",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    },
                    trailingContent = {
                        if (!s.current) {
                            TextButton(onClick = { onRevokeSession(s.id) }) { Text("Révoquer") }
                        }
                    },
                )
            }
            if (state.sessions.any { !it.current }) {
                ListItem(
                    colors = tileColors,
                    modifier = Modifier.clickable {
                        onLogoutOthers { ok ->
                            Toast.makeText(
                                context,
                                if (ok) "Autres sessions déconnectées" else "Échec",
                                Toast.LENGTH_SHORT,
                            ).show()
                        }
                    },
                    headlineContent = {
                        Text("Tout déconnecter", color = MaterialTheme.colorScheme.error)
                    },
                    supportingContent = { Text("Ferme toutes les autres sessions") },
                    leadingContent = {
                        Icon(
                            Icons.AutoMirrored.Filled.ExitToApp,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.error,
                        )
                    },
                )
            }
        }
}

@Composable
internal fun AccountSection(
    state: SettingsUiState, onShowQr: () -> Unit, onExportData: ((String) -> Unit, () -> Unit) -> Unit,
) {
    val tileColors = ListItemDefaults.colors(containerColor = Color.Transparent)
    val context = LocalContext.current
        SettingsCard("Mon compte", Icons.Default.QrCode2) {
            ListItem(
                colors = tileColors,
                modifier = Modifier.clickable { onShowQr() },
                headlineContent = { Text("Mon QR code") },
                supportingContent = { Text("Partager votre page par QR code") },
                leadingContent = { Icon(Icons.Default.QrCode2, contentDescription = null) },
            )
            ListItem(
                colors = tileColors,
                modifier = Modifier.clickable {
                    onExportData(
                        { json ->
                            runCatching {
                                val f = File(context.getExternalFilesDir(null), "mindlog-export.json")
                                f.writeText(json)
                                Toast.makeText(context, "Exporté : ${f.absolutePath}", Toast.LENGTH_LONG).show()
                            }.onFailure {
                                Toast.makeText(context, "Échec de l'écriture", Toast.LENGTH_SHORT).show()
                            }
                        },
                        { Toast.makeText(context, "Export impossible", Toast.LENGTH_SHORT).show() },
                    )
                },
                headlineContent = { Text("Exporter mes données (RGPD)") },
                supportingContent = { Text("Télécharger toutes vos données en JSON") },
                leadingContent = { Icon(Icons.Default.Download, contentDescription = null) },
            )
        }
}

@Composable
internal fun DangerZoneSection(
    onSignOut: () -> Unit, onDelete: () -> Unit,
) {
    val tileColors = ListItemDefaults.colors(containerColor = Color.Transparent)
        SettingsCard("Zone de danger", Icons.Default.Warning, tint = MaterialTheme.colorScheme.error) {
            ListItem(
                colors = tileColors,
                modifier = Modifier.clickable { onSignOut() },
                headlineContent = {
                    Text("Se déconnecter", color = MaterialTheme.colorScheme.error)
                },
                supportingContent = { Text("Ferme la session sur cet appareil") },
                leadingContent = {
                    Icon(
                        Icons.AutoMirrored.Filled.ExitToApp,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.error,
                    )
                },
            )
            ListItem(
                colors = tileColors,
                modifier = Modifier.clickable { onDelete() },
                headlineContent = {
                    Text("Supprimer mon compte", color = MaterialTheme.colorScheme.error)
                },
                supportingContent = { Text("Effacement définitif de toutes vos données (RGPD)") },
                leadingContent = {
                    Icon(
                        Icons.Default.DeleteForever,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.error,
                    )
                },
            )
        }
}

/**
 * Bloc d'options groupé, façon « carte » (équivalent d'un `.opt-v2-block` du web) :
 * un en-tête icône + titre au-dessus d'une surface arrondie contenant les lignes.
 */
@Composable
internal fun SettingsCard(
    title: String,
    icon: ImageVector,
    tint: Color = MaterialTheme.colorScheme.primary,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(start = 6.dp, bottom = 6.dp),
        ) {
            Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text(
                title,
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold,
                color = tint,
            )
        }
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(content = content)
        }
    }
}
