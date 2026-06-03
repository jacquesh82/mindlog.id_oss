package today.mindlog.id.feature.relations

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import today.mindlog.id.core.data.NavigationBus
import today.mindlog.id.core.data.RelationsRepository
import today.mindlog.id.core.data.RequestsRepository
import today.mindlog.id.core.model.DaySlots
import today.mindlog.id.core.model.IdentitySummary
import today.mindlog.id.core.model.PublicProfile
import today.mindlog.id.core.model.Relation
import javax.inject.Inject

data class RelationsUiState(
    val query: String = "",
    val searching: Boolean = false,
    val results: List<IdentitySummary> = emptyList(),
    val direct: List<Relation> = emptyList(),
    val incoming: List<Relation> = emptyList(),
    val loading: Boolean = false,
    val profile: PublicProfile? = null,
    val profileLoading: Boolean = false,
    val error: String? = null,
    val info: String? = null,
    // Création d'une demande de RDV (dialogue ouvert si requestTarget != null).
    val requestTarget: String? = null,
    val myName: String = "",
    val slots: DaySlots? = null,
    val slotsLoading: Boolean = false,
    // Invitation de contact (sans annuaire)
    val inviteLink: String? = null, // lien généré à partager (dialogue)
    val scanning: Boolean = false, // scanner QR ouvert
    val inviteToken: String? = null, // jeton scanné en attente de confirmation
    val inviteHandle: String? = null, // handle de l'inviteur (aperçu)
)

@HiltViewModel
class RelationsViewModel @Inject constructor(
    private val repository: RelationsRepository,
    private val requestsRepository: RequestsRepository,
    private val navigationBus: NavigationBus,
) : ViewModel() {

    private val _uiState = MutableStateFlow(RelationsUiState())
    val uiState: StateFlow<RelationsUiState> = _uiState.asStateFlow()

    private var searchJob: Job? = null

    init {
        observeCache()
        observeNavigation()
        refresh()
    }

    /** Ouvre le profil demandé via le bus (tap sur une notification). */
    private fun observeNavigation() {
        viewModelScope.launch {
            navigationBus.openProfile.collect { handle ->
                if (handle != null) {
                    openProfile(handle)
                    navigationBus.consume()
                }
            }
        }
    }

    /** Observe les relations en cache (offline-first) ; l'UI suit le cache Room. */
    private fun observeCache() {
        viewModelScope.launch {
            repository.directRelations().collect { list -> _uiState.update { it.copy(direct = list) } }
        }
        viewModelScope.launch {
            repository.incomingRelations().collect { list -> _uiState.update { it.copy(incoming = list) } }
        }
    }

    fun refresh() {
        _uiState.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching { repository.refresh() }
                .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
            _uiState.update { it.copy(loading = false) }
        }
    }

    fun onQueryChange(query: String) {
        _uiState.update { it.copy(query = query) }
        searchJob?.cancel()
        if (query.isBlank()) {
            _uiState.update { it.copy(results = emptyList(), searching = false) }
            return
        }
        searchJob = viewModelScope.launch {
            delay(300) // debounce
            _uiState.update { it.copy(searching = true) }
            runCatching { repository.search(query) }
                .onSuccess { res -> _uiState.update { it.copy(searching = false, results = res) } }
                .onFailure { e -> _uiState.update { it.copy(searching = false, error = e.message) } }
        }
    }

    fun openProfile(handle: String) {
        _uiState.update { it.copy(profileLoading = true, profile = null, error = null) }
        viewModelScope.launch {
            runCatching { repository.profile(handle) }
                .onSuccess { p -> _uiState.update { it.copy(profileLoading = false, profile = p) } }
                .onFailure { e -> _uiState.update { it.copy(profileLoading = false, error = e.message) } }
        }
    }

    fun closeProfile() {
        _uiState.update { it.copy(profile = null, profileLoading = false) }
    }

    /** Ouvre la conversation chiffrée avec [handle] (via le bus de navigation). */
    fun openChat(handle: String) {
        navigationBus.requestChat(handle)
    }

    // addRelation/removeRelation rafraîchissent le cache côté repo → les flux
    // direct/incoming mettent l'UI à jour automatiquement.
    fun addRelation(handle: String, type: String? = null) {
        viewModelScope.launch {
            runCatching { repository.addRelation(handle, type) }
                .onFailure { e -> _uiState.update { it.copy(error = e.message ?: "Ajout impossible") } }
            refreshOpenProfile(handle)
        }
    }

    fun removeRelation(handle: String) {
        viewModelScope.launch {
            runCatching { repository.removeRelation(handle) }
                .onFailure { e -> _uiState.update { it.copy(error = e.message ?: "Retrait impossible") } }
            refreshOpenProfile(handle)
        }
    }

    /** Si le profil ouvert correspond, rafraîchit son état isContact/isRelated. */
    private suspend fun refreshOpenProfile(handle: String) {
        if (_uiState.value.profile?.handle == handle.removePrefix("@")) {
            runCatching { repository.profile(handle) }.onSuccess { p ->
                _uiState.update { it.copy(profile = p) }
            }
        }
    }

    /* ----------------------- Demande de RDV (sortante) ------------------- */

    fun openRequestDialog(handle: String) {
        _uiState.update { it.copy(requestTarget = handle, slots = null, myName = "") }
        viewModelScope.launch {
            runCatching { requestsRepository.myDisplayName() }
                .onSuccess { name -> _uiState.update { it.copy(myName = name) } }
        }
    }

    fun closeRequestDialog() {
        _uiState.update { it.copy(requestTarget = null, slots = null, slotsLoading = false) }
    }

    /** Charge les créneaux du profil ciblé pour [day] (YYYY-MM-DD). */
    fun loadSlots(day: String) {
        val target = _uiState.value.requestTarget ?: return
        _uiState.update { it.copy(slotsLoading = true, slots = null) }
        viewModelScope.launch {
            runCatching { requestsRepository.slots(target, day) }
                .onSuccess { s -> _uiState.update { it.copy(slotsLoading = false, slots = s) } }
                .onFailure { e -> _uiState.update { it.copy(slotsLoading = false, error = e.message) } }
        }
    }

    fun sendRequest(name: String, message: String?, day: String?, time: String?) {
        val target = _uiState.value.requestTarget ?: return
        viewModelScope.launch {
            runCatching { requestsRepository.createRequest(target, name, message, day, time) }
                .onSuccess { _uiState.update { it.copy(requestTarget = null, slots = null, info = "Demande envoyée 🦎") } }
                .onFailure { e -> _uiState.update { it.copy(error = e.message ?: "Envoi impossible") } }
        }
    }

    /* ----------------------- Invitation de contact ----------------------- */

    fun createInvite() {
        viewModelScope.launch {
            runCatching { repository.createInviteLink() }
                .onSuccess { link -> _uiState.update { it.copy(inviteLink = link) } }
                .onFailure { e -> _uiState.update { it.copy(error = e.message ?: "Échec") } }
        }
    }
    fun dismissInviteLink() = _uiState.update { it.copy(inviteLink = null) }
    fun startScan() = _uiState.update { it.copy(scanning = true) }
    fun stopScan() = _uiState.update { it.copy(scanning = false) }

    /** QR/lien scanné → aperçu de l'inviteur avant confirmation. */
    fun onScanned(raw: String) {
        _uiState.update { it.copy(scanning = false) }
        viewModelScope.launch {
            val handle = repository.previewInvite(raw)
            if (handle != null) _uiState.update { it.copy(inviteToken = raw, inviteHandle = handle) }
            else _uiState.update { it.copy(error = "Invitation invalide ou expirée.") }
        }
    }

    fun confirmInvite() {
        val token = _uiState.value.inviteToken ?: return
        viewModelScope.launch {
            runCatching { repository.acceptInvite(token) }
                .onSuccess { h -> _uiState.update { it.copy(inviteToken = null, inviteHandle = null, info = "Contact ajouté : @$h 🎉") } }
                .onFailure { e -> _uiState.update { it.copy(inviteToken = null, inviteHandle = null, error = e.message ?: "Échec") } }
        }
    }
    fun dismissInviteConfirm() = _uiState.update { it.copy(inviteToken = null, inviteHandle = null) }

    fun clearError() = _uiState.update { it.copy(error = null) }
    fun clearInfo() = _uiState.update { it.copy(info = null) }
}
