// editor/tabs/options.js — Préférences de comportement de l'application :
// confidentialité, messagerie & appels, agenda & RDV.
// L'administration du compte (abonnement, sécurité, accès, données) se trouve
// dans l'onglet « Mon compte » (account.js).
import { DEFAULT_SETTINGS, DOW_LETTERS, DOW_NAMES, normalizeAvailability } from "../../core.js";
import { esc } from "../../ui/dom.js";
import { icon } from "../../ui/icons.js";

export function renderOptionsColumn(data) {
  const s = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  const mkToggle = (key, name, desc, checked) =>
    `<label class="opt-row">
      <span class="opt-text"><span class="opt-name">${esc(name)}</span><span class="opt-desc">${esc(desc)}</span></span>
      <input type="checkbox" class="opt-toggle" data-setting="${key}" ${checked ? "checked" : ""} />
      <span class="toggle-track" aria-hidden="true"><span class="toggle-thumb"></span></span>
    </label>`;

  return `<div class="card opt-v2">
    <div class="opt-v2-grid">

      <div class="opt-v2-block">
        <div class="opt-v2-head">${icon("shield", 16)} Visibilité & Confidentialité</div>
        <div class="opt-list">
          ${mkToggle("profile_public",      "Profil public",    "Votre profil est visible par tous.",          data.settings?.profile_public !== false)}
          ${mkToggle("public_availability", "Agenda public",    "Vos créneaux sont affichés sur votre page.",  data.settings?.public_availability !== false)}
          ${mkToggle("gallery_public",      "Galerie publique", "Les visiteurs voient votre galerie.",         data.settings?.gallery_public !== false)}
        </div>
      </div>

      <div class="opt-v2-block">
        <div class="opt-v2-head">${icon("chat", 16)} Messagerie & Appels</div>
        <div class="opt-list">
          ${mkToggle("allow_chat",  "Messagerie",   "Permettre à vos contacts de vous écrire.",   s.allow_chat)}
          ${mkToggle("allow_call",  "Appels audio", "Autoriser les appels entrants pair-à-pair.",  s.allow_call)}
          ${mkToggle("allow_video", "Vidéo",        "Autoriser les appels vidéo.",                 s.allow_video !== false)}
        </div>
        <p class="lbl-sm" style="margin:.8rem 0 .3rem">Contacts & groupes</p>
        <div style="display:flex;gap:.4rem;flex-wrap:wrap">
          <button class="btn sm" id="gen-invite2">${icon("link", 13)} Inviter un contact</button>
          <button class="btn sm" id="open-groups2">Groupes 👥</button>
        </div>
      </div>

      <div class="opt-v2-block">
        <div class="opt-v2-head">${icon("calendar", 16)} Agenda & Rendez-vous</div>
        <div class="opt-list">
          ${mkToggle("allow_requests", "Demandes de RDV", "Les visiteurs peuvent vous proposer un créneau.", s.allow_requests)}
        </div>
        <p class="lbl-sm" style="margin:.8rem 0 .3rem">Jours disponibles par défaut</p>
        <div class="avail-days" id="avail-days" role="group">
          ${DOW_LETTERS.map((d, i) => `<button type="button" class="avail-day ${normalizeAvailability(s.availability).weekdays[i] ? "on" : ""}" data-dow="${i}" aria-pressed="${normalizeAvailability(s.availability).weekdays[i]}" title="${DOW_NAMES[i]}">${d}</button>`).join("")}
        </div>
      </div>

    </div>
  </div>`;
}
