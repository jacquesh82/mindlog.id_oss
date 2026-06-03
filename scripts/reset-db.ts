/**
 * reset-db — vide la base (données uniquement, schéma conservé).
 *
 * Usage : DATABASE_URL=postgres://… npx tsx scripts/reset-db.ts
 *         (ou `npm run db:reset`)
 */
import "../src/env.js";
import { sql } from "drizzle-orm";
import { db, initDb, closeDb } from "../src/db.js";
import { ensureMilo } from "../src/store.js";

await initDb();
await db.execute(sql`
  TRUNCATE gallery_likes, gallery, reactions, messages, notifications, requests,
           day_overrides, events, card_fields, relations, passkey_credentials,
           sessions, identities
  RESTART IDENTITY CASCADE
`);
// Réinitialise la base avec le compte mascotte @milo (easter egg public).
await ensureMilo();
console.log("✓ Base vidée et réinitialisée avec @milo (schéma conservé).");
await closeDb();
