// Domaine « loginPins » — extrait de src/store.ts (barrel). Voir docs si besoin.
import { createHash, randomInt } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { db } from "../db.js";
import {
  loginPins as loginPinsTable,
} from "../schema.js";
import { StoreError, getIdentityById } from "./identities.js";

/* ---- Codes PIN d'appairage (connexion d'un nouvel appareil) ---- */

export const PIN_TTL_MIN = 30; // fenêtre d'appairage d'un téléphone (generate web → saisie mobile)
export const PIN_DIGITS = 6;

export const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Crée un code PIN à usage unique pour appairer un nouvel appareil. Un seul PIN
 * actif par identité : on efface les précédents. Renvoie le PIN en clair (jamais
 * stocké) et son expiration. Le serveur ne garde que le sha256.
 */
export async function createLoginPin(identityId: number): Promise<{ pin: string; expiresAt: string }> {
  await db.delete(loginPinsTable).where(eq(loginPinsTable.identity_id, identityId));
  const expiresAt = new Date(Date.now() + PIN_TTL_MIN * 60 * 1000).toISOString();
  const max = 10 ** PIN_DIGITS;
  // Boucle de garde contre une collision de hash (PK) — improbable, mais sûre.
  for (let i = 0; i < 5; i++) {
    const pin = String(randomInt(0, max)).padStart(PIN_DIGITS, "0");
    try {
      await db.insert(loginPinsTable).values({ pin_hash: sha256hex(pin), identity_id: identityId, expires_at: expiresAt });
      return { pin, expiresAt };
    } catch {
      /* collision : on régénère */
    }
  }
  throw new StoreError(500, "Impossible de générer un code PIN, réessayez.");
}

/**
 * Échange un code PIN valide contre la clé d'accès de l'identité. À usage unique :
 * le PIN est consommé (supprimé) au succès. Renvoie clé + handle.
 */
export async function redeemLoginPin(pin: string): Promise<{ accessKey: string; handle: string }> {
  await pruneExpiredLoginPins();
  const clean = pin.trim();
  if (!/^\d{6}$/.test(clean)) throw new StoreError(400, "Code PIN invalide.");
  const hash = sha256hex(clean);
  const rows = await db
    .select({ identity_id: loginPinsTable.identity_id, expires_at: loginPinsTable.expires_at })
    .from(loginPinsTable)
    .where(eq(loginPinsTable.pin_hash, hash))
    .limit(1);
  const row = rows.at(0);
  if (!row || row.expires_at < new Date().toISOString()) throw new StoreError(404, "Code PIN invalide ou expiré.");
  const ident = await getIdentityById(row.identity_id);
  if (!ident) throw new StoreError(404, "Code PIN invalide ou expiré.");
  await db.delete(loginPinsTable).where(eq(loginPinsTable.pin_hash, hash));
  return { accessKey: ident.access_key, handle: ident.handle };
}

export async function pruneExpiredLoginPins(): Promise<void> {
  await db.delete(loginPinsTable).where(lt(loginPinsTable.expires_at, new Date().toISOString()));
}

