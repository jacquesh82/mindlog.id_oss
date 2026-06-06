/**
 * reset-db — vide la base (données uniquement, schéma conservé).
 *
 * Découvre dynamiquement toutes les tables du schéma `public` (hors table de
 * migrations Drizzle) puis fait un TRUNCATE … RESTART IDENTITY CASCADE global.
 * Pas de liste codée en dur : aucune nouvelle table à ajouter ici quand le
 * schéma évolue.
 *
 * Usage :
 *   npm run db:reset                                  # PGlite locale (data/dev-pglite)
 *   DATABASE_URL=postgres://… npm run db:reset        # Postgres distante
 *   DATABASE_DRIVER=pglite PGLITE_PATH=./data/dev-pglite npm run db:reset
 */
import "../src/env.js";
import { sql } from "drizzle-orm";
import { db, initDb, closeDb } from "../src/db.js";
import { ensureMilo } from "../src/store.js";

await initDb();

const result = await db.execute<{ tablename: string }>(sql`
  SELECT tablename FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename NOT LIKE '\\_\\_drizzle%' ESCAPE '\\'
`);
const rows = (result as unknown as { rows?: { tablename: string }[] }).rows
  ?? (result as unknown as { tablename: string }[]);
const names = rows.map((r) => `"${r.tablename}"`);

if (names.length === 0) {
  console.log("✓ Aucune table à vider.");
} else {
  await db.execute(sql.raw(`TRUNCATE ${names.join(", ")} RESTART IDENTITY CASCADE`));
  console.log(`✓ ${names.length} tables vidées (schéma conservé).`);
}

// Réinitialise la base avec le compte mascotte @milo (easter egg public).
await ensureMilo();
console.log("✓ @milo réinitialisé.");
await closeDb();
