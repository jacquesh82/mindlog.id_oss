package today.mindlog.id.feature.gallery

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import today.mindlog.id.core.data.AuthRepository
import today.mindlog.id.core.data.GalleryRepository
import today.mindlog.id.core.network.dto.GalleryPhotoDto
import javax.inject.Inject

/** État UI de la galerie publique courante (mon handle ou celui d'un autre). */
data class GalleryUiState(
    val handle: String? = null,
    val photos: List<GalleryPhotoDto> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class GalleryViewModel @Inject constructor(
    private val gallery: GalleryRepository,
    private val auth: AuthRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(GalleryUiState())
    val state: StateFlow<GalleryUiState> = _state.asStateFlow()

    /** Charge la galerie pour [handle] ; null = mon handle courant. */
    fun load(handle: String? = null) {
        val target = handle?.removePrefix("@") ?: auth.currentHandle() ?: return
        _state.update { it.copy(handle = target, loading = true, error = null) }
        viewModelScope.launch {
            runCatching { gallery.photos(target) }
                .onSuccess { photos -> _state.update { it.copy(photos = photos, loading = false) } }
                .onFailure { e -> _state.update { it.copy(loading = false, error = e.message ?: "Erreur") } }
        }
    }

    fun upload(bytes: ByteArray, mime: String) {
        _state.update { it.copy(loading = true) }
        viewModelScope.launch {
            runCatching { gallery.upload(bytes, mime) }
                .onSuccess { fresh -> _state.update { it.copy(photos = it.photos + fresh, loading = false) } }
                .onFailure { e -> _state.update { it.copy(loading = false, error = e.message ?: "Upload échoué") } }
        }
    }

    fun delete(id: Long) {
        viewModelScope.launch {
            runCatching { gallery.delete(id) }
                .onSuccess { _state.update { s -> s.copy(photos = s.photos.filterNot { it.id == id }) } }
        }
    }

    fun toggleLike(id: Long) {
        viewModelScope.launch {
            runCatching { gallery.toggleLike(id) }
                .onSuccess { (liked, likes) ->
                    _state.update { s ->
                        s.copy(photos = s.photos.map { p -> if (p.id == id) p.copy(liked = liked, likes = likes) else p })
                    }
                }
        }
    }

    fun clearError() = _state.update { it.copy(error = null) }
}
