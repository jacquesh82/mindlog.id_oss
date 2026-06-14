import { test, after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { closeDb, db, initDb } from "../src/db.js";
import {
  StoreError,
  acceptRequest,
  addEvent,
  addRelation,
  addRequest,
  areContacts,
  createIdentity,
  getIdentityByEmail,
  generateUniqueHandle,
  dueMilestone,
  dueReminders,
  markReminderSent,
  defaultDayStatus,
  deleteEvent,
  deleteField,
  deleteRequest,
  effectiveDayStatus,
  ensureMilo,
  getDirectRelations,
  getEvents,
  getFields,
  getIdentityByHandle,
  getIdentityByKey,
  getOverrides,
  nextFreeDays,
  getRelationsByDegree,
  getRequests,
  normalizeHandle,
  pendingRequestCount,
  recoverByEmail,
  removeRelation,
  rotateAccessKey,
  searchIdentities,
  setDayStatus,
  setRecoveryEmail,
  setRequestStatus,
  stats,
  upsertField,
  getTags,
  addTag,
  removeTag,
  parseSettings,
  setSettings,
  slotsFor,
  availabilityStatus,
  bookedSlots,
  DEFAULT_AVAILABILITY,
  inviteToEvent,
  removeEventInvite,
  listEventInvites,
  listMyInvites,
  getAcceptedInviteEvents,
  respondEventInvite,
} from "../src/store.js";

// Migrations appliquées une fois sur la base PGlite (en mémoire).
before(async () => {
  await initDb();
});

after(async () => {
  await closeDb();
});

// Base repartie de zéro avant chaque test (la cascade FK vide le reste).
beforeEach(async () => {
  await db.execute(sql`DELETE FROM identities`);
  await db.execute(sql`DELETE FROM day_overrides`);
});

/* ------------------------------ normalizeHandle -------------------------- */

test("normalizeHandle nettoie et minuscule", () => {
  assert.equal(normalizeHandle("  @Jacques "), "jacques");
  assert.equal(normalizeHandle("Alice Martin"), "alice-martin");
  assert.equal(normalizeHandle("Bob_42"), "bob_42");
});

/* ------------------------------ Settings / dispo ------------------------- */

test("parseSettings : défauts complets (booléens + availability)", () => {
  const s = parseSettings(null);
  assert.equal(s.allow_chat, true);
  assert.equal(s.public_availability, true);
  assert.deepEqual(s.availability.weekdays, DEFAULT_AVAILABILITY.weekdays);
  assert.equal(s.availability.slot_minutes, 30);
});

test("setSettings : n'écrit que les clés connues + valide l'availability", async () => {
  const id = await createIdentity("jacques", "Jacques");
  const next = await setSettings(id.id, {
    allow_chat: false,
    // @ts-expect-error champ inconnu ignoré
    bidon: true,
    availability: {
      weekdays: [true, false, true, false, true, false, false],
      periods: [{ from: "2026-08-01", to: "2026-08-15", free: false }],
      start: "10:00",
      end: "16:00",
      slot_minutes: 15,
    },
  });
  assert.equal(next.allow_chat, false);
  assert.equal(next.allow_call, true); // inchangé
  assert.equal((next as Record<string, unknown>).bidon, undefined);
  assert.equal(next.availability.slot_minutes, 15);
  assert.equal(next.availability.periods.length, 1);
  // Persisté
  const re = parseSettings((await getIdentityByHandle("jacques"))!.settings);
  assert.equal(re.availability.start, "10:00");
});

test("setSettings : slot_minutes invalide retombe sur le défaut, end<=start corrigé", async () => {
  const id = await createIdentity("jacques", "Jacques");
  const next = await setSettings(id.id, {
    availability: { weekdays: [true, true, true, true, true, false, false], periods: [], start: "12:00", end: "08:00", slot_minutes: 7 as 15 },
  });
  assert.equal(next.availability.slot_minutes, 30);
  assert.ok(next.availability.end > next.availability.start);
});

test("availabilityStatus : périodes prioritaires sur le jour de semaine", () => {
  const a = {
    weekdays: [true, true, true, true, true, false, false],
    periods: [{ from: "2026-06-01", to: "2026-06-05", free: false }],
    start: "09:00",
    end: "18:00",
    slot_minutes: 30 as const,
  };
  assert.equal(availabilityStatus(a, "2026-06-03"), "busy"); // mercredi mais dans la période off
  assert.equal(availabilityStatus(a, "2026-06-10"), "free"); // mercredi hors période
  assert.equal(availabilityStatus(a, "2026-06-13"), "busy"); // samedi
});

test("slotsFor : respecte la plage horaire et la finesse", () => {
  assert.deepEqual(
    slotsFor({ weekdays: [], periods: [], start: "09:00", end: "10:00", slot_minutes: 30 }),
    ["09:00", "09:30"]
  );
  assert.equal(slotsFor({ weekdays: [], periods: [], start: "09:00", end: "12:00", slot_minutes: 60 }).length, 3);
  assert.equal(slotsFor({ weekdays: [], periods: [], start: "09:00", end: "10:00", slot_minutes: 15 }).length, 4);
});

test("effectiveDayStatus suit la règle perso (jour de semaine désactivé)", async () => {
  const id = await createIdentity("jacques", "Jacques");
  // 2026-06-03 = mercredi (index 2). On le désactive.
  await setSettings(id.id, {
    availability: { ...DEFAULT_AVAILABILITY, weekdays: [true, true, false, true, true, false, false] },
  });
  assert.equal(await effectiveDayStatus(id.id, "2026-06-03"), "busy");
  assert.equal(await effectiveDayStatus(id.id, "2026-06-02"), "free"); // mardi
});

test("bookedSlots : ne renvoie que les créneaux des RDV acceptés", async () => {
  const id = await createIdentity("jacques", "Jacques");
  const r = await addRequest(id.id, { day: "2026-06-10", time: "09:00", name: "Alice" });
  assert.deepEqual(await bookedSlots(id.id, "2026-06-10"), []); // pending → pas compté
  await setRequestStatus(id.id, r.id, "accepted");
  assert.deepEqual(await bookedSlots(id.id, "2026-06-10"), ["09:00"]);
});

/* ------------------------------ createIdentity --------------------------- */

test("createIdentity crée une identité avec clé + attributs de base", async () => {
  const id = await createIdentity("jacques", "Jacques");
  assert.equal(id.handle, "jacques");
  assert.match(id.access_key, /^[\w-]{20,}$/);
  const fields = await getFields(id.id, true);
  assert.ok(fields.find((f) => f.key === "display_name")?.value === "Jacques");
  assert.ok(fields.find((f) => f.key === "email"));
});

test("createIdentity rejette handle invalide / réservé / dupliqué", async () => {
  await assert.rejects(createIdentity("a"), (e) => e instanceof StoreError && e.status === 400);
  await assert.rejects(createIdentity("api"), (e) => e instanceof StoreError && e.status === 409);
  await createIdentity("bob");
  await assert.rejects(createIdentity("bob"), (e) => e instanceof StoreError && e.status === 409);
});

test("getIdentityByKey résout la clé, sinon undefined", async () => {
  const id = await createIdentity("carol");
  assert.equal((await getIdentityByKey(id.access_key))?.handle, "carol");
  assert.equal(await getIdentityByKey("nope"), undefined);
  assert.equal(await getIdentityByKey(null), undefined);
});

/* --------------------------------- Champs -------------------------------- */

test("upsertField met à jour les attributs de base et ajoute des customs", async () => {
  const id = await createIdentity("dan");
  await upsertField(id.id, { key: "title", value: "Dev" });
  assert.equal((await getFields(id.id, true)).find((f) => f.key === "title")?.value, "Dev");

  await upsertField(id.id, { key: "github", label: "GitHub", value: "dan", is_custom: true });
  const gh = (await getFields(id.id, true)).find((f) => f.key === "github");
  assert.equal(gh?.value, "dan");
  assert.equal(gh?.is_custom, 1);
});

test("getFields filtre les attributs privés en mode public", async () => {
  const id = await createIdentity("eve");
  await upsertField(id.id, { key: "phone", value: "0600", is_public: false });
  await upsertField(id.id, { key: "title", value: "Eve", is_public: true });
  const pub = (await getFields(id.id, false)).map((f) => f.key);
  assert.ok(!pub.includes("phone"));
  assert.ok((await getFields(id.id, true)).some((f) => f.key === "phone"));
});

test("deleteField vide un attribut de base, supprime un custom", async () => {
  const id = await createIdentity("frank");
  await upsertField(id.id, { key: "title", value: "x" });
  await deleteField(id.id, "title");
  assert.equal((await getFields(id.id, true)).find((f) => f.key === "title")?.value, "");

  await upsertField(id.id, { key: "custom1", value: "y", is_custom: true });
  await deleteField(id.id, "custom1");
  assert.ok(!(await getFields(id.id, true)).some((f) => f.key === "custom1"));
});

/* --------------------------------- Agenda -------------------------------- */

test("événements : ajout, filtrage public, suppression", async () => {
  const id = await createIdentity("gina");
  await addEvent(id.id, { title: "Public", starts_at: "2026-06-01T10:00:00Z", is_public: true });
  const priv = await addEvent(id.id, { title: "Privé", starts_at: "2026-06-02T10:00:00Z", is_public: false });
  assert.equal((await getEvents(id.id, true)).length, 2);
  assert.equal((await getEvents(id.id, false)).length, 1);
  assert.ok(await deleteEvent(id.id, priv.id));
  assert.equal((await getEvents(id.id, true)).length, 1);
});

/* ----------------------------- Disponibilités ---------------------------- */

test("defaultDayStatus : libre en semaine, occupé le week-end", () => {
  assert.equal(defaultDayStatus("2026-06-03"), "free");
  assert.equal(defaultDayStatus("2026-06-06"), "busy");
  assert.equal(defaultDayStatus("2026-06-07"), "busy");
});

test("setDayStatus stocke l'exception, et la retire si = défaut", async () => {
  const id = await createIdentity("hugo");
  await setDayStatus(id.id, "2026-06-03", "busy");
  assert.equal(await effectiveDayStatus(id.id, "2026-06-03"), "busy");
  assert.deepEqual(await getOverrides(id.id), { "2026-06-03": "busy" });

  await setDayStatus(id.id, "2026-06-03", "free");
  assert.deepEqual(await getOverrides(id.id), {});
  assert.equal(await effectiveDayStatus(id.id, "2026-06-03"), "free");

  await setDayStatus(id.id, "2026-06-06", "free");
  assert.equal(await effectiveDayStatus(id.id, "2026-06-06"), "free");
});

test("setDayStatus rejette une date invalide", async () => {
  const id = await createIdentity("iris");
  await assert.rejects(setDayStatus(id.id, "pas-une-date", "free"), StoreError);
});

test("nextFreeDays : saute les week-ends et les exceptions 'busy'", async () => {
  const id = await createIdentity("nora");
  // À partir du lundi 2026-06-01 ; sam 06 + dim 07 sont 'busy' par défaut.
  await setDayStatus(id.id, "2026-06-02", "busy"); // mardi rendu occupé
  const free = await nextFreeDays(id.id, 4, "2026-06-01");
  // lundi 01 (sauf), mardi 02 occupé → 03, 04, 05, puis week-end sauté → 08.
  assert.deepEqual(free, ["2026-06-01", "2026-06-03", "2026-06-04", "2026-06-05"]);
});

/* ------------------------------ Demandes RDV ----------------------------- */

test("demandes de RDV : ajout, statut, suppression, compteur", async () => {
  const id = await createIdentity("jade");
  const r = await addRequest(id.id, { day: "2026-06-10", name: "Alice", email: "a@x.co", message: "Salut" });
  assert.equal(r.day, "2026-06-10");
  assert.equal(await pendingRequestCount(id.id), 1);

  assert.ok(await setRequestStatus(id.id, r.id, "accepted"));
  assert.equal(await pendingRequestCount(id.id), 0);
  assert.equal((await getRequests(id.id))[0].status, "accepted");

  assert.ok(await deleteRequest(id.id, r.id));
  assert.equal((await getRequests(id.id)).length, 0);
});

test("acceptRequest : demandeur existant → contact réciproque", async () => {
  const owner = await createIdentity("owner-a", undefined, "owner-a@x.co");
  const guest = await createIdentity("guest-a", "Bob", "guest-a@x.co");
  const r = await addRequest(owner.id, { day: "2026-06-12", name: "Bob", email: "guest-a@x.co" });

  const res = await acceptRequest(owner.id, r.id);
  assert.equal(res.updated, true);
  assert.equal(res.requesterIsNew, false);
  assert.equal(res.requester?.id, guest.id);
  assert.equal(res.contacts, true);
  assert.equal(res.accessKey, undefined);
  assert.equal((await getRequests(owner.id))[0].status, "accepted");
  assert.ok(await areContacts(owner.id, guest.id));
});

test("acceptRequest : demandeur inconnu → identité créée automatiquement", async () => {
  const owner = await createIdentity("owner-b", undefined, "owner-b@x.co");
  const r = await addRequest(owner.id, { name: "Carla Diaz", email: "carla@x.co" });

  const res = await acceptRequest(owner.id, r.id);
  assert.equal(res.updated, true);
  assert.equal(res.requesterIsNew, true);
  assert.ok(res.accessKey, "un lien magique est fourni pour le nouveau compte");
  assert.equal(res.contacts, true);

  const created = await getIdentityByEmail("carla@x.co");
  assert.ok(created, "l'identité du demandeur a été créée");
  assert.ok(res.requester);
  assert.equal(created.id, res.requester.id);
  assert.ok(await areContacts(owner.id, created.id));
});

test("getRequests : en attente d'abord, puis les plus récentes", async () => {
  const id = await createIdentity("order-q");
  const r1 = await addRequest(id.id, { name: "Ancien", email: "1@x.co" });
  const r2 = await addRequest(id.id, { name: "Récent", email: "2@x.co" });
  await setRequestStatus(id.id, r2.id, "accepted"); // le plus récent passe accepté
  const r3 = await addRequest(id.id, { name: "Pending", email: "3@x.co" });

  const list = await getRequests(id.id);
  // Les 'pending' (r3, r1) viennent avant l'accepté (r2), pending triés par récence.
  assert.deepEqual(list.map((r) => r.id), [r3.id, r1.id, r2.id]);

  const onlyPending = await getRequests(id.id, "pending");
  assert.deepEqual(onlyPending.map((r) => r.id), [r3.id, r1.id]);
});

test("dueMilestone : fenêtres 1m/1w/3d/1d, une seule fois", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  const at = (day: string, sent = "") =>
    ({ day, reminders_sent: sent } as Parameters<typeof dueMilestone>[0]);

  assert.equal(dueMilestone(at("2026-06-20"), now), "1m"); // 19 j → fenêtre (7,30]
  assert.equal(dueMilestone(at("2026-06-06"), now), "1w"); // 5 j  → (3,7]
  assert.equal(dueMilestone(at("2026-06-03"), now), "3d"); // 2 j  → (1,3]
  assert.equal(dueMilestone(at("2026-06-02"), now), "1d"); // 1 j  → (-1,1]
  assert.equal(dueMilestone(at("2026-06-01"), now), "1d"); // jour J
  assert.equal(dueMilestone(at("2026-05-31"), now), null); // passé
  assert.equal(dueMilestone(at("2026-06-06", "1w"), now), null); // déjà envoyé
  assert.equal(dueMilestone({ day: null } as Parameters<typeof dueMilestone>[0], now), null);
});

test("dueReminders + markReminderSent : seulement les pending, idempotent", async () => {
  const id = await createIdentity("rem-owner");
  const now = new Date("2026-06-01T12:00:00Z");
  const soon = await addRequest(id.id, { day: "2026-06-02", name: "Bientôt", email: "s@x.co" });
  const accepted = await addRequest(id.id, { day: "2026-06-02", name: "Acceptée", email: "a@x.co" });
  await setRequestStatus(id.id, accepted.id, "accepted");
  await addRequest(id.id, { name: "SansDate", email: "n@x.co" }); // pas de day → exclu

  const due = await dueReminders(now);
  const mine = due.filter((d) => d.request.identity_id === id.id);
  assert.deepEqual(mine.map((d) => [d.request.id, d.milestone]), [[soon.id, "1d"]]);

  await markReminderSent(soon.id, "1d");
  const after = (await dueReminders(now)).filter((d) => d.request.id === soon.id);
  assert.equal(after.length, 0);
});

test("acceptRequest : demande inexistante → updated=false", async () => {
  const owner = await createIdentity("owner-c", undefined, "owner-c@x.co");
  assert.equal((await acceptRequest(owner.id, 999999)).updated, false);
});

test("generateUniqueHandle : dérive et désambiguïse", async () => {
  await createIdentity("dupe-handle", undefined, "dupe@x.co");
  const h = await generateUniqueHandle("dupe-handle@x.co");
  assert.notEqual(h, "dupe-handle");
  assert.match(h, /^[a-z0-9][a-z0-9_-]{1,29}$/);
});

/* -------------------------------- Relations ------------------------------ */

test("relations : degrés 1-3 (graphe non-orienté) + type", async () => {
  const a = await createIdentity("a-handle");
  await createIdentity("b-handle");
  await createIdentity("c-handle");
  await addRelation(a.id, "b-handle", "pro");
  const b = (await getIdentityByHandle("b-handle"))!;
  await addRelation(b.id, "c-handle", "amis");

  const rel = await getRelationsByDegree(a.id, 3);
  assert.deepEqual(rel[1].map((r) => [r.handle, r.type]), [["b-handle", "pro"]]);
  assert.deepEqual(rel[2].map((r) => r.handle), ["c-handle"]);
  assert.deepEqual(rel[3], []);
  assert.equal((await getDirectRelations(a.id))[0].handle, "b-handle");
});

test("addRelation : type par défaut amis, upsert du type, garde-fous", async () => {
  const a = await createIdentity("x1");
  await createIdentity("y1");
  assert.equal((await addRelation(a.id, "y1")).type, "amis");
  assert.equal((await addRelation(a.id, "y1", "pro")).type, "pro");
  assert.equal((await getRelationsByDegree(a.id, 1))[1].length, 1);

  await assert.rejects(addRelation(a.id, "x1"), (e) => e instanceof StoreError && e.status === 400);
  await assert.rejects(addRelation(a.id, "inconnu"), (e) => e instanceof StoreError && e.status === 404);
  assert.ok(await removeRelation(a.id, "y1"));
  assert.equal((await getRelationsByDegree(a.id, 1))[1].length, 0);
});

/* ------------------------- Recherche & récupération ---------------------- */

test("searchIdentities trouve par handle et par nom", async () => {
  const id = await createIdentity("zoe", "Zoé Dupont");
  await upsertField(id.id, { key: "display_name", value: "Zoé Dupont" });
  assert.ok((await searchIdentities("zoe")).some((r) => r.handle === "zoe"));
  assert.ok((await searchIdentities("Dupont")).some((r) => r.handle === "zoe"));
});

test("recoverByEmail régénère la clé si l'email correspond", async () => {
  const id = await createIdentity("ken");
  await setRecoveryEmail(id.id, "Ken@Mail.com");
  const oldKey = (await getIdentityByHandle("ken"))!.access_key;

  await assert.rejects(recoverByEmail("ken", "wrong@mail.com"), StoreError);
  const r = await recoverByEmail("ken", "ken@mail.com");
  assert.equal(r.handle, "ken");
  assert.notEqual(r.accessKey, oldKey);
  assert.equal((await getIdentityByHandle("ken"))!.access_key, r.accessKey);
});

test("recoverByEmail échoue sans email enregistré", async () => {
  await createIdentity("liam");
  await assert.rejects(recoverByEmail("liam", "any@mail.com"), StoreError);
});

/* ---------------------------------- Divers ------------------------------- */

test("rotateAccessKey change la clé", async () => {
  const id = await createIdentity("mona");
  const k = await rotateAccessKey(id.id);
  assert.notEqual(k, id.access_key);
  assert.equal((await getIdentityByKey(k))?.handle, "mona");
});

test("stats compte les entités", async () => {
  const a = await createIdentity("n1");
  await createIdentity("n2");
  await addEvent(a.id, { title: "e", starts_at: "2026-06-01T10:00:00Z" });
  const s = await stats();
  assert.equal(s.identities, 2);
  assert.equal(s.events, 1);
});

test("visibilité 3 niveaux : public / contact / privé selon le spectateur", async () => {
  const id = await createIdentity("vis");
  await upsertField(id.id, { key: "pub1", value: "p", visibility: "public", is_custom: true });
  await upsertField(id.id, { key: "con1", value: "c", visibility: "contact", is_custom: true });
  await upsertField(id.id, { key: "pri1", value: "x", visibility: "private", is_custom: true });

  const keysFor = async (v: any) => (await getFields(id.id, v)).filter((f) => f.value).map((f) => f.key);
  assert.deepEqual((await keysFor("owner")).sort(), ["con1", "pri1", "pub1"]);
  assert.deepEqual((await keysFor("contact")).sort(), ["con1", "pub1"]);
  assert.deepEqual((await keysFor("public")).sort(), ["pub1"]);
  assert.deepEqual((await keysFor(true)).sort(), ["con1", "pri1", "pub1"]);
  assert.deepEqual(await keysFor(false), ["pub1"]);
});

test("areContacts : vrai seulement si relation réciproque", async () => {
  const a = await createIdentity("ca");
  const b = await createIdentity("cb");
  await addRelation(a.id, "cb");
  assert.equal(await areContacts(a.id, b.id), false);
  await addRelation(b.id, "ca");
  assert.equal(await areContacts(a.id, b.id), true);
  assert.equal(await areContacts(a.id, a.id), false);
});

test("relations degré 2/3 indiquent l'intermédiaire (via)", async () => {
  const a = await createIdentity("va");
  await createIdentity("vb");
  await createIdentity("vc");
  await addRelation(a.id, "vb");
  await addRelation((await getIdentityByHandle("vb"))!.id, "vc");
  const rel = await getRelationsByDegree(a.id, 3);
  assert.equal(rel[2][0].handle, "vc");
  assert.equal(rel[2][0].via, "vb");
});

test("ensureMilo crée @milo une seule fois", async () => {
  await ensureMilo();
  await ensureMilo();
  assert.ok(await getIdentityByHandle("milo"));
  assert.equal((await searchIdentities("milo")).filter((r) => r.handle === "milo").length, 1);
});

test("tags : ajout, normalisation, dédup, suppression", async () => {
  const a = await createIdentity("taguser");
  assert.deepEqual(await getTags(a.id), []);
  await addTag(a.id, "  #JavaScript  ");
  assert.deepEqual(await getTags(a.id), ["JavaScript"]); // # retiré, trim
  await addTag(a.id, "JavaScript"); // dédup
  await addTag(a.id, "rust");
  assert.deepEqual(await getTags(a.id), ["JavaScript", "rust"]);
  assert.equal(await removeTag(a.id, "rust"), true);
  assert.deepEqual(await getTags(a.id), ["JavaScript"]);
  assert.equal(await removeTag(a.id, "inexistant"), false);
});

test("addTag : tag vide rejeté, plafond à 20", async () => {
  const a = await createIdentity("tagmax");
  await assert.rejects(() => addTag(a.id, "   "), /vide/i);
  for (let i = 0; i < 20; i++) await addTag(a.id, `t${i}`);
  await assert.rejects(() => addTag(a.id, "t20"), /Maximum/);
  assert.equal((await getTags(a.id)).length, 20);
});

/* ----------------------------- Invitations RSVP -------------------------- */

test("inviteToEvent → respond : flux complet RSVP + jointure virtuelle", async () => {
  const org = await createIdentity("orga");
  const guest = await createIdentity("invite");
  // « Toute relation » : une relation sortante de l'organisateur suffit.
  await addRelation(org.id, "invite", "amis");
  const ev = await addEvent(org.id, { title: "Apéro", starts_at: "2030-01-02T18:00:00.000Z" });

  const r = await inviteToEvent(ev.id, org.id, "invite");
  assert.equal(r.created, true);
  assert.equal(r.status, "pending");
  // Ré-invitation idempotente (pas de doublon, pas de nouvelle notif).
  assert.equal((await inviteToEvent(ev.id, org.id, "invite")).created, false);

  // Vue organisateur : un invité en attente.
  const list = await listEventInvites(ev.id, org.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].handle, "invite");
  assert.equal(list[0].status, "pending");

  // Vue invité : une invitation en attente, aucun event accepté pour l'instant.
  assert.equal((await listMyInvites(guest.id)).length, 1);
  assert.equal((await getAcceptedInviteEvents(guest.id)).length, 0);

  // Acceptation → l'event apparaît (lecture seule) dans l'agenda de l'invité.
  const resp = await respondEventInvite(guest.id, ev.id, true);
  assert.equal(resp?.organizerId, org.id);
  const accepted = await getAcceptedInviteEvents(guest.id);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].title, "Apéro");
  assert.equal(accepted[0].invited_by, "orga");
  assert.equal((await listMyInvites(guest.id)).length, 0); // plus en attente

  // Re-répondre à une invitation déjà traitée → rien à faire.
  assert.equal(await respondEventInvite(guest.id, ev.id, false), null);
});

test("inviteToEvent : refuse soi-même, non-relation et event d'autrui", async () => {
  const org = await createIdentity("orga2");
  const stranger = await createIdentity("etranger");
  const ev = await addEvent(org.id, { title: "Réu", starts_at: "2030-02-02T10:00:00.000Z" });
  // Soi-même.
  await assert.rejects(() => inviteToEvent(ev.id, org.id, "orga2"), (e) => e instanceof StoreError && e.status === 400);
  // Pas de relation sortante vers l'étranger.
  await assert.rejects(() => inviteToEvent(ev.id, org.id, "etranger"), (e) => e instanceof StoreError && e.status === 403);
  // Inviter sur l'event d'un autre (stranger n'en est pas propriétaire).
  await assert.rejects(() => inviteToEvent(ev.id, stranger.id, "orga2"), (e) => e instanceof StoreError && e.status === 404);
});

test("removeEventInvite : l'organisateur retire une invitation", async () => {
  const org = await createIdentity("orga3");
  await createIdentity("invite3");
  await addRelation(org.id, "invite3", "pro");
  const ev = await addEvent(org.id, { title: "Sortie", starts_at: "2030-03-03T12:00:00.000Z" });
  await inviteToEvent(ev.id, org.id, "invite3");
  assert.equal((await listEventInvites(ev.id, org.id)).length, 1);
  assert.equal(await removeEventInvite(ev.id, org.id, "invite3"), true);
  assert.equal((await listEventInvites(ev.id, org.id)).length, 0);
});
