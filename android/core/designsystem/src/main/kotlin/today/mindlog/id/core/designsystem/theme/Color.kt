package today.mindlog.id.core.designsystem.theme

import androidx.compose.ui.graphics.Color

// Palette « caméléon » sombre, calquée sur la maquette de l'app.
internal val MiloGreen = Color(0xFF2FB85F) // accent principal (FAB, badges, liens)
internal val MiloGreenDeep = Color(0xFF1F8A47) // pressé / variantes
internal val MiloGreenContainer = Color(0xFF123524) // surfaces accentuées (carte « Disponible »)
internal val MiloAmber = Color(0xFFF2B441)

// Fond et surfaces (dark).
internal val Ink = Color(0xFF0B0C0B) // fond global quasi noir
internal val InkElevated = Color(0xFF141614) // cartes / sections
internal val InkTile = Color(0xFF1B1E1B) // tuiles, pilules, champs
internal val InkOutline = Color(0xFF2A2E2B) // bordures discrètes
internal val InkOutlineSoft = Color(0xFF1F2320)

// Texte sur fond sombre.
internal val TextPrimary = Color(0xFFECEFEC)
internal val TextMuted = Color(0xFF8C938C) // libellés secondaires, métadonnées
internal val OnGreen = Color(0xFF05140B)

// Fond et surfaces (light), parité avec public/style.css `--bg`/`--card`.
internal val Paper = Color(0xFFF3F4FB) // fond global papier
internal val PaperElevated = Color(0xFFFFFFFF) // cartes / sections
internal val PaperTile = Color(0xFFE9EBF3) // tuiles, pilules, champs
internal val PaperOutline = Color(0xFFD7DAE5) // bordures discrètes
internal val PaperOutlineSoft = Color(0xFFE3E5EE)

// Texte sur fond clair.
internal val InkPrimary = Color(0xFF1B2030)
internal val InkMuted = Color(0xFF5A6072)

// Couleurs SÉMANTIQUES fixes — volontairement indépendantes de l'accent caméléon.
// Présence (en ligne/absent/occupé) et sceau « vérifié » doivent garder un sens
// universel quelle que soit la couleur d'accentuation choisie par l'utilisateur.
internal val PresenceOnline = Color(0xFF3FBF6A) // en ligne → vert
internal val PresenceAway = Color(0xFFF2A33C) // absent → orange
internal val PresenceBusy = Color(0xFFE8503A) // occupé → rouge
internal val VerifiedBlue = Color(0xFF3897F0) // sceau « vérifié » → bleu (jamais l'accent)

/** Statut de présence affiché sur l'avatar (couleur fixe, hors palette caméléon). */
enum class PresenceStatus(val color: Color) {
    ONLINE(PresenceOnline),
    AWAY(PresenceAway),
    BUSY(PresenceBusy),
    OFFLINE(TextMuted),
}
