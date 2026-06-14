// Domaine « relations » — extrait de src/store.ts (barrel). Voir docs si besoin.
import { and, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db.js";
import {
  cardFields,
  identities,
  relations as relationsTable,
} from "../schema.js";
import { StoreError, getIdentityByHandle } from "./identities.js";

/* -------------------------------- Relations ------------------------------ */

export type RelationType = "amis" | "pro" | "autre";
export const REL_TYPES: RelationType[] = ["amis", "pro", "autre"];

export interface RelationSummary {
  handle: string;
  display_name: string;
  has_photo: boolean;
  has_pubkey?: boolean;
  type?: RelationType;
  via?: string;
  created_at?: string;
  mutual?: boolean;
}

export async function getIncomingRelations(identityId: number): Promise<RelationSummary[]> {
  const res = await db.execute(sql`
    SELECT i.handle, i.photo_file, r.type, r.created_at,
           COALESCE(dn.value, '') AS display_name
      FROM relations r
      JOIN identities i ON i.id = r.identity_id
      LEFT JOIN card_fields dn ON dn.identity_id = i.id AND dn.key = 'display_name'
     WHERE r.related_id = ${identityId}
       AND NOT EXISTS (SELECT 1 FROM relations r2 WHERE r2.identity_id = ${identityId} AND r2.related_id = r.identity_id)
     ORDER BY r.created_at DESC
  `);
  return (res.rows as {
    handle: string;
    photo_file: string | null;
    type: RelationType;
    created_at: string;
    display_name: string;
  }[]).map((r) => ({
    handle: r.handle,
    display_name: r.display_name,
    has_photo: !!r.photo_file,
    type: r.type,
    created_at: r.created_at,
  }));
}

/** IDs des contacts MUTUELS de l'identité (relation réciproque dans les deux sens).
 *  Sert au fan-out de la notif d'anniversaire (on ne prévient que les vrais contacts). */
export async function getMutualContactIds(identityId: number): Promise<number[]> {
  const res = await db.execute(sql`
    SELECT r.related_id AS id
      FROM relations r
     WHERE r.identity_id = ${identityId}
       AND EXISTS (
         SELECT 1 FROM relations r2
          WHERE r2.identity_id = r.related_id AND r2.related_id = ${identityId}
       )
  `);
  return (res.rows as { id: number }[]).map((r) => r.id);
}

export async function summariesByIds(ids: number[]): Promise<Map<number, RelationSummary>> {
  const map = new Map<number, RelationSummary>();
  if (!ids.length) return map;
  const dn = alias(cardFields, "dn");
  const rows = (await db
    .select({
      id: identities.id,
      handle: identities.handle,
      photo_file: identities.photo_file,
      pubkey: identities.pubkey,
      display_name: sql<string>`COALESCE(${dn.value}, '')`,
    })
    .from(identities)
    .leftJoin(dn, and(eq(dn.identity_id, identities.id), eq(dn.key, "display_name")))
    .where(inArray(identities.id, ids))) as {
    id: number;
    handle: string;
    photo_file: string | null;
    pubkey: string | null;
    display_name: string;
  }[];
  for (const r of rows)
    map.set(r.id, { handle: r.handle, display_name: r.display_name, has_photo: !!r.photo_file, has_pubkey: !!r.pubkey });
  return map;
}

export async function addRelation(
  identityId: number,
  relatedHandle: string,
  type = "amis"
): Promise<RelationSummary> {
  const other = await getIdentityByHandle(relatedHandle.replace(/^@/, ""));
  if (!other) throw new StoreError(404, "Aucune identité avec ce handle.");
  if (other.id === identityId) throw new StoreError(400, "Impossible de se relier à soi-même.");
  const t = (REL_TYPES as string[]).includes(type) ? (type as RelationType) : "amis";
  await db
    .insert(relationsTable)
    .values({ identity_id: identityId, related_id: other.id, type: t, created_at: new Date().toISOString() })
    .onConflictDoUpdate({
      target: [relationsTable.identity_id, relationsTable.related_id],
      set: { type: t },
    });
  return { handle: other.handle, display_name: "", has_photo: !!other.photo_file, type: t };
}

