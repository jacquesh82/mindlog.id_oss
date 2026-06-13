package today.mindlog.id.core.network.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Vue côté visiteur : `/api/space/:handle`. */
@Serializable
data class SpaceDto(
    val available: Boolean = false,
    val handle: String = "",
    @SerialName("price_cents") val priceCents: Int = 0,
    val currency: String = "eur",
    val active: Boolean = false,
    val subscribed: Boolean = false,
)

/** Bénéfices opt-in d'un espace premium (miroir de SpaceBenefits côté serveur). */
@Serializable
data class SpaceBenefitsDto(
    val chat: Boolean = false,
    val call: Boolean = false,
    val pages: Boolean = true,
    val rdv: Boolean = false,
    val lives: Boolean = false,
)

/** Vue côté propriétaire : `GET /api/space` (sans :handle). */
@Serializable
data class OwnerSpaceDto(
    @SerialName("price_cents") val priceCents: Int = 999,
    val currency: String = "eur",
    val active: Boolean = false,
    @SerialName("intro_md") val introMd: String = "",
    @SerialName("profile_intro_md") val profileIntroMd: String = "",
    val benefits: SpaceBenefitsDto = SpaceBenefitsDto(),
)

/** Corps `PUT /api/space` (tarif). */
@Serializable
data class SpacePriceBody(
    @SerialName("price_cents") val priceCents: Int,
    val currency: String = "eur",
)

/** Réponse `PUT /api/space`. */
@Serializable
data class SpacePriceResponseDto(
    @SerialName("price_cents") val priceCents: Int = 0,
    val currency: String = "eur",
    val active: Boolean = false,
)

/** Corps `PUT /api/space/intro` (markdown libre). */
@Serializable
data class SpaceIntroBody(@SerialName("intro_md") val introMd: String)

@Serializable
data class SpaceIntroResponseDto(@SerialName("intro_md") val introMd: String = "")

/** Corps `PUT /api/me/profile-intro` (OSS, intro publique de profil). */
@Serializable
data class ProfileIntroBody(@SerialName("intro_md") val introMd: String)

@Serializable
data class ProfileIntroResponseDto(@SerialName("profile_intro_md") val profileIntroMd: String = "")

/** Corps `PUT /api/space/benefits`. */
@Serializable
data class SpaceBenefitsResponseDto(val benefits: SpaceBenefitsDto = SpaceBenefitsDto())

/** Une page payante (liste + éditeur) — `/api/pages`. */
@Serializable
data class PaidPageDto(
    val slug: String,
    val title: String = "",
    val type: String = "markdown",
    val published: Boolean = false,
)

/** Corps `PUT /api/pages` (création + édition par slug). */
@Serializable
data class UpsertPaidPageBody(
    val slug: String,
    val title: String,
    val type: String, // "markdown" | "gallery" | "link" | "file"
    val content: String? = null, // pour markdown : texte ; autres : JSON string
    val published: Boolean = false,
)

@Serializable
data class UpsertPaidPageResponseDto(val page: PaidPageDto = PaidPageDto(slug = ""))

@Serializable
data class PaidPagesResponseDto(val pages: List<PaidPageDto> = emptyList())

/** Réponse d'upload média (gallery + file). */
@Serializable
data class PageMediaAddedDto(
    val url: String = "", // nom de fichier interne (à embarquer dans content)
    val kind: String = "image", // "image" | "video"
    val caption: String = "",
)

@Serializable
data class PageMediaUploadResponseDto(
    val added: List<PageMediaAddedDto> = emptyList(),
    val count: Int = 0,
)

/** Vue d'une page payante avec accès — `/api/pages/:handle/:slug`. */
@Serializable
data class PaidPageContentDto(
    val handle: String = "",
    val slug: String = "",
    val title: String = "",
    val type: String = "markdown",
    @SerialName("space_price_cents") val spacePriceCents: Int = 0,
    @SerialName("space_currency") val spaceCurrency: String = "eur",
    val published: Boolean = false,
    val access: Boolean = false,
    val content: String? = null,
)

/** Vérification Play Billing : `/api/billing/google/verify`. */
@Serializable
data class GoogleVerifyBody(
    val purchaseToken: String,
    val productId: String,
)

@Serializable
data class GoogleVerifyResponseDto(
    val ok: Boolean = false,
    val status: String = "",
    val plan: String = "free",
)

/** Lancement d'un Checkout Stripe pour l'abonnement à un espace. */
@Serializable
data class SpaceSubscribeResponseDto(val url: String = "")

/** Eligibilité à l'invitation Premium au lancement — `/api/premium/upsell`. */
@Serializable
data class PremiumUpsellDto(
    val eligible: Boolean = false,
    val trialAvailable: Boolean = false,
    val trialDays: Int = 30,
)

/** Réponse d'activation d'essai — `/api/premium/trial/start`. */
@Serializable
data class TrialStartResponseDto(
    val ok: Boolean = false,
    val until: String = "",
    val days: Int = 0,
)
