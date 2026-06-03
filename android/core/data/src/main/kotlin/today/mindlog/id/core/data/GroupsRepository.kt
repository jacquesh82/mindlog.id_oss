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
import today.mindlog.id.core.crypto.E2eCrypto
import today.mindlog.id.core.crypto.GroupMsg
import today.mindlog.id.core.crypto.GroupPeerState
import today.mindlog.id.core.crypto.GroupSender
import today.mindlog.id.core.crypto.GroupSenderState
import today.mindlog.id.core.crypto.RatchetStore
import today.mindlog.id.core.datastore.SessionStore
import today.mindlog.id.core.model.Group
import today.mindlog.id.core.model.GroupConversation
import today.mindlog.id.core.model.GroupMember
import today.mindlog.id.core.model.GroupMessage
import today.mindlog.id.core.network.MindlogApi
import today.mindlog.id.core.network.dto.AddMemberBody
import today.mindlog.id.core.network.dto.CreateGroupBody
import today.mindlog.id.core.network.dto.GroupDto
import today.mindlog.id.core.network.dto.GroupMessageBody
import today.mindlog.id.core.network.dto.SendMessageBody
import javax.inject.Inject
import javax.inject.Singleton

private const val SKD_PREFIX = "skd" // message de contrôle 1-à-1 portant une sender key

/**
 * Messagerie de groupe E2E « sender keys » (Option M), miroir de public/app.js.
 * Le serveur ne connaît que l'appartenance (métadonnée) ; les sender keys sont
 * distribuées par le canal Double Ratchet 1-à-1 (sentinelle « skd »), et les
 * messages restent éphémères (TTL serveur). État par groupe en [RatchetStore].
 */
@Singleton
class GroupsRepository @Inject constructor(
    private val api: MindlogApi,
    private val e2e: E2eRepository,
    private val crypto: E2eCrypto,
    private val gs: GroupSender,
    private val ratchetStore: RatchetStore,
    private val realtime: RealtimeRepository,
    private val sessionStore: SessionStore,
) {
    private val json = Json { ignoreUnknownKeys = true }
    private fun me() = sessionStore.session.value?.handle

    /* ----------------------------- Métadonnée ----------------------------- */
    private fun GroupDto.toModel() = Group(id, name, members.map { GroupMember(it.handle, it.role) }, role)

    suspend fun list(): List<Group> = api.listGroups().groups.map { it.toModel() }
    suspend fun create(name: String, members: List<String>): Group =
        api.createGroup(CreateGroupBody(name, members)).toModel()
    suspend fun addMember(gid: String, handle: String) { api.addGroupMember(gid, AddMemberBody(handle.removePrefix("@"))) }
    suspend fun removeMember(gid: String, handle: String) { api.removeGroupMember(gid, handle.removePrefix("@")) }
    suspend fun leave(gid: String) { api.leaveGroup(gid) }

    /* ------------------------- État local (par groupe) -------------------- */
    private class GState(
        var mySender: GroupSenderState?,
        val peers: MutableMap<String, GroupPeerState>,
        val sent: MutableMap<String, String>,
    )

    private fun loadState(me: String, gid: String): GState {
        val raw = ratchetStore.get(RatchetStore.groupKey(me, gid))
            ?: return GState(null, mutableMapOf(), mutableMapOf())
        val o = runCatching { json.parseToJsonElement(raw).jsonObject }.getOrNull()
            ?: return GState(null, mutableMapOf(), mutableMapOf())
        val mine = (o["mySender"] as? JsonObject)?.let { gs.senderFromJson(json.encodeToString(JsonObject.serializer(), it)) }
        val peers = (o["peers"] as? JsonObject)?.entries?.associate { (h, v) ->
            h to gs.peerFromJson(json.encodeToString(JsonObject.serializer(), v.jsonObject))
        }?.toMutableMap() ?: mutableMapOf()
        val sent = (o["sent"] as? JsonObject)?.entries?.associate { (k, v) -> k to v.jsonPrimitive.content }
            ?.toMutableMap() ?: mutableMapOf()
        return GState(mine, peers, sent)
    }

    private fun saveState(me: String, gid: String, st: GState) {
        val o = buildJsonObject {
            st.mySender?.let { put("mySender", json.parseToJsonElement(gs.senderToJson(it)).jsonObject) }
            put("peers", buildJsonObject { st.peers.forEach { (h, p) -> put(h, json.parseToJsonElement(gs.peerToJson(p)).jsonObject) } })
            put("sent", buildJsonObject { st.sent.forEach { (k, v) -> put(k, JsonPrimitive(v)) } })
        }
        ratchetStore.put(RatchetStore.groupKey(me, gid), json.encodeToString(JsonObject.serializer(), o))
    }

    /* --------------------------- Bootstrap SKDM --------------------------- */
    /**
     * (1) envoie ma SKDM à chaque autre membre via le ratchet 1-à-1, (2) lit les
     * SKDM reçues dans chaque conversation 1-à-1. Sans démon : appelé à l'ouverture.
     */
    suspend fun syncKeys(gid: String, members: List<String>) {
        val me = me() ?: return
        me.let { e2e.ensure(it); e2e.ensurePrekeys(it) }
        val st = loadState(me, gid)
        if (st.mySender == null) st.mySender = gs.init()
        val others = members.map { it.removePrefix("@") }.filter { it != me.removePrefix("@") }
        val dist = json.encodeToString(JsonObject.serializer(), gs.dist(st.mySender!!))
        val payload = SKD_PREFIX + buildJsonObject {
            put("gid", JsonPrimitive(gid)); put("dist", json.parseToJsonElement(dist).jsonObject)
        }.let { json.encodeToString(JsonObject.serializer(), it) }
        // (1) diffuser ma clé (best-effort).
        for (h in others) runCatching { sendOneToOne(me, h, payload) }
        // (2) collecter les clés des autres.
        for (h in others) runCatching {
            val d = api.messages(h)
            for (m in d.messages) {
                if (m.senderId == d.me) continue
                val txt = if (e2e.isV2(m.ciphertext)) e2e.ratchetDecrypt(me, h, m.iv, m.ciphertext)
                else (m.senderPub.ifBlank { d.peerPubkey }).takeIf { it.isNotBlank() }?.let { e2e.decrypt(it, m.iv, m.ciphertext) }
                if (txt != null && txt.startsWith(SKD_PREFIX)) {
                    runCatching {
                        val o = json.parseToJsonElement(txt.substring(SKD_PREFIX.length)).jsonObject
                        if (o["gid"]?.jsonPrimitive?.content == gid) {
                            (o["dist"] as? JsonObject)?.let { st.peers[h] = gs.peerFromDist(it) }
                        }
                    }
                }
            }
        }
        saveState(me, gid, st)
    }

    /** Envoi 1-à-1 d'un message de contrôle : fan-out multi-appareils en priorité,
     *  repli ratchet v2, repli v1 statique si aucun bundle disponible. */
    private suspend fun sendOneToOne(me: String, handle: String, text: String) {
        val fo = runCatching { e2e.mdFanoutEncrypt(me, handle, text) }.getOrNull()
        if (fo != null && fo.envelopes.isNotEmpty()) {
            api.sendMessage(handle, SendMessageBody(clientMsgId = fo.clientMsgId, envelopes = fo.envelopes))
            return
        }
        val v2 = e2e.ratchetEncrypt(me, handle, "", text)
        val body = if (v2 != null) {
            SendMessageBody(v2.iv, v2.ciphertext)
        } else {
            val peerPub = api.messages(handle).peerPubkey
            val blob = e2e.encrypt(peerPub, text) ?: return
            SendMessageBody(blob.iv, blob.ciphertext, senderPub = e2e.myPub().orEmpty(), recipientPub = peerPub)
        }
        api.sendMessage(handle, body)
    }

    /* ------------------------- Envoi / lecture groupe --------------------- */
    suspend fun send(gid: String, text: String) {
        val me = me() ?: return
        val st = loadState(me, gid)
        if (st.mySender == null) st.mySender = gs.init()
        val m = gs.encrypt(st.mySender!!, text)
        st.sent[m.iter.toString()] = text // relire mes propres envois (chaîne avancée, FS)
        saveState(me, gid, st)
        api.sendGroupMessage(gid, GroupMessageBody(m.iv, pack(m)))
    }

    suspend fun loadConversation(gid: String): GroupConversation {
        val me = me() ?: error("non connecté")
        val group = api.getGroup(gid).toModel()
        syncKeys(gid, group.members.map { it.handle }) // bootstrap avant lecture
        val st = loadState(me, gid)
        val d = api.groupMessages(gid)
        val messages = d.messages.map { m ->
            val mine = m.senderId == d.me
            val env = unpack(m.ciphertext)
            val text = when {
                env == null -> null
                mine -> st.sent[env.first.toString()]
                else -> st.peers[m.senderHandle]?.let {
                    gs.decrypt(it, GroupMsg(env.first, m.iv, env.second, env.third))
                }
            }
            GroupMessage(
                id = m.id, sender = m.senderHandle, mine = mine, text = text,
                createdAt = m.createdAt, expiresAt = m.expiresAt, pending = !mine && text == null,
            )
        }
        saveState(me, gid, st) // peers avancés persistés
        return GroupConversation(group, d.ttlHours, messages)
    }

    /** Rotation : régénère ma sender key (au retrait d'un membre) et rediffuse. */
    suspend fun rotate(gid: String, members: List<String>) {
        val me = me() ?: return
        val st = loadState(me, gid)
        st.mySender = gs.init()
        st.sent.clear()
        saveState(me, gid, st)
        syncKeys(gid, members)
    }

    /** Émet à chaque événement temps réel `group` concernant [gid]. */
    fun groupEvents(gid: String): Flow<Unit> =
        realtime.events.filter { it.event == "group" && it.data.contains("\"$gid\"") }.map { }

    /** Émet à chaque événement `group` (ajout/retrait/nouveau groupe) — rafraîchir la liste. */
    fun listEvents(): Flow<Unit> = realtime.events.filter { it.event == "group" }.map { }

    /* ------ Empaquetage ciphertext : b64url(header{iter,sig}) + "." + ct ---- */
    private fun pack(m: GroupMsg): String {
        val header = buildJsonObject { put("iter", JsonPrimitive(m.iter)); put("sig", JsonPrimitive(m.sig)) }
        return crypto.encodeB64Url(json.encodeToString(JsonObject.serializer(), header).toByteArray(Charsets.UTF_8)) + "." + m.ct
    }
    private fun unpack(packed: String): Triple<Int, String, String>? {
        val dot = packed.indexOf('.'); if (dot <= 0) return null
        return runCatching {
            val h = json.parseToJsonElement(String(crypto.decodeB64Url(packed.substring(0, dot)), Charsets.UTF_8)).jsonObject
            Triple(h["iter"]!!.jsonPrimitive.content.toInt(), packed.substring(dot + 1), h["sig"]!!.jsonPrimitive.content)
        }.getOrNull()
    }
}
