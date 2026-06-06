/**
 * Connexion base de données.
 *
 * Moteur par défaut : PostgreSQL (node-postgres) via `DATABASE_URL`.
 * Tests : PGlite (Postgres en WASM, en mémoire) quand `DATABASE_DRIVER=pglite`
 * — même dialecte que la prod, instantané, sans serveur.
 *
 * Les migrations Drizzle (dossier `drizzle/`) sont appliquées par `initDb()`,
 * à appeler une fois au démarrage (serveur, MCP, tests).
 */
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import * as schema from "./schema.js";
import { gallery, galleryLikes } from "./schema.js";

const MIGRATIONS_DIR = resolve(process.cwd(), "drizzle");

const usePglite = process.env.DATABASE_DRIVER === "pglite";

// On expose une instance typée « node-postgres » : PGlite parle le même
// dialecte et la même API de requête, donc le cast est sûr en pratique.
export type DB = NodePgDatabase<typeof schema>;

let _pgPool: Pool | undefined;
let _pgliteClient: PGlite | undefined;

function createDb(): DB {
  if (usePglite) {
    // PGLITE_PATH vide ou absent => undefined => base en mémoire (le `||` est
    // volontaire : une chaîne vide doit aussi retomber sur le mode mémoire).
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    _pgliteClient = new PGlite(process.env.PGLITE_PATH || undefined);
    return drizzlePglite(_pgliteClient, { schema }) as unknown as DB;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL manquant. Définissez-le (postgres://…) ou utilisez DATABASE_DRIVER=pglite pour les tests."
    );
  }
  _pgPool = new Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX) || 10 });
  return drizzlePg(_pgPool, { schema });
}

export const db: DB = createDb();

/** Applique les migrations Drizzle. Idempotent. À appeler au démarrage. */
export async function initDb(): Promise<void> {
  try {
    if (usePglite) {
      await migratePglite(db as never, { migrationsFolder: MIGRATIONS_DIR });
    } else {
      await migratePg(db as never, { migrationsFolder: MIGRATIONS_DIR });
    }
  } catch (e) {
    // PGlite : si `tsx watch` est coupé pendant une migration, le WAL est tronqué
    // et le binaire WASM (sans recovery PG complet) abort dès le démarrage suivant
    // sur « RuntimeError: Aborted() ». Pas réparable côté WASM → guide vers le
    // backup non-destructif.
    if (usePglite && /aborted|wasm|RuntimeError/i.test(String((e as Error).message ?? e))) {
      const path = process.env.PGLITE_PATH || "./data/dev-pglite";
      console.error(`\n[db] ✗ PGlite corrompue à ${path}`);
      console.error(`[db]   (probablement un kill pendant une migration — WAL tronqué)`);
      console.error(`[db] → Lance :  npm run db:rescue`);
      console.error(`[db]   (le dossier est SAUVEGARDÉ, pas supprimé)\n`);
    }
    throw e;
  }
}

/** Ferme proprement la connexion (tests, arrêt). */
export async function closeDb(): Promise<void> {
  await _pgPool?.end();
  await _pgliteClient?.close();
}

export function newAccessKey(): string {
  return randomBytes(24).toString("base64url");
}

/* --------------------------------- Gallery -------------------------------- */

export async function getGallery(
  identityId: number
): Promise<{ id: number; filename: string; link_url: string; likes: number; position: number }[]> {
  const res = await db.execute(sql`
    SELECT g.id, g.filename, g.link_url, g.position,
           COUNT(l.photo_id)::int AS likes
    FROM ${gallery} g
    LEFT JOIN ${galleryLikes} l ON l.photo_id = g.id
    WHERE g.identity_id = ${identityId}
    GROUP BY g.id
    ORDER BY g.position, g.id
    LIMIT 10
  `);
  return res.rows as { id: number; filename: string; link_url: string; likes: number; position: number }[];
}

/** Définit/efface le lien cliquable d'une photo (Premium P6), si elle appartient au titulaire. */
export async function setGalleryLink(
  photoId: number,
  identityId: number,
  linkUrl: string
): Promise<boolean> {
  const r = await db
    .update(gallery)
    .set({ link_url: linkUrl })
    .where(and(eq(gallery.id, photoId), eq(gallery.identity_id, identityId)))
    .returning({ id: gallery.id });
  return r.length > 0;
}

export async function countGallery(identityId: number): Promise<number> {
  const res = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM ${gallery} WHERE identity_id = ${identityId}`
  );
  return (res.rows[0] as { n: number }).n;
}

export async function addGalleryPhoto(identityId: number, filename: string): Promise<number> {
  const res = await db.execute(sql`
    SELECT COALESCE(MAX(position), 0) + 1 AS n FROM ${gallery} WHERE identity_id = ${identityId}
  `);
  const pos = (res.rows[0] as { n: number }).n;
  const inserted = await db
    .insert(gallery)
    .values({ identity_id: identityId, filename, position: pos })
    .returning({ id: gallery.id });
  return inserted[0].id;
}

export async function deleteGalleryPhoto(identityId: number, photoId: number): Promise<boolean> {
  const r = await db
    .delete(gallery)
    .where(sql`${gallery.id} = ${photoId} AND ${gallery.identity_id} = ${identityId}`)
    .returning({ id: gallery.id });
  return r.length > 0;
}

export async function toggleGalleryLike(
  photoId: number,
  fingerprint: string
): Promise<{ likes: number; liked: boolean }> {
  const existing = await db
    .select({ p: galleryLikes.photo_id })
    .from(galleryLikes)
    .where(sql`${galleryLikes.photo_id} = ${photoId} AND ${galleryLikes.fingerprint} = ${fingerprint}`);
  const liked = existing.length > 0;
  if (liked) {
    await db
      .delete(galleryLikes)
      .where(sql`${galleryLikes.photo_id} = ${photoId} AND ${galleryLikes.fingerprint} = ${fingerprint}`);
  } else {
    await db
      .insert(galleryLikes)
      .values({ photo_id: photoId, fingerprint })
      .onConflictDoNothing();
  }
  const res = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM ${galleryLikes} WHERE photo_id = ${photoId}`
  );
  return { likes: (res.rows[0] as { n: number }).n, liked: !liked };
}

export async function hasGalleryLike(photoId: number, fingerprint: string): Promise<boolean> {
  const rows = await db
    .select({ p: galleryLikes.photo_id })
    .from(galleryLikes)
    .where(sql`${galleryLikes.photo_id} = ${photoId} AND ${galleryLikes.fingerprint} = ${fingerprint}`);
  return rows.length > 0;
}

/** Nom de fichier d'une photo de galerie (pour la servir / la supprimer). */
export async function getGalleryPhotoFile(photoId: number): Promise<string | undefined> {
  const rows = await db.select({ filename: gallery.filename }).from(gallery).where(eq(gallery.id, photoId)).limit(1);
  return rows[0]?.filename;
}

/** Idem, mais seulement si la photo appartient à l'identité donnée. */
export async function getOwnedGalleryPhotoFile(
  photoId: number,
  identityId: number
): Promise<string | undefined> {
  const rows = await db
    .select({ filename: gallery.filename })
    .from(gallery)
    .where(and(eq(gallery.id, photoId), eq(gallery.identity_id, identityId)))
    .limit(1);
  return rows[0]?.filename;
}

export async function setGalleryFilename(photoId: number, filename: string): Promise<void> {
  await db.update(gallery).set({ filename }).where(eq(gallery.id, photoId));
}

export async function galleryPhotoExists(photoId: number): Promise<boolean> {
  const rows = await db.select({ id: gallery.id }).from(gallery).where(eq(gallery.id, photoId)).limit(1);
  return rows.length > 0;
}

// Attributs de base seedés à la création d'une identité. [key, label, is_public]
export const BASE_FIELDS: [string, string, number][] = [
  ["display_name", "Nom", 1],
  ["title", "Fonction", 1],
  ["company", "Entreprise", 1],
  ["bio", "Bio", 1],
  ["email", "Email", 1],
  ["location", "Lieu", 1],
  ["website", "Site web", 1],
  ["phone", "Téléphone", 0],
];

export const RESERVED_HANDLES = new Set([
  "api", "k", "static", "assets", "admin", "about", "search",
  "me", "id", "help", "support", "login", "signup", "settings",
  "null", "undefined", "www", "mindlog",
]);
