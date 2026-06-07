import { Hono } from "hono";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  StoreError,
  createGroup,
  listGroups,
  getGroup,
  isGroupMember,
  addGroupMember,
  removeGroupMember,
  leaveGroup,
  groupMemberIds,
  promoteGroupMember,
  demoteGroupMember,
  transferGroupOwnership,
  renameGroup,
} from "../store.js";
import {
  storeGroupMessage,
  getGroupMessages,
  deleteMessage,
  burnMessage,
  toggleReaction,
  createAttachment,
  setAttachmentFile,
  getAttachment,
  groupPair,
  MESSAGE_TTL_HOURS,
} from "../messages.js";
import { publish } from "../realtime.js";
import { currentIdentity, readBody, notify } from "./_ctx.js";

const DATA_DIR = resolve(process.cwd(), "data");
const MAX_ATTACHMENT = 11 * 1024 * 1024; // ~10 Mo de clair + overhead GCM/multipart

const route = new Hono();

route.post("/api/groups", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const { name, members } = await readBody<{ name?: string; members?: string[] }>(c);
  try {
    const g = await createGroup(id.id, name ?? "", Array.isArray(members) ? members : []);
    for (const mid of await groupMemberIds(g.id)) {
      if (mid !== id.id) {
        publish(mid, "group", { gid: g.id });
        await notify(mid, "relation", `@${id.handle} vous a ajouté au groupe « ${g.name || "sans nom"} »`, "/me").catch(() => undefined);
      }
    }
    return c.json(g, 201);
  } catch (e) {
    if (e instanceof StoreError) return c.json({ error: e.message }, e.status as 400);
    throw e;
  }
});

route.get("/api/groups", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  return c.json({ groups: await listGroups(id.id) });
});

route.get("/api/groups/:id", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const g = await getGroup(id.id, c.req.param("id"));
  return g ? c.json(g) : c.json({ error: "not found" }, 404);
});

route.post("/api/groups/:id/members", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const gid = c.req.param("id");
  const { handle } = await readBody<{ handle: string }>(c);
  try {
    await addGroupMember(id.id, gid, handle ?? "");
    for (const mid of await groupMemberIds(gid)) publish(mid, "group", { gid });
    return c.json({ ok: true });
  } catch (e) {
    if (e instanceof StoreError) return c.json({ error: e.message }, e.status as 400);
    throw e;
  }
});

route.delete("/api/groups/:id/members/:handle", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const gid = c.req.param("id");
  try {
    const members = await groupMemberIds(gid); // avant retrait (pour prévenir l'exclu)
    const ok = await removeGroupMember(id.id, gid, c.req.param("handle"));
    if (ok) for (const mid of members) publish(mid, "group", { gid });
    return ok ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
  } catch (e) {
    if (e instanceof StoreError) return c.json({ error: e.message }, e.status as 400);
    throw e;
  }
});

route.patch("/api/groups/:id", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const gid = c.req.param("id");
  const { name } = await readBody<{ name: string }>(c);
  if (typeof name !== "string" || !name.trim()) return c.json({ error: "nom invalide" }, 400);
  try {
    await renameGroup(id.id, gid, name.trim());
    for (const mid of await groupMemberIds(gid)) publish(mid, "group", { gid });
    return c.json({ ok: true });
  } catch (e) {
    if (e instanceof StoreError) return c.json({ error: e.message }, e.status as 400);
    throw e;
  }
});

route.post("/api/groups/:id/promote", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const gid = c.req.param("id");
  const { handle } = await readBody<{ handle: string }>(c);
  try {
    await promoteGroupMember(id.id, gid, handle ?? "");
    for (const mid of await groupMemberIds(gid)) publish(mid, "group", { gid });
    return c.json({ ok: true });
  } catch (e) {
    if (e instanceof StoreError) return c.json({ error: e.message }, e.status as 400);
    throw e;
  }
});

route.post("/api/groups/:id/demote", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const gid = c.req.param("id");
  const { handle } = await readBody<{ handle: string }>(c);
  try {
    await demoteGroupMember(id.id, gid, handle ?? "");
    for (const mid of await groupMemberIds(gid)) publish(mid, "group", { gid });
    return c.json({ ok: true });
  } catch (e) {
    if (e instanceof StoreError) return c.json({ error: e.message }, e.status as 400);
    throw e;
  }
});

route.post("/api/groups/:id/transfer", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const gid = c.req.param("id");
  const { handle } = await readBody<{ handle: string }>(c);
  try {
    await transferGroupOwnership(id.id, gid, handle ?? "");
    for (const mid of await groupMemberIds(gid)) publish(mid, "group", { gid });
    return c.json({ ok: true });
  } catch (e) {
    if (e instanceof StoreError) return c.json({ error: e.message }, e.status as 400);
    throw e;
  }
});

route.post("/api/groups/:id/leave", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const gid = c.req.param("id");
  const members = await groupMemberIds(gid);
  try {
    const ok = await leaveGroup(id.id, gid);
    if (ok) for (const mid of members) if (mid !== id.id) publish(mid, "group", { gid });
    return ok ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
  } catch (e) {
    if (e instanceof StoreError) return c.json({ error: e.message }, e.status as 400);
    throw e;
  }
});

route.get("/api/groups/:id/messages", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const gid = c.req.param("id");
  if (!(await isGroupMember(gid, id.id))) return c.json({ error: "réservé aux membres" }, 403);
  return c.json({ me: id.id, ttlHours: MESSAGE_TTL_HOURS, messages: await getGroupMessages(id.id, gid) });
});

route.post("/api/groups/:id/messages", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const gid = c.req.param("id");
  if (!(await isGroupMember(gid, id.id))) return c.json({ error: "réservé aux membres" }, 403);
  const { iv, ciphertext, ttl, readOnce } = await readBody<{
    iv: string;
    ciphertext: string;
    ttl?: number;
    readOnce?: boolean;
  }>(c);
  try {
    await storeGroupMessage(
      gid,
      id.id,
      iv ?? "",
      ciphertext ?? "",
      typeof ttl === "number" ? ttl : undefined,
      readOnce === true
    );
    for (const mid of await groupMemberIds(gid)) if (mid !== id.id) publish(mid, "group", { gid });
    return c.json({ ok: true }, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "erreur" }, 400);
  }
});

route.delete("/api/groups/:id/messages/:mid", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const gid = c.req.param("id");
  if (!(await isGroupMember(gid, id.id))) return c.json({ error: "réservé aux membres" }, 403);
  const ok = await deleteMessage(id.id, Number(c.req.param("mid")));
  if (ok) for (const mid of await groupMemberIds(gid)) publish(mid, "group", { gid });
  return ok ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
});

// Lecture unique : un MEMBRE brûle (supprime) un message read_once après l'avoir
// révélé. Tout membre du groupe peut le faire (le message disparaît pour tous).
route.post("/api/groups/:id/messages/:mid/burn", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const gid = c.req.param("id");
  if (!(await isGroupMember(gid, id.id))) return c.json({ error: "réservé aux membres" }, 403);
  // burnMessage attend (meId, otherId, mid) pour 1:1 ; on adapte ici en
  // supprimant directement via deleteMessage. Le sender du msg peut être un
  // autre membre, donc on s'autorise à supprimer si on est membre + read_once.
  const ok = await burnGroupMessage(gid, Number(c.req.param("mid")));
  if (ok) for (const mid of await groupMemberIds(gid)) publish(mid, "group", { gid });
  return ok ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
});

route.post("/api/groups/:id/messages/:mid/react", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const gid = c.req.param("id");
  if (!(await isGroupMember(gid, id.id))) return c.json({ error: "réservé aux membres" }, 403);
  const { emoji } = await readBody<{ emoji: string }>(c);
  const ok = await toggleReaction(id.id, Number(c.req.param("mid")), emoji ?? "");
  if (ok) for (const mid of await groupMemberIds(gid)) publish(mid, "group", { gid });
  return ok ? c.json({ ok: true }) : c.json({ error: "invalide" }, 400);
});

/* ---- Pièces jointes éphémères (blob opaque relayé) ---- */
// Le serveur ne reçoit qu'un BLOB OPAQUE (chiffré côté client par une clé AES
// aléatoire transmise dans le message sender-key). pair = "g:<gid>".

route.post("/api/groups/:id/attachments", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const gid = c.req.param("id");
  if (!(await isGroupMember(gid, id.id))) return c.json({ error: "réservé aux membres" }, 403);
  const body = await c.req.parseBody();
  const blob = body.blob;
  if (!(blob instanceof File)) return c.json({ error: "blob manquant" }, 400);
  if (blob.size > MAX_ATTACHMENT) return c.json({ error: "fichier trop volumineux" }, 413);
  const attId = await createAttachment(groupPair(gid), id.id, blob.size);
  const name = `gattach-${attId}.bin`;
  writeFileSync(resolve(DATA_DIR, name), Buffer.from(await blob.arrayBuffer()));
  await setAttachmentFile(attId, name);
  return c.json({ id: attId, expiresAt: new Date(Date.now() + MESSAGE_TTL_HOURS * 60 * 60 * 1000).toISOString() }, 201);
});

route.get("/api/groups/:id/attachments/:attId", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const gid = c.req.param("id");
  if (!(await isGroupMember(gid, id.id))) return c.json({ error: "réservé aux membres" }, 403);
  const att = await getAttachment(Number(c.req.param("attId")));
  if (att?.pair !== groupPair(gid)) return c.json({ error: "not found" }, 404);
  if (att.expiresAt < new Date().toISOString() || !att.file) return c.json({ error: "expiré" }, 404);
  const p = resolve(DATA_DIR, att.file);
  if (!existsSync(p)) return c.json({ error: "not found" }, 404);
  c.header("Content-Type", "application/octet-stream");
  c.header("Cache-Control", "no-store");
  return c.body(readFileSync(p));
});

/** Brûle un message read_once dans un groupe. Helper local — vérifie le flag
 *  et supprime. Retourne true si effectivement supprimé. */
async function burnGroupMessage(gid: string, mid: number): Promise<boolean> {
  // On réutilise deleteMessage avec senderId arbitraire en passant 0, donc on
  // utilise une suppression sans filtre senderId. Ici on contourne via SQL via
  // une routine déjà disponible — mais deleteMessage filtre par senderId.
  // À la place : burn via burnMessage en passant un peerId factice ne marche pas.
  // Le plus propre : appel direct.
  void burnMessage; // référence pour l'import (helper 1:1 inutile ici)
  const { db } = await import("../db.js");
  const { messages } = await import("../schema.js");
  const { and, eq } = await import("drizzle-orm");
  const rows = await db
    .delete(messages)
    .where(and(eq(messages.id, mid), eq(messages.pair, groupPair(gid)), eq(messages.read_once, 1)))
    .returning({ id: messages.id });
  return rows.length > 0;
}

export default route;
