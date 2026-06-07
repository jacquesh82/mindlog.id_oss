package today.mindlog.id.core.network

import kotlinx.serialization.json.JsonElement
import okhttp3.MultipartBody
import okhttp3.ResponseBody
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming
import today.mindlog.id.core.network.dto.AckBody
import today.mindlog.id.core.network.dto.ActiveSessionsDto
import today.mindlog.id.core.network.dto.AddEventBody
import today.mindlog.id.core.network.dto.AddMemberBody
import today.mindlog.id.core.network.dto.AddRelationBody
import today.mindlog.id.core.network.dto.AddTagBody
import today.mindlog.id.core.network.dto.AttachmentDto
import today.mindlog.id.core.network.dto.AvailabilityBody
import today.mindlog.id.core.network.dto.CreateGroupBody
import today.mindlog.id.core.network.dto.CreateRequestBody
import today.mindlog.id.core.network.dto.DeviceBundlesDto
import today.mindlog.id.core.network.dto.DevicesDto
import today.mindlog.id.core.network.dto.EventDto
import today.mindlog.id.core.network.dto.FieldUpsertResponse
import today.mindlog.id.core.network.dto.GroupDto
import today.mindlog.id.core.network.dto.GroupMessageBody
import today.mindlog.id.core.network.dto.GroupMessagesResponseDto
import today.mindlog.id.core.network.dto.GroupsResponseDto
import today.mindlog.id.core.network.dto.InviteAcceptDto
import today.mindlog.id.core.network.dto.InviteDto
import today.mindlog.id.core.network.dto.InvitePreviewDto
import today.mindlog.id.core.network.dto.MeDto
import today.mindlog.id.core.network.dto.MessagesResponseDto
import today.mindlog.id.core.network.dto.OkDto
import today.mindlog.id.core.network.dto.PasskeyAuthBeginBody
import today.mindlog.id.core.network.dto.PasskeyAuthFinishBody
import today.mindlog.id.core.network.dto.PasskeyAuthFinishResponse
import today.mindlog.id.core.network.dto.PinDto
import today.mindlog.id.core.network.dto.PrekeyBundleBody
import today.mindlog.id.core.network.dto.PrekeyBundleDto
import today.mindlog.id.core.network.dto.PrekeyCountDto
import today.mindlog.id.core.network.dto.PublicCardDto
import today.mindlog.id.core.network.dto.PubkeyBody
import today.mindlog.id.core.network.dto.RatchetCacheBody
import today.mindlog.id.core.network.dto.RatchetCacheDto
import today.mindlog.id.core.network.dto.ReactBody
import today.mindlog.id.core.network.dto.RedeemPinBody
import today.mindlog.id.core.network.dto.RedeemPinResponse
import today.mindlog.id.core.network.dto.RegisterDeviceBody
import today.mindlog.id.core.network.dto.RegisterDeviceDto
import today.mindlog.id.core.network.dto.RecoveryEmailBody
import today.mindlog.id.core.network.dto.RequestStatusBody
import today.mindlog.id.core.network.dto.RotateKeyDto
import today.mindlog.id.core.network.dto.SearchResponseDto
import today.mindlog.id.core.network.dto.SendMessageBody
import today.mindlog.id.core.network.dto.SessionDto
import today.mindlog.id.core.network.dto.SettingsPatchBody
import today.mindlog.id.core.network.dto.SignalBody
import today.mindlog.id.core.network.dto.SlotsDto
import today.mindlog.id.core.network.dto.TagsResponseDto
import today.mindlog.id.core.network.dto.UpsertFieldBody
import today.mindlog.id.core.network.dto.VaultBody
import today.mindlog.id.core.network.dto.VaultDto
import today.mindlog.id.core.network.dto.VerifyBody
import today.mindlog.id.core.network.dto.VerifyDto

/** Surface HTTP du backend mindlog · id consommée par l'app. */
interface MindlogApi {

    // ── Auth / Session ─────────────────────────────────────────────────────

    /** Vérifie que la clé d'accès courante est valide. */
    @GET("api/session")
    suspend fun session(): SessionDto

    /** Échange un code PIN d'appairage contre la clé d'accès (appareil non connecté). */
    @POST("api/auth/redeem-pin")
    suspend fun redeemPin(@Body body: RedeemPinBody): RedeemPinResponse

    /** Génère un code PIN à usage unique pour appairer un autre appareil. */
    @POST("api/auth/pin")
    suspend fun generateLinkPin(): PinDto

    /** Liste les sessions actives du compte (web/cookie). */
    @GET("api/sessions")
    suspend fun sessions(): ActiveSessionsDto

    /** Révoque une session par son identifiant (hash de token). */
    @DELETE("api/sessions/{id}")
    suspend fun revokeSession(@Path("id") id: String): OkDto

    /** Déconnecte toutes les sessions (les autres appareils ; la clé d'accès reste valide). */
    @POST("api/auth/logout-all")
    suspend fun logoutAllSessions(): OkDto

    /** Régénère la clé d'accès (invalide l'ancienne clé + toutes les sessions). */
    @POST("api/access-key/rotate")
    suspend fun rotateAccessKey(): RotateKeyDto

    /* ---------- Passkey (WebAuthn via Credential Manager) ---------- */

    /** Démarre l'auth passkey → options WebAuthn (JSON opaque pour Credential Manager). */
    @POST("api/passkeys/auth/begin")
    suspend fun passkeyAuthBegin(@Body body: PasskeyAuthBeginBody): JsonElement

    /** Termine l'auth passkey → handle + clé d'accès. */
    @POST("api/passkeys/auth/finish")
    suspend fun passkeyAuthFinish(@Body body: PasskeyAuthFinishBody): PasskeyAuthFinishResponse

    // ── Profile / Card / Tags ──────────────────────────────────────────────

    /** Carte privée complète du compte connecté (attributs + agenda). */
    @GET("api/me")
    suspend fun me(): MeDto

    /** Met à jour les préférences (n'envoie que les booléens fournis). */
    @PATCH("api/me/settings")
    suspend fun updateSettings(@Body body: SettingsPatchBody): OkDto

    /** Supprime définitivement le compte (RGPD, droit à l'effacement). */
    @DELETE("api/me")
    suspend fun deleteAccount(): OkDto

    /** Export RGPD : toutes les données du compte en JSON (téléchargement). */
    @Streaming
    @GET("api/me/export")
    suspend fun exportData(): ResponseBody

    /** Carte publique/contact d'un autre profil. */
    @GET("api/identities/{handle}")
    suspend fun publicCard(@Path("handle") handle: String): PublicCardDto

    /** Recherche d'identités par handle ou nom. */
    @GET("api/search")
    suspend fun search(@Query("q") query: String): SearchResponseDto

    /** Crée ou met à jour un attribut de carte. */
    @PUT("api/card/field")
    suspend fun upsertField(@Body body: UpsertFieldBody): FieldUpsertResponse

    /** Supprime un attribut de carte. */
    @DELETE("api/card/field/{key}")
    suspend fun deleteField(@Path("key") key: String): OkDto

    /** Téléverse une photo de profil (multipart, champ "photo"). */
    @Multipart
    @POST("api/photo")
    suspend fun uploadPhoto(@Part photo: MultipartBody.Part): OkDto

    /** Met à jour l'email de récupération (chaîne vide pour le retirer). */
    @PUT("api/recovery-email")
    suspend fun setRecoveryEmail(@Body body: RecoveryEmailBody): OkDto

    /** Ajoute un tag à ma carte → liste des tags à jour. */
    @POST("api/tags")
    suspend fun addTag(@Body body: AddTagBody): TagsResponseDto

    /** Retire un tag de ma carte. */
    @DELETE("api/tags/{tag}")
    suspend fun removeTag(@Path("tag") tag: String): OkDto

    // ── Agenda / Availability ──────────────────────────────────────────────

    /** Ajoute un événement à l'agenda. */
    @POST("api/agenda")
    suspend fun addEvent(@Body body: AddEventBody): EventDto

    /** Supprime un événement d'agenda. */
    @DELETE("api/agenda/{id}")
    suspend fun deleteEvent(@Path("id") id: Long): OkDto

    /** Définit le statut d'un jour (libre/occupé) au format YYYY-MM-DD. */
    @PUT("api/availability/{day}")
    suspend fun setDayStatus(@Path("day") day: String, @Body body: AvailabilityBody): OkDto

    /** Créneaux libres d'un profil pour un jour (YYYY-MM-DD). */
    @GET("api/identities/{handle}/slots")
    suspend fun slots(@Path("handle") handle: String, @Query("day") day: String): SlotsDto

    // ── Notifications ──────────────────────────────────────────────────────

    /** Marque toutes les notifications comme lues. */
    @POST("api/notifications/read")
    suspend fun markNotificationsRead(): OkDto

    // ── Relations ──────────────────────────────────────────────────────────

    /** Ajoute une relation (type : ami/pro/autre). */
    @POST("api/relations")
    suspend fun addRelation(@Body body: AddRelationBody): OkDto

    /** Retire une relation par handle. */
    @DELETE("api/relations/{handle}")
    suspend fun removeRelation(@Path("handle") handle: String): OkDto

    // ── Messages / Attachments / Signal ───────────────────────────────────

    /** Conversation chiffrée avec un contact (blobs + clé publique du pair). */
    @GET("api/messages/{handle}")
    suspend fun messages(@Path("handle") handle: String): MessagesResponseDto

    /** Envoie un message chiffré (iv + ciphertext + clés publiques figées). */
    @POST("api/messages/{handle}")
    suspend fun sendMessage(@Path("handle") handle: String, @Body body: SendMessageBody): OkDto

    /** Accuse réception/lecture des messages reçus d'un contact. */
    @POST("api/messages/{handle}/ack")
    suspend fun ackMessages(@Path("handle") handle: String, @Body body: AckBody): OkDto

    /** Supprime un de mes messages. */
    @DELETE("api/messages/{handle}/{id}")
    suspend fun deleteMessage(@Path("handle") handle: String, @Path("id") id: Long): OkDto

    /** Brûle un message à lecture unique reçu (suppression initiée par le destinataire). */
    @POST("api/messages/{handle}/{id}/burn")
    suspend fun burnMessage(@Path("handle") handle: String, @Path("id") id: Long): OkDto

    /** Bascule une réaction emoji sur un message. */
    @POST("api/messages/{handle}/react")
    suspend fun reactMessage(@Path("handle") handle: String, @Body body: ReactBody): OkDto

    /** Téléverse un blob chiffré (octets opaques) → renvoie son id + expiration. */
    @Multipart
    @POST("api/attachments/{handle}")
    suspend fun uploadAttachment(
        @Path("handle") handle: String,
        @Part part: MultipartBody.Part,
    ): AttachmentDto

    /** Télécharge le blob chiffré d'une pièce jointe. */
    @Streaming
    @GET("api/attachments/{handle}/{id}")
    suspend fun downloadAttachment(
        @Path("handle") handle: String,
        @Path("id") id: Long,
    ): ResponseBody

    /** Relaie un blob de signalisation WebRTC chiffré vers un contact. */
    @POST("api/signal/{handle}")
    suspend fun signal(@Path("handle") handle: String, @Body body: SignalBody): OkDto

    // ── Groups ─────────────────────────────────────────────────────────────

    @POST("api/groups")
    suspend fun createGroup(@Body body: CreateGroupBody): GroupDto

    @GET("api/groups")
    suspend fun listGroups(): GroupsResponseDto

    @GET("api/groups/{id}")
    suspend fun getGroup(@Path("id") id: String): GroupDto

    @POST("api/groups/{id}/members")
    suspend fun addGroupMember(@Path("id") id: String, @Body body: AddMemberBody): OkDto

    @DELETE("api/groups/{id}/members/{handle}")
    suspend fun removeGroupMember(@Path("id") id: String, @Path("handle") handle: String): OkDto

    @POST("api/groups/{id}/leave")
    suspend fun leaveGroup(@Path("id") id: String): OkDto

    @GET("api/groups/{id}/messages")
    suspend fun groupMessages(@Path("id") id: String): GroupMessagesResponseDto

    @POST("api/groups/{id}/messages")
    suspend fun sendGroupMessage(@Path("id") id: String, @Body body: GroupMessageBody): OkDto

    // ── E2E — Pubkey / Vault / Prekeys / Devices / Verify / Cache ─────────

    /** Publie ma clé publique E2E (le serveur ne voit jamais la privée). */
    @PUT("api/pubkey")
    suspend fun putPubkey(@Body body: PubkeyBody): OkDto

    /** Récupère le coffre de clé chiffré (JSON opaque) ou null. */
    @GET("api/e2e/vault")
    suspend fun getVault(): VaultDto

    /** Dépose le coffre de clé chiffré. */
    @PUT("api/e2e/vault")
    suspend fun putVault(@Body body: VaultBody): OkDto

    /** Supprime le coffre de clé. */
    @DELETE("api/e2e/vault")
    suspend fun deleteVault(): OkDto

    /** Récupère le cache ratchet chiffré (historique multi-device). */
    @GET("api/e2e/cache")
    suspend fun getRatchetCache(): RatchetCacheDto

    /** Dépose le cache ratchet chiffré. */
    @PUT("api/e2e/cache")
    suspend fun putRatchetCache(@Body body: RatchetCacheBody): OkDto

    /** Publie/réapprovisionne mon bundle de prekeys publiques. */
    @PUT("api/e2e/prekeys")
    suspend fun putPrekeys(@Body body: PrekeyBundleBody): OkDto

    /** Nombre d'OPK restantes dans mon pool (réappro sous seuil). */
    @GET("api/e2e/prekeys/count")
    suspend fun prekeysCount(): PrekeyCountDto

    /** Récupère le bundle d'un contact (consomme une OPK côté serveur). */
    @GET("api/e2e/prekeys/{handle}")
    suspend fun prekeyBundle(@Path("handle") handle: String): PrekeyBundleDto

    /** Enrôle/rafraîchit cet appareil (1er auto-approuvé ; suivants en attente). */
    @POST("api/devices")
    suspend fun registerDevice(@Body body: RegisterDeviceBody): RegisterDeviceDto

    /** Liste mes appareils actifs. */
    @GET("api/devices")
    suspend fun listDevices(): DevicesDto

    /** Approuve un appareil en attente (réservé à un appareil déjà approuvé via x-device-id). */
    @POST("api/devices/{pk}/approve")
    suspend fun approveDevice(@Path("pk") pk: Long): OkDto

    /** Révoque un appareil. */
    @DELETE("api/devices/{pk}")
    suspend fun revokeDevice(@Path("pk") pk: Long): OkDto

    /** Publie/réapprovisionne le bundle de prekeys de CET appareil (x-device-id). */
    @PUT("api/e2e/device-prekeys")
    suspend fun putDevicePrekeys(@Body body: PrekeyBundleBody): OkDto

    /** Nombre d'OPK restantes pour CET appareil. */
    @GET("api/e2e/device-prekeys/count")
    suspend fun devicePrekeysCount(): PrekeyCountDto

    /** Bundles de TOUS les appareils d'un contact (fan-out X3DH). */
    @GET("api/e2e/device-prekeys/{handle}")
    suspend fun peerDeviceBundles(@Path("handle") handle: String): DeviceBundlesDto

    /** Bundles de MES AUTRES appareils (fan-out « sync »). */
    @GET("api/e2e/my-devices")
    suspend fun myDeviceBundles(): DeviceBundlesDto

    /** Enregistre la vérification d'un contact (hash du numéro de sécurité). */
    @PUT("api/e2e/verify/{handle}")
    suspend fun putVerify(@Path("handle") handle: String, @Body body: VerifyBody): OkDto

    /** Lit le statut de vérification d'un contact (synchronisé). */
    @GET("api/e2e/verify/{handle}")
    suspend fun getVerify(@Path("handle") handle: String): VerifyDto

    /** Retire la vérification d'un contact. */
    @DELETE("api/e2e/verify/{handle}")
    suspend fun deleteVerify(@Path("handle") handle: String): OkDto

    // ── Invites ────────────────────────────────────────────────────────────

    /** Crée une invitation à usage unique → jeton. */
    @POST("api/invites")
    suspend fun createInvite(): InviteDto

    /** Aperçu public d'une invitation (qui invite). */
    @GET("api/invites/{token}")
    suspend fun invitePreview(@Path("token") token: String): InvitePreviewDto

    /** Accepte une invitation → crée la relation mutuelle. */
    @POST("api/invites/{token}/accept")
    suspend fun acceptInvite(@Path("token") token: String): InviteAcceptDto

    // ── Requests / Booking ─────────────────────────────────────────────────

    /** Crée une demande de RDV vers un profil. */
    @POST("api/identities/{handle}/requests")
    suspend fun createRequest(@Path("handle") handle: String, @Body body: CreateRequestBody): OkDto

    /** Répond à une demande reçue (accepted | declined | pending). */
    @PATCH("api/requests/{id}")
    suspend fun respondRequest(@Path("id") id: Long, @Body body: RequestStatusBody): OkDto

    /** Supprime une demande reçue. */
    @DELETE("api/requests/{id}")
    suspend fun deleteRequest(@Path("id") id: Long): OkDto

    // ── Gallery ────────────────────────────────────────────────────────────

    /** Photos publiques de [handle] (avec compteurs de likes et marqueur "liked"). */
    @GET("api/gallery/{handle}")
    suspend fun gallery(@Path("handle") handle: String): today.mindlog.id.core.network.dto.GalleryResponseDto

    /** Téléverse une (ou plusieurs) photo(s) dans ma galerie publique. */
    @Multipart
    @POST("api/gallery")
    suspend fun uploadGallery(@Part photos: List<MultipartBody.Part>): today.mindlog.id.core.network.dto.GalleryUploadDto

    /** Supprime une de mes photos de galerie. */
    @DELETE("api/gallery/{id}")
    suspend fun deleteGalleryPhoto(@Path("id") id: Long): OkDto

    /** (Premium) Définit/efface le lien cliquable d'une de mes photos. */
    @PATCH("api/gallery/{id}/link")
    suspend fun setGalleryLink(@Path("id") id: Long, @Body body: today.mindlog.id.core.network.dto.GalleryLinkBody): today.mindlog.id.core.network.dto.GalleryLinkResponseDto

    /** Bascule le like sur une photo (fingerprint = identifiant anonyme stable). */
    @POST("api/gallery/{id}/like")
    suspend fun toggleGalleryLike(@Path("id") id: Long, @Body body: today.mindlog.id.core.network.dto.GalleryLikeBody): today.mindlog.id.core.network.dto.GalleryLikeResponseDto

    // ── Premium / Space / Paid pages ───────────────────────────────────────

    /** Vue d'achat d'un espace creator. */
    @GET("api/space/{handle}")
    suspend fun space(@Path("handle") handle: String): today.mindlog.id.core.network.dto.SpaceDto

    /** Crée un Checkout Stripe pour s'abonner à l'espace de [handle]. */
    @POST("api/space/{handle}/subscribe")
    suspend fun subscribeToSpace(@Path("handle") handle: String): today.mindlog.id.core.network.dto.SpaceSubscribeResponseDto

    /** Liste de mes pages payantes. */
    @GET("api/pages")
    suspend fun myPaidPages(): today.mindlog.id.core.network.dto.PaidPagesResponseDto

    /** Vue d'une page payante (gating fait par le serveur). */
    @GET("api/pages/{handle}/{slug}")
    suspend fun paidPage(@Path("handle") handle: String, @Path("slug") slug: String): today.mindlog.id.core.network.dto.PaidPageContentDto

    /** Active Premium côté serveur via un achat Play Billing. */
    @POST("api/billing/google/verify")
    suspend fun verifyPlayPurchase(@Body body: today.mindlog.id.core.network.dto.GoogleVerifyBody): today.mindlog.id.core.network.dto.GoogleVerifyResponseDto

    /** Eligibilité à l'invitation Premium au lancement (workflow d'upsell). */
    @GET("api/premium/upsell")
    suspend fun premiumUpsell(): today.mindlog.id.core.network.dto.PremiumUpsellDto

    /** Démarre l'essai gratuit serveur-managé (un seul par compte). */
    @POST("api/premium/trial/start")
    suspend fun startPremiumTrial(): today.mindlog.id.core.network.dto.TrialStartResponseDto

    // ── Live ───────────────────────────────────────────────────────────────

    /** Lives en cours + à venir (feed public). */
    @GET("api/live/feed")
    suspend fun liveFeed(): today.mindlog.id.core.network.dto.LiveFeedDto

    /** Mes lives passés et programmés. */
    @GET("api/live/mine")
    suspend fun myLives(): today.mindlog.id.core.network.dto.LiveFeedDto

    /** Détail d'un live (métadonnées, statut). */
    @GET("api/live/{id}")
    suspend fun liveDetail(@Path("id") id: Long): today.mindlog.id.core.network.dto.LiveDto

    /** Démarre un live (Premium requis). */
    @POST("api/live/start")
    suspend fun startLive(@Body body: today.mindlog.id.core.network.dto.LiveStartBody): today.mindlog.id.core.network.dto.LiveDto

    /** Termine un live que j'ai lancé. */
    @POST("api/live/{id}/end")
    suspend fun endLive(@Path("id") id: Long): OkDto

    /** Rejoint un live en tant que viewer. */
    @POST("api/live/{id}/join")
    suspend fun joinLive(@Path("id") id: Long): today.mindlog.id.core.network.dto.LiveJoinDto

    /** Quitte un live. */
    @POST("api/live/{id}/leave")
    suspend fun leaveLive(@Path("id") id: Long): OkDto

    /** Heartbeat (toutes les 15s) pour rester compté dans le viewer count. */
    @POST("api/live/{id}/heartbeat")
    suspend fun liveHeartbeat(@Path("id") id: Long): OkDto

    /** Roster (compteur de viewers + leur id). */
    @GET("api/live/{id}/roster")
    suspend fun liveRoster(@Path("id") id: Long): today.mindlog.id.core.network.dto.LiveRosterDto

    /** Envoie un paquet de signalisation WebRTC (offre, réponse, ICE). */
    @POST("api/live/{id}/signal")
    suspend fun sendLiveSignal(@Path("id") id: Long, @Body body: today.mindlog.id.core.network.dto.LiveSignalBody): OkDto
}
