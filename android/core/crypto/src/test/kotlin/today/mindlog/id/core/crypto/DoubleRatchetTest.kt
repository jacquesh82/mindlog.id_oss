package today.mindlog.id.core.crypto

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Interopérabilité Double Ratchet web ↔ Android : rejoue les vecteurs PARTAGÉS
 * (test/vectors/ratchet.json, générés par src/ratchet.ts) et exige des sorties
 * byte-à-byte identiques (headerB64u / iv / ciphertext). Garantit que les deux
 * implémentations produisent exactement le même protocole sur le réseau.
 */
class DoubleRatchetTest {

    private val crypto = E2eCrypto()
    private val ratchet = DoubleRatchet(crypto)
    private val json = Json { ignoreUnknownKeys = true }

    private fun loadVectors(): JsonObject {
        var dir: File? = File(System.getProperty("user.dir") ?: ".").absoluteFile
        while (dir != null) {
            val f = File(dir, "test/vectors/ratchet.json")
            if (f.exists()) return json.parseToJsonElement(f.readText()).jsonObject
            dir = dir.parentFile
        }
        error("test/vectors/ratchet.json introuvable (lancer `npm test` pour le générer)")
    }

    private fun kp(o: JsonObject) = KeyPairJwk(o["priv"]!!.jsonObject, o["pub"]!!.jsonObject)

    @Test
    fun replays_shared_vectors_byte_for_byte() {
        val v = loadVectors()
        val ikA = kp(v["ikA"]!!.jsonObject)
        val ikB = kp(v["ikB"]!!.jsonObject)
        val spkB = kp(v["spkB"]!!.jsonObject)
        val opkB = kp(v["opkB"]!!.jsonObject)
        val ekA = kp(v["ekA"]!!.jsonObject)
        val pool = (v["ratchetPool"] as JsonArray).map { kp(it.jsonObject) }
        val transcript = v["transcript"] as JsonArray

        // Générateur déterministe : file partagée consommée dans l'ordre des opérations.
        var idx = 0
        ratchet.keyGen = { pool[idx++] }

        val bundle = DoubleRatchet.PrekeyBundle(ikB.pub, spkB.pub, 1, opkB.pub, 7)
        val a = ratchet.x3dhInitiator(ikA, ekA, bundle)
        val b = ratchet.x3dhResponder(ikB, spkB, opkB, ikA.pub, ekA.pub)
        assertArrayEquals("X3DH SK", a.sk, b.sk)
        assertArrayEquals("X3DH AD", a.ad, b.ad)

        val alice = ratchet.initSender(a.sk, a.ad, spkB.pub)
        val bob = ratchet.initReceiver(b.sk, b.ad, spkB)
        val bootstrap = Bootstrap(ekA.pub, ikA.pub, 7, 1)

        fun expect(i: Int, r: RatchetMsg) {
            val e = transcript[i].jsonObject
            assertEquals("headerB64u #$i", e["headerB64u"]!!.jsonPrimitive.content, r.headerB64u)
            assertEquals("iv #$i", e["iv"]!!.jsonPrimitive.content, r.iv)
            assertEquals("ct #$i", e["ct"]!!.jsonPrimitive.content, r.ct)
        }
        fun textAt(i: Int) = transcript[i].jsonObject["text"]!!.jsonPrimitive.content

        // Même séquence que le test TS : A→B, A→B, B→A, A→B, B→A.
        var r = ratchet.encrypt(alice, textAt(0), bootstrap); expect(0, r)
        assertEquals(textAt(0), ratchet.decrypt(bob, r.headerB64u, r.iv, r.ct))
        r = ratchet.encrypt(alice, textAt(1), bootstrap); expect(1, r)
        assertEquals(textAt(1), ratchet.decrypt(bob, r.headerB64u, r.iv, r.ct))
        r = ratchet.encrypt(bob, textAt(2), null); expect(2, r)
        assertEquals(textAt(2), ratchet.decrypt(alice, r.headerB64u, r.iv, r.ct))
        r = ratchet.encrypt(alice, textAt(3), bootstrap); expect(3, r)
        assertEquals(textAt(3), ratchet.decrypt(bob, r.headerB64u, r.iv, r.ct))
        r = ratchet.encrypt(bob, textAt(4), null); expect(4, r)
        assertEquals(textAt(4), ratchet.decrypt(alice, r.headerB64u, r.iv, r.ct))
    }

    @Test
    fun out_of_order_and_replay() {
        val a = ratchet.run { keyGen() }
        // Session simple sans OPK, clés générées aléatoirement.
        ratchet.keyGen = {
            val kp = crypto.generateKeyPair()
            KeyPairJwk(
                json.parseToJsonElement(crypto.privateJwk(kp)).jsonObject,
                json.parseToJsonElement(crypto.publicJwk(kp)).jsonObject,
            )
        }
        val ikA = ratchet.keyGen(); val ikB = ratchet.keyGen(); val spk = ratchet.keyGen(); val ek = ratchet.keyGen()
        val bundle = DoubleRatchet.PrekeyBundle(ikB.pub, spk.pub, 1, null, null)
        val x = ratchet.x3dhInitiator(ikA, ek, bundle)
        val y = ratchet.x3dhResponder(ikB, spk, null, ikA.pub, ek.pub)
        assertArrayEquals(x.sk, y.sk)
        val alice = ratchet.initSender(x.sk, x.ad, spk.pub)
        val bob = ratchet.initReceiver(y.sk, y.ad, spk)
        val m0 = ratchet.encrypt(alice, "zéro", null)
        val m1 = ratchet.encrypt(alice, "un", null)
        val m2 = ratchet.encrypt(alice, "deux", null)
        assertEquals("deux", ratchet.decrypt(bob, m2.headerB64u, m2.iv, m2.ct))
        assertEquals("zéro", ratchet.decrypt(bob, m0.headerB64u, m0.iv, m0.ct))
        assertEquals("un", ratchet.decrypt(bob, m1.headerB64u, m1.iv, m1.ct))
        // Rejeu de m0 → null (clé sautée déjà consommée).
        assertNull(ratchet.decrypt(bob, m0.headerB64u, m0.iv, m0.ct))
        assertTrue(a.priv.containsKey("d")) // a généré une vraie clé
    }

    @Test
    fun safety_number_matches_shared_vector() {
        val v = loadVectors()
        val safety = v["safety"]!!.jsonObject
        val hA = safety["handleA"]!!.jsonPrimitive.content
        val hB = safety["handleB"]!!.jsonPrimitive.content
        val ikAPub = json.encodeToString(JsonObject.serializer(), v["ikA"]!!.jsonObject["pub"]!!.jsonObject)
        val ikBPub = json.encodeToString(JsonObject.serializer(), v["ikB"]!!.jsonObject["pub"]!!.jsonObject)
        val sn = crypto.safetyNumber(hA, ikAPub, hB, ikBPub)
        // Identique au numéro figé (généré côté TS) → interop garantie.
        assertEquals(safety["sn"]!!.jsonPrimitive.content, sn)
        // Symétrique : l'autre pair calcule le même numéro.
        assertEquals(sn, crypto.safetyNumber(hB, ikBPub, hA, ikAPub))
    }

    @Test
    fun state_survives_serialization() {
        ratchet.keyGen = {
            val kp = crypto.generateKeyPair()
            KeyPairJwk(
                json.parseToJsonElement(crypto.privateJwk(kp)).jsonObject,
                json.parseToJsonElement(crypto.publicJwk(kp)).jsonObject,
            )
        }
        val ikA = ratchet.keyGen(); val ikB = ratchet.keyGen(); val spk = ratchet.keyGen(); val ek = ratchet.keyGen()
        val bundle = DoubleRatchet.PrekeyBundle(ikB.pub, spk.pub, 1, null, null)
        val x = ratchet.x3dhInitiator(ikA, ek, bundle)
        val y = ratchet.x3dhResponder(ikB, spk, null, ikA.pub, ek.pub)
        val alice = ratchet.initSender(x.sk, x.ad, spk.pub)
        val bob = ratchet.initReceiver(y.sk, y.ad, spk)
        val m = ratchet.encrypt(alice, "persisté", null)
        // Sérialise/relit l'état de Bob avant de déchiffrer → doit fonctionner.
        val bob2 = ratchet.stateFromJson(ratchet.stateToJson(bob))
        assertEquals("persisté", ratchet.decrypt(bob2, m.headerB64u, m.iv, m.ct))
    }
}
