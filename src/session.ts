/**
 * Sessions de connexion adossées à un cookie HttpOnly.
 *
 * Le client reçoit un token opaque aléatoire dans un cookie `HttpOnly; Secure;
 * SameSite=Lax`. En base on ne conserve que le SHA-256 du token : une fuite de
 * la table `sessions` ne révèle aucun token réutilisable.
 */

import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { db } from "./db.js";
import { identities, sessions } from "./schema.js";
import type { Identity } from "./store.js";

export const SESSION_COOKIE = "mindlog_session";
export const SESSION_TTL_DAYS = 30;
const TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const isoIn = (ms: number) => new Date(Date.now() + ms).toISOString();

/** Crée une session et renvoie le token brut (à poser dans le cookie). */
export async function createSession(
  identityId: number,
  userAgent?: string
): Promise<{ token: string; ttlMs: number }> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({
    token_hash: hash(token),
    identity_id: identityId,
    expires_at: isoIn(TTL_MS),
    user_agent: userAgent ?? null,
  });
  return { token, ttlMs: TTL_MS };
}

/**
 * Résout l'identité depuis un token de session. Vérifie l'expiration, met à
 * jour `last_seen` et applique un renouvellement glissant.
 */
export async function getIdentityBySession(
  token: string | null | undefined
): Promise<{ identity: Identity; renewedTtlMs: number | null } | undefined> {
  if (!token) return undefined;
  const th = hash(token);
  const rows = await db
    .select({ identity_id: sessions.identity_id, expires_at: sessions.expires_at })
    .from(sessions)
    .where(eq(sessions.token_hash, th))
    .limit(1);
  const row = rows.at(0);
  if (!row) return undefined;

  const expires = Date.parse(row.expires_at);
  if (!Number.isFinite(expires) || expires < Date.now()) {
    await db.delete(sessions).where(eq(sessions.token_hash, th));
    return undefined;
  }

  const idRows = await db.select().from(identities).where(eq(identities.id, row.identity_id)).limit(1);
  const identity = idRows[0] as Identity | undefined;
  if (!identity) {
    await db.delete(sessions).where(eq(sessions.token_hash, th));
    return undefined;
  }

  let renewedTtlMs: number | null = null;
  if (expires - Date.now() < TTL_MS - RENEW_AFTER_MS) {
    await db
      .update(sessions)
      .set({ expires_at: isoIn(TTL_MS), last_seen: new Date().toISOString() })
      .where(eq(sessions.token_hash, th));
    renewedTtlMs = TTL_MS;
  } else {
    await db.update(sessions).set({ last_seen: new Date().toISOString() }).where(eq(sessions.token_hash, th));
  }

  return { identity, renewedTtlMs };
}

/** Détruit une session précise (déconnexion de cet appareil). */
export async function destroySession(token: string | null | undefined): Promise<void> {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.token_hash, hash(token)));
}

/** Détruit toutes les sessions d'une identité (déconnexion partout / rotation). */
export async function destroyAllSessions(identityId: number): Promise<void> {
  await db.delete(sessions).where(eq(sessions.identity_id, identityId));
}

export interface SessionInfo {
  tokenHash: string;
  createdAt: string;
  lastSeen: string;
  userAgent: string | null;
}

/** Liste les sessions actives (non expirées) d'une identité, plus récentes d'abord. */
export async function listSessions(identityId: number): Promise<SessionInfo[]> {
  return db
    .select({
      tokenHash: sessions.token_hash,
      createdAt: sessions.created_at,
      lastSeen: sessions.last_seen,
      userAgent: sessions.user_agent,
    })
    .from(sessions)
    .where(and(eq(sessions.identity_id, identityId), gte(sessions.expires_at, new Date().toISOString())))
    .orderBy(desc(sessions.last_seen));
}

/** Hash du token courant — pour repérer « cette session » dans la liste. */
export const currentSessionTokenHash = (token: string | null | undefined): string | null =>
  token ? hash(token) : null;

/** Révoque une session précise d'une identité, désignée par son hash. */
export async function destroySessionByHash(identityId: number, tokenHash: string): Promise<void> {
  await db
    .delete(sessions)
    .where(and(eq(sessions.token_hash, tokenHash), eq(sessions.identity_id, identityId)));
}

/** Purge les sessions expirées (à appeler périodiquement). */
export async function pruneExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expires_at, new Date().toISOString()));
}
