import { test, after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { closeDb, db, initDb } from "../src/db.js";
import { createIdentity, getFields, getIdentityByHandle, upsertField, setSettings } from "../src/store.js";
import { upsertFromProvider } from "../src/premium/store/subscriptions.js";

/** Active premium pour une identité (provider 'dev'). */
async function grantPremium(identityId: number): Promise<void> {
  const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  await upsertFromProvider(identityId, {
    provider: "dev",
    customer_id: "dev",
    subscription_id: "dev",
    status: "active",
    current_period_end: farFuture,
    cancel_at_period_end: false,
  });
}

process.env.MINDLOG_NO_LISTEN = "1";

let app: { request: (path: string, init?: RequestInit) => Promise<Response> };

before(async () => {
  await initDb();
  app = (await import("../src/server.js")).app as typeof app;
});
after(async () => {
  await closeDb();
});
beforeEach(async () => {
  await db.execute(sql`DELETE FROM identities`);
});

const ACCEPT = "application/json, text/event-stream";

/** Appel JSON-RPC sur /mcp avec une clé d'accès (ou sans, si key=null). */
async function rpc(key: string | null, body: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json", accept: ACCEPT };
  if (key) headers.authorization = `Bearer ${key}`;
  const res = await app.request("/mcp", { method: "POST", headers, body: JSON.stringify(body) });
  return res;
}

/** Appelle un outil et renvoie l'objet JSON décodé depuis content[0].text. */
async function callTool(key: string, name: string, args: Record<string, unknown> = {}) {
  const res = await rpc(key, { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: args } });
  const j = (await res.json()) as { result?: { content?: { text: string }[] } };
  return JSON.parse(j.result?.content?.[0]?.text ?? "{}") as Record<string, unknown>;
}

async function makeUser(handle: string) {
  await createIdentity(handle, handle);
  const id = await getIdentityByHandle(handle);
  if (!id) throw new Error("non créé");
  return id;
}

/* -------------------------------- Auth ----------------------------------- */

test("/mcp sans clé → 401", async () => {
  const res = await rpc(null, { jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.equal(res.status, 401);
});

test("/mcp avec clé invalide → 401", async () => {
  const res = await rpc("pas-une-vraie-cle", { jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.equal(res.status, 401);
});

/* ----------------------------- Handshake + outils ------------------------ */

test("initialize renvoie le serverInfo", async () => {
  const u = await makeUser("alice");
  const res = await rpc(u.access_key, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } },
  });
  assert.equal(res.status, 200);
  const j = (await res.json()) as { result: { serverInfo: { name: string } } };
  assert.equal(j.result.serverInfo.name, "mindlog-id");
});

test("tools/list : surface cloud scopée (pas de get_access_key, pas de paramètre handle d'écriture)", async () => {
  const u = await makeUser("bob");
  const res = await rpc(u.access_key, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  const j = (await res.json()) as { result: { tools: { name: string }[] } };
  const names = j.result.tools.map((t) => t.name);
  assert.ok(names.includes("whoami"));
  assert.ok(names.includes("respond_request"));
  assert.ok(names.includes("delete_account"));
  assert.ok(names.includes("get_card"));
  assert.ok(names.includes("add_tag"));
  assert.ok(names.includes("list_tags"));
  // L'outil admin qui exposait la clé de n'importe qui n'existe PAS côté cloud.
  assert.ok(!names.includes("get_access_key"));
});

test("tools/list : annotations présentes (title + readOnly/destructiveHint)", async () => {
  const u = await makeUser("anno");
  const res = await rpc(u.access_key, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  const j = (await res.json()) as { result: { tools: { name: string; annotations?: Record<string, unknown> }[] } };
  const byName = new Map(j.result.tools.map((t) => [t.name, t.annotations]));
  assert.equal(byName.get("whoami")?.readOnlyHint, true);
  assert.ok(typeof byName.get("whoami")?.title === "string");
  assert.equal(byName.get("delete_account")?.destructiveHint, true);
  assert.equal(byName.get("set_card_field")?.readOnlyHint, false);
});

test("/mcp rejette un Host non autorisé (anti DNS-rebinding) → 403", async () => {
  const u = await makeUser("hostguard");
  const res = await app.request("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: ACCEPT,
      authorization: `Bearer ${u.access_key}`,
      host: "evil.example.com",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(res.status, 403);
});

/* ----------------------------- Scoping (sécurité) ------------------------ */

test("set_card_field agit sur MON compte, pas sur un autre", async () => {
  const me = await makeUser("carol");
  const other = await makeUser("dan");
  const out = await callTool(me.access_key, "set_card_field", { key: "bio", value: "ma bio" });
  assert.equal(out.value, "ma bio");
  const myFields = await getFields(me.id, "owner");
  assert.equal(myFields.find((f) => f.key === "bio")?.value, "ma bio");
  // L'autre identité n'a pas été touchée (aucun moyen de la cibler).
  const otherFields = await getFields(other.id, "owner");
  assert.equal(otherFields.find((f) => f.key === "bio")?.value ?? "", "");
});

test("add_tag via MCP est scopé à mon compte", async () => {
  const me = await makeUser("tagcloud");
  const out = await callTool(me.access_key, "add_tag", { tag: "#OpenSource" });
  assert.deepEqual(out, ["OpenSource"]); // liste à jour, # retiré
  const listed = await callTool(me.access_key, "list_tags", {});
  assert.deepEqual(listed, ["OpenSource"]);
});

test("get_card d'un autre masque les attributs privés", async () => {
  const me = await makeUser("erin");
  const other = await makeUser("frank");
  await upsertField(other.id, { key: "secret", value: "topsecret", visibility: "private" });
  await upsertField(other.id, { key: "bio", value: "publique", visibility: "public" });
  const card = await callTool(me.access_key, "get_card", { handle: "frank" });
  const fields = (card.fields ?? []) as { key: string; value: string }[];
  assert.equal(fields.find((f) => f.key === "bio")?.value, "publique");
  // Le champ privé ne doit pas fuiter à un non-contact.
  assert.equal(fields.find((f) => f.key === "secret"), undefined);
});

test("validation de longueur appliquée via MCP (set_card_field)", async () => {
  const me = await makeUser("grace");
  const out = await callTool(me.access_key, "set_card_field", { key: "bio", value: "a".repeat(4001) });
  assert.ok(typeof out.error === "string", "doit renvoyer une erreur d'outil");
});

test("request_meeting crée une demande chez le destinataire (scopé), pas chez moi", async () => {
  const me = await makeUser("henri");
  await upsertField(me.id, { key: "display_name", value: "Henri" });
  const target = await makeUser("iris");

  const out = await callTool(me.access_key, "request_meeting", { handle: "@iris", day: "2026-06-01", message: "Un café ?" });
  assert.equal(out.sent, true);
  assert.equal(out.to, "iris");

  // La demande est arrivée chez iris, pas chez henri.
  const irisReqs = (await callTool(target.access_key, "list_requests", {})) as unknown as { name: string; message: string }[];
  assert.equal(irisReqs.length, 1);
  assert.equal(irisReqs[0].name, "Henri");
  assert.equal(irisReqs[0].message, "Un café ?");
  const myReqs = (await callTool(me.access_key, "list_requests", {})) as unknown as unknown[];
  assert.equal(myReqs.length, 0);
});

test("request_meeting refuse une cible inconnue ou soi-même", async () => {
  const me = await makeUser("jean");
  const unknown = await callTool(me.access_key, "request_meeting", { handle: "personne" });
  assert.ok(typeof unknown.error === "string");
  const self = await callTool(me.access_key, "request_meeting", { handle: "jean" });
  assert.ok(typeof self.error === "string");
});

test("get_availability lit la dispo d'une AUTRE identité (publique) + prochains jours libres", async () => {
  const me = await makeUser("kar");
  await makeUser("lou");
  const out = await callTool(me.access_key, "get_availability", { handle: "@lou" });
  assert.equal(out.handle, "lou");
  assert.ok(Array.isArray(out.nextFreeDays));
  assert.ok((out.nextFreeDays as string[]).length > 0, "doit proposer au moins un jour libre");
  // Sans handle : ma propre dispo.
  const mine = await callTool(me.access_key, "get_availability", {});
  assert.equal(mine.handle, "kar");
});

test("get_availability sur un handle inconnu renvoie une erreur d'outil", async () => {
  const me = await makeUser("mae");
  const out = await callTool(me.access_key, "get_availability", { handle: "fantome" });
  assert.ok(typeof out.error === "string");
});

/* --------------------- Préférences & créneaux (MCP) ---------------------- */

test("set_availability règle mes jours/horaires/finesse et get_availability les reflète", async () => {
  const me = await makeUser("nina");
  const set = await callTool(me.access_key, "set_availability", {
    freeWeekdays: [0, 2, 4], // lundi, mercredi, vendredi
    start: "10:00",
    end: "16:00",
    slotMinutes: 60,
  });
  const avail = (set.availability as { slot_minutes: number; start: string }) ?? { slot_minutes: 0, start: "" };
  assert.equal(avail.slot_minutes, 60);
  assert.equal(avail.start, "10:00");
  const got = await callTool(me.access_key, "get_availability", {});
  const rule = got.rule as { slotMinutes: number; freeWeekdays: string[]; hours: { start: string } };
  assert.equal(rule.slotMinutes, 60);
  assert.deepEqual(rule.freeWeekdays, ["lundi", "mercredi", "vendredi"]);
});

test("get_day_slots : créneaux d'un jour libre, finesse appliquée", async () => {
  const me = await makeUser("omar");
  await callTool(me.access_key, "set_availability", { start: "09:00", end: "11:00", slotMinutes: 30 });
  const out = await callTool(me.access_key, "get_day_slots", { day: "2026-06-03" }); // mercredi (libre)
  assert.equal(out.status, "free");
  assert.equal((out.slots as unknown[]).length, 4); // 09:00,09:30,10:00,10:30
});

test("request_meeting accepte un créneau horaire (time) et le transmet", async () => {
  const me = await makeUser("paul");
  await upsertField(me.id, { key: "display_name", value: "Paul" });
  const target = await makeUser("rita");
  const out = await callTool(me.access_key, "request_meeting", { handle: "rita", day: "2026-06-03", time: "10:30" });
  assert.equal(out.sent, true);
  const reqs = (await callTool(target.access_key, "list_requests", {})) as unknown as { time: string }[];
  assert.equal(reqs[0].time, "10:30");
});

test("préférences respectées : dispo privée masquée, RDV refusé", async () => {
  const me = await makeUser("sam");
  const target = await makeUser("tom");
  await setSettings(target.id, { public_availability: false, allow_requests: false });

  const avail = await callTool(me.access_key, "get_availability", { handle: "tom" });
  assert.equal(avail.availabilityPublic, false);
  assert.equal(avail.nextFreeDays, undefined);

  const slots = await callTool(me.access_key, "get_day_slots", { handle: "tom", day: "2026-06-03" });
  assert.equal(slots.status, "private");

  const rdv = await callTool(me.access_key, "request_meeting", { handle: "tom", day: "2026-06-03" });
  assert.ok(typeof rdv.error === "string");
});

/* ------------------------------- Préférences ---------------------------- */

test("get_my_preferences renvoie les défauts ; set_my_preferences ne touche que les clés fournies", async () => {
  const me = await makeUser("prefsuser");
  const before = await callTool(me.access_key, "get_my_preferences", {});
  assert.equal(before.allow_chat, true);
  assert.equal(before.public_availability, true);

  const set = await callTool(me.access_key, "set_my_preferences", { allow_chat: false, allow_video: false });
  const s = (set.settings ?? {}) as Record<string, unknown>;
  assert.equal(s.allow_chat, false);
  assert.equal(s.allow_video, false);
  assert.equal(s.allow_call, true, "clé non fournie = inchangée");

  const after = await callTool(me.access_key, "get_my_preferences", {});
  assert.equal(after.allow_chat, false);
});

/* -------------------------------- Invitations --------------------------- */

test("create_invite + get_invite_preview : aperçu correct, token réutilisable jusqu'à acceptation", async () => {
  const me = await makeUser("inviter");
  await upsertField(me.id, { key: "display_name", value: "Inviter Display" });
  const created = await callTool(me.access_key, "create_invite", { type: "pro" });
  assert.ok(typeof created.token === "string" && (created.token).length > 10);
  assert.ok(typeof created.url === "string" && (created.url).includes("/i/"));

  const preview = await callTool(me.access_key, "get_invite_preview", { token: created.token });
  assert.equal(preview.handle, "inviter");
  assert.equal(preview.display_name, "Inviter Display");
});

test("get_invite_preview sur token bidon renvoie null", async () => {
  const me = await makeUser("invreader");
  const preview = await callTool(me.access_key, "get_invite_preview", { token: "totalement-bidon" });
  assert.equal(preview, null);
});

/* --------------------------------- Galerie ------------------------------ */

test("list_gallery vide par défaut ; delete_gallery_photo refuse photo inconnue", async () => {
  const me = await makeUser("galuser");
  const out = await callTool(me.access_key, "list_gallery", {});
  assert.deepEqual(out.photos, []);
  assert.equal(out.handle, "galuser");

  const del = await callTool(me.access_key, "delete_gallery_photo", { id: 999999 });
  assert.ok(typeof del.error === "string");
});

test("set_gallery_link refuse hors-Premium", async () => {
  const me = await makeUser("galnopremium");
  const out = await callTool(me.access_key, "set_gallery_link", { id: 1, url: "https://example.com" });
  assert.ok(typeof out.error === "string");
  assert.ok((out.error).toLowerCase().includes("premium"));
});

/* --------------------------- Boutons de page ---------------------------- */

test("get_page_buttons d'un compte non-Premium = liste vide", async () => {
  const me = await makeUser("btnviewer");
  const other = await makeUser("btnowner");
  const mine = await callTool(me.access_key, "get_page_buttons", {});
  assert.deepEqual(mine.buttons, []);
  const them = await callTool(me.access_key, "get_page_buttons", { handle: other.handle });
  assert.deepEqual(them.buttons, []);
});

test("set_page_buttons Premium-gated : sans premium → erreur, avec premium → boutons persistés", async () => {
  const me = await makeUser("btncreator");
  const denied = await callTool(me.access_key, "set_page_buttons", {
    buttons: [{ label: "Mon site", url: "https://exemple.fr" }],
  });
  assert.ok(typeof denied.error === "string");

  await grantPremium(me.id);
  const ok2 = await callTool(me.access_key, "set_page_buttons", {
    buttons: [
      { label: "Mon site", url: "https://exemple.fr", shape: "square", show_label: true },
      { label: "Mail", url: "mailto:a@b.fr" },
    ],
  });
  const buttons = (ok2.buttons ?? []) as { label: string; url: string; shape: string }[];
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].label, "Mon site");
  assert.equal(buttons[0].shape, "square");

  // get_page_buttons reflète l'état pour MOI.
  const read = await callTool(me.access_key, "get_page_buttons", {});
  assert.equal((read.buttons as unknown[]).length, 2);
});

/* ----------------------------- Espace Premium --------------------------- */

test("get_my_space sans Premium renvoie defaults inactifs ; get_space sur handle vide → available:false", async () => {
  const me = await makeUser("spacefree");
  const mine = await callTool(me.access_key, "get_my_space", {});
  assert.equal(mine.available, true);
  assert.equal(mine.price_cents, 0);
  assert.equal(mine.active, false);
  // Vue d'un autre profil sans rien → available:false (pas null pour rester sérialisable).
  const other = await makeUser("spaceother");
  const them = await callTool(me.access_key, "get_space", { handle: other.handle });
  assert.equal(them.available, false);
});

test("set_space_price refuse sans Premium et accepte avec Premium (sans Stripe : active reste false)", async () => {
  const me = await makeUser("spaceprice");
  const denied = await callTool(me.access_key, "set_space_price", { price_cents: 500 });
  assert.ok(typeof denied.error === "string");

  await grantPremium(me.id);
  const ok2 = await callTool(me.access_key, "set_space_price", { price_cents: 500, currency: "eur" });
  assert.equal(ok2.price_cents, 500);
  assert.equal(ok2.currency, "eur");
  // Pas de Stripe configuré en test → active=false, Connect non connecté.
  assert.equal(ok2.active, false);
  const connect = ok2.connect as { connected: boolean; chargesEnabled: boolean };
  assert.equal(connect.connected, false);
});

test("set_space_intro persiste l'intro et set_space_benefits le bénéfice opt-in", async () => {
  const me = await makeUser("spaceintro");
  await grantPremium(me.id);
  await callTool(me.access_key, "set_space_price", { price_cents: 700 });
  const introOut = await callTool(me.access_key, "set_space_intro", {
    intro_md: "# Bienvenue\nTexte d'intro.",
    kind: "space",
  });
  assert.equal((introOut.intro_md as string).startsWith("# Bienvenue"), true);

  const benefitsOut = await callTool(me.access_key, "set_space_benefits", {
    chat: true, call: false, pages: true, rdv: false, lives: false,
  });
  const b = benefitsOut.benefits as Record<string, boolean>;
  assert.equal(b.chat, true);
  assert.equal(b.call, false);
});

/* ------------------------------ Pages premium --------------------------- */

test("list_my_pages vide ; upsert_my_page refuse sans Premium ; avec Premium crée la page ; delete la retire", async () => {
  const me = await makeUser("pageowner");
  const empty = await callTool(me.access_key, "list_my_pages", {});
  assert.deepEqual(empty.pages, []);

  const denied = await callTool(me.access_key, "upsert_my_page", {
    slug: "guide", title: "Guide", type: "markdown", content: "# Hello",
  });
  assert.ok(typeof denied.error === "string");

  await grantPremium(me.id);
  const created = await callTool(me.access_key, "upsert_my_page", {
    slug: "guide", title: "Guide", type: "markdown", content: "# Hello", published: true,
  });
  assert.equal(created.slug, "guide");
  assert.equal(created.title, "Guide");
  assert.equal(created.published, 1);

  const got = await callTool(me.access_key, "get_my_page", { slug: "guide" });
  assert.equal(got.title, "Guide");

  const listed = await callTool(me.access_key, "list_my_pages", {});
  assert.equal((listed.pages as unknown[]).length, 1);

  const del = await callTool(me.access_key, "delete_my_page", { slug: "guide" });
  assert.equal(del.deleted, true);
});

test("upsert_my_page rejette un slug invalide (caractères non autorisés)", async () => {
  const me = await makeUser("pagevalid");
  await grantPremium(me.id);
  const bad = await callTool(me.access_key, "upsert_my_page", { slug: "Slug Avec Espaces", title: "T", type: "markdown" });
  assert.ok(typeof bad.error === "string");
  // Le type invalide est rejeté en amont par zod (validation au boundary MCP) ;
  // pas un cas applicatif — couvert par le contrat de l'outil, pas par ce test.
});

/* ------------------------------- Export RGPD ---------------------------- */

test("export_my_data renvoie handle, fields, events, relations, requests, notifications", async () => {
  const me = await makeUser("exporter");
  await upsertField(me.id, { key: "bio", value: "ma bio export", visibility: "private" });
  const out = await callTool(me.access_key, "export_my_data", {});
  assert.equal(out.handle, "exporter");
  assert.ok(Array.isArray(out.fields));
  assert.ok(Array.isArray(out.events));
  assert.ok(Array.isArray(out.relations));
  assert.ok(Array.isArray(out.requests));
  assert.ok(Array.isArray(out.notifications));
  const fields = out.fields as { key: string; value: string }[];
  // Les attributs privés DOIVENT être inclus dans l'export (vue owner).
  assert.equal(fields.find((f) => f.key === "bio")?.value, "ma bio export");
});

/* ------------------------------ Billing handoff ------------------------- */

test("start_connect_onboarding et billing_portal échouent proprement sans billing configuré", async () => {
  const me = await makeUser("billnoop");
  await grantPremium(me.id);
  const onb = await callTool(me.access_key, "start_connect_onboarding", {});
  assert.ok(typeof onb.error === "string");
  const portal = await callTool(me.access_key, "billing_portal", {});
  assert.ok(typeof portal.error === "string");
});

test("subscribe_to_space refuse 'moi-même' et profil inconnu", async () => {
  const me = await makeUser("subuser");
  const self = await callTool(me.access_key, "subscribe_to_space", { handle: me.handle });
  assert.ok(typeof self.error === "string");
  const unknown = await callTool(me.access_key, "subscribe_to_space", { handle: "personne-ici" });
  assert.ok(typeof unknown.error === "string");
});
