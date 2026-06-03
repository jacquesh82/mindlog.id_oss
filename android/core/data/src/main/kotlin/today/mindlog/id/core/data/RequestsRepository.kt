package today.mindlog.id.core.data

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import today.mindlog.id.core.database.RequestDao
import today.mindlog.id.core.model.DaySlots
import today.mindlog.id.core.model.MeetingRequest
import today.mindlog.id.core.network.MindlogApi
import today.mindlog.id.core.network.dto.CreateRequestBody
import today.mindlog.id.core.network.dto.RequestStatusBody
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Demandes de RDV. Offline-first : les demandes reçues sont observées depuis le
 * cache Room ([incoming]) et [refresh] synchronise depuis /api/me. Les créneaux
 * et la création de demande sortante restent réseau.
 */
@Singleton
class RequestsRepository @Inject constructor(
    private val api: MindlogApi,
    private val dao: RequestDao,
) {
    /** Mes demandes de RDV reçues, depuis le cache (en attente d'abord). */
    fun incoming(): Flow<List<MeetingRequest>> =
        dao.all().map { rows -> rows.map { it.toModel() } }

    /** Récupère les demandes depuis /api/me et remplace le cache. */
    suspend fun refresh() {
        val me = api.me()
        dao.replaceAll(me.requests.map { it.toEntity() })
    }

    /** Mon nom à pré-remplir lors d'une demande sortante (display_name ou @handle). */
    suspend fun myDisplayName(): String {
        val me = api.me()
        val name = me.fields.firstOrNull { it.key == "display_name" }?.value?.takeIf { it.isNotBlank() }
        return name ?: "@${me.handle}"
    }

    suspend fun accept(id: Long) { api.respondRequest(id, RequestStatusBody("accepted")); refresh() }
    suspend fun decline(id: Long) { api.respondRequest(id, RequestStatusBody("declined")); refresh() }
    suspend fun delete(id: Long) { api.deleteRequest(id); refresh() }

    /** Créneaux libres d'un profil pour un jour (YYYY-MM-DD). */
    suspend fun slots(handle: String, day: String): DaySlots =
        api.slots(handle.removePrefix("@"), day).toModel()

    /** Demande un RDV à [handle]. [day]/[time] optionnels (créneau souhaité). */
    suspend fun createRequest(
        handle: String,
        name: String,
        message: String?,
        day: String?,
        time: String?,
    ) {
        api.createRequest(
            handle.removePrefix("@"),
            CreateRequestBody(name = name, message = message?.ifBlank { null }, day = day, time = time),
        )
    }
}
