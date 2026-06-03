// views/status.js — page d'état du service (/status). Extrait verbatim.
import { CREDIT } from "../i18n.js";
import { api } from "../net.js";
import { esc } from "../ui/dom.js";
import { miloSvg, siteHeader } from "../ui/icons.js";

export async function renderStatus() {
  app.innerHTML = `<p class="loading">Chargement…</p>`;
  await loadAuth(); // chip header cohérent (photo + nom) avec les autres écrans
  let s = null;
  try {
    s = await api("/api/status");
  } catch {
    /* serveur injoignable */
  }
  footer.innerHTML = `<p>${CREDIT()}</p>`;

  if (!s) {
    app.innerHTML = `
      <div class="card" style="text-align:center">
        <div class="empty-milo">${miloSvg(110)}</div>
        <h1>Service injoignable</h1>
        <p class="subtitle">Impossible de récupérer l'état des services.</p>
        <a class="btn primary" href="/">Accueil</a>
      </div>`;
    setupMiloEyes();
    return;
  }

  const svc = (label, state) => {
    const up = state === "ok" || state === "available";
    return `<div class="status-card ${up ? "up" : "down"}">
      <span class="status-dot"></span>
      <div><div class="status-name">${label}</div><div class="status-state">${esc(state)}</div></div>
    </div>`;
  };
  const metric = (n, l) => `<div class="metric"><b>${n}</b><span>${l}</span></div>`;

  app.innerHTML = `
    ${siteHeader({
      center: headerSearchHtml(),
      right: `<a class="btn sm" href="/">Accueil</a>
        ${headerAccount()}`,
    })}
    <section class="status">
      <div class="status-head">
        <span class="status-badge ${s.ok ? "up" : "down"}">${s.ok ? "● Opérationnel" : "● Incident"}</span>
        <h1>État des services</h1>
      </div>
      <div class="status-grid">
        ${svc("Site web", s.services.web)}
        ${svc("API", s.services.api)}
        ${svc("Base de données", s.services.db)}
        ${svc("Serveur MCP", s.services.mcp)}
      </div>
      <div class="section-title">Quelques chiffres</div>
      <div class="status-metrics">
        ${metric(s.counts.identities, "identités")}
        ${metric(s.counts.events, "événements")}
        ${metric(s.counts.requests, "demandes RDV")}
        ${metric(s.counts.relations, "relations")}
      </div>
      <p class="status-meta">Version ${esc(s.version)} · uptime ${fmtUptime(s.uptimeSeconds)} · ${new Date(s.time).toLocaleString("fr-FR")}</p>
    </section>`;
  wireHeaderSearch();
}
