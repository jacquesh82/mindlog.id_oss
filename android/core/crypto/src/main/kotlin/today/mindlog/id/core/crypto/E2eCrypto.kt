package today.mindlog.id.core.crypto

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.math.BigInteger
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.Signature
import java.util.Base64
import java.security.interfaces.ECPrivateKey
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPrivateKeySpec
import java.security.spec.ECPublicKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec
import javax.inject.Inject
import javax.inject.Singleton

/** Blob chiffré AES-GCM : IV et texte chiffré en base64 standard (comme btoa côté web). */
data class EncBlob(val iv: String, val ciphertext: String)

/**
 * Chiffrement de bout en bout strictement compatible avec le client web
 * (public/app.js) : clés ECDH P-256 échangées en JWK, dérivation directe du
 * secret partagé (coordonnée X, 32 o) en clé AES-GCM-256 — WebCrypto ne hache
 * PAS le secret ECDH lors d'un deriveKey vers AES-GCM, et la coordonnée fait
 * exactement 256 bits, donc Java interopère à l'identique.
 *
 * Classe sans état : toutes les opérations prennent leurs clés en paramètre.
 */
@Singleton
class E2eCrypto @Inject constructor() {

    private val json = Json { ignoreUnknownKeys = true }
    private val rng = SecureRandom()

    /* ------------------------------ Paires de clés ------------------------ */

    fun generateKeyPair(): KeyPair =
        KeyPairGenerator.getInstance("EC").apply {
            initialize(ECGenParameterSpec(CURVE))
        }.generateKeyPair()

    /** JWK publique `{kty,crv,x,y}` — JSON parsé par x/y, le format exact importe peu. */
    fun publicJwk(pair: KeyPair): String = publicJwkOf(pair.public as ECPublicKey)

    private fun publicJwkOf(pub: ECPublicKey): String {
        val obj = buildJsonObject {
            put("kty", JsonPrimitive("EC"))
            put("crv", JsonPrimitive("P-256"))
            put("x", JsonPrimitive(b64Url(fixed32(pub.w.affineX))))
            put("y", JsonPrimitive(b64Url(fixed32(pub.w.affineY))))
        }
        return json.encodeToString(JsonObject.serializer(), obj)
    }

    /** JWK privée complète `{kty,crv,d,x,y}` — persistée localement, jamais publiée. */
    fun privateJwk(pair: KeyPair): String {
        val priv = pair.private as ECPrivateKey
        val pub = pair.public as ECPublicKey
        val obj = buildJsonObject {
            put("kty", JsonPrimitive("EC"))
            put("crv", JsonPrimitive("P-256"))
            put("d", JsonPrimitive(b64Url(fixed32(priv.s))))
            put("x", JsonPrimitive(b64Url(fixed32(pub.w.affineX))))
            put("y", JsonPrimitive(b64Url(fixed32(pub.w.affineY))))
        }
        return json.encodeToString(JsonObject.serializer(), obj)
    }

    /** Reconstruit la paire depuis une JWK privée (restauration / chargement local). */
    fun keyPairFromPrivateJwk(jwkStr: String): KeyPair {
        val o = json.parseToJsonElement(jwkStr) as JsonObject
        val d = BigInteger(1, unb64Url(o.str("d")))
        val x = BigInteger(1, unb64Url(o.str("x")))
        val y = BigInteger(1, unb64Url(o.str("y")))
        val params = p256Params()
        val kf = KeyFactory.getInstance("EC")
        val priv = kf.generatePrivate(ECPrivateKeySpec(d, params))
        val pub = kf.generatePublic(ECPublicKeySpec(ECPoint(x, y), params))
        return KeyPair(pub, priv)
    }

    private fun publicKeyFromJwk(jwkStr: String): ECPublicKey {
        val o = json.parseToJsonElement(jwkStr) as JsonObject
        val x = BigInteger(1, unb64Url(o.str("x")))
        val y = BigInteger(1, unb64Url(o.str("y")))
        val kf = KeyFactory.getInstance("EC")
        return kf.generatePublic(ECPublicKeySpec(ECPoint(x, y), p256Params())) as ECPublicKey
    }

    /* --------------------------- Secret partagé --------------------------- */

    private fun sharedAesKey(myPrivate: KeyPair, peerPubJwk: String): SecretKey {
        val ka = KeyAgreement.getInstance("ECDH")
        ka.init(myPrivate.private)
        ka.doPhase(publicKeyFromJwk(peerPubJwk), true)
        return SecretKeySpec(ka.generateSecret(), "AES") // 32 o = AES-256
    }

    /* ----------------------------- Messages ------------------------------- */

    fun encrypt(myPair: KeyPair, peerPubJwk: String, text: String): EncBlob =
        gcmEncrypt(sharedAesKey(myPair, peerPubJwk), text)

    /** Renvoie null si le déchiffrement échoue (mauvaise clé, blob corrompu). */
    fun decrypt(myPair: KeyPair, peerPubJwk: String, ivB64: String, ctB64: String): String? =
        runCatching { gcmDecrypt(sharedAesKey(myPair, peerPubJwk), ivB64, ctB64) }.getOrNull()

    /* ------------------------------- Coffre ------------------------------- */
    // Dérive une clé AES-GCM depuis une passphrase (PBKDF2-SHA256, 600k iters)
    // pour (dé)chiffrer la JWK privée stockée dans le coffre serveur opaque.

    fun passphraseKey(passphrase: String, salt: ByteArray): SecretKey {
        val spec = PBEKeySpec(passphrase.toCharArray(), salt, 600_000, 256)
        val raw = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
        return SecretKeySpec(raw, "AES")
    }

    fun gcmEncrypt(key: SecretKey, plain: String): EncBlob {
        val iv = ByteArray(12).also(rng::nextBytes)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, iv))
        val ct = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return EncBlob(b64(iv), b64(ct))
    }

    fun gcmDecrypt(key: SecretKey, ivB64: String, ctB64: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, unb64(ivB64)))
        return String(cipher.doFinal(unb64(ctB64)), Charsets.UTF_8)
    }

    fun randomSalt(): ByteArray = ByteArray(16).also(rng::nextBytes)

    /** n octets aléatoires (clé/IV de pièce jointe). */
    fun randomBytes(n: Int): ByteArray = ByteArray(n).also(rng::nextBytes)

    /* ------------------ Signatures ECDSA P-256 (groupes) ------------------ */
    // Format P1363 (r||s brut, 64 o) pour interopérer avec WebCrypto (qui ne
    // produit/n'attend PAS du DER). Sert à authentifier les messages de groupe.
    private val SIG_ALG = "SHA256withECDSAinP1363Format"

    fun ecdsaSign(privJwk: String, data: ByteArray): ByteArray {
        val s = Signature.getInstance(SIG_ALG)
        s.initSign(keyPairFromPrivateJwk(privJwk).private)
        s.update(data)
        return s.sign()
    }

    fun ecdsaVerify(pubJwk: String, sig: ByteArray, data: ByteArray): Boolean = runCatching {
        val s = Signature.getInstance(SIG_ALG)
        s.initVerify(publicKeyFromJwk(pubJwk))
        s.update(data)
        s.verify(sig)
    }.getOrDefault(false)

    /* ------------------- Primitives Double Ratchet (v2) ------------------- */
    // Construites sur les mêmes briques que le web (WebCrypto) : secret ECDH brut
    // (coordonnée X 32 o), HKDF-SHA256, HMAC-SHA256, AES-GCM-256 avec AAD et IV
    // déterministe. Byte-à-byte identiques au portage TS (src/ratchet.ts).

    /** Secret ECDH brut (X, 32 o) entre ma JWK privée et la JWK publique du pair. */
    fun rawEcdh(privJwk: String, pubJwk: String): ByteArray {
        val kp = keyPairFromPrivateJwk(privJwk)
        val ka = KeyAgreement.getInstance("ECDH")
        ka.init(kp.private)
        ka.doPhase(publicKeyFromJwk(pubJwk), true)
        return ka.generateSecret()
    }

    fun hmacSha256(key: ByteArray, msg: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        return mac.doFinal(msg)
    }

    /** HKDF-SHA256 (RFC 5869), `salt` utilisé tel quel (32 o côté appelant). */
    fun hkdf(ikm: ByteArray, salt: ByteArray, info: ByteArray, len: Int): ByteArray {
        val prk = hmacSha256(salt, ikm) // extract
        val out = ByteArray(len)
        var t = ByteArray(0)
        var pos = 0
        var counter = 1
        while (pos < len) {
            t = hmacSha256(prk, t + info + byteArrayOf(counter.toByte())) // expand
            val n = minOf(t.size, len - pos)
            System.arraycopy(t, 0, out, pos, n)
            pos += n
            counter++
        }
        return out
    }

    /** AES-GCM-256 avec données associées (AAD) et IV déterministe fourni. */
    fun gcmEncryptRaw(key: ByteArray, iv: ByteArray, plain: ByteArray, aad: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        cipher.updateAAD(aad)
        return cipher.doFinal(plain)
    }

    fun gcmDecryptRaw(key: ByteArray, iv: ByteArray, ct: ByteArray, aad: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        cipher.updateAAD(aad)
        return cipher.doFinal(ct)
    }

    /** Coordonnées brutes x||y (64 o) d'une JWK publique — sert d'AD X3DH. */
    fun rawPub(pubJwk: String): ByteArray {
        val o = json.parseToJsonElement(pubJwk) as JsonObject
        return unb64Url(o.str("x")) + unb64Url(o.str("y"))
    }

    /* ---------------- Numéro de sécurité (vérification anti-MITM) ---------- */
    // Empreinte façon Signal dérivée des DEUX clés d'identité, byte-à-byte
    // identique au portage TS/web (src/ratchet.ts safetyNumber).

    fun sha512(b: ByteArray): ByteArray = MessageDigest.getInstance("SHA-512").digest(b)

    fun sha256Hex(s: String): String =
        MessageDigest.getInstance("SHA-256").digest(s.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    private fun userFingerprint(handle: String, ikRaw: ByteArray): String {
        var h = sha512(SN_VERSION + ikRaw + handle.toByteArray(Charsets.UTF_8))
        repeat(SN_ITER) { h = sha512(h + ikRaw) }
        val sb = StringBuilder(30)
        for (i in 0 until 6) {
            val o = i * 5
            var n = 0L
            for (j in 0 until 5) n = n * 256 + (h[o + j].toLong() and 0xFF)
            sb.append((n % 100000L).toString().padStart(5, '0'))
        }
        return sb.toString()
    }

    private fun cmpBytes(a: ByteArray, b: ByteArray): Int {
        val n = minOf(a.size, b.size)
        for (i in 0 until n) {
            val d = (a[i].toInt() and 0xFF) - (b[i].toInt() and 0xFF)
            if (d != 0) return d
        }
        return a.size - b.size
    }

    /** Numéro de sécurité combiné (60 chiffres) — identique pour les deux pairs. */
    fun safetyNumber(myHandle: String, myIkJwk: String, peerHandle: String, peerIkJwk: String): String {
        val myRaw = rawPub(myIkJwk)
        val peerRaw = rawPub(peerIkJwk)
        val mine = userFingerprint(myHandle, myRaw)
        val theirs = userFingerprint(peerHandle, peerRaw)
        return if (cmpBytes(myRaw, peerRaw) <= 0) mine + theirs else theirs + mine
    }

    // Codecs exposés pour le ratchet (mêmes formats que le web).
    fun encodeB64(b: ByteArray): String = b64(b)
    fun decodeB64(s: String): ByteArray = unb64(s)
    fun encodeB64Url(b: ByteArray): String = b64Url(b)
    fun decodeB64Url(s: String): ByteArray = unb64Url(s)

    /* ------------------------------- Helpers ------------------------------ */

    private fun JsonObject.str(k: String) = (this[k] as JsonPrimitive).content

    private fun p256Params(): ECParameterSpec {
        val ap = AlgorithmParameters.getInstance("EC")
        ap.init(ECGenParameterSpec(CURVE))
        return ap.getParameterSpec(ECParameterSpec::class.java)
    }

    /** Entier non signé sur exactement 32 octets, big-endian (coordonnées P-256). */
    private fun fixed32(v: BigInteger): ByteArray {
        val raw = v.toByteArray() // peut avoir un 0x00 de signe ou < 32 o
        val out = ByteArray(32)
        when {
            raw.size == 32 -> return raw
            raw.size > 32 -> System.arraycopy(raw, raw.size - 32, out, 0, 32) // retire le 0x00 de tête
            else -> System.arraycopy(raw, 0, out, 32 - raw.size, raw.size) // pad à gauche
        }
        return out
    }

    // base64 standard (avec padding) pour iv/ciphertext/salt — identique à btoa côté web.
    private fun b64(b: ByteArray): String = Base64.getEncoder().encodeToString(b)
    private fun unb64(s: String): ByteArray = Base64.getDecoder().decode(s)
    // base64url SANS padding pour les champs JWK (x/y/d) — format WebCrypto.
    private fun b64Url(b: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(b)
    private fun unb64Url(s: String): ByteArray = Base64.getUrlDecoder().decode(s)

    private companion object {
        const val CURVE = "secp256r1" // = P-256
        val SN_VERSION = byteArrayOf(0x00, 0x00)
        const val SN_ITER = 5200
    }
}
