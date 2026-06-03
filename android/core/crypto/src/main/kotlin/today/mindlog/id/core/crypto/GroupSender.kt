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

/** Mon état d'expéditeur de groupe (chaîne symétrique + clé de signature ECDSA). */
class GroupSenderState(var chainKey: String, var iter: Int, val sigPriv: JsonObject, val sigPub: JsonObject)

/** État de réception d'un membre (chaîne + clé publique de signature). */
class GroupPeerState(var chainKey: String, var iter: Int, val sigPub: JsonObject, val skipped: MutableList<GSkip>)

data class GSkip(val n: Int, val mk: String)

/** Message de groupe chiffré + signé. */
data class GroupMsg(val iter: Int, val iv: String, val ct: String, val sig: String)

/**
 * Chiffrement de groupe « sender keys » (megolm-like), miroir byte-à-byte de
 * src/ratchet.ts : chaîne symétrique (KDF_CK/KDF_MK via E2eCrypto) + signature
 * ECDSA P-256 (format P1363, interop WebCrypto). Sans état propre.
 */
@Singleton
class GroupSender @Inject constructor(private val crypto: E2eCrypto) {

    private val json = Json { ignoreUnknownKeys = true }
    private val infoMsg = "mindlog-msg-v1".toByteArray(Charsets.UTF_8)
    private val zero32 = ByteArray(32)
    private val maxSkip = 1000

    private fun str(j: JsonObject) = json.encodeToString(JsonObject.serializer(), j)
    private fun iterBytes(n: Int) = n.toString().toByteArray(Charsets.UTF_8)
    private fun cat(vararg a: ByteArray): ByteArray {
        val out = ByteArray(a.sumOf { it.size }); var o = 0; for (x in a) { System.arraycopy(x, 0, out, o, x.size); o += x.size }; return out
    }
    private fun eq(a: ByteArray, b: ByteArray): Boolean {
        if (a.size != b.size) return false; var d = 0; for (i in a.indices) d = d or (a[i].toInt() xor b[i].toInt()); return d == 0
    }
    // KDF_CK : (CK', MK) via HMAC-SHA256 (0x02 / 0x01).
    private fun kdfCk(ck: ByteArray) = crypto.hmacSha256(ck, byteArrayOf(0x02)) to crypto.hmacSha256(ck, byteArrayOf(0x01))
    // KDF_MK : (clé 32 o, IV 12 o) via HKDF-SHA256.
    private fun kdfMk(mk: ByteArray): Pair<ByteArray, ByteArray> {
        val t = crypto.hkdf(mk, zero32, infoMsg, 44); return t.copyOfRange(0, 32) to t.copyOfRange(32, 44)
    }
    private fun publicSig(j: JsonObject) = buildJsonObject {
        put("kty", JsonPrimitive("EC")); put("crv", JsonPrimitive("P-256"))
        put("x", j["x"]!!); put("y", j["y"]!!); put("ext", JsonPrimitive(true))
    }

    /** Crée mon état d'expéditeur (chaîne aléatoire + paire de signature ECDSA). */
    fun init(): GroupSenderState {
        val chain = crypto.randomBytes(32)
        val kp = crypto.generateKeyPair()
        val sigPriv = json.parseToJsonElement(crypto.privateJwk(kp)).jsonObject
        val sigPub = json.parseToJsonElement(crypto.publicJwk(kp)).jsonObject
        return GroupSenderState(crypto.encodeB64(chain), 0, sigPriv, sigPub)
    }

    /** SKDM : clé d'expéditeur à distribuer (partie publique + chaîne courante). */
    fun dist(s: GroupSenderState): JsonObject = buildJsonObject {
        put("chainKey", JsonPrimitive(s.chainKey)); put("iter", JsonPrimitive(s.iter)); put("sigPub", publicSig(s.sigPub))
    }
    fun peerFromDist(d: JsonObject): GroupPeerState =
        GroupPeerState(d["chainKey"]!!.jsonPrimitive.content, d["iter"]!!.jsonPrimitive.int, d["sigPub"]!!.jsonObject, mutableListOf())

    /** Chiffre + signe un message ; avance ma chaîne. */
    fun encrypt(s: GroupSenderState, plaintext: String): GroupMsg {
        val (ck, mk) = kdfCk(crypto.decodeB64(s.chainKey))
        val iter = s.iter
        s.chainKey = crypto.encodeB64(ck)
        s.iter += 1
        val (key, iv) = kdfMk(mk)
        val ct = crypto.gcmEncryptRaw(key, iv, plaintext.toByteArray(Charsets.UTF_8), iterBytes(iter))
        val sig = crypto.ecdsaSign(str(s.sigPriv), cat(iterBytes(iter), iv, ct))
        return GroupMsg(iter, crypto.encodeB64(iv), crypto.encodeB64(ct), crypto.encodeB64(sig))
    }

    /** Vérifie la signature puis déchiffre un message de groupe. */
    fun decrypt(p: GroupPeerState, m: GroupMsg): String? {
        val iv = crypto.decodeB64(m.iv); val ct = crypto.decodeB64(m.ct)
        if (!crypto.ecdsaVerify(str(p.sigPub), crypto.decodeB64(m.sig), cat(iterBytes(m.iter), iv, ct))) return null
        val idx = p.skipped.indexOfFirst { it.n == m.iter }
        if (idx >= 0) {
            val (key, mkIv) = kdfMk(crypto.decodeB64(p.skipped[idx].mk))
            if (!eq(mkIv, iv)) return null
            val pt = runCatching { crypto.gcmDecryptRaw(key, iv, ct, iterBytes(m.iter)) }.getOrNull() ?: return null
            p.skipped.removeAt(idx); return String(pt, Charsets.UTF_8)
        }
        if (m.iter < p.iter) return null
        if (m.iter - p.iter > maxSkip) return null
        var ck = crypto.decodeB64(p.chainKey)
        while (p.iter < m.iter) {
            val (nck, mk) = kdfCk(ck); ck = nck
            p.skipped.add(GSkip(p.iter, crypto.encodeB64(mk)))
            p.iter += 1
        }
        val (nextCk, mk) = kdfCk(ck)
        val (key, mkIv) = kdfMk(mk)
        if (!eq(mkIv, iv)) return null
        val pt = runCatching { crypto.gcmDecryptRaw(key, iv, ct, iterBytes(m.iter)) }.getOrNull() ?: return null
        p.chainKey = crypto.encodeB64(nextCk); p.iter = m.iter + 1
        return String(pt, Charsets.UTF_8)
    }

    /* --------------------- (dé)sérialisation des états -------------------- */
    fun senderToJson(s: GroupSenderState): String = json.encodeToString(
        JsonObject.serializer(),
        buildJsonObject {
            put("chainKey", JsonPrimitive(s.chainKey)); put("iter", JsonPrimitive(s.iter))
            put("sigPriv", s.sigPriv); put("sigPub", s.sigPub)
        },
    )
    fun senderFromJson(raw: String): GroupSenderState {
        val o = json.parseToJsonElement(raw).jsonObject
        return GroupSenderState(o["chainKey"]!!.jsonPrimitive.content, o["iter"]!!.jsonPrimitive.int, o["sigPriv"]!!.jsonObject, o["sigPub"]!!.jsonObject)
    }
    fun peerToJson(p: GroupPeerState): String = json.encodeToString(
        JsonObject.serializer(),
        buildJsonObject {
            put("chainKey", JsonPrimitive(p.chainKey)); put("iter", JsonPrimitive(p.iter)); put("sigPub", p.sigPub)
            put("skipped", buildJsonArray { p.skipped.forEach { add(buildJsonObject { put("n", JsonPrimitive(it.n)); put("mk", JsonPrimitive(it.mk)) }) } })
        },
    )
    fun peerFromJson(raw: String): GroupPeerState {
        val o = json.parseToJsonElement(raw).jsonObject
        val sk = (o["skipped"] as? JsonArray)?.map { val e = it.jsonObject; GSkip(e["n"]!!.jsonPrimitive.int, e["mk"]!!.jsonPrimitive.content) }?.toMutableList() ?: mutableListOf()
        return GroupPeerState(o["chainKey"]!!.jsonPrimitive.content, o["iter"]!!.jsonPrimitive.int, o["sigPub"]!!.jsonObject, sk)
    }
}
