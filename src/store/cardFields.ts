// Domaine « cardFields » — extrait de src/store.ts (barrel). Voir docs si besoin.
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db.js";
import {
  cardFields,
} from "../schema.js";
import { CardField, Visibility } from "./verifications.js";
import { StoreError } from "./identities.js";

/* ------------------------------- Card fields ----------------------------- */

export type ViewerLevel = "owner" | "contact" | "public" | boolean;

export async function getFields(identityId: number, viewer: ViewerLevel): Promise<CardField[]> {
  const rows = (await db
    .select({
      key: cardFields.key,
      label: cardFields.label,
      value: cardFields.value,
      is_custom: cardFields.is_custom,
      is_public: cardFields.is_public,
      visibility: cardFields.visibility,
      position: cardFields.position,
    })
    .from(cardFields)
    .where(eq(cardFields.identity_id, identityId))
    .orderBy(cardFields.position, cardFields.key)) as CardField[];
  if (viewer === true || viewer === "owner") return rows;
  if (viewer === "contact") return rows.filter((f) => f.visibility !== "private");
  return rows.filter((f) => f.visibility === "public");
}

export const VIS: Visibility[] = ["public", "private", "contact"];

export function resolveVisibility(
  input: { visibility?: string; is_public?: boolean },
  fallback: Visibility
): Visibility {
  if (input.visibility && (VIS as string[]).includes(input.visibility))
    return input.visibility as Visibility;
  if (input.is_public !== undefined) return input.is_public ? "public" : "private";
  return fallback;
}

export async function upsertField(
  identityId: number,
  input: {
    key: string;
    label?: string;
    value?: string;
    is_custom?: boolean;
    is_public?: boolean;
    visibility?: string;
    position?: number;
  }
): Promise<CardField> {
  if (input.key.length > 100 || (input.label?.length ?? 0) > 200 || (input.value?.length ?? 0) > 4000)
    throw new StoreError(400, "Champ trop long.");
  const existingRows = (await db
    .select()
    .from(cardFields)
    .where(and(eq(cardFields.identity_id, identityId), eq(cardFields.key, input.key)))
    .limit(1)) as CardField[];
  const existing = existingRows.at(0);

  const visibility = resolveVisibility(input, existing?.visibility ?? "public");
  const isPublic = visibility === "public" ? 1 : 0;

  if (existing) {
    await db
      .update(cardFields)
      .set({
        label: input.label ?? existing.label,
        value: input.value ?? existing.value,
        is_public: isPublic,
        visibility,
        position: input.position ?? existing.position,
      })
      .where(and(eq(cardFields.identity_id, identityId), eq(cardFields.key, input.key)));
  } else {
    const maxRes = await db.execute(
      sql`SELECT MAX(position) AS m FROM card_fields WHERE identity_id = ${identityId}`
    );
    const maxPos = ((maxRes.rows[0] as { m: number | null }).m ?? -1);
    await db.insert(cardFields).values({
      identity_id: identityId,
      key: input.key,
      label: input.label ?? input.key,
      value: input.value ?? "",
      is_custom: input.is_custom === false ? 0 : 1,
      is_public: isPublic,
      visibility,
      position: input.position ?? maxPos + 1,
    });
  }

  const out = (await db
    .select()
    .from(cardFields)
    .where(and(eq(cardFields.identity_id, identityId), eq(cardFields.key, input.key)))
    .limit(1)) as CardField[];
  return out[0];
}

export async function deleteField(identityId: number, key: string): Promise<boolean> {
  const rows = await db
    .select({ is_custom: cardFields.is_custom })
    .from(cardFields)
    .where(and(eq(cardFields.identity_id, identityId), eq(cardFields.key, key)))
    .limit(1);
  if (!rows.length) return false;
  // Les champs de base ne sont pas supprimés (on vide juste leur valeur).
  if (rows[0].is_custom === 0) {
    await db
      .update(cardFields)
      .set({ value: "" })
      .where(and(eq(cardFields.identity_id, identityId), eq(cardFields.key, key)));
    return true;
  }
  await db.delete(cardFields).where(and(eq(cardFields.identity_id, identityId), eq(cardFields.key, key)));
  return true;
}

