import { test, after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { closeDb, db, initDb } from "../src/db.js";
import { createIdentity, getIdentityByHandle } from "../src/store.js";
import { pruneOAuth } from "../src/oauth.js";
import { oauthTokens } from "../src/schema.js";

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
  await db.execute(sql`DELETE FROM oauth_clients`);
});

const REDIRECT = "https://client.example/cb";
const b64url = (b: Buffer) => b.toString("base64url");

async function registerClient() {
  const res = await app.request("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: "Test Connector" }),
  });
  assert.equal(res.status, 201);
  return (await res.json()) as { client_id: string };
}

function pkce() {
  const verifier = b64url(randomBytes(32));
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** Déroule authorize (GET consentement → POST approve) et renvoie le code. */
async function getAuthCode(clientId: string, challenge: string, accessKey: string) {
  const qs = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "mindlog:identity",
    state: "xyz",
  });
  const getRes = await app.request(`/oauth/authorize?${qs.toString()}`);
  assert.equal(getRes.status, 200);
  const html = await getRes.text();
  const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? "";
  assert.ok(csrf, "csrf token présent");
  const cookie = /oauth_csrf=([^;]+)/.exec(getRes.headers.get("set-cookie") ?? "")?.[1] ?? "";

  const form = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "mindlog:identity",
    state: "xyz",
    resource: "",
    csrf,
    decision: "approve",
    access_key: accessKey,
  });
  const postRes = await app.request("/oauth/authorize", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: `oauth_csrf=${cookie}` },
    body: form.toString(),
    redirect: "manual",
  });
  assert.equal(postRes.status, 302);
  const loc = new URL(postRes.headers.get("location") ?? "");
  assert.equal(loc.searchParams.get("state"), "xyz");
  return loc.searchParams.get("code") ?? "";
}

async function exchangeCode(clientId: string, code: string, verifier: string) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT,
    client_id: clientId,
    code_verifier: verifier,
  });
  return app.request("/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

async function makeUser(handle: string) {
  await createIdentity(handle, handle);
  const id = await getIdentityByHandle(handle);
  if (!id) throw new Error("non créé");
  return id;
}

/* ------------------------------ Métadonnées ------------------------------ */

test("métadonnées AS et Protected Resource", async () => {
  const meta = (await (await app.request("/.well-known/oauth-authorization-server")).json()) as {
    authorization_endpoint: string;
    code_challenge_methods_supported: string[];
  };
  assert.ok(meta.authorization_endpoint.endsWith("/oauth/authorize"));
  assert.deepEqual(meta.code_challenge_methods_supported, ["S256"]);
  const pr = (await (await app.request("/.well-known/oauth-protected-resource")).json()) as {
    resource: string;
    authorization_servers: string[];
  };
  assert.ok(pr.resource.endsWith("/mcp"));
  assert.ok(Array.isArray(pr.authorization_servers));
});

test("la page de consentement propose la connexion par passkey", async () => {
  await makeUser("pat");
  const { client_id } = await registerClient();
  const { challenge } = pkce();
  const qs = new URLSearchParams({
    response_type: "code", client_id, redirect_uri: REDIRECT,
    code_challenge: challenge, code_challenge_method: "S256", scope: "mindlog:identity", state: "s",
  });
  const res = await app.request(`/oauth/authorize?${qs.toString()}`);
  const html = await res.text();
  assert.match(html, /Utiliser une passkey/);
  assert.match(html, /id="pk-handle"/);
  assert.match(html, /passkeys\/auth\/begin/);
  // La CSP de la page de consentement doit autoriser la redirection OAuth (form-action https:).
  assert.match(res.headers.get("content-security-policy") ?? "", /form-action 'self' https:/);
});

test("pruneOAuth supprime les tokens expirés", async () => {
  const u = await makeUser("quinn");
  await db.insert(oauthTokens).values({
    token_hash: "expired-test-hash",
    kind: "access",
    client_id: "mc_x",
    identity_id: u.id,
    scope: "mindlog:identity",
    expires_at: new Date(Date.now() - 1000).toISOString(),
  });
  await pruneOAuth();
  const rows = await db.select().from(oauthTokens).where(eq(oauthTokens.token_hash, "expired-test-hash"));
  assert.equal(rows.length, 0);
});

test("/mcp non authentifié → 401 avec WWW-Authenticate resource_metadata", async () => {
  const res = await app.request("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(res.status, 401);
  assert.match(res.headers.get("www-authenticate") ?? "", /resource_metadata=".*\.well-known\/oauth-protected-resource"/);
});

/* ------------------------------- Flux complet ---------------------------- */

test("flux OAuth complet : register → authorize → token → /mcp", async () => {
  const u = await makeUser("alice");
  const { client_id } = await registerClient();
  const { verifier, challenge } = pkce();
  const code = await getAuthCode(client_id, challenge, u.access_key);
  assert.ok(code, "code d'autorisation reçu");

  const tokRes = await exchangeCode(client_id, code, verifier);
  assert.equal(tokRes.status, 200);
  const tok = (await tokRes.json()) as { access_token: string; refresh_token: string; token_type: string };
  assert.equal(tok.token_type, "Bearer");
  assert.ok(tok.access_token && tok.refresh_token);

  // Le token OAuth donne accès au MCP, scopé à @alice.
  const mcpRes = await app.request("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${tok.access_token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
  });
  assert.equal(mcpRes.status, 200);
  const j = (await mcpRes.json()) as { result: { tools: { name: string }[] } };
  assert.ok(j.result.tools.some((t) => t.name === "whoami"));

  // Refresh : de nouveaux tokens.
  const rfRes = await app.request("/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id }).toString(),
  });
  assert.equal(rfRes.status, 200);
  const rf = (await rfRes.json()) as { access_token: string };
  assert.ok(rf.access_token && rf.access_token !== tok.access_token);
});

/* ------------------------------- Sécurité -------------------------------- */

test("PKCE invalide → invalid_grant", async () => {
  const u = await makeUser("bob");
  const { client_id } = await registerClient();
  const { challenge } = pkce();
  const code = await getAuthCode(client_id, challenge, u.access_key);
  const res = await exchangeCode(client_id, code, "mauvais-verifier");
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: string }).error, "invalid_grant");
});

test("code d'autorisation à usage unique", async () => {
  const u = await makeUser("carol");
  const { client_id } = await registerClient();
  const { verifier, challenge } = pkce();
  const code = await getAuthCode(client_id, challenge, u.access_key);
  assert.equal((await exchangeCode(client_id, code, verifier)).status, 200);
  // Rejoué → refusé.
  assert.equal((await exchangeCode(client_id, code, verifier)).status, 400);
});

test("clé d'accès invalide sur le consentement → pas de code", async () => {
  await makeUser("dan");
  const { client_id } = await registerClient();
  const { challenge } = pkce();
  // getAuthCode avec une mauvaise clé : la page de consentement est re-rendue (200), pas de redirect.
  const qs = new URLSearchParams({
    response_type: "code", client_id, redirect_uri: REDIRECT,
    code_challenge: challenge, code_challenge_method: "S256", scope: "mindlog:identity", state: "s",
  });
  const getRes = await app.request(`/oauth/authorize?${qs.toString()}`);
  const html = await getRes.text();
  const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? "";
  const cookie = /oauth_csrf=([^;]+)/.exec(getRes.headers.get("set-cookie") ?? "")?.[1] ?? "";
  const form = new URLSearchParams({
    response_type: "code", client_id, redirect_uri: REDIRECT, code_challenge: challenge,
    code_challenge_method: "S256", scope: "mindlog:identity", state: "s", resource: "",
    csrf, decision: "approve", access_key: "clé-bidon",
  });
  const res = await app.request("/oauth/authorize", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: `oauth_csrf=${cookie}` },
    body: form.toString(),
    redirect: "manual",
  });
  // Pas de redirection (donc pas de code) : la page de consentement est réaffichée
  // avec un message d'erreur.
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("location"), null);
  assert.match(await res.text(), /accès invalide/);
});
