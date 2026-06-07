/**
 * Serveur MCP « cloud », authentifié et **scopé à une seule identité**.
 *
 * Contrairement au serveur stdio admin (`src/mcp.ts`, accès total par handle),
 * chaque instance est construite pour l'identité résolue depuis la clé d'accès
 * du connecteur. Les outils d'écriture agissent toujours sur « moi » : aucun
 * paramètre `handle` n'est accepté pour modifier une autre identité. Les seuls
 * outils acceptant un `handle` sont en lecture seule et respectent la visibilité
 * (public / contact), comme la carte publique du site.
 *
 * Chaque outil porte des annotations (`title`, `readOnlyHint`/`destructiveHint`)
 * requises par l'annuaire de connecteurs Claude.
 *
 * Une instance est créée par requête HTTP (transport stateless) — voir le
 * routage `/mcp` dans `src/server.ts`.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import {
  StoreError,
  acceptRequest,
  addEvent,
  addNotification,
  addRelation,
  addRequest,
  areContacts,
  deleteEvent,
  updateEvent,
  deleteField,
  deleteIdentity,
  deleteRequest,
  effectiveDayStatus,
  getEvents,
  getFields,
  getIdentityByHandle,
  getIncomingRelations,
  getNotifications,
  getOverrides,
  getRelationsByDegree,
  getRequests,
  hasRelation,
  nextFreeDays,
  markNotificationsRead,
  removeRelation,
  rotateAccessKey,
  searchIdentities,
  setDayStatus,
  setRecoveryEmail,
  setRequestStatus,
  getTags,
  addTag,
  removeTag,
  unreadCount,
  upsertField,
  parseSettings,
  setSettings,
  slotsFor,
  bookedSlots,
  SLOT_MINUTES,
  type Identity,
} from "./store.js";
import { isPremium } from "./premium-api.js";
import { publish } from "./realtime.js";
import { appUrl, isMailConfigured, sendMail } from "./mailer.js";
import { bookingAcceptedEmail, bookingRequestEmail } from "./emails.js";

const DATA_DIR = resolve(process.cwd(), "data");

const INSTRUCTIONS =
  "Tu es Milo 🦎, la mascotte caméléon de mindlog · id. Parle TOUJOURS dans la peau de Milo : " +
  "ton chaleureux, enjoué, un brin caméléon. Tu gères la carte d'identité en ligne de la personne " +
  "connectée (la clé d'accès identifie son compte) : attributs, tags, agenda, disponibilités (libre en " +
  "semaine, occupé le week-end par défaut), demandes de RDV — reçues comme envoyées à quelqu'un — et " +
  "relations (amis/pro/autre, 3 degrés). " +
  "Quand on te demande la disponibilité de quelqu'un (« quand est libre @x ? », « prochaine dispo de @x ? »), " +
  "appelle TOUJOURS get_availability avec son handle et annonce ses prochains jours " +
  "libres (nextFreeDays). Pour proposer une HEURE précise, appelle get_day_slots(day) afin d'obtenir les " +
  "créneaux libres (selon la finesse 15/30/60 min du profil), puis request_meeting(handle, day, time) pour réserver. " +
  "Respecte les préférences : si availabilityPublic est faux, la dispo est privée ; certains profils refusent les demandes de RDV. " +
  "N'affirme jamais qu'un agenda n'est pas visible sans avoir appelé get_availability. " +
  "Toutes les modifications portent sur le compte connecté. Confirme les actions avec personnalité " +
  "(« C'est noté ! 🦎 ») et reste concis.";

// Annotations d'outils (annuaire Claude) : lecture seule / écriture / destructif.
const RO = (title: string) => ({ title, readOnlyHint: true });
const WR = (title: string) => ({ title, readOnlyHint: false });
const DES = (title: string) => ({ title, readOnlyHint: false, destructiveHint: true });

/** Construit un serveur MCP dont tous les outils sont scopés à `me`. */
export function buildCloudMcpServer(me: Identity): McpServer {
  const server = new McpServer({ name: "mindlog-id", version: "0.6.1" }, { instructions: INSTRUCTIONS });

  const ok = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  });
  const fail = (message: string) => ({
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }, null, 2) }],
    isError: true,
  });
  // Exécute une opération qui peut lever une StoreError et la convertit en erreur d'outil.
  const guard = async (fn: () => Promise<unknown>) => {
    try {
      return ok(await fn());
    } catch (e) {
      if (e instanceof StoreError) return fail(e.message);
      throw e;
    }
  };

  /* ------------------------------- Profil (moi) -------------------------- */

  server.registerTool(
    "whoami",
    {
      description: "Identité connectée : handle, URL publique, email de récupération, offre (free/premium).",
      inputSchema: {},
      annotations: RO("Mon identité"),
    },
    async () =>
      ok({
        handle: me.handle,
        publicUrl: `/@${me.handle}`,
        hasPhoto: !!me.photo_file,
        recoveryEmail: me.recovery_email,
        plan: (await isPremium(me.id)) ? "premium" : "free",
      })
  );

  server.registerTool(
    "get_my_card",
    {
      description: "Ma carte complète (attributs privés inclus + agenda).",
      inputSchema: {},
      annotations: RO("Lire ma carte"),
    },
    async () => ok({ handle: me.handle, plan: (await isPremium(me.id)) ? "premium" : "free", fields: await getFields(me.id, "owner"), events: await getEvents(me.id, true) })
  );

  server.registerTool(
    "set_card_field",
    {
      description: "Crée ou met à jour un de MES attributs de carte.",
      inputSchema: {
        key: z.string().describe("Ex. 'display_name', 'github', 'bio'."),
        value: z.string().optional(),
        label: z.string().optional(),
        visibility: z.enum(["public", "contact", "private"]).optional(),
        is_public: z.boolean().optional(),
      },
      annotations: WR("Modifier un attribut"),
    },
    ({ key, ...rest }) => guard(() => upsertField(me.id, { key, ...rest }))
  );

  server.registerTool(
    "delete_card_field",
    {
      description: "Supprime un de MES attributs custom (les attributs de base sont vidés).",
      inputSchema: { key: z.string() },
      annotations: DES("Supprimer un attribut"),
    },
    async ({ key }) => ok({ deleted: await deleteField(me.id, key) })
  );

  /* --------------------------------- Tags (moi) ------------------------- */

  server.registerTool(
    "list_tags",
    { description: "Liste MES tags (mots-clés publics du profil).", inputSchema: {}, annotations: RO("Lister mes tags") },
    async () => ok(await getTags(me.id))
  );

  server.registerTool(
    "add_tag",
    {
      description: "Ajoute un tag public à MON profil (max 20).",
      inputSchema: { tag: z.string() },
      annotations: WR("Ajouter un tag"),
    },
    ({ tag }) => guard(() => addTag(me.id, tag))
  );

  server.registerTool(
    "remove_tag",
    {
      description: "Retire un de MES tags.",
      inputSchema: { tag: z.string() },
      annotations: DES("Retirer un tag"),
    },
    async ({ tag }) => ok({ removed: await removeTag(me.id, tag) })
  );

  /* ----------------------------- Découverte (autres) -------------------- */

  server.registerTool(
    "search_identities",
    {
      description: "Recherche d'identités par handle ou nom (résultats publics).",
      inputSchema: { q: z.string() },
      annotations: { ...RO("Rechercher des profils"), openWorldHint: true },
    },
    async ({ q }) => ok(await searchIdentities(q))
  );

  server.registerTool(
    "get_card",
    {
      description:
        "Carte d'une AUTRE identité par handle. Respecte la visibilité : tu vois le niveau public, " +
        "ou 'contact' si vous êtes contacts réciproques.",
      inputSchema: { handle: z.string() },
      annotations: { ...RO("Lire la carte d'un profil"), openWorldHint: true },
    },
    async ({ handle }) => {
      const other = await getIdentityByHandle(handle.replace(/^@/, ""));
      if (!other) return fail("Identité introuvable.");
      const level = other.id === me.id ? "owner" : (await areContacts(me.id, other.id)) ? "contact" : "public";
      return ok({
        handle: other.handle,
        fields: await getFields(other.id, level),
        events: await getEvents(other.id, false),
        isContact: await areContacts(me.id, other.id),
        isRelated: await hasRelation(me.id, other.id),
      });
    }
  );

  /* -------------------------------- Agenda (moi) ------------------------- */

  server.registerTool(
    "list_events",
    { description: "Liste MES événements d'agenda.", inputSchema: {}, annotations: RO("Lister mes événements") },
    async () => ok(await getEvents(me.id, true))
  );

  server.registerTool(
    "add_event",
    {
      description: "Ajoute un événement à MON agenda.",
      inputSchema: {
        title: z.string(),
        starts_at: z.string().describe("ISO 8601, ex. 2026-06-01T14:00:00Z."),
        ends_at: z.string().optional(),
        location: z.string().optional(),
        link: z.string().optional().describe("URL liée à l'événement (page, visio, post réseau social)."),
        notes: z.string().optional(),
        is_public: z.boolean().optional(),
      },
      annotations: WR("Ajouter un événement"),
    },
    (event) => guard(() => addEvent(me.id, event))
  );

  server.registerTool(
    "update_event",
    {
      description: "Modifie un de MES événements (par id). Seuls les champs fournis sont mis à jour.",
      inputSchema: {
        id: z.number(),
        title: z.string().optional(),
        starts_at: z.string().optional().describe("ISO 8601, ex. 2026-06-01T14:00:00Z."),
        ends_at: z.string().nullable().optional(),
        location: z.string().optional(),
        link: z.string().optional().describe("URL liée à l'événement (page, visio, post réseau social)."),
        notes: z.string().optional(),
        is_public: z.boolean().optional(),
      },
      annotations: WR("Modifier un événement"),
    },
    ({ id, ...patch }) => guard(() => updateEvent(me.id, id, patch))
  );

  server.registerTool(
    "delete_event",
    {
      description: "Supprime un de MES événements (par id).",
      inputSchema: { id: z.number() },
      annotations: DES("Supprimer un événement"),
    },
    async ({ id }) => ok({ deleted: await deleteEvent(me.id, id) })
  );

  /* ----------------------------- Disponibilité (moi) -------------------- */

  server.registerTool(
    "get_availability",
    {
      description:
        "Disponibilité (publique) : règle par défaut (libre en semaine, occupé le week-end), exceptions, " +
        "et prochains jours libres. Sans `handle` → la mienne ; avec `handle` → celle d'une autre identité.",
      inputSchema: {
        handle: z.string().optional().describe("Handle d'une autre identité ; vide = moi."),
      },
      annotations: { ...RO("Lire une disponibilité"), openWorldHint: true },
    },
    async ({ handle }) => {
      const target = handle ? await getIdentityByHandle(handle.replace(/^@/, "")) : me;
      if (!target) return fail("Identité introuvable.");
      const settings = parseSettings(target.settings);
      // Une autre identité peut masquer ses disponibilités au public (onglet Options).
      if (target.id !== me.id && !settings.public_availability)
        return ok({ handle: target.handle, availabilityPublic: false, note: "Ce profil garde ses disponibilités privées." });
      const a = settings.availability;
      const DOW = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
      return ok({
        handle: target.handle,
        availabilityPublic: true,
        rule: {
          freeWeekdays: DOW.filter((_, i) => a.weekdays[i]),
          periods: a.periods,
          hours: { start: a.start, end: a.end },
          slotMinutes: a.slot_minutes,
        },
        overrides: await getOverrides(target.id),
        nextFreeDays: await nextFreeDays(target.id, 5),
      });
    }
  );

  server.registerTool(
    "get_day_slots",
    {
      description:
        "Créneaux horaires d'un jour donné (le mien sans `handle`, sinon celui d'un autre profil). " +
        "Renvoie les créneaux libres et ceux déjà pris, selon la finesse (15/30/60 min) et la plage horaire du profil. " +
        "À utiliser avant request_meeting pour proposer une heure précise.",
      inputSchema: {
        day: z.string().describe("Jour 'YYYY-MM-DD'."),
        handle: z.string().optional().describe("Profil visé ; vide = moi."),
      },
      annotations: { ...RO("Lire les créneaux d'un jour"), openWorldHint: true },
    },
    async ({ day, handle }) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return fail("Jour invalide (attendu YYYY-MM-DD).");
      const target = handle ? await getIdentityByHandle(handle.replace(/^@/, "")) : me;
      if (!target) return fail("Identité introuvable.");
      const settings = parseSettings(target.settings);
      const isMine = target.id === me.id;
      if (!isMine && !settings.public_availability)
        return ok({ handle: target.handle, day, status: "private", slots: [] });
      if (!isMine && !settings.allow_requests)
        return ok({ handle: target.handle, day, status: "closed", slots: [] });
      const status = await effectiveDayStatus(target.id, day);
      if (status !== "free") return ok({ handle: target.handle, day, status, slots: [] });
      const booked = new Set(await bookedSlots(target.id, day, settings.availability.slot_minutes));
      return ok({
        handle: target.handle,
        day,
        status: "free",
        slotMinutes: settings.availability.slot_minutes,
        slots: slotsFor(settings.availability).map((t) => ({ time: t, taken: booked.has(t) })),
      });
    }
  );

  server.registerTool(
    "set_availability",
    {
      description:
        "Configure MA règle de disponibilité générale : jours de semaine libres, plage horaire et finesse des créneaux. " +
        "Index des jours : 0=lundi … 6=dimanche. Tous les champs sont optionnels (on ne change que ceux fournis).",
      inputSchema: {
        freeWeekdays: z
          .array(z.number().int().min(0).max(6))
          .optional()
          .describe("Jours libres par défaut (0=lundi … 6=dimanche). Remplace la liste actuelle."),
        start: z.string().optional().describe("Début de journée 'HH:MM'."),
        end: z.string().optional().describe("Fin de journée 'HH:MM'."),
        slotMinutes: z
          .number()
          .optional()
          .describe(`Finesse des créneaux en minutes : ${SLOT_MINUTES.join(", ")}.`),
      },
      annotations: WR("Régler mes disponibilités"),
    },
    ({ freeWeekdays, start, end, slotMinutes }) =>
      guard(async () => {
        const cur = parseSettings(me.settings).availability;
        const weekdays = freeWeekdays
          ? Array.from({ length: 7 }, (_, i) => freeWeekdays.includes(i))
          : cur.weekdays;
        const settings = await setSettings(me.id, {
          availability: {
            ...cur,
            weekdays,
            start: start ?? cur.start,
            end: end ?? cur.end,
            slot_minutes: slotMinutes === undefined ? cur.slot_minutes : (slotMinutes as 15 | 30 | 60),
          },
        });
        return { availability: settings.availability };
      })
  );

  server.registerTool(
    "set_day_status",
    {
      description: "Fixe le statut d'un de MES jours (free/busy). Si = défaut, l'exception est retirée.",
      inputSchema: { day: z.string().describe("Date 'YYYY-MM-DD'."), status: z.enum(["free", "busy"]) },
      annotations: WR("Définir une disponibilité"),
    },
    ({ day, status }) =>
      guard(async () => {
        await setDayStatus(me.id, day, status);
        return { day, effective: await effectiveDayStatus(me.id, day) };
      })
  );

  /* -------------------------------- RDV (moi) --------------------------- */

  server.registerTool(
    "request_meeting",
    {
      description:
        "Envoie une demande de RDV à une AUTRE identité (par handle). La demande arrive dans SES " +
        "demandes reçues ; c'est elle qui l'accepte ou la refuse. Mon nom et mon email de récupération " +
        "sont joints comme expéditeur.",
      inputSchema: {
        handle: z.string().describe("Handle du destinataire, ex. '@alice' ou 'alice'."),
        day: z.string().optional().describe("Jour souhaité 'YYYY-MM-DD' (optionnel)."),
        time: z.string().optional().describe("Créneau souhaité 'HH:MM' (optionnel ; nécessite `day`). Appelle d'abord get_day_slots pour un créneau valide."),
        message: z.string().optional().describe("Message d'accompagnement (optionnel)."),
      },
      annotations: { ...WR("Demander un RDV"), openWorldHint: true },
    },
    ({ handle, day, time, message }) =>
      guard(async () => {
        const target = await getIdentityByHandle(handle.replace(/^@/, ""));
        if (!target) throw new StoreError(404, "Identité introuvable.");
        if (target.id === me.id) throw new StoreError(400, "Impossible de se demander un RDV à soi-même.");
        if (!parseSettings(target.settings).allow_requests)
          throw new StoreError(403, "Ce profil n'accepte pas les demandes de RDV.");

        const myFields = await getFields(me.id, "owner");
        const displayName = myFields.find((f) => f.key === "display_name")?.value.trim();
        const myName = displayName && displayName.length > 0 ? displayName : `@${me.handle}`;
        const myEmail = me.recovery_email;

        const req = await addRequest(target.id, { day, time, name: myName, email: myEmail, message });

        await addNotification(target.id, "request", `Demande de RDV de ${myName}`, `/@${me.handle}`);
        publish(target.id, "notif", { type: "request", text: `Demande de RDV de ${myName}`, link: `/@${me.handle}` });

        if (target.recovery_email && isMailConfigured()) {
          void sendMail({
            to: target.recovery_email,
            ...(await bookingRequestEmail(target.handle, {
              name: myName,
              email: myEmail,
              message: message ?? "",
              day: day ?? null,
            })),
          }).catch(() => { /* envoi best-effort */ });
        }
        return { sent: true, to: target.handle, request: req };
      })
  );

  server.registerTool(
    "list_requests",
    {
      description: "Liste MES demandes de RDV reçues (en attente d'abord, puis les plus récentes). Filtre optionnel par statut.",
      inputSchema: { status: z.enum(["pending", "accepted", "declined"]).optional() },
      annotations: RO("Lister mes demandes de RDV"),
    },
    async ({ status }) => ok(await getRequests(me.id, status))
  );

  server.registerTool(
    "respond_request",
    {
      description:
        "Accepte ou refuse une de MES demandes de RDV (par id). Accepter établit le contact " +
        "réciproque avec le demandeur (et lui crée un compte s'il n'en a pas) et l'avertit par email.",
      inputSchema: { id: z.number(), status: z.enum(["accepted", "declined", "pending"]) },
      annotations: WR("Répondre à une demande de RDV"),
    },
    ({ id, status }) =>
      guard(async () => {
        if (status !== "accepted")
          return { updated: await setRequestStatus(me.id, id, status) };

        const r = await acceptRequest(me.id, id);
        if (!r.updated) throw new StoreError(404, "Demande introuvable.");

        if (r.requester) {
          await addNotification(r.requester.id, "request", `@${me.handle} a accepté votre demande de RDV`, `/@${me.handle}`);
          publish(r.requester.id, "notif", { type: "request", text: `@${me.handle} a accepté votre demande de RDV`, link: `/@${me.handle}` });
          if (r.requester.recovery_email && isMailConfigured()) {
            const magicLink = r.accessKey ? `${appUrl()}/k/${r.accessKey}` : undefined;
            void sendMail({
              to: r.requester.recovery_email,
              ...(await bookingAcceptedEmail(me.handle, { day: r.request?.day ?? null, isNew: !!r.requesterIsNew, magicLink })),
            }).catch(() => { /* envoi best-effort */ });
          }
        }
        return { updated: true, contacts: r.contacts ?? false, requesterCreated: r.requesterIsNew ?? false };
      })
  );

  server.registerTool(
    "delete_request",
    {
      description: "Supprime une de MES demandes de RDV (par id).",
      inputSchema: { id: z.number() },
      annotations: DES("Supprimer une demande de RDV"),
    },
    async ({ id }) => ok({ deleted: await deleteRequest(me.id, id) })
  );

  /* -------------------------------- Relations (moi) --------------------- */

  server.registerTool(
    "list_relations",
    {
      description: "MES relations groupées par degré (1 = direct, 2-3 = indirect).",
      inputSchema: {},
      annotations: RO("Lister mes relations"),
    },
    async () => ok(await getRelationsByDegree(me.id, 3))
  );

  server.registerTool(
    "list_incoming_relations",
    {
      description: "Qui m'a ajouté sans réciprocité (relations entrantes).",
      inputSchema: {},
      annotations: RO("Lister les relations entrantes"),
    },
    async () => ok(await getIncomingRelations(me.id))
  );

  server.registerTool(
    "add_relation",
    {
      description: "Ajoute/modifie une de MES relations directes vers une autre identité.",
      inputSchema: {
        related_handle: z.string(),
        type: z.enum(["amis", "pro", "autre"]).optional().describe("Défaut : amis."),
      },
      annotations: WR("Ajouter une relation"),
    },
    ({ related_handle, type }) =>
      guard(async () => {
        const rel = await addRelation(me.id, related_handle, type);
        const target = await getIdentityByHandle(related_handle.replace(/^@/, ""));
        if (target) {
          await addNotification(target.id, "relation", `@${me.handle} vous a ajouté à ses relations`, `/@${me.handle}`);
          publish(target.id, "notif", { type: "relation", text: `@${me.handle} vous a ajouté`, link: `/@${me.handle}` });
        }
        return rel;
      })
  );

  server.registerTool(
    "remove_relation",
    {
      description: "Supprime une de MES relations directes.",
      inputSchema: { related_handle: z.string() },
      annotations: DES("Supprimer une relation"),
    },
    async ({ related_handle }) => ok({ removed: await removeRelation(me.id, related_handle) })
  );

  /* ----------------------------- Notifications (moi) -------------------- */

  server.registerTool(
    "list_notifications",
    {
      description: "MES notifications récentes + nombre non lues.",
      inputSchema: {},
      annotations: RO("Lister mes notifications"),
    },
    async () => ok({ notifications: await getNotifications(me.id), unread: await unreadCount(me.id) })
  );

  server.registerTool(
    "mark_notifications_read",
    {
      description: "Marque toutes MES notifications comme lues.",
      inputSchema: {},
      annotations: WR("Marquer les notifications lues"),
    },
    async () => {
      await markNotificationsRead(me.id);
      return ok({ ok: true });
    }
  );

  /* -------------------------------- Compte (moi) ------------------------ */

  server.registerTool(
    "set_recovery_email",
    {
      description: "Définit/modifie MON email de récupération.",
      inputSchema: { email: z.string() },
      annotations: WR("Définir l'email de récupération"),
    },
    ({ email }) =>
      guard(async () => {
        await setRecoveryEmail(me.id, email);
        return { ok: true };
      })
  );

  server.registerTool(
    "rotate_access_key",
    {
      description:
        "Régénère MA clé d'accès. ⚠️ L'ancienne clé (dont celle de ce connecteur) cesse aussitôt de " +
        "fonctionner : il faudra reconfigurer le connecteur avec la nouvelle clé renvoyée.",
      inputSchema: {},
      annotations: DES("Régénérer ma clé d'accès"),
    },
    async () => ok({ handle: me.handle, accessKey: await rotateAccessKey(me.id) })
  );

  server.registerTool(
    "delete_account",
    {
      description: "Supprime DÉFINITIVEMENT mon compte et toutes mes données (RGPD). Irréversible.",
      inputSchema: { confirm: z.literal(true).describe("Doit valoir true pour confirmer.") },
      annotations: DES("Supprimer mon compte"),
    },
    async () => {
      if (me.photo_file) {
        try { rmSync(resolve(DATA_DIR, me.photo_file)); } catch { /* ignoré */ }
      }
      await deleteIdentity(me.id);
      return ok({ deleted: true });
    }
  );

  return server;
}

/** Identité sentinelle (jamais persistée) pour introspecter la surface d'outils. */
const PROBE_IDENTITY: Identity = {
  id: 0,
  handle: "_probe",
  access_key: "",
  photo_file: null,
  cover_file: null,
  cover_type: "",
  recovery_email: "",
  pubkey: "",
  settings: "{}",
  created_at: "",
};

/**
 * Nombre d'outils exposés par le serveur cloud, calculé **en process** (aucune
 * requête, aucun process enfant). Utilisé par la sonde `/api/status`. La
 * construction n'effectue que des `registerTool` synchrones, sans accès DB.
 */
export function cloudMcpToolCount(): number {
  const server = buildCloudMcpServer(PROBE_IDENTITY);
  // `_registeredTools` est interne au SDK MCP ; lecture seule pour le comptage.
  const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
  return Object.keys(tools).length;
}
