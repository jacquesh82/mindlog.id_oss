// Domaine « notifications » — extrait de src/store.ts (barrel). Voir docs si besoin.
import { randomBytes } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "../db.js";
import {
  identities,
  notifications,
  requests,
} from "../schema.js";
import { StoreError, getIdentityByHandle, normalizeHandle } from "./identities.js";

/* ------------------------------ Notifications ---------------------------- */

export interface Notification {
  id: number;
  type: string;
  text: string;
  link: string | null;
  read: number;
  created_at: string;
}

export async function addNotification(
  identityId: number,
  type: string,
  text: string,
  link: string | null = null
): Promise<void> {
  await db.insert(notifications).values({ identity_id: identityId, type, text, link });
  // Garde au plus 50 notifications par identité.
  await db.execute(sql`
    DELETE FROM notifications WHERE identity_id = ${identityId} AND id NOT IN (
      SELECT id FROM notifications WHERE identity_id = ${identityId} ORDER BY id DESC LIMIT 50)
  `);
}

export async function getNotifications(identityId: number, limit = 20): Promise<Notification[]> {
  return db
    .select({
      id: notifications.id,
      type: notifications.type,
      text: notifications.text,
      link: notifications.link,
      read: notifications.read,
      created_at: notifications.created_at,
    })
    .from(notifications)
    .where(eq(notifications.identity_id, identityId))
    .orderBy(desc(notifications.id))
    .limit(limit);
}

export async function unreadCount(identityId: number): Promise<number> {
  const res = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM notifications WHERE identity_id = ${identityId} AND read = 0`
  );
  return (res.rows[0] as { n: number }).n;
}

export async function markNotificationsRead(identityId: number): Promise<void> {
  await db.update(notifications).set({ read: 1 }).where(eq(notifications.identity_id, identityId));
}

export async function stats(): Promise<{
  identities: number;
  events: number;
  requests: number;
  relations: number;
  identitiesLast7d: number;
}> {
  const one = async (q: ReturnType<typeof sql>) => ((await db.execute(q)).rows[0] as { n: number }).n;
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  return {
    identities: await one(sql`SELECT COUNT(*)::int AS n FROM identities`),
    events: await one(sql`SELECT COUNT(*)::int AS n FROM events`),
    requests: await one(sql`SELECT COUNT(*)::int AS n FROM requests`),
    relations: await one(sql`SELECT COUNT(*)::int AS n FROM relations`),
    identitiesLast7d: await one(sql`SELECT COUNT(*)::int AS n FROM identities WHERE created_at >= ${since}`),
  };
}

export async function rotateAccessKey(identityId: number): Promise<string> {
  const key = randomBytes(24).toString("base64url");
  await db.update(identities).set({ access_key: key }).where(eq(identities.id, identityId));
  return key;
}

export async function deleteIdentity(identityId: number): Promise<void> {
  await db.delete(identities).where(eq(identities.id, identityId));
}

export async function setRecoveryEmail(identityId: number, email: string): Promise<void> {
  if (email.length > 200) throw new StoreError(400, "Email trop long.");
  await db.update(identities).set({ recovery_email: email.trim() }).where(eq(identities.id, identityId));
}

/**
 * Récupération de compte en cas de perte de clé : si l'email correspond à
 * celui enregistré pour ce handle, on régénère la clé d'accès et on la renvoie.
 */
export async function recoverByEmail(
  handleRaw: string,
  email: string
): Promise<{ handle: string; accessKey: string }> {
  const id = await getIdentityByHandle(normalizeHandle(handleRaw));
  const given = email.trim().toLowerCase();
  if (id?.recovery_email.toLowerCase() !== given || !given)
    throw new StoreError(400, "Handle et email ne correspondent à aucun compte récupérable.");
  return { handle: id.handle, accessKey: await rotateAccessKey(id.id) };
}

export async function setPhotoFile(identityId: number, file: string | null): Promise<void> {
  await db.update(identities).set({ photo_file: file }).where(eq(identities.id, identityId));
}

