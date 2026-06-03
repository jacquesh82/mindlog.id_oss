package today.mindlog.id.feature.agenda

import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

private val displayFormatter: DateTimeFormatter =
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
        .withLocale(Locale.getDefault())

/** Parse un instant ISO 8601 vers l'heure locale de l'appareil, ou null si invalide. */
internal fun parseIso(iso: String): LocalDateTime? = runCatching {
    OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault()).toLocalDateTime()
}.recoverCatching {
    Instant.parse(iso).atZone(ZoneId.systemDefault()).toLocalDateTime()
}.recoverCatching {
    LocalDateTime.parse(iso)
}.getOrNull()

/** Représentation lisible d'un événement (date + heure locale). */
internal fun formatEvent(iso: String): String =
    parseIso(iso)?.format(displayFormatter) ?: iso

/**
 * Construit un instant ISO 8601 en UTC (suffixe Z) à partir d'une date (millis
 * UTC de minuit, comme rendu par le DatePicker Material3) et d'une heure locale.
 */
internal fun buildIso(dateUtcMillis: Long, hour: Int, minute: Int): String {
    val date = Instant.ofEpochMilli(dateUtcMillis).atZone(ZoneOffset.UTC).toLocalDate()
    val instant = date.atTime(hour, minute).atZone(ZoneId.systemDefault()).toInstant()
        .truncatedTo(java.time.temporal.ChronoUnit.SECONDS)
    return DateTimeFormatter.ISO_INSTANT.format(instant) // ex. 2026-06-01T14:00:00Z
}
