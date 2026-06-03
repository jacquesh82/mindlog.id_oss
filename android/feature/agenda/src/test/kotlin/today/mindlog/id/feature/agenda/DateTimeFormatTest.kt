package today.mindlog.id.feature.agenda

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class DateTimeFormatTest {

    @Test
    fun buildIso_produces_utc_instant_with_z_suffix() {
        val midnightUtc = Instant.parse("2026-06-01T00:00:00Z").toEpochMilli()
        val iso = buildIso(midnightUtc, hour = 14, minute = 30)
        assertTrue("doit se terminer par Z : $iso", iso.endsWith("Z"))
        assertTrue(iso.contains("T"))
    }

    @Test
    fun buildIso_then_parseIso_preserves_local_time() {
        val midnightUtc = Instant.parse("2026-06-01T00:00:00Z").toEpochMilli()
        val parsed = parseIso(buildIso(midnightUtc, hour = 14, minute = 30))
        assertNotNull(parsed)
        // L'heure locale choisie est conservée après l'aller-retour.
        assertEquals(14, parsed!!.hour)
        assertEquals(30, parsed.minute)
    }

    @Test
    fun parseIso_accepts_iso_instant_and_rejects_garbage() {
        assertNotNull(parseIso("2026-06-01T14:00:00Z"))
        assertNotNull(parseIso("2026-06-01T14:00:00+02:00"))
        assertNull(parseIso("pas une date"))
    }
}
