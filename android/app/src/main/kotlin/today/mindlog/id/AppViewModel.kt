package today.mindlog.id

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import today.mindlog.id.core.data.AuthState
import today.mindlog.id.core.data.AuthRepository
import today.mindlog.id.core.data.E2eRepository
import javax.inject.Inject

@HiltViewModel
class AppViewModel @Inject constructor(
    authRepository: AuthRepository,
    private val e2e: E2eRepository,
) : ViewModel() {
    val authState: StateFlow<AuthState> = authRepository.authState.stateIn(
        scope = viewModelScope,
        started = SharingStarted.Eagerly,
        initialValue = AuthState.Unknown,
    )

    /** La clé E2E locale n'est pas encore sauvegardée dans le coffre serveur. */
    val needsBackup: StateFlow<Boolean> = e2e.needsBackup

    /** Sauvegarde biométrique : à appeler APRÈS authentification biométrique réussie. */
    fun backupWithBiometric(onDone: (Boolean) -> Unit) {
        viewModelScope.launch { onDone(runCatching { e2e.saveVaultBiometric() }.getOrDefault(false)) }
    }

    /** Sauvegarde portable par passphrase connue de l'utilisateur (multi-appareils). */
    fun backupWithPassphrase(passphrase: String, onDone: (Boolean) -> Unit) {
        viewModelScope.launch { onDone(runCatching { e2e.saveVaultPassphrase(passphrase) }.getOrDefault(false)) }
    }

    /** Sauvegarde portable par code PIN (4 chiffres min.) — restaurable sur un autre appareil. */
    fun backupWithPin(pin: String, onDone: (Boolean) -> Unit) {
        viewModelScope.launch { onDone(runCatching { e2e.saveVaultPin(pin) }.getOrDefault(false)) }
    }

    init {
        // Dès la connexion : préparer la clé E2E et publier le bundle de prekeys.
        // Un contact peut alors m'écrire en chiffré sans attendre que j'ouvre une
        // conversation ou l'écran Profil (le message « @x doit ouvrir son espace »
        // ne s'affiche plus une fois que l'autre s'est connecté au moins une fois).
        viewModelScope.launch {
            authState.collect { state ->
                if (state is AuthState.LoggedIn) {
                    e2e.ensure(state.handle)
                    runCatching { e2e.ensurePrekeys(state.handle) }
                }
            }
        }
    }
}
