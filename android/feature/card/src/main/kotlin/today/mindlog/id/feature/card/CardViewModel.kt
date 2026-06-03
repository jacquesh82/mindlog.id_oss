package today.mindlog.id.feature.card

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.first
import today.mindlog.id.core.data.AuthRepository
import today.mindlog.id.core.data.AuthState
import today.mindlog.id.core.data.CardRepository
import today.mindlog.id.core.data.E2eRepository
import today.mindlog.id.core.model.Card
import javax.inject.Inject

/**
 * Offline-first : [card] vient du cache Room (affiché immédiatement s'il existe),
 * [refreshing]/[error] reflètent la synchro réseau en cours.
 */
data class CardUiState(
    val card: Card? = null,
    val refreshing: Boolean = false,
    val error: String? = null,
    /** Incrémenté après un upload de photo pour casser le cache image. */
    val photoVersion: Long = 0,
    /** La clé E2E locale n'est pas encore sauvegardée dans le coffre (portabilité). */
    val needsKeyBackup: Boolean = false,
    /** La page publique (.../@handle) est-elle visible (true) ou en mode « secret » (false). */
    val pagePublic: Boolean = true,
    /** Tags de la carte (compétences / centres d'intérêt). */
    val tags: List<String> = emptyList(),
)

@HiltViewModel
class CardViewModel @Inject constructor(
    private val cardRepository: CardRepository,
    private val authRepository: AuthRepository,
    private val e2e: E2eRepository,
) : ViewModel() {

    private val refreshing = MutableStateFlow(false)
    private val error = MutableStateFlow<String?>(null)
    private val photoVersion = MutableStateFlow(0L)
    private val pagePublic = MutableStateFlow(true)
    private val tags = MutableStateFlow<List<String>>(emptyList())

    val uiState = combine(
        cardRepository.myCard(), refreshing, error, photoVersion, e2e.needsBackup,
    ) { card, refreshing, error, photoVersion, needsBackup ->
        CardUiState(
            card = card,
            refreshing = refreshing,
            error = error,
            photoVersion = photoVersion,
            needsKeyBackup = needsBackup,
        )
    }.combine(pagePublic) { state, pub ->
        state.copy(pagePublic = pub)
    }.combine(tags) { state, t ->
        state.copy(tags = t)
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = CardUiState(refreshing = true),
    )

    init {
        refresh()
        // Calcule l'état de la clé E2E (présence locale + sauvegarde coffre) dès l'ouverture,
        // et publie le bundle de prekeys pour qu'un contact puisse m'écrire en v2 (Double
        // Ratchet) sans attendre que j'ouvre une conversation.
        viewModelScope.launch {
            (authRepository.authState.first() as? AuthState.LoggedIn)?.let {
                e2e.ensure(it.handle)
                runCatching { e2e.ensurePrekeys(it.handle) }
            }
        }
    }

    fun refresh() {
        if (refreshing.value) return
        refreshing.value = true
        error.value = null
        viewModelScope.launch {
            runCatching { cardRepository.refresh() }
                .onFailure { e -> error.update { e.message ?: "Erreur réseau" } }
            runCatching { cardRepository.accountFlags() }.getOrNull()?.let {
                pagePublic.value = it.pagePublic
                tags.value = it.tags
            }
            refreshing.value = false
        }
    }

    /** Bascule la visibilité de la page publique (.../@handle) : Public ↔ Secret. */
    fun toggleSecret() {
        viewModelScope.launch {
            val next = !pagePublic.value
            runCatching { cardRepository.setPagePublic(next) }
                .onSuccess { pagePublic.value = next }
                .onFailure { e -> error.value = e.message ?: "Modification impossible" }
        }
    }

    fun signOut() {
        viewModelScope.launch { authRepository.signOut() }
    }

    /**
     * Crée ou met à jour un attribut. Pour un nouvel attribut, [key] est dérivée
     * du libellé. [visibility] : "public" | "contact" | "private".
     */
    fun saveField(key: String, value: String, label: String?, visibility: String) {
        viewModelScope.launch {
            runCatching { cardRepository.setField(key, value, label, visibility) }
                .onFailure { e -> error.value = e.message ?: "Enregistrement impossible" }
        }
    }

    fun deleteField(key: String) {
        viewModelScope.launch {
            runCatching { cardRepository.deleteField(key) }
                .onFailure { e -> error.value = e.message ?: "Suppression impossible" }
        }
    }

    fun addTag(tag: String) {
        val t = tag.trim()
        if (t.isBlank()) return
        viewModelScope.launch {
            runCatching { cardRepository.addTag(t) }
                .onSuccess { tags.value = it }
                .onFailure { e -> error.value = e.message ?: "Ajout du tag impossible" }
        }
    }

    fun removeTag(tag: String) {
        viewModelScope.launch {
            runCatching { cardRepository.removeTag(tag) }
                .onSuccess { tags.value = tags.value.filterNot { it == tag } }
                .onFailure { e -> error.value = e.message ?: "Suppression du tag impossible" }
        }
    }

    fun uploadPhoto(bytes: ByteArray, mime: String) {
        viewModelScope.launch {
            runCatching { cardRepository.uploadPhoto(bytes, mime) }
                .onSuccess { photoVersion.value = System.currentTimeMillis() }
                .onFailure { e -> error.value = e.message ?: "Envoi de la photo impossible" }
        }
    }

    /**
     * Sauvegarde la clé E2E dans le coffre serveur, protégée par [passphrase].
     * C'est ce qui rend la clé portable : un autre appareil pourra la restaurer
     * avec la même passphrase au lieu d'en générer une nouvelle (messages alors
     * indéchiffrables). Renvoie false si la passphrase est trop courte / l'envoi échoue.
     */
    fun backupKey(passphrase: String) {
        viewModelScope.launch {
            val ok = runCatching { e2e.saveVaultPassphrase(passphrase) }.getOrDefault(false)
            if (!ok) error.value = "Sauvegarde impossible (passphrase de 8 caractères min.)."
        }
    }

    fun clearError() { error.value = null }
}

/** Slug ASCII minuscule pour la clé d'un nouvel attribut (ex. "Mon Site" -> "mon-site"). */
internal fun slugifyKey(label: String): String =
    label.trim().lowercase()
        .replace(Regex("[^a-z0-9]+"), "-")
        .trim('-')
        .ifBlank { "champ" }
