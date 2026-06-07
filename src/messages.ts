import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "./db.js";
import { attachments, cardFields, devices, identities, messageEnvelopes, messages, reactions } from "./schema.js";
import type { Identity } from "./store.js";

/**
 * Conversation éphémère entre deux CONTACTS réciproques.
 * Chiffrement END-TO-END : le serveur ne stocke que des blobs opaques.
 */

export const MESSAGE_TTL_HOURS = 24;
export const MESSAGE_TTL_MAX_SECONDS = MESSAGE_TTL_HOURS * 60 * 60; // borne dure (24 h)
export const MESSAGE_TTL_MIN_SECONDS = 60; // minuterie de disparition minimale
export const pairKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

export async function pruneExpiredMessages(): Promise<void> {
  await db.delete(messages).where(lt(messages.expires_at, new Date().toISOString()));
}

/* ---- Messages de groupe (sender keys) : clé de conversation "g:<id>" ---- */
// Le serveur ne voit que des blobs ; l'appartenance est gérée dans store.ts.
export const groupPair = (gid: string) => `g:${gid}`;

export async function storeGroupMessage(
  gid: string,
  senderId: number,
  iv: string,
  ciphertext: string,
  ttlSeconds?: number,
  readOnce = false
): Promise<void> {
  if (!iv || !ciphertext || ciphertext.length > MAX_CIPHERTEXT) throw new Error("message trop long ou invalide");
  // Mêmes bornes que storeMessage (1:1) — TTL [60 s, 24 h], défaut 24 h.
  const ttl = typeof ttlSeconds === "number" && Number.isFinite(ttlSeconds)
    ? Math.min(MESSAGE_TTL_MAX_SECONDS, Math.max(MESSAGE_TTL_MIN_SECONDS, Math.floor(ttlSeconds)))
    : MESSAGE_TTL_MAX_SECONDS;
  await db.insert(messages).values({
    pair: groupPair(gid),
    sender_id: senderId,
    iv,
    ciphertext,
    read_once: readOnce ? 1 : 0,
    expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
  });
}

/** Message de groupe : RawMessage + handle de l'expéditeur (pour mapper la sender key). */
export interface GroupMessage extends MessageWithReactions {
  sender_handle: string;
}

/** Messages (éphémères) d'un groupe + réactions. L'appel doit vérifier l'appartenance. */
export async function getGroupMessages(meId: number, gid: string): Promise<GroupMessage[]> {
  await pruneExpiredMessages();
  const rows = (await db
    .select({
      id: messages.id,
      sender_id: messages.sender_id,
      sender_handle: identities.handle,
      iv: messages.iv,
      ciphertext: messages.ciphertext,
      sender_pub: messages.sender_pub,
      recipient_pub: messages.recipient_pub,
      created_at: messages.created_at,
      expires_at: messages.expires_at,
      delivered: messages.delivered,
      read: messages.read,
      read_once: messages.read_once,
      client_msg_id: messages.client_msg_id,
      sender_device_pk: messages.sender_device_pk,
    })
    .from(messages)
    .innerJoin(identities, eq(identities.id, messages.sender_id))
    .where(eq(messages.pair, groupPair(gid)))
    .orderBy(messages.created_at)) as (RawMessage & { sender_handle: string })[];
  const reacts = await reactionsFor(rows.map((r) => r.id), meId);
  return rows.map((r) => ({ ...r, reactions: reacts.get(r.id) ?? [] }));
}

/* ---- Pièces jointes chiffrées éphémères (blob opaque relayé) ---- */

/** Crée la ligne d'une pièce jointe (le blob est écrit séparément sur disque). */
export async function createAttachment(pair: string, senderId: number, size: number): Promise<number> {
  const rows = await db
    .insert(attachments)
    .values({
      pair,
      sender_id: senderId,
      size,
      expires_at: new Date(Date.now() + MESSAGE_TTL_HOURS * 60 * 60 * 1000).toISOString(),
    })
    .returning({ id: attachments.id });
  return rows[0].id;
}

export async function setAttachmentFile(id: number, file: string): Promise<void> {
  await db.update(attachments).set({ file }).where(eq(attachments.id, id));
}

export async function getAttachment(
  id: number
): Promise<{ pair: string; file: string; expiresAt: string } | null> {
  const rows = await db
    .select({ pair: attachments.pair, file: attachments.file, expiresAt: attachments.expires_at })
    .from(attachments)
    .where(eq(attachments.id, id))
    .limit(1);
  return rows.at(0) ?? null;
}

/**
 * Supprime les pièces jointes expirées et RENVOIE leurs noms de fichiers, pour
 * que l'appelant efface aussi les blobs sur disque (le store ne touche pas au FS).
 */
export async function pruneExpiredAttachments(): Promise<string[]> {
  const removed = await db
    .delete(attachments)
    .where(lt(attachments.expires_at, new Date().toISOString()))
    .returning({ file: attachments.file });
  return removed.map((r) => r.file).filter((f) => f.length > 0);
}

// v2 (Double Ratchet) empaquette le header dans `ciphertext`
// (base64url(header) + "." + base64(aesGcm)), d'où une marge vs les 8000 de v1.
const MAX_CIPHERTEXT = 12000;
const MAX_PUBKEY = 2000;
export async function storeMessage(
  senderId: number,
  otherId: number,
  iv: string,
  ciphertext: string,
  senderPub = "",
  recipientPub = "",
  ttlSeconds?: number,
  readOnce = false
): Promise<void> {
  if (!iv || !ciphertext || ciphertext.length > MAX_CIPHERTEXT)
    throw new Error("message trop long ou invalide");
  if (senderPub.length > MAX_PUBKEY || recipientPub.length > MAX_PUBKEY)
    throw new Error("clé publique invalide");
  // Minuterie de disparition : bornée à [60 s, 24 h]. Absente → 24 h (défaut).
  const ttl = typeof ttlSeconds === "number" && Number.isFinite(ttlSeconds)
    ? Math.min(MESSAGE_TTL_MAX_SECONDS, Math.max(MESSAGE_TTL_MIN_SECONDS, Math.floor(ttlSeconds)))
    : MESSAGE_TTL_MAX_SECONDS;
  await db.insert(messages).values({
    pair: pairKey(senderId, otherId),
    sender_id: senderId,
    iv,
    ciphertext,
    sender_pub: senderPub,
    recipient_pub: recipientPub,
    read_once: readOnce ? 1 : 0,
    expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
  });
}

export interface RawMessage {
  id: number;
  sender_id: number;
  iv: string;
  ciphertext: string;
  sender_pub: string;
  recipient_pub: string;
  created_at: string;
  expires_at: string;
  delivered: number;
  read: number;
  read_once: number;
  // Multi-appareils (fan-out) : non-null pour un message LOGIQUE dont le ciphertext
  // vit dans `message_envelopes` (un par appareil). Null pour le legacy mono-session.
  client_msg_id: string | null;
  sender_device_pk: number | null;
  // device-id (chaîne) de l'appareil émetteur — sert au destinataire à keyer la
  // session ratchet (le header ne contient l'ik qu'au 1ᵉʳ message). Optionnel :
  // seul getMessages le résout (join devices) ; les autres lectures l'omettent.
  sender_device_id?: string | null;
}

/**
 * Stocke un message en FAN-OUT : une ligne `messages` LOGIQUE (ciphertext vide ;
 * la métadonnée est partagée) + N enveloppes `message_envelopes` (un ciphertext
 * par appareil destinataire — pairs ET mes autres appareils). Renvoie l'id logique.
 */
export async function storeFanoutMessage(
  senderId: number,
  otherId: number,
  senderDevicePk: number,
  clientMsgId: string,
  envelopes: { recipientDevicePk: number; iv: string; ciphertext: string }[],
  ttlSeconds?: number,
  readOnce = false
): Promise<number> {
  if (!envelopes.length) throw new Error("aucune enveloppe");
  for (const e of envelopes)
    if (!e.iv || !e.ciphertext || e.ciphertext.length > MAX_CIPHERTEXT)
      throw new Error("enveloppe trop longue ou invalide");
  const ttl =
    typeof ttlSeconds === "number" && Number.isFinite(ttlSeconds)
      ? Math.min(MESSAGE_TTL_MAX_SECONDS, Math.max(MESSAGE_TTL_MIN_SECONDS, Math.floor(ttlSeconds)))
      : MESSAGE_TTL_MAX_SECONDS;
  const ins = (await db
    .insert(messages)
    .values({
      pair: pairKey(senderId, otherId),
      sender_id: senderId,
      iv: "", // le ciphertext réel vit dans les enveloppes
      ciphertext: "",
      sender_pub: "",
      recipient_pub: "",
      read_once: readOnce ? 1 : 0,
      expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
      sender_device_pk: senderDevicePk,
      client_msg_id: clientMsgId,
    })
    .returning({ id: messages.id })) as { id: number }[];
  const messageId = ins[0].id;
  await db.insert(messageEnvelopes).values(
    envelopes.map((e) => ({ message_id: messageId, recipient_device_pk: e.recipientDevicePk, iv: e.iv, ciphertext: e.ciphertext }))
  );
  return messageId;
}
export interface MessageWithReactions extends RawMessage {
  reactions: { emoji: string; count: number; mine: boolean }[];
}

async function reactionsFor(
  messageIds: number[],
  meId: number
): Promise<Map<number, MessageWithReactions["reactions"]>> {
  const map = new Map<number, MessageWithReactions["reactions"]>();
  if (!messageIds.length) return map;
  const rows = (await db
    .select({ message_id: reactions.message_id, emoji: reactions.emoji, identity_id: reactions.identity_id })
    .from(reactions)
    .where(inArray(reactions.message_id, messageIds))) as {
    message_id: number;
    emoji: string;
    identity_id: number;
  }[];
  const agg = new Map<number, Map<string, { count: number; mine: boolean }>>();
  for (const r of rows) {
    let m = agg.get(r.message_id);
    if (!m) {
      m = new Map();
      agg.set(r.message_id, m);
    }
    const e = m.get(r.emoji) ?? { count: 0, mine: false };
    e.count++;
    if (r.identity_id === meId) e.mine = true;
    m.set(r.emoji, e);
  }
  for (const [mid, emojis] of agg)
    map.set(mid, [...emojis.entries()].map(([emoji, v]) => ({ emoji, count: v.count, mine: v.mine })));
  return map;
}

/**
 * Renvoie les blobs chiffrés d'une conversation (+ statuts + réactions).
 *
 * Multi-appareils : si `myDevicePk` est fourni, les messages en FAN-OUT
 * (`client_msg_id` non-null) sont résolus à l'enveloppe destinée À CET appareil ;
 * un message fan-out sans enveloppe pour moi est masqué, SAUF mes propres envois
 * (je suis l'appareil émetteur → relus localement via recallSent). Les messages
 * legacy (mono-session) sont renvoyés tels quels (coexistence).
 */
export async function getMessages(
  meId: number,
  otherId: number,
  myDevicePk: number | null = null
): Promise<MessageWithReactions[]> {
  await pruneExpiredMessages();
  const rows = (await db
    .select({
      id: messages.id,
      sender_id: messages.sender_id,
      iv: messages.iv,
      ciphertext: messages.ciphertext,
      sender_pub: messages.sender_pub,
      recipient_pub: messages.recipient_pub,
      created_at: messages.created_at,
      expires_at: messages.expires_at,
      delivered: messages.delivered,
      read: messages.read,
      read_once: messages.read_once,
      client_msg_id: messages.client_msg_id,
      sender_device_pk: messages.sender_device_pk,
      sender_device_id: devices.device_id,
    })
    .from(messages)
    .leftJoin(devices, eq(devices.id, messages.sender_device_pk))
    .where(eq(messages.pair, pairKey(meId, otherId)))
    .orderBy(messages.created_at)) as RawMessage[];

  // Enveloppes destinées à MON appareil (pour les messages fan-out).
  const envByMsg = new Map<number, { iv: string; ciphertext: string }>();
  if (myDevicePk != null && rows.length) {
    const envs = (await db
      .select({ message_id: messageEnvelopes.message_id, iv: messageEnvelopes.iv, ciphertext: messageEnvelopes.ciphertext })
      .from(messageEnvelopes)
      .where(
        and(
          inArray(messageEnvelopes.message_id, rows.map((r) => r.id)),
          eq(messageEnvelopes.recipient_device_pk, myDevicePk)
        )
      )) as { message_id: number; iv: string; ciphertext: string }[];
    for (const e of envs) envByMsg.set(e.message_id, { iv: e.iv, ciphertext: e.ciphertext });
  }

  const visible: RawMessage[] = [];
  for (const r of rows) {
    if (r.client_msg_id == null) {
      visible.push(r); // legacy mono-session → tel quel
      continue;
    }
    const env = envByMsg.get(r.id);
    if (env) {
      visible.push({ ...r, iv: env.iv, ciphertext: env.ciphertext });
    } else if (myDevicePk != null && r.sender_device_pk === myDevicePk) {
      visible.push(r); // mon propre envoi (pas d'enveloppe pour l'émetteur) → recallSent local
    }
    // sinon : message fan-out non adressé à cet appareil → masqué
  }
  const reacts = await reactionsFor(visible.map((r) => r.id), meId);
  return visible.map((r) => ({ ...r, reactions: reacts.get(r.id) ?? [] }));
}

/**
 * Marque les messages reçus de `otherId` comme reçus (et lus si read=true).
 * Renvoie le nombre de lignes réellement modifiées.
 */
export async function markMessages(meId: number, otherId: number, read: boolean): Promise<number> {
  const r = read ? 1 : 0;
  // GREATEST (Postgres) = MAX scalaire (SQLite).
  const res = await db.execute(sql`
    UPDATE messages SET delivered = 1, read = GREATEST(read, ${r})
     WHERE pair = ${pairKey(meId, otherId)} AND sender_id = ${otherId} AND (delivered = 0 OR read < ${r})
     RETURNING id
  `);
  return res.rows.length;
}

/** Supprime un message — réservé à son émetteur. */
export async function deleteMessage(meId: number, messageId: number): Promise<boolean> {
  const r = await db
    .delete(messages)
    .where(and(eq(messages.id, messageId), eq(messages.sender_id, meId)))
    .returning({ id: messages.id });
  return r.length > 0;
}

/**
 * « Brûle » un message à lecture unique : seul le DESTINATAIRE (le pair qui n'est
 * pas l'émetteur) peut supprimer un message `read_once=1` qui lui était adressé.
 */
export async function burnMessage(meId: number, otherId: number, messageId: number): Promise<boolean> {
  const r = await db
    .delete(messages)
    .where(
      and(
        eq(messages.id, messageId),
        eq(messages.pair, pairKey(meId, otherId)),
        eq(messages.sender_id, otherId), // reçu de l'autre
        eq(messages.read_once, 1)
      )
    )
    .returning({ id: messages.id });
  return r.length > 0;
}

/** Bascule une réaction emoji ; vérifie que le message appartient à une conversation de `meId`. */
export async function toggleReaction(meId: number, messageId: number, emoji: string): Promise<boolean> {
  const rows = await db.select({ pair: messages.pair }).from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!rows.length) return false;
  const [a, b] = rows[0].pair.split(":").map(Number);
  if (a !== meId && b !== meId) return false;
  const e = emoji.slice(0, 8);
  if (!e) return false;
  const existing = await db
    .select({ x: reactions.emoji })
    .from(reactions)
    .where(and(eq(reactions.message_id, messageId), eq(reactions.identity_id, meId), eq(reactions.emoji, e)))
    .limit(1);
  if (existing.length)
    await db
      .delete(reactions)
      .where(and(eq(reactions.message_id, messageId), eq(reactions.identity_id, meId), eq(reactions.emoji, e)));
  else await db.insert(reactions).values({ message_id: messageId, identity_id: meId, emoji: e });
  return true;
}

/** Supprime un message fan-out par son client_msg_id (émetteur uniquement, enveloppes en cascade). */
export async function deleteMessageByClientMsgId(meId: number, clientMsgId: string): Promise<boolean> {
  const r = await db
    .delete(messages)
    .where(and(eq(messages.client_msg_id, clientMsgId), eq(messages.sender_id, meId)))
    .returning({ id: messages.id });
  return r.length > 0;
}

/** Bascule une réaction depuis un clientMsgId logique (fan-out). */
export async function toggleReactionByClientMsgId(meId: number, clientMsgId: string, emoji: string): Promise<boolean> {
  const rows = await db
    .select({ id: messages.id, pair: messages.pair })
    .from(messages)
    .where(eq(messages.client_msg_id, clientMsgId))
    .limit(1);
  if (!rows.length) return false;
  const [a, b] = rows[0].pair.split(":").map(Number);
  if (a !== meId && b !== meId) return false;
  return toggleReaction(meId, rows[0].id, emoji);
}

export interface Conversation {
  handle: string;
  display_name: string;
  has_photo: boolean;
  pubkey: string;
  messages: (RawMessage & { mine: boolean })[];
}

/** Toutes les conversations de `me` (blobs chiffrés + clé publique du pair). */
export async function getConversationsFor(me: Identity): Promise<Conversation[]> {
  await pruneExpiredMessages();
  const rows = (await db
    .select({
      pair: messages.pair,
      sender_id: messages.sender_id,
      id: messages.id,
      iv: messages.iv,
      ciphertext: messages.ciphertext,
      sender_pub: messages.sender_pub,
      recipient_pub: messages.recipient_pub,
      created_at: messages.created_at,
      expires_at: messages.expires_at,
      delivered: messages.delivered,
      read: messages.read,
      read_once: messages.read_once,
      client_msg_id: messages.client_msg_id,
      sender_device_pk: messages.sender_device_pk,
    })
    .from(messages)
    .orderBy(messages.created_at)) as (RawMessage & { pair: string })[];

  const byOther = new Map<number, RawMessage[]>();
  for (const r of rows) {
    const [a, b] = r.pair.split(":").map(Number);
    if (a !== me.id && b !== me.id) continue;
    const other = a === me.id ? b : a;
    let list = byOther.get(other);
    if (!list) {
      list = [];
      byOther.set(other, list);
    }
    list.push(r);
  }

  const out: Conversation[] = [];
  for (const [otherId, msgs] of byOther) {
    const oRows = await db
      .select({ handle: identities.handle, photo_file: identities.photo_file, pubkey: identities.pubkey })
      .from(identities)
      .where(eq(identities.id, otherId))
      .limit(1);
    const o = oRows.at(0);
    if (!o) continue;
    const dnRows = await db
      .select({ value: cardFields.value })
      .from(cardFields)
      .where(and(eq(cardFields.identity_id, otherId), eq(cardFields.key, "display_name")))
      .limit(1);
    out.push({
      handle: o.handle,
      display_name: dnRows.at(0)?.value ?? "",
      has_photo: !!o.photo_file,
      pubkey: o.pubkey,
      messages: msgs.map((m) => ({ ...m, mine: m.sender_id === me.id })),
    });
  }
  out.sort((x, y) =>
    (y.messages.at(-1)?.created_at ?? "").localeCompare(x.messages.at(-1)?.created_at ?? "")
  );
  return out;
}
