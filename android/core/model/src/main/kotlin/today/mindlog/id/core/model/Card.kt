package today.mindlog.id.core.model

/** Niveau de visibilité d'un attribut de carte, miroir du backend. */
enum class Visibility { PUBLIC, CONTACT, PRIVATE }

/** Un attribut de la carte d'identité (display_name, github, bio, …). */
data class CardField(
    val key: String,
    val value: String?,
    val label: String,
    val visibility: Visibility,
)

/** La carte d'identité du compte connecté ou d'un autre profil. */
data class Card(
    val handle: String,
    val displayName: String?,
    val fields: List<CardField>,
    val hasPhoto: Boolean,
    val isContact: Boolean = false,
    val isRelated: Boolean = false,
)

/** Un événement d'agenda. */
data class AgendaEvent(
    val id: Long,
    val title: String,
    val startsAt: String,
    val endsAt: String?,
    val location: String?,
    val link: String?,
)

/** Résultat d'une recherche d'identités. */
data class IdentitySummary(
    val handle: String,
    val displayName: String?,
    val title: String?,
    val hasPhoto: Boolean,
)

/** Une relation (contact) du compte connecté. */
data class Relation(
    val handle: String,
    val displayName: String?,
    val hasPhoto: Boolean,
    val type: String?,
    val mutual: Boolean,
)

/** Carte publique d'un autre profil, telle que vue par le compte connecté. */
data class PublicProfile(
    val handle: String,
    val displayName: String?,
    val fields: List<CardField>,
    val hasPhoto: Boolean,
    val isContact: Boolean,
    val isRelated: Boolean,
    val allowRequests: Boolean = false,
)

enum class RequestStatus { PENDING, ACCEPTED, DECLINED }

/** Une demande de RDV reçue. */
data class MeetingRequest(
    val id: Long,
    val name: String,
    val email: String?,
    val message: String?,
    val day: String?,
    val time: String?,
    val status: RequestStatus,
    val createdAt: String,
)

/** Créneaux d'un jour pour un profil donné. */
data class DaySlots(
    val day: String,
    /** "free" | "busy" | "private" | "closed" … */
    val status: String,
    val slots: List<Slot>,
)

data class Slot(val time: String, val taken: Boolean)

/** Une notification in-app (relation | request | message). */
data class AppNotification(
    val id: Long,
    val type: String,
    val text: String,
    val link: String?,
    val read: Boolean,
    val createdAt: String,
)

/** Compteurs pour les badges de navigation. */
data class Badges(
    val unread: Int = 0,
    val pending: Int = 0,
    val incoming: Int = 0,
)

/* --------------------------- Chat chiffré (E2E) -------------------------- */

/** Réaction emoji agrégée sur un message. */
data class Reaction(val emoji: String, val count: Int, val mine: Boolean)

/**
 * Un message de conversation, déjà déchiffré côté client. [text] vaut null si le
 * blob est indéchiffrable (clé absente / message d'avant une rotation de clé).
 */
data class ChatMessage(
    val id: Long,
    val mine: Boolean,
    val text: String?,
    val createdAt: String,
    val expiresAt: String,
    val delivered: Boolean,
    val read: Boolean,
    val reactions: List<Reaction>,
    /** Pièce jointe chiffrée si le message en porte une (sinon null). */
    val attachment: Attachment? = null,
    /** Note système (ex. changement de minuterie) : texte centré, non interactif. */
    val systemText: String? = null,
    /** Message à lecture unique : caché côté destinataire jusqu'à révélation. */
    val readOnce: Boolean = false,
)

/** Métadonnée d'une pièce jointe chiffrée (la clé déchiffre le blob téléchargé). */
data class Attachment(
    val id: Long,
    val name: String,
    val mime: String,
    val size: Long,
    val key: String, // base64 de la clé AES-256
    val iv: String, // base64 de l'IV
    val dur: Long? = null, // durée en ms (messages vocaux)
)

/**
 * Résumé d'une conversation pour la liste / l'aperçu d'accueil. Le dernier message
 * n'est PAS déchiffré (le ratchet est destructif) : on n'expose que des métadonnées.
 */
data class ConversationSummary(
    val handle: String,
    val displayName: String?,
    val hasPhoto: Boolean,
    val lastAt: String,
    val unread: Int,
    val lastMine: Boolean,
    val msgCount: Int = 0,
)

/** État d'une conversation chargée (clé du pair + messages + TTL). */
data class Conversation(
    val handle: String,
    /** Clé publique courante du pair (vide si jamais connecté). */
    val peerPub: String,
    val peerHasKey: Boolean,
    val needsRestore: Boolean,
    val ttlHours: Int,
    val messages: List<ChatMessage>,
)

/* ------------------------------ Groupes ---------------------------------- */

/** Membre d'un groupe (handle + rôle admin|member). */
data class GroupMember(val handle: String, val role: String)

/** Résumé d'un groupe (métadonnée ; le contenu reste E2E). */
data class Group(
    val id: String,
    val name: String,
    val members: List<GroupMember>,
    /** Mon rôle (admin|member). */
    val role: String,
) {
    val isAdmin: Boolean get() = role == "admin"
}

/** Un message de groupe déchiffré ; [text] null si la sender key manque encore. */
data class GroupMessage(
    val id: Long,
    val sender: String,
    val mine: Boolean,
    val text: String?,
    val createdAt: String,
    val expiresAt: String,
    /** Vrai si reçu mais non déchiffrable (SKDM pas encore reçue). */
    val pending: Boolean,
)

/** Conversation de groupe chargée. */
data class GroupConversation(
    val group: Group,
    val ttlHours: Int,
    val messages: List<GroupMessage>,
)

/* --------------------------- Appel WebRTC -------------------------------- */

/** Événement temps réel du serveur (SSE) exposé en domaine : type + payload JSON. */
data class RealtimeEvent(val event: String, val data: String)

/** Signalisation d'appel déchiffrée reçue d'un pair (offer/answer/ice/…). */
data class CallSignal(
    val from: String,
    /** Clé publique de l'émetteur (pour répondre sans aller-retour). */
    val peerPub: String,
    /** Charge JSON déchiffrée : { k: "offer"|"answer"|"ice"|"hangup"|"decline", … }. */
    val payload: String,
)
