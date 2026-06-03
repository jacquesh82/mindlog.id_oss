package today.mindlog.id.core.designsystem

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val timeFmt = DateTimeFormatter.ofPattern("HH:mm", Locale.getDefault())
private val dayFmt = DateTimeFormatter.ofPattern("dd/MM", Locale.getDefault())

/** Parse un instant ISO 8601 (Z ou offset) en heure locale, ou null. */
fun parseIsoLocal(iso: String): LocalDateTime? = runCatching {
    Instant.parse(iso).atZone(ZoneId.systemDefault()).toLocalDateTime()
}.recoverCatching {
    OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault()).toLocalDateTime()
}.recoverCatching {
    LocalDateTime.parse(iso)
}.getOrNull()

/** Horodatage compact pour listes : « 10:30 » aujourd'hui, « Hier », sinon « 28/05 ». */
fun relativeTimeLabel(iso: String): String {
    val dt = parseIsoLocal(iso) ?: return ""
    val today = LocalDate.now()
    return when (dt.toLocalDate()) {
        today -> dt.format(timeFmt)
        today.minusDays(1) -> "Hier"
        else -> dt.format(dayFmt)
    }
}
