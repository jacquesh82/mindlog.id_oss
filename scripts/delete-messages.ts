/**
 * delete-messages — supprime TOUS les messages (et données liées), sans toucher
 * aux comptes, relations, agendas ni à l'état cryptographique des sessions.
 *
 * Vide : messages, attachments (pièces jointes chiffrées), reactions.
 * Conserve : identities, relations, ratchet_cache (sessions E2E), prekeys, etc.
 *
 * Usage : DATABASE_URL=postgres://… npx tsx scripts/delete-messages.ts
 *         (ou `npm run db:clear-messages`)
 */
import "../src/env.js";
import { sql } from "drizzle-orm";
import { db, initDb, closeDb } from "../src/db.js";

await initDb();
// reactions a une FK ON DELETE CASCADE vers messages ; attachments est indépendant
// (clé par `pair`), on le vide donc explicitement. RESTART IDENTITY remet les
// séquences à zéro.
await db.execute(sql`
  TRUNCATE messages, attachments, reactions
  RESTART IDENTITY CASCADE
`);
console.log("✓ Tous les messages supprimés (pièces jointes et réactions incluses).");
await closeDb();
