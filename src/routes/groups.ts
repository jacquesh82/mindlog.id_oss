import { Hono } from "hono";
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
} from "../store.js";
import { storeGroupMessage, getGroupMessages, MESSAGE_TTL_HOURS } from "../messages.js";
import { publish } from "../realtime.js";
import { currentIdentity, readBody, notify } from "./_ctx.js";

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

route.post("/api/groups/:id/leave", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const gid = c.req.param("id");
  const members = await groupMemberIds(gid);
  const ok = await leaveGroup(id.id, gid);
  if (ok) for (const mid of members) if (mid !== id.id) publish(mid, "group", { gid });
  return ok ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
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
  const { iv, ciphertext } = await readBody<{ iv: string; ciphertext: string }>(c);
  try {
    await storeGroupMessage(gid, id.id, iv ?? "", ciphertext ?? "");
    for (const mid of await groupMemberIds(gid)) if (mid !== id.id) publish(mid, "group", { gid });
    return c.json({ ok: true }, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "erreur" }, 400);
  }
});

export default route;
