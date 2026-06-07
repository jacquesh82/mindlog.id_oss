package today.mindlog.id.core.network

import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import today.mindlog.id.core.network.dto.GalleryUploadDto

/**
 * Téléverse une photo de galerie publique (multipart, champ "photos[]").
 * Confine okhttp à `core:network`.
 */
suspend fun MindlogApi.uploadGalleryPhoto(bytes: ByteArray, mime: String): GalleryUploadDto {
    val media = mime.toMediaTypeOrNull() ?: "image/jpeg".toMediaTypeOrNull()
    val ext = when (mime) {
        "image/png" -> "png"
        "image/webp" -> "webp"
        "image/gif" -> "gif"
        else -> "jpg"
    }
    val body = bytes.toRequestBody(media)
    val part = MultipartBody.Part.createFormData("photos", "gallery.$ext", body)
    return uploadGallery(listOf(part))
}
