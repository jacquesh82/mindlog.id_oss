#!/usr/bin/env node
/**
 * seed-demo.mjs — peuple une instance MindLog ID avec 10 comptes de démo et
 * tout leur réseau, via l'API HTTP publique (aucun accès direct à la base).
 *
 * Ce qui est créé :
 *   • 10 identités (handle + nom + email + bio/rôle/ville)
 *   • un graphe de relations réciproques → relations de 1er ET 2nd degré
 *   • 2 groupes (membres = contacts réciproques du créateur)
 *   • des entrées d'agenda : réunions, événements publics, et lives
 *
 * Authentification : chaque compte renvoie une `accessKey` à la création. On
 * la passe ensuite dans l'en-tête `x-access-key` — ce mode contourne le CSRF
 * (réservé à l'auth par cookie) et ne nécessite ni passkey ni session.
 *
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │ ⚠ LIMITE DE DÉBIT : POST /api/identities = 10 créations / heure / IP. │
 *   │ Ce script en crée exactement 10 : aucune marge. En cas de collision  │
 *   │ de handle (409) il s'arrête sans réessayer (chaque essai consomme le  │
 *   │ quota). Pour un nouveau lot, attendre 1 h ou poser SEED_SUFFIX.       │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * Usage :
 *   node scripts/seed-demo.mjs
 *   BASE_URL=https://id.mindlog.localhost node scripts/seed-demo.mjs
 *   SEED_SUFFIX=-demo2 node scripts/seed-demo.mjs     # second lot sans collision
 *   OUT=docs/SEED-DEMO.md node scripts/seed-demo.mjs  # chemin du rapport MD
 *
 * Les comptes et URLs d'accès sont écrits dans SEED-DEMO.md (à la racine).
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:8787").replace(/\/$/, "");
const SUFFIX = process.env.SEED_SUFFIX ?? "";
const OUT = resolve(process.cwd(), process.env.OUT ?? "SEED-DEMO.md");

/* ----------------------------- petit client HTTP ------------------------- */
// Note : Node 18+ fournit `fetch` globalement, et accepte les certs auto-signés
// mal seulement si NODE_TLS_REJECT_UNAUTHORIZED=0. Pour https://*.localhost
// (Caddy + mkcert), le cert est valide → rien à faire.

async function api(method, path, { key, body } = {}) {
  const headers = {};
  if (key) headers["x-access-key"] = key;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.error ?? data?.raw ?? res.statusText;
    throw new Error(`${method} ${path} → ${res.status} : ${msg}`);
  }
  return data;
}

const log = (...a) => console.log(...a);

/* --------------------------------- données ------------------------------- */
// Handles : ^[a-z0-9][a-z0-9_-]{1,29}$ (minuscules). Le SUFFIX éventuel permet
// de relancer un lot frais sans heurter les handles déjà pris.
const h = (base) => `${base}${SUFFIX}`;

const PEOPLE = [
  { k: "alice-martin",     name: "Alice Martin",      role: "Product Manager",   city: "Paris" },
  { k: "bob-durand",       name: "Bob Durand",        role: "Développeur",       city: "Lyon" },
  { k: "carole-petit",     name: "Carole Petit",      role: "Designer UX",       city: "Nantes" },
  { k: "david-leroy",      name: "David Leroy",       role: "Data Scientist",    city: "Toulouse" },
  { k: "emma-moreau",      name: "Emma Moreau",       role: "Cheffe de projet",  city: "Bordeaux" },
  { k: "felix-girard",     name: "Félix Girard",      role: "DevOps",            city: "Lille" },
  { k: "gabrielle-roux",   name: "Gabrielle Roux",    role: "Créatrice de contenu", city: "Marseille" },
  { k: "hugo-fontaine",    name: "Hugo Fontaine",     role: "Ingénieur",         city: "Rennes" },
  { k: "ines-blanc",       name: "Inès Blanc",        role: "Growth",            city: "Strasbourg" },
  { k: "julien-mercier",   name: "Julien Mercier",    role: "CTO",               city: "Grenoble" },
];

// Relations RÉCIPROQUES (on appelle addRelation dans les deux sens → contacts
// mutuels, requis pour les groupes/chat). L'anneau + quelques cordes produit un
// joli graphe avec du 1er ET du 2nd degré.
const MUTUAL = [
  ["alice-martin", "bob-durand", "pro"],
  ["alice-martin", "carole-petit", "amis"],
  ["alice-martin", "julien-mercier", "pro"],
  ["bob-durand", "carole-petit", "pro"],
  ["bob-durand", "david-leroy", "pro"],
  ["carole-petit", "emma-moreau", "amis"],
  ["emma-moreau", "felix-girard", "pro"],
  ["felix-girard", "gabrielle-roux", "amis"],
  ["gabrielle-roux", "hugo-fontaine", "amis"],
  ["hugo-fontaine", "ines-blanc", "pro"],
  ["ines-blanc", "julien-mercier", "amis"],
];
// Relation À SENS UNIQUE (démonstration de relation dirigée non réciproque).
const ONEWAY = [
  ["david-leroy", "emma-moreau", "autre"],
];

// Agenda : { owner, title, inDays, hour, durMin, kind, location, link, isPublic, notes }
const AGENDA = [
  { owner: "alice-martin", title: "Réunion hebdo — Cercle MindLog", inDays: 2, hour: 10, durMin: 60, kind: "event", location: "Visio", link: "https://meet.mindlog.today/cercle", isPublic: true, notes: "Point d'avancement hebdomadaire." },
  { owner: "emma-moreau", title: "Kickoff Projet Aurora", inDays: 3, hour: 14, durMin: 90, kind: "event", location: "Salle Aurora", link: "https://meet.mindlog.today/aurora", isPublic: false, notes: "Lancement officiel, tour de table." },
  { owner: "felix-girard", title: "Meetup MindLog Paris", inDays: 7, hour: 18, durMin: 150, kind: "event", location: "Station F, Paris", link: "", isPublic: true, notes: "Rencontre communautaire ouverte à tous." },
  { owner: "julien-mercier", title: "Atelier découverte", inDays: 5, hour: 17, durMin: 120, kind: "event", location: "En ligne", link: "https://meet.mindlog.today/atelier", isPublic: true, notes: "Atelier hands-on." },
  { owner: "gabrielle-roux", title: "Live Q&A produit", inDays: 4, hour: 19, durMin: 60, kind: "live", location: "", link: "", isPublic: true, notes: "Questions/réponses en direct.", notifySubs: true },
  { owner: "hugo-fontaine", title: "Live démo technique", inDays: 6, hour: 12, durMin: 45, kind: "live", location: "", link: "", isPublic: true, notes: "Démonstration en direct." },
];

const GROUPS = [
  { owner: "alice-martin", name: "Cercle MindLog", members: ["bob-durand", "carole-petit", "julien-mercier"] },
  { owner: "emma-moreau",  name: "Projet Aurora",  members: ["carole-petit", "felix-girard"] },
];

/* ----------------------------- helpers de date --------------------------- */
// Format `YYYY-MM-DDTHH:mm` (datetime-local), comme l'UI agenda.
function whenLocal(inDays, hour, addMin = 0) {
  const d = new Date();
  d.setDate(d.getDate() + inDays);
  d.setHours(hour, addMin, 0, 0);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ---------------------------------- run ---------------------------------- */
const accounts = {}; // handle base → { handle, accessKey, publicUrl, privateUrl, name, ... }

async function main() {
  log(`▶ Cible : ${BASE_URL}`);
  log(`▶ Vérification du serveur…`);
  await api("GET", "/api/session"); // 200 attendu (authenticated:false)

  /* 1 — Identités */
  log(`\n▶ Création des 10 identités (max 10/h/IP)…`);
  for (const p of PEOPLE) {
    const handle = h(p.k);
    const email = `${p.k}@demo.mindlog.today`;
    const r = await api("POST", "/api/identities", {
      body: { handle, display_name: p.name, email, ack_adult_content: true, autoCreated: false },
    });
    accounts[p.k] = {
      base: p.k, handle: r.handle, accessKey: r.accessKey,
      // r.publicUrl/privateUrl renvoyés par l'API sont absolus (appUrl()) ; on les
      // reconstruit sur BASE_URL pour rester cohérent avec la cible réellement visée.
      pub: `${BASE_URL}/@${r.handle}`,
      priv: `${BASE_URL}/k/${r.accessKey}`,
      name: p.name, role: p.role, city: p.city, email,
    };
    log(`  ✓ @${r.handle}  (${p.name})`);

    /* Enrichit la carte : rôle, ville, bio (display_name déjà posé à la création). */
    const key = r.accessKey;
    await api("PUT", "/api/card/field", { key, body: { key: "display_name", label: "Nom", value: p.name, is_public: true, position: 0 } });
    await api("PUT", "/api/card/field", { key, body: { key: "role", label: "Rôle", value: p.role, is_public: true, position: 1 } });
    await api("PUT", "/api/card/field", { key, body: { key: "city", label: "Ville", value: p.city, is_public: true, position: 2 } });
    await api("PUT", "/api/me/profile-intro", { key, body: { intro_md: `Bonjour, je suis **${p.name}**, ${p.role} basé·e à ${p.city}. Compte de démonstration MindLog ID.` } });
  }

  /* 2 — Relations */
  log(`\n▶ Tissage des relations…`);
  const relate = async (from, to, type) => {
    await api("POST", "/api/relations", { key: accounts[from].accessKey, body: { handle: accounts[to].handle, type } });
  };
  for (const [a, b, type] of MUTUAL) {
    await relate(a, b, type);
    await relate(b, a, type);
    log(`  ✓ @${accounts[a].handle} ⇄ @${accounts[b].handle} (${type})`);
  }
  for (const [a, b, type] of ONEWAY) {
    await relate(a, b, type);
    log(`  ✓ @${accounts[a].handle} → @${accounts[b].handle} (${type}, sens unique)`);
  }

  /* 3 — Groupes */
  log(`\n▶ Création des groupes…`);
  const createdGroups = [];
  for (const g of GROUPS) {
    const r = await api("POST", "/api/groups", {
      key: accounts[g.owner].accessKey,
      body: { name: g.name, members: g.members.map((m) => accounts[m].handle) },
    });
    createdGroups.push({ ...g, id: r.id, name: r.name });
    log(`  ✓ « ${r.name} » (owner @${accounts[g.owner].handle}, ${g.members.length} membres)`);
  }

  /* 4 — Agenda (réunions / events / lives) */
  log(`\n▶ Planification de l'agenda…`);
  const createdAgenda = [];
  for (const e of AGENDA) {
    const starts = whenLocal(e.inDays, e.hour);
    const ends = whenLocal(e.inDays, e.hour, e.durMin);
    const r = await api("POST", "/api/agenda", {
      key: accounts[e.owner].accessKey,
      body: {
        title: e.title, starts_at: starts, ends_at: ends,
        location: e.location ?? "", link: e.link ?? "", notes: e.notes ?? "",
        is_public: e.isPublic, kind: e.kind, notify_subs: e.notifySubs === true,
      },
    });
    const downgraded = e.kind === "live" && r.kind !== "live";
    createdAgenda.push({ ...e, starts, ends, resultKind: r.kind, downgraded });
    log(`  ✓ [${r.kind}${downgraded ? " ⤺ live demandé" : ""}] ${e.title} — @${accounts[e.owner].handle} @ ${starts}`);
  }

  /* 5 — Rapport Markdown */
  writeReport({ createdGroups, createdAgenda });
  log(`\n✅ Terminé. Rapport écrit dans ${OUT}`);
}

/* -------------------------- génération du rapport ------------------------ */
function writeReport({ createdGroups, createdAgenda }) {
  const now = new Date().toISOString();
  const accList = PEOPLE.map((p) => accounts[p.k]);

  const lines = [];
  lines.push(`# Comptes de démonstration — MindLog ID`);
  lines.push("");
  lines.push(`> Généré le ${now} par \`scripts/seed-demo.mjs\` — cible \`${BASE_URL}\`.`);
  lines.push(`> **Ne pas committer si la cible est la prod.** Ces comptes sont des données de test.`);
  lines.push("");
  lines.push(`## 🔑 Accès`);
  lines.push("");
  lines.push(`Ouvrir l'**URL privée** (\`/k/<accessKey>\`) connecte directement au compte (aucun mot de passe).`);
  lines.push(`L'**URL publique** (\`/@handle\`) est la carte partageable.`);
  lines.push(`Les clients/API peuvent aussi s'authentifier via l'en-tête \`x-access-key: <accessKey>\`.`);
  lines.push("");
  lines.push(`| # | Nom | Rôle | Handle | URL publique | URL privée (accès) | Access key |`);
  lines.push(`|---|-----|------|--------|--------------|--------------------|------------|`);
  accList.forEach((a, i) => {
    lines.push(`| ${i + 1} | ${a.name} | ${a.role} | \`@${a.handle}\` | [${a.pub}](${a.pub}) | [${a.priv}](${a.priv}) | \`${a.accessKey}\` |`);
  });
  lines.push("");

  lines.push(`## 🔗 Relations`);
  lines.push("");
  lines.push(`Relations **réciproques** (contacts mutuels) :`);
  lines.push("");
  for (const [a, b, type] of MUTUAL) {
    lines.push(`- \`@${accounts[a].handle}\` ⇄ \`@${accounts[b].handle}\` — *${type}*`);
  }
  lines.push("");
  lines.push(`Relation **à sens unique** (dirigée, non réciproque) :`);
  lines.push("");
  for (const [a, b, type] of ONEWAY) {
    lines.push(`- \`@${accounts[a].handle}\` → \`@${accounts[b].handle}\` — *${type}*`);
  }
  lines.push("");
  lines.push(`### Exemple de degrés vus depuis \`@${accounts["alice-martin"].handle}\``);
  lines.push("");
  lines.push(`- **1er degré** (contacts directs) : \`@${accounts["bob-durand"].handle}\`, \`@${accounts["carole-petit"].handle}\`, \`@${accounts["julien-mercier"].handle}\``);
  lines.push(`- **2nd degré** (contacts de contacts) : \`@${accounts["david-leroy"].handle}\` (via Bob), \`@${accounts["emma-moreau"].handle}\` (via Carole), \`@${accounts["ines-blanc"].handle}\` (via Julien)`);
  lines.push(`- *(3e degré : \`@${accounts["felix-girard"].handle}\`, \`@${accounts["hugo-fontaine"].handle}\`)*`);
  lines.push("");

  lines.push(`## 👥 Groupes`);
  lines.push("");
  for (const g of createdGroups) {
    lines.push(`- **${g.name}** — owner \`@${accounts[g.owner].handle}\`, membres : ${g.members.map((m) => `\`@${accounts[m].handle}\``).join(", ")}  \n  \`gid=${g.id}\``);
  }
  lines.push("");

  lines.push(`## 📅 Agenda`);
  lines.push("");
  lines.push(`| Titre | Type | Propriétaire | Début | Fin | Public | Lien |`);
  lines.push(`|-------|------|--------------|-------|-----|--------|------|`);
  for (const e of createdAgenda) {
    const type = e.resultKind + (e.downgraded ? " *(live demandé → event)*" : "");
    lines.push(`| ${e.title} | ${type} | \`@${accounts[e.owner].handle}\` | ${e.starts} | ${e.ends} | ${e.isPublic ? "oui" : "non"} | ${e.link || "—"} |`);
  }
  lines.push("");
  if (createdAgenda.some((e) => e.downgraded)) {
    lines.push(`> ℹ️ Les *lives* requièrent un compte **Premium** avec le bénéfice « lives » activé ;`);
    lines.push(`> sans cela l'API les enregistre comme \`event\`. Pour un vrai live, passer le compte`);
    lines.push(`> en Premium (\`scripts/make-premium.sh @handle\` côté Postgres) puis recréer l'entrée.`);
    lines.push("");
  }

  writeFileSync(OUT, lines.join("\n"));
}

main().catch((e) => {
  console.error(`\n✗ Échec : ${e.message}`);
  console.error(`  (Astuce : si « handle pris » ou 429, attendre 1 h ou relancer avec SEED_SUFFIX=-demo2)`);
  process.exit(1);
});
