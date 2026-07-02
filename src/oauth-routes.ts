/**
 * Endpoints OAuth 2.1 montés sur l'app Hono (voir src/oauth.ts pour la logique).
 *
 * Flux : le connecteur découvre les métadonnées, s'enregistre (DCR), puis ouvre
 * la page de consentement /oauth/authorize dans le navigateur de l'utilisateur.
 * Celui-ci s'authentifie avec sa clé d'accès mindlog (ou sa session existante) et
 * approuve : on émet un code, échangé ensuite contre des tokens sur /oauth/token.
 */
import type { Context, Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { randomBytes } from "node:crypto";
import { getIdentityBySession, SESSION_COOKIE } from "./session.js";
import { getEvents, getIdentityByKey, setRecoveryEmail, type Identity } from "./store.js";
import {
  OAUTH_SCOPE,
  SCOPE_AGENDA,
  SCOPE_PROFILE,
  SCOPE_LABELS,
  expandScopes,
  requestedOptionalScopes,
  authServerMetadata,
  clientSecretValid,
  consumeAuthCode,
  createAuthCode,
  getClient,
  getJwks,
  issueTokens,
  protectedResourceMetadata,
  registerClient,
  resourceAllowed,
  revokeToken,
  rotateRefreshToken,
  verifyAccessToken,
  verifyPkce,
} from "./oauth.js";

const CSRF_COOKIE = "oauth_csrf";

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c] ?? c);

function corsJson(c: Context) {
  c.header("Access-Control-Allow-Origin", c.req.header("origin") ?? "*");
  c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/** Identité courante via cookie de session (pour pré-remplir le consentement). */
async function sessionIdentity(c: Context): Promise<Identity | null> {
  const res = await getIdentityBySession(getCookie(c, SESSION_COOKIE));
  return res?.identity ?? null;
}

interface AuthzParams {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  response_type: string;
  scope: string;
  state: string;
  resource: string;
  nonce: string;
}

function readAuthzQuery(c: Context): AuthzParams {
  const q = (k: string) => c.req.query(k) ?? "";
  return {
    client_id: q("client_id"),
    redirect_uri: q("redirect_uri"),
    code_challenge: q("code_challenge"),
    code_challenge_method: q("code_challenge_method") || "S256",
    response_type: q("response_type"),
    scope: q("scope") || OAUTH_SCOPE,
    state: q("state"),
    resource: q("resource"),
    nonce: q("nonce"),
  };
}

function errorPage(c: Context, title: string, detail: string) {
  return c.html(
    `<!doctype html><meta charset="utf-8"><title>Erreur · mindlog</title>` +
      `<div style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">` +
      `<h1 style="font-size:1.25rem">🦎 ${esc(title)}</h1><p style="color:#555">${esc(detail)}</p></div>`,
    400
  );
}

function redirectError(redirectUri: string, state: string, error: string, desc?: string): Response {
  const u = new URL(redirectUri);
  u.searchParams.set("error", error);
  if (desc) u.searchParams.set("error_description", desc);
  if (state) u.searchParams.set("state", state);
  return new Response(null, { status: 302, headers: { Location: u.toString() } });
}

const INPUT_STYLE =
  "width:100%;padding:.6rem;margin-top:.3rem;border:1px solid #ccc;border-radius:8px;box-sizing:border-box";

// Flux passkey : ouvre une session cookie via les endpoints existants puis recharge
// la page (le serveur reconnaît alors la session et affiche « Autoriser »).
const PASSKEY_SCRIPT = `<script>
(() => {
  const btn = document.getElementById("pk-btn");
  const err = document.getElementById("pk-err");
  btn.addEventListener("click", async () => {
    err.textContent = "";
    if (!window.PublicKeyCredential) { err.textContent = "Passkeys non supportées ici."; return; }
    const handle = document.getElementById("pk-handle").value.trim();
    if (!handle) { err.textContent = "Handle requis."; return; }
    try {
      const beginRes = await fetch("/api/passkeys/auth/begin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle }) });
      if (!beginRes.ok) throw new Error("Compte introuvable.");
      const options = await beginRes.json();
      const { startAuthentication } = await import("https://unpkg.com/@simplewebauthn/browser@13/esm/index.js");
      const response = await startAuthentication({ optionsJSON: options });
      const finRes = await fetch("/api/passkeys/auth/finish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle, response }) });
      if (!finRes.ok) throw new Error("Échec de l'authentification.");
      location.reload();
    } catch (e) {
      if (e && e.name !== "NotAllowedError") err.textContent = (e && e.message) || "Authentification annulée.";
    }
  });
})();
</script>`;

// CSP propre à la page de consentement : `form-action` doit autoriser la
// redirection OAuth finale vers le client (claude.ai, etc.). La redirect_uri est
// déjà validée côté serveur (elle doit être enregistrée), donc autoriser https:
// pour les actions de formulaire ne crée pas de risque. Remplace la CSP globale
// (form-action 'self') qui bloquerait la redirection.
const CONSENT_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://unpkg.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self' https:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
].join("; ");

/** Page de consentement. L'auth se fait par clé d'accès, passkey, ou session existante. */
function consentPage(c: Context, p: AuthzParams, clientName: string, me: Identity | null, csrf: string, msg = "") {
  c.header("Content-Security-Policy", CONSENT_CSP);
  const hidden =
    (Object.entries(p) as [string, string][])
      .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
      .join("") + `<input type="hidden" name="csrf" value="${esc(csrf)}">`;

  const buttons =
    `<div style="display:flex;gap:.75rem;margin-top:1.25rem">` +
    `<button name="decision" value="approve" style="flex:1;padding:.7rem;border:0;border-radius:10px;background:#2563eb;color:#fff;font-weight:600;cursor:pointer">Autoriser</button>` +
    `<button name="decision" value="deny" style="flex:1;padding:.7rem;border:1px solid #ccc;border-radius:10px;background:#fff;cursor:pointer">Refuser</button>` +
    `</div>`;

  // Consentement sélectif : le profil (identité) est toujours accordé ; les autres
  // catégories demandées sont des cases à cocher pré-cochées et décochables.
  const optional = requestedOptionalScopes(p.scope);
  const scopesBlock =
    `<fieldset style="border:1px solid #eee;border-radius:12px;padding:.5rem 1rem;margin:1rem 0">` +
    `<legend style="font-size:.8rem;color:#666;padding:0 .35rem">Accès demandés</legend>` +
    `<label style="display:flex;gap:.5rem;align-items:flex-start;margin:.4rem 0;color:#666">` +
    `<input type="checkbox" checked disabled style="margin-top:.15rem">` +
    `<span>${esc(SCOPE_LABELS[SCOPE_PROFILE])} <em style="color:#999">(toujours inclus)</em></span></label>` +
    optional
      .map(
        (s) =>
          `<label style="display:flex;gap:.5rem;align-items:flex-start;margin:.4rem 0">` +
          `<input type="checkbox" name="grant" value="${esc(s)}" checked style="margin-top:.15rem">` +
          `<span>${esc(SCOPE_LABELS[s] ?? s)}</span></label>`
      )
      .join("") +
    `</fieldset>`;

  // Authentifié (session) : juste approuver/refuser. Sinon : clé d'accès (dans le
  // formulaire) + alternative passkey (flux JS qui ouvre une session puis recharge).
  const authBlock = me
    ? `<p>Connecté·e en tant que <strong>@${esc(me.handle)}</strong>.</p>` +
      `<form method="post" action="/oauth/authorize">${hidden}${scopesBlock}${buttons}</form>`
    : `<form method="post" action="/oauth/authorize">${hidden}${scopesBlock}` +
        `<label style="display:block;margin:1rem 0">Votre clé d'accès mindlog` +
        `<input name="access_key" type="password" required autocomplete="off" style="${INPUT_STYLE}" placeholder="collez votre clé d'accès"></label>` +
        buttons +
      `</form>` +
      `<div style="margin:1.25rem 0;text-align:center;color:#aaa">— ou —</div>` +
      `<label style="display:block">Se connecter avec une passkey` +
        `<input id="pk-handle" type="text" autocomplete="username webauthn" style="${INPUT_STYLE}" placeholder="votre handle (ex. jacques)"></label>` +
        `<button type="button" id="pk-btn" style="width:100%;margin-top:.6rem;padding:.7rem;border:1px solid #2563eb;border-radius:10px;background:#fff;color:#2563eb;font-weight:600;cursor:pointer">🔑 Utiliser une passkey</button>` +
        `<p id="pk-err" style="color:#c00;font-size:.85rem;min-height:1.1em"></p>` +
        PASSKEY_SCRIPT;
  return c.html(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>Autoriser ${esc(clientName)} · mindlog</title>` +
      `<div style="font-family:system-ui;max-width:30rem;margin:3rem auto;padding:1.5rem;border:1px solid #eee;border-radius:16px">` +
      `<h1 style="font-size:1.2rem">🦎 Autoriser l'accès</h1>` +
      `<p><strong>${esc(clientName || p.client_id)}</strong> demande l'accès à votre carte d'identité mindlog ` +
      `au nom de votre compte. Choisissez ce que vous partagez :</p>` +
      (msg ? `<p style="color:#c00">${esc(msg)}</p>` : "") +
      authBlock +
      `<p style="color:#888;font-size:.8rem;margin-top:1rem">La clé n'est jamais transmise à ${esc(clientName || "l'application")} : ` +
      `elle reçoit seulement un jeton temporaire révocable.</p></div>`
  );
}

export function mountOAuth(app: Hono): void {
  /* --------------------------- Métadonnées --------------------------- */
  const meta = (fn: () => unknown) => (c: Context) => {
    corsJson(c);
    return c.json(fn());
  };
  app.get("/.well-known/oauth-authorization-server", meta(authServerMetadata));
  app.get("/.well-known/openid-configuration", meta(authServerMetadata));
  app.get("/.well-known/oauth-protected-resource", meta(protectedResourceMetadata));
  app.get("/.well-known/oauth-protected-resource/mcp", meta(protectedResourceMetadata));
  app.options("/oauth/*", (c) => {
    corsJson(c);
    return c.body(null, 204);
  });

  /* ------------------------------ JWKS ------------------------------- */
  app.get("/oauth/jwks", (c) => {
    corsJson(c);
    return c.json(getJwks());
  });

  /* --------------------------- UserInfo ------------------------------ */
  app.get("/oauth/userinfo", async (c) => {
    corsJson(c);
    const auth = c.req.header("Authorization") ?? "";
    const rawToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!rawToken) return c.json({ error: "invalid_token" }, 401);
    const info = await verifyAccessToken(rawToken);
    if (!info) return c.json({ error: "invalid_token" }, 401);
    const { identity } = info;
    return c.json({
      sub: identity.id.toString(),
      name: identity.handle,
      picture: `${new URL(c.req.url).origin}/api/photo/${identity.id}`,
      ...(identity.recovery_email ? { email: identity.recovery_email, email_verified: false } : {}),
    });
  });

  /* --------------------------- Agenda (lecture) ----------------------- */
  // Lecture seule des événements de l'agenda du titulaire du token, réservée aux
  // tokens dont le scope optionnel `mindlog:agenda` a été accordé au consentement.
  // Consommé par les apps clientes (ex. mindlog.todo) pour afficher l'agenda.
  app.get("/oauth/agenda", async (c) => {
    corsJson(c);
    const auth = c.req.header("Authorization") ?? "";
    const rawToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!rawToken) return c.json({ error: "invalid_token" }, 401);
    const info = await verifyAccessToken(rawToken);
    if (!info) return c.json({ error: "invalid_token" }, 401);
    if (!expandScopes(info.scope).has(SCOPE_AGENDA))
      return c.json({ error: "insufficient_scope", scope: SCOPE_AGENDA }, 403);
    const events = await getEvents(info.identity.id, true);
    return c.json({
      events: events.map((e) => ({
        id: e.id,
        title: e.title,
        starts_at: e.starts_at,
        ends_at: e.ends_at,
        location: e.location,
        link: e.link,
        is_public: e.is_public === 1,
        kind: e.kind,
      })),
    });
  });

  app.options("/oauth/agenda", (c) => {
    corsJson(c);
    return c.body(null, 204);
  });

  /* ----------------- Recovery email (écriture via token OAuth) ----------- */
  // Permet à une app cliente (ex. mindlog.todo) d'enregistrer, pour le compte de
  // l'utilisateur authentifié, l'email qu'il a saisi — de sorte que l'identité
  // mindlog devienne la source unique (userinfo le renverra ensuite). On ne
  // remplace JAMAIS un email déjà présent : le compte garde la main.
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  app.post("/oauth/recovery-email", async (c) => {
    corsJson(c);
    const auth = c.req.header("Authorization") ?? "";
    const rawToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!rawToken) return c.json({ error: "invalid_token" }, 401);
    const info = await verifyAccessToken(rawToken);
    if (!info) return c.json({ error: "invalid_token" }, 401);
    let body: { email?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_request" }, 400);
    }
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (!email || email.length > 200 || !EMAIL_RE.test(email))
      return c.json({ error: "invalid_email" }, 400);
    if (info.identity.recovery_email) return c.json({ ok: true, updated: false });
    await setRecoveryEmail(info.identity.id, email);
    return c.json({ ok: true, updated: true });
  });

  /* ------------------ Dynamic Client Registration -------------------- */
  app.post("/oauth/register", async (c) => {
    corsJson(c);
    let body: { redirect_uris?: unknown; client_name?: unknown; token_endpoint_auth_method?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_client_metadata", error_description: "JSON requis" }, 400);
    }
    const uris = Array.isArray(body.redirect_uris) ? (body.redirect_uris as unknown[]) : [];
    const redirect_uris = uris.filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u));
    if (!redirect_uris.length)
      return c.json({ error: "invalid_redirect_uri", error_description: "redirect_uris requis (http/https)" }, 400);
    const reg = await registerClient({
      redirect_uris,
      client_name: typeof body.client_name === "string" ? body.client_name.slice(0, 200) : "",
      token_endpoint_auth_method:
        body.token_endpoint_auth_method === "client_secret_post" ? "client_secret_post" : "none",
    });
    return c.json(
      {
        client_id: reg.client_id,
        ...(reg.client_secret ? { client_secret: reg.client_secret } : {}),
        client_id_issued_at: Math.floor(Date.now() / 1000),
        redirect_uris,
        client_name: reg.record.client_name,
        token_endpoint_auth_method: reg.record.token_endpoint_auth_method,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      201
    );
  });

  /* --------------------------- Authorization ------------------------- */
  app.get("/oauth/authorize", async (c) => {
    const p = readAuthzQuery(c);
    const client = await getClient(p.client_id);
    if (!client) return errorPage(c, "Application inconnue", "client_id non enregistré.");
    if (!client.redirect_uris.includes(p.redirect_uri))
      return errorPage(c, "URL de redirection invalide", "redirect_uri non enregistrée pour ce client.");
    // À partir d'ici, redirect_uri est sûre : les erreurs repartent vers le client.
    if (p.response_type !== "code")
      return redirectError(p.redirect_uri, p.state, "unsupported_response_type");
    // PKCE obligatoire pour les clients publics ; optionnel pour les clients confidentiels
    // (ex. Authentik qui s'authentifie via client_secret_post)
    const isConfidential = !!client.client_secret_hash;
    if (!isConfidential && (p.code_challenge_method !== "S256" || !p.code_challenge))
      return redirectError(p.redirect_uri, p.state, "invalid_request", "PKCE S256 requis");

    const csrf = randomBytes(16).toString("base64url");
    setCookie(c, CSRF_COOKIE, csrf, { httpOnly: true, sameSite: "Lax", path: "/oauth", maxAge: 600 });
    return consentPage(c, p, client.client_name, await sessionIdentity(c), csrf);
  });

  app.post("/oauth/authorize", async (c) => {
    const form = await c.req.parseBody({ all: true });
    const s = (k: string) => (typeof form[k] === "string" ? form[k] : "");
    const p: AuthzParams = {
      client_id: s("client_id"),
      redirect_uri: s("redirect_uri"),
      code_challenge: s("code_challenge"),
      code_challenge_method: s("code_challenge_method") || "S256",
      response_type: s("response_type") || "code",
      scope: s("scope") || OAUTH_SCOPE,
      state: s("state"),
      resource: s("resource"),
      nonce: s("nonce"),
    };
    const client = await getClient(p.client_id);
    if (!client?.redirect_uris.includes(p.redirect_uri))
      return errorPage(c, "Requête invalide", "Client ou redirect_uri invalide.");

    // CSRF double-submit : le token du formulaire doit égaler le cookie posé au GET.
    const csrfCookie = getCookie(c, CSRF_COOKIE);
    if (!csrfCookie || csrfCookie !== s("csrf"))
      return errorPage(c, "Session expirée", "Veuillez relancer l'autorisation.");

    if (s("decision") !== "approve")
      return redirectError(p.redirect_uri, p.state, "access_denied");

    // RFC 8707 : si une ressource cible est demandée, elle doit être autorisée
    // (sinon on refuse de forger une audience arbitraire).
    if (p.resource && !resourceAllowed(p.resource))
      return redirectError(p.redirect_uri, p.state, "invalid_target", "resource non autorisée");

    // Authentification : session existante ou clé d'accès saisie.
    const me = (await sessionIdentity(c)) ?? (await getIdentityByKey(s("access_key")));
    if (!me) {
      const csrf = randomBytes(16).toString("base64url");
      setCookie(c, CSRF_COOKIE, csrf, { httpOnly: true, sameSite: "Lax", path: "/oauth", maxAge: 600 });
      return consentPage(c, p, client.client_name, null, csrf, "Clé d'accès invalide.");
    }

    // Scope accordé = profil (toujours) + cases cochées (bornées aux scopes
    // optionnels réellement demandés) + scopes OIDC standard demandés (openid…).
    const requestedOptional = requestedOptionalScopes(p.scope);
    const grantValues = form.grant;
    const checked = new Set(
      Array.isArray(grantValues)
        ? grantValues.filter((v): v is string => typeof v === "string")
        : typeof grantValues === "string"
          ? [grantValues]
          : []
    );
    const grantedOptional = requestedOptional.filter((sc) => checked.has(sc));
    const oidcPass = p.scope.split(/\s+/).filter((sc) => sc === "openid" || sc === "profile" || sc === "email");
    const grantedScope = [...new Set([...oidcPass, SCOPE_PROFILE, ...grantedOptional])].join(" ");

    const code = await createAuthCode({
      client_id: p.client_id,
      identity_id: me.id,
      redirect_uri: p.redirect_uri,
      code_challenge: p.code_challenge,
      scope: grantedScope,
      resource: p.resource || undefined,
      nonce: p.nonce || undefined,
    });
    const u = new URL(p.redirect_uri);
    u.searchParams.set("code", code);
    if (p.state) u.searchParams.set("state", p.state);
    return c.redirect(u.toString());
  });

  /* ------------------------------ Token ------------------------------ */
  app.post("/oauth/token", async (c) => {
    corsJson(c);
    c.header("Cache-Control", "no-store");
    const form: Record<string, string | File> = await c.req.parseBody().catch(() => ({}));
    const g = (k: string) => (typeof form[k] === "string" ? form[k] : "");
    const grant = g("grant_type");
    const clientId = g("client_id");
    const client = await getClient(clientId);
    if (!client) return c.json({ error: "invalid_client" }, 401);
    if (!clientSecretValid(client, g("client_secret") || undefined))
      return c.json({ error: "invalid_client" }, 401);

    if (grant === "authorization_code") {
      const rec = await consumeAuthCode(g("code"));
      if (rec?.client_id !== clientId) return c.json({ error: "invalid_grant" }, 400);
      if (rec.redirect_uri !== g("redirect_uri")) return c.json({ error: "invalid_grant", error_description: "redirect_uri" }, 400);
      // Skip PKCE if code_challenge was not set (confidential client without PKCE)
      if (rec.code_challenge && !verifyPkce(g("code_verifier"), rec.code_challenge))
        return c.json({ error: "invalid_grant", error_description: "PKCE" }, 400);
      return c.json(await issueTokens({ client_id: clientId, identity_id: rec.identity_id, scope: rec.scope, resource: rec.resource, nonce: rec.nonce }));
    }

    if (grant === "refresh_token") {
      const tokens = await rotateRefreshToken(clientId, g("refresh_token"));
      if (!tokens) return c.json({ error: "invalid_grant" }, 400);
      return c.json(tokens);
    }

    return c.json({ error: "unsupported_grant_type" }, 400);
  });

  /* ------------------------------ Revoke ----------------------------- */
  app.post("/oauth/revoke", async (c) => {
    corsJson(c);
    const form: Record<string, string | File> = await c.req.parseBody().catch(() => ({}));
    const tok = typeof form.token === "string" ? form.token : "";
    if (tok) await revokeToken(tok);
    return c.json({ ok: true }); // toujours 200 (RFC 7009)
  });
}
