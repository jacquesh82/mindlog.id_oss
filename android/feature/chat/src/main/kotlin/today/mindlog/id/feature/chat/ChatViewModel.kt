package today.mindlog.id.feature.chat

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import today.mindlog.id.core.data.CallBus
import today.mindlog.id.core.data.ChatRepository
import today.mindlog.id.core.data.E2eRepository
import today.mindlog.id.core.data.VerifyState
import today.mindlog.id.core.model.ChatMessage
import javax.inject.Inject

data class ChatUiState(
    val handle: String = "",
    val loading: Boolean = true,
    val peerHasKey: Boolean = true,
    val needsRestore: Boolean = false,
    val needsBackup: Boolean = false,
    val ttlHours: Int = 24,
    val messages: List<ChatMessage> = emptyList(),
    val peerPub: String = "",
    val error: String? = null,
    // Vérification d'identité anti-MITM
    val verifyState: VerifyState = VerifyState.NONE,
    val showVerify: Boolean = false,
    val safetyNumber: String? = null,
    val verifyMessage: String? = null,
    // Minuterie de disparition (secondes ; 86400 = désactivée)
    val ttlSeconds: Int = 86400,
    // Lecture unique : prochain message armé (un-coup) + ids révélés cette session
    val onceArmed: Boolean = false,
    val revealed: Set<Long> = emptySet(),
)

@HiltViewModel
class ChatViewModel @Inject constructor(
    private val repository: ChatRepository,
    private val e2e: E2eRepository,
    private val callBus: CallBus,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    val handle: String = savedStateHandle.get<String>("handle").orEmpty().removePrefix("@")

    private val _uiState = MutableStateFlow(ChatUiState(handle = handle))
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()

    init {
        refresh()
        observeRealtime()
    }

    private fun observeRealtime() {
        viewModelScope.launch {
            repository.conversationEvents(handle).collect { refresh(ackOnly = false) }
        }
    }

    fun refresh(ackOnly: Boolean = false) {
        viewModelScope.launch {
            runCatching { repository.loadConversation(handle) }
                .onSuccess { conv ->
                    _uiState.update {
                        it.copy(
                            loading = false,
                            peerHasKey = conv.peerHasKey,
                            needsRestore = conv.needsRestore,
                            needsBackup = e2e.needsBackup.value,
                            ttlHours = conv.ttlHours,
                            messages = conv.messages,
                            peerPub = conv.peerPub,
                            error = null,
                        )
                    }
                    // Accuse réception s'il existe un message reçu non lu.
                    if (conv.messages.any { !it.mine && !it.read }) {
                        repository.ackRead(handle)
                    }
                    _uiState.update { it.copy(ttlSeconds = repository.activeTtl(handle)) }
                    // Statut de vérification d'identité (badge ✓ / ⚠️).
                    if (conv.peerHasKey) {
                        val st = runCatching { e2e.verifyStatus(handle, conv.peerPub) }
                            .getOrDefault(VerifyState.NONE)
                        _uiState.update { it.copy(verifyState = st) }
                    }
                }
                .onFailure { e -> _uiState.update { it.copy(loading = false, error = e.message) } }
        }
    }

    /** Bascule « lecture unique » pour le prochain message (un-coup). */
    fun toggleOnce() = _uiState.update { it.copy(onceArmed = !it.onceArmed) }
    private fun takeOnce(): Boolean {
        val v = _uiState.value.onceArmed
        if (v) _uiState.update { it.copy(onceArmed = false) }
        return v
    }

    fun send(text: String) {
        val body = text.trim().take(1000)
        if (body.isEmpty()) return
        val peerPub = _uiState.value.peerPub
        if (peerPub.isBlank()) return
        val once = takeOnce()
        viewModelScope.launch {
            runCatching { repository.send(handle, peerPub, body, once = once) }
                .onSuccess { refresh() }
                .onFailure { e -> _uiState.update { it.copy(error = e.message ?: "Envoi impossible") } }
        }
    }

    /** Envoie une pièce jointe (octets déjà lus depuis l'Uri par l'UI). */
    fun sendAttachment(bytes: ByteArray, name: String, mime: String) {
        val peerPub = _uiState.value.peerPub
        if (peerPub.isBlank()) return
        val once = takeOnce()
        viewModelScope.launch {
            runCatching { repository.sendAttachment(handle, peerPub, bytes, name, mime, once = once) }
                .onSuccess { refresh() }
                .onFailure { e -> _uiState.update { it.copy(error = e.message ?: "Envoi impossible") } }
        }
    }

    /** Révèle un message à lecture unique reçu, puis le brûle côté serveur. */
    fun reveal(messageId: Long) {
        _uiState.update { it.copy(revealed = it.revealed + messageId) }
        viewModelScope.launch { runCatching { repository.burn(handle, messageId) } }
    }

    /** Change la minuterie de disparition (message de contrôle partagé). */
    fun setTimer(sec: Int) {
        val peerPub = _uiState.value.peerPub
        if (peerPub.isBlank()) return
        viewModelScope.launch {
            runCatching { repository.setTimer(handle, peerPub, sec) }
                .onSuccess { _uiState.update { it.copy(ttlSeconds = sec) }; refresh() }
                .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
        }
    }

    /** Envoie un message vocal (octets audio déjà enregistrés par l'UI). */
    fun sendVoice(bytes: ByteArray, durMs: Long) {
        val peerPub = _uiState.value.peerPub
        if (peerPub.isBlank()) return
        val once = takeOnce()
        viewModelScope.launch {
            runCatching { repository.sendAttachment(handle, peerPub, bytes, "voix.m4a", "audio/mp4", durMs, once = once) }
                .onSuccess { refresh() }
                .onFailure { e -> _uiState.update { it.copy(error = e.message ?: "Envoi impossible") } }
        }
    }

    /** Télécharge + déchiffre une pièce jointe (aperçu image / lecture audio / enregistrement). */
    suspend fun loadAttachment(att: today.mindlog.id.core.model.Attachment): ByteArray? =
        runCatching { repository.downloadAttachment(handle, att) }.getOrNull()

    fun react(messageId: Long, emoji: String) {
        viewModelScope.launch {
            runCatching { repository.react(handle, messageId, emoji) }
                .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
            refresh()
        }
    }

    fun delete(messageId: Long) {
        viewModelScope.launch {
            runCatching { repository.delete(handle, messageId) }
                .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
            refresh()
        }
    }

    /** Restaure la clé E2E depuis le coffre, par code PIN ou par passphrase. */
    fun restore(secret: String, pin: Boolean) {
        viewModelScope.launch {
            val ok = runCatching {
                if (pin) e2e.restoreWithPin(secret) else e2e.restoreWithPassphrase(secret)
            }.getOrDefault(false)
            if (ok) refresh()
            else _uiState.update { it.copy(error = if (pin) "Code PIN incorrect." else "Passphrase incorrecte.") }
        }
    }

    fun startCall(video: Boolean) {
        val peerPub = _uiState.value.peerPub
        if (peerPub.isBlank()) {
            _uiState.update { it.copy(error = "Ce contact n'a pas activé la messagerie chiffrée.") }
            return
        }
        callBus.requestCall(handle, peerPub, video)
    }

    fun clearError() = _uiState.update { it.copy(error = null) }

    /* ---------------- Vérification d'identité (anti-MITM) ----------------- */

    fun openVerify() {
        val peerPub = _uiState.value.peerPub
        if (peerPub.isBlank()) return
        val sn = e2e.safetyNumber(handle, peerPub)
        _uiState.update { it.copy(showVerify = true, safetyNumber = sn, verifyMessage = null) }
    }

    fun closeVerify() = _uiState.update { it.copy(showVerify = false, verifyMessage = null) }

    /** Marque manuellement le contact comme vérifié (après comparaison du numéro). */
    fun markVerified() {
        val peerPub = _uiState.value.peerPub
        viewModelScope.launch {
            val ok = e2e.markVerified(handle, peerPub)
            if (ok) {
                _uiState.update { it.copy(verifyState = VerifyState.VERIFIED, showVerify = false) }
            } else {
                _uiState.update { it.copy(verifyMessage = "Échec de l'enregistrement.") }
            }
        }
    }

    fun unverify() {
        viewModelScope.launch {
            e2e.clearVerified(handle)
            _uiState.update { it.copy(verifyState = VerifyState.NONE, showVerify = false) }
        }
    }

    /** Résultat du scan du QR du contact : compare au numéro local, vérifie si égal. */
    fun onScanResult(scanned: String) {
        val sn = _uiState.value.safetyNumber
        val value = scanned.removePrefix("mindlog-sn-v1:")
        if (sn != null && value == sn) {
            markVerified()
        } else {
            _uiState.update { it.copy(verifyMessage = "Le QR ne correspond pas ⚠️") }
        }
    }
}
