// editor/tabs/agenda.js — colonne « Agenda » (disponibilités / événements / RDV).
// Builder de rendu pur (câblage dans wireEditor). Extrait verbatim.
// cf. docs/web-app-split-proposal.md
import { eventsHtml } from "../../app.js";
import { host } from "../../host.js";
import { icon } from "../../ui/icons.js";

export function renderAgendaColumn(data, { reqFilterChips, requestsHtml, dayLoad }) {
  return `<div class="card">
      <div class="agenda-tabs" role="tablist" id="agenda-tabs">
        <button class="agenda-tab active" data-tab="dispo" role="tab" aria-selected="true">${icon("calendar", 14)} Agenda</button>
        <button class="agenda-tab" data-tab="events" role="tab" aria-selected="false">${icon("clock", 14)} Événements</button>
        <button class="agenda-tab" data-tab="rdv" role="tab" aria-selected="false">RDV${
          data.pending ? ` <span class="badge">${data.pending}</span>` : ""
        }</button>
      </div>
      <div class="col-scroll">
        <div class="agenda-panel" id="agenda-dispo" role="tabpanel">
          <div class="calendar-fill">
            ${host.calendar.html(data.overrides, true, dayLoad)}
          </div>
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
