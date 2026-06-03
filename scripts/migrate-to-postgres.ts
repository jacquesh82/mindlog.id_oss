/**
 * Migration des données SQLite → PostgreSQL.
 *
 * Lit l'ancienne base better-sqlite3 et copie toutes les lignes dans la base
 * Postgres cible (définie par DATABASE_URL), dans un ordre respectant les clés
 * étrangères, puis réaligne les séquences `serial`.
 *
 * Usage :
 *   DATABASE_URL=postgres://… npx tsx scripts/migrate-to-postgres.ts [chemin/sqlite.db]
 *
 * Idempotence : la cible doit être VIDE (sinon conflits de clés). Le script
 * applique d'abord les migrations Drizzle puis insère dans une transaction.
 */
import "../src/env.js";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { db, initDb, closeDb } from "../src/db.js";
import {
  cardFields,
  dayOverrides,
  events,
  galleryLikes,
  gallery,
  identities,
  messages,
  notifications,
  passkeyCredentials,
  reactions,
  relations,
  requests,
  sessions,
} from "../src/schema.js";

const SQLITE_PATH = process.argv[2] || resolve(process.cwd(), "data", "mindlog.db");

if (process.env.DATABASE_DRIVER === "pglite") {
  console.error("✗ DATABASE_DRIVER=pglite (base en mémoire) : définissez plutôt DATABASE_URL vers Postgres.");
  process.exit(1);
}
if (!existsSync(SQLITE_PATH)) {
  console.error(`✗ Base SQLite introuvable : ${SQLITE_PATH}`);
  process.exit(1);
}

const src = new Database(SQLITE_PATH, { readonly: true });
const all = (table: string) => src.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
const tableExists = (t: string) =>
  !!src.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);

// [table SQLite, table Drizzle, a une séquence serial ?]
const PLAN: [string, PgTable, boolean][] = [
  ["identities", identities, true],
  ["card_fields", cardFields, false],
  ["events", events, true],
  ["day_overrides", dayOverrides, false],
  ["requests", requests, true],
  ["relations", relations, false],
  ["messages", messages, true],
  ["reactions", reactions, false],
  ["notifications", notifications, true],
  ["gallery", gallery, true],
  ["gallery_likes", galleryLikes, false],
  ["passkey_credentials", passkeyCredentials, false],
  ["sessions", sessions, false],
];

async function main() {
  await initDb(); // garantit que le schéma cible existe
  console.log(`→ Source SQLite : ${SQLITE_PATH}`);
  console.log(`→ Cible Postgres : ${process.env.DATABASE_URL?.replace(/:[^:@/]+@/, ":***@")}\n`);

  const counts: Record<string, number> = {};

  await db.transaction(async (tx) => {
    for (const [tbl, drizzleTable] of PLAN) {
      if (!tableExists(tbl)) continue;
      const rows = all(tbl);
      counts[tbl] = rows.length;
      if (!rows.length) continue;
      // Insère par lots de 500 pour éviter une requête géante.
      for (let i = 0; i < rows.length; i += 500) {
        await tx.insert(drizzleTable).values(rows.slice(i, i + 500));
      }
    }
  });

  // Réaligne les séquences serial sur le MAX(id) importé.
  for (const [tbl, , hasSerial] of PLAN) {
    if (!hasSerial || !counts[tbl]) continue;
    await db.execute(
      sql.raw(
        `SELECT setval(pg_get_serial_sequence('${tbl}', 'id'), COALESCE((SELECT MAX(id) FROM ${tbl}), 1), true)`
      )
    );
  }

  console.log("✓ Migration terminée :");
  for (const [tbl] of PLAN) console.log(`   ${tbl.padEnd(22)} ${counts[tbl] ?? 0} ligne(s)`);

  src.close();
  await closeDb();
}

main().catch((e: unknown) => {
  console.error("✗ Échec de la migration :", e);
  src.close();
  void closeDb().finally(() => process.exit(1));
});
