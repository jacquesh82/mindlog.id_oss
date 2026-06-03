// Domaine « shared » — extrait de src/store.ts (barrel). Voir docs si besoin.
import { eq } from "drizzle-orm";
import { db } from "../db.js";
import {
  identities,
} from "../schema.js";
import { getIdentityById } from "./identities.js";
import { DayStatus } from "./dayOverrides.js";

export interface Identity {
  id: number;
  handle: string;
  access_key: string;
  photo_file: string | null;
  recovery_email: string;
  pubkey: string;
  settings: string; // JSON (préférences) — voir Settings / parseSettings
  created_at: string;
}

/** Règle de disponibilité générale (par défaut), éditée dans l'onglet « Options ».
 *  Les exceptions ponctuelles restent dans day_overrides (clic sur un jour). */
export interface Availability {
  // Jours de la semaine libres par défaut. Index 0 = lundi … 6 = dimanche.
  weekdays: boolean[];
  // Périodes datées qui imposent un statut (vacances « off », dispo exceptionnelle « on »).
  periods: { from: string; to: string; free: boolean }[];
  // Plage horaire de travail d'une journée libre (créneaux de RDV proposés dedans).
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  // Finesse des créneaux proposés, en minutes : 15, 30 ou 60.
  slot_minutes: 15 | 30 | 60;
}

export const SLOT_MINUTES = [15, 30, 60] as const;

export const DEFAULT_AVAILABILITY: Availability = {
  weekdays: [true, true, true, true, true, false, false], // L-V libre, week-end occupé
  periods: [],
  start: "09:00",
  end: "18:00",
  slot_minutes: 30,
};

export const TIME_FMT = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Liste les créneaux "HH:MM" d'une journée selon la plage + finesse. */
export function slotsFor(avail: Availability): string[] {
  const [sh, sm] = avail.start.split(":").map(Number);
  const [eh, em] = avail.end.split(":").map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const step = avail.slot_minutes;
  const out: string[] = [];
  for (let t = startMin; t + step <= endMin; t += step) {
    out.push(`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`);
  }
  return out;
}

/** Préférences du compte, éditées via l'onglet « Options » de la carte. */
export interface Settings {
  allow_chat: boolean; // autoriser la messagerie chiffrée entrante
  allow_call: boolean; // autoriser les appels audio/vidéo entrants
  allow_video: boolean; // proposer la vidéo (sinon appels audio seulement)
  allow_requests: boolean; // autoriser les demandes de RDV
  public_availability: boolean; // exposer ses disponibilités aux visiteurs
  availability: Availability; // règle de dispo par défaut (jours/week-end/périodes)
}

export const SETTINGS_BOOLS = [
  "allow_chat",
  "allow_call",
  "allow_video",
  "allow_requests",
  "public_availability",
] as const;

export const DEFAULT_SETTINGS: Settings = {
  allow_chat: true,
  allow_call: true,
  allow_video: true,
  allow_requests: true,
  public_availability: true,
  availability: DEFAULT_AVAILABILITY,
};

export const DAY_FMT = /^\d{4}-\d{2}-\d{2}$/;

/** Valide/normalise une règle de dispo reçue du client (tolère les champs absents). */
export function sanitizeAvailability(a: unknown): Availability {
  const obj: Record<string, unknown> = a && typeof a === "object" ? (a as Record<string, unknown>) : {};
  const rawWd: unknown[] = Array.isArray(obj.weekdays) ? obj.weekdays : [];
  const weekdays = DEFAULT_AVAILABILITY.weekdays.map((def, i) =>
    typeof rawWd[i] === "boolean" ? rawWd[i] : def
  );
  const rawPeriods: unknown[] = Array.isArray(obj.periods) ? obj.periods : [];
  const periods = rawPeriods
    .filter((p): p is { from: string; to: string; free: unknown } => {
      if (!p || typeof p !== "object") return false;
      const o = p as Record<string, unknown>;
      return typeof o.from === "string" && DAY_FMT.test(o.from) && typeof o.to === "string" && DAY_FMT.test(o.to);
    })
    .map((p) => ({
      from: p.from <= p.to ? p.from : p.to,
      to: p.from <= p.to ? p.to : p.from,
      free: p.free === true,
    }))
    .slice(0, 50); // borne raisonnable
  const start = typeof obj.start === "string" && TIME_FMT.test(obj.start) ? obj.start : DEFAULT_AVAILABILITY.start;
  let end = typeof obj.end === "string" && TIME_FMT.test(obj.end) ? obj.end : DEFAULT_AVAILABILITY.end;
  if (end <= start) end = DEFAULT_AVAILABILITY.end > start ? DEFAULT_AVAILABILITY.end : "23:59";
  const slot = typeof obj.slot_minutes === "number" ? obj.slot_minutes : 0;
  const slot_minutes = (SLOT_MINUTES as readonly number[]).includes(slot)
    ? (slot as 15 | 30 | 60)
    : DEFAULT_AVAILABILITY.slot_minutes;
  return { weekdays, periods, start, end, slot_minutes };
}

/** Lit les préférences d'une identité (tolère un JSON absent/corrompu). */
export function parseSettings(raw: string | null | undefined): Settings {
  if (!raw) return { ...DEFAULT_SETTINGS, availability: { ...DEFAULT_AVAILABILITY } };
  try {
    const obj = JSON.parse(raw) as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...obj,
      availability: sanitizeAvailability(obj.availability),
    };
  } catch {
    return { ...DEFAULT_SETTINGS, availability: { ...DEFAULT_AVAILABILITY } };
  }
}

/** N'écrit que les clés connues (ignore tout champ inconnu reçu du client). */
export async function setSettings(identityId: number, patch: Partial<Settings>): Promise<Settings> {
  const cur = parseSettings((await getIdentityById(identityId))?.settings);
  const next: Settings = { ...cur };
  for (const k of SETTINGS_BOOLS) {
    const v = patch[k];
    if (typeof v === "boolean") next[k] = v;
  }
  if (patch.availability !== undefined) next.availability = sanitizeAvailability(patch.availability);
  await db.update(identities).set({ settings: JSON.stringify(next) }).where(eq(identities.id, identityId));
  return next;
}

/** Statut par défaut d'un jour selon une règle de dispo (périodes > jour de semaine). */
export function availabilityStatus(avail: Availability, day: string): DayStatus {
  for (const p of avail.periods) {
    if (day >= p.from && day <= p.to) return p.free ? "free" : "busy";
  }
  const wd = new Date(day + "T00:00:00Z").getUTCDay(); // 0 = dimanche … 6 = samedi
  const idx = (wd + 6) % 7; // 0 = lundi … 6 = dimanche
  return avail.weekdays[idx] ? "free" : "busy";
}

/** Charge la règle de dispo d'une identité (ou la règle par défaut). */
export async function getAvailability(identityId: number): Promise<Availability> {
  return parseSettings((await getIdentityById(identityId))?.settings).availability;
}

export async function setPubkey(identityId: number, pubkey: string): Promise<void> {
  await db.update(identities).set({ pubkey }).where(eq(identities.id, identityId));
}

