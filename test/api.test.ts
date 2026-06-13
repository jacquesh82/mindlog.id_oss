import { test, after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { closeDb, db, initDb } from "../src/db.js";
import { addRelation, createIdentity, getIdentityByHandle, setPubkey } from "../src/store.js";
import { createSession, SESSION_COOKIE } from "../src/session.js";
import { subscribe } from "../src/realtime.js";

// On importe l'app sans ouvrir de port d'écoute.
process.env.MINDLOG_NO_LISTEN = "1";

const ORIGIN = "http://localhost:8787";
// Rend la vérification d'Origin (anti-CSRF) déterministe quelle que soit la .env
// locale (ex. APP_URL=https://id.mindlog.localhost en dev) : appUrl() lit
// process.env au moment de la requête, donc cette affectation (après les imports
// qui chargent .env) fixe l'origine canonique attendue par les tests.
process.env.APP_URL = ORIGIN;
let app: { request: (path: string, init?: RequestInit) => Promise<Response> };

before(async () => {
  await initDb();
  app = (await import("../src/server.js")).app as typeof app;
});

after(async () => {
  await closeDb();
});

beforeEach(async () => {
  await db.execute(sql`DELETE FROM identities`);
});

/** Crée une identité de test et renvoie sa clé d'accès + son id. */
async function makeUser(handle: string) {
  await createIdentity(handle, handle);
  const id = await getIdentityByHandle(handle);
  if (!id) throw new Error("identité non créée");
  return id;
}

/* ----------------------------- En-têtes sécurité -------------------------- */

test("en-têtes de sécurité présents sur toutes les réponses", async () => {
  const res = await app.request("/");
  assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.equal(res.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
});

test("page /privacy publique (politique de confidentialité)", async () => {
  // /privacy est un alias 301 vers l'URL canonique française /confidentialite.
  const redir = await app.request("/privacy");
  assert.equal(redir.status, 301);
  assert.equal(redir.headers.get("location"), "/confidentialite");
  const res = await app.request("/confidentialite");
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Politique de confidentialité/i);
  assert.match(html, /milo@mindlog\.today/);
});

/* -------------------------------- Auth requise ---------------------------- */

test("GET /api/me sans auth → 401", async () => {
  const res = await app.request("/api/me");
  assert.equal(res.status, 401);
});

test("clé d'accès valide (X-Access-Key) → 200", async () => {
  const u = await makeUser("alice");
  const res = await app.request("/api/me", { headers: { "x-access-key": u.access_key } });
  assert.equal(res.status, 200);
});

/* ----------------------- Code PIN d'appairage ----------------------------- */

test("POST /api/auth/pin sans auth → 401", async () => {
  const res = await app.request("/api/auth/pin", { method: "POST" });
  assert.equal(res.status, 401);
});

test("code PIN : génération authentifiée puis échange → clé d'accès", async () => {
  const u = await makeUser("alice");
  const gen = await app.request("/api/auth/pin", {
    method: "POST",
    headers: { "x-access-key": u.access_key },
  });
  assert.equal(gen.status, 200);
  const { pin, expiresAt } = (await gen.json()) as { pin: string; expiresAt: string };
  assert.match(pin, /^\d{6}$/);
  assert.ok(new Date(expiresAt).getTime() > Date.now());

  const redeem = await app.request("/api/auth/redeem-pin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pin }),
  });
  assert.equal(redeem.status, 200);
  const out = (await redeem.json()) as { accessKey: string; handle: string };
  assert.equal(out.accessKey, u.access_key);
  assert.equal(out.handle, "alice");
});

test("code PIN : usage unique (second échange → 404)", async () => {
  const u = await makeUser("alice");
  const gen = await app.request("/api/auth/pin", { method: "POST", headers: { "x-access-key": u.access_key } });
  const { pin } = (await gen.json()) as { pin: string };
  const body = JSON.stringify({ pin });
  const headers = { "content-type": "application/json" };
  assert.equal((await app.request("/api/auth/redeem-pin", { method: "POST", headers, body })).status, 200);
  const second = await app.request("/api/auth/redeem-pin", { method: "POST", headers, body });
  assert.equal(second.status, 404);
});

test("code PIN : code inconnu → 404", async () => {
  const res = await app.request("/api/auth/redeem-pin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pin: "000000" }),
  });
  assert.equal(res.status, 404);
});

test("code PIN : un seul actif par identité (le nouveau invalide l'ancien)", async () => {
  const u = await makeUser("alice");
  const first = (await (await app.request("/api/auth/pin", { method: "POST", headers: { "x-access-key": u.access_key } })).json()) as { pin: string };
  const second = (await (await app.request("/api/auth/pin", { method: "POST", headers: { "x-access-key": u.access_key } })).json()) as { pin: string };
  assert.notEqual(first.pin, second.pin);
  const headers = { "content-type": "application/json" };
  const old = await app.request("/api/auth/redeem-pin", { method: "POST", headers, body: JSON.stringify({ pin: first.pin }) });
  assert.equal(old.status, 404);
  const fresh = await app.request("/api/auth/redeem-pin", { method: "POST", headers, body: JSON.stringify({ pin: second.pin }) });
  assert.equal(fresh.status, 200);
});

/* ------------------------------ CSRF (cookie) ----------------------------- */

test("mutation par cookie sans Origin/Referer → rejetée (401)", async () => {
  const u = await makeUser("bob");
  const { token } = await createSession(u.id);
  const res = await app.request("/api/card/field", {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
    body: JSON.stringify({ key: "bio", value: "x" }),
  });
  assert.equal(res.status, 401);
});

test("mutation par cookie avec Origin correct → acceptée (200)", async () => {
  const u = await makeUser("carol");
  const { token } = await createSession(u.id);
  const res = await app.request("/api/card/field", {
    method: "PUT",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie: `${SESSION_COOKIE}=${token}` },
    body: JSON.stringify({ key: "bio", value: "coucou" }),
  });
  assert.equal(res.status, 200);
});

test("clé d'accès n'est pas soumise à la vérification d'Origin", async () => {
  const u = await makeUser("dave");
  const res = await app.request("/api/card/field", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-access-key": u.access_key },
    body: JSON.stringify({ key: "bio", value: "via clé" }),
  });
  assert.equal(res.status, 200);
});

/* ------------------------- Validation de longueur ------------------------- */

test("champ de carte trop long → 400", async () => {
  const u = await makeUser("erin");
  const res = await app.request("/api/card/field", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-access-key": u.access_key },
    body: JSON.stringify({ key: "bio", value: "a".repeat(4001) }),
  });
  assert.equal(res.status, 400);
});

/* ----------------------------- Limite de corps ---------------------------- */

test("corps JSON > 256 Ko → 413", async () => {
  const u = await makeUser("frank");
  const big = "a".repeat(300 * 1024);
  const res = await app.request("/api/card/field", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-access-key": u.access_key },
    body: JSON.stringify({ key: "bio", value: big }),
  });
  assert.equal(res.status, 413);
});

/* --------------------- Signalisation d'appel P2P (WebRTC) ----------------- */

const sigHeaders = (key: string) => ({ "content-type": "application/json", "x-access-key": key });

test("POST /api/signal/:handle hors contact → 403", async () => {
  const alice = await makeUser("alice");
  await makeUser("bob");
  const res = await app.request("/api/signal/bob", {
    method: "POST",
    headers: sigHeaders(alice.access_key),
    body: JSON.stringify({ iv: "x", ciphertext: "y" }),
  });
  assert.equal(res.status, 403);
});

test("POST /api/signal/:handle payload invalide entre contacts → 400", async () => {
  const alice = await makeUser("alice");
  const bob = await makeUser("bob");
  await addRelation(alice.id, "bob");
  await addRelation(bob.id, "alice");
  const res = await app.request("/api/signal/bob", {
    method: "POST",
    headers: sigHeaders(alice.access_key),
    body: JSON.stringify({ iv: "x" }), // ciphertext manquant
  });
  assert.equal(res.status, 400);
});

test("POST /api/signal/:handle relaie le blob chiffré au pair (200 + SSE)", async () => {
  const alice = await makeUser("alice");
  const bob = await makeUser("bob");
  await addRelation(alice.id, "bob");
  await addRelation(bob.id, "alice");

  let received: { event: string; data: unknown } | null = null;
  const unsub = subscribe(bob.id, (event, data) => (received = { event, data }));

  const res = await app.request("/api/signal/bob", {
    method: "POST",
    headers: sigHeaders(alice.access_key),
    body: JSON.stringify({ iv: "aXY=", ciphertext: "Y2lwaGVy" }),
  });
  unsub();

  assert.equal(res.status, 200);
  assert.ok(received, "le pair doit recevoir l'événement");
  assert.equal(received.event, "signal");
  assert.equal((received.data as { from: string }).from, "alice");
  assert.equal((received.data as { ciphertext: string }).ciphertext, "Y2lwaGVy");
});

/* --------------------- Coffre de clé E2E (escrow chiffré) ----------------- */

test("GET /api/e2e/vault sans auth → 401", async () => {
  const res = await app.request("/api/e2e/vault");
  assert.equal(res.status, 401);
});

test("GET /api/e2e/vault vide → { vault: null }", async () => {
  const u = await makeUser("alice");
  const res = await app.request("/api/e2e/vault", { headers: { "x-access-key": u.access_key } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.vault, null);
  assert.equal(body.pin_fail_count, 0);
});

test("PUT puis GET /api/e2e/vault relit le blob à l'identique", async () => {
  const u = await makeUser("alice");
  const blob = JSON.stringify({ v: 1, pass: { salt: "c2VsdA==", iv: "aXY=", ct: "Y3Q=" } });
  const put = await app.request("/api/e2e/vault", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-access-key": u.access_key },
    body: JSON.stringify({ vault: blob }),
  });
  assert.equal(put.status, 200);
  const get = await app.request("/api/e2e/vault", { headers: { "x-access-key": u.access_key } });
  assert.equal((await get.json()).vault, blob);
});

test("PUT /api/e2e/vault trop gros → 400", async () => {
  const u = await makeUser("alice");
  const res = await app.request("/api/e2e/vault", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-access-key": u.access_key },
    body: JSON.stringify({ vault: "a".repeat(9000) }),
  });
  assert.equal(res.status, 400);
});

/* --------------------- Préférences (Options) & créneaux ------------------- */

const keyHeaders = (key: string) => ({ "content-type": "application/json", "x-access-key": key });

async function makeContacts(a: string, b: string) {
  const ua = await makeUser(a);
  const ub = await makeUser(b);
  await addRelation(ua.id, b);
  await addRelation(ub.id, a);
  return { ua, ub };
}

test("PATCH /api/me/settings persiste et n'accepte que les clés connues", async () => {
  const u = await makeUser("alice");
  const res = await app.request("/api/me/settings", {
    method: "PATCH",
    headers: keyHeaders(u.access_key),
    body: JSON.stringify({ allow_chat: false, bidon: 1, availability: { slot_minutes: 15 } }),
  });
  assert.equal(res.status, 200);
  const me = (await (await app.request("/api/me", { headers: { "x-access-key": u.access_key } })).json()) as {
    settings: { allow_chat: boolean; allow_call: boolean; bidon?: unknown; availability: { slot_minutes: number } };
  };
  assert.equal(me.settings.allow_chat, false);
  assert.equal(me.settings.allow_call, true);
  assert.equal(me.settings.availability.slot_minutes, 15);
  assert.equal(me.settings.bidon, undefined);
});

interface CardJson { options: { allowChat: boolean }; availability: { weekdays: boolean[] } | null; overrides: string[] }
interface SlotsJson { status: string; slotMinutes?: number; slots: unknown[] }

test("carte publique : options + availability exposées (masquées si privé)", async () => {
  const u = await makeUser("alice");
  let card = (await (await app.request("/api/identities/alice")).json()) as CardJson;
  assert.equal(card.options.allowChat, true);
  assert.ok(Array.isArray(card.availability?.weekdays));

  await app.request("/api/me/settings", {
    method: "PATCH",
    headers: keyHeaders(u.access_key),
    body: JSON.stringify({ public_availability: false }),
  });
  card = (await (await app.request("/api/identities/alice")).json()) as CardJson;
  assert.equal(card.availability, null);
  assert.deepEqual(card.overrides, []);
});

test("GET /slots : créneaux un jour libre, vide le week-end, masqué si privé", async () => {
  const u = await makeUser("alice");
  // 2026-06-03 = mercredi (libre par défaut), 2026-06-06 = samedi (occupé).
  const free = (await (await app.request("/api/identities/alice/slots?day=2026-06-03")).json()) as SlotsJson;
  assert.equal(free.status, "free");
  assert.equal(free.slotMinutes, 30);
  assert.ok(free.slots.length > 0);
  const we = (await (await app.request("/api/identities/alice/slots?day=2026-06-06")).json()) as SlotsJson;
  assert.equal(we.status, "busy");
  assert.equal(we.slots.length, 0);

  await app.request("/api/me/settings", {
    method: "PATCH",
    headers: keyHeaders(u.access_key),
    body: JSON.stringify({ public_availability: false }),
  });
  const priv = (await (await app.request("/api/identities/alice/slots?day=2026-06-03")).json()) as SlotsJson;
  assert.equal(priv.status, "private");
});

test("messages : les clés publiques émetteur/destinataire sont figées et renvoyées", async () => {
  const { ua, ub } = await makeContacts("alice", "bob");
  const post = await app.request("/api/messages/bob", {
    method: "POST",
    headers: keyHeaders(ua.access_key),
    body: JSON.stringify({
      iv: "aXY=",
      ciphertext: "Y2lwaGVy",
      senderPub: '{"alice":"pub"}',
      recipientPub: '{"bob":"pub"}',
    }),
  });
  assert.equal(post.status, 201);

  // Alice (émettrice) relit : sender_pub = sa clé, recipient_pub = celle de bob.
  const got = (await (
    await app.request("/api/messages/bob", { headers: keyHeaders(ua.access_key) })
  ).json()) as { messages: { sender_pub: string; recipient_pub: string }[] };
  assert.equal(got.messages.length, 1);
  assert.equal(got.messages[0].sender_pub, '{"alice":"pub"}');
  assert.equal(got.messages[0].recipient_pub, '{"bob":"pub"}');

  // Bob (destinataire) voit les mêmes clés figées (déchiffrera avec sa clé privée
  // + sender_pub d'alice), indépendamment de toute rotation ultérieure.
  const gotB = (await (
    await app.request("/api/messages/alice", { headers: keyHeaders(ub.access_key) })
  ).json()) as { messages: { sender_pub: string; recipient_pub: string }[] };
  assert.equal(gotB.messages[0].sender_pub, '{"alice":"pub"}');
  assert.equal(gotB.messages[0].recipient_pub, '{"bob":"pub"}');
});

test("messages : compat ascendante — clés publiques omises → chaînes vides", async () => {
  const { ua } = await makeContacts("carol", "dave");
  const post = await app.request("/api/messages/dave", {
    method: "POST",
    headers: keyHeaders(ua.access_key),
    body: JSON.stringify({ iv: "aXY=", ciphertext: "Y2lwaGVy" }),
  });
  assert.equal(post.status, 201);
  const got = (await (
    await app.request("/api/messages/dave", { headers: keyHeaders(ua.access_key) })
  ).json()) as { messages: { sender_pub: string; recipient_pub: string }[] };
  assert.equal(got.messages[0].sender_pub, "");
  assert.equal(got.messages[0].recipient_pub, "");
});

test("messagerie/appel/RDV refusés selon les préférences du destinataire", async () => {
  const { ua, ub } = await makeContacts("alice", "bob");
  // bob coupe tout
  await app.request("/api/me/settings", {
    method: "PATCH",
    headers: keyHeaders(ub.access_key),
    body: JSON.stringify({ allow_chat: false, allow_call: false, allow_requests: false }),
  });
  const msg = await app.request("/api/messages/bob", {
    method: "POST",
    headers: keyHeaders(ua.access_key),
    body: JSON.stringify({ iv: "aXY=", ciphertext: "Y2lwaGVy" }),
  });
  assert.equal(msg.status, 403);
  const sig = await app.request("/api/signal/bob", {
    method: "POST",
    headers: keyHeaders(ua.access_key),
    body: JSON.stringify({ iv: "aXY=", ciphertext: "Y2lwaGVy" }),
  });
  assert.equal(sig.status, 403);
  const rdv = await app.request("/api/identities/bob/requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Alice" }),
  });
  assert.equal(rdv.status, 403);
});

test("on ne peut pas se demander un RDV à soi-même → 400", async () => {
  const u = await makeUser("alice");
  const res = await app.request("/api/identities/alice/requests", {
    method: "POST",
    headers: keyHeaders(u.access_key),
    body: JSON.stringify({ name: "Moi" }),
  });
  assert.equal(res.status, 400);
});

/* ------------------------------- Rate limiting ---------------------------- */

test("rate-limit sur /api/recover (5 / 15 min) → 429 au 6e", async () => {
  const body = JSON.stringify({ handle: "inconnu", email: "x@y.z" });
  const headers = { "content-type": "application/json" };
  let last = 0;
  for (let i = 0; i < 6; i++) {
    last = (await app.request("/api/recover", { method: "POST", headers, body })).status;
  }
  assert.equal(last, 429);
});

/* ----------------------------- Prekeys X3DH ------------------------------- */

const bundleBody = (n: number) => ({
  spkPub: JSON.stringify({ kty: "EC", crv: "P-256", x: "spk-x", y: "spk-y" }),
  spkId: 1,
  opks: Array.from({ length: n }, (_, i) => ({ opkId: i + 1, opkPub: `opk-${i + 1}` })),
});

test("PUT /api/e2e/prekeys publie le bundle, GET count reflète le pool", async () => {
  const u = await makeUser("alice");
  const put = await app.request("/api/e2e/prekeys", {
    method: "PUT",
    headers: keyHeaders(u.access_key),
    body: JSON.stringify(bundleBody(5)),
  });
  assert.equal(put.status, 200);
  const count = await (await app.request("/api/e2e/prekeys/count", { headers: { "x-access-key": u.access_key } })).json();
  assert.equal((count as { available: number }).available, 5);
});

test("PUT /api/e2e/prekeys rejette une spk manquante → 400", async () => {
  const u = await makeUser("alice");
  const res = await app.request("/api/e2e/prekeys", {
    method: "PUT",
    headers: keyHeaders(u.access_key),
    body: JSON.stringify({ spkId: 1, opks: [] }),
  });
  assert.equal(res.status, 400);
});

test("GET /api/e2e/prekeys/:handle hors contact → 403", async () => {
  const alice = await makeUser("alice");
  await makeUser("bob");
  const res = await app.request("/api/e2e/prekeys/bob", { headers: { "x-access-key": alice.access_key } });
  assert.equal(res.status, 403);
});

test("GET /api/e2e/prekeys/:handle d'un contact sans bundle → 404", async () => {
  const { ua } = await makeContacts("alice", "bob");
  const res = await app.request("/api/e2e/prekeys/bob", { headers: { "x-access-key": ua.access_key } });
  assert.equal(res.status, 404);
});

test("GET /api/e2e/prekeys/:handle consomme exactement une OPK", async () => {
  const { ua, ub } = await makeContacts("alice", "bob");
  await setPubkey(ub.id, JSON.stringify({ kty: "EC", crv: "P-256", x: "ik-x", y: "ik-y" }));
  await app.request("/api/e2e/prekeys", {
    method: "PUT",
    headers: keyHeaders(ub.access_key),
    body: JSON.stringify(bundleBody(2)),
  });
  // 1er fetch par Alice → reçoit le bundle + une OPK ; pool 2 → 1.
  const r1 = (await (await app.request("/api/e2e/prekeys/bob", { headers: { "x-access-key": ua.access_key } })).json()) as {
    ik: string;
    spkPub: string;
    opkPub: string | null;
    opkId: number | null;
  };
  assert.ok(r1.ik && r1.spkPub);
  assert.ok(r1.opkPub && r1.opkId);
  const c1 = (await (await app.request("/api/e2e/prekeys/count", { headers: { "x-access-key": ub.access_key } })).json()) as { available: number };
  assert.equal(c1.available, 1);
  // 2e fetch → une autre OPK (id distinct) ; pool 1 → 0.
  const r2 = (await (await app.request("/api/e2e/prekeys/bob", { headers: { "x-access-key": ua.access_key } })).json()) as { opkId: number };
  assert.notEqual(r2.opkId, r1.opkId);
  // 3e fetch → pool vide → opkPub null, session quand même possible (dégradée).
  const r3 = (await (await app.request("/api/e2e/prekeys/bob", { headers: { "x-access-key": ua.access_key } })).json()) as { opkPub: string | null };
  assert.equal(r3.opkPub, null);
});

test("PUT /api/e2e/prekeys avec une nouvelle SPK purge les OPK périmées", async () => {
  // Régénération du store client (navigateur réinitialisé) : nouvelle SPK + OPK
  // réutilisant les mêmes opkId mais des clés publiques différentes. Le serveur
  // ne doit plus jamais servir une ancienne OPK (clé privée perdue côté client),
  // sinon le handshake X3DH échoue → « message illisible ».
  const { ua, ub } = await makeContacts("alice", "bob");
  await setPubkey(ub.id, JSON.stringify({ kty: "EC", crv: "P-256", x: "ik-x", y: "ik-y" }));
  const gen = (spk: string, tag: string, n: number) => ({
    spkPub: JSON.stringify({ kty: "EC", crv: "P-256", x: spk, y: spk }),
    spkId: 1,
    opks: Array.from({ length: n }, (_, i) => ({ opkId: i + 1, opkPub: `${tag}-${i + 1}` })),
  });
  // Génération 1 : OPK « old-* ».
  await app.request("/api/e2e/prekeys", {
    method: "PUT",
    headers: keyHeaders(ub.access_key),
    body: JSON.stringify(gen("spk-A", "old", 3)),
  });
  // Génération 2 : SPK différente → purge des « old-* », publie les « new-* ».
  await app.request("/api/e2e/prekeys", {
    method: "PUT",
    headers: keyHeaders(ub.access_key),
    body: JSON.stringify(gen("spk-B", "new", 3)),
  });
  const count = (await (await app.request("/api/e2e/prekeys/count", { headers: { "x-access-key": ub.access_key } })).json()) as { available: number };
  assert.equal(count.available, 3); // seules les OPK de la génération courante restent
  // Chaque OPK servie provient de la génération courante (« new-* »), jamais « old-* ».
  for (let i = 0; i < 3; i++) {
    const r = (await (await app.request("/api/e2e/prekeys/bob", { headers: { "x-access-key": ua.access_key } })).json()) as { opkPub: string | null };
    assert.ok(r.opkPub?.startsWith("new-"), `OPK servie périmée : ${r.opkPub}`);
  }
});

/* --------------------- Vérification d'identité (anti-MITM) --------------- */

const HASH = "a".repeat(64);

test("PUT/GET /api/e2e/verify entre contacts mémorise et relit le hash", async () => {
  const { ua } = await makeContacts("alice", "bob");
  const empty = await (await app.request("/api/e2e/verify/bob", { headers: { "x-access-key": ua.access_key } })).json();
  assert.equal((empty as { safety: string | null }).safety, null);
  const put = await app.request("/api/e2e/verify/bob", {
    method: "PUT",
    headers: keyHeaders(ua.access_key),
    body: JSON.stringify({ safety: HASH }),
  });
  assert.equal(put.status, 200);
  const got = (await (await app.request("/api/e2e/verify/bob", { headers: { "x-access-key": ua.access_key } })).json()) as {
    safety: string | null;
    verifiedAt: string | null;
  };
  assert.equal(got.safety, HASH);
  assert.ok(got.verifiedAt);
});

test("DELETE /api/e2e/verify retire la vérification", async () => {
  const { ua } = await makeContacts("alice", "bob");
  await app.request("/api/e2e/verify/bob", { method: "PUT", headers: keyHeaders(ua.access_key), body: JSON.stringify({ safety: HASH }) });
  await app.request("/api/e2e/verify/bob", { method: "DELETE", headers: { "x-access-key": ua.access_key } });
  const got = await (await app.request("/api/e2e/verify/bob", { headers: { "x-access-key": ua.access_key } })).json();
  assert.equal((got as { safety: string | null }).safety, null);
});

test("PUT /api/e2e/verify hash invalide → 400", async () => {
  const { ua } = await makeContacts("alice", "bob");
  const res = await app.request("/api/e2e/verify/bob", { method: "PUT", headers: keyHeaders(ua.access_key), body: JSON.stringify({ safety: "nope" }) });
  assert.equal(res.status, 400);
});

test("GET /api/e2e/verify hors contact → 403", async () => {
  const alice = await makeUser("alice");
  await makeUser("bob");
  const res = await app.request("/api/e2e/verify/bob", { headers: { "x-access-key": alice.access_key } });
  assert.equal(res.status, 403);
});

/* --------------------- Pièces jointes chiffrées éphémères --------------- */

function blobForm(bytes: Uint8Array): FormData {
  const fd = new FormData();
  fd.append("blob", new Blob([bytes], { type: "application/octet-stream" }), "a.bin");
  return fd;
}

test("POST/GET /api/attachments relaie un blob opaque entre contacts", async () => {
  const { ua } = await makeContacts("alice", "bob");
  const bytes = new Uint8Array([1, 2, 3, 4, 250, 99]);
  const up = await app.request("/api/attachments/bob", {
    method: "POST",
    headers: { "x-access-key": ua.access_key },
    body: blobForm(bytes),
  });
  assert.equal(up.status, 201);
  const { id } = (await up.json()) as { id: number };
  assert.ok(id > 0);
  // Le destinataire (bob) récupère le blob identique.
  const { ub } = { ub: await getIdentityByHandle("bob") };
  const dl = await app.request(`/api/attachments/alice/${id}`, { headers: { "x-access-key": ub!.access_key } });
  assert.equal(dl.status, 200);
  const got = new Uint8Array(await dl.arrayBuffer());
  assert.deepEqual([...got], [...bytes]);
});

test("GET /api/attachments d'une autre paire → 404", async () => {
  const { ua } = await makeContacts("alice", "bob");
  const carol = await makeUser("carol");
  await addRelation(ua.id, "carol");
  await addRelation(carol.id, "alice");
  const up = await app.request("/api/attachments/bob", {
    method: "POST",
    headers: { "x-access-key": ua.access_key },
    body: blobForm(new Uint8Array([9, 9])),
  });
  const { id } = (await up.json()) as { id: number };
  // carol (contact d'alice mais pas dans la paire alice:bob) ne peut pas lire.
  const dl = await app.request(`/api/attachments/alice/${id}`, { headers: { "x-access-key": carol.access_key } });
  assert.equal(dl.status, 404);
});

test("POST /api/attachments hors contact → 403", async () => {
  const alice = await makeUser("alice");
  await makeUser("bob");
  const res = await app.request("/api/attachments/bob", {
    method: "POST",
    headers: { "x-access-key": alice.access_key },
    body: blobForm(new Uint8Array([1])),
  });
  assert.equal(res.status, 403);
});

/* ----------------------- Minuterie de disparition ----------------------- */

async function postMsg(key: string, handle: string, ttl?: number) {
  return app.request(`/api/messages/${handle}`, {
    method: "POST",
    headers: keyHeaders(key),
    body: JSON.stringify({ iv: "aXY=", ciphertext: "Y2lwaGVy", ...(ttl !== undefined ? { ttl } : {}) }),
  });
}
async function lastExpiry(key: string, handle: string): Promise<number> {
  const d = (await (await app.request(`/api/messages/${handle}`, { headers: { "x-access-key": key } })).json()) as {
    messages: { expires_at: string }[];
  };
  return new Date(d.messages[d.messages.length - 1].expires_at).getTime();
}

test("POST /api/messages avec ttl court → expires_at ≈ now+ttl", async () => {
  const { ua } = await makeContacts("alice", "bob");
  assert.equal((await postMsg(ua.access_key, "bob", 300)).status, 201);
  const exp = await lastExpiry(ua.access_key, "bob");
  const delta = (exp - Date.now()) / 1000;
  assert.ok(delta > 250 && delta < 360, `attendu ~300s, obtenu ${delta}s`);
});

test("POST /api/messages sans ttl → 24h par défaut", async () => {
  const { ua } = await makeContacts("alice", "bob");
  await postMsg(ua.access_key, "bob");
  const delta = (await lastExpiry(ua.access_key, "bob") - Date.now()) / 1000;
  assert.ok(delta > 86000 && delta <= 86400, `attendu ~24h, obtenu ${delta}s`);
});

test("POST /api/messages ttl hors borne → clampé à 24h", async () => {
  const { ua } = await makeContacts("alice", "bob");
  await postMsg(ua.access_key, "bob", 999999);
  const delta = (await lastExpiry(ua.access_key, "bob") - Date.now()) / 1000;
  assert.ok(delta <= 86400, `attendu ≤24h, obtenu ${delta}s`);
});

/* ----------------------- Messages à lecture unique ---------------------- */

test("POST readOnce → read_once=1 renvoyé, puis burn par le destinataire supprime", async () => {
  const { ua, ub } = await makeContacts("alice", "bob");
  await app.request("/api/messages/bob", {
    method: "POST",
    headers: keyHeaders(ua.access_key),
    body: JSON.stringify({ iv: "aXY=", ciphertext: "Y2lwaGVy", readOnce: true }),
  });
  // Bob voit le message avec read_once=1.
  const got = (await (await app.request("/api/messages/alice", { headers: { "x-access-key": ub.access_key } })).json()) as {
    messages: { id: number; read_once: number }[];
  };
  const msg = got.messages[got.messages.length - 1];
  assert.equal(msg.read_once, 1);
  // Bob (destinataire) le brûle.
  const burn = await app.request(`/api/messages/alice/${msg.id}/burn`, { method: "POST", headers: { "x-access-key": ub.access_key } });
  assert.equal(burn.status, 200);
  const after = (await (await app.request("/api/messages/alice", { headers: { "x-access-key": ub.access_key } })).json()) as {
    messages: { id: number }[];
  };
  assert.ok(!after.messages.some((m) => m.id === msg.id), "le message brûlé doit avoir disparu");
});

test("burn par l'émetteur (pas le destinataire) → 404", async () => {
  const { ua, ub } = await makeContacts("alice", "bob");
  await app.request("/api/messages/bob", {
    method: "POST",
    headers: keyHeaders(ua.access_key),
    body: JSON.stringify({ iv: "aXY=", ciphertext: "Y2lwaGVy", readOnce: true }),
  });
  const got = (await (await app.request("/api/messages/alice", { headers: { "x-access-key": ub.access_key } })).json()) as {
    messages: { id: number }[];
  };
  const id = got.messages[got.messages.length - 1].id;
  // Alice (émettrice) ne peut pas brûler son propre message.
  const burn = await app.request(`/api/messages/bob/${id}/burn`, { method: "POST", headers: { "x-access-key": ua.access_key } });
  assert.equal(burn.status, 404);
});

test("burn d'un message NON lecture-unique → 404", async () => {
  const { ua, ub } = await makeContacts("alice", "bob");
  await postMsg(ua.access_key, "bob"); // message normal
  const got = (await (await app.request("/api/messages/alice", { headers: { "x-access-key": ub.access_key } })).json()) as {
    messages: { id: number }[];
  };
  const id = got.messages[got.messages.length - 1].id;
  const burn = await app.request(`/api/messages/alice/${id}/burn`, { method: "POST", headers: { "x-access-key": ub.access_key } });
  assert.equal(burn.status, 404);
});

/* ----------------- Contact sans annuaire (invitations) ------------------ */

import { areContacts } from "../src/store.js";

test("invitation : create → preview → accept crée des contacts mutuels (usage unique)", async () => {
  const alice = await makeUser("alice");
  const bob = await makeUser("bob");
  // Alice crée une invitation.
  const create = await app.request("/api/invites", { method: "POST", headers: keyHeaders(alice.access_key), body: "{}" });
  assert.equal(create.status, 201);
  const { token } = (await create.json()) as { token: string };
  assert.ok(token);
  // Aperçu public → handle d'Alice.
  const prev = (await (await app.request(`/api/invites/${token}`)).json()) as { handle: string };
  assert.equal(prev.handle, "alice");
  // Bob accepte → contacts mutuels.
  const acc = await app.request(`/api/invites/${token}/accept`, { method: "POST", headers: { "x-access-key": bob.access_key } });
  assert.equal(acc.status, 200);
  assert.equal(await areContacts(alice.id, bob.id), true);
  // 2e accept → 404 (usage unique) ; preview aussi invalide.
  const again = await app.request(`/api/invites/${token}/accept`, { method: "POST", headers: { "x-access-key": bob.access_key } });
  assert.equal(again.status, 404);
  assert.equal((await app.request(`/api/invites/${token}`)).status, 404);
});

test("invitation : accepter sa propre invitation → 400", async () => {
  const alice = await makeUser("alice");
  const { token } = (await (await app.request("/api/invites", { method: "POST", headers: keyHeaders(alice.access_key), body: "{}" })).json()) as { token: string };
  const acc = await app.request(`/api/invites/${token}/accept`, { method: "POST", headers: { "x-access-key": alice.access_key } });
  assert.equal(acc.status, 400);
});

test("invitation : preview jeton inconnu → 404", async () => {
  assert.equal((await app.request("/api/invites/nope")).status, 404);
});

/* --------------------------- Groupes (sender keys) ---------------------- */

async function makeTrio() {
  const a = await makeUser("alice");
  const b = await makeUser("bob");
  const c = await makeUser("carol");
  // alice ↔ bob, alice ↔ carol (contacts réciproques)
  await addRelation(a.id, "bob"); await addRelation(b.id, "alice");
  await addRelation(a.id, "carol"); await addRelation(c.id, "alice");
  return { a, b, c };
}

test("groupe : création (owner) + membres reçoivent + lecture/écriture", async () => {
  const { a, b, c } = await makeTrio();
  const create = await app.request("/api/groups", {
    method: "POST", headers: keyHeaders(a.access_key),
    body: JSON.stringify({ name: "Amis", members: ["bob", "carol"] }),
  });
  assert.equal(create.status, 201);
  const g = (await create.json()) as { id: string; owner: string; members: { handle: string; role: string }[] };
  assert.equal(g.members.length, 3);
  assert.equal(g.members.find((m) => m.handle === "alice")?.role, "owner");
  assert.equal(g.members.find((m) => m.handle === "bob")?.role, "member");
  assert.equal(g.owner, "alice");
  // bob voit le groupe
  const bobGroups = (await (await app.request("/api/groups", { headers: { "x-access-key": b.access_key } })).json()) as { groups: { id: string }[] };
  assert.ok(bobGroups.groups.some((x) => x.id === g.id));
  // bob envoie un message, carol le lit
  const send = await app.request(`/api/groups/${g.id}/messages`, {
    method: "POST", headers: keyHeaders(b.access_key), body: JSON.stringify({ iv: "aXY=", ciphertext: "Y2lwaGVy" }),
  });
  assert.equal(send.status, 201);
  const msgs = (await (await app.request(`/api/groups/${g.id}/messages`, { headers: { "x-access-key": c.access_key } })).json()) as { messages: { ciphertext: string }[] };
  assert.equal(msgs.messages.at(-1)?.ciphertext, "Y2lwaGVy");
});

test("groupe : non-membre refusé (403) + ajout/retrait owner-or-admin", async () => {
  const { a, b, c } = await makeTrio();
  const dave = await makeUser("dave");
  await addRelation(a.id, "dave"); await addRelation(dave.id, "alice");
  const g = (await (await app.request("/api/groups", { method: "POST", headers: keyHeaders(a.access_key), body: JSON.stringify({ name: "G", members: ["bob"] }) })).json()) as { id: string };
  // carol pas membre → lecture 403
  assert.equal((await app.request(`/api/groups/${g.id}/messages`, { headers: { "x-access-key": c.access_key } })).status, 403);
  // bob (membre simple) ne peut pas ajouter → 403
  assert.equal((await app.request(`/api/groups/${g.id}/members`, { method: "POST", headers: keyHeaders(b.access_key), body: JSON.stringify({ handle: "dave" }) })).status, 403);
  // alice (owner) ajoute dave → ok
  assert.equal((await app.request(`/api/groups/${g.id}/members`, { method: "POST", headers: keyHeaders(a.access_key), body: JSON.stringify({ handle: "dave" }) })).status, 200);
  assert.equal((await app.request(`/api/groups/${g.id}/messages`, { headers: { "x-access-key": dave.access_key } })).status, 200);
  // alice retire dave → ok
  assert.equal((await app.request(`/api/groups/${g.id}/members/dave`, { method: "DELETE", headers: { "x-access-key": a.access_key } })).status, 200);
  assert.equal((await app.request(`/api/groups/${g.id}/messages`, { headers: { "x-access-key": dave.access_key } })).status, 403);
});

test("groupe : création avec non-contact → 400", async () => {
  const a = await makeUser("alice");
  await makeUser("bob"); // pas contact
  const res = await app.request("/api/groups", { method: "POST", headers: keyHeaders(a.access_key), body: JSON.stringify({ name: "X", members: ["bob"] }) });
  assert.equal(res.status, 400);
});

test("groupe : owner promeut bob, bob (admin) ajoute carol", async () => {
  const { a, b, c } = await makeTrio();
  // Anti-spam : un admin ne peut ajouter qu'un de SES contacts réciproques.
  await addRelation(b.id, "carol"); await addRelation(c.id, "bob");
  const g = (await (await app.request("/api/groups", {
    method: "POST", headers: keyHeaders(a.access_key), body: JSON.stringify({ name: "G", members: ["bob"] }),
  })).json()) as { id: string };
  // bob simple membre → ne peut pas ajouter carol
  assert.equal((await app.request(`/api/groups/${g.id}/members`, { method: "POST", headers: keyHeaders(b.access_key), body: JSON.stringify({ handle: "carol" }) })).status, 403);
  // alice promeut bob
  assert.equal((await app.request(`/api/groups/${g.id}/promote`, { method: "POST", headers: keyHeaders(a.access_key), body: JSON.stringify({ handle: "bob" }) })).status, 200);
  // bob (admin, contact de carol) ajoute carol → ok
  assert.equal((await app.request(`/api/groups/${g.id}/members`, { method: "POST", headers: keyHeaders(b.access_key), body: JSON.stringify({ handle: "carol" }) })).status, 200);
  const detail = (await (await app.request(`/api/groups/${g.id}`, { headers: { "x-access-key": a.access_key } })).json()) as { members: { handle: string; role: string }[] };
  assert.equal(detail.members.find((m) => m.handle === "bob")?.role, "admin");
  assert.equal(detail.members.find((m) => m.handle === "carol")?.role, "member");
  // bob (admin) NE peut PAS promouvoir carol — réservé à l'owner
  assert.equal((await app.request(`/api/groups/${g.id}/promote`, { method: "POST", headers: keyHeaders(b.access_key), body: JSON.stringify({ handle: "carol" }) })).status, 403);
});

test("groupe : owner ne peut pas être retiré, ne peut pas quitter avec membres", async () => {
  const { a, b } = await makeTrio();
  const g = (await (await app.request("/api/groups", {
    method: "POST", headers: keyHeaders(a.access_key), body: JSON.stringify({ name: "G", members: ["bob"] }),
  })).json()) as { id: string };
  // alice promeut bob admin, bob tente de retirer l'owner alice → 400
  assert.equal((await app.request(`/api/groups/${g.id}/promote`, { method: "POST", headers: keyHeaders(a.access_key), body: JSON.stringify({ handle: "bob" }) })).status, 200);
  assert.equal((await app.request(`/api/groups/${g.id}/members/alice`, { method: "DELETE", headers: { "x-access-key": b.access_key } })).status, 400);
  // owner ne peut pas quitter avec d'autres membres
  assert.equal((await app.request(`/api/groups/${g.id}/leave`, { method: "POST", headers: keyHeaders(a.access_key), body: "{}" })).status, 400);
  // bob (admin) quitte → ok
  assert.equal((await app.request(`/api/groups/${g.id}/leave`, { method: "POST", headers: keyHeaders(b.access_key), body: "{}" })).status, 200);
  // owner seul peut maintenant quitter (le groupe est dissous)
  assert.equal((await app.request(`/api/groups/${g.id}/leave`, { method: "POST", headers: keyHeaders(a.access_key), body: "{}" })).status, 200);
  assert.equal((await app.request(`/api/groups/${g.id}`, { headers: { "x-access-key": a.access_key } })).status, 404);
});

test("groupe : transfer ownership change owner_id et rôles", async () => {
  const { a, b } = await makeTrio();
  const g = (await (await app.request("/api/groups", {
    method: "POST", headers: keyHeaders(a.access_key), body: JSON.stringify({ name: "G", members: ["bob"] }),
  })).json()) as { id: string };
  // alice transfère à bob
  assert.equal((await app.request(`/api/groups/${g.id}/transfer`, { method: "POST", headers: keyHeaders(a.access_key), body: JSON.stringify({ handle: "bob" }) })).status, 200);
  const detail = (await (await app.request(`/api/groups/${g.id}`, { headers: { "x-access-key": b.access_key } })).json()) as { owner: string; members: { handle: string; role: string }[]; role: string };
  assert.equal(detail.owner, "bob");
  assert.equal(detail.role, "owner");
  assert.equal(detail.members.find((m) => m.handle === "alice")?.role, "admin");
  assert.equal(detail.members.find((m) => m.handle === "bob")?.role, "owner");
  // alice (ex-owner, désormais admin) NE peut PAS retransférer
  assert.equal((await app.request(`/api/groups/${g.id}/transfer`, { method: "POST", headers: keyHeaders(a.access_key), body: JSON.stringify({ handle: "alice" }) })).status, 403);
});

test("groupe : renommage (admin+) journalisé dans events", async () => {
  const { a } = await makeTrio();
  const g = (await (await app.request("/api/groups", {
    method: "POST", headers: keyHeaders(a.access_key), body: JSON.stringify({ name: "Old", members: ["bob"] }),
  })).json()) as { id: string };
  assert.equal((await app.request(`/api/groups/${g.id}`, { method: "PATCH", headers: keyHeaders(a.access_key), body: JSON.stringify({ name: "New" }) })).status, 200);
  const detail = (await (await app.request(`/api/groups/${g.id}`, { headers: { "x-access-key": a.access_key } })).json()) as { name: string; events: { kind: string; payload: { oldName?: string; newName?: string } | null }[] };
  assert.equal(detail.name, "New");
  // la création + un join + le rename → events doit contenir le rename
  const rn = detail.events.find((e) => e.kind === "rename");
  assert.ok(rn);
  assert.equal(rn?.payload?.newName, "New");
});

/* -------------- Parité fonctionnelle chat 1:1 ↔ groupe ------------------- */

test("groupe : message avec ttl custom → expires_at ≈ now+ttl", async () => {
  const { a } = await makeTrio();
  const g = (await (await app.request("/api/groups", {
    method: "POST", headers: keyHeaders(a.access_key), body: JSON.stringify({ name: "G", members: ["bob"] }),
  })).json()) as { id: string };
  const before = Date.now();
  await app.request(`/api/groups/${g.id}/messages`, {
    method: "POST", headers: keyHeaders(a.access_key),
    body: JSON.stringify({ iv: "iv1", ciphertext: "ct1", ttl: 3600 }),
  });
  const after = Date.now();
  const msgs = (await (await app.request(`/api/groups/${g.id}/messages`, { headers: { "x-access-key": a.access_key } })).json()) as { messages: { expires_at: string }[] };
  const exp = new Date(msgs.messages.at(-1)!.expires_at).getTime();
  // borne raisonnable : exp doit être entre before+~1h et after+~1h.
  assert.ok(exp >= before + 3600 * 1000 - 1000 && exp <= after + 3600 * 1000 + 1000, `expires_at hors borne: ${exp - before}`);
});

test("groupe : delete message (sender seulement)", async () => {
  const { a, b } = await makeTrio();
  const g = (await (await app.request("/api/groups", {
    method: "POST", headers: keyHeaders(a.access_key), body: JSON.stringify({ name: "G", members: ["bob"] }),
  })).json()) as { id: string };
  await app.request(`/api/groups/${g.id}/messages`, {
    method: "POST", headers: keyHeaders(a.access_key), body: JSON.stringify({ iv: "iv1", ciphertext: "ct1" }),
  });
  const msgs = (await (await app.request(`/api/groups/${g.id}/messages`, { headers: { "x-access-key": a.access_key } })).json()) as { messages: { id: number }[] };
  const mid = msgs.messages.at(-1)!.id;
  // bob ne peut pas delete (pas l'auteur)
  assert.equal((await app.request(`/api/groups/${g.id}/messages/${mid}`, { method: "DELETE", headers: { "x-access-key": b.access_key } })).status, 404);
  // alice peut
  assert.equal((await app.request(`/api/groups/${g.id}/messages/${mid}`, { method: "DELETE", headers: { "x-access-key": a.access_key } })).status, 200);
});

test("groupe : burn message lecture-unique (réservé membres)", async () => {
  const { a, b, c } = await makeTrio();
  const g = (await (await app.request("/api/groups", {
    method: "POST", headers: keyHeaders(a.access_key), body: JSON.stringify({ name: "G", members: ["bob"] }),
  })).json()) as { id: string };
  await app.request(`/api/groups/${g.id}/messages`, {
    method: "POST", headers: keyHeaders(a.access_key),
    body: JSON.stringify({ iv: "iv2", ciphertext: "ct2", readOnce: true }),
  });
  const msgs = (await (await app.request(`/api/groups/${g.id}/messages`, { headers: { "x-access-key": b.access_key } })).json()) as { messages: { id: number; read_once: number }[] };
  const mid = msgs.messages.at(-1)!.id;
  assert.equal(msgs.messages.at(-1)!.read_once, 1);
  // carol (non-membre) → 403
  assert.equal((await app.request(`/api/groups/${g.id}/messages/${mid}/burn`, { method: "POST", headers: keyHeaders(c.access_key), body: "{}" })).status, 403);
  // bob (membre) peut brûler
  assert.equal((await app.request(`/api/groups/${g.id}/messages/${mid}/burn`, { method: "POST", headers: keyHeaders(b.access_key), body: "{}" })).status, 200);
  // message disparu
  const after = (await (await app.request(`/api/groups/${g.id}/messages`, { headers: { "x-access-key": a.access_key } })).json()) as { messages: { id: number }[] };
  assert.ok(!after.messages.some((m) => m.id === mid));
});

test("groupe : burn NE supprime PAS un message non-lecture-unique", async () => {
  const { a, b } = await makeTrio();
  const g = (await (await app.request("/api/groups", {
    method: "POST", headers: keyHeaders(a.access_key), body: JSON.stringify({ name: "G", members: ["bob"] }),
  })).json()) as { id: string };
  await app.request(`/api/groups/${g.id}/messages`, {
    method: "POST", headers: keyHeaders(a.access_key), body: JSON.stringify({ iv: "ivx", ciphertext: "ctx" }),
  });
  const msgs = (await (await app.request(`/api/groups/${g.id}/messages`, { headers: { "x-access-key": b.access_key } })).json()) as { messages: { id: number }[] };
  const mid = msgs.messages.at(-1)!.id;
  // burn d'un msg régulier (read_once=0) → 404 (rien à brûler)
  assert.equal((await app.request(`/api/groups/${g.id}/messages/${mid}/burn`, { method: "POST", headers: keyHeaders(b.access_key), body: "{}" })).status, 404);
});

test("groupe : réaction toggle (membres)", async () => {
  const { a, b, c } = await makeTrio();
  const g = (await (await app.request("/api/groups", {
    method: "POST", headers: keyHeaders(a.access_key), body: JSON.stringify({ name: "G", members: ["bob"] }),
  })).json()) as { id: string };
  await app.request(`/api/groups/${g.id}/messages`, {
    method: "POST", headers: keyHeaders(a.access_key), body: JSON.stringify({ iv: "ivr", ciphertext: "ctr" }),
  });
  const msgs = (await (await app.request(`/api/groups/${g.id}/messages`, { headers: { "x-access-key": b.access_key } })).json()) as { messages: { id: number }[] };
  const mid = msgs.messages.at(-1)!.id;
  // carol (non-membre) → 403
  assert.equal((await app.request(`/api/groups/${g.id}/messages/${mid}/react`, { method: "POST", headers: keyHeaders(c.access_key), body: JSON.stringify({ emoji: "👍" }) })).status, 403);
  // bob réagit → 200
  assert.equal((await app.request(`/api/groups/${g.id}/messages/${mid}/react`, { method: "POST", headers: keyHeaders(b.access_key), body: JSON.stringify({ emoji: "👍" }) })).status, 200);
  const after = (await (await app.request(`/api/groups/${g.id}/messages`, { headers: { "x-access-key": a.access_key } })).json()) as { messages: { id: number; reactions: { emoji: string; count: number }[] }[] };
  const m = after.messages.find((x) => x.id === mid)!;
  assert.equal(m.reactions.find((r) => r.emoji === "👍")?.count, 1);
});

test("groupe : pièce jointe upload + download (membres) + non-membre 403", async () => {
  const { a, b, c } = await makeTrio();
  const g = (await (await app.request("/api/groups", {
    method: "POST", headers: keyHeaders(a.access_key), body: JSON.stringify({ name: "G", members: ["bob"] }),
  })).json()) as { id: string };
  // Upload : carol (non-membre) → 403
  const fd403 = new FormData();
  fd403.append("blob", new Blob([new Uint8Array([1, 2, 3])], { type: "application/octet-stream" }), "a.bin");
  assert.equal((await app.request(`/api/groups/${g.id}/attachments`, { method: "POST", headers: { "x-access-key": c.access_key }, body: fd403 })).status, 403);
  // Alice (membre+owner) upload
  const fd = new FormData();
  const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
  fd.append("blob", new Blob([payload], { type: "application/octet-stream" }), "a.bin");
  const upRes = await app.request(`/api/groups/${g.id}/attachments`, { method: "POST", headers: { "x-access-key": a.access_key }, body: fd });
  assert.equal(upRes.status, 201);
  const { id: attId } = (await upRes.json()) as { id: number };
  // bob (membre) télécharge → 200 + bytes intacts
  const dl = await app.request(`/api/groups/${g.id}/attachments/${attId}`, { headers: { "x-access-key": b.access_key } });
  assert.equal(dl.status, 200);
  const buf = new Uint8Array(await dl.arrayBuffer());
  assert.deepEqual([...buf], [...payload]);
  // carol (non-membre) télécharge → 403
  assert.equal((await app.request(`/api/groups/${g.id}/attachments/${attId}`, { headers: { "x-access-key": c.access_key } })).status, 403);
});
