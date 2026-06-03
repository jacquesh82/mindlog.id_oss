package today.mindlog.id.core.designsystem.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb

/** Une couleur d'accent nommée, proposée dans Options (parité avec le web). */
data class MindlogAccent(val name: String, val color: Color)

/** Palette d'accents — mêmes teintes que le sélecteur web. */
val MindlogAccents: List<MindlogAccent> = listOf(
    MindlogAccent("Vert", Color(0xFF5FD39A)),
    MindlogAccent("Bleu", Color(0xFF6EA8FE)),
    MindlogAccent("Violet", Color(0xFFB48CFF)),
    MindlogAccent("Ambre", Color(0xFFF5B86B)),
    MindlogAccent("Corail", Color(0xFFF4807A)),
    MindlogAccent("Cyan", Color(0xFF4FD1C5)),
)

/** Représentation hexadécimale "#RRGGBB" (pour persistance). */
fun Color.toHex(): String = "#%06X".format(0xFFFFFF and toArgb())

/** Parse "#RRGGBB" → Color, ou null si invalide. */
fun accentFromHex(hex: String?): Color? = hex?.let {
    runCatching { Color(("FF" + it.removePrefix("#")).toLong(16)) }.getOrNull()
}

/** Accent par défaut quand aucun n'est encore choisi. */
val DefaultAccent: Color = MindlogAccents.first().color
