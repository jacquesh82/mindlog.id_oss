import { Hono } from "hono";
import {
  addRequest,
  getIdentityByHandle,
  slotsFor,
  bookedSlots,
  setRequestStatus,
  acceptRequest,
  deleteRequest,
  parseSettings,
  effectiveDayStatus,
} from "../store.js";
import { isMailConfigured, sendMail } from "../mailer.js";
import { bookingRequestEmail } from "../emails.js";
import { currentIdentity, readBody, exceeds, notify, afterAccept } from "./_ctx.js";

const route = new Hono();

route.post("/api/identities/:handle/requests", async (c) => {
  const id = await getIdentityByHandle(c.req.param("handle"));
  if (!id) return c.json({ error: "not found" }, 404);
  // On ne se demande pas un RDV à soi-même.
  const viewer = await currentIdentity(c);
  if (viewer?.id === id.id) return c.json({ error: "Vous ne pouvez pas vous demander un RDV à vous-même." }, 400);
  if (!parseSettings(id.settings).allow_requests)
    return c.json({ error: "Ce profil n'accepte pas les demandes de RDV." }, 403);
  const body = await readBody<{
    name: string;
    email?: string;
    message?: string;
    day?: string | null;
    time?: string | null;
  }>(c);
  if (!body.name || typeof body.name !== "string" || !body.name.trim())
    return c.json({ error: "name required" }, 400);
  if (exceeds([[body.name, 100], [body.email, 200], [body.message, 4000]]))
    return c.json({ error: "champ trop long" }, 400);
  await addRequest(id.id, { ...body, name: body.name });
  const _slot = typeof body.day === "string" && typeof body.time === "string" ? ` (${body.day} à ${body.time})` : "";
  await notify(id.id, "request", `Demande de RDV de ${body.name.trim()}${_slot}`, null);
  // Email au propriétaire (en plus de la notif in-app), si configuré.
  if (id.recovery_email && isMailConfigured()) {
    void sendMail({
      to: id.recovery_email,
      ...(await bookingRequestEmail(id.handle, {
        name: body.name.trim(),
        email: typeof body.email === "string" ? body.email : "",
        message: typeof body.message === "string" ? body.message : "",
        day: typeof body.day === "string" ? body.day : null,
      })),
    }).catch(() => { /* envoi best-effort */ });
  }
  return c.json({ ok: true }, 201);
});

// Créneaux horaires disponibles d'un profil pour un jour donné (modale de RDV).
// Respecte la visibilité (public_availability), le statut du jour et la finesse réglée.
route.get("/api/identities/:handle/slots", async (c) => {
  const idn = await getIdentityByHandle(c.req.param("handle"));
  if (!idn) return c.json({ error: "not found" }, 404);
  const day = c.req.query("day") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return c.json({ error: "day invalide" }, 400);
  const settings = parseSettings(idn.settings);
  const viewer = await currentIdentity(c);
  const isOwner = viewer?.id === idn.id;
  if (!settings.public_availability && !isOwner) return c.json({ day, status: "private", slots: [] });
  if (!settings.allow_requests && !isOwner) return c.json({ day, status: "closed", slots: [] });
  const status = await effectiveDayStatus(idn.id, day);
  if (status !== "free") return c.json({ day, status, slots: [] });
  const booked = new Set(await bookedSlots(idn.id, day));
  return c.json({
    day,
    status: "free",
    slotMinutes: settings.availability.slot_minutes,
    slots: slotsFor(settings.availability).map((t) => ({ time: t, taken: booked.has(t) })),
  });
});

route.patch("/api/requests/:id", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const { status } = await readBody<{ status: string }>(c);
  if (status !== "pending" && status !== "accepted" && status !== "declined")
    return c.json({ error: "invalid status" }, 400);

  if (status === "accepted") {
    const r = await acceptRequest(id.id, Number(c.req.param("id")));
    if (!r.updated) return c.json({ error: "not found" }, 404);
    await afterAccept(id.handle, r);
    return c.json({ ok: true, contacts: r.contacts ?? false, requesterCreated: r.requesterIsNew ?? false });
  }

  return (await setRequestStatus(id.id, Number(c.req.param("id")), status))
    ? c.json({ ok: true })
    : c.json({ error: "not found" }, 404);
});

route.delete("/api/requests/:id", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  return (await deleteRequest(id.id, Number(c.req.param("id"))))
    ? c.json({ ok: true })
    : c.json({ error: "not found" }, 404);
});

export default route;
