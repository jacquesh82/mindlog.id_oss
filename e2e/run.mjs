// Runner e2e — démarre un serveur PGlite éphémère, pilote Chromium (Playwright),
// rejoue e2e/scenarios.mjs, agrège les erreurs console/page + 4xx/5xx same-origin.
//
//   npm run test:e2e          (port 8788 par défaut)
//   TEST_PORT=9000 npm run test:e2e
//
// Pré-requis une fois : npx playwright install chromium
// Sortie : code 0 si tout passe, 1 sinon. Aucune dépendance Docker (DB en mémoire).
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { scenarios } from "./scenarios.mjs";

const PORT = process.env.TEST_PORT || "8788";
const BASE = `http://localhost:${PORT}`;

// Bruit non lié à notre code (offline/CDN/headless) — n'invalide pas un scénario.
// Un vrai bug d'import (« does not provide an export », « is not defined ») ne
// matche aucun de ces motifs et fait donc toujours échouer.
const BENIGN = [
  /wasm streaming compile failed/i,        // sqlite-wasm (local-db.js) : repli ArrayBuffer
  /falling back to ArrayBuffer/i,
  /Failed to fetch/i,                       // ressources CDN bloquées hors-ligne
  /Failed to load resource/i,
  /font-size:0;color:transparent/,          // message console stylé d'une lib tierce
  /turnstile|cloudflare|challenges\.cloudflare/i,
  /OPFS|SAHPool|SQLite/i,                    // cache PIM hors-ligne (dégradation gracieuse)
];
const realError = (s) => !BENIGN.some((re) => re.test(s));

function startServer() {
  const child = spawn("npx", ["tsx", "src/server.ts"], {
    env: { ...process.env, DATABASE_DRIVER: "pglite", PORT, TURNSTILE_SECRET_KEY: "", NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", (d) => process.env.E2E_DEBUG && process.stderr.write(d));
  return child;
}

async function waitForServer(timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(BASE + "/", { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("serveur PGlite injoignable sur " + BASE);
}

async function main() {
  const server = startServer();
  const cleanup = () => { try { server.kill("SIGTERM"); } catch {} };
  process.on("exit", cleanup);
  process.on("SIGINT", () => { cleanup(); process.exit(130); });

  await waitForServer();
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const ctx = { base: BASE, stamp: Date.now() };
  let pass = 0, fail = 0;

  for (const sc of scenarios) {
    const context = await browser.newContext({ baseURL: BASE });
    // Évite les overlays d'accueil (visite guidée Milo, bandeau RGPD) qui
    // intercepteraient les clics dans les scénarios.
    await context.addInitScript(() => {
      try { localStorage.setItem("mindlog.tourSeen", "1"); localStorage.setItem("mk_gdpr_ok", "1"); } catch {}
    });
    const page = await context.newPage();
    const consoleErrors = [], pageErrors = [], badResp = [];
    page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
    page.on("pageerror", (e) => pageErrors.push(e.message));
    page.on("response", (r) => {
      const u = r.url();
      if (u.startsWith(BASE) && r.status() >= 400) badResp.push(`${r.status()} ${u.replace(BASE, "")}`);
    });
    let err = null;
    try {
      await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(600);
      await sc.run(page, ctx);
      // garde-fou global : aucune erreur runtime DE NOTRE CODE ni module same-origin manquant
      const ce = consoleErrors.filter(realError), pe = pageErrors.filter(realError);
      if (ce.length) throw new Error("console.error: " + ce.slice(0, 5).join(" | "));
      if (pe.length) throw new Error("pageerror: " + pe.slice(0, 5).join(" | "));
      if (badResp.length) throw new Error("réponses 4xx/5xx: " + badResp.slice(0, 8).join(" | "));
    } catch (e) {
      err = e;
    }
    if (err) { fail++; console.log(`  ✗ ${sc.name}\n      ${err.message}`); }
    else { pass++; console.log(`  ✓ ${sc.name}`); }
    await context.close();
  }

  await browser.close();
  cleanup();
  console.log(`\n  e2e : ${pass} passés, ${fail} échoués (${scenarios.length} scénarios)`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
