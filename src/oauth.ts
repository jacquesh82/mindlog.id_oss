/**
 * OAuth 2.1 — mindlog comme serveur d'autorisation (AS) ET serveur de ressources
 * (RS) pour le connecteur MCP cloud, conforme à la spec d'autorisation MCP :
 * PKCE obligatoire (S256), Dynamic Client Registration (RFC 7591), métadonnées
 * AS (RFC 8414) et Protected Resource (RFC 9728).
 *
 * L'utilisateur s'authentifie sur la page de consentement avec sa **clé d'accès
 * mindlog** (ou une session existante) : le connecteur ne voit jamais la clé,
 * seulement des tokens OAuth à durée de vie courte. Seul le sha256 des secrets
 * (codes, tokens, secret client) est stocké.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { db } from "./db.js";
import { oauthClients, oauthCodes, oauthTokens } from "./schema.js";
import { getIdentityById, type Identity } from "./store.js";
import { appUrl } from "./mailer.js";

export const OAUTH_SCOPE = "mindlog:identity";
const ACCESS_TTL_MS = 60 * 60 * 1000; // 1 h
const REFRESH_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 j
const CODE_TTL_MS = 5 * 60 * 1000; // 5 min

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const token = (bytes = 32) => randomBytes(bytes).toString("base64url");
const isoIn = (ms: number) => new Date(Date.now() + ms).toISOString();

export const issuer = () => appUrl();
export const resourceUrl = () => `${appUrl()}/mcp`;

/** Métadonnées du serveur d'autorisation (RFC 8414). */
export function authServerMetadata() {
  const base = appUrl();
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    scopes_supported: [OAUTH_SCOPE],
  };
}

/** Métadonnées de la ressource protégée (RFC 9728). */
export function protectedResourceMetadata() {
  return {
    resource: resourceUrl(),
    authorization_servers: [appUrl()],
    scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ["header"],
  };
}

/* ------------------------------ Clients (DCR) ---------------------------- */

export interface ClientRecord {
  client_id: string;
  client_secret_hash: string | null;
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
}

export async function registerClient(input: {
  redirect_uris: string[];
  client_name?: string;
  token_endpoint_auth_method?: string;
}): Promise<{ client_id: string; client_secret?: string; record: ClientRecord }> {
  const clientId = `mc_${token(16)}`;
  const confidential = input.token_endpoint_auth_method === "client_secret_post";
  const secret = confidential ? token(32) : undefined;
  await db.insert(oauthClients).values({
    client_id: clientId,
    client_secret_hash: secret ? sha256(secret) : null,
    client_name: input.client_name ?? "",
    redirect_uris: JSON.stringify(input.redirect_uris),
    token_endpoint_auth_method: confidential ? "client_secret_post" : "none",
  });
  return {
    client_id: clientId,
    client_secret: secret,
    record: {
      client_id: clientId,
      client_secret_hash: secret ? sha256(secret) : null,
      client_name: input.client_name ?? "",
      redirect_uris: input.redirect_uris,
      token_endpoint_auth_method: confidential ? "client_secret_post" : "none",
    },
  };
}

export async function getClient(clientId: string): Promise<ClientRecord | null> {
  const rows = await db.select().from(oauthClients).where(eq(oauthClients.client_id, clientId)).limit(1);
  const r = rows.at(0);
  if (!r) return null;
  return {
    client_id: r.client_id,
    client_secret_hash: r.client_secret_hash,
    client_name: r.client_name,
    redirect_uris: JSON.parse(r.redirect_uris) as string[],
    token_endpoint_auth_method: r.token_endpoint_auth_method,
  };
}

/** Vérifie le secret d'un client confidentiel (constant-ish via hash). */
export function clientSecretValid(client: ClientRecord, secret: string | undefined): boolean {
  if (!client.client_secret_hash) return true; // client public : pas de secret
  return !!secret && sha256(secret) === client.client_secret_hash;
}

/* --------------------------- Codes d'autorisation ------------------------ */

export async function createAuthCode(input: {
  client_id: string;
  identity_id: number;
  redirect_uri: string;
  code_challenge: string;
  scope: string;
  resource?: string;
}): Promise<string> {
  const code = token(32);
  await db.insert(oauthCodes).values({
    code_hash: sha256(code),
    client_id: input.client_id,
    identity_id: input.identity_id,
    redirect_uri: input.redirect_uri,
    code_challenge: input.code_challenge,
    scope: input.scope,
    resource: input.resource ?? null,
    expires_at: isoIn(CODE_TTL_MS),
  });
  return code;
}

interface CodeRecord {
  client_id: string;
  identity_id: number;
  redirect_uri: string;
  code_challenge: string;
  scope: string;
  resource: string | null;
  expires_at: string;
}

/** Lit ET consomme (usage unique) un code d'autorisation. */
export async function consumeAuthCode(code: string): Promise<CodeRecord | null> {
  const h = sha256(code);
  const rows = await db.select().from(oauthCodes).where(eq(oauthCodes.code_hash, h)).limit(1);
  const r = rows.at(0);
  // Suppression inconditionnelle : un code n'est jamais réutilisable.
  await db.delete(oauthCodes).where(eq(oauthCodes.code_hash, h));
  if (!r) return null;
  if (Date.parse(r.expires_at) < Date.now()) return null;
  return r;
}

/** Vérifie un code_verifier PKCE contre le code_challenge (méthode S256). */
export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const computed = createHash("sha256").update(codeVerifier).digest("base64url");
  return computed === codeChallenge;
}

/* --------------------------------- Tokens -------------------------------- */

export interface IssuedTokens {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
}

export async function issueTokens(input: {
  client_id: string;
  identity_id: number;
  scope: string;
  resource?: string | null;
}): Promise<IssuedTokens> {
  const access = token(32);
  const refresh = token(32);
  await db.insert(oauthTokens).values([
    {
      token_hash: sha256(access),
      kind: "access",
      client_id: input.client_id,
      identity_id: input.identity_id,
      scope: input.scope,
      resource: input.resource ?? null,
      expires_at: isoIn(ACCESS_TTL_MS),
    },
    {
      token_hash: sha256(refresh),
      kind: "refresh",
      client_id: input.client_id,
      identity_id: input.identity_id,
      scope: input.scope,
      resource: input.resource ?? null,
      expires_at: isoIn(REFRESH_TTL_MS),
    },
  ]);
  return {
    access_token: access,
    refresh_token: refresh,
    token_type: "Bearer",
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    scope: input.scope,
  };
}

export interface AccessTokenInfo {
  identity: Identity;
  client_id: string;
  scope: string;
}

/** Vérifie un access token OAuth et renvoie l'identité associée, sinon null. */
export async function verifyAccessToken(accessToken: string): Promise<AccessTokenInfo | null> {
  const h = sha256(accessToken);
  const rows = await db
    .select()
    .from(oauthTokens)
    .where(and(eq(oauthTokens.token_hash, h), eq(oauthTokens.kind, "access")))
    .limit(1);
  const r = rows.at(0);
  if (!r) return null;
  if (Date.parse(r.expires_at) < Date.now()) {
    await db.delete(oauthTokens).where(eq(oauthTokens.token_hash, h));
    return null;
  }
  const identity = await getIdentityById(r.identity_id);
  if (!identity) return null;
  return { identity, client_id: r.client_id, scope: r.scope };
}

/** Échange (et fait tourner) un refresh token. Renvoie de nouveaux tokens. */
export async function rotateRefreshToken(
  client_id: string,
  refreshToken: string
): Promise<IssuedTokens | null> {
  const h = sha256(refreshToken);
  const rows = await db
    .select()
    .from(oauthTokens)
    .where(and(eq(oauthTokens.token_hash, h), eq(oauthTokens.kind, "refresh")))
    .limit(1);
  const r = rows.at(0);
  if (r?.client_id !== client_id) return null;
  await db.delete(oauthTokens).where(eq(oauthTokens.token_hash, h)); // rotation : invalide l'ancien
  if (Date.parse(r.expires_at) < Date.now()) return null;
  return issueTokens({ client_id, identity_id: r.identity_id, scope: r.scope, resource: r.resource });
}

export async function revokeToken(rawToken: string): Promise<void> {
  await db.delete(oauthTokens).where(eq(oauthTokens.token_hash, sha256(rawToken)));
}

/** Purge codes et tokens expirés (à appeler périodiquement). */
export async function pruneOAuth(): Promise<void> {
  const now = new Date().toISOString();
  await db.delete(oauthCodes).where(lt(oauthCodes.expires_at, now));
  await db.delete(oauthTokens).where(lt(oauthTokens.expires_at, now));
}
