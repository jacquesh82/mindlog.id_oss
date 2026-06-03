// Domaine « invites » — extrait de src/store.ts (barrel). Voir docs si besoin.
import { and, eq, lt } from "drizzle-orm";
import { db, newAccessKey } from "../db.js";
import {
  cardFields,
  invites as invitesTable,
  relations as relationsTable,
} from "../schema.js";
import { StoreError, getIdentityById } from "./identities.js";
import { REL_TYPES } from "./relations.js";

/* ---- Invitations de contact (sans annuaire) ---- */

export const INVITE_TTL_DAYS = 7;

/** Crée une invitation à usage unique ; renvoie le jeton. */
export async function createInvite(fromId: number, type = "amis"): Promise<string> {
  const t = (REL_TYPES as string[]).includes(type) ? type : "amis";
  const token = newAccessKey();
  await db.insert(invitesTable).values({
    token,
    from_id: fromId,
    type: t,
    expires_at: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
  });
  return token;
}

/** Aperçu public d'une invitation valide (qui invite). Null si invalide/expirée/utilisée. */
export async function getInvitePreview(
  token: string
): Promise<{ handle: string; display_name: string; has_photo: boolean } | null> {
  const rows = await db
    .select({ from_id: invitesTable.from_id, used: invitesTable.used, expires_at: invitesTable.expires_at })
    .from(invitesTable)
    .where(eq(invitesTable.token, token))
    .limit(1);
  const inv = rows.at(0);
  if (!inv || inv.used === 1 || inv.expires_at < new Date().toISOString()) return null;
  const ident = await getIdentityById(inv.from_id);
  if (!ident) return null;
  const dn = await db
    .select({ value: cardFields.value })
    .from(cardFields)
    .where(and(eq(cardFields.identity_id, inv.from_id), eq(cardFields.key, "display_name")))
    .limit(1);
  return { handle: ident.handle, display_name: dn.at(0)?.value ?? "", has_photo: !!ident.photo_file };
}

/**
 * Accepte une invitation : crée la relation MUTUELLE (deux sens) entre l'inviteur
 * et `accepterId`, consomme le jeton. Renvoie le handle de l'inviteur.
 */
export async function acceptInvite(token: string, accepterId: number): Promise<string> {
  const rows = await db
    .select({ from_id: invitesTable.from_id, type: invitesTable.type, used: invitesTable.used, expires_at: invitesTable.expires_at })
    .from(invitesTable)
    .where(eq(invitesTable.token, token))
    .limit(1);
  const inv = rows.at(0);
  if (!inv || inv.used === 1 || inv.expires_at < new Date().toISOString())
    throw new StoreError(404, "Invitation invalide ou expirée.");
  if (inv.from_id === accepterId) throw new StoreError(400, "Vous ne pouvez pas accepter votre propre invitation.");
  const inviter = await getIdentityById(inv.from_id);
  if (!inviter) throw new StoreError(404, "Invitation invalide ou expirée.");
  const now = new Date().toISOString();
  const t = inv.type;
  // Relation mutuelle (les deux sens) → contacts immédiats (chat/E2E).
  await db
    .insert(relationsTable)
    .values([
      { identity_id: accepterId, related_id: inv.from_id, type: t, created_at: now },
      { identity_id: inv.from_id, related_id: accepterId, type: t, created_at: now },
    ])
    .onConflictDoUpdate({ target: [relationsTable.identity_id, relationsTable.related_id], set: { type: t } });
  await db.update(invitesTable).set({ used: 1 }).where(eq(invitesTable.token, token));
  return inviter.handle;
}

export async function pruneExpiredInvites(): Promise<void> {
  await db.delete(invitesTable).where(lt(invitesTable.expires_at, new Date().toISOString()));
}

