// Domaine « vault » — extrait de src/store.ts (barrel). Voir docs si besoin.
import { eq, sql } from "drizzle-orm";
import { db } from "../db.js";
import {
  e2eVaults,
} from "../schema.js";

/* ---- Coffre de clé E2E (escrow chiffré, opaque au serveur) ---- */

export async function getE2eVault(identityId: number): Promise<{
  vault: string | null;
  pin_locked_until: string | null;
  pin_fail_count: number;
}> {
  const rows = await db
    .select({ vault: e2eVaults.vault, pin_locked_until: e2eVaults.pin_locked_until, pin_fail_count: e2eVaults.pin_fail_count })
    .from(e2eVaults)
    .where(eq(e2eVaults.identity_id, identityId))
    .limit(1);
  const row = rows.at(0);
  const vaultStr = row?.vault ?? "";
  return {
    vault: vaultStr === "" ? null : vaultStr,
    pin_locked_until: row?.pin_locked_until ?? null,
    pin_fail_count: row?.pin_fail_count ?? 0,
  };
}

export async function setE2eVault(identityId: number, vault: string): Promise<void> {
  await db
    .insert(e2eVaults)
    .values({ identity_id: identityId, vault, updated_at: new Date().toISOString() })
    .onConflictDoUpdate({
      target: e2eVaults.identity_id,
      set: { vault, updated_at: new Date().toISOString() },
    });
}

export async function deleteE2eVault(identityId: number): Promise<void> {
  await db.delete(e2eVaults).where(eq(e2eVaults.identity_id, identityId));
}

export async function getRatchetCache(identityId: number): Promise<string | null> {
  const rows = await db
    .select({ ratchet_cache: e2eVaults.ratchet_cache })
    .from(e2eVaults)
    .where(eq(e2eVaults.identity_id, identityId))
    .limit(1);
  return rows.at(0)?.ratchet_cache ?? null;
}

export async function setRatchetCache(identityId: number, cache: string): Promise<void> {
  await db
    .update(e2eVaults)
    .set({ ratchet_cache: cache, updated_at: new Date().toISOString() })
    .where(eq(e2eVaults.identity_id, identityId));
}

// Returns the ISO datetime the PIN is locked until (or null if not locked).
export async function recordPinFail(identityId: number): Promise<string | null> {
  const now = new Date();
  // Upsert to ensure row exists, then increment.
  await db
    .insert(e2eVaults)
    .values({ identity_id: identityId, vault: "", updated_at: now.toISOString(), pin_fail_count: 1 })
    .onConflictDoUpdate({
      target: e2eVaults.identity_id,
      set: { pin_fail_count: sql`${e2eVaults.pin_fail_count} + 1` },
    });
  const rows = await db
    .select({ pin_fail_count: e2eVaults.pin_fail_count })
    .from(e2eVaults)
    .where(eq(e2eVaults.identity_id, identityId))
    .limit(1);
  const count = rows.at(0)?.pin_fail_count ?? 1;
  if (count < 5) return null;
  // Exponential lockout: 2^(count-5) minutes, capped at 60 min.
  const lockMinutes = Math.min(Math.pow(2, count - 5), 60);
  const lockedUntil = new Date(now.getTime() + lockMinutes * 60 * 1000).toISOString();
  await db
    .update(e2eVaults)
    .set({ pin_locked_until: lockedUntil })
    .where(eq(e2eVaults.identity_id, identityId));
  return lockedUntil;
}

export async function resetPinFail(identityId: number): Promise<void> {
  await db
    .update(e2eVaults)
    .set({ pin_fail_count: 0, pin_locked_until: null })
    .where(eq(e2eVaults.identity_id, identityId));
}

