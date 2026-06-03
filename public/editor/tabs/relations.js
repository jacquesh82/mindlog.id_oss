// editor/tabs/relations.js — colonne « Relations ».
// Builder de rendu pur (câblage dans wireEditor). Extrait verbatim.
// cf. docs/web-app-split-proposal.md
import { relItemHtml, relationsListHtml } from "../../app.js";
import { icon } from "../../ui/icons.js";

// Inject data-degree + data-type into a single relItemHtml output.
function withDeg(r, deg, opts) {
  return relItemHtml(r, opts).replace(
    /^<li class="rel"/,
    `<li class="rel" data-degree="${deg}" data-type="${r.type || "autre"}"`
  );
}

// Inject data-degree into a relationsListHtml block (multiple <li>).
function withDegBulk(html, deg) {
  return html.replace(/<li class="rel"/g, `<li class="rel" data-degree="${deg}"`);
}

export function renderRelationsColumn(data, { incomingListHtml }) {
  const rel = data.relations || { 1: [], 2: [], 3: [] };
  const _deg1 = rel[1] || [];
  const _friends = _deg1.filter((r) => r.type === "amis");
  const _others = _deg1.filter((r) => r.type !== "amis");
  const _incoming = data.incoming || [];
  const _deg2 = rel[2] || [];
  const _deg3 = rel[3] || [];
  const totalCount = _deg1.length + _deg2.length + _deg3.length;

  const d1html = [
    ..._friends.map((r) => withDeg(r, "1", { editable: true })),
    ..._others.map((r) => withDeg(r, "1", { editable: true })),
  ].join("");

  const d2html = _deg2.length
    ? `<li class="rel-deg-sep" data-degree="2">Degré 2</li>` +
      withDegBulk(relationsListHtml(_deg2, false), "2")
    : "";

  const d3html = _deg3.length
    ? `<li class="rel-deg-sep" data-degree="3">Degré 3</li>` +
      withDegBulk(relationsListHtml(_deg3, false), "3")
    : "";

  return `<div class="card">
    <div class="section-title" style="border-top:none;padding-top:0;margin-top:0">Relations <span class="deg">votre réseau</span></div>

    <input id="rel-search" class="rel-search-input" placeholder="Rechercher…" autocomplete="off" />

    <div class="rel-chips-row" id="rel-degree-chips" role="group" aria-label="Filtrer par degré">
      <button class="rel-chip active" data-degree="">Tous</button>
      <button class="rel-chip" data-degree="1">D1${_deg1.length ? ` <span class="chip-n">${_deg1.length}</span>` : ""}</button>
      ${_deg2.length ? `<button class="rel-chip" data-degree="2">D2 <span class="chip-n">${_deg2.length}</span></button>` : ""}
      ${_deg3.length ? `<button class="rel-chip" data-degree="3">D3 <span class="chip-n">${_deg3.length}</span></button>` : ""}
    </div>
    <div class="rel-chips-row" id="rel-type-chips" role="group" aria-label="Filtrer par type">
      <button class="rel-chip active" data-reltype="">Tous</button>
      <button class="rel-chip" data-reltype="amis">Amis</button>
      <button class="rel-chip" data-reltype="pro">Pro</button>
      <button class="rel-chip" data-reltype="autre">Autre</button>
    </div>

    ${
      _incoming.length
        ? `<button class="rel-pending-banner" id="rel-pending-toggle" aria-expanded="false">
        ${icon("bell", 14)} ${_incoming.length} demande${_incoming.length > 1 ? "s" : ""} en attente
        <span class="rel-pending-chevron">›</span>
      </button>
      <div class="rel-pending-panel" id="rel-pending-panel" hidden>
        <ul class="rels">${incomingListHtml(_incoming)}</ul>
      </div>`
        : ""
    }

    <div class="col-scroll">
      <ul class="rels" id="rel-all-list">
        ${totalCount === 0 ? '<li class="rel-empty">Aucune relation. Reliez-vous à un contact ci-dessous 👇</li>' : d1html + d2html + d3html}
        <li class="rel-no-results" id="rel-no-results" hidden>Aucun résultat pour cette recherche.</li>
      </ul>
      <div class="rel-add">
        <div class="handle-input">
          <span>@</span>
          <input id="rel-handle" placeholder="handle à relier" autocomplete="off" />
          <div class="rel-handle-results" id="rel-handle-results" hidden></div>
        </div>
        <select id="rel-type" aria-label="Type de lien">
          <option value="amis">Ami</option>
          <option value="pro">Pro</option>
          <option value="autre">Autre</option>
        </select>
        <button class="btn" id="add-rel">+ Relier</button>
      </div>
    </div>
  </div>`;
}
