package today.mindlog.id.core.network.dto

import kotlinx.serialization.Serializable

@Serializable
data class OkDto(val ok: Boolean = false, val error: String? = null)

/** upsertField renvoie le champ à plat ; on ne lit pas le détail ici. */
typealias FieldUpsertResponse = FieldDto
