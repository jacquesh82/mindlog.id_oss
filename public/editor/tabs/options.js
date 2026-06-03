// editor/tabs/options.js — colonne « Options » de l'éditeur (Confidentialité /
// Sécurité / Accès / Compte). Builder de rendu pur (le câblage reste dans
// editor/index.js wireEditor). Extrait verbatim. cf. docs/web-app-split-proposal.md
import { DEFAULT_SETTINGS, DOW_LETTERS, DOW_NAMES, normalizeAvailability } from "../../core.js";
import { appState } from "../../state.js";
import { esc } from "../../ui/dom.js";
import { icon } from "../../ui/icons.js";

export function renderOptionsColumn(data) {
    const s = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
    const privacyToggles = [
      { key: "profile_public",      name: "Profil public",       desc: "Votre profil est visible par tous.",               def: true  },
      { key: "public_availability", name: "Agenda public",       desc: "Vos créneaux sont affichés sur votre page.",       def: true  },
      { key: "gallery_public",      name: "Galerie publique",    desc: "Les visiteurs voient votre galerie.",               def: true  },
    ];
    const mkToggle = (key, name, desc, checked) =>
      `<label class="opt-row">
        <span class="opt-text"><span class="opt-name">${esc(name)}</span><span class="opt-desc">${esc(desc)}</span></span>
        <input type="checkbox" class="opt-toggle" data-setting="${key}" ${checked ? "checked" : ""} />
        <span class="toggle-track" aria-hidden="true"><span class="toggle-thumb"></span></span>
      </label>`;
    return `<div class="card opt-v2">
      <div class="opt-tabs" role="tablist" id="opt-tabs">
        <button class="opt-tab active" data-tab="confid" role="tab" aria-selected="true">${icon("shield", 14)} Confidentialité</button>
        <button class="opt-tab" data-tab="securite" role="tab" aria-selected="false">${icon("lock", 14)} Sécurité</button>
        <button class="opt-tab" data-tab="acces" role="tab" aria-selected="false">${icon("key", 14)} Accès</button>
        <button class="opt-tab opt-tab-danger" data-tab="compte" role="tab" aria-selected="false">${icon("trash", 14)} Compte</button>
      </div>

      <!-- Onglet Confidentialité : visibilité, messagerie/appels, agenda -->
      <div class="opt-panel" id="opt-confid" role="tabpanel">
      <div class="opt-v2-grid">

        <!-- Visibilité & Confidentialité : ce que les visiteurs voient -->
        <div class="opt-v2-block">
          <div class="opt-v2-head">${icon("shield", 16)} Visibilité & Confidentialité</div>
          <div class="opt-list">
            ${privacyToggles.map(p => mkToggle(p.key, p.name, p.desc, data.settings?.[p.key] !== false)).join("")}
          </div>
        </div>

        <!-- Messagerie & Appels : qui peut me contacter -->
        <div class="opt-v2-block">
          <div class="opt-v2-head">${icon("chat", 16)} Messagerie & Appels</div>
          <div class="opt-list">
            ${mkToggle("allow_chat",  "Messagerie",   "Permettre à vos contacts de vous écrire.", s.allow_chat)}
            ${mkToggle("allow_call",  "Appels audio", "Autoriser les appels entrants pair-à-pair.", s.allow_call)}
            ${mkToggle("allow_video", "Vidéo",        "Autoriser les appels vidéo.",               s.allow_video !== false)}
          </div>
          <p class="lbl-sm" style="margin:.8rem 0 .3rem">Contacts & groupes</p>
          <div style="display:flex;gap:.4rem;flex-wrap:wrap">
            <button class="btn sm" id="gen-invite2">${icon("link",13)} Inviter un contact</button>
            <button class="btn sm" id="open-groups2">Groupes 👥</button>
          </div>
        </div>

        <!-- Agenda & RDV -->
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
      </div>

      <!-- Onglet Sécurité : chiffrement E2E + passkeys -->
      <div class="opt-panel" id="opt-securite" role="tabpanel" hidden>
      <div class="opt-v2-grid">

        <!-- Sécurité & Chiffrement E2E (pleine largeur) : statut + sauvegarde + passkeys -->
        <div class="opt-v2-block opt-v2-account">
          <div class="opt-v2-head">${icon("lock", 16)} Sécurité & Chiffrement E2E</div>
          <div class="opt-v2-e2e-status ${data.hasVault ? "ok" : "warn"}" id="opt-vault-banner">
            ${icon(data.hasVault ? "shield" : "key", 20)}
            <div>
              <b>${data.hasVault ? "Clé sauvegardée dans le coffre" : "Aucune sauvegarde de clé"}</b>
              <p>${data.hasVault ? "Vos messages chiffrés sont protégés sur tous vos appareils." : "Sans sauvegarde, vos messages sont perdus si vous changez d'appareil."}</p>
            </div>
          </div>
          <div class="opt-v2-access-grid" style="margin-top:.85rem">
            <div class="opt-v2-access-col">
              <p class="lbl-sm" style="margin:0 0 .4rem">Sauvegarder ma clé E2E</p>
              <button class="btn sm" id="opt-e2e-backup" style="margin-bottom:.55rem">${icon("download", 14)} ${data.hasVault ? "Mettre à jour le coffre" : "Sauvegarde rapide"}</button>
              <div style="display:flex;gap:.4rem;flex-wrap:wrap">
                <button class="btn sm" id="e2e-passkey-save2">${icon("shield", 13)} Via passkey</button>
                <button class="btn sm" id="e2e-pin-save2">${icon("lock", 13)} Code PIN</button>
                <button class="btn sm" id="e2e-pass-save2">${icon("key", 13)} Passphrase</button>
                <button class="btn sm" id="e2e-restore2">${icon("download", 13)} Restaurer</button>
              </div>
            </div>
            <div class="opt-v2-access-col">
              <p class="lbl-sm" style="margin:0 0 .4rem">Passkeys (sans mot de passe)</p>
              <div id="passkey-list2" class="lbl-sm">Chargement…</div>
              <div class="add-row" style="grid-template-columns:1fr auto;margin-top:.5rem">
                <input id="passkey-name2" placeholder="Nom de l'appareil" maxlength="64" />
                <button class="btn primary sm" id="passkey-add2">${icon("shield", 14)} Créer</button>
              </div>
            </div>
          </div>
        </div>

      </div>
      </div>

      <!-- Onglet Accès : URL publique, clé d'accès, sessions, téléphone -->
      <div class="opt-panel" id="opt-acces" role="tabpanel" hidden>
      <div class="opt-v2-grid">

        <!-- Accès & Sessions (pleine largeur) -->
        <div class="opt-v2-block opt-v2-account">
          <div class="opt-v2-head">${icon("key", 16)} Accès & Sessions</div>
          <div class="opt-v2-access-grid">
            <div class="opt-v2-access-col">
              <p class="lbl-sm" style="margin:0 0 .3rem">URL publique</p>
              <div class="url-row" style="margin-bottom:.7rem">
                <code style="font-size:.74rem;word-break:break-all">${esc(location.origin + data.publicUrl)}</code>
                <button class="btn copy sm" data-copy="${esc(location.origin + data.publicUrl)}">Copier</button>
              </div>
              <p class="lbl-sm" style="margin:0 0 .3rem">Clé d'accès</p>
              <div class="url-row" style="margin-bottom:.5rem">
                <code id="key-display2" style="font-size:.74rem;cursor:pointer">••••••••••</code>
                <button class="btn copy sm" id="copy-key2" data-copy="${esc(appState.key)}">Copier</button>
              </div>
              <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.7rem">
                <button class="btn sm" id="toggle-key2">${icon("key",13)} Afficher</button>
                <button class="btn sm danger" id="rotate-key2">${icon("key",13)} Régénérer</button>
              </div>
              <p class="lbl-sm" style="margin:0 0 .3rem">Email de récupération</p>
              <div class="add-row" style="grid-template-columns:1fr auto">
                <input id="rec-email2" type="email" value="${esc(data.recoveryEmail || "")}" placeholder="vous@exemple.com" />
                <button class="btn sm" id="save-rec2">Enregistrer</button>
              </div>
            </div>
            <div class="opt-v2-access-col">
              <p class="lbl-sm" style="margin:0 0 .4rem">Sessions actives</p>
              <div id="sessions-list2" class="lbl-sm">Chargement…</div>
              <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin:.6rem 0 .9rem">
                <button class="btn sm" id="logout-btn2">${icon("key",13)} Déconnecter cette session</button>
                <button class="btn sm danger" id="logout-all-btn2">${icon("key",13)} Tout déconnecter</button>
              </div>
              <p class="lbl-sm" style="margin:0 0 .3rem">Connecter un téléphone <span class="badge-sm">PIN</span></p>
              <div style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:center">
                <button class="btn sm" id="gen-pin-btn2">${icon("key",13)} Générer un code PIN</button>
                <code id="pin-display2" style="font-size:1.1rem;letter-spacing:.2em;font-weight:600" hidden></code>
              </div>
              <p class="lbl-sm" id="pin-hint2" style="margin:.35rem 0 0" hidden></p>
            </div>
          </div>
        </div>

        <!-- Mes appareils chiffrés (multi-appareils E2E) -->
        <div class="opt-v2-block opt-v2-account">
          <div class="opt-v2-head">${icon("user", 16)} Mes appareils chiffrés</div>
          <p class="lbl-sm" style="margin:0 0 .6rem;line-height:1.5">Chaque appareil possède sa propre clé de chiffrement. Un <b>nouvel appareil</b> doit être <b>approuvé</b> depuis un appareil déjà actif pour pouvoir lire et écrire vos messages.</p>
          <div id="devices-list" class="lbl-sm">Chargement…</div>
        </div>

      </div>
      </div>

      <!-- Onglet Compte : QR, export RGPD, déconnexion, suppression -->
      <div class="opt-panel" id="opt-compte" role="tabpanel" hidden>
      <div class="opt-v2-grid">

        <!-- Zone de danger -->
        <div class="opt-v2-block opt-v2-account opt-v2-danger-block">
          <div class="opt-v2-head" style="color:var(--danger)">${icon("trash", 16)} Zone de danger</div>
          <p class="lbl-sm" style="margin:0 0 .75rem;line-height:1.5">Ces actions sont irréversibles. Réfléchissez avant de continuer.</p>
          <div style="display:flex;gap:.5rem;flex-wrap:wrap">
            <button class="btn sm" id="export-data2">${icon("download", 14)} Exporter mes données (RGPD)</button>
            <button class="btn sm" id="opt-qr-link">${icon("qr", 14)} Mon QR code</button>
            <button class="btn sm danger" data-action="logout">${icon("key", 14)} Se déconnecter</button>
            <button class="btn sm danger" id="delete-account2">${icon("trash", 14)} Supprimer mon compte</button>
          </div>
        </div>

      </div>
      </div>
    </div>`;
}
