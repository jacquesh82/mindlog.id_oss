package today.mindlog.id.core.data

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import today.mindlog.id.core.crypto.E2eCrypto
import today.mindlog.id.core.crypto.RatchetStore
import today.mindlog.id.core.datastore.SessionStore
import today.mindlog.id.core.model.Attachment
import today.mindlog.id.core.model.ChatMessage
import today.mindlog.id.core.model.Conversation
import today.mindlog.id.core.model.ConversationSummary
import today.mindlog.id.core.model.Reaction
import today.mindlog.id.core.network.MindlogApi
import today.mindlog.id.core.network.dto.AckBody
import today.mindlog.id.core.network.dto.ReactBody
import today.mindlog.id.core.network.dto.SendMessageBody
import today.mindlog.id.core.network.downloadAttachmentBytes
import today.mindlog.id.core.network.uploadAttachmentBytes
import javax.inject.Inject
import javax.inject.Singleton

private const val ATT_PREFIX = "att"

/**
 * Conversation chiffrée de bout en bout avec un contact. Le chiffrement/
 * déchiffrement passe par [E2eRepository] ; le serveur ne voit que des blobs.
 * Le temps réel arrive via [RealtimeRepository] (événements `message`/`ack`).
 */
@Singleton
class ChatRepository @Inject constructor(
    private val api: MindlogApi,
    private val e2e: E2eRepository,
    private val crypto: E2eCrypto,
    private val ratchetStore: RatchetStore,
    private val realtime: RealtimeRepository,
    private val sessionStore: SessionStore,
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val TMR_PREFIX = "tmr"
    private val MAX_TTL = 86400

    private fun me() = sessionStore.session.value?.handle

    /** Minuterie de disparition active (secondes) pour [handle], 24 h par défaut. */
    fun activeTtl(handle: String): Int {
        val m = me() ?: return MAX_TTL
        return ratchetStore.get(RatchetStore.timerKey(m, handle))?.toIntOrNull() ?: MAX_TTL
    }
    private fun setActiveTtl(handle: String, sec: Int) {
        me()?.let { ratchetStore.put(RatchetStore.timerKey(it, handle), sec.toString()) }
    }
    /** Parse un message de contrôle « tmr<n> » → secondes, sinon null. */
    private fun parseTimer(text: String?): Int? =
        text?.takeIf { it.startsWith(TMR_PREFIX) }?.removePrefix(TMR_PREFIX)?.toIntOrNull()

    /** Parse une sentinelle « att{json} » en métadonnée de pièce jointe (ou null). */
    private fun parseAttachment(text: String?): Attachment? {
        if (text == null || !text.startsWith(ATT_PREFIX)) return null
        val o = runCatching { json.parseToJsonElement(text.substring(ATT_PREFIX.length)).jsonObject }.getOrNull() ?: return null
        return runCatching {
            Attachment(
                id = o["id"]!!.jsonPrimitive.long,
                name = o["name"]!!.jsonPrimitive.content,
                mime = o["mime"]!!.jsonPrimitive.content,
                size = o["size"]?.jsonPrimitive?.long ?: 0,
                key = o["key"]!!.jsonPrimitive.content,
                iv = o["iv"]!!.jsonPrimitive.content,
                dur = o["dur"]?.jsonPrimitive?.long,
            )
        }.getOrNull()
    }
    /**
     * Liste des conversations (métadonnées seulement). On ne déchiffre PAS le dernier
     * message : le Double Ratchet est destructif et avancer son état hors de l'écran de
     * conversation le désynchroniserait. On expose donc date, non-lus et sens du dernier
     * message, triés du plus récent au plus ancien.
     */
    suspend fun conversationSummaries(): List<ConversationSummary> =
        api.me().conversations.map { c ->
            val last = c.messages.maxByOrNull { it.createdAt }
            ConversationSummary(
                handle = c.handle,
                displayName = c.displayName.ifBlank { null },
                hasPhoto = c.hasPhoto,
                lastAt = last?.createdAt.orEmpty(),
                unread = c.messages.count { !it.mine && it.read == 0 },
                lastMine = last?.mine ?: false,
                msgCount = c.messages.size,
            )
        }.sortedByDescending { it.lastAt }

    /** Charge et déchiffre la conversation avec [handle]. */
    suspend fun loadConversation(handle: String): Conversation {
        val me = sessionStore.session.value?.handle
        me?.let { e2e.ensure(it); e2e.ensurePrekeys(it) }
        val resp = api.messages(handle)
        val peerPub = resp.peerPubkey

        // Déchiffre un message. Multi-appareils (client_msg_id) : mon envoi relu du cache
        // (recallSent par clientMsgId), reçus via l'enveloppe de cet appareil (keyée par
        // sender_device_id). Sinon legacy v2 (ratchet par pair) / v1 (clé figée).
        val myDeviceId = sessionStore.deviceId()
        suspend fun decode(m: today.mindlog.id.core.network.dto.MessageDto, mine: Boolean): String? =
            if (m.clientMsgId != null) {
                // « Mien à relire » = envoyé par CET appareil. Un message d'un AUTRE de mes
                // appareils (sync) a sender_id == moi mais un device-id différent → déchiffrer
                // SON enveloppe, pas recallSent.
                if (m.senderDeviceId != null && m.senderDeviceId == myDeviceId) me?.let { e2e.mdRecallSent(it, m.clientMsgId!!) }
                // Message d'un AUTRE de MES appareils (sync) → clé self partagée (pas de ratchet
                // entre mes propres appareils). Sinon (pair) → ratchet par-appareil.
                else if (mine) me?.let { e2e.mdSelfDecrypt(m.iv, m.ciphertext) }
                else me?.let { e2e.mdDecryptEnvelope(it, m.senderDeviceId, m.iv, m.ciphertext) }
            } else if (e2e.isV2(m.ciphertext)) {
                if (mine) me?.let { e2e.recallSent(it, m.iv) }
                else me?.let { e2e.ratchetDecrypt(it, handle, m.iv, m.ciphertext) }
            } else {
                val pub = (if (mine) m.recipientPub else m.senderPub).ifBlank { peerPub }
                if (pub.isBlank()) null else e2e.decrypt(pub, m.iv, m.ciphertext)
            }

        var texts = resp.messages.map { decode(it, it.senderId == resp.me) }
        // Message indéchiffrable (appareil restauré, pas d'état ratchet) → pull RÉACTIF
        // du cache cross-appareil puis re-déchiffrement immédiat (legacy v2 uniquement).
        // Évite d'attendre le throttle d'un pull périodique (cause du « illisible 1 min »).
        if (me != null && resp.messages.indices.any {
                val m = resp.messages[it]; m.clientMsgId == null && e2e.isV2(m.ciphertext) && texts[it] == null
            }) {
            if (e2e.pullCacheRetry()) texts = resp.messages.map { decode(it, it.senderId == resp.me) }
        }

        var lastTmr: Int? = null
        val messages = resp.messages.mapIndexed { i, m ->
            val text = texts[i]
            val att = parseAttachment(text)
            val tmr = parseTimer(text)
            if (tmr != null) lastTmr = tmr
            ChatMessage(
                id = m.id,
                mine = m.senderId == resp.me,
                text = if (att != null || tmr != null) null else text,
                createdAt = m.createdAt,
                expiresAt = m.expiresAt,
                delivered = m.delivered == 1,
                read = m.read == 1,
                reactions = m.reactions.map { Reaction(it.emoji, it.count, it.mine) },
                attachment = att,
                systemText = tmr?.let { if (it >= MAX_TTL) "⏲ Minuterie de disparition désactivée" else "⏲ Messages éphémères : ${fmtTtl(it)}" },
                readOnce = m.readOnce == 1,
            )
        }
        // Minuterie partagée : adopter la valeur du dernier message de contrôle « tmr ».
        lastTmr?.let { setActiveTtl(handle, it) }
        // Synchronise le cache déchiffré vers le serveur (throttlé 1x/min).
        me?.let { e2e.pushCache() }
        return Conversation(
            handle = handle,
            peerPub = peerPub,
            peerHasKey = peerPub.isNotBlank(),
            needsRestore = e2e.needsRestore.value,
            ttlHours = resp.ttlHours,
            messages = messages,
        )
    }

    /**
     * Envoie un message chiffré : FAN-OUT multi-appareils si le pair a au moins un
     * appareil enrôlé, sinon repli v2 (Double Ratchet mono-session), sinon v1 (ECDH).
     */
    suspend fun send(handle: String, peerPub: String, text: String, ttl: Int? = null, once: Boolean = false) {
        val me = sessionStore.session.value?.handle
        // ttl explicite, sinon minuterie active ; ≥ 24 h → null (défaut serveur).
        val eff = (ttl ?: activeTtl(handle)).let { if (it in 1 until MAX_TTL) it else null }
        val ro = if (once) true else null
        val fo = me?.let { runCatching { e2e.mdFanoutEncrypt(it, handle, text) }.getOrNull() }
        val v2 = if (fo == null) me?.let { e2e.ratchetEncrypt(it, handle, peerPub, text) } else null
        val body = if (fo != null) {
            SendMessageBody(clientMsgId = fo.clientMsgId, envelopes = fo.envelopes, ttl = eff, readOnce = ro)
        } else if (v2 != null) {
            SendMessageBody(v2.iv, v2.ciphertext, senderPub = "", recipientPub = "", ttl = eff, readOnce = ro)
        } else {
            val blob = e2e.encrypt(peerPub, text) ?: error("Clé de chiffrement indisponible.")
            SendMessageBody(blob.iv, blob.ciphertext, senderPub = e2e.myPub().orEmpty(), recipientPub = peerPub, ttl = eff, readOnce = ro)
        }
        api.sendMessage(handle, body)
    }

    /** Brûle (supprime) un message à lecture unique reçu, après l'avoir révélé. */
    suspend fun burn(handle: String, messageId: Long) {
        runCatching { api.burnMessage(handle, messageId) }
    }

    /** Change la minuterie de disparition : persiste + message de contrôle partagé. */
    suspend fun setTimer(handle: String, peerPub: String, sec: Int) {
        setActiveTtl(handle, sec)
        send(handle, peerPub, TMR_PREFIX + sec, ttl = MAX_TTL) // contrôle envoyé en 24 h (récupérable)
    }

    private fun fmtTtl(sec: Int): String =
        if (sec >= 3600) "${sec / 3600} h" else "${sec / 60} min"

    /**
     * Envoie une pièce jointe : chiffre les octets avec une clé AES aléatoire,
     * téléverse le blob opaque, puis envoie la métadonnée (clé incluse) comme
     * message E2E normal (sentinelle ATT_PREFIX).
     */
    suspend fun sendAttachment(handle: String, peerPub: String, bytes: ByteArray, name: String, mime: String, durMs: Long? = null, once: Boolean = false) {
        val key = crypto.randomBytes(32)
        val iv = crypto.randomBytes(12)
        val cipher = crypto.gcmEncryptRaw(key, iv, bytes, ByteArray(0))
        val dto = api.uploadAttachmentBytes(handle, cipher)
        val meta = buildJsonObject {
            put("id", JsonPrimitive(dto.id))
            put("name", JsonPrimitive(name))
            put("mime", JsonPrimitive(mime))
            put("size", JsonPrimitive(bytes.size))
            put("key", JsonPrimitive(crypto.encodeB64(key)))
            put("iv", JsonPrimitive(crypto.encodeB64(iv)))
            if (durMs != null) put("dur", JsonPrimitive(durMs))
        }
        send(handle, peerPub, ATT_PREFIX + json.encodeToString(JsonObject.serializer(), meta), once = once)
    }

    /** Télécharge et déchiffre le blob d'une pièce jointe. */
    suspend fun downloadAttachment(handle: String, att: Attachment): ByteArray {
        val cipher = api.downloadAttachmentBytes(handle, att.id)
        return crypto.gcmDecryptRaw(crypto.decodeB64(att.key), crypto.decodeB64(att.iv), cipher, ByteArray(0))
    }

    suspend fun ackRead(handle: String) {
        runCatching { api.ackMessages(handle, AckBody(true)) }
    }

    suspend fun react(handle: String, messageId: Long, emoji: String) {
        api.reactMessage(handle, ReactBody(messageId, emoji))
    }

    suspend fun delete(handle: String, messageId: Long) {
        api.deleteMessage(handle, messageId)
    }

    /** Émet à chaque événement temps réel concernant la conversation [handle]. */
    fun conversationEvents(handle: String): Flow<Unit> =
        realtime.events
            .filter { (it.event == "message" || it.event == "ack") && RealtimeRepository.isFrom(it, handle) }
            .map { }
}
