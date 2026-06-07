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
import today.mindlog.id.core.billing.PlayBilling
import today.mindlog.id.core.data.PremiumRepository
import today.mindlog.id.core.network.dto.PaidPageDto
import javax.inject.Inject

/** SKU partagé du tier "Premium creator" — configuré dans Google Play Console. */
private const val PRODUCT_PREMIUM = "mindlog_premium_monthly"

data class PremiumUiState(
    val plan: String = "free",
    val pages: List<PaidPageDto> = emptyList(),
    val productPriceLabel: String? = null,
    val processing: Boolean = false,
    val error: String? = null,
    val message: String? = null,
)

@HiltViewModel
class PremiumViewModel @Inject constructor(
    private val premium: PremiumRepository,
    private val billing: PlayBilling,
) : ViewModel() {

    private val _state = MutableStateFlow(PremiumUiState())
    val state: StateFlow<PremiumUiState> = _state.asStateFlow()

    private var product: ProductDetails? = null

    init {
        viewModelScope.launch { loadProduct() }
        viewModelScope.launch { refreshPages() }
        // Réception d'un achat → verify côté serveur + acknowledge.
        viewModelScope.launch {
            billing.purchases.collect { purchase ->
                _state.update { it.copy(processing = true) }
                val plan = runCatching {
                    premium.verifyPlayPurchase(purchase.purchaseToken, PRODUCT_PREMIUM)
                }.getOrDefault("free")
                runCatching { billing.acknowledge(purchase) }
                _state.update { it.copy(processing = false, plan = plan, message = "Bienvenue dans Premium ! 🦎") }
                refreshPages()
            }
        }
    }

    private suspend fun loadProduct() {
        product = runCatching { billing.queryProduct(PRODUCT_PREMIUM) }.getOrNull()
        val label = product?.subscriptionOfferDetails?.firstOrNull()
            ?.pricingPhases?.pricingPhaseList?.firstOrNull()?.formattedPrice
        _state.update { it.copy(productPriceLabel = label) }
    }

    private suspend fun refreshPages() {
        val pages = runCatching { premium.myPages() }.getOrDefault(emptyList())
        _state.update { it.copy(pages = pages, plan = if (pages.isNotEmpty()) "premium" else it.plan) }
    }

    /** Lance le flow d'achat Play Billing pour l'abonnement Premium. */
    fun launchPurchase(activity: Activity) {
        val pd = product
        if (pd == null) {
            _state.update { it.copy(error = "Produit Premium indisponible. Réessaie plus tard.") }
            return
        }
        billing.launchBillingFlow(activity, pd)
    }

    fun clearMessage() = _state.update { it.copy(message = null) }
    fun clearError() = _state.update { it.copy(error = null) }
}
