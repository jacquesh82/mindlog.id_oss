package today.mindlog.id.core.designsystem.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp

/** Mode de thème choisi par l'utilisateur (mirroir du toggle Web). */
enum class ThemeMode {
    /** Suit le mode système (default). */
    SYSTEM,
    LIGHT,
    DARK,
    ;

    companion object {
        fun fromString(s: String?): ThemeMode = when (s?.lowercase()) {
            "light" -> LIGHT
            "dark" -> DARK
            else -> SYSTEM
        }
    }

    val storeValue: String get() = name.lowercase()
}

// Pas de Material You : on garde l'identité de marque sur tous les appareils.
private fun darkColors(accent: Color) = darkColorScheme(
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

private fun lightColors(accent: Color) = lightColorScheme(
    primary = accent,
    onPrimary = Color.White,
    primaryContainer = lerp(Color.White, accent, 0.20f),
    onPrimaryContainer = lerp(InkPrimary, accent, 0.40f),
    secondary = MiloAmber,
    onSecondary = Color.White,
    tertiary = accent,
    background = Paper,
    onBackground = InkPrimary,
    surface = PaperElevated,
    onSurface = InkPrimary,
    surfaceVariant = PaperTile,
    onSurfaceVariant = InkMuted,
    surfaceContainer = PaperElevated,
    surfaceContainerHigh = PaperTile,
    surfaceContainerHighest = PaperTile,
    outline = PaperOutline,
    outlineVariant = PaperOutlineSoft,
)

@Composable
fun MindlogTheme(
    accent: Color = MiloGreen,
    isDark: Boolean = true,
    content: @Composable () -> Unit,
) {
    val scheme = remember(accent, isDark) {
        if (isDark) darkColors(accent) else lightColors(accent)
    }
    MaterialTheme(
        colorScheme = scheme,
        shapes = MindlogShapes,
        typography = MindlogTypography,
        content = content,
    )
}
