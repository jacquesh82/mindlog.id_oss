package today.mindlog.id.feature.home

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.ClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight

@Composable
internal fun RecoveryEmailDialog(current: String, onDismiss: () -> Unit, onSave: (String) -> Unit) {
    var email by remember { mutableStateOf(current) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Email de récupération") },
        text = {
            Column {
                Text(
                    "Sert à récupérer l'accès à votre compte si vous perdez votre clé. " +
                        "Laissez vide pour le retirer.",
                    style = MaterialTheme.typography.bodySmall,
                )
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("Email") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                )
            }
        },
        confirmButton = { TextButton(onClick = { onSave(email.trim()) }) { Text("Enregistrer") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Annuler") } },
    )
}

/** Requête de saisie du secret du coffre, après choix de la méthode. */
internal data class VaultSecretReq(val isBackup: Boolean, val isPin: Boolean)

/** Choix de la méthode de déverrouillage du coffre : passphrase ou code PIN. */
@Composable
internal fun VaultMethodDialog(
    isBackup: Boolean,
    onDismiss: () -> Unit,
    onPick: (isPin: Boolean) -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (isBackup) "Sauvegarder ma clé E2E" else "Restaurer ma clé E2E") },
        text = {
            Column {
                Text(
                    if (isBackup) "Choisissez comment protéger votre clé."
                    else "Choisissez la méthode utilisée lors de la sauvegarde.",
                    style = MaterialTheme.typography.bodySmall,
                )
                ListItem(
                    modifier = Modifier.clickable { onPick(false) },
                    headlineContent = { Text("Passphrase") },
                    supportingContent = { Text("8 caractères minimum") },
                    leadingContent = { Icon(Icons.Default.Key, contentDescription = null) },
                )
                ListItem(
                    modifier = Modifier.clickable { onPick(true) },
                    headlineContent = { Text("Code PIN") },
                    supportingContent = { Text("4 chiffres minimum") },
                    leadingContent = { Icon(Icons.Default.Lock, contentDescription = null) },
                )
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("Annuler") } },
    )
}

/** Saisie de la passphrase ou du code PIN du coffre. */
@Composable
internal fun VaultSecretDialog(
    req: VaultSecretReq,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    var secret by remember { mutableStateOf("") }
    val minLen = if (req.isPin) 4 else 8
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                (if (req.isBackup) "Sauvegarder" else "Restaurer") +
                    (if (req.isPin) " — code PIN" else " — passphrase"),
            )
        },
        text = {
            Column {
                Text(
                    when {
                        req.isBackup && req.isPin -> "Choisissez un code PIN (4 chiffres min.). Conservez-le : il ne peut pas être récupéré."
                        req.isBackup -> "Choisissez une passphrase (8 caractères min.). Conservez-la : elle ne peut pas être récupérée."
                        req.isPin -> "Saisissez le code PIN utilisé lors de la sauvegarde."
                        else -> "Saisissez la passphrase utilisée lors de la sauvegarde."
                    },
                    style = MaterialTheme.typography.bodySmall,
                )
                OutlinedTextField(
                    value = secret,
                    onValueChange = { v -> secret = if (req.isPin) v.filter { it.isDigit() } else v },
                    label = { Text(if (req.isPin) "Code PIN" else "Passphrase") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(
                        keyboardType = if (req.isPin) KeyboardType.NumberPassword else KeyboardType.Password,
                    ),
                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(secret) },
                enabled = secret.length >= minLen,
            ) { Text(if (req.isBackup) "Sauvegarder" else "Restaurer") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Annuler") } },
    )
}

/** Génère un bitmap QR code (noir sur blanc) à partir d'un texte. */
internal fun generateQrBitmap(content: String, size: Int = 600): android.graphics.Bitmap {
    val matrix = QRCodeWriter().encode(content, BarcodeFormat.QR_CODE, size, size)
    val bmp = android.graphics.Bitmap.createBitmap(size, size, android.graphics.Bitmap.Config.ARGB_8888)
    for (x in 0 until size) {
        for (y in 0 until size) {
            bmp.setPixel(x, y, if (matrix[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE)
        }
    }
    return bmp
}

/** Code PIN d'appairage à usage unique. */
@Composable
internal fun PinDialog(pin: String, clipboard: ClipboardManager, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Connecter un téléphone") },
        text = {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                Text(
                    "Sur l'autre appareil, saisissez ce code à usage unique pour vous connecter. Il expire dans quelques minutes.",
                    style = MaterialTheme.typography.bodySmall,
                )
                Text(
                    pin,
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(top = 16.dp),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = {
                clipboard.setText(AnnotatedString(pin))
                onDismiss()
            }) { Text("Copier et fermer") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Fermer") } },
    )
}

/** QR code de la page publique. */
@Composable
internal fun QrDialog(publicUrl: String, clipboard: ClipboardManager, onDismiss: () -> Unit) {
    val qr = remember(publicUrl) {
        runCatching { generateQrBitmap(publicUrl) }.getOrNull()
    }
    AlertDialog(
        onDismissRequest = { onDismiss() },
        title = { Text("Mon QR code") },
        text = {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                if (qr != null) {
                    Image(
                        bitmap = qr.asImageBitmap(),
                        contentDescription = "QR code de votre page",
                        modifier = Modifier.size(240.dp),
                    )
                }
                Text(
                    publicUrl,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(top = 12.dp),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = {
                clipboard.setText(AnnotatedString(publicUrl))
                onDismiss()
            }) { Text("Copier le lien") }
        },
        dismissButton = { TextButton(onClick = { onDismiss() }) { Text("Fermer") } },
    )
}

/** Confirmation avant régénération de la clé d'accès. */
@Composable
internal fun RotateConfirmDialog(onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Régénérer la clé d'accès ?") },
        text = {
            Text(
                "Votre ancienne clé cessera de fonctionner et toutes vos autres sessions " +
                    "seront déconnectées. Cet appareil restera connecté avec la nouvelle clé.",
            )
        },
        confirmButton = {
            TextButton(onClick = onConfirm) { Text("Régénérer") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Annuler") } },
    )
}

/** Affiche une seule fois la clé d'accès fraîchement régénérée. */
@Composable
internal fun RotatedKeyDialog(key: String, clipboard: ClipboardManager, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Nouvelle clé d'accès") },
        text = {
            Column {
                Text(
                    "Conservez cette clé en lieu sûr : c'est votre seul moyen de vous " +
                        "reconnecter. Elle ne sera plus affichée.",
                    style = MaterialTheme.typography.bodySmall,
                )
                Text(
                    key,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(top = 12.dp),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = {
                clipboard.setText(AnnotatedString(key))
                onDismiss()
            }) { Text("Copier et fermer") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Fermer") } },
    )
}

/** Confirmation avant suppression définitive du compte. */
@Composable
internal fun DeleteConfirmDialog(onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Supprimer définitivement ?") },
        text = {
            Text(
                "Toutes vos données (carte, agenda, relations, messages) seront effacées " +
                    "sans possibilité de récupération. Cette action est irréversible.",
            )
        },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text("Supprimer", color = MaterialTheme.colorScheme.error)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Annuler") } },
    )
}
