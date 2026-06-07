package today.mindlog.id.core.billing

import android.app.Activity
import android.content.Context
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

/**
 * Wrapper Play Billing minimal : se connecte au store, interroge un produit
 * d'abonnement, lance le flow d'achat, et émet les achats reçus dans [purchases].
 *
 * Le verify côté serveur (et la validation du purchaseToken) est délégué au
 * consommateur — ce wrapper s'occupe uniquement de la mécanique BillingClient.
 */
@Singleton
class PlayBilling @Inject constructor(
    @ApplicationContext private val context: Context,
) : PurchasesUpdatedListener {

    private val _purchases = MutableSharedFlow<Purchase>(extraBufferCapacity = 4)

    /** Achats reçus (success uniquement) à lier à la vérification serveur. */
    val purchases: SharedFlow<Purchase> = _purchases.asSharedFlow()

    private val client: BillingClient = BillingClient.newBuilder(context)
        .setListener(this)
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .build()

    private suspend fun connect(): Boolean {
        if (client.isReady) return true
        return suspendCoroutine { cont ->
            client.startConnection(object : BillingClientStateListener {
                override fun onBillingSetupFinished(result: BillingResult) {
                    cont.resume(result.responseCode == BillingClient.BillingResponseCode.OK)
                }
                override fun onBillingServiceDisconnected() { /* sera reconnecté à la demande */ }
            })
        }
    }

    /** Récupère les détails d'un produit d'abonnement (Play Console SKU). */
    suspend fun queryProduct(productId: String): ProductDetails? {
        if (!connect()) return null
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(
                listOf(
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(productId)
                        .setProductType(BillingClient.ProductType.SUBS)
                        .build(),
                ),
            )
            .build()
        return suspendCoroutine { cont ->
            client.queryProductDetailsAsync(params) { _, list ->
                cont.resume(list.firstOrNull())
            }
        }
    }

    /** Lance le flow d'achat. Le résultat arrive via [purchases]. */
    fun launchBillingFlow(activity: Activity, details: ProductDetails) {
        val offerToken = details.subscriptionOfferDetails?.firstOrNull()?.offerToken ?: return
        val params = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(
                listOf(
                    BillingFlowParams.ProductDetailsParams.newBuilder()
                        .setProductDetails(details)
                        .setOfferToken(offerToken)
                        .build(),
                ),
            )
            .build()
        client.launchBillingFlow(activity, params)
    }

    /** À appeler APRÈS verify serveur — confirme l'achat à Google. */
    suspend fun acknowledge(purchase: Purchase) {
        if (purchase.isAcknowledged) return
        if (!connect()) return
        val params = AcknowledgePurchaseParams.newBuilder()
            .setPurchaseToken(purchase.purchaseToken)
            .build()
        suspendCoroutine<Unit> { cont ->
            client.acknowledgePurchase(params) { cont.resume(Unit) }
        }
    }

    override fun onPurchasesUpdated(result: BillingResult, list: List<Purchase>?) {
        if (result.responseCode != BillingClient.BillingResponseCode.OK) return
        list?.forEach { p ->
            if (p.purchaseState == Purchase.PurchaseState.PURCHASED) _purchases.tryEmit(p)
        }
    }
}
