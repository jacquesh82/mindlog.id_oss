package today.mindlog.id

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * Modale d'invitation Premium (workflow d'upsell au lancement).
 *
 * Affichée par [MainScreen] quand [PremiumUpsellViewModel.ui] passe
 * `visible=true`. Cohérente avec l'équivalent web (`plugins/premium-upsell.js`).
 */
@Composable
fun PremiumUpsellDialog(
    state: UpsellUi,
    onStartTrial: () -> Unit,
    onDismiss: () -> Unit,
) {
    if (!state.visible) return
    AlertDialog(
        onDismissRequest = { if (!state.processing) onDismiss() },
        title = {
            Text(
                if (state.trialAvailable) "✨ Essaie Premium gratuitement"
                else "✨ Passe à Premium",
                fontWeight = FontWeight.SemiBold,
            )
        },
        text = {
            Column {
                Text(
                    if (state.trialAvailable)
                        "Un mois offert pour profiter de l'espace abonné·e·s, des lives, du chat illimité et des pages payantes. Aucune carte demandée, pas de renouvellement automatique."
                    else
                        "Débloque l'espace abonné·e·s, les lives, le chat illimité et les pages payantes.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(12.dp))
                Bullet("🎥", "Lives mesh P2P illimités")
                Bullet("🗂️", "Pages payantes (galerie, markdown, liens)")
                Bullet("💬", "Chat & appels réservés à tes abonné·e·s")
                Bullet("🗓️", "RDV prioritaires dans ton agenda")
                if (state.trialAvailable) {
                    Spacer(Modifier.height(12.dp))
                    Text(
                        "L'essai s'arrête tout seul au bout d'un mois. Tu pourras t'abonner quand tu voudras.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onStartTrial, enabled = !state.processing) {
                if (state.processing) {
                    CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.height(18.dp))
                } else {
                    Text(
                        if (state.trialAvailable) "Démarrer mon essai de ${state.trialDays} jours"
                        else "Voir l'offre",
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !state.processing) { Text("Plus tard") }
        },
    )
}

@Composable
private fun Bullet(emoji: String, label: String) {
    androidx.compose.foundation.layout.Row(
        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(emoji, style = MaterialTheme.typography.bodyMedium)
        Text(label, style = MaterialTheme.typography.bodyMedium)
    }
}
