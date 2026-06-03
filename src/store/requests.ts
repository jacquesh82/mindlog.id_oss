// Domaine « requests » — extrait de src/store.ts (barrel). Voir docs si besoin.
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db.js";
import {
  requests,
} from "../schema.js";

/* ------------------------------ Demandes RDV ----------------------------- */

export interface BookingRequest {
  id: number;
  identity_id: number;
  day: string | null;
  time: string | null;
  name: string;
  email: string;
  message: string;
  status: "pending" | "accepted" | "declined";
  reminders_sent: string;
  created_at: string;
}

export async function getRequests(
  identityId: number,
  status?: "pending" | "accepted" | "declined"
): Promise<BookingRequest[]> {
  const where = status
    ? and(eq(requests.identity_id, identityId), eq(requests.status, status))
    : eq(requests.identity_id, identityId);
  // En attente d'abord, puis les plus récentes — voir aussi le filtre côté UI.
  return (await db
    .select()
    .from(requests)
    .where(where)
    .orderBy(sql`(${requests.status} = 'pending') DESC`, desc(requests.created_at))) as BookingRequest[];
}

