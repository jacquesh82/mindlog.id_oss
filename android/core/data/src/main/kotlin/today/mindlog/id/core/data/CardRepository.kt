package today.mindlog.id.core.data

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import today.mindlog.id.core.database.CardDao
import today.mindlog.id.core.model.AgendaEvent
import today.mindlog.id.core.model.Card
import today.mindlog.id.core.model.IdentitySummary
import today.mindlog.id.core.network.MindlogApi
import today.mindlog.id.core.network.uploadPhotoBytes
import today.mindlog.id.core.network.dto.AddEventBody
import today.mindlog.id.core.network.dto.AddTagBody
import today.mindlog.id.core.network.dto.AvailabilityBody
import today.mindlog.id.core.network.dto.RecoveryEmailBody
import today.mindlog.id.core.network.dto.SettingsPatchBody
import today.mindlog.id.core.network.dto.UpsertFieldBody
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Carte du compte connecté, en offline-first : le cache Room est la source de
 * vérité observée par l'UI ([myCard]/[myEvents] sont des Flow), et [refresh]
 * synchronise depuis le réseau. Les écritures appellent l'API puis re-synchro.
 */
@Singleton
class CardRepository @Inject constructor(
    private val api: MindlogApi,
    private val dao: CardDao,
) {
    /** Ma carte observable, alimentée par le cache local. `null` tant que vide. */
    fun myCard(): Flow<Card?> =
        combine(dao.profile(), dao.fields()) { profile, fields ->
            profile?.let { buildCard(it, fields) }
        }

    /** Mes événements d'agenda observables depuis le cache. */
    fun myEvents(): Flow<List<AgendaEvent>> =
        dao.events().map { events -> events.map { it.toModel() } }

    /** Récupère /api/me et remplace atomiquement le cache. Peut throw (offline). */
    suspend fun refresh() {
        val me = api.me()
        dao.replaceAll(
            profile = me.toProfileEntity(),
            fields = me.fields.map { it.toEntity() },
            events = me.events.map { it.toEntity() },
        )
    }

    suspend fun search(query: String): List<IdentitySummary> =
        api.search(query).results.map { it.toModel() }

    /** Crée ou met à jour un attribut. [visibility] : "public" | "contact" | "private". */
    suspend fun setField(key: String, value: String?, label: String?, visibility: String?) {
        api.upsertField(UpsertFieldBody(key = key, value = value, label = label, visibility = visibility))
        refresh()
    }

    suspend fun deleteField(key: String) {
        api.deleteField(key)
        refresh()
    }

    suspend fun addEvent(
        title: String,
        startsAt: String,
        endsAt: String?,
        location: String?,
        link: String?,
    ): AgendaEvent {
        val event = api.addEvent(
            AddEventBody(title = title, startsAt = startsAt, endsAt = endsAt, location = location, link = link),
        ).toModel()
        refresh()
        return event
    }

    suspend fun deleteEvent(id: Long) {
        api.deleteEvent(id)
        refresh()
    }

    /** Téléverse une nouvelle photo de profil puis resynchronise. */
    suspend fun uploadPhoto(bytes: ByteArray, mime: String) {
        api.uploadPhotoBytes(bytes, mime)
        refresh()
    }

    /** Exceptions de disponibilité : jour (YYYY-MM-DD) -> "free" | "busy". */
    suspend fun overrides(): Map<String, String> = api.me().overrides

    /** Drapeaux du compte : coffre E2E, page publique/secrète, tags et email de récupération. */
    suspend fun accountFlags(): AccountFlags = api.me().let {
        AccountFlags(
            hasVault = it.hasVault,
            pagePublic = it.settings.publicAvailability,
            allowChat = it.settings.allowChat,
            allowCall = it.settings.allowCall,
            allowVideo = it.settings.allowVideo,
            allowRequests = it.settings.allowRequests,
            tags = it.tags,
            recoveryEmail = it.recoveryEmail,
        )
    }

    /** Bascule la visibilité de la page (public_availability). */
    suspend fun setPagePublic(public: Boolean) {
        api.updateSettings(SettingsPatchBody(publicAvailability = public))
    }

    /** Autoriser la messagerie chiffrée entrante (allow_chat). */
    suspend fun setAllowChat(allow: Boolean) {
        api.updateSettings(SettingsPatchBody(allowChat = allow))
    }

    /** Autoriser les appels audio entrants pair-à-pair (allow_call). */
    suspend fun setAllowCall(allow: Boolean) {
        api.updateSettings(SettingsPatchBody(allowCall = allow))
    }

    /** Proposer la vidéo, sinon audio seulement (allow_video). */
    suspend fun setAllowVideo(allow: Boolean) {
        api.updateSettings(SettingsPatchBody(allowVideo = allow))
    }

    /** Autoriser les demandes de rendez-vous des visiteurs (allow_requests). */
    suspend fun setAllowRequests(allow: Boolean) {
        api.updateSettings(SettingsPatchBody(allowRequests = allow))
    }

    suspend fun setDayStatus(day: String, status: String) {
        api.setDayStatus(day, AvailabilityBody(status))
    }

    /* ---------- Tags ---------- */

    /** Ajoute un tag et renvoie la liste à jour. */
    suspend fun addTag(tag: String): List<String> = api.addTag(AddTagBody(tag)).tags

    /** Retire un tag. */
    suspend fun removeTag(tag: String) {
        api.removeTag(tag)
    }

    /** Met à jour (ou efface si vide) l'email de récupération. */
    suspend fun setRecoveryEmail(email: String) {
        api.setRecoveryEmail(RecoveryEmailBody(email))
    }

    /** Export RGPD : renvoie le JSON complet des données du compte. */
    suspend fun exportData(): String = api.exportData().string()
}

/** Drapeaux du compte affichés sur l'accueil (badge vérifié + visibilité de page). */
data class AccountFlags(
    val hasVault: Boolean,
    val pagePublic: Boolean,
    val allowChat: Boolean = true,
    val allowCall: Boolean = true,
    val allowVideo: Boolean = true,
    val allowRequests: Boolean = true,
    val tags: List<String> = emptyList(),
    val recoveryEmail: String? = null,
)
