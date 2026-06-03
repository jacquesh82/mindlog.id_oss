package today.mindlog.id.feature.agenda

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate

class AvailabilityLogicTest {

    @Test
    fun default_status_is_free_on_weekdays_busy_on_weekend() {
        // 2026-06-01 est un lundi, 2026-06-06 un samedi, 2026-06-07 un dimanche.
        assertEquals("free", defaultStatus(LocalDate.parse("2026-06-01")))
        assertEquals("busy", defaultStatus(LocalDate.parse("2026-06-06")))
        assertEquals("busy", defaultStatus(LocalDate.parse("2026-06-07")))
    }

    @Test
    fun override_wins_over_default() {
        val saturday = LocalDate.parse("2026-06-06")
        val weekday = LocalDate.parse("2026-06-01")
        val overrides = mapOf(
            "2026-06-06" to "free", // samedi forcé libre
            "2026-06-01" to "busy", // lundi forcé occupé
        )
        assertEquals("free", effectiveStatus(saturday, overrides))
        assertEquals("busy", effectiveStatus(weekday, overrides))
    }

    @Test
    fun effective_falls_back_to_default_without_override() {
        assertEquals("free", effectiveStatus(LocalDate.parse("2026-06-01"), emptyMap()))
        assertEquals("busy", effectiveStatus(LocalDate.parse("2026-06-07"), emptyMap()))
    }
}
