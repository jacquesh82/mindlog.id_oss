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

/** Une page payante (liste + éditeur) — `/api/pages`. */
@Serializable
data class PaidPageDto(
    val slug: String,
    val title: String = "",
    val type: String = "markdown",
    val published: Boolean = false,
)

@Serializable
data class PaidPagesResponseDto(val pages: List<PaidPageDto> = emptyList())

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
