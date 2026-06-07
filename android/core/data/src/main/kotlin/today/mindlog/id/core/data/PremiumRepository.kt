package today.mindlog.id.core.data

import today.mindlog.id.core.network.MindlogApi
import today.mindlog.id.core.network.dto.GoogleVerifyBody
import today.mindlog.id.core.network.dto.PaidPageContentDto
import today.mindlog.id.core.network.dto.PaidPageDto
import today.mindlog.id.core.network.dto.SpaceDto
import javax.inject.Inject
import javax.inject.Singleton

/** Espace premium d'un creator + pages payantes + vérification Play Billing. */
@Singleton
class PremiumRepository @Inject constructor(
    private val api: MindlogApi,
) {
    suspend fun space(handle: String): SpaceDto =
        api.space(handle.removePrefix("@"))

    /** Crée un Checkout Stripe d'abonnement (URL à ouvrir en Custom Tab). */
    suspend fun subscribeUrl(handle: String): String =
        api.subscribeToSpace(handle.removePrefix("@")).url

    suspend fun myPages(): List<PaidPageDto> =
        api.myPaidPages().pages

    suspend fun page(handle: String, slug: String): PaidPageContentDto =
        api.paidPage(handle.removePrefix("@"), slug)

    /**
     * Active Premium côté serveur après un achat Play Billing réussi.
     * @return plan retourné par le serveur ("premium" si actif).
     */
    suspend fun verifyPlayPurchase(purchaseToken: String, productId: String): String =
        api.verifyPlayPurchase(GoogleVerifyBody(purchaseToken, productId)).plan
}
