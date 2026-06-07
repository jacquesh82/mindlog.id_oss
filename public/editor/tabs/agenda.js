// editor/tabs/agenda.js — colonne « Agenda » (disponibilités / événements / RDV).
// Builder de rendu pur (câblage dans wireEditor). Extrait verbatim.
// cf. docs/web-app-split-proposal.md
import { eventsHtml } from "../../app.js";
import { host } from "../../host.js";
import { icon } from "../../ui/icons.js";
import { esc } from "../../ui/dom.js";

export function renderAgendaColumn(data, { reqFilterChips, requestsHtml, dayLoad }) {
  const now = new Date().toISOString();
  const upcoming = (data.events || [])
    .filter(e => (e.starts_at || "") >= now)
    .sort((a, b) => (a.starts_at || "").localeCompare(b.starts_at || ""))
    .slice(0, 6);

  function fmtDate(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) +
      " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }

  const upcomingHtml = upcoming.length
    ? `<div class="agenda-upcoming">
        <div class="agenda-upcoming-title">${icon("clock", 12)} Prochains</div>
        ${upcoming.map(e => `<div class="agenda-upcoming-item${e.kind === "live" ? " is-live" : ""}">
          <span class="agenda-upcoming-time">${fmtDate(e.starts_at)}</span>
          <span class="agenda-upcoming-name">${e.kind === "live" ? `${icon("users", 11)} ` : ""}${esc(e.title || "")}</span>
        </div>`).join("")}
      </div>`
    : `<div class="agenda-upcoming"><p class="empty" style="text-align:center;padding:.6rem 0;font-size:.82rem">Aucun événement à venir</p></div>`;

  // Layout rail : rail vertical (sous-modes) + scroll de panel à droite, même
  // pattern que les Échanges. Les class .agenda-tab restent inchangées pour que
  // le wiring (app.querySelectorAll('.agenda-tab')…) marche tel quel.
  return `<div class="card subrail-card">
      <nav class="subrail" role="tablist" aria-label="Sous-sections Agenda" id="agenda-tabs">
        <button class="subrail-btn agenda-tab is-active active" data-tab="dispo" role="tab" aria-selected="true" title="Disponibilités" aria-label="Disponibilités">
          ${icon("calendar", 22)}<span class="subrail-label">Agenda</span>
        </button>
        <button class="subrail-btn agenda-tab" data-tab="events" role="tab" aria-selected="false" title="Événements" aria-label="Événements">
          ${icon("clock", 22)}<span class="subrail-label">Événements</span>
        </button>
        <button class="subrail-btn agenda-tab" data-tab="rdv" role="tab" aria-selected="false" title="Rendez-vous" aria-label="Rendez-vous">
          ${icon("users", 22)}<span class="subrail-label">RDV</span>
          ${data.pending ? `<span class="subrail-badge">${data.pending}</span>` : ""}
        </button>
      </nav>
      <div class="col-scroll subrail-body">
        <div class="agenda-panel" id="agenda-dispo" role="tabpanel">
          <div class="calendar-fill">
            ${host.calendar.html(data.overrides, true, dayLoad, true, data.events || [])}
          </div>
          ${upcomingHtml}
          <div style="padding-bottom:.6rem"></div>
        </div>
        <div class="agenda-panel" id="agenda-events" role="tabpanel" hidden>
          <div class="ev-toolbar">
            <span class="ev-toolbar-title">${icon("calendar", 15)} Mes événements</span>
            <button type="button" class="btn primary sm" data-event-new>${icon("plus", 15)} Nouvel événement</button>
          </div>
          <div class="agenda-events">${eventsHtml(data.events, true)}</div>
          <div style="padding-bottom:.6rem"></div>
        </div>
        <div class="agenda-panel" id="agenda-rdv" role="tabpanel" hidden>
          <div class="req-filters" role="tablist" aria-label="Filtrer les demandes">
            ${reqFilterChips(data.requests || [])}
          </div>
          <ul class="requests">${requestsHtml(data.requests || [])}</ul>
          <div style="padding-bottom:.6rem"></div>
        </div>
      </div>
    </div>`;
}
