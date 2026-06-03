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
fun SettingsRoute(
    onBack: () -> Unit,
    onSignedOut: () -> Unit,
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    SettingsScreen(
        state = state,
        onBack = onBack,
        onToggleAgendaPublic = viewModel::toggleAgendaPublic,
        onToggleAllowChat = viewModel::toggleAllowChat,
        onToggleAllowCall = viewModel::toggleAllowCall,
        onToggleAllowVideo = viewModel::toggleAllowVideo,
        onToggleAllowRequests = viewModel::toggleAllowRequests,
        onSetRecoveryEmail = viewModel::setRecoveryEmail,
        onSetAccent = viewModel::setAccent,
        onBackupVault = viewModel::backupVault,
        onRestoreVault = viewModel::restoreVault,
        onLoadSessions = viewModel::loadSessions,
        onRevokeSession = viewModel::revokeSession,
        onLogoutOthers = viewModel::logoutOtherSessions,
        onGeneratePin = viewModel::generatePin,
        onDismissPin = viewModel::dismissPin,
        onExportData = viewModel::exportData,
        onRotateKey = viewModel::rotateKey,
        onDismissRotatedKey = viewModel::dismissRotatedKey,
        onDeleteAccount = { viewModel.deleteAccount(onSignedOut) },
        onSignOut = { viewModel.signOut(onSignedOut) },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun SettingsScreen(
    state: SettingsUiState,
    onBack: () -> Unit,
    onToggleAgendaPublic: () -> Unit,
    onToggleAllowChat: () -> Unit,
    onToggleAllowCall: () -> Unit,
    onToggleAllowVideo: () -> Unit,
    onToggleAllowRequests: () -> Unit,
    onSetRecoveryEmail: (String) -> Unit,
    onSetAccent: (String) -> Unit,
    onBackupVault: (String, Boolean, (Boolean) -> Unit) -> Unit,
    onRestoreVault: (String, Boolean, (Boolean) -> Unit) -> Unit,
    onLoadSessions: () -> Unit,
    onRevokeSession: (String) -> Unit,
    onLogoutOthers: ((Boolean) -> Unit) -> Unit,
    onGeneratePin: () -> Unit,
    onDismissPin: () -> Unit,
    onExportData: ((String) -> Unit, () -> Unit) -> Unit,
    onRotateKey: () -> Unit,
    onDismissRotatedKey: () -> Unit,
    onDeleteAccount: () -> Unit,
    onSignOut: () -> Unit,
) {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    var editingEmail by remember { mutableStateOf(false) }
    var confirmRotate by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var keyVisible by remember { mutableStateOf(false) }
    // Choix de méthode pour le coffre : true = sauvegarde, false = restauration, null = fermé.
    var vaultChooser by remember { mutableStateOf<Boolean?>(null) }
    // Saisie du secret une fois la méthode choisie.
    var secretReq by remember { mutableStateOf<VaultSecretReq?>(null) }
    var showQr by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    // Repli sans accents/casse pour une recherche tolérante (« video » trouve « vidéo »).
    fun fold(s: String) = java.text.Normalizer.normalize(s, java.text.Normalizer.Form.NFD)
        .replace(Regex("\\p{Mn}+"), "").lowercase()
    val q = fold(query.trim())
    // Une carte est affichée si la recherche est vide ou si l'un de ses mots-clés correspond.
    fun show(vararg keywords: String): Boolean = q.isEmpty() || keywords.any { fold(it).contains(q) }

    LaunchedEffect(Unit) { onLoadSessions() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Paramètres") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Retour")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState()),
        ) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                singleLine = true,
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                trailingIcon = {
                    if (query.isNotEmpty()) {
                        IconButton(onClick = { query = "" }) {
                            Icon(Icons.Default.Close, contentDescription = "Effacer")
                        }
                    }
                },
                placeholder = { Text("Rechercher un réglage…") },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            )

            /* ===== Apparence ===== */
            if (show("apparence", "couleur", "accent", "thème", "theme", "milo")) AppearanceSection(state = state, onSetAccent = onSetAccent)

            /* ===== Confidentialité — 3 blocs (comme le web) ===== */
            if (show("visibilité", "confidentialité", "agenda public", "profil", "disponibilités")) VisibilitySection(state = state, onToggleAgendaPublic = onToggleAgendaPublic)

            if (show("messagerie", "appels", "audio", "vidéo", "chat", "contacts")) MessagingSection(state = state, onToggleAllowChat = onToggleAllowChat, onToggleAllowCall = onToggleAllowCall, onToggleAllowVideo = onToggleAllowVideo)

            if (show("agenda", "rendez-vous", "rdv", "demandes", "créneau")) AgendaSection(state = state, onToggleAllowRequests = onToggleAllowRequests)

            /* ===== Sécurité ===== */
            if (show("sécurité", "chiffrement", "e2e", "coffre", "clé", "passphrase", "pin", "restaurer", "sauvegarder")) SecuritySection(state = state, onBackup = { vaultChooser = true }, onRestore = { vaultChooser = false })

            /* ===== Accès ===== */
            if (show("accès", "sessions", "url", "clé", "email", "récupération", "régénérer", "pin", "téléphone", "appareil", "déconnecter")) AccessSection(state = state, keyVisible = keyVisible, onToggleKeyVisible = { keyVisible = !keyVisible }, onEditEmail = { editingEmail = true }, onRotate = { confirmRotate = true }, onGeneratePin = onGeneratePin, onRevokeSession = onRevokeSession, onLogoutOthers = onLogoutOthers)

            /* ===== Compte ===== */
            if (show("compte", "qr", "code", "export", "rgpd", "données")) AccountSection(state = state, onShowQr = { showQr = true }, onExportData = onExportData)

            if (show("zone de danger", "déconnecter", "supprimer", "compte", "suppression")) DangerZoneSection(onSignOut = onSignOut, onDelete = { confirmDelete = true })

            Spacer(Modifier.height(24.dp))
        }
    }

    if (editingEmail) {
        RecoveryEmailDialog(
            current = state.recoveryEmail,
            onDismiss = { editingEmail = false },
            onSave = { onSetRecoveryEmail(it); editingEmail = false },
        )
    }

    vaultChooser?.let { isBackup ->
        VaultMethodDialog(
            isBackup = isBackup,
            onDismiss = { vaultChooser = null },
            onPick = { isPin ->
                secretReq = VaultSecretReq(isBackup = isBackup, isPin = isPin)
                vaultChooser = null
            },
        )
    }

    secretReq?.let { req ->
        VaultSecretDialog(
            req = req,
            onDismiss = { secretReq = null },
            onConfirm = { secret ->
                secretReq = null
                val cb: (Boolean) -> Unit = { ok ->
                    val msg = when {
                        ok && req.isBackup -> "Clé sauvegardée ✓"
                        ok -> "Clé restaurée ✓"
                        req.isBackup -> "Échec de la sauvegarde"
                        else -> if (req.isPin) "Code PIN incorrect" else "Passphrase incorrecte"
                    }
                    Toast.makeText(context, msg, Toast.LENGTH_SHORT).show()
                }
                if (req.isBackup) onBackupVault(secret, req.isPin, cb)
                else onRestoreVault(secret, req.isPin, cb)
            },
        )
    }

    state.linkPin?.let { pin -> PinDialog(pin = pin, clipboard = clipboard, onDismiss = onDismissPin) }

    if (showQr) QrDialog(publicUrl = state.publicUrl, clipboard = clipboard, onDismiss = { showQr = false })

    if (confirmRotate) RotateConfirmDialog(onConfirm = { confirmRotate = false; onRotateKey() }, onDismiss = { confirmRotate = false })

    state.rotatedKey?.let { key -> RotatedKeyDialog(key = key, clipboard = clipboard, onDismiss = onDismissRotatedKey) }

    if (confirmDelete) DeleteConfirmDialog(onConfirm = { confirmDelete = false; onDeleteAccount() }, onDismiss = { confirmDelete = false })
}

