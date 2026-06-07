// Domaine « reminders » — extrait de src/store.ts (barrel). Voir docs si besoin.
import { and, eq, gte, isNotNull, lte, or, sql } from "drizzle-orm";
import { db } from "../db.js";
import {
  events as eventsTable,
  requests,
} from "../schema.js";
import { TIME_FMT } from "./shared.js";
import { StoreError } from "./identities.js";
import { DAY_RE } from "./dayOverrides.js";
import { BookingRequest } from "./requests.js";

/* ----------------------------- Rappels de RDV ---------------------------- */

/** Jalons de rappel (jours avant le RDV), du plus lointain au plus proche. */
const REMINDER_MILESTONES: { code: string; days: number }[] = [
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

/** Créneaux déjà occupés un jour donné, à griser pour les demandes externes.
 *  Inclut deux sources :
 *   - RDV acceptés (table `requests` status=accepted) — ceux que le visiteur
 *     pourrait vouloir prendre à nouveau ;
 *   - événements perso de la table `events` qui chevauchent le jour — quand
 *     l'utilisateur a noté « Réunion équipe 14h-15h », un visiteur ne doit pas
 *     pouvoir lui proposer un RDV à 14:00 ce jour-là. Les slots dans l'intervalle
 *     [event.starts_at, event.ends_at) sont marqués pris ; si `ends_at` est nul,
 *     on suppose une durée d'1 heure (cohérent avec un RDV typique).
 *  Le `day` est interprété en UTC — même convention que `defaultDayStatus` et le
 *  plugin calendrier (isoDay).
 */
export async function bookedSlots(
  identityId: number,
  day: string,
  slotMinutes = 30,
): Promise<string[]> {
  // 1) RDV acceptés (créneau pris à l'heure exacte) — conserve la sémantique
  //    historique : un seul slot "HH:MM" grisé par RDV.
  const reqRows = (await db
    .select({ time: requests.time })
    .from(requests)
    .where(and(eq(requests.identity_id, identityId), eq(requests.day, day), eq(requests.status, "accepted")))) as {
    time: string | null;
  }[];
  const taken = new Set<string>();
  for (const r of reqRows) if (r.time) taken.add(r.time);

  // 2) Événements perso qui chevauchent le jour. On élargit la fenêtre de
  //    requête pour capturer un event qui a démarré la veille et déborde, ou
  //    qui démarre dans la journée. Le filtrage fin (overlap exact) se fait en
  //    JS sur les ISO strings — c'est trivial et évite une condition SQL avec
  //    COALESCE sur ends_at.
  const startOfDay = `${day}T00:00:00.000Z`;
  const endOfDay = `${day}T23:59:59.999Z`;
  const dayBefore = new Date(Date.parse(startOfDay) - 86_400_000).toISOString();
  const evRows = (await db
    .select({ starts_at: eventsTable.starts_at, ends_at: eventsTable.ends_at })
    .from(eventsTable)
    .where(
      and(
        eq(eventsTable.identity_id, identityId),
        // starts_at <= endOfDay (l'event commence avant la fin du jour ciblé)
        lte(eventsTable.starts_at, endOfDay),
        // ET (ends_at >= startOfDay) OU (event court : starts_at >= dayBefore)
        // → couvre les events sans fin (durée par défaut 1h) qui ont démarré
        //   peu avant minuit UTC.
        or(gte(eventsTable.ends_at, startOfDay), gte(eventsTable.starts_at, dayBefore)),
      ),
    )) as { starts_at: string; ends_at: string | null }[];

  for (const e of evRows) {
    const s = Date.parse(e.starts_at);
    const end = e.ends_at ? Date.parse(e.ends_at) : s + 60 * 60_000;
    if (!Number.isFinite(s) || !Number.isFinite(end)) continue;
    const dayStart = Date.parse(startOfDay);
    // Borne l'overlap au jour UTC. Tout slot dont [slotStart, slotEnd)
    // intersecte [eventStart, eventEnd) est considéré pris.
    const overlapStart = Math.max(s, dayStart);
    const overlapEnd = Math.min(end, dayStart + 86_400_000);
    if (overlapEnd <= overlapStart) continue;
    for (let mins = 0; mins < 24 * 60; mins += slotMinutes) {
      const slotStart = dayStart + mins * 60_000;
      const slotEnd = slotStart + slotMinutes * 60_000;
      if (slotStart < overlapEnd && slotEnd > overlapStart) {
        const hh = String(Math.floor(mins / 60)).padStart(2, "0");
        const mm = String(mins % 60).padStart(2, "0");
        taken.add(`${hh}:${mm}`);
      }
    }
  }
  return [...taken];
}

