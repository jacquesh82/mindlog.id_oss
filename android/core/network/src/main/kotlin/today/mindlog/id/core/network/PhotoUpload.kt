package today.mindlog.id.core.network

import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * Téléverse des octets d'image comme photo de profil. Construit le multipart
 * ici pour que les types okhttp restent confinés à `core:network`.
 *
 * @param mime type MIME (image/jpeg, image/png, image/webp, image/gif).
 */
suspend fun MindlogApi.uploadPhotoBytes(bytes: ByteArray, mime: String) {
    val media = mime.toMediaTypeOrNull() ?: "image/jpeg".toMediaTypeOrNull()
    val ext = when (mime) {
        "image/png" -> "png"
        "image/webp" -> "webp"
        "image/gif" -> "gif"
        else -> "jpg"
    }
    val body = bytes.toRequestBody(media)
    val part = MultipartBody.Part.createFormData("photo", "photo.$ext", body)
    uploadPhoto(part)
}
