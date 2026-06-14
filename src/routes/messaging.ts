import { Hono } from "hono";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  MESSAGE_TTL_HOURS,
  deleteMessage,
  deleteMessageByClientMsgId,
  burnMessage,
  getMessages,
  markMessages,
  storeMessage,
  storeFanoutMessage,
  toggleReaction,
  toggleReactionByClientMsgId,
  pairKey,
  createAttachment,
  setAttachmentFile,
  getAttachment,
} from "../messages.js";
import { parseSettings } from "../store.js";
import { resolveDevice, resolveDevicePks } from "../devices.js";
import { publish } from "../realtime.js";
import { currentIdentity, readBody, notify, chatPeers } from "./_ctx.js";
import { getContactGating } from "../premium-api.js";

const route = new Hono();

const DATA_DIR = resolve(process.cwd(), "data");

route.get("/api/messages/:handle", async (c) => {
  const peers = await chatPeers(c);
  if (!peers) return c.json({ error: "réservé aux contacts" }, 403);
  // Multi-appareils : si l'appareil est connu (x-device-id), on ne renvoie que SES
  // enveloppes pour les messages fan-out (sinon comportement legacy mono-session).
  const myDev = await resolveDevice(peers.me.id, c.req.header("x-device-id"));
  return c.json({
    ttlHours: MESSAGE_TTL_HOURS,
    me: peers.me.id,
    peerPubkey: peers.other.pubkey,
    messages: await getMessages(peers.me.id, peers.other.id, myDev?.id ?? null),
  });
});

route.post("/api/messages/:handle", async (c) => {
  const peers = await chatPeers(c);
  if (!peers) return c.json({ error: "réservé aux contacts" }, 403);
  if (!parseSettings(peers.other.settings).allow_chat)
    return c.json({ error: "Ce contact a désactivé la messagerie." }, 403);
  // Gating Premium : si le destinataire a chat réservé aux abonnés et que je ne
  // le suis pas, je n'ai pas le droit d'envoyer un message.
  const gating = await getContactGating(peers.other.id, peers.me.id);
  if (!gating.chat) return c.json({ error: "Réservé aux abonné·e·s de cet espace." }, 402);
  const body = await readBody<{
    iv?: string;
    ciphertext?: string;
    senderPub?: string;
    recipientPub?: string;
    ttl?: number; // minuterie de disparition (secondes), bornée côté store
    readOnce?: boolean; // message à lecture unique
    // Fan-out multi-appareils :
    clientMsgId?: string;
    envelopes?: { recipientDeviceId: string; iv: string; ciphertext: string }[];
  }>(c);
  try {
    if (Array.isArray(body.envelopes) && body.envelopes.length) {
      // ── Envoi FAN-OUT (multi-appareils) ──
      const myDev = await resolveDevice(peers.me.id, c.req.header("x-device-id"));
      if (!myDev) return c.json({ error: "appareil inconnu" }, 400);
      if (typeof body.clientMsgId !== "string" || !body.clientMsgId) return c.json({ error: "clientMsgId requis" }, 400);
      const wantedIds = body.envelopes.map((e) => e.recipientDeviceId).filter((x): x is string => typeof x === "string");
      // Les destinataires valides = appareils approuvés du pair OU de moi (sync).
      const pkByDevice = await resolveDevicePks([peers.me.id, peers.other.id], wantedIds);
      const envelopes: { recipientDevicePk: number; iv: string; ciphertext: string }[] = [];
      for (const e of body.envelopes) {
        const pk = pkByDevice.get(e.recipientDeviceId);
        if (!pk || typeof e.iv !== "string" || typeof e.ciphertext !== "string") continue; // appareil inconnu/non approuvé → ignoré
        envelopes.push({ recipientDevicePk: pk, iv: e.iv, ciphertext: e.ciphertext });
      }
      if (!envelopes.length) return c.json({ error: "aucune enveloppe valide" }, 400);
      await storeFanoutMessage(
        peers.me.id,
        peers.other.id,
        myDev.id,
        body.clientMsgId,
        envelopes,
        typeof body.ttl === "number" ? body.ttl : undefined,
        body.readOnce === true
      );
      publish(peers.me.id, "message", { from: peers.me.handle }); // sync de mes autres appareils
    } else {
      // ── Envoi LEGACY (mono-session) ──
      await storeMessage(
        peers.me.id,
        peers.other.id,
        body.iv ?? "",
        body.ciphertext ?? "",
        body.senderPub ?? "",
        body.recipientPub ?? "",
        typeof body.ttl === "number" ? body.ttl : undefined,
        body.readOnce === true
      );
    }
    publish(peers.other.id, "message", { from: peers.me.handle });
    await notify(peers.other.id, "message", `Nouveau message de @${peers.me.handle}`, `/@${peers.me.handle}`);
    return c.json({ ok: true }, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "erreur" }, 400);
  }
});

route.post("/api/messages/:handle/ack", async (c) => {
  const peers = await chatPeers(c);
  if (!peers) return c.json({ error: "réservé aux contacts" }, 403);
  const { read } = await readBody<{ read: boolean }>(c);
  const changed = await markMessages(peers.me.id, peers.other.id, read === true);
  if (changed) publish(peers.other.id, "ack", { from: peers.me.handle });
  return c.json({ ok: true });
});

route.delete("/api/messages/:handle/:id", async (c) => {
  const peers = await chatPeers(c);
  if (!peers) return c.json({ error: "réservé aux contacts" }, 403);
  const rawId = c.req.param("id");
  let ok = await deleteMessage(peers.me.id, Number(rawId));
  if (!ok) ok = await deleteMessageByClientMsgId(peers.me.id, rawId);
  if (ok) publish(peers.other.id, "message", { from: peers.me.handle });
  return ok ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
});

// Lecture unique : le DESTINATAIRE « brûle » (supprime) un message read_once après l'avoir révélé.
route.post("/api/messages/:handle/:id/burn", async (c) => {
  const peers = await chatPeers(c);
  if (!peers) return c.json({ error: "réservé aux contacts" }, 403);
  const ok = await burnMessage(peers.me.id, peers.other.id, Number(c.req.param("id")));
  if (ok) publish(peers.other.id, "message", { from: peers.me.handle });
  return ok ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
});

route.post("/api/messages/:handle/react", async (c) => {
  const peers = await chatPeers(c);
  if (!peers) return c.json({ error: "réservé aux contacts" }, 403);
  const { messageId, clientMsgId, emoji } = await readBody<{ messageId: number; clientMsgId: string; emoji: string }>(c);
  let ok = false;
  if (typeof clientMsgId === "string" && clientMsgId) {
    ok = await toggleReactionByClientMsgId(peers.me.id, clientMsgId, emoji ?? "");
  } else {
    ok = await toggleReaction(peers.me.id, Number(messageId), emoji ?? "");
  }
  if (ok) publish(peers.other.id, "message", { from: peers.me.handle });
  return ok ? c.json({ ok: true }) : c.json({ error: "invalide" }, 400);
});

/* ----------------------- Pièces jointes chiffrées ------------------------ */
// Le serveur ne reçoit qu'un BLOB OPAQUE (chiffré côté client par une clé AES
// aléatoire transmise dans le message E2E). Même TTL 24 h que les messages.
const MAX_ATTACHMENT = 11 * 1024 * 1024; // ~10 Mo de clair + overhead GCM/multipart

route.post("/api/attachments/:handle", async (c) => {
  const peers = await chatPeers(c);
  if (!peers) return c.json({ error: "réservé aux contacts" }, 403);
  if (!parseSettings(peers.other.settings).allow_chat)
    return c.json({ error: "Ce contact a désactivé la messagerie." }, 403);
  const body = await c.req.parseBody();
  const blob = body.blob;
  if (!(blob instanceof File)) return c.json({ error: "blob manquant" }, 400);
  if (blob.size > MAX_ATTACHMENT) return c.json({ error: "fichier trop volumineux" }, 413);
  const id = await createAttachment(pairKey(peers.me.id, peers.other.id), peers.me.id, blob.size);
  const name = `attach-${id}.bin`;
  writeFileSync(resolve(DATA_DIR, name), Buffer.from(await blob.arrayBuffer()));
  await setAttachmentFile(id, name);
  return c.json({ id, expiresAt: new Date(Date.now() + MESSAGE_TTL_HOURS * 60 * 60 * 1000).toISOString() }, 201);
});

route.get("/api/attachments/:handle/:id", async (c) => {
  const peers = await chatPeers(c);
  if (!peers) return c.json({ error: "réservé aux contacts" }, 403);
  const att = await getAttachment(Number(c.req.param("id")));
  // Doit appartenir à la conversation (me,other) et ne pas être expiré.
  if (att?.pair !== pairKey(peers.me.id, peers.other.id)) return c.json({ error: "not found" }, 404);
  if (att.expiresAt < new Date().toISOString() || !att.file) return c.json({ error: "expiré" }, 404);
  const p = resolve(DATA_DIR, att.file);
  if (!existsSync(p)) return c.json({ error: "not found" }, 404);
  c.header("Content-Type", "application/octet-stream");
  c.header("Cache-Control", "no-store");
  return c.body(readFileSync(p));
});

/* ----------------------- Appel P2P (signalisation WebRTC) ---------------- */
// Relais ÉPHÉMÈRE de la signalisation WebRTC (offer/answer/ICE/hangup/decline).
// Le serveur ne stocke RIEN : il se contente de pousser au pair le blob chiffré
// de bout en bout (il ne peut pas lire la signalisation). Le média audio/vidéo,
// lui, circule en P2P direct entre navigateurs — il ne traverse jamais le serveur.
//
// Permis d'appel éphémères (mémoire process, comme le bus SSE) : la PREMIÈRE
// signalisation d'un couple est forcément l'OFFRE (handshake WebRTC), donc on la
// soumet au gating (allow_call + premium). Si elle passe, on ouvre un permis pour
// le couple : la signalisation retour (answer/ice/hangup) passe alors sans
// re-gating — sinon le destinataire légitime ne pourrait pas décrocher et
// l'émetteur sonnerait indéfiniment. Le gating ne pouvant être contourné (le
// serveur ne lit pas le contenu chiffré, et le 1er message est toujours gaté),
// un non-abonné ne peut pas faire sonner un espace dont les appels sont réservés.
const callPermits = new Map<string, number>(); // clé couple (pairKey) -> expiration (ms)
const CALL_PERMIT_TTL = 2 * 60 * 60 * 1000; // 2 h (durée max raisonnable d'un appel)

route.post("/api/signal/:handle", async (c) => {
  const peers = await chatPeers(c);
  if (!peers) return c.json({ error: "réservé aux contacts" }, 403);
  const { iv, ciphertext } = await readBody<{ iv: string; ciphertext: string }>(c);
  if (typeof iv !== "string" || typeof ciphertext !== "string" || !iv || !ciphertext || ciphertext.length > 16000)
    return c.json({ error: "signal invalide" }, 400);
  const now = Date.now();
  const pk = pairKey(peers.me.id, peers.other.id);
  if ((callPermits.get(pk) ?? 0) <= now) {
    // Aucun appel en cours pour ce couple → cette signalisation = initiation.
    if (!parseSettings(peers.other.settings).allow_call)
      return c.json({ error: "Ce contact a désactivé les appels." }, 403);
    const gating = await getContactGating(peers.other.id, peers.me.id);
    if (!gating.call) return c.json({ error: "Appel réservé aux abonné·e·s de cet espace." }, 402);
  }
  // Ouvre/prolonge le permis du couple (les deux sens) pour la suite du handshake.
  callPermits.set(pk, now + CALL_PERMIT_TTL);
  if (callPermits.size > 5000) for (const [k, exp] of callPermits) if (exp <= now) callPermits.delete(k);
  // pub : clé publique de l'émetteur (publique par nature), sert au pair à dériver
  // la clé partagée pour déchiffrer, sans aller-retour supplémentaire.
  publish(peers.other.id, "signal", { from: peers.me.handle, pub: peers.me.pubkey, iv, ciphertext });
  return c.json({ ok: true });
});

export default route;
