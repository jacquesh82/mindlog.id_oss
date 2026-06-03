package today.mindlog.id.core.designsystem.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp

// Schéma sombre fixe (fond quasi noir) ; seul l'accent est personnalisable. Pas
// de Material You, pour garder l'identité de marque sur tous les appareils.
private fun mindlogColors(accent: Color) = darkColorScheme(
    primary = accent,
    onPrimary = OnGreen,
    primaryContainer = lerp(Ink, accent, 0.20f),
    onPrimaryContainer = accent,
    secondary = MiloAmber,
    onSecondary = OnGreen,
    tertiary = accent,
    background = Ink,
    onBackground = TextPrimary,
    surface = InkElevated,
    onSurface = TextPrimary,
    surfaceVariant = InkTile,
    onSurfaceVariant = TextMuted,
    surfaceContainer = InkElevated,
    surfaceContainerHigh = InkTile,
    surfaceContainerHighest = InkTile,
    outline = InkOutline,
    outlineVariant = InkOutlineSoft,
)

@Composable
fun MindlogTheme(
    accent: Color = MiloGreen,
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = remember(accent) { mindlogColors(accent) },
        shapes = MindlogShapes,
        typography = MindlogTypography,
        content = content,
    )
}
