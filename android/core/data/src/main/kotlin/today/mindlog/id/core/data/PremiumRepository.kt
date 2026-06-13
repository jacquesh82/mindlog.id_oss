package today.mindlog.id.core.data

import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import today.mindlog.id.core.network.MindlogApi
import today.mindlog.id.core.network.dto.GoogleVerifyBody
import today.mindlog.id.core.network.dto.OwnerSpaceDto
import today.mindlog.id.core.network.dto.PageMediaUploadResponseDto
import today.mindlog.id.core.network.dto.PaidPageContentDto
import today.mindlog.id.core.network.dto.PaidPageDto
import today.mindlog.id.core.network.dto.PremiumUpsellDto
import today.mindlog.id.core.network.dto.ProfileIntroBody
import today.mindlog.id.core.network.dto.SpaceBenefitsDto
import today.mindlog.id.core.network.dto.SpaceDto
import today.mindlog.id.core.network.dto.SpaceIntroBody
import today.mindlog.id.core.network.dto.SpacePriceBody
import today.mindlog.id.core.network.dto.TrialStartResponseDto
import today.mindlog.id.core.network.dto.UpsertPaidPageBody
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

    /* ----------- Vue propriétaire de l'espace ----------- */
    suspend fun ownerSpace(): OwnerSpaceDto = api.ownerSpace()

    suspend fun updateSpacePrice(priceCents: Int, currency: String = "eur") {
        api.updateSpacePrice(SpacePriceBody(priceCents, currency))
    }

    suspend fun updateSpaceIntro(introMd: String) {
        api.updateSpaceIntro(SpaceIntroBody(introMd))
    }

    suspend fun updateProfileIntro(introMd: String) {
        api.updateProfileIntro(ProfileIntroBody(introMd))
    }

    suspend fun updateBenefits(benefits: SpaceBenefitsDto) {
        api.updateSpaceBenefits(benefits)
    }

    /* ----------- Pages payantes (CRUD) ----------- */
    suspend fun myPages(): List<PaidPageDto> =
        api.myPaidPages().pages

    suspend fun upsertPage(
        slug: String,
        title: String,
        type: String,
        content: String?,
        published: Boolean,
    ): PaidPageDto =
        api.upsertPaidPage(UpsertPaidPageBody(slug, title, type, content, published)).page

    suspend fun deletePage(slug: String) { api.deletePaidPage(slug) }

    suspend fun page(handle: String, slug: String): PaidPageContentDto =
        api.paidPage(handle.removePrefix("@"), slug)

    /** Upload N fichiers (gallery) ou 1 fichier (file). Le serveur met à jour le content. */
    suspend fun uploadPageMedia(slug: String, files: List<MediaUpload>): PageMediaUploadResponseDto {
        val parts = files.map { f ->
            val body = f.bytes.toRequestBody(f.mime.toMediaTypeOrNull())
            MultipartBody.Part.createFormData("media", f.name, body)
        }
        return api.uploadPageMedia(slug, parts)
    }

    suspend fun deletePageMedia(slug: String, filename: String) {
        api.deletePageMedia(slug, filename)
    }

    /** Données nécessaires à un upload de média. */
    data class MediaUpload(val name: String, val mime: String, val bytes: ByteArray)

    /**
     * Active Premium côté serveur après un achat Play Billing réussi.
     * @return plan retourné par le serveur ("premium" si actif).
     */
    suspend fun verifyPlayPurchase(purchaseToken: String, productId: String): String =
        api.verifyPlayPurchase(GoogleVerifyBody(purchaseToken, productId)).plan

    /** Eligibilité à l'invitation Premium au lancement de l'app. */
    suspend fun upsell(): PremiumUpsellDto = api.premiumUpsell()

    /** Active l'essai gratuit serveur-managé (un seul par compte). */
    suspend fun startTrial(): TrialStartResponseDto = api.startPremiumTrial()
}
