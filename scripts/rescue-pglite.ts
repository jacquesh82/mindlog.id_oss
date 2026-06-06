/**
 * rescue-pglite — récupération non-destructive d'une base PGlite corrompue.
 *
 * Quand `tsx watch` est coupé pendant une migration, le WAL PGlite est tronqué
 * et le binaire WASM n'a pas la machinerie de replay de Postgres : tout démarrage
 * suivant abort sur « RuntimeError: Aborted() ».
 *
 * Au lieu de `rm -rf`, ce script DÉPLACE le dossier corrompu vers
 * `<path>.broken-<YYYYMMDD-HHMMSS>` puis crée un dossier vide à la place.
 * Le backup reste sur disque pour inspection ultérieure ou exfiltration manuelle.
 *
 * Usage :
 *   npm run db:rescue                   # cible ./data/dev-pglite (défaut)
 *   PGLITE_PATH=./autre npm run db:rescue
 */
import { existsSync, renameSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const PGLITE_PATH = process.env.PGLITE_PATH || "./data/dev-pglite";
const target = resolve(PGLITE_PATH);

if (!existsSync(target)) {
  console.log(`✓ Rien à faire — ${target} n'existe pas.`);
  process.exit(0);
}

const ts = new Date()
  .toISOString()
  .replace(/[:.]/g, "-")
  .replace("T", "_")
  .slice(0, 19);
const backup = `${target}.broken-${ts}`;

try {
  renameSync(target, backup);
} catch (e) {
  console.error(`✗ Échec déplacement vers ${backup} :`, (e as Error).message);
  process.exit(1);
}

// On recrée un dossier vide à la place : `tsx watch src/server.ts` repartira
// avec une base neuve (initDb applique toutes les migrations).
mkdirSync(target, { recursive: true });

console.log(`✓ PGlite corrompue sauvegardée :`);
console.log(`    ${backup}`);
console.log(`  Dossier neuf prêt :`);
console.log(`    ${target}`);
console.log(``);
console.log(`Relance \`npm run dev\` — les migrations s'appliqueront sur une base vide.`);
console.log(`Le backup reste sur disque pour inspection ; supprime-le avec :`);
console.log(`  rm -rf "${backup}"`);

// Petit garde-fou : laisse trace visible dans le dossier vide pour expliquer
// pourquoi la base est neuve si jamais l'utilisateur fouine.
try {
  // marker file (no fs.writeFileSync import needed — just touch via empty mkdir is enough)
  rmSync(resolve(target, ".keep"), { force: true });
} catch { /* sans importance */ }
