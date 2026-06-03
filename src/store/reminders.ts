// Domaine « reminders » — extrait de src/store.ts (barrel). Voir docs si besoin.
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "../db.js";
import {
  requests,
} from "../schema.js";
import { TIME_FMT } from "./shared.js";
import { StoreError } from "./identities.js";
import { DAY_RE } from "./dayOverrides.js";
import { BookingRequest } from "./requests.js";

/* ----------------------------- Rappels de RDV ---------------------------- */

/** Jalons de rappel (jours avant le RDV), du plus lointain au plus proche. */
export const REMINDER_MILESTONES: { code: string; days: number }[] = [
  { code: "1m", days: 30 },
  { code: "1w", days: 7 },
  { code: "3d", days: 3 },
  { code: "1d", days: 1 },
];

/** Nombre de jours calendaires entre aujourd'hui (UTC) et un jour 'YYYY-MM-DD'. */
export function daysUntil(day: string, now = new Date()): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const [y, m, d] = day.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - today) / 86_400_000);
}

/** Jalon à déclencher maintenant pour une demande, ou null si aucun. */
export function dueMilestone(req: BookingRequest, now = new Date()): string | null {
  if (!req.day) return null;
  const left = daysUntil(req.day, now);
  if (left < 0) return null;
  const sent = req.reminders_sent.split(",").filter(Boolean);
  for (let i = 0; i < REMINDER_MILESTONES.length; i++) {
    const { code, days } = REMINDER_MILESTONES[i];
    const lower = REMINDER_MILESTONES[i + 1]?.days ?? -1; // fenêtre (lower, days]
    if (left <= days && left > lower && !sent.includes(code)) return code;
  }
  return null;
}

export interface DueReminder {
  request: BookingRequest;
  milestone: string;
}

/** Demandes en attente dont un jalon de rappel est dû (à notifier au destinataire). */
export async function dueReminders(now = new Date()): Promise<DueReminder[]> {
  const rows = (await db
    .select()
    .from(requests)
    .where(and(eq(requests.status, "pending"), isNotNull(requests.day)))) as BookingRequest[];
  const out: DueReminder[] = [];
  for (const r of rows) {
    const milestone = dueMilestone(r, now);
    if (milestone) out.push({ request: r, milestone });
  }
  return out;
}

/** Marque un jalon de rappel comme envoyé (idempotent). */
export async function markReminderSent(id: number, milestone: string): Promise<void> {
  const rows = (await db
    .select({ reminders_sent: requests.reminders_sent })
    .from(requests)
    .where(eq(requests.id, id))
    .limit(1)) as { reminders_sent: string }[];
  if (!rows[0]) return;
  const sent = rows[0].reminders_sent.split(",").filter(Boolean);
  if (sent.includes(milestone)) return;
  sent.push(milestone);
  await db.update(requests).set({ reminders_sent: sent.join(",") }).where(eq(requests.id, id));
}

export async function pendingRequestCount(identityId: number): Promise<number> {
  const res = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM requests WHERE identity_id = ${identityId} AND status = 'pending'`
  );
  return (res.rows[0] as { n: number }).n;
}

export async function addRequest(
  identityId: number,
  input: { day?: string | null; time?: string | null; name: string; email?: string; message?: string }
): Promise<BookingRequest> {
  if (input.name.length > 100 || (input.email?.length ?? 0) > 200 || (input.message?.length ?? 0) > 4000)
    throw new StoreError(400, "Demande : champ trop long.");
  const day = input.day && DAY_RE.test(input.day) ? input.day : null;
  // L'heure n'a de sens qu'avec un jour ; on valide le format HH:MM.
  const time = day && input.time && TIME_FMT.test(input.time) ? input.time : null;
  const ins = await db
    .insert(requests)
    .values({
      identity_id: identityId,
      day,
      time,
      name: input.name.trim(),
      email: input.email ?? "",
      message: input.message ?? "",
    })
    .returning();
  return ins[0] as BookingRequest;
}

/** Créneaux déjà réservés (RDV acceptés) un jour donné, pour les griser. */
export async function bookedSlots(identityId: number, day: string): Promise<string[]> {
  const rows = (await db
    .select({ time: requests.time })
    .from(requests)
    .where(and(eq(requests.identity_id, identityId), eq(requests.day, day), eq(requests.status, "accepted")))) as {
    time: string | null;
  }[];
  return rows.map((r) => r.time).filter((t): t is string => !!t);
}

