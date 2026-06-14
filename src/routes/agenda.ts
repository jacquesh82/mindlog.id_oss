import { Hono } from "hono";
import {
  StoreError,
  addEvent,
  deleteEvent,
  updateEvent,
  setDayStatus,
  inviteToEvent,
  removeEventInvite,
  listEventInvites,
  listMyInvites,
  respondEventInvite,
} from "../store.js";
import { notifyLiveScheduled } from "../premium-api.js";
import { currentIdentity, readBody, exceeds, notify } from "./_ctx.js";

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
    notify_subs?: boolean;   // demandé côté modale en mode live (case cochée par défaut)
  }>(c);
  if (!body.title || !body.starts_at)
    return c.json({ error: "title and starts_at required" }, 400);
  if (exceeds([[body.title, 200], [body.location, 200], [body.link, 500], [body.notes, 4000], [body.starts_at, 40], [body.ends_at, 40]]))
    return c.json({ error: "champ trop long" }, 400);
  const kind = await normalizeKind(id.id, body.kind);
  const created = await addEvent(id.id, { ...body, title: body.title, starts_at: body.starts_at, kind });
  // Live planifié + opt-in du créateur → notifie les abonné·e·s. On ne stocke
  // pas notify_subs en base : c'est un trigger one-shot à la création/édition.
  // L'implémentation vit dans src/premium/ et est branchée via premium-api ;
  // en build OSS (premium non installé), l'appel est un no-op silencieux.
  if (kind === "live" && body.notify_subs === true) {
    notifyLiveScheduled(id.id, { title: body.title, starts_at: body.starts_at });
  }
  return c.json(created, 201);
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

/* --------------------------- Invitations (RSVP) -------------------------- */
// Helper de formatage court d'une date d'événement pour les textes de notification.
function fmtEventDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return ` le ${d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`;
}

// Liste des invités d'un événement + leur statut (vue organisateur).
route.get("/api/agenda/:id/invites", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  try {
    return c.json({ invites: await listEventInvites(Number(c.req.param("id")), id.id) });
  } catch (e) {
    if (e instanceof StoreError) return c.json({ error: e.message }, e.status as 400);
    throw e;
  }
});

// Inviter un ou plusieurs contacts (relations sortantes) à un événement.
route.post("/api/agenda/:id/invites", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const eventId = Number(c.req.param("id"));
  const { handles } = await readBody<{ handles: string[] }>(c);
  if (!Array.isArray(handles) || !handles.length) return c.json({ error: "handles requis" }, 400);
  const results: { handle: string; ok: boolean; error?: string }[] = [];
  for (const h of handles.slice(0, 50)) {
    if (typeof h !== "string" || !h.trim()) continue;
    try {
      const { invitee, created, event } = await inviteToEvent(eventId, id.id, h);
      // On ne (re)notifie qu'à la création de l'invitation (pas si elle existait déjà).
      if (created)
        await notify(
          invitee.id,
          "invite",
          `📅 @${id.handle} t'invite à « ${event.title} »${fmtEventDate(event.starts_at)}`,
          `/@${id.handle}`
        );
      results.push({ handle: invitee.handle, ok: true });
    } catch (e) {
      results.push({ handle: h, ok: false, error: e instanceof StoreError ? e.message : "erreur" });
    }
  }
  // Renvoie la liste à jour pour rafraîchir l'UI organisateur.
  try {
    return c.json({ ok: true, results, invites: await listEventInvites(eventId, id.id) });
  } catch (e) {
    if (e instanceof StoreError) return c.json({ error: e.message }, e.status as 400);
    throw e;
  }
});

// Retirer une invitation (organisateur).
route.delete("/api/agenda/:id/invites/:handle", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const ok = await removeEventInvite(Number(c.req.param("id")), id.id, c.req.param("handle"));
  return ok ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
});

// Invitations EN ATTENTE reçues par l'utilisateur courant.
route.get("/api/my/invites", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  return c.json({ invites: await listMyInvites(id.id) });
});

// RSVP : l'invité accepte (accept=true) ou refuse une invitation en attente.
route.post("/api/agenda/invite/:eventId/respond", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const { accept } = await readBody<{ accept: boolean }>(c);
  const r = await respondEventInvite(id.id, Number(c.req.param("eventId")), accept === true);
  if (!r) return c.json({ error: "aucune invitation en attente" }, 404);
  const verb = accept === true ? "a accepté" : "a décliné";
  await notify(
    r.organizerId,
    "invite",
    `@${id.handle} ${verb} ton invitation à « ${r.event.title} »`,
    `/@${id.handle}`
  );
  return c.json({ ok: true, status: accept === true ? "accepted" : "declined" });
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
