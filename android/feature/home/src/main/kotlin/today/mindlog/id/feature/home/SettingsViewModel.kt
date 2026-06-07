package today.mindlog.id.feature.home

import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import today.mindlog.id.core.data.AuthRepository
import today.mindlog.id.core.data.CardRepository
import today.mindlog.id.core.data.E2eRepository
import today.mindlog.id.core.data.SessionInfo
import today.mindlog.id.core.designsystem.theme.ThemeMode
import javax.inject.Inject

data class SettingsUiState(
    val agendaPublic: Boolean = true,
    val allowChat: Boolean = true,
    val allowCall: Boolean = true,
    val allowVideo: Boolean = true,
    val allowRequests: Boolean = true,
    val hasVault: Boolean = false,
    val recoveryEmail: String = "",
    val publicUrl: String = "",
    val accessKey: String = "",
    val accentHex: String? = null,
    val themeMode: ThemeMode = ThemeMode.SYSTEM,
    val sessions: List<SessionInfo> = emptyList(),
    /** Code PIN d'appairage à présenter dans une boîte de dialogue (puis null). */
    val linkPin: String? = null,
    /** Clé fraîchement régénérée à présenter une seule fois (puis null). */
    val rotatedKey: String? = null,
    val loading: Boolean = true,
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val cardRepository: CardRepository,
    private val authRepository: AuthRepository,
    private val e2eRepository: E2eRepository,
    private val accentRepository: today.mindlog.id.core.data.AccentRepository,
) : androidx.lifecycle.ViewModel() {

    private val _state = MutableStateFlow(SettingsUiState())
    val state: StateFlow<SettingsUiState> = _state.asStateFlow()

    init {
        _state.update {
            it.copy(
                publicUrl = authRepository.publicUrl().orEmpty(),
                accessKey = authRepository.currentKey().orEmpty(),
            )
        }
        viewModelScope.launch {
            accentRepository.accent.collect { hex -> _state.update { it.copy(accentHex = hex) } }
        }
        viewModelScope.launch {
            accentRepository.themeMode.collect { raw ->
                _state.update { it.copy(themeMode = ThemeMode.fromString(raw)) }
            }
        }
        viewModelScope.launch {
            runCatching { cardRepository.accountFlags() }.getOrNull()?.let { flags ->
                _state.update {
                    it.copy(
                        agendaPublic = flags.pagePublic,
                        allowChat = flags.allowChat,
                        allowCall = flags.allowCall,
                        allowVideo = flags.allowVideo,
                        allowRequests = flags.allowRequests,
                        hasVault = flags.hasVault,
                        recoveryEmail = flags.recoveryEmail ?: "",
                        loading = false,
                    )
                }
            } ?: _state.update { it.copy(loading = false) }
        }
    }

    fun toggleAgendaPublic() {
        val next = !_state.value.agendaPublic
        _state.update { it.copy(agendaPublic = next) }
        viewModelScope.launch { runCatching { cardRepository.setPagePublic(next) } }
    }

    fun toggleAllowChat() {
        val next = !_state.value.allowChat
        _state.update { it.copy(allowChat = next) }
        viewModelScope.launch { runCatching { cardRepository.setAllowChat(next) } }
    }

    fun toggleAllowCall() {
        val next = !_state.value.allowCall
        _state.update { it.copy(allowCall = next) }
        viewModelScope.launch { runCatching { cardRepository.setAllowCall(next) } }
    }

    fun toggleAllowVideo() {
        val next = !_state.value.allowVideo
        _state.update { it.copy(allowVideo = next) }
        viewModelScope.launch { runCatching { cardRepository.setAllowVideo(next) } }
    }

    fun toggleAllowRequests() {
        val next = !_state.value.allowRequests
        _state.update { it.copy(allowRequests = next) }
        viewModelScope.launch { runCatching { cardRepository.setAllowRequests(next) } }
    }

    /** Change la couleur d'accentuation (appliquée au thème en direct). */
    fun setAccent(hex: String) = accentRepository.set(hex)

    /** Sélectionne le mode de thème (system/light/dark). */
    fun setThemeMode(mode: ThemeMode) = accentRepository.setThemeMode(mode.storeValue)

    /** Met à jour l'email de récupération (optimiste ; chaîne vide = retrait). */
    fun setRecoveryEmail(email: String) {
        _state.update { it.copy(recoveryEmail = email) }
        viewModelScope.launch { runCatching { cardRepository.setRecoveryEmail(email) } }
    }

    /* ---------------------------- Sécurité E2E ----------------------------- */

    /** Sauvegarde la clé E2E dans le coffre, déverrouillable par passphrase ou code PIN. */
    fun backupVault(secret: String, pin: Boolean, onResult: (Boolean) -> Unit) {
        viewModelScope.launch {
            val handle = authRepository.currentHandle()
            val ok = if (handle == null) false else runCatching {
                e2eRepository.ensure(handle)
                if (pin) e2eRepository.saveVaultPin(secret) else e2eRepository.saveVaultPassphrase(secret)
            }.getOrDefault(false)
            if (ok) _state.update { it.copy(hasVault = true) }
            onResult(ok)
        }
    }

    /** Restaure la clé privée depuis le coffre via la passphrase ou le code PIN. */
    fun restoreVault(secret: String, pin: Boolean, onResult: (Boolean) -> Unit) {
        viewModelScope.launch {
            val handle = authRepository.currentHandle()
            val ok = if (handle == null) false else runCatching {
                e2eRepository.ensure(handle)
                if (pin) e2eRepository.restoreWithPin(secret) else e2eRepository.restoreWithPassphrase(secret)
            }.getOrDefault(false)
            if (ok) _state.update { it.copy(hasVault = true) }
            onResult(ok)
        }
    }

    /* ----------------------------- Accès ----------------------------------- */

    fun loadSessions() {
        viewModelScope.launch {
            authRepository.listSessions().onSuccess { list -> _state.update { it.copy(sessions = list) } }
        }
    }

    fun revokeSession(id: String) {
        _state.update { it.copy(sessions = it.sessions.filterNot { s -> s.id == id }) }
        viewModelScope.launch { runCatching { authRepository.revokeSession(id) }; loadSessions() }
    }

    fun logoutOtherSessions(onDone: (Boolean) -> Unit) {
        viewModelScope.launch {
            val ok = authRepository.logoutOtherSessions().isSuccess
            loadSessions()
            onDone(ok)
        }
    }

    fun generatePin() {
        viewModelScope.launch {
            authRepository.generateLinkPin().onSuccess { pin -> _state.update { it.copy(linkPin = pin) } }
        }
    }

    fun dismissPin() = _state.update { it.copy(linkPin = null) }

    /** Régénère la clé d'accès et expose la nouvelle clé pour copie. */
    fun rotateKey() {
        viewModelScope.launch {
            authRepository.rotateAccessKey().onSuccess { key ->
                _state.update { it.copy(rotatedKey = key, accessKey = key) }
            }
        }
    }

    fun dismissRotatedKey() = _state.update { it.copy(rotatedKey = null) }

    /* ----------------------------- Compte ---------------------------------- */

    /** Récupère le JSON d'export RGPD puis le remet à l'UI (écriture fichier côté écran). */
    fun exportData(onReady: (String) -> Unit, onError: () -> Unit) {
        viewModelScope.launch {
            runCatching { cardRepository.exportData() }.onSuccess(onReady).onFailure { onError() }
        }
    }

    /** Supprime définitivement le compte puis bascule vers l'onboarding. */
    fun deleteAccount(onDone: () -> Unit) {
        viewModelScope.launch {
            authRepository.deleteAccount().onSuccess { onDone() }
        }
    }

    fun signOut(onDone: () -> Unit) {
        viewModelScope.launch { authRepository.signOut(); onDone() }
    }
}
