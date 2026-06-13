package today.mindlog.id.core.data

import today.mindlog.id.core.database.entity.AgendaEventEntity
import today.mindlog.id.core.database.entity.CardFieldEntity
import today.mindlog.id.core.database.entity.MeetingRequestEntity
import today.mindlog.id.core.database.entity.ProfileEntity
import today.mindlog.id.core.database.entity.RelationEntity
import today.mindlog.id.core.model.AgendaEvent
import today.mindlog.id.core.model.AppNotification
import today.mindlog.id.core.model.Card
import today.mindlog.id.core.model.CardField
import today.mindlog.id.core.model.DaySlots
import today.mindlog.id.core.model.IdentitySummary
import today.mindlog.id.core.model.MeetingRequest
import today.mindlog.id.core.model.PublicProfile
import today.mindlog.id.core.model.Relation
import today.mindlog.id.core.model.RequestStatus
import today.mindlog.id.core.model.Slot
import today.mindlog.id.core.model.Visibility
import today.mindlog.id.core.network.dto.EventDto
import today.mindlog.id.core.network.dto.FieldDto
import today.mindlog.id.core.network.dto.MeDto
import today.mindlog.id.core.network.dto.NotificationDto
import today.mindlog.id.core.network.dto.PublicCardDto
import today.mindlog.id.core.network.dto.RelationDto
import today.mindlog.id.core.network.dto.RequestDto
import today.mindlog.id.core.network.dto.SearchResultDto
import today.mindlog.id.core.network.dto.SlotsDto

internal fun String.toVisibility(): Visibility = when (this) {
    "contact" -> Visibility.CONTACT
    "private" -> Visibility.PRIVATE
    else -> Visibility.PUBLIC
}

internal fun FieldDto.toModel(): CardField = CardField(
    key = key,
    value = value.ifBlank { null },
    label = label,
    visibility = visibility.toVisibility(),
)

internal fun EventDto.toModel(): AgendaEvent = AgendaEvent(
    id = id,
    title = title,
    startsAt = startsAt,
    endsAt = endsAt,
    location = location.ifBlank { null },
    link = link.ifBlank { null },
)

internal fun SearchResultDto.toModel(): IdentitySummary = IdentitySummary(
    handle = handle,
    displayName = displayName.ifBlank { null },
    title = title.ifBlank { null },
    hasPhoto = hasPhoto,
)

internal fun RelationDto.toModel(): Relation = Relation(
    handle = handle,
    displayName = displayName.ifBlank { null },
    hasPhoto = hasPhoto,
    type = type,
    mutual = mutual,
)

internal fun PublicCardDto.toProfile(): PublicProfile = PublicProfile(
    handle = handle,
    displayName = fields.firstOrNull { it.key == "display_name" }?.value?.ifBlank { null },
    fields = fields.map { it.toModel() },
    hasPhoto = hasPhoto,
    isContact = viewer?.isContact == true,
    isRelated = viewer?.isRelated == true,
    allowRequests = options.allowRequests,
    introMd = profileIntroMd.ifBlank { null },
)

internal fun RequestDto.toModel(): MeetingRequest = MeetingRequest(
    id = id,
    name = name,
    email = email.ifBlank { null },
    message = message.ifBlank { null },
    day = day,
    time = time,
    status = when (status) {
        "accepted" -> RequestStatus.ACCEPTED
        "declined" -> RequestStatus.DECLINED
        else -> RequestStatus.PENDING
    },
    createdAt = createdAt,
)

internal fun NotificationDto.toModel(): AppNotification = AppNotification(
    id = id,
    type = type,
    text = text,
    link = link?.ifBlank { null },
    read = read != 0,
    createdAt = createdAt,
)

internal fun SlotsDto.toModel(): DaySlots = DaySlots(
    day = day,
    status = status,
    slots = slots.map { Slot(time = it.time, taken = it.taken) },
)

/* ----------------------- DTO réseau → entités Room ----------------------- */

internal fun MeDto.toProfileEntity(): ProfileEntity {
    val displayName = fields.firstOrNull { it.key == "display_name" }?.value?.ifBlank { null }
    return ProfileEntity(handle = handle, displayName = displayName, hasPhoto = hasPhoto)
}

internal fun FieldDto.toEntity(): CardFieldEntity = CardFieldEntity(
    key = key,
    label = label,
    value = value.ifBlank { null },
    visibility = visibility,
    position = position,
)

internal fun EventDto.toEntity(): AgendaEventEntity = AgendaEventEntity(
    id = id,
    title = title,
    startsAt = startsAt,
    endsAt = endsAt,
    location = location.ifBlank { null },
    link = link.ifBlank { null },
)

/* ----------------------- Entités Room → modèle domaine ------------------- */

internal fun CardFieldEntity.toModel(): CardField = CardField(
    key = key,
    value = value?.ifBlank { null },
    label = label,
    visibility = visibility.toVisibility(),
)

internal fun AgendaEventEntity.toModel(): AgendaEvent = AgendaEvent(
    id = id,
    title = title,
    startsAt = startsAt,
    endsAt = endsAt,
    location = location,
    link = link,
)

/* ----------------------- Relations / requests (Room) -------------------- */

internal fun RelationDto.toEntity(kind: String): RelationEntity = RelationEntity(
    handle = handle,
    kind = kind,
    displayName = displayName.ifBlank { null },
    hasPhoto = hasPhoto,
    type = type,
    mutual = mutual,
)

internal fun RelationEntity.toModel(): Relation = Relation(
    handle = handle,
    displayName = displayName,
    hasPhoto = hasPhoto,
    type = type,
    mutual = mutual,
)

internal fun RequestDto.toEntity(): MeetingRequestEntity = MeetingRequestEntity(
    id = id,
    name = name,
    email = email.ifBlank { null },
    message = message.ifBlank { null },
    day = day,
    time = time,
    status = status,
    createdAt = createdAt,
)

internal fun MeetingRequestEntity.toModel(): MeetingRequest = MeetingRequest(
    id = id,
    name = name,
    email = email,
    message = message,
    day = day,
    time = time,
    status = when (status) {
        "accepted" -> RequestStatus.ACCEPTED
        "declined" -> RequestStatus.DECLINED
        else -> RequestStatus.PENDING
    },
    createdAt = createdAt,
)

internal fun buildCard(profile: ProfileEntity, fields: List<CardFieldEntity>): Card = Card(
    handle = profile.handle,
    displayName = profile.displayName,
    fields = fields.map { it.toModel() },
    hasPhoto = profile.hasPhoto,
    isContact = true,
    isRelated = true,
)
