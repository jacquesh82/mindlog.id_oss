// editor/tabs/identity.js — colonne « Identité » (profil / réseaux / compte).
// Builder de rendu pur (câblage dans wireEditor). Extrait verbatim.
// cf. docs/web-app-split-proposal.md
import { icon, isSocialKey } from "../../ui/icons.js";
import { esc } from "../../ui/dom.js";
import { appState } from "../../state.js";

export function renderIdentityColumn(data, { photo, fieldEditHtml, socialEditHtml }) {
  return `<div class="card">
      <div class="id-head">
        <div class="photo-wrap"><span class="photo-frame">${photo}${
          data.hasVault
            ? `<span class="vault-badge" title="Vos clés E2E sont sauvegardées dans le coffre" aria-label="Clés sauvegardées dans le coffre">${icon("key", 13)}</span>`
            : ""
        }</span></div>
        <div class="id-head-body">
          <p class="handle">@${esc(data.handle)}</p>
          <div class="id-actions">
            <form id="photo-form" class="id-photo-form">
              <label class="btn" style="cursor:pointer" title="Changer la photo" aria-label="Changer la photo">${icon("user", 16)}<span class="btn-label"> Changer la photo</span>
                <input type="file" name="photo" accept="image/*" hidden />
              </label>
              <button type="button" class="btn" id="take-photo-btn" title="Prendre une photo" aria-label="Prendre une photo">${icon("camera", 16)}<span class="btn-label"> Prendre une photo</span></button>
            </form>
            <div class="id-actions-sec">
              <button class="btn sm" id="qr-btn">${icon("qr", 16)} QR</button>
              <a class="btn sm" href="${esc(data.publicUrl)}" target="_blank" rel="noopener noreferrer">Voir ↗</a>
            </div>
          </div>
        </div>
      </div>
      <div class="id-tabs" role="tablist" id="id-tabs">
        <button class="id-tab active" data-tab="profil" role="tab" aria-selected="true">Profil</button>
        <button class="id-tab" data-tab="reseaux" role="tab" aria-selected="false">${icon("link", 14)} Réseaux</button>
      </div>
      <div class="col-scroll">
        <div class="id-panel" id="id-profil" role="tabpanel">
          <div class="section-title" style="border-top:none;padding-top:0;margin-top:0">Intro du profil</div>
          <p class="lbl-sm" style="margin:0 0 .5rem;line-height:1.5">
            Texte affiché en haut de <b>/@${esc(data.handle)}</b>, au-dessus de ta bio.
            <b>Markdown</b> accepté.
          </p>
          <textarea id="sp-profile-intro" class="sp-intro-ta"
            maxlength="4000" rows="4"
            placeholder="# Bienvenue sur mon profil !&#10;Quelques mots pour te présenter aux visiteurs.">${esc(data.profile_intro_md || "")}</textarea>
          <div class="lt-prem-actions" style="margin:.35rem 0 .8rem;align-items:center;justify-content:flex-end">
            <span id="sp-profile-intro-status" class="lbl-sm" style="opacity:.7" aria-live="polite"></span>
          </div>
          <div class="section-title">Attributs</div>
          <div id="fields-edit">${data.fields.filter((f) => !isSocialKey(f.key)).map(fieldEditHtml).join("")}</div>
          <div class="add-row" style="margin-top:.5rem;padding-bottom:.6rem">
            <input id="nf-label" placeholder="Libellé (ex. Skype)" />
            <input id="nf-value" placeholder="Valeur" />
            <button class="btn" id="add-field">+ Ajouter</button>
          </div>
        </div>
        <div class="id-panel" id="id-reseaux" role="tabpanel" hidden>
          <p class="lbl-sm" style="margin:.2rem 0 .7rem;line-height:1.45">Indiquez votre login (le lien est construit automatiquement) ou collez une URL complète.</p>
          <div id="socials-edit">${socialEditHtml(data.fields)}</div>
          <div style="padding-bottom:.6rem"></div>
        </div>
        <div class="id-panel" id="id-options" role="tabpanel" hidden style="display:none!important"><!-- déplacé → Options --></div>
        <div class="id-panel" id="id-compte" role="tabpanel" hidden style="display:none!important">
          <div class="acct-tabs" role="tablist" id="acct-tabs" hidden>

          <div class="acct-panel" id="acct-access" role="tabpanel">
            <label class="lbl-sm">URL publique</label>
            <div class="url-row" style="margin:.3rem 0 .8rem">
              <code style="font-size:.78rem;word-break:break-all">${esc(location.origin + data.publicUrl)}</code>
              <button class="btn copy" data-copy="${esc(location.origin + data.publicUrl)}">Copier</button>
            </div>

            <label class="lbl-sm">Inviter un contact (sans annuaire)</label>
            <div class="add-row" style="grid-template-columns:1fr 1fr;margin:.3rem 0 .9rem">
              <button class="btn" id="gen-invite" title="Génère un lien/QR d'invitation à usage unique">Inviter 🔗</button>
              <button class="btn" id="open-groups" title="Conversations de groupe chiffrées">Groupes 👥</button>
            </div>

            <label class="lbl-sm" for="rec-email">Email de récupération</label>
            <div class="add-row" style="grid-template-columns:1fr auto;margin-top:.3rem;margin-bottom:.9rem">
              <input id="rec-email" type="email" value="${esc(data.recoveryEmail || "")}" placeholder="vous@exemple.com" />
              <button class="btn" id="save-rec">Enregistrer</button>
            </div>

            <label class="lbl-sm">Clé d'accès privée</label>
            <div class="url-row" style="margin:.3rem 0 .4rem">
              <code id="key-display" style="font-size:.72rem;word-break:break-all;cursor:pointer" title="Cliquer pour afficher/masquer">••••••••••••</code>
              <button class="btn copy" id="copy-key" data-copy="${esc(appState.key)}">Copier</button>
            </div>
            <p class="lbl-sm" style="margin:.3rem 0 .5rem;line-height:1.45">Lien privé partageable — plus nécessaire pour se connecter (session active).</p>
            <div style="display:flex;gap:.4rem;flex-wrap:wrap">
              <button class="btn sm" id="toggle-key">${icon("key",13)} Afficher</button>
              <button class="btn sm danger" id="rotate-key">${icon("key",13)} Régénérer</button>
            </div>
            <div style="padding-bottom:.6rem"></div>
          </div>

          <div class="acct-panel" id="acct-devices" role="tabpanel" hidden>
            <div class="section-title" style="border-top:none;padding-top:.3rem;margin-top:0">Sessions actives</div>
            <div id="sessions-list"><p class="lbl-sm">Chargement…</p></div>
            <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.6rem">
              <button class="btn sm" id="logout-btn">${icon("key",13)} Se déconnecter</button>
              <button class="btn sm danger" id="logout-all-btn">${icon("key",13)} Tout déconnecter</button>
            </div>

            <div class="section-title" style="margin-top:1.2rem">Connecter un téléphone <span class="badge-sm">code PIN</span></div>
            <p class="lbl-sm" style="margin:.2rem 0 .6rem;line-height:1.45">Générez un code à 6 chiffres et saisissez-le dans l'application mobile pour la connecter — sans coller votre clé d'accès. Valable 10 minutes, à usage unique.</p>
            <div style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:center">
              <button class="btn sm" id="gen-pin-btn">${icon("key",13)} Générer un code PIN</button>
              <code id="pin-display" style="font-size:1.15rem;letter-spacing:.25em;font-weight:600" hidden></code>
            </div>
            <p class="lbl-sm" id="pin-hint" style="margin:.4rem 0 0" hidden></p>

            <div class="section-title" style="margin-top:1.2rem">Passkeys <span class="badge-sm">sans mot de passe</span></div>
            <p class="lbl-sm" style="margin:.2rem 0 .7rem">Empreinte, Face ID ou clé de sécurité.</p>
            <div id="passkey-list"></div>
            <div class="add-row" style="grid-template-columns:1fr auto;margin-top:.5rem">
              <input id="passkey-name" placeholder="Nom de l'appareil" maxlength="64" />
              <button class="btn primary" id="passkey-add">${icon("shield", 15)} Créer</button>
            </div>

            <div class="section-title" style="margin-top:1.2rem">Chiffrement des messages <span class="badge-sm">portabilité</span></div>
            <p class="lbl-sm" style="margin:.2rem 0 .6rem;line-height:1.45">Sauvegardez votre clé pour relire vos messages sur tous vos appareils. Stockée chiffrée — le serveur ne peut pas la lire.</p>
            <div id="e2e-vault-status" class="lbl-sm" style="margin-bottom:.5rem">…</div>
            <div style="display:flex;gap:.4rem;flex-wrap:wrap">
              <button class="btn sm" id="e2e-passkey-save">${icon("shield", 13)} Via passkey</button>
              <button class="btn sm" id="e2e-pin-save">${icon("lock", 13)} Code PIN</button>
              <button class="btn sm" id="e2e-pass-save">${icon("key", 13)} Passphrase</button>
              <button class="btn sm" id="e2e-restore">${icon("download", 13)} Restaurer</button>
            </div>
            <div style="padding-bottom:.6rem"></div>
          </div>

          <div class="acct-panel" id="acct-danger" role="tabpanel" hidden>
            <p class="lbl-sm" style="margin:.5rem 0 1rem;line-height:1.5">Ces actions sont irréversibles. Réfléchissez avant de continuer.</p>
            <div style="display:flex;flex-direction:column;gap:.6rem">
              <button class="btn sm" id="export-data">${icon("download", 14)} Exporter mes données (RGPD)</button>
              <button class="btn sm danger" id="delete-account">${icon("trash", 14)} Supprimer définitivement mon compte</button>
            </div>
            <div style="padding-bottom:.6rem"></div>
          </div>
        </div>
      </div>
    </div>`;
}
