// Domaine « tags » — extrait de src/store.ts (barrel). Voir docs si besoin.
import { and, eq } from "drizzle-orm";
import { db } from "../db.js";
import {
  tags as tagsTable,
} from "../schema.js";
import { StoreError } from "./identities.js";

/* ---------------------------------- Tags --------------------------------- */

export const MAX_TAGS = 20;
export const TAG_MAX_LEN = 30;

/** Normalise un tag : retire le # initial, compacte les espaces, borne la longueur. */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#+/, "").replace(/\s+/g, " ").trim().slice(0, TAG_MAX_LEN);
}

export async function getTags(identityId: number): Promise<string[]> {
  const rows = await db
    .select({ tag: tagsTable.tag, position: tagsTable.position })
    .from(tagsTable)
    .where(eq(tagsTable.identity_id, identityId))
    .orderBy(tagsTable.position, tagsTable.tag);
  return rows.map((r) => r.tag);
}

/** Ajoute un tag (idempotent). Renvoie la liste à jour. */
export async function addTag(identityId: number, raw: string): Promise<string[]> {
  const tag = normalizeTag(raw);
  if (!tag) throw new StoreError(400, "Tag vide.");
  const existing = await getTags(identityId);
  if (existing.includes(tag)) return existing;
  if (existing.length >= MAX_TAGS) throw new StoreError(400, `Maximum ${MAX_TAGS} tags.`);
  await db
    .insert(tagsTable)
    .values({ identity_id: identityId, tag, position: existing.length })
    .onConflictDoNothing();
  return getTags(identityId);
}

export async function removeTag(identityId: number, raw: string): Promise<boolean> {
  const tag = normalizeTag(raw);
  const r = await db
    .delete(tagsTable)
    .where(and(eq(tagsTable.identity_id, identityId), eq(tagsTable.tag, tag)))
    .returning({ tag: tagsTable.tag });
  return r.length > 0;
}

