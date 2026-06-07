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
  type Settings,
  createGroup,
  listGroups,
  getGroup,
  addGroupMember,
  removeGroupMember,
  leaveGroup,
  promoteGroupMember,
  demoteGroupMember,
  transferGroupOwnership,
  renameGroup,
  groupMemberIds,
  createInvite,
  getInvitePreview,
  getDirectRelations,
} from "./store.js";
import {
  isPremium,
  listButtons as listPageButtons,
  getSpaceInfo,
  mcpPremiumAvailable,
  mcpListPages,
  mcpGetPage,
  mcpUpsertPage,
  mcpDeletePage,
  mcpGetSpace,
  mcpSetSpacePrice,
  mcpSetSpaceIntro,
  mcpSetSpaceBenefits,
  mcpListOutgoingSubs,
  mcpSetPageButtons,
  mcpStartConnectOnboarding,
  mcpSubscribeCheckout,
  mcpBillingPortal,
  mcpBillingConfigured,
} from "./premium-api.js";
import {
  getGallery,
  setGalleryLink,
  deleteGalleryPhoto,
  getOwnedGalleryPhotoFile,
} from "./db.js";
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
  // Exécute une opération qui peut lever une StoreError (ou une Error premium-api)
  // et la convertit en erreur d'outil JSON sérialisable, attendue par le client.
  const guard = async (fn: () => Promise<unknown>) => {
    try {
      return ok(await fn());
    } catch (e) {
      if (e instanceof StoreError) return fail(e.message);
      if (e instanceof Error) return fail(e.message);
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

  /* ------------------------------ Groupes -------------------------------- */
  // Milo peut gérer la membership (créer, ajouter, retirer, promouvoir, transférer),
  // mais PAS envoyer/lire de messages : ceux-ci sont chiffrés E2E côté client
  // (sender keys) et le serveur ne voit que des blobs opaques.

  server.registerTool(
    "list_groups",
    {
      description: "Liste MES groupes (id, nom, membres, mon rôle owner/admin/member).",
      inputSchema: {},
      annotations: RO("Mes groupes"),
    },
    async () => ok({ groups: await listGroups(me.id) })
  );

  server.registerTool(
    "get_group",
    {
      description: "Détail d'un groupe dont je suis membre (membres, owner, historique d'événements).",
      inputSchema: { id: z.string().describe("UUID du groupe.") },
      annotations: RO("Détail d'un groupe"),
    },
    ({ id }) =>
      guard(async () => {
        const g = await getGroup(me.id, id);
        if (!g) throw new StoreError(404, "Groupe introuvable ou accès refusé.");
        return g;
      })
  );

  server.registerTool(
    "create_group",
    {
      description:
        "Crée un nouveau groupe (je deviens owner). Les membres listés doivent être MES contacts " +
        "réciproques. Le contenu des messages reste chiffré côté client — je ne participe pas à l'envoi.",
      inputSchema: {
        name: z.string().min(1).max(80).describe("Nom du groupe (1..80 caractères)."),
        members: z.array(z.string()).describe("Handles à inviter, ex. ['alice','@bob']."),
      },
      annotations: WR("Créer un groupe"),
    },
    ({ name, members }) =>
      guard(async () => {
        const g = await createGroup(me.id, name, members);
        for (const mid of await groupMemberIds(g.id)) if (mid !== me.id) publish(mid, "group", { gid: g.id });
        return g;
      })
  );

  server.registerTool(
    "add_group_member",
    {
      description: "Ajoute un contact à un de MES groupes (owner ou admin uniquement).",
      inputSchema: { id: z.string(), handle: z.string() },
      annotations: WR("Ajouter au groupe"),
    },
    ({ id, handle }) =>
      guard(async () => {
        await addGroupMember(me.id, id, handle);
        for (const mid of await groupMemberIds(id)) publish(mid, "group", { gid: id });
        return { added: handle };
      })
  );

  server.registerTool(
    "remove_group_member",
    {
      description: "Retire un membre (owner ou admin). L'owner ne peut pas être retiré.",
      inputSchema: { id: z.string(), handle: z.string() },
      annotations: DES("Retirer du groupe"),
    },
    ({ id, handle }) =>
      guard(async () => {
        const before = await groupMemberIds(id);
        const ok2 = await removeGroupMember(me.id, id, handle);
        if (ok2) for (const mid of before) publish(mid, "group", { gid: id });
        return { removed: ok2 };
      })
  );

  server.registerTool(
    "leave_group",
    {
      description:
        "Quitte un groupe. Si je suis owner, je dois d'abord transférer la propriété (sauf si je suis seul).",
      inputSchema: { id: z.string() },
      annotations: DES("Quitter un groupe"),
    },
    ({ id }) =>
      guard(async () => {
        const before = await groupMemberIds(id);
        const ok2 = await leaveGroup(me.id, id);
        if (ok2) for (const mid of before) if (mid !== me.id) publish(mid, "group", { gid: id });
        return { left: ok2 };
      })
  );

  server.registerTool(
    "promote_group_member",
    {
      description: "Promeut un membre simple en admin (owner uniquement).",
      inputSchema: { id: z.string(), handle: z.string() },
      annotations: WR("Promouvoir admin"),
    },
    ({ id, handle }) =>
      guard(async () => {
        await promoteGroupMember(me.id, id, handle);
        for (const mid of await groupMemberIds(id)) publish(mid, "group", { gid: id });
        return { promoted: handle };
      })
  );

  server.registerTool(
    "demote_group_member",
    {
      description: "Rétrograde un admin en membre simple (owner uniquement).",
      inputSchema: { id: z.string(), handle: z.string() },
      annotations: WR("Rétrograder admin"),
    },
    ({ id, handle }) =>
      guard(async () => {
        await demoteGroupMember(me.id, id, handle);
        for (const mid of await groupMemberIds(id)) publish(mid, "group", { gid: id });
        return { demoted: handle };
      })
  );

  server.registerTool(
    "transfer_group_ownership",
    {
      description:
        "Transfère la propriété d'un groupe à un autre membre (owner uniquement). L'ancien owner devient admin.",
      inputSchema: { id: z.string(), handle: z.string() },
      annotations: DES("Transférer la propriété"),
    },
    ({ id, handle }) =>
      guard(async () => {
        await transferGroupOwnership(me.id, id, handle);
        for (const mid of await groupMemberIds(id)) publish(mid, "group", { gid: id });
        return { ownerNow: handle };
      })
  );

  server.registerTool(
    "rename_group",
    {
      description: "Renomme un groupe (owner ou admin).",
      inputSchema: { id: z.string(), name: z.string().min(1).max(80) },
      annotations: WR("Renommer un groupe"),
    },
    ({ id, name }) =>
      guard(async () => {
        await renameGroup(me.id, id, name);
        for (const mid of await groupMemberIds(id)) publish(mid, "group", { gid: id });
        return { name };
      })
  );

  /* ------------------------------ Préférences --------------------------- */

  server.registerTool(
    "get_my_preferences",
    {
      description:
        "MES préférences (onglet Options) : autorisations chat/call/vidéo, demandes de RDV ouvertes, " +
        "disponibilités publiques, présence dans l'annuaire, forme/taille avatar.",
      inputSchema: {},
      annotations: RO("Mes préférences"),
    },
    async () => {
      const s = parseSettings(me.settings);
      return ok({
        allow_chat: s.allow_chat,
        allow_call: s.allow_call,
        allow_video: s.allow_video,
        allow_requests: s.allow_requests,
        public_availability: s.public_availability,
        listed_in_directory: s.listed_in_directory,
        avatar_size: s.avatar_size,
        avatar_shape: s.avatar_shape,
      });
    }
  );

  server.registerTool(
    "set_my_preferences",
    {
      description:
        "Met à jour MES préférences. Seuls les champs fournis sont modifiés. " +
        "`listed_in_directory` n'est appliqué que si le compte est Premium (sinon ignoré).",
      inputSchema: {
        allow_chat: z.boolean().optional(),
        allow_call: z.boolean().optional(),
        allow_video: z.boolean().optional(),
        allow_requests: z.boolean().optional(),
        public_availability: z.boolean().optional(),
        listed_in_directory: z.boolean().optional(),
        avatar_size: z.enum(["s", "m", "l", "xl"]).optional(),
        avatar_shape: z.enum(["square", "circle"]).optional(),
      },
      annotations: WR("Modifier mes préférences"),
    },
    (patch) =>
      guard(async () => {
        const premium = await isPremium(me.id);
        const settings = await setSettings(me.id, patch as Partial<Settings>, { isPremium: premium });
        return { settings };
      })
  );

  /* ------------------------------ Invitations --------------------------- */

  server.registerTool(
    "create_invite",
    {
      description:
        "Crée un jeton d'invitation à usage unique (7 jours). Partager le lien `/i/:token` " +
        "permet à qui l'accepte d'établir une relation mutuelle directe avec moi.",
      inputSchema: {
        type: z.enum(["amis", "pro", "autre"]).optional().describe("Type de relation par défaut. Défaut : amis."),
      },
      annotations: WR("Créer une invitation"),
    },
    ({ type }) =>
      guard(async () => {
        const token = await createInvite(me.id, type ?? "amis");
        return { token, url: `${appUrl().replace(/\/$/, "")}/i/${token}` };
      })
  );

  server.registerTool(
    "get_invite_preview",
    {
      description: "Aperçu public d'une invitation (qui invite, photo, nom affiché). Null si invalide/expirée.",
      inputSchema: { token: z.string() },
      annotations: { ...RO("Aperçu invitation"), openWorldHint: true },
    },
    async ({ token }) => ok(await getInvitePreview(token))
  );

  /* ------------------------------ Galerie ------------------------------- */
  // Lecture : la mienne ou celle d'un autre handle (publique).
  // Écriture (lien/suppression) : uniquement sur MES photos.
  // Pas d'upload : binaire non géré par MCP.

  server.registerTool(
    "list_gallery",
    {
      description:
        "Liste les photos de la galerie : la mienne sans `handle`, sinon celle d'un autre profil. " +
        "Le `link_url` (lien cliquable Premium) n'est visible publiquement que si le titulaire est Premium.",
      inputSchema: { handle: z.string().optional() },
      annotations: { ...RO("Lister la galerie"), openWorldHint: true },
    },
    async ({ handle }) => {
      const target = handle ? await getIdentityByHandle(handle.replace(/^@/, "")) : me;
      if (!target) return fail("Identité introuvable.");
      const mine = target.id === me.id;
      const premium = await isPremium(target.id);
      const photos = (await getGallery(target.id)).map((p) => ({
        id: p.id,
        url: `/api/gallery/photo/${p.id}`,
        likes: p.likes,
        link_url: mine || premium ? p.link_url : "",
        position: p.position,
        mine,
      }));
      return ok({ handle: target.handle, photos });
    }
  );

  server.registerTool(
    "set_gallery_link",
    {
      description:
        "Définit (ou efface avec `url:''`) le lien cliquable d'une de MES photos. Réservé aux comptes Premium.",
      inputSchema: {
        id: z.number().describe("Id de la photo."),
        url: z.string().describe("URL http/https/mailto/tel ; chaîne vide = efface le lien."),
      },
      annotations: WR("Lien d'une photo"),
    },
    ({ id, url }) =>
      guard(async () => {
        if (!(await isPremium(me.id))) throw new StoreError(402, "Premium requis.");
        const raw = (url ?? "").trim();
        // Validation simple ; même règle que sanitizeButtonUrl côté serveur.
        const cleaned = !raw
          ? ""
          : /^https?:\/\//i.test(raw) || /^mailto:/i.test(raw) || /^tel:/i.test(raw)
            ? raw.slice(0, 2000)
            : null;
        if (cleaned === null) throw new StoreError(400, "URL invalide (http/https/mailto/tel attendu).");
        const updated = await setGalleryLink(id, me.id, cleaned);
        if (!updated) throw new StoreError(404, "Photo introuvable.");
        return { id, link_url: cleaned };
      })
  );

  server.registerTool(
    "delete_gallery_photo",
    {
      description: "Supprime une de MES photos de galerie (fichier inclus).",
      inputSchema: { id: z.number() },
      annotations: DES("Supprimer une photo"),
    },
    ({ id }) =>
      guard(async () => {
        const filename = await getOwnedGalleryPhotoFile(id, me.id);
        if (!filename) throw new StoreError(404, "Photo introuvable.");
        await deleteGalleryPhoto(me.id, id);
        try { rmSync(resolve(DATA_DIR, filename)); } catch { /* ignoré */ }
        return { deleted: true };
      })
  );

  /* --------------------------- Boutons de page -------------------------- */

  server.registerTool(
    "get_page_buttons",
    {
      description:
        "Boutons personnalisés affichés sur la cover : les miens sans `handle`, sinon ceux d'un autre profil " +
        "(uniquement visibles si ce profil est Premium).",
      inputSchema: { handle: z.string().optional() },
      annotations: { ...RO("Boutons de page"), openWorldHint: true },
    },
    async ({ handle }) => {
      const target = handle ? await getIdentityByHandle(handle.replace(/^@/, "")) : me;
      if (!target) return fail("Identité introuvable.");
      const isMine = target.id === me.id;
      if (!isMine && !(await isPremium(target.id))) return ok({ handle: target.handle, buttons: [] });
      return ok({ handle: target.handle, buttons: await listPageButtons(target.id) });
    }
  );

  server.registerTool(
    "set_page_buttons",
    {
      description:
        "Remplace MES boutons de page (max 5). Chaque bouton : label + URL (http/https/mailto/tel). " +
        "`pos_x`/`pos_y` sont normalisés 0..1 sur la cover-hero. `shape` : 'circle' (défaut) ou 'square'. " +
        "Réservé Premium.",
      inputSchema: {
        buttons: z.array(z.object({
          label: z.string().min(1).max(80),
          url: z.string(),
          icon: z.string().optional(),
          pos_x: z.number().min(0).max(1).optional(),
          pos_y: z.number().min(0).max(1).optional(),
          shape: z.enum(["circle", "square"]).optional(),
          show_label: z.boolean().optional(),
        })).max(5),
      },
      annotations: WR("Définir mes boutons"),
    },
    ({ buttons }) =>
      guard(async () => {
        if (!mcpPremiumAvailable()) throw new StoreError(503, "Module premium indisponible.");
        const out = await mcpSetPageButtons(me.id, buttons);
        return { buttons: out };
      })
  );

  /* ----------------------------- Espace Premium ------------------------- */
  // CRUD MON espace (tarif, intros, bénéfices) + lecture publique d'un autre.

  server.registerTool(
    "get_my_space",
    {
      description:
        "MON espace premium : tarif mensuel, statut Stripe, intros (espace + profil), bénéfices, " +
        "et état du compte Stripe Connect (chargesEnabled / payoutsEnabled).",
      inputSchema: {},
      annotations: RO("Mon espace premium"),
    },
    async () => {
      if (!mcpPremiumAvailable()) return ok({ available: false });
      return ok({ available: true, ...(await mcpGetSpace(me.id)) });
    }
  );

  server.registerTool(
    "set_space_price",
    {
      description:
        "Fixe MON tarif mensuel (en centimes, min 100 = 1,00 €). Crée/recrée Product+Price côté " +
        "Stripe si mon Connect est `chargesEnabled` (sinon activation différée).",
      inputSchema: {
        price_cents: z.number().int().min(100).max(100_000),
        currency: z.string().length(3).optional().describe("Code ISO 4217 ; défaut 'eur'."),
      },
      annotations: WR("Fixer mon tarif"),
    },
    ({ price_cents, currency }) =>
      guard(async () => {
        if (!mcpPremiumAvailable()) throw new StoreError(503, "Module premium indisponible.");
        return mcpSetSpacePrice(me.id, price_cents, currency ?? "eur");
      })
  );

  server.registerTool(
    "set_space_intro",
    {
      description:
        "Met à jour un texte introductif Markdown (max 4000 caractères) : " +
        "`kind='space'` → bloc en haut de /@handle/space ; `kind='profile'` → bloc bio sur /@handle.",
      inputSchema: {
        intro_md: z.string().max(4000),
        kind: z.enum(["space", "profile"]).describe("Cible : 'space' (page espace) ou 'profile' (bio profil)."),
      },
      annotations: WR("Texte d'intro espace"),
    },
    ({ intro_md, kind }) =>
      guard(async () => {
        if (!mcpPremiumAvailable()) throw new StoreError(503, "Module premium indisponible.");
        return mcpSetSpaceIntro(me.id, intro_md, kind);
      })
  );

  server.registerTool(
    "set_space_benefits",
    {
      description:
        "Configure les bénéfices opt-in offerts à MES abonnés. `chat`/`call` activés = ces canaux deviennent " +
        "RÉSERVÉS aux abonnés. `pages`/`rdv`/`lives` = affichage marketing uniquement.",
      inputSchema: {
        chat: z.boolean(),
        call: z.boolean(),
        pages: z.boolean(),
        rdv: z.boolean(),
        lives: z.boolean(),
      },
      annotations: WR("Bénéfices d'abonnement"),
    },
    (benefits) =>
      guard(async () => {
        if (!mcpPremiumAvailable()) throw new StoreError(503, "Module premium indisponible.");
        return mcpSetSpaceBenefits(me.id, benefits);
      })
  );

  server.registerTool(
    "get_space",
    {
      description:
        "Vue PUBLIQUE de l'espace premium d'un autre créateur : tarif, statut, pages publiées, intros, bénéfices, " +
        "et statut d'abonnement du visiteur (moi).",
      inputSchema: { handle: z.string() },
      annotations: { ...RO("Espace d'un créateur"), openWorldHint: true },
    },
    async ({ handle }) => {
      const owner = await getIdentityByHandle(handle.replace(/^@/, ""));
      if (!owner) return fail("Identité introuvable.");
      const info = await getSpaceInfo(owner.id, me.id);
      if (!info) return ok({ handle: owner.handle, available: false });
      return ok({ handle: owner.handle, available: true, ...info });
    }
  );

  server.registerTool(
    "list_my_subscriptions",
    {
      description: "Liste les espaces premium auxquels JE suis abonné (handle, provider, statut, échéance).",
      inputSchema: {},
      annotations: RO("Mes abonnements"),
    },
    async () => {
      if (!mcpPremiumAvailable()) return ok({ subscriptions: [] });
      return ok({ subscriptions: await mcpListOutgoingSubs(me.id) });
    }
  );

  /* ----------------------------- Pages premium -------------------------- */

  server.registerTool(
    "list_my_pages",
    {
      description: "Liste MES pages premium (slug, titre, type, publié, contenu brut).",
      inputSchema: {},
      annotations: RO("Mes pages premium"),
    },
    async () => {
      if (!mcpPremiumAvailable()) return ok({ pages: [] });
      return ok({ pages: await mcpListPages(me.id) });
    }
  );

  server.registerTool(
    "get_my_page",
    {
      description: "Lit une de MES pages premium par slug (contenu brut sérialisé).",
      inputSchema: { slug: z.string() },
      annotations: RO("Lire ma page premium"),
    },
    ({ slug }) =>
      guard(async () => {
        if (!mcpPremiumAvailable()) throw new StoreError(404, "Module premium indisponible.");
        const p = await mcpGetPage(me.id, slug);
        if (!p) throw new StoreError(404, "Page introuvable.");
        return p;
      })
  );

  server.registerTool(
    "upsert_my_page",
    {
      description:
        "Crée ou met à jour une de MES pages premium. Types : 'markdown' (content = string MD), " +
        "'link' (content = {url, note?}), 'gallery' (content = {items:[{url,kind,caption?}]} — uniquement liens externes via MCP, " +
        "pas d'upload de média), 'file' (content = {url, name, size} — uniquement lien externe via MCP). " +
        "Réservé Premium.",
      inputSchema: {
        slug: z.string().describe("slug minuscule, a-z/0-9/tirets, max 49 caractères."),
        title: z.string().min(1).max(200),
        type: z.enum(["markdown", "gallery", "link", "file"]),
        content: z.unknown().optional().describe("Contenu selon le type ; chaîne MD ou objet JSON."),
        published: z.boolean().optional().describe("Brouillon par défaut (false)."),
      },
      annotations: WR("Page premium"),
    },
    ({ slug, title, type, content, published }) =>
      guard(async () => {
        if (!mcpPremiumAvailable()) throw new StoreError(503, "Module premium indisponible.");
        return mcpUpsertPage(me.id, { slug, title, type, content, published });
      })
  );

  server.registerTool(
    "delete_my_page",
    {
      description: "Supprime une de MES pages premium (par slug).",
      inputSchema: { slug: z.string() },
      annotations: DES("Supprimer une page premium"),
    },
    async ({ slug }) => {
      if (!mcpPremiumAvailable()) return ok({ deleted: false });
      return ok({ deleted: await mcpDeletePage(me.id, slug) });
    }
  );

  /* -------------------------------- Export RGPD ------------------------- */

  /* --------------------------- Billing (hand-off) ----------------------- */
  // Ces outils renvoient des URLs Stripe hostées : MILO LES TRANSMET à l'humain,
  // qui les ouvre dans son navigateur pour finaliser le flux (CB, 3DS, KYC).
  // Aucun paiement ne peut être validé en agent-mode — c'est volontaire.

  server.registerTool(
    "start_connect_onboarding",
    {
      description:
        "Démarre/relance l'onboarding Stripe Connect (créateur). Renvoie une URL hostée Stripe à ouvrir " +
        "dans un navigateur pour saisir les infos KYC. Requiert Premium et billing configuré côté serveur.",
      inputSchema: {},
      annotations: WR("Onboarding Stripe Connect"),
    },
    async () => {
      if (!mcpPremiumAvailable() || !mcpBillingConfigured()) return fail("Paiement indisponible côté serveur.");
      const r = await mcpStartConnectOnboarding(me.id);
      return "error" in r ? fail(r.error) : ok({ url: r.url });
    }
  );

  server.registerTool(
    "subscribe_to_space",
    {
      description:
        "Demande une URL de Checkout Stripe pour m'abonner à l'espace premium de `@handle`. À ouvrir " +
        "dans un navigateur pour payer. Si je suis déjà abonné, renvoie `{already:true}`.",
      inputSchema: { handle: z.string() },
      annotations: { ...WR("S'abonner à un espace"), openWorldHint: true },
    },
    async ({ handle }) => {
      if (!mcpPremiumAvailable() || !mcpBillingConfigured()) return fail("Paiement indisponible côté serveur.");
      const r = await mcpSubscribeCheckout(me.id, handle);
      if ("error" in r) return fail(r.error);
      if ("already" in r) return ok({ already: true });
      return ok({ url: r.url });
    }
  );

  server.registerTool(
    "billing_portal",
    {
      description:
        "Renvoie l'URL Stripe Customer Portal pour gérer MON abonnement (factures, méthode de paiement, " +
        "annulation). À ouvrir dans un navigateur.",
      inputSchema: {},
      annotations: WR("Portail de facturation"),
    },
    async () => {
      if (!mcpPremiumAvailable() || !mcpBillingConfigured()) return fail("Paiement indisponible côté serveur.");
      const r = await mcpBillingPortal(me.id);
      return "error" in r ? fail(r.error) : ok({ url: r.url });
    }
  );

  server.registerTool(
    "export_my_data",
    {
      description:
        "Export RGPD complet de MES données : handle, email de récup, attributs (privés inclus), événements, " +
        "relations directes, demandes de RDV, notifications. Renvoyé inline (pas de téléchargement).",
      inputSchema: {},
      annotations: RO("Exporter mes données"),
    },
    async () =>
      ok({
        exported_at: new Date().toISOString(),
        handle: me.handle,
        recovery_email: me.recovery_email,
        fields: await getFields(me.id, "owner"),
        events: await getEvents(me.id, true),
        relations: await getDirectRelations(me.id),
        requests: await getRequests(me.id),
        notifications: await getNotifications(me.id),
      })
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
