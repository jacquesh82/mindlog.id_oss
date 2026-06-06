// Domaine « events » — extrait de src/store.ts (barrel). Voir docs si besoin.
import { and, eq } from "drizzle-orm";
import { db } from "../db.js";
import {
  events as eventsTable,
} from "../schema.js";
import { CardEvent } from "./verifications.js";
import { StoreError } from "./identities.js";

/* --------------------------------- Events -------------------------------- */

export async function getEvents(identityId: number, includePrivate: boolean): Promise<CardEvent[]> {
  const rows = (await db
    .select()
    .from(eventsTable)
    .where(eq(eventsTable.identity_id, identityId))
    .orderBy(eventsTable.starts_at)) as CardEvent[];
  return includePrivate ? rows : rows.filter((e) => e.is_public === 1);
}

export async function addEvent(
  identityId: number,
  input: {
    title: string;
    starts_at: string;
    ends_at?: string | null;
    location?: string;
    link?: string;
    notes?: string;
    is_public?: boolean;
    kind?: "event" | "live";
  }
): Promise<CardEvent> {
  if (
    input.title.length > 200 ||
    (input.location?.length ?? 0) > 200 ||
    (input.link?.length ?? 0) > 500 ||
    (input.notes?.length ?? 0) > 4000
  )
    throw new StoreError(400, "Événement : champ trop long.");
  const ins = await db
    .insert(eventsTable)
    .values({
      identity_id: identityId,
      title: input.title,
      starts_at: input.starts_at,
      ends_at: input.ends_at ?? null,
      location: input.location ?? "",
      link: input.link ?? "",
      notes: input.notes ?? "",
      is_public: input.is_public === false ? 0 : 1,
      kind: input.kind === "live" ? "live" : "event",
    })
    .returning();
  return ins[0] as CardEvent;
}

export async function updateEvent(
  identityId: number,
  id: number,
  input: {
    title?: string;
    starts_at?: string;
    ends_at?: string | null;
    location?: string;
    link?: string;
    notes?: string;
    is_public?: boolean;
    kind?: "event" | "live";
  }
): Promise<CardEvent | null> {
  if (
    (input.title?.length ?? 0) > 200 ||
    (input.location?.length ?? 0) > 200 ||
    (input.link?.length ?? 0) > 500 ||
    (input.notes?.length ?? 0) > 4000
  )
    throw new StoreError(400, "Événement : champ trop long.");
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.starts_at !== undefined) patch.starts_at = input.starts_at;
  if (input.ends_at !== undefined) patch.ends_at = input.ends_at;
  if (input.location !== undefined) patch.location = input.location;
  if (input.link !== undefined) patch.link = input.link;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.is_public !== undefined) patch.is_public = input.is_public ? 1 : 0;
  if (input.kind !== undefined) patch.kind = input.kind === "live" ? "live" : "event";
  if (Object.keys(patch).length === 0) return getEvents(identityId, true).then((rows) => rows.find((e) => e.id === id) ?? null);
  const r = await db
    .update(eventsTable)
    .set(patch)
    .where(and(eq(eventsTable.id, id), eq(eventsTable.identity_id, identityId)))
    .returning();
  return (r[0] as CardEvent | undefined) ?? null;
}

export async function deleteEvent(identityId: number, id: number): Promise<boolean> {
  const r = await db
    .delete(eventsTable)
    .where(and(eq(eventsTable.id, id), eq(eventsTable.identity_id, identityId)))
    .returning({ id: eventsTable.id });
  return r.length > 0;
}

