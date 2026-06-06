import { Hono } from "hono";
import { StoreError, addEvent, deleteEvent, updateEvent, setDayStatus } from "../store.js";
import { currentIdentity, readBody, exceeds } from "./_ctx.js";

const route = new Hono();

// kind 'live' n'est accepté que pour les comptes premium avec bénéfice lives activé.
// Sinon on retombe silencieusement sur 'event' — pas d'erreur, l'UI ne propose
// l'option qu'aux comptes éligibles.
async function normalizeKind(identityId: number, raw: unknown): Promise<"event" | "live"> {
  if (raw !== "live") return "event";
  const { isPremium, getSpaceInfo } = await import("../premium-api.js");
  if (!(await isPremium(identityId))) return "event";
  const sp = await getSpaceInfo(identityId, identityId);
  return sp?.benefits?.lives ? "live" : "event";
}

route.post("/api/agenda", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const body = await readBody<{
    title: string;
    starts_at: string;
    ends_at?: string | null;
    location?: string;
    link?: string;
    notes?: string;
    is_public?: boolean;
    kind?: string;
  }>(c);
  if (!body.title || !body.starts_at)
    return c.json({ error: "title and starts_at required" }, 400);
  if (exceeds([[body.title, 200], [body.location, 200], [body.link, 500], [body.notes, 4000], [body.starts_at, 40], [body.ends_at, 40]]))
    return c.json({ error: "champ trop long" }, 400);
  const kind = await normalizeKind(id.id, body.kind);
  return c.json(await addEvent(id.id, { ...body, title: body.title, starts_at: body.starts_at, kind }), 201);
});

route.put("/api/agenda/:id", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const body = await readBody<{
    title?: string;
    starts_at?: string;
    ends_at?: string | null;
    location?: string;
    link?: string;
    notes?: string;
    is_public?: boolean;
    kind?: string;
  }>(c);
  if (exceeds([[body.title, 200], [body.location, 200], [body.link, 500], [body.notes, 4000], [body.starts_at, 40], [body.ends_at, 40]]))
    return c.json({ error: "champ trop long" }, 400);
  try {
    const patch = { ...body } as Parameters<typeof updateEvent>[2];
    if (body.kind !== undefined) patch.kind = await normalizeKind(id.id, body.kind);
    const updated = await updateEvent(id.id, Number(c.req.param("id")), patch);
    return updated ? c.json(updated) : c.json({ error: "not found" }, 404);
  } catch (e) {
    if (e instanceof StoreError) return c.json({ error: e.message }, e.status as 400);
    throw e;
  }
});

route.delete("/api/agenda/:id", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  return (await deleteEvent(id.id, Number(c.req.param("id"))))
    ? c.json({ ok: true })
    : c.json({ error: "not found" }, 404);
});

/* --------------------- Disponibilité par jour (calendrier) --------------- */

route.put("/api/availability/:day", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const { status } = await readBody<{ status: string }>(c);
  try {
    await setDayStatus(id.id, c.req.param("day"), status ?? "");
    return c.json({ ok: true });
  } catch (e) {
    if (e instanceof StoreError) return c.json({ error: e.message }, e.status as 400);
    throw e;
  }
});

export default route;
