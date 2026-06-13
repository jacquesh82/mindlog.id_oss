package today.mindlog.id.core.network.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Attribut de carte renvoyé par le backend (src/store.ts CardField). */
@Serializable
data class FieldDto(
    val key: String,
    val label: String = "",
    val value: String = "",
    @SerialName("is_custom") val isCustom: Int = 0,
    @SerialName("is_public") val isPublic: Int = 0,
    val visibility: String = "public",
    val position: Int = 0,
)

/** Réponse de GET /api/me — la carte privée du compte connecté. */
@Serializable
data class MeDto(
    val handle: String,
    val accessKey: String? = null,
    val fields: List<FieldDto> = emptyList(),
    val events: List<EventDto> = emptyList(),
    val hasPhoto: Boolean = false,
    val pubkey: String = "",
    val unread: Int = 0,
    val pending: Int = 0,
    val recoveryEmail: String? = null,
    // Tags de la carte (compétences / centres d'intérêt).
    val tags: List<String> = emptyList(),
    // Relations par degré ("1","2","3") + demandes entrantes.
    val relations: Map<String, List<RelationDto>> = emptyMap(),
    val incoming: List<RelationDto> = emptyList(),
    // Demandes de RDV reçues.
    val requests: List<RequestDto> = emptyList(),
    // Exceptions de disponibilité : jour (YYYY-MM-DD) -> "free" | "busy".
    val overrides: Map<String, String> = emptyMap(),
    // Notifications in-app.
    val notifications: List<NotificationDto> = emptyList(),
    // Coffre de clé E2E présent → compte « sécurisé/vérifié ».
    val hasVault: Boolean = false,
    // Préférences (dont public_availability = page « publique » vs « secrète »).
    val settings: SettingsDto = SettingsDto(),
    // Conversations chiffrées (métadonnées seulement ; le contenu reste E2E).
    val conversations: List<ConversationDto> = emptyList(),
)

/** Préférences du compte (miroir de src/store.ts Settings, hors `availability`). */
@Serializable
data class SettingsDto(
    @SerialName("allow_chat") val allowChat: Boolean = true,
    @SerialName("allow_call") val allowCall: Boolean = true,
    @SerialName("allow_video") val allowVideo: Boolean = true,
    @SerialName("allow_requests") val allowRequests: Boolean = true,
    @SerialName("public_availability") val publicAvailability: Boolean = true,
)

/** Corps partiel de PATCH /api/me/settings (n'envoie que les booléens modifiés). */
@Serializable
data class SettingsPatchBody(
    @SerialName("public_availability") val publicAvailability: Boolean? = null,
    @SerialName("allow_chat") val allowChat: Boolean? = null,
    @SerialName("allow_call") val allowCall: Boolean? = null,
    @SerialName("allow_video") val allowVideo: Boolean? = null,
    @SerialName("allow_requests") val allowRequests: Boolean? = null,
)

/** Crée ou met à jour un attribut de carte. */
@Serializable
data class UpsertFieldBody(
    val key: String,
    val value: String? = null,
    val label: String? = null,
    val visibility: String? = null,
    @SerialName("is_public") val isPublic: Boolean? = null,
)

/** Corps de POST /api/tags. */
@Serializable
data class AddTagBody(val tag: String)

/** Réponse de POST /api/tags : liste des tags à jour. */
@Serializable
data class TagsResponseDto(val tags: List<String> = emptyList())

/** Corps de PUT /api/recovery-email (chaîne vide = retrait). */
@Serializable
data class RecoveryEmailBody(val email: String)

/** Résultats de GET /api/search. */
@Serializable
data class SearchResponseDto(
    val results: List<SearchResultDto> = emptyList(),
)

@Serializable
data class SearchResultDto(
    val handle: String,
    @SerialName("display_name") val displayName: String = "",
    val title: String = "",
    @SerialName("has_photo") val hasPhoto: Boolean = false,
)

/** Carte publique d'un autre profil (GET /api/identities/:handle). */
@Serializable
data class PublicCardDto(
    val handle: String,
    val fields: List<FieldDto> = emptyList(),
    val events: List<EventDto> = emptyList(),
    val hasPhoto: Boolean = false,
    val viewer: ViewerDto? = null,
    val options: OptionsDto = OptionsDto(),
    // Markdown libre rendu au-dessus de la bio (OSS depuis fb180ab).
    @SerialName("profile_intro_md") val profileIntroMd: String = "",
)

@Serializable
data class OptionsDto(
    val allowRequests: Boolean = false,
    val publicAvailability: Boolean = false,
)

@Serializable
data class ViewerDto(
    val handle: String? = null,
    val isContact: Boolean = false,
    val isRelated: Boolean = false,
)
