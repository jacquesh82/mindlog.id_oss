package today.mindlog.id.core.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import today.mindlog.id.core.crypto.Bootstrap
import today.mindlog.id.core.crypto.DoubleRatchet
import today.mindlog.id.core.crypto.E2eCrypto
import today.mindlog.id.core.crypto.E2eKeyStore
import today.mindlog.id.core.crypto.KeyPairJwk
import today.mindlog.id.core.crypto.RatchetState
import today.mindlog.id.core.crypto.RatchetStore
import today.mindlog.id.core.datastore.SessionStore
import today.mindlog.id.core.network.MindlogApi
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Double Ratchet v2 (forward secrecy).
 * Responsabilités : chiffrement/déchiffrement pair-à-pair (handle), cache recv, OPK.
 */
@Singleton
class RatchetManager @Inject constructor(
    private val state: E2eKeyState,
    private val crypto: E2eCrypto,
    private val keyStore: E2eKeyStore,
    private val api: MindlogApi,
    private val ratchet: DoubleRatchet,
    private val ratchetStore: RatchetStore,
    private val sessionStore: SessionStore,
    private val keyManager: KeyManager,
    private val mdManager: MultiDeviceManager,
) {
    private val json = Json { ignoreUnknownKeys = true }

    /**
     * Chiffre en v2 ; établit la session (initiateur) via le bundle du pair si
     * besoin. Renvoie null si le pair n'a pas de bundle → l'appelant retombe en v1.
     */
    suspend fun ratchetEncrypt(me: String, peerHandle: String, peerPub: String, text: String): V2? {
        val ikA = mdManager.myIk() ?: return null
        val sKey = RatchetStore.stateKey(me, peerHandle)
        val ikKey = RatchetStore.peerIkKey(me, peerHandle)
        var st = ratchetStore.get(sKey)?.let { runCatching { ratchet.stateFromJson(it) }.getOrNull() }
        if (st != null) {
            val stored = ratchetStore.get(ikKey)
            val cur = mdManager.ikFp(mdManager.parseJwk(peerPub))
            if (stored != null && cur != null && stored != cur) { ratchetStore.remove(sKey); st = null }
        }
        if (st == null) {
            val dto = runCatching { api.prekeyBundle(peerHandle) }.getOrNull() ?: return null
            if (dto.spkPub.isBlank() || dto.ik.isBlank()) return null
            val ekA = mdManager.genKp()
            val bundle = DoubleRatchet.PrekeyBundle(
                ik = json.parseToJsonElement(dto.ik).jsonObject,
                spkPub = json.parseToJsonElement(dto.spkPub).jsonObject,
                spkId = dto.spkId,
                opkPub = dto.opkPub?.let { json.parseToJsonElement(it).jsonObject },
                opkId = dto.opkId,
            )
            val x = ratchet.x3dhInitiator(ikA, ekA, bundle)
            st = ratchet.initSender(x.sk, x.ad, bundle.spkPub)
            st.bootstrap = buildJsonObject {
                put("ek", ekA.pub); put("ik", ikA.pub)
                put("opk", dto.opkId?.let { JsonPrimitive(it) } ?: JsonPrimitive(null as Int?))
                put("spk", JsonPrimitive(dto.spkId))
            }
            (mdManager.ikFp(mdManager.parseJwk(peerPub)) ?: mdManager.ikFp(bundle.ik))?.let { ratchetStore.put(ikKey, it) }
        }
        val bs = if (!st.confirmed) st.bootstrap?.let {
            Bootstrap(it["ek"]!!.jsonObject, it["ik"]!!.jsonObject, it["opk"]?.jsonPrimitive?.intOrNull, it["spk"]!!.jsonPrimitive.int)
        } else null
        val msg = ratchet.encrypt(st, text, bs)
        ratchetStore.put(sKey, ratchet.stateToJson(st))
        keyManager.rememberSent(me, msg.iv, text)
        return V2(msg.iv, msg.headerB64u + "." + msg.ct)
    }

    /** Déchiffre un message v2 ; établit la session (destinataire) si nécessaire. */
    suspend fun ratchetDecrypt(me: String, peerHandle: String, iv: String, packed: String): String? {
        val cacheKey = RatchetStore.recvKey(me, peerHandle, iv)
        ratchetStore.get(cacheKey)?.let { cached ->
            runCatching { json.parseToJsonElement(cached).jsonObject }.getOrNull()?.let { o ->
                val exp = o["exp"]?.jsonPrimitive?.long ?: 0L
                if (exp >= System.currentTimeMillis()) return o["text"]?.jsonPrimitive?.content
            }
        }

        val dot = packed.indexOf('.')
        if (dot <= 0) return null
        val headerB64u = packed.substring(0, dot)
        val ct = packed.substring(dot + 1)
        val sKey = RatchetStore.stateKey(me, peerHandle)
        val ikKey = RatchetStore.peerIkKey(me, peerHandle)
        val bootKey = RatchetStore.bootEkKey(me, peerHandle)
        val inbKey = RatchetStore.inboundKey(me, peerHandle)
        val header = runCatching {
            json.parseToJsonElement(String(crypto.decodeB64Url(headerB64u), Charsets.UTF_8)).jsonObject
        }.getOrNull()

        val isDevice = peerHandle.startsWith("dev:")
        val myDev = if (isDevice) sessionStore.deviceId() else null
        val peerDev = if (isDevice) peerHandle.removePrefix("dev:") else null
        val iWin = isDevice && myDev != null && peerDev != null && myDev < peerDev

        var primary = ratchetStore.get(sKey)?.let { runCatching { ratchet.stateFromJson(it) }.getOrNull() }
        val inbWrap = ratchetStore.get(inbKey)?.let { runCatching { json.parseToJsonElement(it).jsonObject }.getOrNull() }
        var inbound = inbWrap?.get("st")?.jsonObject?.let {
            runCatching { ratchet.stateFromJson(json.encodeToString(JsonObject.serializer(), it)) }.getOrNull()
        }
        val inbBootEk = inbWrap?.get("bootEk")?.jsonPrimitive?.contentOrNull
        val inbPeerIk = inbWrap?.get("peerIk")?.jsonPrimitive?.contentOrNull

        if (primary != null && header != null) {
            val senderFp = mdManager.ikFp(header["ik"]?.jsonObject)
            val stored = ratchetStore.get(ikKey)
            if (senderFp != null && stored != null && senderFp != stored) {
                ratchetStore.remove(sKey); ratchetStore.remove(inbKey); primary = null; inbound = null
            }
        }

        val saveInbound = { st: RatchetState, bEk: String?, pIk: String? ->
            val w = buildJsonObject {
                put("st", json.parseToJsonElement(ratchet.stateToJson(st)))
                bEk?.let { put("bootEk", JsonPrimitive(it)) }
                pIk?.let { put("peerIk", JsonPrimitive(it)) }
            }
            ratchetStore.put(inbKey, json.encodeToString(JsonObject.serializer(), w))
        }

        var text: String? = null
        primary?.let { p ->
            runCatching { ratchet.stateFromJson(ratchet.stateToJson(p)) }.getOrNull()?.let { clone ->
                ratchet.decrypt(clone, headerB64u, iv, ct)?.let { t ->
                    ratchetStore.put(sKey, ratchet.stateToJson(clone)); text = t
                }
            }
        }
        if (text == null) inbound?.let { ib ->
            runCatching { ratchet.stateFromJson(ratchet.stateToJson(ib)) }.getOrNull()?.let { clone ->
                ratchet.decrypt(clone, headerB64u, iv, ct)?.let { t ->
                    saveInbound(clone, inbBootEk, inbPeerIk); text = t
                }
            }
        }

        var consumePreKey: String? = null
        var consumePre: JsonObject? = null
        var consumeOpkId: Int? = null
        if (text == null) {
            val h = header ?: return null
            val ekObj = h["ek"]?.jsonObject ?: return null
            val ikObj = h["ik"]?.jsonObject ?: return null
            val estFp = mdManager.ikFp(ekObj)
            if (estFp != null && (ratchetStore.get(bootKey) == estFp || inbBootEk == estFp)) return null
            val ikB = mdManager.myIk() ?: return null
            val preKey = RatchetStore.prekeyKey(me)
            val pre = ratchetStore.get(preKey)?.let { runCatching { json.parseToJsonElement(it).jsonObject }.getOrNull() } ?: return null
            val spkObj = pre["spk"]?.jsonObject ?: return null
            val spkB = KeyPairJwk(spkObj["priv"]!!.jsonObject, spkObj["pub"]!!.jsonObject)
            val opkId = h["opk"]?.jsonPrimitive?.intOrNull
            val opks = pre["opks"]?.jsonObject
            val opkB = opkId?.let { id -> opks?.get(id.toString())?.jsonObject?.let { KeyPairJwk(it["priv"]!!.jsonObject, it["pub"]!!.jsonObject) } }
            val x = ratchet.x3dhResponder(ikB, spkB, opkB, ikObj, ekObj)
            val s = ratchet.initReceiver(x.sk, x.ad, spkB)
            val t = ratchet.decrypt(s, headerB64u, iv, ct)
            if (t == null) return null
            text = t
            val newPeerIk = mdManager.ikFp(ikObj)
            if (primary == null) {
                ratchetStore.put(sKey, ratchet.stateToJson(s))
                newPeerIk?.let { ratchetStore.put(ikKey, it) }
                estFp?.let { ratchetStore.put(bootKey, it) }
            } else if (iWin) {
                saveInbound(s, estFp, newPeerIk)
            } else {
                ratchetStore.put(sKey, ratchet.stateToJson(s))
                newPeerIk?.let { ratchetStore.put(ikKey, it) }
                estFp?.let { ratchetStore.put(bootKey, it) }
                ratchetStore.remove(inbKey)
            }
            if (opkB != null) { consumePreKey = preKey; consumePre = pre; consumeOpkId = opkId }
        }

        val out = text
        if (out != null && consumePreKey != null) consumeOpk(consumePreKey!!, consumePre!!, consumeOpkId!!)
        if (out != null) {
            val exp = System.currentTimeMillis() + 25L * 3600 * 1000
            val cached = json.encodeToString(JsonObject.serializer(), buildJsonObject {
                put("text", out); put("exp", exp)
            })
            ratchetStore.put(cacheKey, cached)
        }
        return out
    }

    /** v2 si le ciphertext est empaqueté « header.ct » ('.' absent du base64 v1). */
    fun isV2(ciphertext: String): Boolean = ciphertext.contains('.')

    fun consumeOpk(preKey: String, pre: JsonObject, opkId: Int) {
        val opks = pre["opks"]?.jsonObject ?: return
        val rebuilt = buildJsonObject {
            pre.forEach { (k, v) ->
                if (k == "opks") put(k, buildJsonObject { opks.forEach { (ok, ov) -> if (ok != opkId.toString()) put(ok, ov) } })
                else put(k, v)
            }
        }
        ratchetStore.put(preKey, json.encodeToString(JsonObject.serializer(), rebuilt))
    }
}
