package today.mindlog.id

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

private data class TourStep(val title: String, val body: String)

private val STEPS = listOf(
    TourStep(
        title = "Bienvenue ! 🦎",
        body = "Tu viens d'entrer dans ton espace mindlog · id. Je suis Milo, et je te montre la maison en quelques secondes.",
    ),
    TourStep(
        title = "Les 4 onglets",
        body = "En bas, quatre onglets : Échanges (tes discussions, groupes et lives), Réseau (tes relations), Agenda (tes rendez-vous) et Compte. Glisse de gauche à droite pour passer de l'un à l'autre.",
    ),
    TourStep(
        title = "En haut : alertes & menu",
        body = "La cloche 🔔 affiche tes alertes et le journal d'activité. Le menu ⋮ ouvre ton ID, ton espace Premium et ta galerie.",
    ),
    TourStep(
        title = "Tes réglages sont dans Compte",
        body = "Thème clair/sombre, couleur d'accentuation, confidentialité, sécurité de ta clé chiffrée et déconnexion : tout est dans l'onglet Compte. À tout de suite ! 🦎",
    ),
)

/**
 * Visite guidée Milo, one-shot, gated par `miloTourSeen`. Affichée la première
 * fois que l'utilisateur connecté ouvre l'app après l'onboarding.
 */
@Composable
fun MiloTour(onDismiss: () -> Unit) {
    var step by remember { mutableIntStateOf(0) }
    val current = STEPS[step]

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.65f))
            .clickable(enabled = false) {},
        contentAlignment = Alignment.Center,
    ) {
        Surface(
            shape = RoundedCornerShape(20.dp),
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 4.dp,
            modifier = Modifier
                .widthIn(max = 360.dp)
                .padding(24.dp),
        ) {
            Column(
                modifier = Modifier.padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Icon(
                    Icons.Default.AutoAwesome,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(28.dp),
                )
                Text(
                    current.title,
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    current.body,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                // Indicateur d'étape (points).
                Row(
                    modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    STEPS.indices.forEach { i ->
                        Box(
                            modifier = Modifier
                                .size(if (i == step) 8.dp else 6.dp)
                                .background(
                                    if (i == step) MaterialTheme.colorScheme.primary
                                    else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.3f),
                                    RoundedCornerShape(50),
                                ),
                        )
                    }
                }
                Row(
                    modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TextButton(onClick = onDismiss) { Text("Passer") }
                    Button(
                        onClick = {
                            if (step + 1 < STEPS.size) step += 1 else onDismiss()
                        },
                    ) {
                        Text(if (step + 1 < STEPS.size) "Suivant" else "C'est parti")
                    }
                }
            }
        }
    }
}
