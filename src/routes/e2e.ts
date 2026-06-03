import { Hono } from "hono";
import {
  setPubkey,
  getE2eVault,
  setE2eVault,
  deleteE2eVault,
  recordPinFail,
  resetPinFail,
  setPrekeyBundle,
  fetchPrekeyBundle,
  countAvailableOpks,
  type PrekeyBundleInput,
  setVerification,
  getVerification,
  deleteVerification,
} from "../store.js";
import {
  registerDevice,
  listDevices,
  approveDevice,
  revokeDevice,
  resolveDevice,
  setDevicePrekeyBundle,
  countDeviceOpks,
  fetchDeviceBundles,
} from "../devices.js";
import { publish } from "../realtime.js";
import { currentIdentity, readBody, notify, chatPeers } from "./_ctx.js";

const route = new Hono();

const MAX_VAULT = 8000;
const MAX_JWK = 2000;

// Publie ma clé publique E2E (le serveur ne reçoit jamais la clé privée).
route.put("/api/pubkey", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const { pubkey } = await readBody<{ pubkey: string }>(c);
  if (typeof pubkey !== "string" || pubkey.length > 2000) return c.json({ error: "pubkey invalide" }, 400);
  await setPubkey(id.id, pubkey);
  return c.json({ ok: true });
});

// Coffre de clé E2E (escrow) : la clé privée chiffrée côté client, rendue
// portable entre navigateurs. Le serveur ne stocke/renvoie qu'un JSON OPAQUE
// (blobs AES-GCM) — il ne peut jamais lire la clé.
route.get("/api/e2e/vault", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const { vault, pin_locked_until, pin_fail_count } = await getE2eVault(id.id);
  return c.json({ vault, pin_locked_until, pin_fail_count });
});
route.put("/api/e2e/vault", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const { vault } = await readBody<{ vault: string }>(c);
  if (typeof vault !== "string" || !vault || vault.length > MAX_VAULT)
    return c.json({ error: "coffre invalide" }, 400);
  await setE2eVault(id.id, vault);
  return c.json({ ok: true });
});
route.delete("/api/e2e/vault", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  await deleteE2eVault(id.id);
  return c.json({ ok: true });
});

route.post("/api/e2e/vault/pin-fail", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const locked_until = await recordPinFail(id.id);
  return c.json({ locked_until });
});
route.post("/api/e2e/vault/pin-success", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  await resetPinFail(id.id);
  return c.json({ ok: true });
});

// Prekeys X3DH (forward secrecy). Matériel PUBLIC uniquement — le serveur ne voit
// jamais de privée ni d'état de ratchet ; il relaie un bundle public et consomme
// une one-time prekey par handshake.
// Publie/rafraîchit son propre bundle (SPK + lot d'OPK).
route.put("/api/e2e/prekeys", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const body = await readBody<{
    spkPub?: string;
    spkId?: number;
    spkSig?: string;
    opks?: { opkId: number; opkPub: string }[];
  }>(c);
  if (typeof body.spkPub !== "string" || !body.spkPub || body.spkPub.length > MAX_JWK)
    return c.json({ error: "spk invalide" }, 400);
  if (typeof body.spkId !== "number" || !Number.isInteger(body.spkId))
    return c.json({ error: "spkId invalide" }, 400);
  const opks = Array.isArray(body.opks) ? body.opks.slice(0, 200) : [];
  for (const o of opks)
    if (typeof o.opkId !== "number" || typeof o.opkPub !== "string" || o.opkPub.length > MAX_JWK)
      return c.json({ error: "opk invalide" }, 400);
  if (typeof body.spkSig === "string" && body.spkSig.length > MAX_JWK)
    return c.json({ error: "signature invalide" }, 400);
  const bundle: PrekeyBundleInput = { spkPub: body.spkPub, spkId: body.spkId, spkSig: body.spkSig, opks };
  await setPrekeyBundle(id.id, bundle);
  return c.json({ ok: true });
});
// Nombre d'OPK restantes (l'UI réapprovisionne quand le pool est bas).
route.get("/api/e2e/prekeys/count", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  return c.json({ available: await countAvailableOpks(id.id) });
});
// Récupère le bundle d'un CONTACT en consommant une OPK (un seul usage). Gardé par
// la réciprocité de contact (anti-drain du pool par des inconnus).
route.get("/api/e2e/prekeys/:handle", async (c) => {
  const peers = await chatPeers(c);
  if (!peers) return c.json({ error: "réservé aux contacts" }, 403);
  const bundle = await fetchPrekeyBundle(peers.other.id);
  if (!bundle) return c.json({ error: "pas de bundle" }, 404);
  return c.json(bundle);
});

/* ── Multi-appareils (P1, cf. docs/multidevice-proposal.md) ────────────────
 * Registre d'appareils + appairage (approbation par un appareil existant) et
 * prekeys X3DH PAR APPAREIL. L'appareil courant est identifié par l'en-tête
 * `x-device-id`. Le serveur ne manipule que du matériel public. */
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

// Enrôle/rafraîchit MON appareil (1er appareil auto-approuvé ; les suivants en attente).
route.post("/api/devices", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const b = await readBody<{ deviceId: string; e2ePubkey: string; name?: string }>(c);
  if (typeof b.deviceId !== "string" || !DEVICE_ID_RE.test(b.deviceId)) return c.json({ error: "deviceId invalide" }, 400);
  if (typeof b.e2ePubkey !== "string" || !b.e2ePubkey || b.e2ePubkey.length > MAX_JWK) return c.json({ error: "clé invalide" }, 400);
  const name = typeof b.name === "string" ? b.name.slice(0, 80) : "";
  try {
    const { device, pending } = await registerDevice(id.id, b.deviceId, b.e2ePubkey, name);
    if (pending) {
      // Alerte les appareils existants : un nouvel appareil attend leur approbation.
      publish(id.id, "device", { pending: true });
      await notify(id.id, "device", "Un nouvel appareil attend votre approbation (Options › Accès).", null);
    }
    return c.json({ id: device.id, deviceId: device.deviceId, approved: device.approved, pending });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

// Liste MES appareils actifs.
route.get("/api/devices", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  return c.json({ devices: await listDevices(id.id) });
});

// Approuve un appareil en attente (réservé à un appareil déjà approuvé : `x-device-id`).
route.post("/api/devices/:pk/approve", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const pk = Number(c.req.param("pk"));
  if (!Number.isInteger(pk)) return c.json({ error: "id invalide" }, 400);
  const ok = await approveDevice(id.id, pk, c.req.header("x-device-id"));
  if (!ok) return c.json({ error: "approbation refusée (appareil approbateur requis)" }, 403);
  return c.json({ ok: true });
});

// Révoque un appareil.
route.delete("/api/devices/:pk", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const pk = Number(c.req.param("pk"));
  if (!Number.isInteger(pk)) return c.json({ error: "id invalide" }, 400);
  return c.json({ ok: await revokeDevice(id.id, pk) });
});

// Publie/rafraîchit le bundle de prekeys de MON appareil (`x-device-id`).
route.put("/api/e2e/device-prekeys", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const dev = await resolveDevice(id.id, c.req.header("x-device-id"));
  if (!dev) return c.json({ error: "appareil inconnu" }, 400);
  const body = await readBody<{ spkPub?: string; spkId?: number; spkSig?: string; opks?: { opkId: number; opkPub: string }[] }>(c);
  if (typeof body.spkPub !== "string" || !body.spkPub || body.spkPub.length > MAX_JWK) return c.json({ error: "spk invalide" }, 400);
  if (typeof body.spkId !== "number" || !Number.isInteger(body.spkId)) return c.json({ error: "spkId invalide" }, 400);
  const opks = Array.isArray(body.opks) ? body.opks.slice(0, 200) : [];
  for (const o of opks)
    if (typeof o.opkId !== "number" || typeof o.opkPub !== "string" || o.opkPub.length > MAX_JWK) return c.json({ error: "opk invalide" }, 400);
  if (typeof body.spkSig === "string" && body.spkSig.length > MAX_JWK) return c.json({ error: "signature invalide" }, 400);
  await setDevicePrekeyBundle(dev.id, { spkPub: body.spkPub, spkId: body.spkId, spkSig: body.spkSig, opks });
  return c.json({ ok: true });
});

// Nombre d'OPK restantes pour MON appareil.
route.get("/api/e2e/device-prekeys/count", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const dev = await resolveDevice(id.id, c.req.header("x-device-id"));
  if (!dev) return c.json({ error: "appareil inconnu" }, 400);
  return c.json({ available: await countDeviceOpks(dev.id) });
});

// Bundles de TOUS les appareils d'un CONTACT (fan-out X3DH). Gardé par réciprocité.
route.get("/api/e2e/device-prekeys/:handle", async (c) => {
  const peers = await chatPeers(c);
  if (!peers) return c.json({ error: "réservé aux contacts" }, 403);
  return c.json({ devices: await fetchDeviceBundles(peers.other.id) });
});

// Bundles de MES AUTRES appareils (fan-out « sync » de mes propres envois).
route.get("/api/e2e/my-devices", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  return c.json({ devices: await fetchDeviceBundles(id.id, { excludeDeviceId: c.req.header("x-device-id") }) });
});

// Vérification d'identité (anti-MITM). Le client compare le numéro de sécurité
// hors-bande puis enregistre le hash ; le serveur ne fait que mémoriser/synchroniser.
const SAFETY_HASH_RE = /^[0-9a-f]{64}$/;
route.put("/api/e2e/verify/:handle", async (c) => {
  const peers = await chatPeers(c);
  if (!peers) return c.json({ error: "réservé aux contacts" }, 403);
  const { safety } = await readBody<{ safety: string }>(c);
  if (typeof safety !== "string" || !SAFETY_HASH_RE.test(safety))
    return c.json({ error: "hash invalide" }, 400);
  await setVerification(peers.me.id, peers.other.id, safety);
  return c.json({ ok: true });
});
route.get("/api/e2e/verify/:handle", async (c) => {
  const peers = await chatPeers(c);
  if (!peers) return c.json({ error: "réservé aux contacts" }, 403);
  const v = await getVerification(peers.me.id, peers.other.id);
  return c.json({ safety: v?.safetyHash ?? null, verifiedAt: v?.verifiedAt ?? null });
});
route.delete("/api/e2e/verify/:handle", async (c) => {
  const peers = await chatPeers(c);
  if (!peers) return c.json({ error: "réservé aux contacts" }, 403);
  await deleteVerification(peers.me.id, peers.other.id);
  return c.json({ ok: true });
});

export default route;
