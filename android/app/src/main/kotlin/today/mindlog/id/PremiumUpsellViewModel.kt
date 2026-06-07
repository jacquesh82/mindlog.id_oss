package today.mindlog.id

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import today.mindlog.id.core.data.PremiumRepository
import today.mindlog.id.core.datastore.AccentStore
import javax.inject.Inject

/**
 * Pilote la modale d'invitation Premium au lancement (workflow d'upsell).
 *
 * Cadence : 1 à 3 affichages par mois → cooldown 12 jours stocké dans
 * [AccentStore]. Le serveur reste source de vérité : un appel à
 * `/api/premium/upsell` confirme l'éligibilité (non Premium, essai non
 * consommé) avant d'ouvrir la modale.
 */
private const val COOLDOWN_MS = 12L * 24 * 60 * 60 * 1000

data class UpsellUi(
    val visible: Boolean = false,
    val trialAvailable: Boolean = false,
    val trialDays: Int = 30,
    val processing: Boolean = false,
    val toast: String? = null,
)

@HiltViewModel
class PremiumUpsellViewModel @Inject constructor(
    private val premium: PremiumRepository,
    private val prefs: AccentStore,
) : ViewModel() {

    private val _ui = MutableStateFlow(UpsellUi())
    val ui: StateFlow<UpsellUi> = _ui.asStateFlow()

    /** Appelé après le boot de MainScreen ; ouvre la modale si éligible. */
    fun checkOnLaunch() {
        val last = prefs.premiumUpsellShownAt()
        if (last > 0 && System.currentTimeMillis() - last < COOLDOWN_MS) return
        viewModelScope.launch {
            val info = runCatching { premium.upsell() }.getOrNull() ?: return@launch
            if (!info.eligible) return@launch
            // Marqueur posé AVANT l'ouverture pour respecter la cadence même
            // si l'utilisateur quitte l'app sans choisir.
            prefs.setPremiumUpsellShownAt(System.currentTimeMillis())
            _ui.update {
                it.copy(
                    visible = true,
                    trialAvailable = info.trialAvailable,
                    trialDays = info.trialDays.takeIf { d -> d > 0 } ?: 30,
                )
            }
        }
    }

    fun dismiss() { _ui.update { it.copy(visible = false) } }

    fun startTrial() {
        if (_ui.value.processing) return
        _ui.update { it.copy(processing = true) }
        viewModelScope.launch {
            val result = runCatching { premium.startTrial() }
            _ui.update {
                if (result.isSuccess) {
                    it.copy(
                        visible = false,
                        processing = false,
                        toast = "Essai Premium activé pour ${it.trialDays} jours 🎉",
                    )
                } else {
                    it.copy(
                        processing = false,
                        toast = result.exceptionOrNull()?.message
                            ?: "Impossible d'activer l'essai pour le moment.",
                    )
                }
            }
        }
    }

    fun consumeToast() { _ui.update { it.copy(toast = null) } }
}
