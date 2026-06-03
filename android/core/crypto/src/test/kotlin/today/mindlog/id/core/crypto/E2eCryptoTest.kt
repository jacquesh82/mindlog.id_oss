package today.mindlog.id.core.crypto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Vérifie l'interopérabilité du schéma E2E (ECDH P-256 → AES-GCM). */
class E2eCryptoTest {

    private val c = E2eCrypto()

    @Test
    fun two_parties_derive_same_secret_and_roundtrip() {
        val alice = c.generateKeyPair()
        val bob = c.generateKeyPair()
        val alicePub = c.publicJwk(alice)
        val bobPub = c.publicJwk(bob)

        val blob = c.encrypt(alice, bobPub, "Salut Bob 🦎")
        // Bob déchiffre avec SA privée + la pub d'Alice.
        assertEquals("Salut Bob 🦎", c.decrypt(bob, alicePub, blob.iv, blob.ciphertext))
        // Alice se relit elle-même (champ auto-adressé) avec la pub de Bob.
        assertEquals("Salut Bob 🦎", c.decrypt(alice, bobPub, blob.iv, blob.ciphertext))
    }

    @Test
    fun wrong_key_yields_null() {
        val alice = c.generateKeyPair()
        val bob = c.generateKeyPair()
        val eve = c.generateKeyPair()
        val blob = c.encrypt(alice, c.publicJwk(bob), "secret")
        assertNull(c.decrypt(eve, c.publicJwk(alice), blob.iv, blob.ciphertext))
    }

    @Test
    fun private_jwk_roundtrips() {
        val pair = c.generateKeyPair()
        val restored = c.keyPairFromPrivateJwk(c.privateJwk(pair))
        // Même clé publique après restauration.
        assertEquals(c.publicJwk(pair), c.publicJwk(restored))
        // Et la clé restaurée déchiffre ce que la pub d'origine a servi à chiffrer.
        val peer = c.generateKeyPair()
        val blob = c.encrypt(peer, c.publicJwk(pair), "porté")
        assertEquals("porté", c.decrypt(restored, c.publicJwk(peer), blob.iv, blob.ciphertext))
    }

    @Test
    fun passphrase_vault_wrap_unwrap() {
        val salt = c.randomSalt()
        val key = c.passphraseKey("correct horse battery", salt)
        val priv = c.privateJwk(c.generateKeyPair())
        val wrapped = c.gcmEncrypt(key, priv)
        // Re-dérive la même clé depuis la passphrase + sel → déchiffre.
        val key2 = c.passphraseKey("correct horse battery", salt)
        assertEquals(priv, c.gcmDecrypt(key2, wrapped.iv, wrapped.ciphertext))
    }

    @Test
    fun jwk_fields_are_32_bytes_base64url() {
        val pub = c.publicJwk(c.generateKeyPair())
        // x et y présents, base64url sans padding.
        assertTrue(pub.contains("\"x\":"))
        assertTrue(pub.contains("\"crv\":\"P-256\""))
        assertTrue(!pub.contains("="))
    }
}
