import { Hono } from "hono";
import {
  StoreError,
  markNotificationsRead,
  addRelation,
  removeRelation,
  createInvite,
  getInvitePreview,
  acceptInvite,
  hasRelation,
  getIdentityByHandle,
  getMutualContactIds,
  markBirthdayAnnouncedIfNew,
} from "../store.js";
import { pushConfigured, vapidPublicKey, addPushSubscription, removePushSubscription } from "../push.js";
import { isMailConfigured, sendMail } from "../mailer.js";
import { relationEmail } from "../emails.js";
import { currentIdentity, readBody, notify } from "./_ctx.js";

const route = new Hono();

// Marquer toutes les notifications comme lues.
route.post("/api/notifications/read", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  await markNotificationsRead(id.id);
  return c.json({ ok: true });
});

/* ----------------------- Annonce d'anniversaire -------------------------- */
// Le serveur ne connaît PAS la date de naissance (champ de carte, potentiellement
// chiffré E2E) : c'est le poste de l'OWNER — seul à pouvoir lire sa propre date —
// qui déclenche le fan-out le jour J. Le serveur se contente de notifier les
// contacts mutuels, avec une dédup once/an (anti-doublon multi-appareils + anti-abus).
route.post("/api/birthday/announce", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  // Année de référence : l'owner peut l'envoyer (son heure locale), bornée à ±1 an
  // autour de l'année serveur pour qu'un client ne « consomme » pas une année future.
  const { year } = await readBody<{ year?: number }>(c);
  const serverYear = new Date().getUTCFullYear();
  const y =
    typeof year === "number" && year >= serverYear - 1 && year <= serverYear + 1
      ? Math.floor(year)
      : serverYear;
  // Dédup atomique : un seul fan-out par année, quel que soit le nombre d'appareils
  // ou de rechargements. Renvoie false si déjà annoncé cette année.
  if (!(await markBirthdayAnnouncedIfNew(id.id, y)))
    return c.json({ ok: true, announced: 0, already: true });
  const contactIds = await getMutualContactIds(id.id);
  for (const cid of contactIds) {
    await notify(cid, "birthday", `🎂 C'est l'anniversaire de @${id.handle} aujourd'hui !`, `/@${id.handle}`);
  }
  return c.json({ ok: true, announced: contactIds.length });
});

/* ------------------------------- Web Push (PWA) -------------------------- */
// Réveil SANS contenu (E2E) : le serveur pousse un « tickle », le service worker
// affiche une notif générique, l'app déchiffre à l'ouverture. Clés VAPID via
// l'environnement (cf. src/push.ts) ; push désactivé proprement si non configuré.

route.get("/api/push/vapid-public-key", (c) => {
  if (!pushConfigured()) return c.json({ error: "push non configuré" }, 404);
  return c.json({ key: vapidPublicKey() });
});

route.post("/api/push/subscribe", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const { endpoint, keys } = await readBody<{ endpoint: string; keys?: { p256dh?: string; auth?: string } }>(c);
  if (typeof endpoint !== "string" || !endpoint || endpoint.length > 1000)
    return c.json({ error: "endpoint invalide" }, 400);
  await addPushSubscription(id.id, endpoint, keys?.p256dh ?? "", keys?.auth ?? "");
  return c.json({ ok: true }, 201);
});

route.delete("/api/push/subscribe", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const { endpoint } = await readBody<{ endpoint: string }>(c);
  if (typeof endpoint === "string" && endpoint) await removePushSubscription(id.id, endpoint);
  return c.json({ ok: true });
});

/* -------------------------------- Relations ------------------------------ */

route.post("/api/relations", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const { handle, type } = await readBody<{ handle: string; type?: string }>(c);
  if (!handle || typeof handle !== "string") return c.json({ error: "handle required" }, 400);
  if (handle.length > 60) return c.json({ error: "handle trop long" }, 400);
  try {
    await addRelation(id.id, handle, type);
    let notified = false;
    const target = await getIdentityByHandle(handle.replace(/^@/, ""));
    // Notifie seulement si la cible n'a pas déjà ajouté l'expéditeur (évite popup inutile côté demandeur initial).
    if (target && !(await hasRelation(target.id, id.id)))
      await notify(target.id, "relation", `@${id.handle} vous a ajouté à ses relations`, `/@${id.handle}`);
    if (target?.recovery_email && isMailConfigured()) {
      try {
        await sendMail({ to: target.recovery_email, ...(await relationEmail(id.handle)) });
        notified = true;
      } catch {
        /* l'échec d'email n'empêche pas la relation */
      }
    }
    return c.json({ ok: true, notified }, 201);
  } catch (e) {
    if (e instanceof StoreError) return c.json({ error: e.message }, e.status as 400);
    throw e;
  }
});

route.delete("/api/relations/:handle", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  return (await removeRelation(id.id, c.req.param("handle")))
    ? c.json({ ok: true })
    : c.json({ error: "not found" }, 404);
});

/* ---------------- Invitations de contact (sans annuaire) ----------------- */
// Établir une relation MUTUELLE par jeton à usage unique (QR/lien), sans passer
// par la recherche publique d'annuaire.
route.post("/api/invites", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const { type } = await readBody<{ type?: string }>(c);
  const token = await createInvite(id.id, type ?? "amis");
  return c.json({ token }, 201);
});
// Aperçu PUBLIC (qui invite) — pour afficher la page d'acceptation.
route.get("/api/invites/:token", async (c) => {
  const preview = await getInvitePreview(c.req.param("token"));
  if (!preview) return c.json({ error: "invitation invalide ou expirée" }, 404);
  return c.json(preview);
});
// Accepter : crée la relation mutuelle, consomme le jeton.
route.post("/api/invites/:token/accept", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  try {
    const inviter = await acceptInvite(c.req.param("token"), id.id);
    const inviterId = (await getIdentityByHandle(inviter))?.id;
    if (inviterId)
      await notify(inviterId, "relation", `@${id.handle} a accepté votre invitation`, `/@${id.handle}`).catch(
        () => undefined
      );
    return c.json({ handle: inviter });
  } catch (e) {
    if (e instanceof StoreError) return c.json({ error: e.message }, e.status as 400);
    throw e;
  }
});

export default route;
