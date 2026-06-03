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
import kotlinx.serialization.json.put
import today.mindlog.id.core.crypto.Bootstrap
import today.mindlog.id.core.crypto.DoubleRatchet
import today.mindlog.id.core.crypto.E2eCrypto
import today.mindlog.id.core.crypto.E2eKeyStore
import today.mindlog.id.core.crypto.KeyPairJwk
import today.mindlog.id.core.crypto.RatchetStore
import today.mindlog.id.core.datastore.SessionStore
import today.mindlog.id.core.network.MindlogApi
import today.mindlog.id.core.network.dto.DeviceBundleDto
import today.mindlog.id.core.network.dto.EnvelopeBody
import today.mindlog.id.core.network.dto.OpkBody
import today.mindlog.id.core.network.dto.PrekeyBundleBody
import today.mindlog.id.core.network.dto.RegisterDeviceBody
import java.security.interfaces.ECPrivateKey
import javax.crypto.SecretKey
import javax.crypto.spec.SecretKeySpec
import javax.inject.Inject
import javax.inject.Singleton

/**
 * X3DH + fan-out multi-appareils.
 * Responsabilités : enregistrement appareil, chiffrement/déchiffrement fan-out,
 * sync self (clé partagée entre mes appareils), souvenir des envois fan-out.
 */
@Singleton
class MultiDeviceManager @Inject constructor(
    private val state: E2eKeyState,
    private val crypto: E2eCrypto,
    private val keyStore: E2eKeyStore,
    private val api: MindlogApi,
    private val ratchet: DoubleRatchet,
    private val ratchetStore: RatchetStore,
    private val sessionStore: SessionStore,
) {
    private val json = Json { ignoreUnknownKeys = true }

    /** Génère/réapprovisionne le bundle de prekeys et le publie. Idempotent. */
    suspend fun ensurePrekeys(handle: String) {
        if (state.privJwk == null) return
        val key = RatchetStore.prekeyKey(handle)
        val store = ratchetStore.get(key)?.let { runCatching { json.parseToJsonElement(it).jsonObject }.getOrNull() }
        var spkId = store?.get("spkId")?.jsonPrimitive?.int ?: 1
        var nextOpkId = store?.get("nextOpkId")?.jsonPrimitive?.int ?: 1
        val spk = store?.get("spk")?.jsonObject?.let { KeyPairJwk(it["priv"]!!.jsonObject, it["pub"]!!.jsonObject) } ?: genKp()
        val opks = LinkedHashMap<String, JsonObject>()
        (store?.get("opks") as? JsonObject)?.forEach { (k, v) -> opks[k] = v.jsonObject }

        val available = runCatching { api.prekeysCount().available }.getOrDefault(0)
        val firstPublish = opks.isEmpty()
        if (firstPublish || available < OPK_LOW) {
            val newOpks = mutableListOf<OpkBody>()
            val need = OPK_TARGET - available
            repeat(maxOf(0, need)) {
                val id = nextOpkId++
                val kp = genKp()
                opks[id.toString()] = buildJsonObject { put("priv", kp.priv); put("pub", kp.pub) }
                newOpks.add(OpkBody(id, json.encodeToString(JsonObject.serializer(), kp.pub)))
            }
            persistPrekeys(key, spkId, nextOpkId, spk, opks)
            runCatching { api.putPrekeys(PrekeyBundleBody(json.encodeToString(JsonObject.serializer(), spk.pub), spkId, newOpks)) }
        } else {
            persistPrekeys(key, spkId, nextOpkId, spk, opks)
        }
        runCatching { mdRegisterDevice(handle) }
    }

    /** Enregistre cet appareil (clé E2E locale = clé d'appareil) + publie ses prekeys. */
    suspend fun mdRegisterDevice(handle: String) {
        val pub = state.pubStr ?: return
        val deviceId = sessionStore.deviceId()
        runCatching { api.registerDevice(RegisterDeviceBody(deviceId, pub, android.os.Build.MODEL ?: "Android")) }
        runCatching { mdPublishDevicePrekeys(handle) }
    }

    /**
     * Construit un envoi FAN-OUT : ratchet par-appareil pour les appareils du pair,
     * clé self partagée pour mes autres appareils (sync).
     * Renvoie null si aucun appareil cible.
     */
    suspend fun mdFanoutEncrypt(me: String, peerHandle: String, text: String): Fanout? {
        val peerDevs = runCatching { api.peerDeviceBundles(peerHandle).devices }.getOrDefault(emptyList())
            .filter { it.ik.isNotBlank() && it.spkPub.isNotBlank() }
        val myDevs = runCatching { api.myDeviceBundles().devices }.getOrDefault(emptyList())
            .filter { it.deviceId.isNotBlank() }
        if (peerDevs.isEmpty() && myDevs.isEmpty()) return null
        val envelopes = mutableListOf<EnvelopeBody>()
        for (b in peerDevs) {
            val enc = runCatching { mdEncryptToDevice(me, "dev:" + b.deviceId, b, text) }.getOrNull() ?: continue
            envelopes.add(EnvelopeBody(b.deviceId, enc.iv, enc.ciphertext))
        }
        if (myDevs.isNotEmpty()) {
            mdSelfEncrypt(text)?.let { self ->
                for (b in myDevs) envelopes.add(EnvelopeBody(b.deviceId, self.iv, self.ciphertext))
            }
        }
        if (envelopes.isEmpty()) return null
        val cmid = "m-" + java.util.UUID.randomUUID().toString()
        rememberFanoutSent(me, cmid, text)
        return Fanout(cmid, envelopes)
    }

    /** Déchiffre une enveloppe reçue : session keyée par le device-id de l'expéditeur. */
    suspend fun mdDecryptEnvelope(me: String, senderDeviceId: String?, iv: String, packed: String): String? {
        if (senderDeviceId.isNullOrBlank()) return null
        return ratchetDecryptInternal(me, "dev:" + senderDeviceId, iv, packed)
    }

    /** Déchiffre un message d'un autre de mes appareils (clé self partagée). */
    fun mdSelfDecrypt(iv: String, ciphertext: String): String? {
        val key = selfKey() ?: return null
        val ct = if (ciphertext.startsWith("self:")) ciphertext.substring(5) else ciphertext
        return runCatching { crypto.gcmDecrypt(key, iv, ct) }.getOrNull()
    }

    /** Clair de mon propre envoi fan-out (FS : non redéchiffrable), relu du cache local. */
    fun mdRecallSent(me: String, cmid: String): String? {
        val raw = ratchetStore.get(mdSentKey(me, cmid)) ?: return null
        val o = runCatching { json.parseToJsonElement(raw).jsonObject }.getOrNull() ?: return null
        val exp = o["exp"]?.jsonPrimitive?.content?.toLongOrNull() ?: 0
        if (exp < System.currentTimeMillis()) { ratchetStore.remove(mdSentKey(me, cmid)); return null }
        return o["text"]?.jsonPrimitive?.content
    }

    // ------------------- Shared with RatchetManager (internal) -------------------

    fun genKp(): KeyPairJwk {
        val kp = crypto.generateKeyPair()
        return KeyPairJwk(
            json.parseToJsonElement(crypto.privateJwk(kp)).jsonObject,
            json.parseToJsonElement(crypto.publicJwk(kp)).jsonObject,
        )
    }

    fun myIk(): KeyPairJwk? {
        val pj = state.privJwk ?: return null
        val o = json.parseToJsonElement(pj).jsonObject
        val pub = buildJsonObject {
            put("kty", JsonPrimitive("EC")); put("crv", JsonPrimitive("P-256"))
            put("x", o["x"]!!); put("y", o["y"]!!); put("ext", JsonPrimitive(true))
        }
        return KeyPairJwk(o, pub)
    }

    fun ikFp(pub: JsonObject?): String? {
        pub ?: return null
        val x = pub["x"]?.jsonPrimitive?.content ?: return null
        val y = pub["y"]?.jsonPrimitive?.content ?: return null
        return runCatching {
            val raw = crypto.decodeB64Url(x) + crypto.decodeB64Url(y)
            java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(raw)
        }.getOrNull()
    }

    fun parseJwk(s: String?): JsonObject? =
        s?.takeIf { it.isNotBlank() }?.let { runCatching { json.parseToJsonElement(it).jsonObject }.getOrNull() }

    fun persistPrekeys(key: String, spkId: Int, nextOpkId: Int, spk: KeyPairJwk, opks: Map<String, JsonObject>) {
        val obj = buildJsonObject {
            put("spkId", JsonPrimitive(spkId)); put("nextOpkId", JsonPrimitive(nextOpkId))
            put("spk", buildJsonObject { put("priv", spk.priv); put("pub", spk.pub) })
            put("opks", buildJsonObject { opks.forEach { (k, v) -> put(k, v) } })
        }
        ratchetStore.put(key, json.encodeToString(JsonObject.serializer(), obj))
    }

    // Internal ratchet decrypt used by mdDecryptEnvelope — delegates to RatchetManager
    // is not injected here to avoid circular dep; we inline the device session decrypt.
    private suspend fun ratchetDecryptInternal(me: String, peerHandle: String, iv: String, packed: String): String? {
        val cacheKey = RatchetStore.recvKey(me, peerHandle, iv)
        ratchetStore.get(cacheKey)?.let { cached ->
            runCatching { json.parseToJsonElement(cached).jsonObject }.getOrNull()?.let { o ->
                val exp = o["exp"]?.jsonPrimitive?.content?.toLongOrNull() ?: 0L
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
            val senderFp = ikFp(header["ik"]?.jsonObject)
            val stored = ratchetStore.get(ikKey)
            if (senderFp != null && stored != null && senderFp != stored) {
                ratchetStore.remove(sKey); ratchetStore.remove(inbKey); primary = null; inbound = null
            }
        }

        val saveInbound = { st: today.mindlog.id.core.crypto.RatchetState, bEk: String?, pIk: String? ->
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
            val estFp = ikFp(ekObj)
            if (estFp != null && (ratchetStore.get(bootKey) == estFp || inbBootEk == estFp)) return null
            val ikB = myIk() ?: return null
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
            val newPeerIk = ikFp(ikObj)
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

    // --------------------------------- Private ----------------------------------

    private suspend fun mdPublishDevicePrekeys(handle: String) {
        val key = RatchetStore.prekeyKey(handle)
        val store = ratchetStore.get(key)?.let { runCatching { json.parseToJsonElement(it).jsonObject }.getOrNull() } ?: return
        val spkId = store["spkId"]?.jsonPrimitive?.int ?: 1
        val spkPub = store["spk"]?.jsonObject?.get("pub")?.jsonObject ?: return
        val opks = mutableListOf<OpkBody>()
        (store["opks"] as? JsonObject)?.forEach { (k, v) ->
            val pub = v.jsonObject["pub"]?.jsonObject ?: return@forEach
            k.toIntOrNull()?.let { opks.add(OpkBody(it, json.encodeToString(JsonObject.serializer(), pub))) }
        }
        runCatching { api.putDevicePrekeys(PrekeyBundleBody(json.encodeToString(JsonObject.serializer(), spkPub), spkId, opks)) }
    }

    private suspend fun mdEncryptToDevice(me: String, sessionKey: String, b: DeviceBundleDto, text: String): V2? {
        val ikA = myIk() ?: return null
        if (b.spkPub.isBlank() || b.ik.isBlank()) return null
        val sKey = RatchetStore.stateKey(me, sessionKey)
        val ikKey = RatchetStore.peerIkKey(me, sessionKey)
        var state = ratchetStore.get(sKey)?.let { runCatching { ratchet.stateFromJson(it) }.getOrNull() }
        if (state != null) {
            val stored = ratchetStore.get(ikKey)
            val cur = ikFp(parseJwk(b.ik))
            if (stored != null && cur != null && stored != cur) { ratchetStore.remove(sKey); state = null }
        }
        if (state == null) {
            val ekA = genKp()
            val bundle = DoubleRatchet.PrekeyBundle(
                ik = json.parseToJsonElement(b.ik).jsonObject,
                spkPub = json.parseToJsonElement(b.spkPub).jsonObject,
                spkId = b.spkId,
                opkPub = b.opkPub?.let { json.parseToJsonElement(it).jsonObject },
                opkId = b.opkId,
            )
            val x = ratchet.x3dhInitiator(ikA, ekA, bundle)
            state = ratchet.initSender(x.sk, x.ad, bundle.spkPub)
            state.bootstrap = buildJsonObject {
                put("ek", ekA.pub); put("ik", ikA.pub)
                put("opk", b.opkId?.let { JsonPrimitive(it) } ?: JsonPrimitive(null as Int?))
                put("spk", JsonPrimitive(b.spkId))
            }
            ikFp(bundle.ik)?.let { ratchetStore.put(ikKey, it) }
        }
        val bs = if (!state.confirmed) state.bootstrap?.let {
            Bootstrap(it["ek"]!!.jsonObject, it["ik"]!!.jsonObject, it["opk"]?.jsonPrimitive?.intOrNull, it["spk"]!!.jsonPrimitive.int)
        } else null
        val msg = ratchet.encrypt(state, text, bs)
        ratchetStore.put(sKey, ratchet.stateToJson(state))
        return V2(msg.iv, msg.headerB64u + "." + msg.ct)
    }

    private fun selfKey(): SecretKey? {
        val ec = (state.pair?.private as? ECPrivateKey) ?: return null
        val raw = ec.s.toByteArray().let { b ->
            when {
                b.size == 32 -> b
                b.size == 33 && b[0] == 0.toByte() -> b.copyOfRange(1, 33)
                b.size < 32 -> ByteArray(32 - b.size) + b
                else -> b.copyOfRange(b.size - 32, b.size)
            }
        }
        return SecretKeySpec(crypto.hkdf(raw, "mindlog-self-sync-v1".toByteArray(), "self-sync".toByteArray(), 32), "AES")
    }

    private fun mdSelfEncrypt(text: String): V2? {
        val key = selfKey() ?: return null
        val blob = crypto.gcmEncrypt(key, text)
        return V2(blob.iv, "self:" + blob.ciphertext)
    }

    private fun mdSentKey(me: String, cmid: String) = "mdsent:${me.removePrefix("@")}:$cmid"

    private fun rememberFanoutSent(me: String, cmid: String, text: String) {
        val obj = buildJsonObject {
            put("text", JsonPrimitive(text))
            put("exp", JsonPrimitive(System.currentTimeMillis() + 25L * 3600 * 1000))
        }
        ratchetStore.put(mdSentKey(me, cmid), json.encodeToString(JsonObject.serializer(), obj))
    }

    private fun consumeOpk(preKey: String, pre: JsonObject, opkId: Int) {
        val opks = pre["opks"]?.jsonObject ?: return
        val rebuilt = buildJsonObject {
            pre.forEach { (k, v) ->
                if (k == "opks") put(k, buildJsonObject { opks.forEach { (ok, ov) -> if (ok != opkId.toString()) put(ok, ov) } })
                else put(k, v)
            }
        }
        ratchetStore.put(preKey, json.encodeToString(JsonObject.serializer(), rebuilt))
    }

    private companion object {
        const val OPK_TARGET = 30
        const val OPK_LOW = 8
    }
}
