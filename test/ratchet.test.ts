import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  type KeyPair,
  generateKeyPair,
  setKeyPairGenerator,
  x3dhInitiator,
  x3dhResponder,
  initSender,
  initReceiver,
  ratchetEncrypt,
  ratchetDecrypt,
  publicOf,
  safetyNumber,
  groupSenderInit,
  senderKeyDist,
  groupPeerFromDist,
  groupEncrypt,
  groupDecrypt,
  type GroupPeerState,
} from "../src/experimental/ratchet.js";

const VECTORS = join(dirname(fileURLToPath(import.meta.url)), "vectors", "ratchet.json");

interface Vectors {
  ikA: KeyPair;
  ikB: KeyPair;
  spkB: KeyPair;
  opkB: KeyPair;
  ekA: KeyPair;
  ratchetPool: KeyPair[]; // keypairs ratchet consommés en ordre (Alice puis Bob…)
  transcript: { from: "A" | "B"; text: string; headerB64u: string; iv: string; ct: string }[];
}

/** Charge des vecteurs figés, ou les génère (UPDATE_VECTORS=1) pour interop Android. */
async function loadOrCreateVectors(): Promise<Vectors> {
  if (existsSync(VECTORS) && !process.env.UPDATE_VECTORS) {
    return JSON.parse(readFileSync(VECTORS, "utf8")) as Vectors;
  }
  const [ikA, ikB, spkB, opkB, ekA] = await Promise.all([
    generateKeyPair(),
    generateKeyPair(),
    generateKeyPair(),
    generateKeyPair(),
    generateKeyPair(),
  ]);
  const ratchetPool: KeyPair[] = [];
  for (let i = 0; i < 8; i++) ratchetPool.push(await generateKeyPair());
  const v: Vectors = { ikA, ikB, spkB, opkB, ekA, ratchetPool, transcript: [] };
  // Le transcript est rempli par le test ci-dessous puis réécrit.
  return v;
}

function poolGenerator(pool: KeyPair[]): () => Promise<KeyPair> {
  let i = 0;
  return () => {
    if (i >= pool.length) throw new Error("pool de keypairs ratchet épuisé");
    return Promise.resolve(pool[i++]);
  };
}

test("Double Ratchet : échange bidirectionnel + génération des vecteurs", async () => {
  const v = await loadOrCreateVectors();
  setKeyPairGenerator(poolGenerator(v.ratchetPool));

  const bundle = { ik: v.ikB.pub, spkPub: v.spkB.pub, spkId: 1, opkPub: v.opkB.pub, opkId: 7 };
  const { sk: skA, ad: adA } = await x3dhInitiator(v.ikA, v.ekA, bundle);
  const { sk: skB, ad: adB } = await x3dhResponder(v.ikB, v.spkB, v.opkB, v.ikA.pub, v.ekA.pub);
  assert.deepEqual([...skA], [...skB], "X3DH : SK doit concorder");
  assert.deepEqual([...adA], [...adB], "X3DH : AD doit concorder");

  const alice = await initSender(skA, adA, v.spkB.pub);
  const bob = initReceiver(skB, adB, v.spkB);

  const bootstrap = { ek: v.ekA.pub, ik: v.ikA.pub, opk: 7, spk: 1 };
  const transcript: Vectors["transcript"] = [];

  const frozen = existsSync(VECTORS) && !process.env.UPDATE_VECTORS;
  const checkFrozen = (i: number, r: { headerB64u: string; iv: string; ct: string }) => {
    if (!frozen) return;
    // Non-régression + garantie d'interop : sorties identiques aux vecteurs figés
    // (Android rejoue le MÊME fichier et doit produire ces octets exacts).
    const exp = v.transcript[i];
    assert.equal(r.headerB64u, exp.headerB64u, `header msg #${i}`);
    assert.equal(r.iv, exp.iv, `iv msg #${i}`);
    assert.equal(r.ct, exp.ct, `ciphertext msg #${i}`);
  };

  const sendAtoB = async (text: string) => {
    const r = await ratchetEncrypt(alice, text, bootstrap);
    checkFrozen(transcript.length, r);
    transcript.push({ from: "A", text, headerB64u: r.headerB64u, iv: r.iv, ct: r.ct });
    const pt = await ratchetDecrypt(bob, r.headerB64u, r.iv, r.ct);
    assert.equal(pt, text, `A→B "${text}"`);
  };
  const sendBtoA = async (text: string) => {
    const r = await ratchetEncrypt(bob, text);
    checkFrozen(transcript.length, r);
    transcript.push({ from: "B", text, headerB64u: r.headerB64u, iv: r.iv, ct: r.ct });
    const pt = await ratchetDecrypt(alice, r.headerB64u, r.iv, r.ct);
    assert.equal(pt, text, `B→A "${text}"`);
  };

  await sendAtoB("salut 🦎");
  await sendAtoB("ça va ?");
  await sendBtoA("oui et toi ?"); // déclenche le DH ratchet côté Alice
  await sendAtoB("nickel");
  await sendBtoA("👍");

  if (!existsSync(VECTORS) || process.env.UPDATE_VECTORS) {
    mkdirSync(dirname(VECTORS), { recursive: true });
    writeFileSync(VECTORS, JSON.stringify({ ...v, transcript }, null, 2));
  }
  setKeyPairGenerator(null);
});

test("Double Ratchet : messages hors-ordre", async () => {
  const a = await generateKeyPair();
  const b = await generateKeyPair();
  const spk = await generateKeyPair();
  const ek = await generateKeyPair();
  const bundle = { ik: b.pub, spkPub: spk.pub, spkId: 1, opkPub: null, opkId: null };
  const { sk, ad } = await x3dhInitiator(a, ek, bundle);
  const { sk: sk2, ad: ad2 } = await x3dhResponder(b, spk, null, a.pub, ek.pub);
  assert.deepEqual([...sk], [...sk2]);
  const alice = await initSender(sk, ad, spk.pub);
  const bob = initReceiver(sk2, ad2, spk);

  const m0 = await ratchetEncrypt(alice, "zéro");
  const m1 = await ratchetEncrypt(alice, "un");
  const m2 = await ratchetEncrypt(alice, "deux");
  // Livraison 2, 0, 1
  assert.equal(await ratchetDecrypt(bob, m2.headerB64u, m2.iv, m2.ct), "deux");
  assert.equal(await ratchetDecrypt(bob, m0.headerB64u, m0.iv, m0.ct), "zéro");
  assert.equal(await ratchetDecrypt(bob, m1.headerB64u, m1.iv, m1.ct), "un");
  // Rejeu de m0 → null (clé sautée consommée)
  assert.equal(await ratchetDecrypt(bob, m0.headerB64u, m0.iv, m0.ct), null);
});

test("Double Ratchet : borne anti-DoS sur les clés sautées", async () => {
  const a = await generateKeyPair();
  const b = await generateKeyPair();
  const spk = await generateKeyPair();
  const ek = await generateKeyPair();
  const bundle = { ik: b.pub, spkPub: spk.pub, spkId: 1, opkPub: null, opkId: null };
  const { sk, ad } = await x3dhInitiator(a, ek, bundle);
  const { sk: sk2, ad: ad2 } = await x3dhResponder(b, spk, null, a.pub, ek.pub);
  const alice = await initSender(sk, ad, spk.pub);
  const bob = initReceiver(sk2, ad2, spk);

  // Avance Alice de très loin sans livrer → header.n énorme
  let last = await ratchetEncrypt(alice, "x");
  for (let i = 0; i < 1500; i++) last = await ratchetEncrypt(alice, "x");
  await assert.rejects(() => ratchetDecrypt(bob, last.headerB64u, last.iv, last.ct), /trop de clés/);
});

test("Double Ratchet : altération du header rejetée (AEAD)", async () => {
  const a = await generateKeyPair();
  const b = await generateKeyPair();
  const spk = await generateKeyPair();
  const ek = await generateKeyPair();
  const bundle = { ik: b.pub, spkPub: spk.pub, spkId: 1, opkPub: null, opkId: null };
  const { sk, ad } = await x3dhInitiator(a, ek, bundle);
  const { sk: sk2, ad: ad2 } = await x3dhResponder(b, spk, null, a.pub, ek.pub);
  const alice = await initSender(sk, ad, spk.pub);
  const bob = initReceiver(sk2, ad2, spk);

  const m = await ratchetEncrypt(alice, "secret");
  // Falsifie un octet du header encodé → l'AAD ne correspond plus.
  const tampered = m.headerB64u.slice(0, -1) + (m.headerB64u.endsWith("A") ? "B" : "A");
  const pt = await ratchetDecrypt(bob, tampered, m.iv, m.ct).catch(() => null);
  assert.equal(pt, null);
});

test("Numéro de sécurité : symétrique + figé dans les vecteurs (interop Android)", async () => {
  // Lit les clés DEPUIS le fichier (figées par le 1er test) pour rester cohérent.
  const raw = JSON.parse(readFileSync(VECTORS, "utf8")) as Vectors & {
    safety?: { handleA: string; handleB: string; sn: string };
  };
  const hA = "alice";
  const hB = "bob";
  const snAB = await safetyNumber(hA, raw.ikA.pub, hB, raw.ikB.pub);
  const snBA = await safetyNumber(hB, raw.ikB.pub, hA, raw.ikA.pub);
  assert.equal(snAB, snBA, "le numéro doit être identique des deux côtés");
  assert.match(snAB, /^\d{60}$/, "60 chiffres");

  if (!raw.safety || process.env.UPDATE_VECTORS) {
    raw.safety = { handleA: hA, handleB: hB, sn: snAB };
    writeFileSync(VECTORS, JSON.stringify(raw, null, 2));
  } else {
    assert.equal(snAB, raw.safety.sn, "numéro de sécurité figé (régression / interop)");
  }
});

test("Sender keys : roundtrip, hors-ordre, rejeu, anti-forge", async () => {
  const a = await groupSenderInit();
  const peerA = groupPeerFromDist(senderKeyDist(a));
  const m0 = await groupEncrypt(a, "salut le groupe 🦎");
  assert.equal(await groupDecrypt(structuredClone(peerA), m0), "salut le groupe 🦎");

  // Hors-ordre : produire m1,m2 puis livrer 2,0,1.
  const a2 = await groupSenderInit();
  const peer = groupPeerFromDist(senderKeyDist(a2));
  const g0 = await groupEncrypt(a2, "zéro");
  const g1 = await groupEncrypt(a2, "un");
  const g2 = await groupEncrypt(a2, "deux");
  assert.equal(await groupDecrypt(peer, g2), "deux");
  assert.equal(await groupDecrypt(peer, g0), "zéro");
  assert.equal(await groupDecrypt(peer, g1), "un");
  assert.equal(await groupDecrypt(peer, g0), null); // rejeu

  // Anti-forge : un autre membre ne peut pas signer à la place de a2.
  const b = await groupSenderInit();
  const forged = await groupEncrypt(b, "usurpation"); // signé par b
  const peerB = groupPeerFromDist(senderKeyDist(a2)); // mais on l'attribue à a2
  assert.equal(await groupDecrypt(peerB, forged), null); // signature invalide → rejeté
});

test("Sender keys : interop via vecteurs figés (déchiffrement + signature)", async () => {
  const raw = JSON.parse(readFileSync(VECTORS, "utf8")) as Vectors & {
    group?: { chainKey: string; sigPub: unknown; msgs: { iter: number; text: string; iv: string; ct: string; sig: string }[] };
  };
  if (!raw.group || process.env.UPDATE_VECTORS) {
    const s = await groupSenderInit();
    const chainKey0 = s.chainKey;
    const dist = senderKeyDist(s);
    const texts = ["bonjour", "deuxième", "troisième"];
    const msgs = [] as { iter: number; text: string; iv: string; ct: string; sig: string }[];
    for (const t of texts) {
      const m = await groupEncrypt(s, t);
      msgs.push({ iter: m.iter, text: t, iv: m.iv, ct: m.ct, sig: m.sig });
    }
    raw.group = { chainKey: chainKey0, sigPub: dist.sigPub, msgs };
    writeFileSync(VECTORS, JSON.stringify(raw, null, 2));
  }
  const g = raw.group;
  // Reconstruit l'état de réception depuis les vecteurs → déchiffre + vérifie la signature.
  const peer: GroupPeerState = { chainKey: g.chainKey, iter: 0, sigPub: g.sigPub as never, skipped: [] };
  for (const m of g.msgs) {
    const out = await groupDecrypt(peer, { iter: m.iter, iv: m.iv, ct: m.ct, sig: m.sig });
    assert.equal(out, m.text, `msg #${m.iter}`);
  }
});

void publicOf; // (utilisé indirectement via les states)
