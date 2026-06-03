package today.mindlog.id

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Key
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SheetValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

/**
 * Invite de sauvegarde de la clé E2E affichée au démarrage tant que la clé n'est
 * pas dans le coffre serveur. Trois protections au choix :
 *  - biométrie : protection rapide, sans rien à mémoriser (locale à l'appareil) ;
 *  - code PIN (par défaut) ou passphrase : sauvegarde portable, restaurable sur un
 *    autre appareil.
 *
 * La saisie du secret est INLINE dans la bottom sheet (et non un dialog imbriqué :
 * un AlertDialog par-dessus la sheet ne capte pas correctement le focus/clavier →
 * « la saisie ne fait rien »). Même approche que le RestorePane du chat.
 *
 * En mode [mandatory] (clé neuve sans coffre), l'invite est BLOQUANTE.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KeyBackupPrompt(
    biometricAvailable: Boolean,
    onBiometric: () -> Unit,
    onPassphrase: (passphrase: String, onDone: (Boolean) -> Unit) -> Unit,
    onPin: (pin: String, onDone: (Boolean) -> Unit) -> Unit,
    mandatory: Boolean = false,
) {
    var dismissed by remember { mutableStateOf(false) }
    var usePin by remember { mutableStateOf(true) } // PIN par défaut
    var secret by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf(false) }
    if (dismissed) return

    val sheetState = rememberModalBottomSheetState(
        skipPartiallyExpanded = true,
        confirmValueChange = { if (mandatory) it != SheetValue.Hidden else true },
    )
    val minLen = if (usePin) 4 else 8

    ModalBottomSheet(
        onDismissRequest = { if (!mandatory) dismissed = true },
        sheetState = sheetState,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .padding(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(
                Icons.Default.Key,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(32.dp),
            )
            Text(
                if (mandatory) "Sécurise ta clé de chiffrement 🔐" else "Protégez votre clé de chiffrement",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                if (mandatory)
                    "Avant d'activer la messagerie, protège ta clé : sans elle, tes messages " +
                        "chiffrés seraient définitivement perdus si tu changes d'appareil. " +
                        "Cette étape est obligatoire."
                else
                    "Vos messages sont chiffrés de bout en bout. Sauvegardez votre clé " +
                        "pour ne jamais la perdre — sinon vos messages deviendraient illisibles.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            if (biometricAvailable) {
                Spacer(Modifier.height(2.dp))
                Button(onClick = onBiometric, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Default.Fingerprint, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.size(8.dp))
                    Text("Activer la biométrie")
                }
                Text(
                    "Rapide, rien à mémoriser. Protection locale à cet appareil.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            // ── Saisie inline du secret (PIN par défaut / passphrase) ──
            OutlinedTextField(
                value = secret,
                onValueChange = { input ->
                    secret = if (usePin) input.filter { it.isDigit() }.take(12) else input
                    error = false
                },
                label = { Text(if (usePin) "Code PIN (4 chiffres min.)" else "Passphrase (8 car. min.)") },
                singleLine = true,
                isError = error,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = if (usePin) KeyboardType.NumberPassword else KeyboardType.Password),
                modifier = Modifier.fillMaxWidth(),
            )
            if (error) {
                Text(
                    "Échec de la sauvegarde. Réessayez.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
            Button(
                onClick = {
                    busy = true
                    error = false
                    // Succès : le parent cesse d'afficher l'invite (needsBackup repasse à
                    // false). Échec : on signale l'erreur et on laisse réessayer.
                    val cb: (Boolean) -> Unit = { ok ->
                        busy = false
                        error = !ok
                    }
                    if (usePin) onPin(secret, cb) else onPassphrase(secret, cb)
                },
                enabled = !busy && secret.length >= minLen,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (usePin) "Sauvegarder avec un code PIN" else "Sauvegarder avec une passphrase")
            }
            TextButton(
                onClick = { usePin = !usePin; secret = ""; error = false },
                modifier = Modifier.align(Alignment.CenterHorizontally),
            ) {
                Text(if (usePin) "Utiliser une passphrase à la place" else "Utiliser un code PIN à la place")
            }

            if (!mandatory) {
                TextButton(onClick = { dismissed = true }, modifier = Modifier.align(Alignment.End)) {
                    Text("Plus tard")
                }
            }
        }
    }
}
