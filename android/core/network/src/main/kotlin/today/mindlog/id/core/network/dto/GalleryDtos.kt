package today.mindlog.id.core.network.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Une photo de galerie publique (parité Web `/api/gallery/:handle`). */
@Serializable
data class GalleryPhotoDto(
    val id: Long,
    val url: String,
    val likes: Int = 0,
    val liked: Boolean = false,
    val mine: Boolean = false,
    @SerialName("link_url") val linkUrl: String = "",
)

@Serializable
data class GalleryResponseDto(val photos: List<GalleryPhotoDto> = emptyList())

@Serializable
data class GalleryUploadDto(val photos: List<GalleryPhotoDto> = emptyList())

@Serializable
data class GalleryLinkBody(@SerialName("link_url") val linkUrl: String)

@Serializable
data class GalleryLinkResponseDto(
    val ok: Boolean = true,
    @SerialName("link_url") val linkUrl: String = "",
)

@Serializable
data class GalleryLikeBody(val fingerprint: String)

@Serializable
data class GalleryLikeResponseDto(
    val liked: Boolean = false,
    val likes: Int = 0,
)
