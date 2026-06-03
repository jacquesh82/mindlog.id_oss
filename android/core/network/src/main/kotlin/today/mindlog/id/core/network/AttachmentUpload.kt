package today.mindlog.id.core.network

import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import today.mindlog.id.core.network.dto.AttachmentDto

/**
 * Téléverse un blob CHIFFRÉ (octets opaques) comme pièce jointe d'une conversation.
 * Le serveur ne voit que ces octets ; la clé voyage dans le message E2E.
 */
suspend fun MindlogApi.uploadAttachmentBytes(handle: String, cipher: ByteArray): AttachmentDto {
    val body = cipher.toRequestBody("application/octet-stream".toMediaTypeOrNull())
    val part = MultipartBody.Part.createFormData("blob", "a.bin", body)
    return uploadAttachment(handle, part)
}

/** Télécharge le blob chiffré et renvoie les octets (okhttp confiné à core:network). */
suspend fun MindlogApi.downloadAttachmentBytes(handle: String, id: Long): ByteArray =
    downloadAttachment(handle, id).bytes()
