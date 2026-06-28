import "./env.js";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { readFileSync, mkdirSync, rmSync, statSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { subscribe } from "./realtime.js";
import { pruneExpiredMessages, pruneExpiredAttachments } from "./messages.js";
import { pruneExpiredSessions } from "./session.js";
import {
  ensureMilo,
  pruneExpiredInvites,
  pruneExpiredLoginPins,
  getIdentityByKey,
  dueReminders,
  markReminderSent,
  getIdentityById,
  stats,
} from "./store.js";
import { isMailConfigured, sendMail, appUrl } from "./mailer.js";
import { bookingReminderEmail } from "./emails.js";
import { rateLimit, securityHeaders, requestBodyLimit } from "./security.js";
import { buildCloudMcpServer, cloudMcpToolCount } from "./mcp-cloud.js";
import { mountOAuth } from "./oauth-routes.js";
import { verifyAccessToken, protectedResourceMetadata, pruneOAuth, seedFirstPartyClients, expandScopes, ALL_SCOPES } from "./oauth.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { initDb } from "./db.js";
import { currentIdentity, notify } from "./routes/_ctx.js";
import identityRoutes from "./routes/identity.js";
import authRoutes from "./routes/auth.js";
import e2eRoutes from "./routes/e2e.js";
import agendaRoutes from "./routes/agenda.js";
import messagingRoutes from "./routes/messaging.js";
import groupsRoutes from "./routes/groups.js";
import socialRoutes from "./routes/social.js";
import bookingRoutes from "./routes/booking.js";
import galleryRoutes from "./routes/gallery.js";

const STARTED_AT = Date.now();
const TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY ?? "";

// Version applicative — source de vérité unique = package.json. Exposée dans
// /api/status, injectée dans la page (window.__APP_VERSION__) et affichée dans
// Compte › À propos. Lue une fois au démarrage.
const APP_VERSION: string = (() => {
  try {
    return JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

// Version des assets pour le cache-busting (`?v=` des balises + service worker).
//  - PROD : figée au démarrage (STARTED_AT) → invalidée à chaque déploiement.
//  - DEV  : dérivée de l'mtime des fichiers public/ → TOUTE édition de public/
//    buste le cache (et le SW). `tsx watch` ne surveille que src/, donc éditer
//    public/ ne redémarre pas le serveur : sans ça, le navigateur sert du cache
//    périmé (assets incohérents). Mémoïsé 1 s pour ne pas stat à chaque requête.
const IS_PROD = process.env.NODE_ENV === "production";
function maxMtimeMs(dir: string): number {
  let m = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "vendor" || e.name.startsWith(".")) continue; // vendor figé, dotfiles ignorés
    const p = resolve(dir, e.name);
    m = Math.max(m, e.isDirectory() ? maxMtimeMs(p) : statSync(p).mtimeMs);
  }
  return m;
}
let _verCache = { at: 0, v: String(STARTED_AT) };
function assetVersion(): string {
  if (IS_PROD) return String(STARTED_AT);
  const now = Date.now();
  if (now - _verCache.at < 1000) return _verCache.v;
  let v = String(STARTED_AT);
  try {
    v = String(Math.max(STARTED_AT, Math.floor(maxMtimeMs(PUBLIC_DIR))));
  } catch {
    /* repli sur STARTED_AT */
  }
  _verCache = { at: now, v };
  return v;
}

const DATA_DIR = resolve(process.cwd(), "data");
mkdirSync(DATA_DIR, { recursive: true });

const app = new Hono();

/* --------------------------- Sécurité transverse ------------------------- */
// En-têtes de sécurité sur toutes les réponses (CSP, X-Frame-Options, HSTS…).
app.use("*", securityHeaders());
// Limite de taille du corps (256 Ko JSON / 55 Mo multipart) sur tout /api.
app.use("/api/*", requestBodyLimit());

// Garde-fou global anti-abus, puis limiteurs ciblés sur les routes sensibles.
// max volontairement large (≈ 20 req/s par IP) : l'app est temps réel et certaines
// actions légitimes émettent des rafales — le chat refetch sur chaque événement SSE
// + lit/écrit le cache de ratchet e2e, et SURTOUT un appel WebRTC déclenche une
// rafale de POST /api/signal (un par candidat ICE en trickle). À 300/min un simple
// appel ou quelques échanges suffisaient à déclencher un 429 (« trop de messages »).
// Ce seau n'est qu'un backstop anti-flood : les routes sensibles (création
// d'identité, recover, auth passkey/PIN, OAuth) ont leurs propres limiteurs stricts.
app.use("/api/*", rateLimit({ windowMs: 60_000, max: 1200 }));
const SENSITIVE = "Trop de tentatives. Réessayez dans quelques minutes.";
app.use("/api/identities", rateLimit({ windowMs: 60 * 60_000, max: 10, message: SENSITIVE }));
app.use("/api/recover", rateLimit({ windowMs: 15 * 60_000, max: 5, message: SENSITIVE }));
app.use("/api/passkeys/auth/*", rateLimit({ windowMs: 15 * 60_000, max: 20, message: SENSITIVE }));
// Échange de code PIN d'appairage : débit serré (anti-devinette en ligne).
app.use("/api/auth/redeem-pin", rateLimit({ windowMs: 15 * 60_000, max: 10, message: SENSITIVE }));
app.use("/api/search", rateLimit({ windowMs: 60_000, max: 60 }));
// Connecteur MCP cloud : limite de corps JSON + débit par IP.
app.use("/mcp", requestBodyLimit());
app.use("/mcp", rateLimit({ windowMs: 60_000, max: 240 }));
// OAuth : débit serré sur les endpoints sensibles.
app.use("/oauth/token", rateLimit({ windowMs: 60_000, max: 60, message: SENSITIVE }));
app.use("/oauth/register", rateLimit({ windowMs: 60 * 60_000, max: 30, message: SENSITIVE }));
app.use("/oauth/authorize", rateLimit({ windowMs: 60_000, max: 60, message: SENSITIVE }));
mountOAuth(app);

/* --------------------------- Routes montées ------------------------------ */
app.route("/", identityRoutes);
app.route("/", authRoutes);
app.route("/", e2eRoutes);
app.route("/", agendaRoutes);
app.route("/", messagingRoutes);
app.route("/", groupsRoutes);
app.route("/", socialRoutes);
app.route("/", bookingRoutes);
app.route("/", galleryRoutes);
// Les pages légales sont maintenant servies par le site vitrine (VITRINE_URL).

/* ----- Santé du serveur MCP : comptage des outils cloud, en process ----- */
// On mesure le serveur réellement servi sur `/mcp` (`buildCloudMcpServer`), pas un
// process externe : aucun spawn, aucune requête. `ok=false` seulement si la
// construction de la surface d'outils échoue.
function mcpHealth(): { ok: boolean; tools: number } {
  try {
    return { ok: true, tools: cloudMcpToolCount() };
  } catch {
    return { ok: false, tools: 0 };
  }
}

// État des services (page statut publique).
app.get("/api/status", async (c) => {
  let dbStatus = "ok";
  let counts = { identities: 0, events: 0, requests: 0, relations: 0, identitiesLast7d: 0 };
  try {
    counts = await stats();
  } catch {
    dbStatus = "error";
  }
  const mcp = mcpHealth();
  return c.json({
    ok: dbStatus === "ok" && mcp.ok,
    version: APP_VERSION,
    // `build` = version des assets (cf. assetVersion). En PROD elle est figée au
    // démarrage (change à chaque déploiement) ; en DEV elle suit l'mtime de public/
    // (change à chaque édition). Le client compare la version (release) ET, en dev,
    // le build, pour proposer un rechargement quand le serveur est plus récent.
    build: assetVersion(),
    dev: !IS_PROD,
    services: { web: "ok", api: "ok", db: dbStatus, mcp: mcp.ok ? "ok" : "down" },
    mcpTools: mcp.tools,
    counts,
    uptimeSeconds: Math.floor((Date.now() - STARTED_AT) / 1000),
    time: new Date().toISOString(),
  });
});

// Flux temps réel (SSE) pour l'identité authentifiée : notifications + messages.
app.get("/api/events", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  return streamSSE(c, async (stream) => {
    const send = (event: string, data: unknown) =>
      stream.writeSSE({ event, data: JSON.stringify(data) }).catch(() => { /* flux fermé */ });
    // subscribe attend un Listener qui retourne void ; on ne propage pas la
    // promesse d'écriture (les erreurs sont déjà gérées par le .catch ci-dessus).
    const unsub = subscribe(id.id, (event, data) => void send(event, data));
    stream.onAbort(() => { unsub(); });
    await send("ready", { ok: true });
    // Keep-alive : on émet un ping tant que le flux est ouvert ; à la fermeture,
    // writeSSE rejette et le .catch absorbe l'erreur (boucle volontairement infinie).
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      await stream.sleep(25000);
      await stream.writeSSE({ event: "ping", data: "1" }).catch(() => { /* flux fermé */ });
    }
  });
});

/* ----------------------------- Connecteur MCP cloud ----------------------- */
// Transport Streamable HTTP authentifié par clé d'accès. Chaque requête construit
// un serveur MCP scopé à l'identité de la clé (aucun accès aux autres comptes en
// écriture). Mode stateless : une instance par requête, compatible scaling cloud.

// En-têtes CORS — permet aux clients web (MCP Inspector, etc.) d'appeler /mcp.
// Les connecteurs Claude/OpenAI appellent côté serveur (CORS non requis) mais
// c'est sans risque : l'autorisation repose sur la clé, pas sur l'origine.
function setMcpCors(c: Context) {
  c.header("Access-Control-Allow-Origin", c.req.header("origin") ?? "*");
  c.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version");
  c.header("Access-Control-Expose-Headers", "Mcp-Session-Id");
  c.header("Access-Control-Max-Age", "86400");
}

const isLocalHost = (host: string) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);

// Protection anti DNS-rebinding : on n'accepte que l'hôte légitime (domaine de
// prod tiré d'APP_URL, ou localhost). L'auth se faisant par jeton Bearer (pas de
// cookie ambiant), on ne restreint pas l'Origin — les clients web tiers comme
// claude.ai doivent pouvoir appeler le connecteur.
function mcpHostAllowed(c: Context): boolean {
  const host = (c.req.header("host") ?? "").toLowerCase();
  if (!host) return true; // certains proxys n'ajoutent pas d'en-tête Host
  const expected = new URL(appUrl()).host.toLowerCase();
  return host === expected || isLocalHost(host);
}

// Résout l'identité depuis `Authorization: Bearer <clé>` (préféré pour un
// connecteur), à défaut `X-Access-Key` ou `?key=`.
function mcpKey(c: Context): string | undefined {
  const auth = c.req.header("authorization");
  if (auth && /^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, "").trim();
  return c.req.header("x-access-key") ?? c.req.query("key");
}

app.options("/mcp", (c) => {
  setMcpCors(c);
  return c.body(null, 204);
});

app.on(["GET", "POST", "DELETE"], "/mcp", async (c) => {
  setMcpCors(c);
  if (!mcpHostAllowed(c)) {
    return c.json({ jsonrpc: "2.0", error: { code: -32600, message: "Hôte non autorisé." }, id: null }, 403);
  }
  // 1) Token OAuth 2.1 (Bearer) — voie standard des connecteurs cloud.
  // 2) Repli : clé d'accès brute en Bearer/X-Access-Key/?key= (clients simples).
  const bearer = c.req.header("authorization")?.replace(/^bearer\s+/i, "").trim();
  const oauth = bearer ? await verifyAccessToken(bearer) : null;
  const identity = oauth?.identity ?? (await getIdentityByKey(mcpKey(c)));
  if (!identity) {
    const meta = `${protectedResourceMetadata().resource.replace(/\/mcp$/, "")}/.well-known/oauth-protected-resource`;
    c.header("WWW-Authenticate", `Bearer realm="mindlog-id", resource_metadata="${meta}"`);
    return c.json(
      { jsonrpc: "2.0", error: { code: -32001, message: "Authentification requise (OAuth ou clé d'accès)." }, id: null },
      401
    );
  }
  // Scopes effectifs : un token OAuth délégué porte les catégories consenties ;
  // une clé d'accès brute (le propriétaire lui-même) a l'accès complet.
  const grantedScopes = oauth ? expandScopes(oauth.scope) : ALL_SCOPES;
  const server = buildCloudMcpServer(identity, grantedScopes);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless : pas de session persistée côté serveur
    enableJsonResponse: true,
  });
  await server.connect(transport);
  // Instance jetable (stateless) : libérée par le GC après la réponse. La fermeture
  // du transport est branchée sur l'abandon de la requête pour éviter toute fuite.
  c.req.raw.signal.addEventListener("abort", () => { void transport.close(); });
  return transport.handleRequest(c.req.raw);
});

// Les tarifs vivent désormais dans le flux de la landing (#sec-pricing) ;
// on garde l'ancienne URL pour compat en redirigeant vers l'ancre.
app.get("/pricing", (c) => c.redirect("/#sec-pricing", 301));

/* --------------------------------- Vitrine -------------------------------- */
// La landing et les pages légales vivent dans le site vitrine statique séparé
// (mindlog.id.web — https://mindlog.id en prod).
// En dev, on sert directement le shell SPA : son routeur JS gère / comme
// la landing page, ce qui évite un aller-retour vers la prod.
const VITRINE = (process.env.VITRINE_URL ?? "https://mindlog.id").replace(/\/$/, "");

app.get("/", (c) => c.redirect(VITRINE, 302));
app.get("/mentions-legales", (c) => c.redirect(`${VITRINE}/fr/mentions-legales/`, 301));
app.get("/cgu", (c) => c.redirect(`${VITRINE}/fr/cgu/`, 301));
app.get("/confidentialite", (c) => c.redirect(`${VITRINE}/fr/confidentialite/`, 301));
app.get("/cgv", (c) => c.redirect(`${VITRINE}/fr/cgv/`, 301));
app.get("/privacy", (c) => c.redirect(`${VITRINE}/fr/confidentialite/`, 301));
app.get("/legal", (c) => c.redirect(`${VITRINE}/fr/mentions-legales/`, 301));

/* ----------------------------------- Pages -------------------------------- */
// SPA mono-page : le routeur JS distingue landing (/), profil public (/@handle)
// et éditeur privé (/k/:key) à partir de l'URL.

const PUBLIC_DIR = resolve(process.cwd(), "public");
const shell = () =>
  readFileSync(resolve(PUBLIC_DIR, "index.html"), "utf8")
    .replace(/%%APP_VERSION%%/g, APP_VERSION)
    .replace(/__V__/g, assetVersion())
    .replace(/%%TURNSTILE_SITE_KEY%%/g, TURNSTILE_SITE_KEY);

app.use(
  "/static/*",
  serveStatic({ root: "./public", rewriteRequestPath: (p) => p.replace(/^\/static/, "") })
);

// PWA — manifest + service worker servis depuis la RACINE. Le SW doit avoir une
// portée « / » pour intercepter les navigations (servi sous /static il serait
// limité à /static). Le SW est templaté comme l'index (version = STARTED_AT) afin
// d'invalider son cache à chaque (re)démarrage/déploiement.
app.get("/manifest.webmanifest", (c) => {
  c.header("Content-Type", "application/manifest+json; charset=utf-8");
  c.header("Cache-Control", "public, max-age=3600");
  return c.body(readFileSync(resolve(PUBLIC_DIR, "manifest.webmanifest"), "utf8"));
});
app.get("/sw.js", (c) => {
  c.header("Content-Type", "text/javascript; charset=utf-8");
  c.header("Cache-Control", "no-cache");
  c.header("Service-Worker-Allowed", "/");
  return c.body(readFileSync(resolve(PUBLIC_DIR, "sw.js"), "utf8").replace(/__V__/g, assetVersion()));
});

const page = (c: Context) => {
  c.header("Cache-Control", "no-store");
  return c.html(shell());
};
app.get("/favicon.ico", (c) => c.redirect("/static/milo.svg", 301));

// Digital Asset Links — associe l'app Android au domaine pour les passkeys
// (Credential Manager) et les liens. Empreinte(s) SHA-256 du certificat de
// signature via ANDROID_CERT_SHA256 (plusieurs séparées par des virgules).
app.get("/.well-known/assetlinks.json", (c) => {
  const fps = (process.env.ANDROID_CERT_SHA256 ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  c.header("Cache-Control", "public, max-age=3600");
  return c.json([
    {
      relation: [
        "delegate_permission/common.get_login_creds",
        "delegate_permission/common.handle_all_urls",
      ],
      target: { namespace: "android_app", package_name: "today.mindlog.id", sha256_cert_fingerprints: fps },
    },
  ]);
});
// Lives Premium : pages HTML autonomes (ne passent pas par le shell SPA pour
// éviter d'embarquer les ~1 Mo d'app.js sur la fenêtre du live). Servies à
// tous (publiquement) — le gating se fait dans les routes /api/live/*.
app.get("/me/broadcast", (c) => {
  c.header("Cache-Control", "no-store");
  return c.html(readFileSync(resolve(PUBLIC_DIR, "live", "broadcast.html"), "utf8"));
});
app.get("/live/:streamId{[A-Za-z0-9-]+}", (c) => {
  c.header("Cache-Control", "no-store");
  return c.html(readFileSync(resolve(PUBLIC_DIR, "live", "watch.html"), "utf8"));
});

app.get("/app", page); // point d'entrée d'authentification (vue login du SPA)
app.get("/me", page);
app.get("/me/premium", page); // page « Espace Premium » plein écran (SPA)
app.get("/status", page);
app.get("/:handle{@[A-Za-z0-9_-]+}", page);
// Index de l'espace privé d'un créateur (liste des pages + paywall).
app.get("/:handle{@[A-Za-z0-9_-]+}/space", page);
// Page premium d'un créateur (paywall + rendu type-aware côté SPA).
app.get("/:handle{@[A-Za-z0-9_-]+}/p/:slug", page);
app.get("/k/:key", page);
app.get("/i/:token", page); // page d'acceptation d'invitation de contact

/* ----------------------------------- Boot --------------------------------- */

const port = Number(process.env.PORT ?? 8787);

// Chargement optionnel du module Premium (absent = édition communautaire).
let _premiumStartAdmin: (() => void) | undefined;
let _premiumEnsureMilo: (() => Promise<void>) | undefined;
try {
  const { register, startAdmin, ensureMiloPremium } = await import("./premium/index.js");
  register(app);
  _premiumStartAdmin = startAdmin;
  _premiumEnsureMilo = ensureMiloPremium;
} catch { /* édition communautaire : Premium non disponible */ }

await initDb(); // applique les migrations Drizzle
await seedFirstPartyClients(); // enregistre les clients OAuth first-party (mindlog.todo…) depuis l'env
await ensureMilo(); // crée/maj le profil mascotte @milo
if (_premiumEnsureMilo) {
  // En édition Premium, on enrichit @milo : abonnement actif, espace privé
  // avec tarif et tous bénéfices, page premium publiée, live planifié. Permet
  // d'avoir un compte de démo riche dès le premier boot.
  await _premiumEnsureMilo().catch((e) =>
    { console.warn("[premium] ensureMiloPremium:", (e as Error)?.message ?? e); },
  );
}

// Purge périodique : tokens/codes OAuth, sessions et messages éphémères expirés.
// (Les messages sont aussi purgés paresseusement à chaque lecture ; ce balayage
// borne le stockage si une conversation n'est plus jamais consultée.)
const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000; // 1 h

const REMINDER_LABELS: Record<string, string> = {
  "1m": "dans 1 mois",
  "1w": "dans 1 semaine",
  "3d": "dans 3 jours",
  "1d": "demain",
};

// Rappelle au destinataire les demandes de RDV en attente qui approchent de leur
// date (jalons 1 mois / 1 semaine / 3 jours / 1 jour avant). Chaque jalon n'est
// notifié qu'une fois (suivi via requests.reminders_sent).
async function sendDueReminders() {
  for (const { request, milestone } of await dueReminders()) {
    const owner = await getIdentityById(request.identity_id);
    if (owner && request.day) {
      const label = REMINDER_LABELS[milestone] ?? milestone;
      await notify(owner.id, "request", `Rappel : demande de RDV de ${request.name} (${label}) — en attente`, null);
      if (owner.recovery_email && isMailConfigured()) {
        try {
          await sendMail({
            to: owner.recovery_email,
            ...(await bookingReminderEmail(owner.handle, { name: request.name, day: request.day, message: request.message }, label)),
          });
        } catch { /* l'échec d'email n'empêche pas le marquage */ }
      }
    }
    await markReminderSent(request.id, milestone);
  }
}

async function runMaintenance() {
  try {
    const [, , , expiredAttachments] = await Promise.all([
      pruneOAuth(),
      pruneExpiredSessions(),
      pruneExpiredMessages(),
      pruneExpiredAttachments(),
      pruneExpiredInvites(),
      pruneExpiredLoginPins(),
      sendDueReminders(),
    ]);
    // Efface les blobs sur disque des pièces jointes expirées (le store ne fait que la DB).
    for (const f of expiredAttachments) {
      try { rmSync(resolve(DATA_DIR, f), { force: true }); } catch { /* ignoré */ }
    }
  } catch (e) {
    console.error("[maintenance] purge échouée :", e);
  }
}

// Chargement optionnel du module Premium (absent = édition communautaire).
// MINDLOG_NO_LISTEN=1 : importe l'app sans ouvrir de port (tests HTTP).
if (process.env.MINDLOG_NO_LISTEN !== "1") {
  void runMaintenance(); // au démarrage
  setInterval(() => void runMaintenance(), MAINTENANCE_INTERVAL_MS).unref();
  serve({ fetch: app.fetch, port }, (info) => {
    const base = `http://localhost:${info.port}`;
    console.log(`\n  mindlog ID  →  ${base}`);
    console.log(`  Landing     :  ${base}/`);
    console.log(`  Profil      :  ${base}/@<handle>`);
    console.log(`  Édition     :  ${base}/k/<clé>`);
  });
  _premiumStartAdmin?.(); // serveur admin mTLS (Premium uniquement)
}

export { app };
