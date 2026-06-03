// Domaine « dayOverrides » — extrait de src/store.ts (barrel). Voir docs si besoin.
import { and, eq } from "drizzle-orm";
import { db } from "../db.js";
import {
  dayOverrides,
} from "../schema.js";
import { Availability, DEFAULT_AVAILABILITY, availabilityStatus, getAvailability } from "./shared.js";
import { StoreError } from "./identities.js";

/* --------------------- Disponibilité par jour (calendrier) --------------- */

export type DayStatus = "free" | "busy";
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Règle par défaut, sans réglage perso : libre en semaine, occupé le week-end. */
export function defaultDayStatus(day: string, avail: Availability = DEFAULT_AVAILABILITY): DayStatus {
  return availabilityStatus(avail, day);
}

export async function getOverrides(identityId: number): Promise<Record<string, DayStatus>> {
  const rows = (await db
    .select({ day: dayOverrides.day, status: dayOverrides.status })
    .from(dayOverrides)
    .where(eq(dayOverrides.identity_id, identityId))) as { day: string; status: DayStatus }[];
  return Object.fromEntries(rows.map((r) => [r.day, r.status]));
}

export async function effectiveDayStatus(identityId: number, day: string): Promise<DayStatus> {
  const rows = (await db
    .select({ status: dayOverrides.status })
    .from(dayOverrides)
    .where(and(eq(dayOverrides.identity_id, identityId), eq(dayOverrides.day, day)))
    .limit(1)) as { status: DayStatus }[];
  return rows[0]?.status ?? defaultDayStatus(day, await getAvailability(identityId));
}

/**
 * Prochains jours « libres » d'une identité, en partant d'aujourd'hui (UTC) ou
 * de `fromDay`. Combine la règle par défaut (libre en semaine) et les overrides.
 * Renvoie au plus `count` dates `YYYY-MM-DD`, en balayant au maximum un an.
 */
export async function nextFreeDays(identityId: number, count = 5, fromDay?: string): Promise<string[]> {
  const overrides = await getOverrides(identityId);
  const avail = await getAvailability(identityId);
  const start = fromDay && DAY_RE.test(fromDay) ? new Date(fromDay + "T00:00:00Z") : new Date();
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const out: string[] = [];
  for (let i = 0; i < 366 && out.length < count; i++) {
    const day = d.toISOString().slice(0, 10);
    if ((overrides[day] ?? defaultDayStatus(day, avail)) === "free") out.push(day);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export async function setDayStatus(identityId: number, day: string, status: string): Promise<void> {
  if (!DAY_RE.test(day)) throw new StoreError(400, "Date invalide (attendu YYYY-MM-DD).");
  if (status !== "free" && status !== "busy") throw new StoreError(400, "Statut invalide.");
  // À partir d'ici, `status` est narrow vers DayStatus ("free" | "busy").
  // On compare au défaut PERSONNEL (règle générale) : pas d'override redondant.
  if (status === defaultDayStatus(day, await getAvailability(identityId))) {
    await db
      .delete(dayOverrides)
      .where(and(eq(dayOverrides.identity_id, identityId), eq(dayOverrides.day, day)));
  } else {
    await db
      .insert(dayOverrides)
      .values({ identity_id: identityId, day, status })
      .onConflictDoUpdate({ target: [dayOverrides.identity_id, dayOverrides.day], set: { status } });
  }
}

