// Charge les variables depuis .env (Node ≥ 20.6). Importé en premier,
// avant tout module qui lit process.env (db, mailer…).
try {
  process.loadEnvFile();
} catch {
  /* pas de .env : on utilise l'environnement courant */
}
