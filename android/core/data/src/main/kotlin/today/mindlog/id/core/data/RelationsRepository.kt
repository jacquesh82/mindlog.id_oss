package today.mindlog.id.core.data

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import today.mindlog.id.core.database.RelationDao
import today.mindlog.id.core.model.IdentitySummary
import today.mindlog.id.core.model.PublicProfile
import today.mindlog.id.core.model.Relation
import today.mindlog.id.core.network.MindlogApi
import today.mindlog.id.core.network.dto.AddRelationBody
import today.mindlog.id.core.network.inviteLink
import today.mindlog.id.core.network.parseInviteToken
import today.mindlog.id.core.datastore.ServerStore
import javax.inject.Inject
import javax.inject.Singleton

private const val KIND_DIRECT = "direct"
private const val KIND_INCOMING = "incoming"

/**
 * Relations et recherche. Offline-first : les relations directes et entrantes
 * sont observées depuis le cache Room ([directRelations]/[incomingRelations]) ;
 * [refresh] synchronise depuis /api/me. Recherche et profils restent réseau.
 */
@Singleton
class RelationsRepository @Inject constructor(
    private val api: MindlogApi,
    private val dao: RelationDao,
    private val serverStore: ServerStore,
) {
    fun directRelations(): Flow<List<Relation>> =
        dao.byKind(KIND_DIRECT).map { rows -> rows.map { it.toModel() } }

    fun incomingRelations(): Flow<List<Relation>> =
        dao.byKind(KIND_INCOMING).map { rows -> rows.map { it.toModel() } }

    /** Récupère relations directes (degré 1) + entrantes depuis /api/me. */
    suspend fun refresh() {
        val me = api.me()
        dao.replaceAll(
            direct = me.relations["1"].orEmpty().map { it.toEntity(KIND_DIRECT) },
            incoming = me.incoming.map { it.toEntity(KIND_INCOMING) },
        )
    }

    suspend fun search(query: String): List<IdentitySummary> =
        api.search(query).results.map { it.toModel() }

    suspend fun profile(handle: String): PublicProfile =
        api.publicCard(handle.removePrefix("@")).toProfile()

    suspend fun addRelation(handle: String, type: String? = null) {
        api.addRelation(AddRelationBody(handle = handle.removePrefix("@"), type = type))
        refresh()
    }

    suspend fun removeRelation(handle: String) {
        api.removeRelation(handle.removePrefix("@"))
        refresh()
    }

    /* ---------- Invitations de contact (sans annuaire) ---------- */

    /** Crée une invitation à usage unique → lien partageable. */
    suspend fun createInviteLink(): String = inviteLink(serverStore.baseUrl(), api.createInvite().token)

    /** Handle de l'inviteur depuis un lien/QR scanné, ou null si invalide/expiré. */
    suspend fun previewInvite(rawLinkOrToken: String): String? {
        val token = parseInviteToken(rawLinkOrToken) ?: rawLinkOrToken.trim()
        if (token.isBlank()) return null
        return runCatching { api.invitePreview(token).handle }.getOrNull()?.ifBlank { null }
    }

    /** Accepte une invitation (lien/QR/jeton) → relation mutuelle. Renvoie le handle. */
    suspend fun acceptInvite(rawLinkOrToken: String): String {
        val token = parseInviteToken(rawLinkOrToken) ?: rawLinkOrToken.trim()
        val r = api.acceptInvite(token)
        refresh()
        return r.handle
    }
}
