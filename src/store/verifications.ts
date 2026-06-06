// Domaine « verifications » — extrait de src/store.ts (barrel). Voir docs si besoin.
import { and, eq } from "drizzle-orm";
import { db } from "../db.js";
import {
  e2eVerifications,
} from "../schema.js";

/* ---- Vérifications d'identité (anti-MITM, synchronisées) ---- */

/** Enregistre que `identityId` a vérifié `peerId` (hash du numéro de sécurité). */
export async function setVerification(identityId: number, peerId: number, safetyHash: string): Promise<void> {
  await db
    .insert(e2eVerifications)
    .values({ identity_id: identityId, peer_id: peerId, safety_hash: safetyHash, verified_at: new Date().toISOString() })
    .onConflictDoUpdate({
      target: [e2eVerifications.identity_id, e2eVerifications.peer_id],
      set: { safety_hash: safetyHash, verified_at: new Date().toISOString() },
    });
}

export async function getVerification(
  identityId: number,
  peerId: number
): Promise<{ safetyHash: string; verifiedAt: string } | null> {
  const rows = await db
    .select({ h: e2eVerifications.safety_hash, at: e2eVerifications.verified_at })
    .from(e2eVerifications)
    .where(and(eq(e2eVerifications.identity_id, identityId), eq(e2eVerifications.peer_id, peerId)))
    .limit(1);
  const r = rows.at(0);
  return r ? { safetyHash: r.h, verifiedAt: r.at } : null;
}

export async function deleteVerification(identityId: number, peerId: number): Promise<void> {
  await db
    .delete(e2eVerifications)
    .where(and(eq(e2eVerifications.identity_id, identityId), eq(e2eVerifications.peer_id, peerId)));
}

export type Visibility = "public" | "private" | "contact";

export interface CardField {
  key: string;
  label: string;
  value: string;
  is_custom: number;
  is_public: number;
  visibility: Visibility;
  position: number;
}

export interface CardEvent {
  id: number;
  identity_id: number;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string;
  link: string;
  notes: string;
  is_public: number;
  kind: "event" | "live";
}

