package today.mindlog.id.feature.card

import org.junit.Assert.assertEquals
import org.junit.Test

class SlugifyTest {

    @Test
    fun slugify_lowercases_and_replaces_separators() {
        assertEquals("mon-site", slugifyKey("Mon Site"))
        assertEquals("site-web", slugifyKey("  Site   Web  "))
        assertEquals("github", slugifyKey("GitHub"))
    }

    @Test
    fun slugify_strips_leading_trailing_separators() {
        assertEquals("perso", slugifyKey("!! Perso !!"))
    }

    @Test
    fun slugify_blank_falls_back() {
        assertEquals("champ", slugifyKey("   "))
        assertEquals("champ", slugifyKey("***"))
    }
}
