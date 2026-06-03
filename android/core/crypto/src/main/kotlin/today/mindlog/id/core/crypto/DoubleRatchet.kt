package today.mindlog.id.core.crypto

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import javax.inject.Inject
import javax.inject.Singleton

/** Une paire de clés ratchet au format JWK (objets `kotlinx` pour préserver l'ordre). */
data class KeyPairJwk(val priv: JsonObject, val pub: JsonObject)

/** Champs bootstrap X3DH joints aux premiers messages (jusqu'à réponse du pair). */
data class Bootstrap(val ek: JsonObject, val ik: JsonObject, val opk: Int?, val spk: Int)

/** Résultat d'un chiffrement v2 : header encodé b64url + IV b64 + ciphertext b64. */
data class RatchetMsg(val headerB64u: String, val iv: String, val ct: String)

/**
 * Double Ratchet + X3DH (forward secrecy) — portage byte-à-byte de src/ratchet.ts.
 * Primitives : ECDH P-256, HKDF-SHA256, HMAC-SHA256, AES-GCM-256, IV déterministe.
 * Sans état propre : l'état d'une conversation est porté par [RatchetState].
 *
 * Le générateur de keypairs ratchet est injectable ([keyGen]) afin de rejouer les
 * vecteurs partagés (test/vectors/ratchet.json) à l'identique du client web.
 */
@Singleton
class DoubleRatchet @Inject constructor(private val crypto: E2eCrypto) {

    private val json = Json { ignoreUnknownKeys = true }

    var keyGen: () -> KeyPairJwk = {
        val kp = crypto.generateKeyPair()
        KeyPairJwk(
            json.parseToJsonElement(crypto.privateJwk(kp)).jsonObject,
            json.parseToJsonElement(crypto.publicJwk(kp)).jsonObject,
        )
    }

    /* ------------------------------ constantes ---------------------------- */
    private val infoX3dh = "mindlog-x3dh-v1".toByteArray(Charsets.UTF_8)
    private val infoRk = "mindlog-ratchet-rk-v1".toByteArray(Charsets.UTF_8)
    private val infoMsg = "mindlog-msg-v1".toByteArray(Charsets.UTF_8)
    private val zero32 = ByteArray(32)
    private val ff32 = ByteArray(32) { 0xFF.toByte() }
    private val maxSkip = 1000
    private val maxSkippedStore = 2000

    /* -------------------------------- helpers ----------------------------- */
    private fun JsonObject.str(k: String) = (this[k] as JsonPrimitive).content
    private fun str(j: JsonObject) = json.encodeToString(JsonObject.serializer(), j)
    private fun publicOf(j: JsonObject): JsonObject = buildJsonObject {
        put("kty", JsonPrimitive("EC"))
        put("crv", JsonPrimitive("P-256"))
        put("x", JsonPrimitive(j.str("x")))
        put("y", JsonPrimitive(j.str("y")))
        put("ext", JsonPrimitive(true))
    }
    private fun ecdh(priv: JsonObject, pub: JsonObject) = crypto.rawEcdh(str(priv), str(pub))
    private fun rawPub(pub: JsonObject) = crypto.rawPub(str(pub))
    private fun cat(vararg arrs: ByteArray): ByteArray {
        val out = ByteArray(arrs.sumOf { it.size }); var off = 0
        for (a in arrs) { System.arraycopy(a, 0, out, off, a.size); off += a.size }
        return out
    }
    private fun eq(a: ByteArray, b: ByteArray): Boolean {
        if (a.size != b.size) return false
        var d = 0; for (i in a.indices) d = d or (a[i].toInt() xor b[i].toInt()); return d == 0
    }
    private fun slice(a: ByteArray, from: Int, to: Int) = a.copyOfRange(from, to)

    private fun kdfRk(rk: ByteArray, dh: ByteArray): Pair<ByteArray, ByteArray> {
        val o = crypto.hkdf(dh, rk, infoRk, 64); return slice(o, 0, 32) to slice(o, 32, 64)
    }
    private fun kdfCk(ck: ByteArray): Pair<ByteArray, ByteArray> =
        crypto.hmacSha256(ck, byteArrayOf(0x02)) to crypto.hmacSha256(ck, byteArrayOf(0x01))
    private fun kdfMk(mk: ByteArray): Pair<ByteArray, ByteArray> {
        val t = crypto.hkdf(mk, zero32, infoMsg, 44); return slice(t, 0, 32) to slice(t, 32, 44)
    }

    /* --------------------------------- X3DH ------------------------------- */
    data class X3dh(val sk: ByteArray, val ad: ByteArray)

    fun x3dhInitiator(ikA: KeyPairJwk, ekA: KeyPairJwk, bundle: PrekeyBundle): X3dh {
        val parts = mutableListOf(ff32, ecdh(ikA.priv, bundle.spkPub), ecdh(ekA.priv, bundle.ik), ecdh(ekA.priv, bundle.spkPub))
        bundle.opkPub?.let { parts.add(ecdh(ekA.priv, it)) }
        val sk = crypto.hkdf(cat(*parts.toTypedArray()), zero32, infoX3dh, 32)
        return X3dh(sk, cat(rawPub(ikA.pub), rawPub(bundle.ik)))
    }

    fun x3dhResponder(ikB: KeyPairJwk, spkB: KeyPairJwk, opkB: KeyPairJwk?, ikAPub: JsonObject, ekAPub: JsonObject): X3dh {
        val parts = mutableListOf(ff32, ecdh(spkB.priv, ikAPub), ecdh(ikB.priv, ekAPub), ecdh(spkB.priv, ekAPub))
        opkB?.let { parts.add(ecdh(it.priv, ekAPub)) }
        val sk = crypto.hkdf(cat(*parts.toTypedArray()), zero32, infoX3dh, 32)
        return X3dh(sk, cat(rawPub(ikAPub), rawPub(ikB.pub)))
    }

    /** Bundle de prekeys du destinataire (clés publiques + ids). */
    data class PrekeyBundle(val ik: JsonObject, val spkPub: JsonObject, val spkId: Int, val opkPub: JsonObject?, val opkId: Int?)

    /* ----------------------------- état ratchet --------------------------- */
    fun initSender(sk: ByteArray, ad: ByteArray, spkB: JsonObject): RatchetState {
        val dhs = keyGen()
        val (rk, ck) = kdfRk(sk, ecdh(dhs.priv, spkB))
        return RatchetState(
            rk = crypto.encodeB64(rk), dhsPriv = dhs.priv, dhsPub = dhs.pub, dhr = publicOf(spkB),
            cks = crypto.encodeB64(ck), ckr = null, ns = 0, nr = 0, pn = 0, ad = crypto.encodeB64(ad),
            skipped = mutableListOf(), confirmed = false,
        )
    }

    fun initReceiver(sk: ByteArray, ad: ByteArray, spkB: KeyPairJwk): RatchetState = RatchetState(
        rk = crypto.encodeB64(sk), dhsPriv = spkB.priv, dhsPub = publicOf(spkB.pub), dhr = null,
        cks = null, ckr = null, ns = 0, nr = 0, pn = 0, ad = crypto.encodeB64(ad),
        skipped = mutableListOf(), confirmed = true,
    )

    fun encrypt(state: RatchetState, plaintext: String, bootstrap: Bootstrap?): RatchetMsg {
        val cks = state.cks ?: error("chaîne d'envoi absente")
        val (ck, mk) = kdfCk(crypto.decodeB64(cks))
        state.cks = crypto.encodeB64(ck)
        val header = buildJsonObject {
            put("v", JsonPrimitive(2))
            put("dh", publicOf(state.dhsPub))
            put("pn", JsonPrimitive(state.pn))
            put("n", JsonPrimitive(state.ns))
            if (bootstrap != null) {
                put("ek", bootstrap.ek)
                put("ik", bootstrap.ik)
                put("opk", bootstrap.opk?.let { JsonPrimitive(it) } ?: JsonPrimitive(null as Int?))
                put("spk", JsonPrimitive(bootstrap.spk))
            }
        }
        state.ns += 1
        val headerB64u = crypto.encodeB64Url(str(header).toByteArray(Charsets.UTF_8))
        val (key, iv) = kdfMk(mk)
        val aad = cat(crypto.decodeB64(state.ad), headerB64u.toByteArray(Charsets.UTF_8))
        val ct = crypto.gcmEncryptRaw(key, iv, plaintext.toByteArray(Charsets.UTF_8), aad)
        return RatchetMsg(headerB64u, crypto.encodeB64(iv), crypto.encodeB64(ct))
    }

    private fun pushSkipped(state: RatchetState, dh: String, n: Int, mk: ByteArray) {
        state.skipped.add(Skipped(dh, n, crypto.encodeB64(mk)))
        while (state.skipped.size > maxSkippedStore) state.skipped.removeAt(0)
    }

    private fun trySkipped(state: RatchetState, header: JsonObject, iv: String, ct: String, aad: ByteArray): String? {
        val dh = crypto.encodeB64Url(rawPub(header["dh"]!!.jsonObject))
        val n = header["n"]!!.jsonPrimitive.int
        val idx = state.skipped.indexOfFirst { it.dh == dh && it.n == n }
        if (idx < 0) return null
        val (key, mkIv) = kdfMk(crypto.decodeB64(state.skipped[idx].mk))
        if (!eq(mkIv, crypto.decodeB64(iv))) return null
        return runCatching {
            val pt = crypto.gcmDecryptRaw(key, crypto.decodeB64(iv), crypto.decodeB64(ct), aad)
            state.skipped.removeAt(idx)
            String(pt, Charsets.UTF_8)
        }.getOrNull()
    }

    private fun skipMessageKeys(state: RatchetState, until: Int) {
        val ckr = state.ckr ?: return
        if (until - state.nr > maxSkip) error("trop de clés à sauter")
        val dhr = state.dhr ?: return
        val dh = crypto.encodeB64Url(rawPub(dhr))
        var cur = crypto.decodeB64(ckr)
        while (state.nr < until) {
            val (ck, mk) = kdfCk(cur)
            cur = ck
            pushSkipped(state, dh, state.nr, mk)
            state.nr += 1
        }
        state.ckr = crypto.encodeB64(cur)
    }

    private fun dhRatchet(state: RatchetState, header: JsonObject) {
        state.pn = state.ns; state.ns = 0; state.nr = 0
        state.dhr = publicOf(header["dh"]!!.jsonObject)
        var step = kdfRk(crypto.decodeB64(state.rk), ecdh(state.dhsPriv, state.dhr!!))
        state.rk = crypto.encodeB64(step.first); state.ckr = crypto.encodeB64(step.second)
        val ng = keyGen(); state.dhsPriv = ng.priv; state.dhsPub = ng.pub
        step = kdfRk(crypto.decodeB64(state.rk), ecdh(state.dhsPriv, state.dhr!!))
        state.rk = crypto.encodeB64(step.first); state.cks = crypto.encodeB64(step.second)
    }

    /** Déchiffre un message v2 ; renvoie le texte, ou null si rejeu / indéchiffrable. */
    fun decrypt(state: RatchetState, headerB64u: String, iv: String, ct: String): String? {
        val header = json.parseToJsonElement(String(crypto.decodeB64Url(headerB64u), Charsets.UTF_8)).jsonObject
        val aad = cat(crypto.decodeB64(state.ad), headerB64u.toByteArray(Charsets.UTF_8))
        trySkipped(state, header, iv, ct, aad)?.let { state.confirmed = true; return it }
        val headerDh = crypto.encodeB64Url(rawPub(header["dh"]!!.jsonObject))
        val curDhr = state.dhr?.let { crypto.encodeB64Url(rawPub(it)) }
        if (headerDh != curDhr) {
            skipMessageKeys(state, header["pn"]!!.jsonPrimitive.int)
            dhRatchet(state, header)
        }
        skipMessageKeys(state, header["n"]!!.jsonPrimitive.int)
        val ckr = state.ckr ?: return null
        val (ck, mk) = kdfCk(crypto.decodeB64(ckr))
        val (key, mkIv) = kdfMk(mk)
        if (!eq(mkIv, crypto.decodeB64(iv))) return null
        return runCatching {
            val pt = crypto.gcmDecryptRaw(key, crypto.decodeB64(iv), crypto.decodeB64(ct), aad)
            state.ckr = crypto.encodeB64(ck); state.nr += 1; state.confirmed = true
            String(pt, Charsets.UTF_8)
        }.getOrNull()
    }

    /* --------------------- (dé)sérialisation de l'état -------------------- */
    fun stateToJson(s: RatchetState): String = json.encodeToString(
        JsonObject.serializer(),
        buildJsonObject {
            put("rk", JsonPrimitive(s.rk))
            put("dhsPriv", s.dhsPriv)
            put("dhsPub", s.dhsPub)
            s.dhr?.let { put("dhr", it) }
            s.cks?.let { put("cks", JsonPrimitive(it)) }
            s.ckr?.let { put("ckr", JsonPrimitive(it)) }
            put("ns", JsonPrimitive(s.ns))
            put("nr", JsonPrimitive(s.nr))
            put("pn", JsonPrimitive(s.pn))
            put("ad", JsonPrimitive(s.ad))
            put("confirmed", JsonPrimitive(s.confirmed))
            put("skipped", buildJsonArray {
                s.skipped.forEach {
                    add(buildJsonObject {
                        put("dh", JsonPrimitive(it.dh)); put("n", JsonPrimitive(it.n)); put("mk", JsonPrimitive(it.mk))
                    })
                }
            })
            s.bootstrap?.let { put("bootstrap", it) }
        }
    )

    fun stateFromJson(raw: String): RatchetState {
        val o = json.parseToJsonElement(raw).jsonObject
        val skipped = (o["skipped"] as? JsonArray)?.map {
            val e = it.jsonObject
            Skipped(e.str("dh"), e["n"]!!.jsonPrimitive.int, e.str("mk"))
        }?.toMutableList() ?: mutableListOf()
        return RatchetState(
            rk = o.str("rk"), dhsPriv = o["dhsPriv"]!!.jsonObject, dhsPub = o["dhsPub"]!!.jsonObject,
            dhr = o["dhr"]?.jsonObject, cks = o["cks"]?.jsonPrimitive?.content, ckr = o["ckr"]?.jsonPrimitive?.content,
            ns = o["ns"]!!.jsonPrimitive.int, nr = o["nr"]!!.jsonPrimitive.int, pn = o["pn"]!!.jsonPrimitive.int,
            ad = o.str("ad"), skipped = skipped, confirmed = o["confirmed"]!!.jsonPrimitive.content.toBoolean(),
            bootstrap = o["bootstrap"]?.jsonObject,
        )
    }
}

/** Clé message sautée conservée (livraison hors-ordre). */
data class Skipped(val dh: String, val n: Int, val mk: String)

/**
 * État du ratchet pour UNE conversation (mutable, persisté par RatchetStore).
 * `bootstrap` : champs X3DH à rejouer côté initiateur tant que le pair n'a pas répondu.
 */
class RatchetState(
    var rk: String,
    var dhsPriv: JsonObject,
    var dhsPub: JsonObject,
    var dhr: JsonObject?,
    var cks: String?,
    var ckr: String?,
    var ns: Int,
    var nr: Int,
    var pn: Int,
    var ad: String,
    val skipped: MutableList<Skipped>,
    var confirmed: Boolean,
    var bootstrap: JsonObject? = null,
)
