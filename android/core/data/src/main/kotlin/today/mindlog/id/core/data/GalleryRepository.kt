package today.mindlog.id.core.data

import today.mindlog.id.core.network.MindlogApi
import today.mindlog.id.core.network.dto.GalleryLikeBody
import today.mindlog.id.core.network.dto.GalleryLinkBody
import today.mindlog.id.core.network.dto.GalleryPhotoDto
import today.mindlog.id.core.network.uploadGalleryPhoto
import javax.inject.Inject
import javax.inject.Singleton

/** Galerie publique d'un handle : lecture, upload, like, lien Premium, suppression. */
@Singleton
class GalleryRepository @Inject constructor(
    private val api: MindlogApi,
    private val accentRepository: AccentRepository,
) {
    /** Photos publiques de [handle]. */
    suspend fun photos(handle: String): List<GalleryPhotoDto> =
        api.gallery(handle.removePrefix("@")).photos

    /** Téléverse une photo dans ma galerie publique. */
    suspend fun upload(bytes: ByteArray, mime: String): List<GalleryPhotoDto> =
        api.uploadGalleryPhoto(bytes, mime).photos

    /** Supprime une de mes photos. */
    suspend fun delete(id: Long) {
        api.deleteGalleryPhoto(id)
    }

    /** (Premium) Définit le lien cliquable d'une de mes photos. */
    suspend fun setLink(id: Long, url: String): String =
        api.setGalleryLink(id, GalleryLinkBody(url)).linkUrl

    /**
     * Bascule un like sur une photo. Le fingerprint anonyme stable est généré
     * (et persisté) côté client pour éviter le spam.
     */
    suspend fun toggleLike(id: Long): Pair<Boolean, Int> {
        val fp = accentRepository.deviceFingerprint()
        val res = api.toggleGalleryLike(id, GalleryLikeBody(fp))
        return res.liked to res.likes
    }
}
