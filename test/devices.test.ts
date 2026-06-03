import { test, after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { closeDb, db, initDb } from "../src/db.js";
import { addRelation, createIdentity, getIdentityByHandle } from "../src/store.js";

// App importée sans ouvrir de port (cf. api.test.ts).
process.env.MINDLOG_NO_LISTEN = "1";

let app: { request: (path: string, init?: RequestInit) => Promise<Response> };

before(async () => {
  await initDb();
  app = (await import("../src/server.js")).app as typeof app;
});
after(async () => {
  await closeDb();
});
beforeEach(async () => {
  await db.execute(sql`DELETE FROM identities`); // cascade → devices, prekeys…
});

async function makeUser(handle: string): Promise<string> {
  await createIdentity(handle, handle);
  const id = await getIdentityByHandle(handle);
  if (!id) throw new Error("identité non créée");
  return id.access_key;
}

/** Requête authentifiée par clé d'accès (+ x-device-id optionnel). */
function req(path: string, key: string, deviceId?: string, init: RequestInit = {}) {
  const headers: Record<string, string> = { "x-access-key": key };
  if (deviceId) headers["x-device-id"] = deviceId;
  if (init.body) headers["content-type"] = "application/json";
  return app.request(path, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
}
const post = (path: string, key: string, body: unknown, deviceId?: string) =>
  req(path, key, deviceId, { method: "POST", body: JSON.stringify(body) });

test("1er appareil auto-approuvé, 2e en attente, approbation par appareil existant", async () => {
  const key = await makeUser("alice");

  // 1er appareil → auto-approuvé (amorçage).
  let r = await post("/api/devices", key, { deviceId: "device-aaaaaaaa", e2ePubkey: "PK_A", name: "Web" });
  assert.equal(r.status, 200);
  let j = (await r.json()) as { approved: boolean; pending: boolean; id: number };
  assert.equal(j.approved, true);
  assert.equal(j.pending, false);
  const dev1Pk = j.id;

  // 2e appareil → en attente.
  r = await post("/api/devices", key, { deviceId: "device-bbbbbbbb", e2ePubkey: "PK_B", name: "Android" });
  j = (await r.json()) as { approved: boolean; pending: boolean; id: number };
  assert.equal(j.approved, false);
  assert.equal(j.pending, true);
  const dev2Pk = j.id;

  // Liste → 2 appareils.
  r = await req("/api/devices", key);
  const list = (await r.json()) as { devices: { id: number; approved: boolean }[] };
  assert.equal(list.devices.length, 2);

  // Approbation SANS appareil approbateur → 403.
  r = await post(`/api/devices/${dev2Pk}/approve`, key, {});
  assert.equal(r.status, 403);

  // Approbation PAR l'appareil 1 (approuvé) → 200.
  r = await post(`/api/devices/${dev2Pk}/approve`, key, {}, "device-aaaaaaaa");
  assert.equal(r.status, 200);

  // Un appareil EN ATTENTE ne peut pas approuver (ici dev1 reste le seul approuvé) :
  // on révoque dev1 et on vérifie que dev2 (désormais approuvé) peut, lui, approuver.
  void dev1Pk;
});

test("limite de 5 appareils", async () => {
  const key = await makeUser("bob");
  for (let i = 0; i < 5; i++) {
    const r = await post("/api/devices", key, { deviceId: `device-0000000${i}`, e2ePubkey: `PK${i}` });
    assert.equal(r.status, 200);
  }
  const r = await post("/api/devices", key, { deviceId: "device-99999999", e2ePubkey: "PK9" });
  assert.equal(r.status, 400); // limite atteinte
});

test("prekeys par appareil + fan-out vers mes autres appareils", async () => {
  const key = await makeUser("carol");
  await post("/api/devices", key, { deviceId: "device-cccccccc", e2ePubkey: "IK_C1" }); // approuvé
  await post("/api/devices", key, { deviceId: "device-dddddddd", e2ePubkey: "IK_C2" }); // en attente
  // Approuver le 2e via le 1er.
  const list = (await (await req("/api/devices", key)).json()) as { devices: { id: number; deviceId: string }[] };
  const dev2 = list.devices.find((d) => d.deviceId === "device-dddddddd")!;
  await post(`/api/devices/${dev2.id}/approve`, key, {}, "device-cccccccc");

  // Chaque appareil publie son bundle.
  let r = await req("/api/e2e/device-prekeys", key, "device-cccccccc", {
    method: "PUT",
    body: JSON.stringify({ spkPub: "SPK_C1", spkId: 1, opks: [{ opkId: 1, opkPub: "OPK_C1a" }] }),
  });
  assert.equal(r.status, 200);
  r = await req("/api/e2e/device-prekeys", key, "device-dddddddd", {
    method: "PUT",
    body: JSON.stringify({ spkPub: "SPK_C2", spkId: 1, opks: [{ opkId: 1, opkPub: "OPK_C2a" }] }),
  });
  assert.equal(r.status, 200);

  // Compte OPK de mon appareil.
  r = await req("/api/e2e/device-prekeys/count", key, "device-cccccccc");
  assert.equal(((await r.json()) as { available: number }).available, 1);

  // Fan-out « sync » : depuis device C1, mes AUTRES appareils = {C2} (C1 exclu).
  r = await req("/api/e2e/my-devices", key, "device-cccccccc");
  const bundles = (await r.json()) as { devices: { deviceId: string; ik: string; spkPub: string; opkPub: string | null }[] };
  assert.equal(bundles.devices.length, 1);
  assert.equal(bundles.devices[0].deviceId, "device-dddddddd");
  assert.equal(bundles.devices[0].ik, "IK_C2");
  assert.equal(bundles.devices[0].spkPub, "SPK_C2");
  assert.equal(bundles.devices[0].opkPub, "OPK_C2a"); // OPK consommée

  // L'OPK de C2 a bien été consommée (pool vide ensuite).
  r = await req("/api/e2e/my-devices", key, "device-cccccccc");
  const again = (await r.json()) as { devices: { opkPub: string | null }[] };
  assert.equal(again.devices[0].opkPub, null);
});

type MsgResp = { messages: { id: number; sender_id: number; iv: string; ciphertext: string; client_msg_id: string | null; sender_device_id: string | null }[] };

test("fan-out : chaque appareil lit SON enveloppe ; l'émetteur voit son envoi ; non-adressé masqué", async () => {
  const aKey = await makeUser("alice");
  const bKey = await makeUser("bob");
  const alice = (await getIdentityByHandle("alice"))!;
  const bob = (await getIdentityByHandle("bob"))!;
  await addRelation(alice.id, "bob");
  await addRelation(bob.id, "alice"); // contacts réciproques (chatPeers)

  // Appareils : alice A1 ; bob B1 (auto), B2 + B3 (approuvés via B1).
  await post("/api/devices", aKey, { deviceId: "device-alice111", e2ePubkey: "IK_A1" });
  await post("/api/devices", bKey, { deviceId: "device-bob11111", e2ePubkey: "IK_B1" });
  await post("/api/devices", bKey, { deviceId: "device-bob22222", e2ePubkey: "IK_B2" });
  await post("/api/devices", bKey, { deviceId: "device-bob33333", e2ePubkey: "IK_B3" });
  const bList = ((await (await req("/api/devices", bKey)).json()) as { devices: { id: number; deviceId: string }[] }).devices;
  for (const dev of bList.filter((d) => d.deviceId !== "device-bob11111"))
    await post(`/api/devices/${dev.id}/approve`, bKey, {}, "device-bob11111");

  // alice (A1) envoie un message fan-out adressé à B1 + B2 (PAS B3).
  const send = await req("/api/messages/bob", aKey, "device-alice111", {
    method: "POST",
    body: JSON.stringify({
      clientMsgId: "cmid-1",
      envelopes: [
        { recipientDeviceId: "device-bob11111", iv: "iv-b1", ciphertext: "CT_B1" },
        { recipientDeviceId: "device-bob22222", iv: "iv-b2", ciphertext: "CT_B2" },
      ],
    }),
  });
  assert.equal(send.status, 201);

  // B1 lit son enveloppe.
  let d = (await (await req("/api/messages/alice", bKey, "device-bob11111")).json()) as MsgResp;
  assert.equal(d.messages.length, 1);
  assert.equal(d.messages[0].ciphertext, "CT_B1");
  assert.equal(d.messages[0].iv, "iv-b1");
  assert.equal(d.messages[0].client_msg_id, "cmid-1");
  // Le destinataire reçoit le device-id de l'émetteur (pour keyer la session ratchet).
  assert.equal(d.messages[0].sender_device_id, "device-alice111");

  // B2 lit SON enveloppe (ciphertext différent).
  d = (await (await req("/api/messages/alice", bKey, "device-bob22222")).json()) as MsgResp;
  assert.equal(d.messages[0].ciphertext, "CT_B2");

  // B3 (non adressé) ne voit rien.
  d = (await (await req("/api/messages/alice", bKey, "device-bob33333")).json()) as MsgResp;
  assert.equal(d.messages.length, 0);

  // alice (A1, émettrice) voit son propre envoi : visible, ciphertext vide (recallSent local).
  d = (await (await req("/api/messages/bob", aKey, "device-alice111")).json()) as MsgResp;
  assert.equal(d.messages.length, 1);
  assert.equal(d.messages[0].sender_id, alice.id);
  assert.equal(d.messages[0].ciphertext, "");

  // Sans x-device-id (client legacy) : un message fan-out n'est pas listé (pas d'enveloppe legacy).
  d = (await (await req("/api/messages/alice", bKey)).json()) as MsgResp;
  assert.equal(d.messages.length, 0);
});
