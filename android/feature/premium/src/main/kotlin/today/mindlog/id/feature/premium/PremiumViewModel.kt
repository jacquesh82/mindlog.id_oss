package today.mindlog.id.feature.premium

import android.app.Activity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.android.billingclient.api.ProductDetails
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import today.mindlog.id.core.billing.PlayBilling
import today.mindlog.id.core.data.PremiumRepository
import today.mindlog.id.core.network.MindlogApi
import today.mindlog.id.core.network.dto.OwnerSpaceDto
import today.mindlog.id.core.network.dto.PaidPageContentDto
import today.mindlog.id.core.network.dto.PaidPageDto
import today.mindlog.id.core.network.dto.SpaceBenefitsDto
import javax.inject.Inject

/** SKU partagé du tier "Premium creator" — configuré dans Google Play Console. */
private const val PRODUCT_PREMIUM = "mindlog_premium_monthly"

data class PremiumUiState(
    val plan: String = "free",
    val pages: List<PaidPageDto> = emptyList(),
    val space: OwnerSpaceDto? = null,
    val myHandle: String = "",
    val productPriceLabel: String? = null,
    val processing: Boolean = false,
    val editingContent: PaidPageContentDto? = null, // contenu chargé pour l'éditeur (null tant que pas demandé)
    val error: String? = null,
    val message: String? = null,
)

@HiltViewModel
class PremiumViewModel @Inject constructor(
    private val premium: PremiumRepository,
    private val billing: PlayBilling,
    private val api: MindlogApi,
) : ViewModel() {

    private val json = Json { ignoreUnknownKeys = true }

    private val _state = MutableStateFlow(PremiumUiState())
    val state: StateFlow<PremiumUiState> = _state.asStateFlow()

    private var product: ProductDetails? = null

    init {
        viewModelScope.launch { loadProduct() }
        viewModelScope.launch { refreshAll() }
        viewModelScope.launch {
            billing.purchases.collect { purchase ->
                _state.update { it.copy(processing = true) }
                val plan = runCatching {
                    premium.verifyPlayPurchase(purchase.purchaseToken, PRODUCT_PREMIUM)
                }.getOrDefault("free")
                runCatching { billing.acknowledge(purchase) }
                _state.update { it.copy(processing = false, plan = plan, message = "Bienvenue dans Premium ! 🦎") }
                refreshAll()
            }
        }
    }

    private suspend fun loadProduct() {
        product = runCatching { billing.queryProduct(PRODUCT_PREMIUM) }.getOrNull()
        val label = product?.subscriptionOfferDetails?.firstOrNull()
            ?.pricingPhases?.pricingPhaseList?.firstOrNull()?.formattedPrice
        _state.update { it.copy(productPriceLabel = label) }
    }

    private suspend fun refreshAll() {
        val pages = runCatching { premium.myPages() }.getOrDefault(emptyList())
        val space = runCatching { premium.ownerSpace() }.getOrNull()
        val handle = _state.value.myHandle.ifBlank { runCatching { api.me().handle }.getOrNull().orEmpty() }
        _state.update {
            it.copy(
                pages = pages,
                space = space,
                myHandle = handle,
                plan = if (pages.isNotEmpty() || space?.active == true) "premium" else it.plan,
            )
        }
    }

    /** Charge le contenu d'une de mes pages pour le passer à l'éditeur. */
    fun loadPageContent(slug: String) {
        val handle = _state.value.myHandle
        if (handle.isBlank()) {
            viewModelScope.launch { refreshAll(); loadPageContent(slug) }
            return
        }
        viewModelScope.launch {
            runCatching { premium.page(handle, slug) }
                .onSuccess { dto -> _state.update { it.copy(editingContent = dto) } }
                .onFailure { e -> _state.update { it.copy(error = e.message ?: "Chargement page KO.") } }
        }
    }

    fun clearEditingContent() = _state.update { it.copy(editingContent = null) }

    fun refresh() = viewModelScope.launch { refreshAll() }

    fun launchPurchase(activity: Activity) {
        val pd = product
        if (pd == null) {
            _state.update { it.copy(error = "Produit Premium indisponible. Réessaie plus tard.") }
            return
        }
        billing.launchBillingFlow(activity, pd)
    }

    /* ----------------------- Édition espace ----------------------- */

    fun updatePrice(priceCents: Int, currency: String = "eur") {
        if (priceCents < 100) { _state.update { it.copy(error = "Prix minimum : 1,00 €") }; return }
        viewModelScope.launch {
            _state.update { it.copy(processing = true) }
            runCatching { premium.updateSpacePrice(priceCents, currency) }
                .onSuccess { _state.update { it.copy(message = "Tarif mis à jour.") }; refreshAll() }
                .onFailure { e -> _state.update { it.copy(error = e.message ?: "Tarif refusé.") } }
            _state.update { it.copy(processing = false) }
        }
    }

    fun updateSpaceIntro(introMd: String) {
        viewModelScope.launch {
            runCatching { premium.updateSpaceIntro(introMd) }
                .onSuccess { _state.update { it.copy(message = "Intro espace enregistrée.") }; refreshAll() }
                .onFailure { e -> _state.update { it.copy(error = e.message ?: "Échec enregistrement intro espace.") } }
        }
    }

    fun updateProfileIntro(introMd: String) {
        viewModelScope.launch {
            runCatching { premium.updateProfileIntro(introMd) }
                .onSuccess { _state.update { it.copy(message = "Intro profil enregistrée.") }; refreshAll() }
                .onFailure { e -> _state.update { it.copy(error = e.message ?: "Échec enregistrement intro profil.") } }
        }
    }

    fun updateBenefits(benefits: SpaceBenefitsDto) {
        viewModelScope.launch {
            runCatching { premium.updateBenefits(benefits) }
                .onSuccess { _state.update { it.copy(message = "Bénéfices mis à jour.") }; refreshAll() }
                .onFailure { e -> _state.update { it.copy(error = e.message ?: "Échec bénéfices.") } }
        }
    }

    /* ----------------------- Pages payantes ----------------------- */

    fun savePage(slug: String, title: String, type: String, content: String?, published: Boolean) {
        if (!Regex("^[a-z0-9-]+$").matches(slug)) {
            _state.update { it.copy(error = "Slug invalide (lettres minuscules, chiffres, tirets).") }
            return
        }
        if (title.isBlank()) { _state.update { it.copy(error = "Titre requis.") }; return }
        viewModelScope.launch {
            _state.update { it.copy(processing = true) }
            runCatching { premium.upsertPage(slug, title.trim(), type, content, published) }
                .onSuccess { _state.update { it.copy(message = "Page enregistrée.") }; refreshAll() }
                .onFailure { e -> _state.update { it.copy(error = e.message ?: "Page refusée.") } }
            _state.update { it.copy(processing = false) }
        }
    }

    fun deletePage(slug: String) {
        viewModelScope.launch {
            runCatching { premium.deletePage(slug) }
                .onSuccess { _state.update { it.copy(message = "Page supprimée.") }; refreshAll() }
                .onFailure { e -> _state.update { it.copy(error = e.message ?: "Suppression impossible.") } }
        }
    }

    /** Sauve une page de type "link" — `url` (http/https) + `note` libre. */
    fun saveLink(slug: String, title: String, url: String, note: String, published: Boolean) {
        if (!url.startsWith("http://", ignoreCase = true) && !url.startsWith("https://", ignoreCase = true)) {
            _state.update { it.copy(error = "URL invalide (http/https requis).") }
            return
        }
        val obj = buildJsonObject {
            put("url", JsonPrimitive(url.trim()))
            put("note", JsonPrimitive(note.trim()))
        }
        val content = json.encodeToString(JsonObject.serializer(), obj)
        savePage(slug, title, "link", content, published)
    }

    /** Crée la coquille d'une page galerie/fichier sans contenu (l'upload viendra après). */
    fun saveEmptyMedia(slug: String, title: String, type: String, published: Boolean) {
        savePage(slug, title, type, "", published)
    }

    /** Upload de fichier(s) sur une page (gallery ou file). */
    fun uploadMedia(slug: String, files: List<PremiumRepository.MediaUpload>) {
        if (files.isEmpty()) return
        viewModelScope.launch {
            _state.update { it.copy(processing = true) }
            runCatching { premium.uploadPageMedia(slug, files) }
                .onSuccess { res ->
                    _state.update { it.copy(message = "${res.added.size} fichier(s) ajouté(s).") }
                    loadPageContent(slug) // re-charge le content à jour
                }
                .onFailure { e -> _state.update { it.copy(error = e.message ?: "Upload refusé.") } }
            _state.update { it.copy(processing = false) }
        }
    }

    /** Retire un média d'une page galerie (ou vide la page file). */
    fun deleteMedia(slug: String, filename: String) {
        viewModelScope.launch {
            runCatching { premium.deletePageMedia(slug, filename) }
                .onSuccess { _state.update { it.copy(message = "Média supprimé.") }; loadPageContent(slug) }
                .onFailure { e -> _state.update { it.copy(error = e.message ?: "Suppression média KO.") } }
        }
    }

    fun clearMessage() = _state.update { it.copy(message = null) }
    fun clearError() = _state.update { it.copy(error = null) }
}
