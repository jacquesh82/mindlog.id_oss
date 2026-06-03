package today.mindlog.id.feature.onboarding

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import today.mindlog.id.core.data.AuthRepository
import today.mindlog.id.core.datastore.ServerStore
import javax.inject.Inject

data class OnboardingUiState(
    val pinInput: String = "",
    val handleInput: String = "",
    val loading: Boolean = false,
    val error: String? = null,
    val scanning: Boolean = false,
    val serverHost: String = ServerStore.displayHost(ServerStore.DEFAULT_BASE_URL),
    val isDefaultServer: Boolean = true,
    val editingServer: Boolean = false,
    val serverInput: String = "",
    val serverError: String? = null,
)

@HiltViewModel
class OnboardingViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val serverStore: ServerStore,
) : ViewModel() {

    private val _uiState = MutableStateFlow(
        OnboardingUiState(
            serverHost = ServerStore.displayHost(serverStore.baseUrl()),
            isDefaultServer = serverStore.isDefault(),
        )
    )
    val uiState: StateFlow<OnboardingUiState> = _uiState.asStateFlow()

    fun onPinChange(value: String) {
        // N'autorise que les chiffres, max 6.
        val digits = value.filter { it.isDigit() }.take(6)
        _uiState.update { it.copy(pinInput = digits, error = null) }
    }

    fun onHandleChange(value: String) {
        _uiState.update { it.copy(handleInput = value.trim(), error = null) }
    }

    fun onToggleScan(scanning: Boolean) {
        _uiState.update { it.copy(scanning = scanning, error = null) }
    }

    /** Connexion par code PIN (saisie) ou par clé/lien (QR scanné). */
    fun submitPin() {
        if (_uiState.value.loading) return
        val pin = _uiState.value.pinInput
        _uiState.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            authRepository.signInWithPin(pin)
                .onFailure { e ->
                    _uiState.update {
                        it.copy(loading = false, error = e.message ?: "Connexion impossible")
                    }
                }
            // Succès : AuthState → LoggedIn, le NavHost racine bascule tout seul.
        }
    }

    /**
     * Connexion par passkey : démarre l'auth (options serveur), délègue la signature
     * à Credential Manager via [getAssertion] (fourni par l'UI qui a le contexte
     * Activity), puis termine. Succès → AuthState LoggedIn.
     */
    fun signInWithPasskey(getAssertion: suspend (requestJson: String) -> String?) {
        if (_uiState.value.loading) return
        val handle = _uiState.value.handleInput
        _uiState.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            val options = authRepository.passkeyBeginAuth(handle).getOrElse { e ->
                _uiState.update { it.copy(loading = false, error = e.message ?: "Passkey indisponible") }
                return@launch
            }
            val assertion = getAssertion(options)
            if (assertion == null) {
                _uiState.update { it.copy(loading = false, error = "Connexion passkey annulée") }
                return@launch
            }
            authRepository.passkeyFinishAuth(handle, assertion).onFailure { e ->
                _uiState.update { it.copy(loading = false, error = e.message ?: "Connexion impossible") }
            }
        }
    }

    fun onToggleServerEdit(editing: Boolean) {
        _uiState.update {
            it.copy(
                editingServer = editing,
                serverInput = if (editing && it.isDefaultServer) "" else if (editing) it.serverHost else it.serverInput,
                serverError = null,
            )
        }
    }

    fun onServerInputChange(value: String) {
        _uiState.update { it.copy(serverInput = value, serverError = null) }
    }

    /** Valide et enregistre le serveur saisi (hôte + port optionnel). */
    fun saveServer() {
        val saved = serverStore.setServer(_uiState.value.serverInput)
        if (saved == null) {
            _uiState.update { it.copy(serverError = "Adresse invalide") }
            return
        }
        _uiState.update {
            it.copy(
                serverHost = ServerStore.displayHost(saved),
                isDefaultServer = serverStore.isDefault(),
                editingServer = false,
                serverError = null,
                error = null,
            )
        }
    }

    fun resetServer() {
        serverStore.resetToDefault()
        _uiState.update {
            it.copy(
                serverHost = ServerStore.displayHost(serverStore.baseUrl()),
                isDefaultServer = true,
                editingServer = false,
                serverInput = "",
                serverError = null,
            )
        }
    }

    /** Le QR scanné peut contenir une clé/lien /k/ (PIN non scannable). */
    fun submitScanned(raw: String) {
        if (_uiState.value.loading) return
        _uiState.update { it.copy(loading = true, scanning = false, error = null) }
        viewModelScope.launch {
            authRepository.signInWithKey(raw)
                .onFailure { e ->
                    _uiState.update {
                        it.copy(loading = false, error = e.message ?: "Connexion impossible")
                    }
                }
        }
    }
}
