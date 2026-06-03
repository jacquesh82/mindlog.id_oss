// editor/tabs/relations.js — colonne « Relations ».
// Builder de rendu pur (câblage dans wireEditor). Extrait verbatim.
// cf. docs/web-app-split-proposal.md
import { relItemHtml, relationsListHtml } from "../../app.js";
import { icon } from "../../ui/icons.js";

export function renderRelationsColumn(data, { incomingListHtml }) {
  const rel = data.relations || { 1: [], 2: [], 3: [] };
  const _deg1 = rel[1] || [];
  const _friends = _deg1.filter((r) => r.type === "amis");
  const _others = _deg1.filter((r) => r.type !== "amis");
  const _incoming = data.incoming || [];
  const _reseauCount = _others.length + _incoming.length + (rel[2]?.length || 0) + (rel[3]?.length || 0);

  return `<div class="card">
      <div class="section-title" style="border-top:none;padding-top:0;margin-top:0">Relations <span class="deg">votre réseau</span></div>
      <div class="rel-tabs" role="tablist" id="rel-tabs">
        <button class="rel-tab active" data-tab="amis" role="tab" aria-selected="true">${icon("users", 14)} Amis${_friends.length ? ` <span class="tab-count">${_friends.length}</span>` : ""}</button>
        <button class="rel-tab" data-tab="reseau" role="tab" aria-selected="false">${icon("link", 14)} Réseau${_reseauCount ? ` <span class="tab-count">${_reseauCount}</span>` : ""}</button>
      </div>
      <div class="rel-filters">
        <input id="rel-search" placeholder="Rechercher…" autocomplete="off" />
        <select id="rel-datefilter" aria-label="Filtrer par date">
          <option value="0">Toutes dates</option>
          <option value="7">7 derniers jours</option>
          <option value="30">30 derniers jours</option>
        </select>
      </div>
      <div class="col-scroll">
        <!-- Onglet Amis : contacts réciproques de type « ami », mis en avant. -->
        <div class="rel-panel" id="rel-amis" role="tabpanel">
          <ul class="rels rels-friends">${
            _friends.length
              ? _friends.map((r) => relItemHtml(r, { editable: true })).join("")
              : '<li class="rel-empty">Aucun ami pour l\'instant. Reliez-vous à un contact ci-dessous 👇</li>'
          }</ul>
          <div class="rel-add">
            <div class="handle-input"><span>@</span><input id="rel-handle" placeholder="handle à relier" autocomplete="off" /></div>
            <select id="rel-type" aria-label="Type de lien">
              <option value="amis">Ami</option>
              <option value="pro">Pro</option>
              <option value="autre">Autre</option>
            </select>
            <button class="btn" id="add-rel">+ Relier</button>
          </div>
        </div>
        <!-- Onglet Réseau : autres relations directes + demandes reçues + degrés 2/3. -->
        <div class="rel-panel" id="rel-reseau" role="tabpanel" hidden>
          <div class="section-title" style="border-top:none;padding-top:0;margin-top:0">Autres relations <span class="deg">pro · autre</span></div>
          <ul class="rels">${
            _others.length ? _others.map((r) => relItemHtml(r, { editable: true })).join("") : '<li class="rel-empty">Aucune autre relation directe.</li>'
          }</ul>
          <div class="section-title">Reçues <span class="deg">à valider (réciprocité)</span></div>
          <ul class="rels">${incomingListHtml(_incoming)}</ul>
          <div class="section-title">Degré 2 <span class="deg">relations de relations</span></div>
          <ul class="rels">${relationsListHtml(rel[2], false)}</ul>
          <div class="section-title">Degré 3 <span class="deg">amis d'amis d'amis</span></div>
          <ul class="rels">${relationsListHtml(rel[3], false)}</ul>
          <div style="padding-bottom:.6rem"></div>
        </div>
      </div>
    </div>`;
}
