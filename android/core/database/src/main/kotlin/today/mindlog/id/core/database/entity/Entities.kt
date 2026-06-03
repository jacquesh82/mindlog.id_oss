package today.mindlog.id.core.database.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Profil du compte connecté. Une seule ligne (id = 0) : c'est l'identité de
 * l'appareil. Conserver le handle/displayName permet d'afficher la carte hors
 * ligne dès le lancement.
 */
@Entity(tableName = "profile")
data class ProfileEntity(
    @PrimaryKey val id: Int = SINGLETON_ID,
    val handle: String,
    val displayName: String?,
    val hasPhoto: Boolean,
) {
    companion object { const val SINGLETON_ID = 0 }
}

/** Un attribut de carte, identifié par sa clé (display_name, github, …). */
@Entity(tableName = "card_field")
data class CardFieldEntity(
    @PrimaryKey val key: String,
    val label: String,
    val value: String?,
    val visibility: String,
    val position: Int,
)

/** Un événement d'agenda. */
@Entity(tableName = "agenda_event")
data class AgendaEventEntity(
    @PrimaryKey val id: Long,
    val title: String,
    val startsAt: String,
    val endsAt: String?,
    val location: String?,
    val link: String?,
)

/**
 * Une relation, mise en cache. [kind] distingue les relations directes
 * ("direct") des demandes entrantes ("incoming") — clé composite (handle, kind).
 */
@Entity(tableName = "relation", primaryKeys = ["handle", "kind"])
data class RelationEntity(
    val handle: String,
    val kind: String,
    val displayName: String?,
    val hasPhoto: Boolean,
    val type: String?,
    val mutual: Boolean,
)

/** Une demande de RDV reçue, mise en cache. */
@Entity(tableName = "meeting_request")
data class MeetingRequestEntity(
    @PrimaryKey val id: Long,
    val name: String,
    val email: String?,
    val message: String?,
    val day: String?,
    val time: String?,
    val status: String,
    val createdAt: String,
)
