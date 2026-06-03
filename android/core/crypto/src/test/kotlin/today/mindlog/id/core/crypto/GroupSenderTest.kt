package today.mindlog.id.core.crypto

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.File

/**
 * Interopérabilité « sender keys » de groupe web ↔ Android : rejoue les vecteurs
 * PARTAGÉS (test/vectors/ratchet.json, section `group`, générés par src/ratchet.ts)
 * et exige le déchiffrement byte-à-byte + la vérification de la signature ECDSA
 * P-256 (format P1363) produite côté WebCrypto. Plus un roundtrip/anti-forge local.
 */
class GroupSenderTest {

    private val crypto = E2eCrypto()
    private val gs = GroupSender(crypto)
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

    @Test
    fun replays_shared_group_vectors_with_signature() {
        val g = loadVectors()["group"]!!.jsonObject
        val peer = GroupPeerState(
            g["chainKey"]!!.jsonPrimitive.content,
            0,
            g["sigPub"]!!.jsonObject,
            mutableListOf(),
        )
        val msgs = g["msgs"] as JsonArray
        for (el in msgs) {
            val o = el.jsonObject
            val m = GroupMsg(
                o["iter"]!!.jsonPrimitive.int,
                o["iv"]!!.jsonPrimitive.content,
                o["ct"]!!.jsonPrimitive.content,
                o["sig"]!!.jsonPrimitive.content,
            )
            val pt = gs.decrypt(peer, m)
            assertEquals("message #${m.iter}", o["text"]!!.jsonPrimitive.content, pt)
        }
    }

    @Test
    fun local_roundtrip_out_of_order_and_anti_forge() {
        val sender = gs.init()
        val peer = gs.peerFromDist(gs.dist(sender))
        val m0 = gs.encrypt(sender, "zéro")
        val m1 = gs.encrypt(sender, "un")
        val m2 = gs.encrypt(sender, "deux")
        // Hors-ordre : m2 puis m0/m1 via clés sautées.
        assertEquals("deux", gs.decrypt(peer, m2))
        assertEquals("zéro", gs.decrypt(peer, m0))
        assertEquals("un", gs.decrypt(peer, m1))
        // Rejeu de m0 → null (clé sautée consommée).
        assertNull(gs.decrypt(peer, m0))

        // Anti-forge : un autre expéditeur signe → la signature ne valide pas chez `peer`.
        val attacker = gs.init()
        val forged = gs.encrypt(attacker, "faux")
        val tampered = GroupMsg(0, forged.iv, forged.ct, forged.sig)
        val peer2 = gs.peerFromDist(gs.dist(sender))
        assertNull("signature étrangère rejetée", gs.decrypt(peer2, tampered))
    }

    @Test
    fun sender_and_peer_state_survive_serialization() {
        val sender = gs.init()
        val peer = gs.peerFromDist(gs.dist(sender))
        val m = gs.encrypt(sender, "persisté")
        val sender2 = gs.senderFromJson(gs.senderToJson(sender))
        val peer2 = gs.peerFromJson(gs.peerToJson(peer))
        assertEquals("persisté", gs.decrypt(peer2, m))
        // L'état sender relu continue la chaîne.
        val m2 = gs.encrypt(sender2, "suite")
        assertNotNull(gs.decrypt(peer2, m2))
    }
}
