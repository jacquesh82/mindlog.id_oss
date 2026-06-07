// Couche réseau/auth générique + socle crypto partagé. cf. docs/web-crypto-modules.md
import { host } from "./host.js";
import { appState } from "./state.js";
import { api, authHeaders, jsonAuth, setAccessKey } from "./net.js";
import { E2E, ECDH, _b64, _unb64, _b64url, _unb64url } from "./crypto/state.js";
import { ATT_PREFIX, attachEncryptUpload, attachDownloadDecrypt, attachPayload, parseAttachment } from "./crypto/attach.js";
import { ensureE2E, e2eEncrypt, e2eDecrypt } from "./crypto/e2e.js";
import { e2eVaultGet, e2eVaultPut, e2eSaveVault, e2eRestoreVault } from "./crypto/vault.js";
import { isRatchetCiphertext, rAesDec, rAesEnc, rConcat, rEq, rIdbGet, rIdbPut, rKdfCk, rKdfMk, rPublicOf, rRawPub, ratchetDecrypt, ratchetEnsurePrekeys, ratchetRecallSent, ratchetSend } from "./crypto/ratchet.js";
import { mdDecryptEnvelope, mdDeviceId, mdFanoutEncrypt, mdRecallSent, mdRegisterDevice, mdSelfDecrypt } from "./crypto/multidevice.js";
import { gApi, gAttachDownload, gAttachUpload, gLoadMessages, gRotate, gSendMessage, gSyncKeys } from "./crypto/groups.js";
import { groupDigits, safetyNumber, sha256hex, verifyClear, verifyGet, verifyPut } from "./crypto/verify.js";
import { CREDIT, LANG, RTL, langSelectHtml, setLangCode, t } from "./i18n.js";
import { confirmDialog, copyText, esc, promptDialog, promptPassphrase, promptPin, toast } from "./ui/dom.js";
import { SOCIALS, SOCIAL_BY_KEY, avatarHtml, branchNavSvg, genericAvatarSvg, icon, isSocialKey, miloSvg, socialFieldKey, socialIcon, socialUrl } from "./ui/icons.js";
import { ACCENTS, ACCENT_STORE, applyAccent, applyTheme, storedAccent, storedTheme, swatchesHtml, themeToggleHtml, toggleTheme } from "./theme.js";
import { openE2eBackup, openE2eRestore, openKeyRecovery, openSafetyNumber } from "./ui/modals.js";
import { addDeckColumn, deckState, removeDeckColumn } from "./editor/deck.js";
import { siteHeader } from "./ui/icons.js";
import { renderStatus } from "./views/status.js";
import { DEFAULT_AVAILABILITY, DEFAULT_SETTINGS, DOW_LETTERS, DOW_NAMES, SESSION_HINT, TOUR_SEEN_KEY, app, isLoggedIn, lastHandle, loadAuth, myHandle, myKey, normalizeAvailability, pick, relDate, setLastHandle, setMeProfile, setSessionHint, setStoredHandle, setStoredKey, storedHandle, storedKey, viewerHeaders } from "./core.js";
import { openContactColumn, renderPremiumFull, renderPrivate } from "./editor/index.js";
function setLang(code) { setLangCode(code); route(); }

const footer = document.getElementById("footer");

// Clé de site Cloudflare Turnstile (publique), injectée dans le HTML par le
// serveur. Vide si non configurée ou placeholder non substitué (dev sans .env).
const TURNSTILE_SITE_KEY =
  window.__TURNSTILE_SITE_KEY__ && !window.__TURNSTILE_SITE_KEY__.startsWith("%%")
    ? window.__TURNSTILE_SITE_KEY__
    : "";

/* ----------------------------------- i18n -------------------------------- */
// Socle traduit (7 langues) ; toute autre locale retombe sur l'anglais.
// Mode d'affichage de la landing : "public" (grand public, simplifié, par défaut)
// ou "expert" (vue complète, technique). Mémorisé localement.
const LANDING_MODE_STORE = "mindlog.landing_mode";
// Mode Geek temporairement désactivé — landing forcée en "public" (EASY) et
// switch masqué. Pour réactiver : restaurer le corps d'origine de landingMode()
// et landingModeSwitchHtml() (voir l'historique git).
function landingMode() {
  return "public";
}
function setLandingMode(_m) {
  // no-op tant que le switch est masqué
}
function landingModeSwitchHtml() {
  return "";
}

// Tarif Premium adapté au pays du visiteur. Le prix réel reste 1 € (Stripe en
// EUR côté serveur) ; l'affichage est traduit dans la devise locale pour
// réduire la friction perçue. Deux devises seulement : € pour l'Europe
// (géographique, UK et Suisse inclus), $ partout ailleurs.
// Le « per » est traduit selon la LANG i18n active.
function localPrice() {
  const full = (typeof navigator !== "undefined" && navigator.language) || "en-US";
  const region = (full.split("-")[1] || "").toUpperCase();
  const EUROPE = new Set([
    // UE
    "FR","DE","ES","IT","PT","NL","BE","AT","IE","FI","LU","GR","SK","SI","EE","LV","LT","CY","MT",
    "DK","SE","PL","CZ","HU","RO","BG","HR",
    // Reste de l'Europe géographique
    "GB","UK","CH","NO","IS","LI","MC","SM","VA","AD","AL","BA","MK","ME","RS","XK","MD","UA","BY","TR"
  ]);
  const per = LANG === "fr" ? "/mois" : "/month";
  const inEurope = EUROPE.has(region) || ["fr","de","es","it","pt","nl"].includes(LANG);
  if (inEurope) {
    return { primary: LANG === "fr" ? "1 €" : "€1", per, currency: "EUR" };
  }
  return { primary: "$1", per, currency: "USD" };
}

// Bascule de thème intégrée à la barre (landing) — remplace le bouton flottant.
const lpThemeToggleHtml = () =>
  `<button class="theme-toggle theme-toggle-header" id="lp-theme" type="button" aria-label="Changer de thème"></button>`;


// Applique le thème stocké au plus tôt (l'attribut a pu être posé en amont par le <head>).
applyTheme(storedTheme() || "dark");

// Stockage de la clé d'accès sur cet appareil (navigateur).

// Handle utilisé lors de la dernière connexion réussie — mémorisé même si la
// clé n'est pas conservée, pour pré-remplir le formulaire et tenter la reconnexion auto.

/* --------------------------- État d'authentification --------------------- */
// Source de vérité unique pour « qui suis-je ». Renseignée une fois via la sonde
// /api/session (cookie envoyé automatiquement). En mode lien /k/{clé} sans
// session, on retombe sur l'ancienne clé localStorage (compat / migration).
// Profil du compte connecté, partagé par le chip header de tous les écrans
// pour garantir un rendu identique (photo + nom) partout.
// Identité/clé du visiteur courant : session cookie d'abord, puis ancienne clé.
// En-têtes d'auth pour le visiteur : rien si session cookie, sinon la clé.

/* --------------------------------- Utils --------------------------------- */


// api() vit désormais dans net.js (importé en tête de fichier).

// Confirmation in-app (remplace window.confirm) — renvoie une Promise<boolean>.

// Saisie d'une passphrase (modale). `generate` pré-remplit une phrase forte.
// Renvoie la chaîne saisie, ou null si annulé.

// Saisie d'un code PIN (modale). Si `confirm=true`, demande deux fois pour créer.
// Renvoie la chaîne saisie, ou null si annulé.

// Sauvegarde rapide de la clé — propose PIN ou passphrase au choix.
// Modale de sauvegarde de la clé E2E. En mode `mandatory` (compte neuf : clé
// générée mais pas encore dans le coffre), elle est BLOQUANTE — pas de ✕, pas de
// fermeture au clic-fond — car sans coffre les messages sont perdus au moindre
// changement d'appareil. Si une passkey existe sur le compte, on propose le
// chemin « 1 geste » via PRF ; sinon PIN ou phrase secrète (toujours possibles).

// Modale de restauration de la clé E2E depuis le coffre (passkey, PIN ou passphrase).
// Workflow « clé manquante » : un message reste indéchiffrable car cet appareil
// ne possède pas la clé privée avec laquelle il a été scellé. On guide la
// récupération : (1) restaurer depuis le coffre (la clé d'un autre appareil y
// est peut-être) ; (2) sinon, sauvegarder la clé depuis l'appareil d'origine.




/* ----------------------- Temps réel (SSE) côté client -------------------- */
let _es = null;
let _esKey = null;
const _sse = { notif: new Set(), message: new Set(), ack: new Set(), signal: new Set(), device: new Set(), group: new Set() };
function connectSSE(key) {
  // key fourni → mode lien (?key=) ; null/undefined → mode session cookie.
  const tag = key || "cookie";
  if (_es && _esKey === tag) return;
  if (_es) _es.close();
  _esKey = tag;
  const url = key ? `/api/events?key=${encodeURIComponent(key)}` : "/api/events";
  _es = new EventSource(url, { withCredentials: true });
  ["notif", "message", "ack", "signal", "device", "group"].forEach((ev) =>
    _es.addEventListener(ev, (e) => {
      let d = {};
      try {
        d = JSON.parse(e.data);
      } catch {}
      _sse[ev].forEach((fn) => fn(d));
    })
  );
}
const onSSE = (type, fn) => {
  _sse[type].add(fn);
  return () => _sse[type].delete(fn);
};

// Chiffrement E2E v1 (ECDH) déplacé dans crypto/e2e.js ; coffre de clé déplacé
// dans crypto/vault.js — importés en tête de fichier.

// Double Ratchet + X3DH déplacé dans crypto/ratchet.js ; fan-out multi-appareils
// dans crypto/multidevice.js — importés en tête de fichier.

// Numéro de sécurité (crypto + API verify) déplacé dans crypto/verify.js ;
// le modal openSafetyNumber reste ci-dessous. Imports en tête.

/** Modal du numéro de sécurité : 60 chiffres + QR + bouton vérifier/retirer. */

// Pièces jointes chiffrées : déplacées dans crypto/attach.js (ATT_PREFIX,
// attachEncryptUpload, attachDownloadDecrypt, attachPayload, parseAttachment) —
// importées en tête de fichier.

// Groupes (sender keys) déplacés dans crypto/groups.js — importés en tête.

/* ----------- Milo dans le logo : palette de couleurs au survol ----------- */
let _brandPalette = null;
let _brandHideT = null;
let _brandFlashT = null;
// Buffer autour de la palette (et du logo) : tant que le curseur est dans cette
// zone étendue, on ne ferme pas. Évite les fermetures intempestives quand on
// traverse le gap entre le logo et la palette, ou si la souris frôle un coin.
const BRAND_PALETTE_BUFFER = 48; // px
let _brandMoveBound = false;
function _isCursorNearPalette(clientX, clientY) {
  if (!_brandPalette) return false;
  const inflate = (r) => ({
    left: r.left - BRAND_PALETTE_BUFFER,
    right: r.right + BRAND_PALETTE_BUFFER,
    top: r.top - BRAND_PALETTE_BUFFER,
    bottom: r.bottom + BRAND_PALETTE_BUFFER,
  });
  const inRect = (r) => clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  if (inRect(inflate(_brandPalette.getBoundingClientRect()))) return true;
  // Le logo Milo aussi : permet de revenir sur le logo sans fermer.
  const bm = document.querySelector(".brand-milo");
  if (bm && inRect(inflate(bm.getBoundingClientRect()))) return true;
  return false;
}
function _onBrandMouseMove(e) {
  if (!_brandPalette || !_brandPalette.classList.contains("show")) return;
  if (_isCursorNearPalette(e.clientX, e.clientY)) {
    clearTimeout(_brandHideT);
    clearTimeout(_brandFlashT);
  } else if (!_brandHideT) {
    _brandHideSoon();
  }
}
function _bindBrandMove() {
  if (_brandMoveBound) return;
  _brandMoveBound = true;
  document.addEventListener("mousemove", _onBrandMouseMove, { passive: true });
}
function _ensureBrandPalette() {
  if (_brandPalette) return _brandPalette;
  _brandPalette = document.createElement("div");
  _brandPalette.className = "milo-palette brand-palette";
  _brandPalette.innerHTML = swatchesHtml() + themeToggleHtml();
  document.body.appendChild(_brandPalette);
  _brandPalette.querySelectorAll(".swatch").forEach((s) =>
    s.addEventListener("click", () => {
      applyAccent(s.dataset.accent);
      try {
        localStorage.setItem(ACCENT_STORE, s.dataset.accent);
      } catch {}
      // Interaction = intention claire : on garde la palette ouverte un peu.
      clearTimeout(_brandFlashT);
      clearTimeout(_brandHideT);
    })
  );
  _brandPalette.querySelector(".theme-toggle").addEventListener("click", () => {
    toggleTheme();
    clearTimeout(_brandFlashT);
    clearTimeout(_brandHideT);
  });
  applyTheme(storedTheme() || "dark"); // synchronise l'icône du bouton
  _brandPalette.addEventListener("mouseenter", () => {
    clearTimeout(_brandHideT);
    clearTimeout(_brandFlashT);
  });
  // mouseleave : on délègue désormais à mousemove + buffer (plus tolérant).
  _bindBrandMove();
  return _brandPalette;
}
function _brandHideSoon() {
  clearTimeout(_brandHideT);
  _brandHideT = setTimeout(() => {
    if (_brandPalette) _brandPalette.classList.remove("show");
    _brandHideT = null;
  }, 600);
}
function _positionBrandPaletteAt(bm) {
  const p = _ensureBrandPalette();
  applyAccent(storedAccent() || ACCENTS[0].v); // (re)marque le swatch actif
  const r = bm.getBoundingClientRect();
  p.style.top = r.bottom + window.scrollY + 8 + "px";
  p.style.left = r.left + window.scrollX + "px";
  return p;
}
/** Une seule fois par chargement de page : si tu reviens sur la landing en
 *  navigant (popstate), on ne re-flash pas — c'était un teaser, pas un pop-up. */
let _brandFlashedOnce = false;
function maybeFlashBrandPaletteOnLanding() {
  if (_brandFlashedOnce) return;
  _brandFlashedOnce = true;
  // Attend que .brand-milo soit rendu dans le DOM par le siteHeader.
  requestAnimationFrame(() => flashBrandPalette({ delay: 600, hold: 2000 }));
}
/** Auto-flash de la palette (option « waouh caméléon » sur la landing). */
function flashBrandPalette({ delay = 600, hold = 2000 } = {}) {
  clearTimeout(_brandFlashT);
  _brandFlashT = setTimeout(() => {
    const bm = document.querySelector(".brand-milo");
    if (!bm) return;
    const p = _positionBrandPaletteAt(bm);
    p.classList.add("show");
    clearTimeout(_brandHideT);
    _brandFlashT = setTimeout(() => p.classList.remove("show"), hold);
  }, delay);
}
function setupBrandMilo() {
  if (setupBrandMilo._on) return;
  setupBrandMilo._on = true;
  document.addEventListener("mouseover", (e) => {
    const bm = e.target.closest && e.target.closest(".brand-milo");
    if (!bm) return;
    const p = _positionBrandPaletteAt(bm);
    p.classList.add("show");
    clearTimeout(_brandHideT);
    clearTimeout(_brandFlashT);
  });
  document.addEventListener("mouseout", (e) => {
    if (e.target.closest && e.target.closest(".brand-milo")) _brandHideSoon();
  });
  // Cliquer sur Milo (et non sur le texte de la marque) ouvre la page publique
  // de l'utilisateur s'il est connecté, sinon celle de Milo (présentation).
  document.addEventListener("click", (e) => {
    if (e.target.closest && e.target.closest(".brand-milo")) {
      e.preventDefault();
      e.stopPropagation();
      const myH = appState.auth?.handle || myHandle?.();
      location.assign(myH ? `/@${encodeURIComponent(myH)}` : "/@milo");
    }
  });
}

function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

function fmtRange(start, end) {
  if (!end) return fmtDate(start);
  const e = new Date(end);
  if (isNaN(e)) return fmtDate(start);
  return `${fmtDate(start)} – ${e.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

/* ------------------------------- Calendrier ------------------------------ */
// Le calendrier et la demande de RDV sont fournis par le plugin
// `public/plugins/calendar.js` (registre de plugins) et exposés via
// `host.calendar = { html, wire, openBooking, fmtDay, defaultStatus }`.

function valueHtml(key, value) {
  if (!value) return '<span class="v" style="color:var(--muted)">—</span>';
  if (key === "email") return `<span class="v"><a href="mailto:${esc(value)}">${esc(value)}</a></span>`;
  if (key === "website" || /^https?:\/\//.test(value))
    return `<span class="v"><a href="${esc(value)}" target="_blank" rel="noopener">${esc(value)}</a></span>`;
  return `<span class="v">${esc(value)}</span>`;
}


// URL de production.
const PROD_URL = "id.mindlog.today";
const GITHUB_URL = "https://github.com/jacquesh82/mindlog.id";

// Configurations MCP pour un client (Claude Desktop/Code, ChatGPT, Cursor…).
// Cloud : connecteur distant vers l'instance hébergée. Self : serveur local (stdio).
const MCP_CONFIG_CLOUD = `{
  "mcpServers": {
    "mindlog-id": {
      "url": "https://${PROD_URL}/mcp",
      "headers": { "Authorization": "Bearer VOTRE_CLÉ_D_ACCÈS" }
    }
  }
}`;
const MCP_CONFIG_SELF = `{
  "mcpServers": {
    "mindlog-id": {
      "command": "npx",
      "args": ["tsx", "src/mcp.ts"],
      "cwd": "/chemin/vers/id.mindlog.today"
    }
  }
}`;
const MCP_CONFIGS = { cloud: MCP_CONFIG_CLOUD, self: MCP_CONFIG_SELF };


// Bloc compte unifié, présent dans le header de tous les écrans :
// chip profil (lien vers /me) + bouton de déconnexion quand on est connecté.
// opts.photoSrc / opts.name : enrichissent le chip (utilisé par l'éditeur).
function headerAccount(unread = 0) {
  const h = myHandle();
  if (!(isLoggedIn() && h)) return "";
  const photoSrc = appState.me.hasPhoto
    ? `/api/identities/${encodeURIComponent(h)}/photo?ts=${appState.me.photoTs}`
    : null;
  const initial = (h[0] || "?").toUpperCase();
  const avHtml = photoSrc
    ? `<img class="profile-chip-av" src="${esc(photoSrc)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="profile-chip-av profile-chip-svg" style="display:none">${genericAvatarSvg(h, initial)}</div>`
    : `<div class="profile-chip-av profile-chip-svg">${genericAvatarSvg(h, initial)}</div>`;
  return `<div class="profile-menu-wrap">
    <button class="profile-chip" id="profile-menu-btn" type="button" aria-expanded="false" aria-haspopup="menu">
      ${avHtml}
      <div class="profile-chip-info">
        <span class="profile-chip-handle">@${esc(h)}</span>
        ${appState.me.name ? `<span class="profile-chip-name">${esc(appState.me.name)}</span>` : ""}
      </div>
      <span class="chip-notif-dot" id="chip-notif-dot" ${unread ? "" : "hidden"}>${unread || ""}</span>
    </button>
    <div class="profile-menu" id="profile-menu" role="menu">
      <button class="pmenu-item" id="pmenu-profil" role="menuitem" type="button">${icon("user", 15)} Mon profil</button>
      ${location.pathname.startsWith("/@") ? `<button class="pmenu-item" id="pmenu-edit" role="menuitem" type="button">${icon("home", 15)} Revenir à l'application</button>` : ""}
      <button class="pmenu-item" id="pmenu-premium" role="menuitem" type="button">${icon("sparkles", 15)} Mes Espaces</button>
      <button class="pmenu-item" id="pmenu-theme" role="menuitem" type="button">${storedTheme() === "light" ? icon("moon", 15) + " Mode sombre" : icon("sun", 15) + " Mode clair"}</button>
      <button class="pmenu-item" id="pmenu-notifs" role="menuitem" type="button">${icon("bell", 15)} Notifications</button>
      <button class="pmenu-item" id="pmenu-options" role="menuitem" type="button">${icon("settings", 15)} Options</button>
      <div class="pmenu-sep" role="separator"></div>
      <button class="pmenu-item pmenu-danger" data-action="logout" role="menuitem" type="button">${icon("key", 15)} ${t("nav_logout")}</button>
    </div>
  </div>`;
}

// Déconnexion câblée une seule fois, en délégation : fonctionne pour tout
// bouton [data-action="logout"] présent dans n'importe quel header.
let _logoutWired = false;
function wireGlobalLogout() {
  if (_logoutWired) return;
  _logoutWired = true;
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action='logout']");
    if (!btn) return;
    e.preventDefault();
    try {
      await api("/api/auth/logout", { method: "POST", headers: jsonAuth() });
    } catch {}
    setSessionHint(false);
    setStoredKey(null);
    setStoredHandle(null);
    appState.auth = null;
    appState.authPromise = null;
    location.assign("/");
  });
}

const _pmenu = {
  getWrap:  () => document.querySelector(".profile-menu-wrap"),
  getBtn:   () => document.getElementById("profile-menu-btn"),
  isOpen:   () => !!document.querySelector(".profile-menu-wrap.open"),
  open()  { this.getWrap()?.classList.add("open");    this.getBtn()?.setAttribute("aria-expanded", "true");  },
  close() { this.getWrap()?.classList.remove("open"); this.getBtn()?.setAttribute("aria-expanded", "false"); },
  toggle(){ this.isOpen() ? this.close() : this.open(); },
};

let _profileMenuWired = false;
function wireProfileMenu() {
  if (_profileMenuWired) return;
  _profileMenuWired = true;

  // capture:true → avant tout stopPropagation des listeners enfants
  document.addEventListener("click", (e) => {
    if (e.target.closest("#profile-menu-btn")) { _pmenu.toggle(); return; }
    // Hors éditeur (homepage /@h, /me/premium, etc.), `__deckGoLabel` n'existe
    // pas → on navigue vers /me en posant un indice d'onglet via sessionStorage
    // (lu par setupTabs dans editor/index.js → ouvre le bon onglet au montage).
    const goTab = (label) => {
      if (window.__deckGoLabel) window.__deckGoLabel(label);
      else {
        try { sessionStorage.setItem("mindlog.openTab", label); } catch {}
        location.assign("/me");
      }
    };
    if (e.target.closest("#pmenu-profil")) {
      // « Mon profil » = colonne « Identité » de l'éditeur (édition de la carte :
      // intro Markdown, attributs, réseaux). C'est la vue côté propriétaire.
      // La page publique est accessible via le bouton « Voir ↗ » dans la colonne.
      _pmenu.close();
      goTab("Identité");
      return;
    }
    if (e.target.closest("#pmenu-edit")) {
      // Retour à l'éditeur /me : si déjà sur /me, no-op ; sinon navigation.
      _pmenu.close();
      if (location.pathname !== "/me") location.assign("/me");
      return;
    }
    if (e.target.closest("#pmenu-notifs")) {
      const bell = document.getElementById("notif-bell");
      if (bell) bell.click();
      else goTab("Notifications");
      _pmenu.close(); return;
    }
    if (e.target.closest("#pmenu-options")) { goTab("Options"); _pmenu.close(); return; }
    if (e.target.closest("#pmenu-premium")) { _pmenu.close(); location.assign("/me/premium"); return; }
    if (!e.target.closest(".profile-menu-wrap")) _pmenu.close();
  }, true);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && _pmenu.isOpen()) { _pmenu.close(); _pmenu.getBtn()?.focus(); }
  });
}

// Câble le bouton directement après chaque rendu (fallback si delegation bloquée)
function wireProfileMenuBtn() {
  document.getElementById("profile-menu-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    _pmenu.toggle();
  });
  // Listener direct sur le bouton thème (plus fiable que la délégation capture)
  const themeBtn = document.getElementById("pmenu-theme");
  themeBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleTheme();
    themeBtn.innerHTML = storedTheme() === "light"
      ? icon("moon", 15) + " Mode sombre"
      : icon("sun", 15) + " Mode clair";
    _pmenu.close();
  });
}

// Barre de recherche compacte pour les headers hors landing.
function headerSearchHtml() {
  return `<div class="hdr-search" id="hdr-search">
    <form class="hdr-search-box" id="hdr-search-form" role="search" autocomplete="off">
      ${icon("search", 15)}
      <input id="hdr-q" type="search" placeholder="Rechercher une identité…" autocomplete="off" aria-label="Rechercher une identité" />
      <kbd class="hdr-kbd" aria-hidden="true">/</kbd>
    </form>
    <div class="hdr-results" id="hdr-results" hidden></div>
  </div>`;
}

// Branche les événements de la barre de recherche du header.
// À appeler après chaque renderXxx() qui injecte headerSearchHtml().
function wireHeaderSearch() {
  const wrap = document.getElementById("hdr-search");
  if (!wrap) return;
  const input = wrap.querySelector("#hdr-q");
  const results = wrap.querySelector("#hdr-results");
  let timer;

  const renderHdrResults = (list) => {
    if (!input.value.trim()) { results.hidden = true; return; }
    if (!list.length) {
      results.innerHTML = `<div class="no">Aucun résultat.</div>`;
      results.hidden = false;
      return;
    }
    results.innerHTML = list.map(r => `
      <a class="result" href="/@${encodeURIComponent(r.handle)}">
        ${avatarHtml(r.handle, r.has_photo, "av")}
        <span class="meta">
          <div class="nm">${esc(r.display_name || r.handle)}</div>
          <div class="hd">@${esc(r.handle)}${r.title ? " · " + esc(r.title) : ""}</div>
        </span>
      </a>`).join("");
    results.hidden = false;
  };

  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    wrap.classList.toggle("has-value", !!q);
    if (!q) { results.hidden = true; return; }
    timer = setTimeout(async () => {
      try {
        const { results: list } = await api(`/api/search?q=${encodeURIComponent(q)}`);
        renderHdrResults(list);
      } catch { /* silencieux */ }
    }, 200);
  });

  wrap.querySelector("#hdr-search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const first = results.querySelector(".result");
    if (first) location.assign(first.getAttribute("href"));
  });

  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) results.hidden = true;
  }, { capture: true });

  // Raccourci « / » : focus la recherche (sauf si on tape déjà dans un champ).
  // Échap : ferme les résultats et rend le focus.
  if (!document.body.dataset.hdrSearchKeys) {
    document.body.dataset.hdrSearchKeys = "1";
    document.addEventListener("keydown", (e) => {
      const q = document.getElementById("hdr-q");
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const el = document.activeElement;
        const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
        if (!typing && q) { e.preventDefault(); q.focus(); }
      } else if (e.key === "Escape" && document.activeElement === q) {
        q.value = ""; q.dispatchEvent(new Event("input")); q.blur();
      }
    });
  }
}

/* --------------------------------- Routeur ------------------------------- */

function route() {
  const path = decodeURIComponent(location.pathname);
  const paidPage = path.match(/^\/@([^/]+)\/p\/(.+)$/); // page payante : /@handle/p/slug
  const spaceIndex = path.match(/^\/@([^/]+)\/space$/); // index espace privé : /@handle/space
  const profile = path.match(/^\/@(.+)$/);
  const priv = path.match(/^\/k\/(.+)$/);
  const invite = path.match(/^\/i\/(.+)$/);
  footer.innerHTML = "";
  deckState.index = 0; // chaque vue démarre sur le 1er panneau
  if (invite) {
    app.dataset.view = "invite";
    return renderInvite(invite[1]);
  }
  if (path === "/status") {
    app.dataset.view = "status";
    return renderStatus();
  }
  if (path === "/me/premium") {
    // Page « Espace Premium » plein écran (vraie page, back natif).
    app.dataset.view = "premium";
    return renderPremiumFull();
  }
  if (path === "/me") {
    // Espace privé authentifié par cookie de session (aucune clé dans l'URL).
    app.dataset.view = "private";
    return renderPrivate(null);
  }
  if (priv) {
    app.dataset.view = "private";
    return renderPrivate(priv[1]);
  }
  if (spaceIndex) {
    app.dataset.view = "spaceindex";
    return renderSpaceIndex(spaceIndex[1]);
  }
  if (paidPage) {
    app.dataset.view = "paidpage";
    return renderPaidPage(paidPage[1], paidPage[2]);
  }
  if (profile) {
    app.dataset.view = "profile";
    return renderPublicProfile(profile[1]);
  }
  app.dataset.view = "landing";
  return renderLanding();
}

/* ============================== INVITATION =============================== */
// Page d'acceptation d'une invitation de contact (lien/QR `/i/<token>`), sans
// passer par l'annuaire. À l'acceptation, relation mutuelle créée côté serveur.
const PENDING_INVITE = "mindlog.pendingInvite";

async function renderInvite(token) {
  let preview = null;
  try { preview = await api(`/api/invites/${encodeURIComponent(token)}`); } catch {}
  await loadAuth();
  const logged = isLoggedIn();
  if (!preview) {
    app.innerHTML = `<section class="card" style="max-width:460px;margin:3rem auto;text-align:center">
      <h2>Invitation invalide</h2>
      <p class="sub">Ce lien d'invitation est invalide, a déjà été utilisé ou a expiré.</p>
      <a class="btn primary" href="/">Retour à l'accueil</a></section>`;
    return;
  }
  const av = avatarHtml(preview.handle, preview.has_photo, "avatar-lg");
  const name = preview.display_name || "@" + preview.handle;
  app.innerHTML = `<section class="card" style="max-width:460px;margin:3rem auto;text-align:center">
      <h2>Invitation de contact</h2>
      <div style="margin:1rem auto">${av}</div>
      <p><strong>${esc(name)}</strong> <span class="deg">@${esc(preview.handle)}</span></p>
      <p class="sub">vous invite à devenir contact (messagerie chiffrée de bout en bout).</p>
      <div class="actions" id="inv-actions" style="justify-content:center;margin-top:1rem"></div></section>`;
  const actions = app.querySelector("#inv-actions");
  if (logged) {
    actions.innerHTML = `<a class="btn" href="/">Annuler</a><button class="btn primary" id="inv-accept">Accepter l'invitation</button>`;
    actions.querySelector("#inv-accept").addEventListener("click", async () => {
      try {
        await api(`/api/invites/${encodeURIComponent(token)}/accept`, { method: "POST", headers: { "Content-Type": "application/json", ...viewerHeaders() } });
        toast(`Vous êtes maintenant en contact avec @${preview.handle} 🎉`);
        location.assign(appState.auth ? "/me" : "/k/" + encodeURIComponent(myKey()));
      } catch (e) { toast(e.message || "Échec de l'acceptation"); }
    });
  } else {
    try { sessionStorage.setItem(PENDING_INVITE, token); } catch {}
    actions.innerHTML = `<a class="btn primary" href="/">Se connecter ou créer ma page</a>`;
    app.querySelector("section").insertAdjacentHTML("beforeend",
      `<p class="sub" style="margin-top:.8rem">Connectez-vous ou créez votre page : l'invitation sera acceptée automatiquement.</p>`);
  }
}

// Après authentification, accepte une invitation en attente (lien ouvert déconnecté).

/* ================================ LANDING ================================ */

// Indice (non secret) marquant qu'une session cookie existe probablement, pour
// décider d'afficher l'écran « Reconnexion… ». Le cookie httpOnly n'étant pas
// lisible par le JS, cet indice évite un appel/flash inutile aux visiteurs anonymes.
const sessionHint = () => {
  try {
    return localStorage.getItem(SESSION_HINT) === "1";
  } catch {
    return false;
  }
};

// Reconnexion automatique : on tente d'abord la session cookie (GET /api/me,
// cookie envoyé automatiquement), puis on retombe sur une éventuelle ancienne
// clé mémorisée en localStorage. Une seule tentative par chargement.
let _autoReconnectTried = false;
async function tryAutoReconnect() {
  _autoReconnectTried = true;
  // 1) Session par cookie.
  try {
    const s = await api("/api/session"); // vérification légère — /me chargera /api/me
    if (!s.authenticated) throw new Error("no session");
    setLastHandle(s.handle);
    setSessionHint(true);
    location.replace("/me");
    return true;
  } catch {
    setSessionHint(false); // pas (ou plus) de session valide
  }
  // 2) Repli : ancienne clé d'accès mémorisée en localStorage.
  const key = storedKey();
  if (key) {
    try {
      const data = await api("/api/me", { headers: { "x-access-key": key } });
      setStoredHandle(data.handle);
      setLastHandle(data.handle);
      location.replace(`/k/${encodeURIComponent(key)}`);
      return true;
    } catch {
      setStoredKey(null);
      setStoredHandle(null);
    }
  }
  return false;
}

// Colonne « démo » de l'accueil : chat E2E et chat IA animés (GSAP).
// Les contenus sont des exemples ludiques, non interactifs (aperçu marketing).
function showcaseColHtml() {
  const bubble = (cls, html) => `<div class="bubble ${cls}">${html}</div>`;

  // Onglets segmentés : une démo affichée à la fois, animée à la sélection.
  const tab = (id, ic, label, active) =>
    `<button class="show-tab${active ? " active" : ""}" data-show-tab="${id}" role="tab" aria-selected="${active}">${icon(ic, 15)} ${esc(label)}</button>`;

  const chatPanel = `<div class="show-panel" data-show="chat">
      <div class="show-card-head">${icon("chat", 18)}<h3>${t("show_chat_t")}</h3></div>
      <p class="show-d">${t("show_chat_d")}</p>
      <div class="phone">
        <div class="phone-bar"><span class="e2e-badge">${t("show_e2e_badge")}</span><span class="ttl-badge">${t("show_chat_ttl")}</span></div>
        <div class="thread" id="demo-chat">
          ${bubble("in", esc(t("show_chat_a1")))}
          ${bubble("out", esc(t("show_chat_b1")))}
          ${bubble("in", esc(t("show_chat_a2")))}
        </div>
      </div>
    </div>`;

  const aiPanel = `<div class="show-panel" data-show="ai" hidden>
      <div class="show-card-head">${icon("plug", 18)}<h3>${t("show_ai_t")}</h3></div>
      <p class="show-d">${t("show_ai_d")}</p>
      <div class="thread ai" id="demo-ai">
        ${bubble("out", esc(t("show_ai_u1")))}
        ${bubble("in milo", `<span class="milo-tag">🦎 Milo</span>${esc(t("show_ai_m1"))}<span class="tool-chip">${icon("plug", 12)} get_availability · request_meeting</span>`)}
        ${bubble("out", esc(t("show_ai_u2")))}
        ${bubble("in milo", `<span class="milo-tag">🦎 Milo</span>${esc(t("show_ai_m2"))}`)}
      </div>
    </div>`;

  return `<section class="showcase">
    <div class="show-head"><div class="ic">${icon("sparkles")}</div><h2>${t("show_h")}</h2></div>
    <div class="show-tabs" role="tablist">
      ${tab("chat", "chat", t("show_tab_chat"), true)}
      ${tab("ai", "plug", t("show_tab_ai"), false)}
    </div>
    <div class="show-stage">
      ${chatPanel}${aiPanel}
    </div>
  </section>`;
}

// Joue l'animation de la démo active (bulles de chat qui « tapent » l'une après
// l'autre). Rejouée à chaque changement d'onglet.
function playShowcasePanel(which) {
  const g = window.gsap;
  if (!g || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const sel = which === "chat" ? "#demo-chat" : "#demo-ai";
  const bubbles = [...app.querySelectorAll(`${sel} .bubble`)];
  if (!bubbles.length) return;
  const tl = g.timeline({ delay: 0.2 });
  bubbles.forEach((b) => tl.set(b, { opacity: 0, y: 12, scale: 0.96 }));
  bubbles.forEach((b, i) => tl.to(b, { opacity: 1, y: 0, scale: 1, duration: 0.45, ease: "power3.out" }, i === 0 ? ">" : ">0.7"));
}

// Câble les onglets de la colonne démo (Chat · IA) et anime le panneau
// initial. Une seule démo visible à la fois ; la sélection rejoue l'animation.
function wireShowcase() {
  const tabs = [...app.querySelectorAll(".show-tab")];
  const panels = [...app.querySelectorAll(".show-panel")];
  if (!tabs.length) return;
  const activate = (which) => {
    tabs.forEach((tb) => {
      const on = tb.dataset.showTab === which;
      tb.classList.toggle("active", on);
      tb.setAttribute("aria-selected", String(on));
    });
    panels.forEach((p) => (p.hidden = p.dataset.show !== which));
    playShowcasePanel(which);
  };
  tabs.forEach((tb) => tb.addEventListener("click", () => activate(tb.dataset.showTab)));
  playShowcasePanel("chat"); // panneau actif au premier rendu
}

// Section « Tarifs & licence » : modèle double licence (AGPLv3 / commerciale),
// intégrée dans le flux de la landing (plus de page /pricing dédiée).
function pricingColHtml() {
  const plan = (cls, tag, title, price, li, href, cta, ctaCls, blank) =>
    `<div class="pr-plan${cls}">
      <span class="pr-tag">${t(tag)}</span>
      <h3>${t(title)}</h3>
      <div class="pr-price">${t(price)}</div>
      <ul>${t(li)}</ul>
      <a class="pr-cta${ctaCls}" href="${href}"${blank ? ' target="_blank" rel="noopener"' : ""}>${t(cta)}</a>
    </div>`;
  return `<section class="pricing">
    <div class="show-head"><div class="ic">${icon("tag")}</div><h2>${t("price_h")}</h2></div>
    <p class="pr-lead">${t("price_lead")}</p>
    <div class="pr-grid">
      ${plan("", "pr1_tag", "pr1_t", "pr1_price", "pr1_li", GITHUB_URL, "pr1_cta", " ghost", true)}
      ${plan(" feat", "pr2_tag", "pr2_t", "pr2_price", "pr2_li", "mailto:milo@mindlog.today?subject=Licence%20commerciale%20mindlog%C2%B7id", "pr2_cta", "", false)}
      ${plan("", "pr3_tag", "pr3_t", "pr3_price", "pr3_li", "mailto:milo@mindlog.today?subject=Offre%20entreprise%20mindlog%C2%B7id", "pr3_cta", " ghost", false)}
    </div>
    <div class="pr-info">
      <h3>${t("price_why_h")}</h3>
      <p>${t("price_why_d")}</p>
      <h3>${t("price_contact_h")}</h3>
      <p>${t("price_contact_d")}</p>
    </div>
  </section>`;
}

// Offre grand public : Découverte (gratuit) vs Premium (1 €/mois · ≈ 1,20 $/mois).
// Le Premium débloque la personnalisation de la page publique (photo/vidéo de
// couverture, boutons positionnables, galerie cliquable vers des liens). Affichée
// sur l'accueil en mode Easy ET Geek ; les CTA mènent à la création de page
// (l'abonnement se gère ensuite dans l'espace connecté).
function consumerPricingHtml() {
  const lp = localPrice();
  // Premium : prix + « per » + équivalent dans l'autre devise, tous adaptés au
  // pays détecté (cf. localPrice). Découverte : libellé i18n « Gratuit ».
  const planFree = `<div class="pr-plan">
    <span class="pr-tag">${t("cpr_free_tag")}</span>
    <h3>${t("cpr_free_t")}</h3>
    <div class="pr-price">${t("cpr_free_price")}</div>
    <ul>${t("cpr_free_li")}</ul>
    <button type="button" class="pr-cta ghost" id="cpr-free-cta">${t("cpr_free_cta")}</button>
  </div>`;
  const planPrem = `<div class="pr-plan feat">
    <span class="pr-tag">${t("cpr_prem_tag")}</span>
    <h3>${t("cpr_prem_t")}</h3>
    <div class="pr-price">${lp.primary}<span class="pr-per">${lp.per}</span></div>
    <ul>${t("cpr_prem_li")}</ul>
    <button type="button" class="pr-cta" id="cpr-prem-cta">${t("cpr_prem_cta")}</button>
  </div>`;
  return `<section class="pricing">
    <div class="show-head"><div class="ic">${icon("tag")}</div><h2>${t("cpr_h")}</h2></div>
    <p class="pr-lead">${t("cpr_lead")}</p>
    <div class="pr-grid pr-grid--duo">
      ${planFree}
      ${planPrem}
    </div>
  </section>`;
}

// Section « Clients & universalité » : une carte par surface (web/Android/iOS/
// Desktop/MCP). Le bloc whitepaper crypto a été retiré (juin 2026) — recouvert
// par la section Souveraineté + le bandeau anti-interception P2P.
function clientsColHtml() {
  const card = (ic, name, statusKey, statusCls, descKey) =>
    `<div class="cl-card ${statusCls}">
       <div class="cl-card-head"><span class="ic">${icon(ic, 18)}</span><h3>${esc(name)}</h3><em>${t(statusKey)}</em></div>
       <p>${t(descKey)}</p>
     </div>`;
  return `<section class="clients-sec">
    <div class="show-head"><div class="ic">${icon("smartphone")}</div><h2>${t("clients_h2")}</h2></div>
    <p class="cl-lead">${t("clients_lead")}</p>
    <div class="cl-grid">
      ${card("plug", "Web", "cli_live", "is-live", "cl_web_d")}
      ${card("smartphone", "Android", "cli_live", "is-live", "cl_android_d")}
      ${card("smartphone", "iOS", "cli_soon", "is-soon", "cl_ios_d")}
      ${card("code", "Desktop · Tauri", "cli_beta", "is-beta", "cl_desktop_d")}
      ${card("plug", "AI · MCP", "cli_live", "is-live", "cl_mcp_d")}
    </div>

    <div class="cl-uni">
      <div class="ic">${icon("shield", 18)}</div>
      <div>
        <h3>${t("clients_uni_h")}</h3>
        <p>${t("clients_uni_d")}</p>
      </div>
    </div>

  </section>`;
}

// Colonne « Souveraineté » : 4 piliers + comparatif nommé (mindlog vs autres).
// Symboles ✓/~/✗ (la forme porte le sens, pas seulement la couleur — a11y).
function sovereignColHtml() {
  const pillar = (ic, emoji, tt, dd) =>
    `<div class="pillar"><span class="pic">${emoji || icon(ic, 18)}</span><h3>${t(tt)}</h3><p>${t(dd)}</p></div>`;
  const sym = {
    y: '<span class="ok">✓</span>',
    p: '<span class="part">~</span>',
    n: '<span class="no">✗</span>',
  };
  // Tableau « fonctionnalités (lignes) × produits (colonnes) ». La 1re colonne
  // produit (mindlog) est mise en valeur via la classe .me sur ses cellules.
  const cmpTable = (products, rows) => {
    const head = products
      .map((p, i) => `<th scope="col"${i === 0 ? ' class="me"' : ""}>${esc(p)}</th>`)
      .join("");
    const body = rows
      .map(
        ([labelKey, vals]) =>
          `<tr><th scope="row">${t(labelKey)}</th>${vals
            .map((v, i) => `<td${i === 0 ? ' class="me"' : ""}>${sym[v]}</td>`)
            .join("")}</tr>`
      )
      .join("");
    return `<div class="sov-table-wrap"><table class="sov-table"><thead><tr><th scope="col"></th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  };

  // Côté « page d'identité » (link-in-bio / carte de visite).
  const idTable = cmpTable(
    ["mindlog · id", "Linktree", "Carrd", "HiHello", "Popl"],
    [
      ["cmpf_page", ["y", "y", "y", "y", "y"]],
      ["cmpf_card", ["y", "p", "p", "y", "y"]],
      ["feat_agenda_t", ["y", "n", "n", "n", "n"]],
      ["feat_rdv_t", ["y", "n", "n", "n", "n"]],
      ["feat_rel_t", ["y", "n", "n", "n", "n"]],
      ["feat_call_t", ["y", "n", "n", "n", "n"]],
      ["cmpf_ai", ["y", "n", "n", "n", "n"]],
      ["sov_c_fr", ["y", "n", "n", "n", "n"]],
      ["sov_c_oss", ["y", "n", "n", "n", "n"]],
      ["sov_c_priv", ["y", "n", "n", "n", "n"]],
    ]
  );

  // Côté « messagerie » (chat/appels chiffrés).
  const msgTable = cmpTable(
    ["mindlog · id", "WhatsApp", "Signal", "Telegram", "Olvid"],
    [
      ["cmpf_chat", ["y", "y", "y", "p", "y"]],
      ["cmpf_call", ["y", "y", "y", "y", "y"]],
      ["cmpf_fs", ["y", "y", "y", "p", "y"]],
      ["cmpf_verify", ["y", "y", "y", "p", "y"]],
      ["cmpf_group", ["y", "y", "y", "p", "y"]],
      ["cmpf_once", ["y", "y", "n", "n", "y"]],
      ["cmpf_invite", ["y", "n", "n", "p", "y"]],
      ["cmpf_nophone", ["y", "n", "n", "n", "y"]],
      ["sov_c_fr", ["y", "n", "n", "n", "y"]],
      ["sov_c_oss", ["y", "n", "y", "p", "p"]],
      ["sov_c_priv", ["y", "n", "y", "n", "y"]],
      ["cmpf_page", ["y", "n", "n", "n", "n"]],
      ["feat_agenda_t", ["y", "n", "n", "n", "n"]],
      ["cmpf_ai", ["y", "n", "n", "n", "n"]],
    ]
  );

  return `<section class="sovereign">
    <div class="sov-head"><div class="ic">${icon("shield")}</div><h2>${t("sov_h")}</h2></div>
    <p class="sov-lead">${t("sov_lead")}</p>
    <div class="pillars">
      ${pillar(null, "🇫🇷", "sov_p1_t", "sov_p1_d")}
      ${pillar("lock", null, "sov_p2_t", "sov_p2_d")}
      ${pillar("code", null, "sov_p3_t", "sov_p3_d")}
      ${pillar("eye-off", null, "sov_p4_t", "sov_p4_d")}
    </div>
    <h3 class="sov-cmp-h">${t("sov_cmp_h")}</h3>
    <div class="sov-tabs" role="tablist">
      <button class="sov-tab active" data-tab="id" role="tab">${t("cmp_seg_id")}</button>
      <button class="sov-tab" data-tab="msg" role="tab">${t("cmp_seg_msg")}</button>
    </div>
    <div class="sov-panel" data-panel="id">${idTable}</div>
    <div class="sov-panel" data-panel="msg" hidden>${msgTable}</div>
    <p class="sov-legend">${t("sov_legend")}</p>
    <p class="sov-cmp-note">${t("sov_cmp_note")}</p>
  </section>`;
}

function renderLanding() {
  // Au premier rendu de l'accueil, on tente la reconnexion si un indice de
  // session (ou une ancienne clé) existe — sinon on affiche l'accueil directement.
  if (!_autoReconnectTried && (sessionHint() || storedKey())) {
    _autoReconnectTried = true;
    app.innerHTML = `<p class="loading">Reconnexion…</p>`;
    tryAutoReconnect().then((done) => {
      if (!done) renderLanding();
    });
    return;
  }
  const _landingHandle = myHandle();
  // Mode "grand public" : variante simplifiée, fun, sans détails techniques.
  if (landingMode() === "public") {
    return renderSimpleLanding(_landingHandle);
  }
  if (!_landingHandle) maybeFlashBrandPaletteOnLanding();
  app.innerHTML = `
    ${siteHeader({
      right: `${landingModeSwitchHtml()}
        <button class="btn sm" id="nav-connect">${icon("plug", 15)} ${t("nav_connect")}</button>
        <span class="hd-tools">${langSelectHtml()}${lpThemeToggleHtml()}</span>
        ${!_landingHandle ? (sessionHint()
          ? `<a class="btn sm primary" href="/me">${t("nav_space")}</a>`
          : storedKey()
          ? `<a class="btn sm primary" href="/k/${encodeURIComponent(storedKey())}">${t("nav_space")}</a>`
          : "") : ""}
        ${headerAccount()}`,
    })}

    <div class="landing" id="landing">
      <section class="lp-hero">
        <div class="hero-copy">
          <div class="hero-milo">${miloSvg(64)}</div>
          <h1>${t("hero1")} <span class="accent">${t("hero2")}</span></h1>
          <p class="lp-tagline">${t("lead")}</p>

          <div class="search">
            <form class="search-box" id="search-form" role="search">
              ${icon("search")}
              <input id="q" type="search" placeholder="${t("search_ph")}" autocomplete="off" aria-label="${t("search_ph")}" />
              <button class="go" type="submit">${t("search_btn")}</button>
            </form>
            <div id="results"></div>
          </div>

          <div class="hero-actions">
            ${sessionHint() || storedKey() ? "" : `<button class="btn primary" id="create-btn">${icon("user", 18)} ${t("create")}</button>`}
            ${sessionHint() || storedKey() ? "" : `<button class="btn" id="login-btn">${icon("key", 16)} ${t("login")}</button>`}
          </div>
          <p class="lost-key"><a href="#" id="recover-link">${t("lost_key")}</a></p>
          <p class="adoption" id="adoption" hidden></p>
          <ul class="clients" aria-label="${t("clients_h")}">
            <li class="cli on"><span class="cli-ic">${icon("plug", 14)}</span><span>${t("cli_web")}</span><em>${t("cli_live")}</em></li>
            <li class="cli on"><span class="cli-ic">${icon("smartphone", 14)}</span><span>${t("cli_android")}</span><em>${t("cli_live")}</em></li>
            <li class="cli"><span class="cli-ic">${icon("smartphone", 14)}</span><span>${t("cli_ios")}</span><em>${t("cli_soon")}</em></li>
            <li class="cli on"><span class="cli-ic">${icon("code", 14)}</span><span>${t("cli_desktop")}</span><em>${t("cli_beta")}</em></li>
            <li class="cli on"><span class="cli-ic">${icon("plug", 14)}</span><span>${t("cli_mcp")}</span><em>${t("cli_live")}</em></li>
          </ul>
        </div>

        <div class="hero-visual" aria-hidden="true">
          <svg class="hero-phone" viewBox="0 0 360 740" width="360" height="740" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="mindlog · id">
            <defs>
              <clipPath id="phone-screen"><rect x="14" y="14" width="332" height="712" rx="30" ry="30"/></clipPath>
              <linearGradient id="phone-bezel" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#1a1f28"/><stop offset="1" stop-color="#0b0d12"/>
              </linearGradient>
              <linearGradient id="phone-shine" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="#fff" stop-opacity="0"/>
                <stop offset=".48" stop-color="#fff" stop-opacity=".18"/>
                <stop offset=".52" stop-color="#fff" stop-opacity=".18"/>
                <stop offset="1" stop-color="#fff" stop-opacity="0"/>
              </linearGradient>
            </defs>
            <rect x="0" y="0" width="360" height="740" rx="42" ry="42" fill="url(#phone-bezel)" stroke="#262c36" stroke-width="2"/>
            <rect x="6" y="6" width="348" height="728" rx="38" ry="38" fill="none" stroke="#0a0c11" stroke-width="2"/>
            <g clip-path="url(#phone-screen)">
              <rect x="14" y="14" width="332" height="712" fill="#0b0d12"/>
              <image class="hero-phone-img" href="/static/app-preview-android.png" x="14" y="14" width="332" height="712" preserveAspectRatio="xMidYMid meet"/>
              <rect class="hero-phone-shine" x="-200" y="14" width="160" height="712" fill="url(#phone-shine)" opacity=".0"/>
            </g>
            <rect x="150" y="8" width="60" height="22" rx="11" ry="11" fill="#000"/>
            <circle cx="194" cy="19" r="3.2" fill="#1f242d"/>
            <rect x="2" y="120" width="2" height="42" rx="1" fill="#1a1f28"/>
            <rect x="2" y="180" width="2" height="72" rx="1" fill="#1a1f28"/>
            <rect x="356" y="150" width="2" height="86" rx="1" fill="#1a1f28"/>
          </svg>
        </div>

        <a class="scroll-cue" href="#sec-msg" aria-label="${t("col_demo")}">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
        </a>
      </section>

      <nav class="lp-anchors" id="lp-anchors" aria-label="${t("col_home")}">
        <a href="#sec-msg">${icon("chat", 15)}<span>${t("col_demo")}</span></a>
        <a href="#sec-features">${icon("sparkles", 15)}<span>${t("col_features")}</span></a>
        <a href="#sec-clients">${icon("smartphone", 15)}<span>${t("col_clients")}</span></a>
        <a href="#sec-sov">${icon("shield", 15)}<span>${t("col_sov")}</span></a>
        <a href="#sec-mcp">${icon("plug", 15)}<span>${t("col_mcp")}</span></a>
        <a href="#sec-premium">${icon("sparkles", 15)}<span>Premium</span></a>
        <a href="${GITHUB_URL}" target="_blank" rel="noopener">${icon("code", 15)}<span>${t("source")}</span></a>
        <a href="#sec-pricing">${icon("tag", 15)}<span>${t("pricing")}</span></a>
      </nav>

      <section class="lp-section" id="sec-msg">${showcaseColHtml()}</section>

      <section class="lp-section" id="sec-features">
        <section class="features">
          <div class="feature feature--hl"><div class="ic">${icon("camera")}</div><h3>${t("feat_call_t")}</h3><p>${t("feat_call_d")}</p></div>
          <div class="feature feature--hl"><div class="ic">${icon("key")}</div><h3>${t("feat_e2e_t")}</h3><p>${t("feat_e2e_d")}</p></div>
          <div class="feature"><div class="ic">${icon("user")}</div><h3>${t("feat_id_t")}</h3><p>${t("feat_id_d")}</p></div>
          <div class="feature"><div class="ic">${icon("calendar")}</div><h3>${t("feat_agenda_t")}</h3><p>${t("feat_agenda_d")}</p></div>
          <div class="feature"><div class="ic">${icon("clock")}</div><h3>${t("feat_dispo_t")}</h3><p>${t("feat_dispo_d")}</p></div>
          <div class="feature"><div class="ic">${icon("mail")}</div><h3>${t("feat_rdv_t")}</h3><p>${t("feat_rdv_d")}</p></div>
          <div class="feature feature--wide"><div class="ic">${icon("users")}</div><h3>${t("feat_rel_t")}</h3><p>${t("feat_rel_d")}</p></div>
          <div class="feature feature--wide"><div class="ic">${icon("shield")}</div><h3>${t("feat_priv_t")}</h3><p>${t("feat_priv_d")}</p></div>
        </section>
        <div class="app-soon">
          <p class="app-soon-cap">${icon("smartphone", 15)} ${t("app_soon")}</p>
          <div class="store-badges">
            <a class="store-badge" href="https://play.google.com/store/apps/details?id=today.mindlog.id" target="_blank" rel="noopener" aria-label="Google Play">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M22.018 13.298l-3.919 2.218-3.515-3.493 3.543-3.521 3.891 2.202a1.49 1.49 0 0 1 0 2.594zM1.337.924a1.486 1.486 0 0 0-.112.568v21.017c0 .217.045.419.124.6l11.155-11.087L1.337.924zm12.207 10.065l3.258-3.238L3.45.195a1.466 1.466 0 0 0-.946-.179l11.04 10.973zm0 2.067l-11 10.933c.298.036.612-.04.906-.207l13.324-7.563-3.231-3.17z"/></svg>
              <span><small>${t("store_soon")}</small><b>Google Play</b></span>
            </a>
            <span class="store-badge is-soon" aria-label="App Store — ${esc(t("store_soon"))}">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.034 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701z"/></svg>
              <span><small>${t("store_soon")}</small><b>App Store</b></span>
            </span>
          </div>
        </div>
      </section>

      <section class="lp-section" id="sec-clients">${clientsColHtml()}</section>

      <section class="lp-section" id="sec-sov">${sovereignColHtml()}</section>

      <!-- Bandeau anti-interception P2P : différenciateur clé, intercalé entre
           Souveraineté (E2E, FR, OSS) et MCP. Réutilise le composant tg-p2p
           introduit pour EasyMode → cohérence visuelle stricte. -->
      <section class="lp-section" id="sec-p2p">
        <section class="tg-p2p" aria-label="P2P">
          <div class="tg-p2p-inner">
            <div class="tg-p2p-diagram" aria-hidden="true">
              <span class="tg-p2p-node a">${icon("smartphone", 22)}</span>
              <span class="tg-p2p-line"></span>
              <span class="tg-p2p-node b">${icon("smartphone", 22)}</span>
              <span class="tg-p2p-server" title="mindlog hors du flux">
                ${icon("eye-off", 16)}
                <span>mindlog</span>
              </span>
            </div>
            <div class="tg-p2p-copy">
              <h2>${t("gp_p2p_h")}</h2>
              <p>${t("gp_p2p_p")}</p>
            </div>
          </div>
        </section>
      </section>

      <section class="lp-section" id="sec-mcp"><section class="mcp" id="mcp">
      <div class="mcp-head">
        <div class="ic">${icon("plug")}</div>
        <h2>${t("mcp_h")}</h2>
      </div>
      <p class="mcp-lead">${t("mcp_lead")}</p>

      <div class="mcp-tabs" role="tablist">
        <button class="mcp-tab active" data-tab="cloud" role="tab">${t("mcp_tab_cloud")}</button>
        <button class="mcp-tab" data-tab="self" role="tab">${t("mcp_tab_self")}</button>
      </div>

      <div class="mcp-panel" data-panel="cloud">
        <p class="mcp-panel-lead">${t("mcp_cloud_lead")}</p>
        <div class="mcp-url">
          <code>https://${PROD_URL}/mcp</code>
          <button class="btn sm" id="mcp-url-copy">${icon("copy", 15)} ${t("mcp_url_copy")}</button>
          <button class="btn sm" id="mcp-dl">${t("mcp_dl")}</button>
        </div>
        <ol class="mcp-steps">
          <li>${t("mcp_step_claude")}</li>
          <li>${t("mcp_step_chatgpt")}</li>
          <li>${t("mcp_step_other")}</li>
        </ol>
        <details class="mcp-details">
          <summary>${t("mcp_see_json")}</summary>
          <div class="mcp-config">
            <div class="mcp-config-head">
              <span>MCP · cloud</span>
              <button class="btn sm" data-mcp-copy="cloud">${icon("copy", 15)} ${t("copy")}</button>
            </div>
            <pre>${esc(MCP_CONFIG_CLOUD)}</pre>
          </div>
        </details>
      </div>

      <div class="mcp-panel" data-panel="self" hidden>
        <p class="mcp-panel-lead">${t("mcp_self_lead")}</p>
        <div class="mcp-config">
          <div class="mcp-config-head">
            <span>MCP · stdio</span>
            <button class="btn sm" data-mcp-copy="self">${icon("copy", 15)} ${t("copy")}</button>
          </div>
          <pre>${esc(MCP_CONFIG_SELF)}</pre>
        </div>
      </div>

      <p class="mcp-note">${t("mcp_note")}</p>
    </section></section>

      <!-- Showcase Premium : ce que débloque l'abonnement créateur·rice (6 cartes).
           Précède immédiatement la grille de tarifs → enchaîne « ce que vous
           débloquez » sur « le prix ». Réutilise le composant tg-prem. -->
      <section class="lp-section" id="sec-premium">
        <section class="tg-prem">
          <header class="tg-prem-head">
            <span class="tg-prem-eyebrow">${icon("sparkles", 14)} ${t("gp_prem_eyebrow")}</span>
            <h2>${t("gp_prem_h")}</h2>
            <p class="tg-prem-lead">${t("gp_prem_lead")}</p>
          </header>
          <div class="tg-prem-grid">
            <article class="tg-prem-card"><span class="tg-prem-ic">${icon("chat", 22)}</span><h3>${t("gp_prem_s1_t")}</h3><p>${t("gp_prem_s1_d")}</p></article>
            <article class="tg-prem-card"><span class="tg-prem-ic">${icon("camera", 22)}</span><h3>${t("gp_prem_s2_t")}</h3><p>${t("gp_prem_s2_d")}</p></article>
            <article class="tg-prem-card"><span class="tg-prem-ic">${icon("pencil", 22)}</span><h3>${t("gp_prem_s3_t")}</h3><p>${t("gp_prem_s3_d")}</p></article>
            <article class="tg-prem-card"><span class="tg-prem-ic">${icon("calendar", 22)}</span><h3>${t("gp_prem_s4_t")}</h3><p>${t("gp_prem_s4_d")}</p></article>
            <article class="tg-prem-card"><span class="tg-prem-ic">${icon("zap", 22)}</span><h3>${t("gp_prem_s5_t")}</h3><p>${t("gp_prem_s5_d")}</p></article>
            <article class="tg-prem-card"><span class="tg-prem-ic">${icon("tag", 22)}</span><h3>${t("gp_prem_s6_t")}</h3><p>${t("gp_prem_s6_d")}</p></article>
          </div>
        </section>
      </section>

      <section class="lp-section" id="sec-pricing">${consumerPricingHtml()}${pricingColHtml()}</section>

      <footer class="lp-footer">
        <div class="about-col">
          <a class="brand" href="/" style="justify-content:center"><span class="brand-milo">${miloSvg(44)}</span> mindlog · id</a>
          <p class="sub" style="text-align:center;margin-top:.6rem">${CREDIT()}</p>
          <nav class="about-links">
            <a href="${GITHUB_URL}" target="_blank" rel="noopener">${t("source")}</a>
            <a href="#sec-pricing">${t("pricing")}</a>
            <a href="/status">${t("status_link")}</a>
            <a href="/static/api-docs.html">${t("api_docs")}</a>
            <a href="/privacy">${t("privacy")}</a>
          </nav>
          <p class="trust" style="margin-top:1rem">${t("trust")}</p>
        </div>
      </footer>
    </div>
  `;
  footer.innerHTML = ""; // le pied de page vit désormais dans le flux de la landing
  wireLanding();
  wireShowcase();

  // Indicateur d'adoption : nombre RÉEL d'identités (depuis /api/status),
  // animé en count-up via GSAP, avec une trend (créations des 7 derniers jours).
  api("/api/status")
    .then((s) => {
      const el = app.querySelector("#adoption");
      const n = s?.counts?.identities;
      if (!el || typeof n !== "number") return;
      // Seuil de preuve sociale : sous ~50 identités, un compteur (« 1 identité »)
      // dessert plus qu'il ne rassure → on le masque tant qu'il n'est pas probant.
      if (n < 50) { el.hidden = true; return; }
      const recent = s?.counts?.identitiesLast7d || 0;
      const trend = recent > 0 ? `<span class="adopt-trend">↑ ${esc(t("adoption_trend").replace("{n}", recent.toLocaleString(LANG)))}</span>` : "";
      // {n} → compteur animable ; le reste de la phrase reste traduit.
      el.innerHTML =
        t("adoption").replace("{n}", `<strong class="adopt-num" id="adopt-num">0</strong>`) + trend;
      el.hidden = false;

      const numEl = el.querySelector("#adopt-num");
      const setVal = (v) => (numEl.textContent = Math.round(v).toLocaleString(LANG));
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (window.gsap && !reduce && n > 0) {
        const obj = { v: 0 };
        window.gsap.to(obj, { v: n, duration: 1.4, ease: "power2.out", onUpdate: () => setVal(obj.v) });
        window.gsap.from(el, { opacity: 0, y: 8, duration: 0.5, ease: "power2.out" });
        if (trend)
          window.gsap.from(el.querySelector(".adopt-trend"), { opacity: 0, x: -6, duration: 0.5, delay: 1.2 });
      } else {
        setVal(n); // pas de GSAP / mouvement réduit : chiffre réel directement
      }
    })
    .catch(() => {});
}

function wireLanding() {
  const input = app.querySelector("#q");
  const results = app.querySelector("#results");
  let timer;

  const renderResults = (list) => {
    if (!input.value.trim()) return (results.innerHTML = "");
    if (!list.length) {
      results.innerHTML = `<div class="results"><div class="no"><div class="empty-milo">${miloSvg(64)}</div>Personne trouvé. Soyez le premier : créez votre page.</div></div>`;
      return;
    }
    results.innerHTML = `<div class="results">${list
      .map(
        (r) => `
        <a class="result" href="/@${encodeURIComponent(r.handle)}">
          ${avatarHtml(r.handle, r.has_photo, "av")}
          <span class="meta">
            <div class="nm">${esc(r.display_name || r.handle)}</div>
            <div class="hd">@${esc(r.handle)}${r.title ? " · " + esc(r.title) : ""}</div>
          </span>
        </a>`
      )
      .join("")}</div>`;
  };

  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) return (results.innerHTML = "");
    timer = setTimeout(async () => {
      try {
        const { results: list } = await api(`/api/search?q=${encodeURIComponent(q)}`);
        renderResults(list);
      } catch {
        /* silencieux */
      }
    }, 200);
  });

  app.querySelector("#search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const first = results.querySelector(".result");
    if (first) location.assign(first.getAttribute("href"));
  });

  document.addEventListener("click", (e) => {
    if (!app.querySelector(".search")?.contains(e.target)) results.innerHTML = "";
  });

  app.querySelector("#create-btn")?.addEventListener("click", openCreate);
  // CTA des offres (Découverte / Premium) : l'abonnement se gère dans l'espace
  // connecté, on commence donc par la création de page.
  app.querySelector("#cpr-free-cta")?.addEventListener("click", openCreate);
  app.querySelector("#cpr-prem-cta")?.addEventListener("click", startPremiumUpgrade);
  app.querySelector("#login-btn")?.addEventListener("click", openRecover);
  app.querySelector("#recover-link").addEventListener("click", (e) => {
    e.preventDefault();
    openRecover();
  });
  // Onglets MCP (cloud / self-hosting)
  app.querySelectorAll(".mcp-tab").forEach((t) =>
    t.addEventListener("click", () => {
      const tab = t.dataset.tab;
      app.querySelectorAll(".mcp-tab").forEach((x) => x.classList.toggle("active", x === t));
      app.querySelectorAll(".mcp-panel").forEach((p) => (p.hidden = p.dataset.panel !== tab));
    })
  );
  // Onglets du comparatif souveraineté (type Linktree / type WhatsApp).
  app.querySelectorAll(".sov-tab").forEach((tb) =>
    tb.addEventListener("click", () => {
      const tab = tb.dataset.tab;
      app.querySelectorAll(".sov-tab").forEach((x) => x.classList.toggle("active", x === tb));
      app.querySelectorAll(".sov-panel").forEach((p) => (p.hidden = p.dataset.panel !== tab));
    })
  );
  app.querySelectorAll("[data-mcp-copy]").forEach((b) =>
    b.addEventListener("click", () => {
      copyText(MCP_CONFIGS[b.dataset.mcpCopy]);
      toast(t("msg_config_copied"));
    })
  );
  app.querySelector("#mcp-url-copy")?.addEventListener("click", () => {
    copyText(`https://${PROD_URL}/mcp`);
    toast(t("msg_url_copied"));
  });
  app.querySelector("#mcp-dl")?.addEventListener("click", () => {
    const blob = new Blob([MCP_CONFIG_CLOUD], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "mindlog-mcp.json";
    a.click();
    URL.revokeObjectURL(a.href);
    toast(t("msg_config_downloaded"));
  });
  app.querySelector("#lang-select")?.addEventListener("change", (e) => setLang(e.target.value));
  // « Connecter à une IA » → glisse jusqu'à la section MCP.
  app.querySelector("#nav-connect")?.addEventListener("click", () => {
    document.getElementById("sec-mcp")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  // Bascule grand public ↔ expert geek (contrôle segmenté)
  app.querySelectorAll("#mode-seg .seg-btn").forEach((b) =>
    b.addEventListener("click", () => setLandingMode(b.dataset.mode))
  );
  app.querySelector("#lp-theme")?.addEventListener("click", toggleTheme);
  applyTheme(storedTheme() || "dark"); // pose l'icône du toggle intégré

  sizeHeroToViewport();
  wireScrollAnims();
}

/* ------------------------ Landing « Grand public » ----------------------- */
// Vue simplifiée, sans jargon, orientée commerciale :
// - héros chaleureux + accroche prix locale (gratuit pour démarrer, premium 1 €)
// - trust strip souveraineté/E2E/P2P (différenciateur clé vs Linktree/WhatsApp)
// - 3 bénéfices clairs (bento)
// - bandeau « médias jamais sur le parcours du flux » — anti-interception
// - showcase 6 services Premium (chat, appel A/V, pages privées, RDV, lives,
//   discrétion d'annuaire) : ce qui débloque l'abonnement
// - tarifs grand public (devise auto-adaptée au pays)
// - CTA de clôture
function renderSimpleLanding(landingHandle) {
  if (!landingHandle) maybeFlashBrandPaletteOnLanding();
  const lp = localPrice();
  const priceTease = t("gp_price_tease")
    .replace("{price}", esc(lp.primary))
    .replace("{per}", esc(lp.per));
  const premCtaLabel = t("gp_prem_cta")
    .replace("{price}", esc(lp.primary))
    .replace("{per}", esc(lp.per));
  app.innerHTML = `
    ${siteHeader({
      right: `${landingModeSwitchHtml()}
        <span class="hd-tools">${langSelectHtml()}${lpThemeToggleHtml()}</span>
        ${!landingHandle ? (sessionHint()
          ? `<a class="btn sm primary" href="/me">${t("nav_space")}</a>`
          : storedKey()
          ? `<a class="btn sm primary" href="/k/${encodeURIComponent(storedKey())}">${t("nav_space")}</a>`
          : "") : ""}
        ${headerAccount()}`,
    })}

    <div class="landing landing--simple" id="landing">
      <!-- HERO façon telegram.org : copy à gauche, mascotte XL à droite -->
      <section class="tg-hero">
        <div class="tg-hero-copy">
          <span class="tg-eyebrow"><span class="dot"></span> ${t("gp_eyebrow")}</span>
          <h1 class="tg-h1">${t("gp_hero1")} <span class="accent">${t("gp_hero2")}</span></h1>
          <p class="tg-lead">${t("gp_lead")}</p>

          <div class="tg-actions">
            ${sessionHint() || storedKey() ? "" : `<button class="btn tg-cta" id="create-btn">${icon("sparkles", 18)} ${t("gp_cta_create")}</button>`}
            ${sessionHint() || storedKey() ? "" : `<button class="btn tg-ghost" id="login-btn">${icon("key", 16)} ${t("gp_cta_login")}</button>`}
          </div>

          <p class="tg-price-tease">${icon("sparkles", 14)} ${priceTease}</p>

          <div class="search tg-search">
            <form class="search-box" id="search-form" role="search">
              ${icon("search")}
              <input id="q" type="search" placeholder="${t("search_ph")}" autocomplete="off" aria-label="${t("search_ph")}" />
              <button class="go" type="submit">${t("search_btn")}</button>
            </form>
            <div id="results"></div>
          </div>

          <p class="tg-lost lost-key"><a href="#" id="recover-link">${t("lost_key")}</a></p>
        </div>

        <div class="tg-hero-visual" aria-hidden="true">
          <div class="tg-milo-disc">
            <div class="tg-milo">${miloSvg(220)}</div>
          </div>
          <div class="tg-chip tg-chip-1">${t("gp_chip_1")}</div>
          <div class="tg-chip tg-chip-2">${t("gp_chip_2")}</div>
          <div class="tg-chip tg-chip-3">${t("gp_chip_3")}</div>
        </div>
      </section>

      <!-- Trust strip — 5 promesses souveraineté/privacy/P2P/OSS, en pilules -->
      <section class="tg-trust" aria-label="${esc(t("sov_h"))}">
        <div class="tg-trust-row">
          <span class="tg-trust-chip"><span class="flag">🇫🇷</span>${t("gp_trust_1")}</span>
          <span class="tg-trust-chip">${icon("lock", 14)}${t("gp_trust_2")}</span>
          <span class="tg-trust-chip">${icon("plug", 14)}${t("gp_trust_3")}</span>
          <span class="tg-trust-chip">${icon("eye-off", 14)}${t("gp_trust_4")}</span>
          <span class="tg-trust-chip">${icon("code", 14)}${t("gp_trust_5")}</span>
        </div>
      </section>

      <!-- Trois piliers, en grille « bento » homogène (fini les bandes de couleur) -->
      <section class="tg-bands" aria-label="${esc(t("col_features"))}">
        <div class="tg-bento">
          <article class="tg-cell">
            <div class="tg-cell-head">
              <span class="tg-cell-ic">${icon("user", 26)}</span>
              <span class="tg-cell-num">01</span>
            </div>
            <h2 class="tg-cell-h">${t("gp_b1_t")}</h2>
            <p class="tg-cell-p">${t("gp_b1_d")}</p>
            <span class="tg-cell-badge">${icon("sparkles", 13)} ${t("gp_badge_1")}</span>
          </article>
          <article class="tg-cell">
            <div class="tg-cell-head">
              <span class="tg-cell-ic">${icon("chat", 26)}</span>
              <span class="tg-cell-num">02</span>
            </div>
            <h2 class="tg-cell-h">${t("gp_b2_t")}</h2>
            <p class="tg-cell-p">${t("gp_b2_d")}</p>
            <span class="tg-cell-badge">${icon("lock", 13)} ${t("gp_badge_2")}</span>
          </article>
          <article class="tg-cell">
            <div class="tg-cell-head">
              <span class="tg-cell-ic">${icon("calendar", 26)}</span>
              <span class="tg-cell-num">03</span>
            </div>
            <h2 class="tg-cell-h">${t("gp_b3_t")}</h2>
            <p class="tg-cell-p">${t("gp_b3_d")}</p>
            <span class="tg-cell-badge">${icon("calendar", 13)} ${t("gp_badge_3")}</span>
          </article>
        </div>
      </section>

      <!-- Anti-interception : différenciateur clé. mindlog n'est PAS sur le
           parcours du flux media → rien à intercepter par construction. -->
      <section class="tg-p2p" aria-label="P2P">
        <div class="tg-p2p-inner">
          <div class="tg-p2p-diagram" aria-hidden="true">
            <span class="tg-p2p-node a">${icon("smartphone", 22)}</span>
            <span class="tg-p2p-line"></span>
            <span class="tg-p2p-node b">${icon("smartphone", 22)}</span>
            <span class="tg-p2p-server" title="mindlog hors du flux">
              ${icon("eye-off", 16)}
              <span>mindlog</span>
            </span>
          </div>
          <div class="tg-p2p-copy">
            <h2>${t("gp_p2p_h")}</h2>
            <p>${t("gp_p2p_p")}</p>
          </div>
        </div>
      </section>

      <!-- Showcase Premium — 6 services débloqués par l'abonnement créateur·rice -->
      <section class="tg-prem" id="sec-premium" aria-label="Premium">
        <header class="tg-prem-head">
          <span class="tg-prem-eyebrow">${icon("sparkles", 14)} ${t("gp_prem_eyebrow")}</span>
          <h2>${t("gp_prem_h")}</h2>
          <p class="tg-prem-lead">${t("gp_prem_lead")}</p>
        </header>
        <div class="tg-prem-grid">
          <article class="tg-prem-card">
            <span class="tg-prem-ic">${icon("chat", 22)}</span>
            <h3>${t("gp_prem_s1_t")}</h3>
            <p>${t("gp_prem_s1_d")}</p>
          </article>
          <article class="tg-prem-card">
            <span class="tg-prem-ic">${icon("camera", 22)}</span>
            <h3>${t("gp_prem_s2_t")}</h3>
            <p>${t("gp_prem_s2_d")}</p>
          </article>
          <article class="tg-prem-card">
            <span class="tg-prem-ic">${icon("pencil", 22)}</span>
            <h3>${t("gp_prem_s3_t")}</h3>
            <p>${t("gp_prem_s3_d")}</p>
          </article>
          <article class="tg-prem-card">
            <span class="tg-prem-ic">${icon("calendar", 22)}</span>
            <h3>${t("gp_prem_s4_t")}</h3>
            <p>${t("gp_prem_s4_d")}</p>
          </article>
          <article class="tg-prem-card">
            <span class="tg-prem-ic">${icon("zap", 22)}</span>
            <h3>${t("gp_prem_s5_t")}</h3>
            <p>${t("gp_prem_s5_d")}</p>
          </article>
          <article class="tg-prem-card">
            <span class="tg-prem-ic">${icon("tag", 22)}</span>
            <h3>${t("gp_prem_s6_t")}</h3>
            <p>${t("gp_prem_s6_d")}</p>
          </article>
        </div>
        <div class="tg-prem-cta-wrap">
          <button class="btn tg-cta" id="tg-prem-cta">${icon("sparkles", 18)} ${esc(premCtaLabel)}</button>
          <p class="tg-prem-note">${t("gp_prem_cta_note")}</p>
        </div>
      </section>

      <!-- Tarifs : offre gratuite vs Premium (page publique personnalisée) -->
      <section class="lp-section" id="sec-pricing">${consumerPricingHtml()}</section>

      <!-- Bandeau de fin : grosse CTA + lien vers mode geek -->
      <section class="tg-final">
        <h2>${t("gp_final_h")}</h2>
        <p>${t("gp_final_p")}</p>
        ${sessionHint() || storedKey() ? "" : `<button class="btn tg-cta" id="create-btn-2">${icon("sparkles", 18)} ${t("gp_cta_create")}</button>`}
        <p class="adoption" id="adoption" hidden></p>
      </section>

      <footer class="lp-footer">
        <div class="about-col">
          <a class="brand" href="/" style="justify-content:center"><span class="brand-milo">${miloSvg(44)}</span> mindlog · id</a>
          <p class="sub" style="text-align:center;margin-top:.6rem">${CREDIT()}</p>
          <nav class="about-links">
            <a href="${GITHUB_URL}" target="_blank" rel="noopener">${t("source")}</a>
            <a href="#sec-pricing">${t("pricing")}</a>
            <a href="/privacy">${t("privacy")}</a>
            <a href="/status">${t("status_link")}</a>
          </nav>
          <p class="trust" style="margin-top:1rem">${t("trust")}</p>
        </div>
      </footer>
    </div>
  `;
  footer.innerHTML = "";
  wireSimpleLanding();
}

function wireSimpleLanding() {
  // Réutilise la logique de recherche / création / récupération de la landing
  // complète : même code, même comportement.
  const input = app.querySelector("#q");
  const results = app.querySelector("#results");
  let timer;
  const renderResults = (list) => {
    if (!input.value.trim()) return (results.innerHTML = "");
    if (!list.length) {
      results.innerHTML = `<div class="results"><div class="no"><div class="empty-milo">${miloSvg(64)}</div>Personne trouvé. Soyez le premier : créez votre page.</div></div>`;
      return;
    }
    results.innerHTML = `<div class="results">${list
      .map(
        (r) => `
        <a class="result" href="/@${encodeURIComponent(r.handle)}">
          ${avatarHtml(r.handle, r.has_photo, "av")}
          <span class="meta">
            <div class="nm">${esc(r.display_name || r.handle)}</div>
            <div class="hd">@${esc(r.handle)}${r.title ? " · " + esc(r.title) : ""}</div>
          </span>
        </a>`
      )
      .join("")}</div>`;
  };
  input?.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) return (results.innerHTML = "");
    timer = setTimeout(async () => {
      try {
        const { results: list } = await api(`/api/search?q=${encodeURIComponent(q)}`);
        renderResults(list);
      } catch {}
    }, 200);
  });
  app.querySelector("#search-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const first = results.querySelector(".result");
    if (first) location.assign(first.getAttribute("href"));
  });
  document.addEventListener("click", (e) => {
    if (!app.querySelector(".search")?.contains(e.target)) results.innerHTML = "";
  });
  app.querySelector("#create-btn")?.addEventListener("click", openCreate);
  app.querySelector("#create-btn-2")?.addEventListener("click", openCreate);
  app.querySelector("#cpr-free-cta")?.addEventListener("click", openCreate);
  app.querySelector("#cpr-prem-cta")?.addEventListener("click", startPremiumUpgrade);
  app.querySelector("#tg-prem-cta")?.addEventListener("click", startPremiumUpgrade);
  app.querySelector("#login-btn")?.addEventListener("click", openRecover);
  app.querySelector("#recover-link")?.addEventListener("click", (e) => {
    e.preventDefault();
    openRecover();
  });
  app.querySelector("#lang-select")?.addEventListener("change", (e) => setLang(e.target.value));
  // Bascule Easy ↔ Geek (contrôle segmenté) + thème intégré à la barre.
  app.querySelectorAll("#mode-seg .seg-btn").forEach((b) =>
    b.addEventListener("click", () => setLandingMode(b.dataset.mode))
  );
  app.querySelector("#lp-theme")?.addEventListener("click", toggleTheme);
  applyTheme(storedTheme() || "dark"); // pose l'icône du toggle intégré

  // Indicateur d'adoption (même API que la landing complète)
  api("/api/status")
    .then((s) => {
      const el = app.querySelector("#adoption");
      const n = s?.counts?.identities;
      if (!el || typeof n !== "number") return;
      if (n < 50) { el.hidden = true; return; } // cf. seuil de preuve sociale (landing experte)
      el.innerHTML = t("adoption").replace("{n}", `<strong>${n.toLocaleString(LANG)}</strong>`);
      el.hidden = false;
    })
    .catch(() => {});
}

// Première page plein écran : ajuste le hero à la hauteur réellement disponible
// (viewport − topbar), recalculée au resize. Repli CSS (100svh) si le hero n'est pas trouvé.
function sizeHeroToViewport() {
  const hero = app.querySelector(".lp-hero");
  if (!hero) return;
  const apply = () => {
    hero.style.minHeight = ""; // réinitialise avant de mesurer la position réelle
    const offset = hero.getBoundingClientRect().top + window.scrollY; // bandeau + topbar
    hero.style.minHeight = `${Math.max(0, window.innerHeight - offset)}px`;
    window.ScrollTrigger?.refresh();
  };
  // Mesure une fois en haut de page pour capter l'espace du bandeau + topbar.
  requestAnimationFrame(apply);
  clearTimeout(sizeHeroToViewport._t);
  window.removeEventListener("resize", sizeHeroToViewport._h || (() => {}));
  sizeHeroToViewport._h = () => { clearTimeout(sizeHeroToViewport._t); sizeHeroToViewport._t = setTimeout(apply, 120); };
  window.addEventListener("resize", sizeHeroToViewport._h);
}

// Animations au défilement (GSAP + ScrollTrigger) : intro du hero, léger parallax,
// puis révélation progressive de chaque section. Respecte prefers-reduced-motion.
function wireScrollAnims() {
  const g = window.gsap, ST = window.ScrollTrigger;
  if (!g || !ST || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  g.registerPlugin(ST);
  ST.getAll().forEach((s) => s.kill()); // évite les doublons sur re-render

  // Intro du hero au chargement (séquencée). clearProps : on retire le transform
  // résiduel, sinon le bloc texte devient un contexte d'empilement et piège le menu
  // de résultats sous les boutons (problème de z-index).
  g.from(".hero-copy > *", { opacity: 0, y: 26, duration: 0.7, ease: "power3.out", stagger: 0.08, delay: 0.1, clearProps: "transform,opacity" });
  g.from(".hero-visual", { opacity: 0, x: 44, scale: 0.96, duration: 0.9, ease: "power3.out", delay: 0.2, clearProps: "transform,opacity" });

  // Parallax + fondu du hero quand on commence à défiler.
  g.to(".lp-hero", {
    opacity: 0.12, y: -60, ease: "none",
    scrollTrigger: { trigger: ".lp-hero", start: "top top", end: "bottom top", scrub: true },
  });

  // Révélation au scroll : par groupe d'éléments, avec léger décalage (stagger).
  const reveal = (els, stagger = 0.06) => {
    const list = [...els];
    if (!list.length) return;
    g.set(list, { opacity: 0, y: 34 });
    ST.batch(list, {
      start: "top 86%",
      onEnter: (batch) => g.to(batch, { opacity: 1, y: 0, duration: 0.6, ease: "power2.out", stagger, overwrite: true }),
    });
  };
  reveal(app.querySelectorAll("#sec-msg .show-head, #sec-msg .show-tabs, #sec-msg .show-stage"));
  reveal(app.querySelectorAll("#sec-features .feature"));
  reveal(app.querySelectorAll("#sec-sov .sov-head, #sec-sov .sov-lead, #sec-sov .pillar, #sec-sov .sov-cmp-h, #sec-sov .sov-tabs, #sec-sov .sov-panel"));
  reveal(app.querySelectorAll("#sec-mcp .mcp-head, #sec-mcp .mcp-lead, #sec-mcp .mcp-tabs, #sec-mcp .mcp-panel"));
  reveal(app.querySelectorAll("#sec-pricing .show-head, #sec-pricing .pr-lead, #sec-pricing .pr-plan, #sec-pricing .pr-info"), 0.08);
  reveal(app.querySelectorAll(".lp-footer .about-col"), 0);

  ST.refresh();
}


// Fait « parler » Milo via la bulle BD (auto-masquée).
function miloSay(text, sticky = false) {
  const b = document.getElementById("milo-bubble");
  if (!b) return;
  b.textContent = text;
  b.hidden = false;
  if (window.gsap && !window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    window.gsap.fromTo(b, { scale: 0.7, opacity: 0, y: 6 }, { scale: 1, opacity: 1, y: 0, duration: 0.35, ease: "back.out(2)" });
  clearTimeout(miloSay._t);
  if (!sticky) miloSay._t = setTimeout(() => (b.hidden = true), 5000);
}

/* ----------------------- Mascotte fixe globale (Milo) -------------------- */
// Milo flotte dans un coin, visible en permanence (ne défile pas).
// La palette de couleurs n'apparaît qu'au survol, quelques secondes.
function mountMiloFab() {
  if (document.getElementById("milo-fab")) return;
  const fab = document.createElement("div");
  fab.id = "milo-fab";
  fab.innerHTML = `
    <div class="milo-bubble" id="milo-bubble" hidden></div>
    <div class="milo-stage">${miloSvg(76)}</div>
    <div class="milo-palette" id="milo-palette" aria-hidden="true">${swatchesHtml()}${themeToggleHtml()}</div>`;
  document.body.appendChild(fab);

  const palette = fab.querySelector("#milo-palette");
  let hideT;
  const showPalette = () => {
    palette.classList.add("show");
    clearTimeout(hideT);
    hideT = setTimeout(() => palette.classList.remove("show"), 3500); // quelques secondes
  };
  const hideSoon = () => {
    clearTimeout(hideT);
    hideT = setTimeout(() => palette.classList.remove("show"), 600);
  };
  fab.addEventListener("mouseenter", showPalette);
  fab.addEventListener("mouseleave", hideSoon);
  // Clic sur Milo → sa fiche (la palette reste accessible au survol).
  fab.querySelector(".milo-stage").addEventListener("click", () => location.assign("/@milo"));

  fab.querySelectorAll(".swatch").forEach((s) =>
    s.addEventListener("click", () => {
      applyAccent(s.dataset.accent);
      try {
        localStorage.setItem(ACCENT_STORE, s.dataset.accent);
      } catch {}
      showPalette();
      miloSay(
        s.dataset.accent === "rainbow"
          ? "Mode caméléon total 🌈"
          : pick(["Joli choix !", "Je m'adapte 🦎", "Ça me va bien ?"])
      );
    })
  );

  fab.querySelector(".theme-toggle").addEventListener("click", (e) => {
    e.stopPropagation();
    const next = toggleTheme();
    showPalette();
    miloSay(next === "light" ? "Mode clair ☀️" : "Mode sombre 🌙");
  });

  // Applique l'accent stocké (met le bon swatch actif).
  applyAccent(storedAccent() || ACCENTS[0].v);
  // Synchronise l'icône du bouton thème.
  applyTheme(storedTheme() || "dark");

  // Flottement + phrases qui passent de temps en temps.
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (window.gsap && !reduce)
    window.gsap.to("#milo-fab .milo-stage", { y: -5, duration: 2, repeat: -1, yoyo: true, ease: "sine.inOut" });

  const lines = [
    "Salut, moi c'est Milo 👋",
    "Crée ta page en 30 secondes.",
    "Un seul lien : @toi.",
    "Scanne mon QR pour partager.",
    "Branche-moi à ton IA via MCP.",
    "Survole-moi pour changer ma couleur 🦎",
    "Je suis français 🇫🇷",
    "Vos données sont en sécurité, hébergées en France 🔒",
  ];
  let li = 0;
  setTimeout(() => miloSay(lines[0]), 800);
  if (!reduce) {
    miloSay._loop = setInterval(() => {
      li = (li + 1) % lines.length;
      miloSay(lines[li]);
    }, 13000);
  }
}

// L'œil de Milo suit la souris (tous les Milo présents sur la page).
function setupMiloEyes() {
  if (setupMiloEyes._on) return;
  setupMiloEyes._on = true;
  window.addEventListener("mousemove", (e) => {
    document.querySelectorAll(".milo .milo-look").forEach((g) => {
      const svg = g.closest("svg");
      const r = svg.getBoundingClientRect();
      if (!r.width) return;
      const ex = r.left + r.width * (89 / 120);
      const ey = r.top + r.height * (45 / 120);
      const dx = e.clientX - ex;
      const dy = e.clientY - ey;
      const d = Math.hypot(dx, dy) || 1;
      const max = 2.8; // unités viewBox
      g.setAttribute("transform", `translate(${(dx / d) * max} ${(dy / d) * max})`);
    });
  });
}

/* ----------------------- Visite guidée « Milo » (Shepherd) --------------- */
// Visite guidée propulsée par Shepherd.js (vendored, exposé en window.Shepherd).
// UNIQUEMENT côté web : Milo joue le guide, avec deux ambiances au choix —
// « simple » (tour du propriétaire) ou « technique » (sous le capot).

let _miloTour = null; // instance Shepherd active (une seule à la fois)

// Bulle « Milo parle » : avatar caméléon + texte, pour chaque étape.
function miloTourStepHtml(body) {
  return `<div class="milo-tour-step"><div class="milo-tour-ava">${miloSvg(46)}</div><div class="milo-tour-say">${body}</div></div>`;
}

// Navigue le deck de l'éditeur jusqu'à la colonne `label`, puis laisse
// l'animation GSAP se poser avant que Shepherd ne (re)positionne la bulle.
function tourGoto(label) {
  return new Promise((resolve) => {
    const i = deckState.cols.findIndex((c) => c.dataset.deckLabel === label);
    if (i >= 0 && deckState.go) deckState.go(i);
    setTimeout(resolve, 430);
  });
}

// Ouvre un onglet interne de la colonne Options (Confidentialité/Sécurité/Accès…).
function tourOptTab(tab) {
  const btn = document.querySelector(`.opt-tab[data-tab="${tab}"]`);
  if (btn) btn.click();
  return new Promise((resolve) => setTimeout(resolve, 200));
}

// Étapes de la visite, selon l'ambiance. Chaque étape : sélecteur cible (ou null
// = bulle centrée), placement, HTML, et navigation préalable optionnelle.
function miloTourSteps(mode) {
  if (mode === "tech") {
    return [
      { sel: ".site-header .brand", on: "bottom", html:
        "Salut, Milo à l'appareil 🦎. Version <b>technique</b> : on soulève le capot. <b>mindlog · id</b>, c'est une <b>PWA</b> (installable, hors-ligne via service worker) qui sert de référence à tous les clients — Android natif, desktop Tauri, et le connecteur <b>MCP</b>." },
      { nav: () => tourGoto("Menu"), sel: ".hm-banner", on: "bottom", html:
        "Le tableau de bord est rendu côté client : un <b>SPA en JS vanilla</b>, zéro framework. En face, le serveur tourne sous <b>Hono + Postgres</b> (Drizzle ORM), 100 % TypeScript." },
      { nav: () => tourGoto("Menu"), sel: ".hm-privacy-toggles", on: "right", html:
        "Chaque réglage de confidentialité est persisté côté serveur et appliqué à ta page publique. Profil, agenda, galerie : <b>granularité par flag</b>, modifié en direct." },
      { nav: () => tourGoto("Chat"), sel: ".comm-sidebar", on: "right", html:
        "La messagerie : chiffrement <b>E2E par Double Ratchet</b>, établissement de session via <b>X3DH</b> (P-256 maison). Le serveur ne stocke que du chiffré — <b>forward secrecy</b> comprise. Même moi je n'y vois que du charabia." },
      { nav: () => tourGoto("Options").then(() => tourOptTab("securite")), sel: "#opt-vault-banner", on: "bottom", html:
        "Le <b>coffre de clés</b> : ta clé privée est chiffrée <i>dans</i> le navigateur (passkey PRF ou passphrase) puis stockée illisible. Le serveur ne voit jamais la clé en clair — ni ta passphrase." },
      { nav: () => tourGoto("Options").then(() => tourOptTab("acces")), sel: "#devices-list", on: "top", html:
        "<b>Multi-appareils façon Signal</b> : chaque appareil a sa propre clé, les enveloppes sont diffusées en <b>fan-out</b>, et un nouvel appareil doit être <b>approuvé</b> depuis un appareil déjà actif." },
      { nav: () => tourGoto("Relations"), sel: "section[data-deck-label=\"Relations\"]", on: "left", html:
        "Réseau à <b>3 degrés</b>, vérification anti-MITM par <b>numéro de sécurité</b> (QR à scanner). Et les groupes ? <b>Sender keys</b> + signatures ECDSA. Du sérieux." },
      { nav: () => tourGoto("Identité"), sel: "#tags-edit", on: "bottom", html:
        "Ta carte est structurée : attributs typés, tags, photo redimensionnée côté client. Le tout exposé par une <b>API REST documentée</b> (OpenAPI)." },
      { sel: ".site-header .brand", on: "bottom", html:
        "Bouquet final : le connecteur <b>MCP</b>. N'importe quelle IA (Claude, ChatGPT…) peut lire et modifier ta carte à ta place — c'est d'ailleurs comme ça que je gère ton agenda 🦎. Fin de la visite technique !" },
    ];
  }
  // Ambiance « simple » par défaut.
  return [
    { sel: ".site-header .brand", on: "bottom", html:
      "Bienvenue chez toi ! Ici, c'est ta <b>carte d'identité en ligne</b>. Un seul lien — <b>@toi</b> — et le tour est joué. Suis-moi, je connais tous les recoins (je m'y cache souvent) 🦎" },
    { nav: () => tourGoto("Menu"), sel: ".hm-banner", on: "bottom", html:
      "Voici ton <b>tableau de bord</b> : ta photo, ton nom, ton @. C'est ta vitrine. Mets une belle photo… je te jugerai pas. Enfin, à peine 😏" },
    { nav: () => tourGoto("Menu"), sel: ".hm-privacy-toggles", on: "right", html:
      "Ces interrupteurs décident de ce que le monde voit : <b>profil, agenda, galerie</b>. Tu gardes la main sur tout. Discret comme un caméléon, ça te parle ?" },
    { nav: () => tourGoto("Menu"), sel: "#menu-nav", on: "top", html:
      "Les <b>actions rapides</b> : ton ID, ton agenda, ton réseau… et surtout <b>Discuter</b> et <b>Appel vidéo</b>. Un clic, et hop." },
    { sel: "#bottom-nav", on: "top", html:
      "La barre du bas, c'est ma télécommande : Accueil, Chat, Réseau, Agenda, Options… On saute partout sans se perdre." },
    { nav: () => tourGoto("Chat"), sel: ".comm-sidebar", on: "right", html:
      "La <b>messagerie</b> ! Chiffrée de bout en bout — même moi je peux pas lire (et pourtant, qu'est-ce que je suis curieux). Choisis un contact et lance-toi." },
    { nav: () => tourGoto("Identité"), sel: "#tags-edit", on: "bottom", html:
      "Ta <b>carte détaillée</b> : tags, attributs, photo, QR code. Personnalise tout ça, c'est ta page rien qu'à toi." },
    { nav: () => tourGoto("Menu"), sel: "#hm-qr-btn", on: "left", html:
      "Et ce <b>QR code</b>, c'est ton sésame : on le scanne, on est connectés. Voilà, tu sais l'essentiel ! Bonne route 🦎" },
  ];
}

// Construit et démarre la visite. mode = "simple" | "tech".
function startMiloTour(mode) {
  if (!window.Shepherd) {
    toast("🦎 Oups, la visite n'a pas pu se charger. Réessaie après un rafraîchissement.");
    return;
  }
  if (_miloTour) { try { _miloTour.complete(); } catch {} _miloTour = null; }

  const tour = new window.Shepherd.Tour({
    useModalOverlay: true,
    defaultStepOptions: {
      classes: "milo-shepherd",
      scrollTo: { behavior: "smooth", block: "center" },
      cancelIcon: { enabled: true },
      arrow: true,
    },
  });
  _miloTour = tour;

  const steps = miloTourSteps(mode);
  steps.forEach((st, i) => {
    const isFirst = i === 0;
    const isLast = i === steps.length - 1;
    const buttons = [];
    if (!isFirst) buttons.push({ text: "← Retour", classes: "shepherd-button-secondary", action: () => tour.back() });
    buttons.push(isLast
      ? { text: "Terminer 🦎", action: () => tour.complete() }
      : { text: "Suivant →", action: () => tour.next() });

    tour.addStep({
      id: "milo-" + i,
      text: miloTourStepHtml(st.html),
      // Cible résolue à l'affichage (après navigation) ; null → bulle centrée.
      attachTo: st.sel ? { element: () => document.querySelector(st.sel), on: st.on || "bottom" } : undefined,
      beforeShowPromise: st.nav ? st.nav : undefined,
      buttons,
    });
  });

  const finish = (msg) => {
    try { localStorage.setItem(TOUR_SEEN_KEY, "1"); } catch {}
    _miloTour = null;
    if (msg) toast(msg);
  };
  tour.on("complete", () => finish("🦎 Visite terminée ! Je retourne me fondre dans le décor. À toi de jouer."));
  tour.on("cancel", () => finish(null));

  tour.start();
}

// Sélecteur d'ambiance : Milo demande « visite simple » ou « présentation
// technique ». Marque la visite comme « vue » dès l'ouverture (pas de relance auto).
function openMiloTourPicker() {
  if (document.getElementById("milo-tour-picker")) return; // déjà ouvert
  try { localStorage.setItem(TOUR_SEEN_KEY, "1"); } catch {}

  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.id = "milo-tour-picker";
  overlay.innerHTML = `
    <div class="panel milo-tour-panel" role="dialog" aria-modal="true" aria-labelledby="mtp-title">
      <button type="button" class="close" id="mtp-close" aria-label="Fermer">✕</button>
      <div class="milo-tour-hero">${miloSvg(84)}</div>
      <h2 id="mtp-title">Coucou, c'est Milo 🦎</h2>
      <p class="subtitle">Je suis le caméléon de la maison — je connais chaque recoin (j'y suis souvent planqué). Je te fais visiter ? Choisis ton ambiance :</p>
      <div class="milo-tour-choices">
        <button type="button" class="milo-tour-choice" data-mode="simple">
          <span class="mtc-emo">🍃</span>
          <span class="mtc-t">Visite simple</span>
          <span class="mtc-d">Le tour du propriétaire, tranquille et sans jargon.</span>
        </button>
        <button type="button" class="milo-tour-choice" data-mode="tech">
          <span class="mtc-emo">🔬</span>
          <span class="mtc-t">Présentation technique</span>
          <span class="mtc-d">On soulève le capot : chiffrement E2E, multi-appareils, MCP…</span>
        </button>
      </div>
      <button type="button" class="btn sm milo-tour-skip" id="mtp-skip">Plus tard — laisse-moi explorer seul</button>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector("#mtp-close").addEventListener("click", close);
  overlay.querySelector("#mtp-skip").addEventListener("click", () => {
    close();
    toast("🦎 Pas de souci ! Le bouton « Visite » t'attendra sur l'accueil.");
  });
  overlay.querySelectorAll(".milo-tour-choice").forEach((btn) =>
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode;
      close();
      // Petit délai : laisse l'overlay se fermer avant d'ouvrir la 1re bulle.
      setTimeout(() => startMiloTour(mode), 120);
    })
  );
}

/* --------------------------- Récupération de clé ------------------------- */

function openRecover() {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="panel" role="dialog" aria-modal="true" aria-labelledby="rc-title">
      <button type="button" class="close" id="rc-close" aria-label="Fermer">✕</button>
      <h2 id="rc-title">Récupérer l'accès</h2>

      <div class="rc-tabs" role="tablist">
        <button class="rc-tab active" data-tab="passkey" role="tab">${icon("shield",14)} Passkey</button>
        <button class="rc-tab" data-tab="email" role="tab">${icon("mail",14)} Email</button>
      </div>

      <div id="rc-panel-passkey">
        <p class="sub">Connectez-vous avec votre empreinte, Face ID ou clé de sécurité.</p>
        <div class="group">
          <label for="rc-pk-handle">Votre handle</label>
          <div class="handle-input"><span>@</span><input id="rc-pk-handle" autocomplete="username" /></div>
        </div>
        <div class="err" id="rc-pk-err"></div>
        <div class="actions">
          <button type="button" class="btn" id="rc-pk-cancel">Annuler</button>
          <button type="button" class="btn primary" id="rc-pk-btn">${icon("shield",15)} Se connecter avec une passkey</button>
        </div>
      </div>

      <div id="rc-panel-email" hidden>
        <p class="sub">Entrez votre handle et l'email de récupération enregistré. Une nouvelle clé sera générée (l'ancienne cessera de fonctionner).</p>
        <form id="rc-form">
          <div class="group">
            <label for="rc-handle">Handle</label>
            <div class="handle-input"><span>@</span><input id="rc-handle" autocomplete="off" required /></div>
          </div>
          <div class="group">
            <label for="rc-email">Email de récupération</label>
            <input id="rc-email" type="email" required placeholder="vous@exemple.com" />
          </div>
          <div class="err" id="rc-err"></div>
          <div class="actions">
            <button type="button" class="btn" id="rc-cancel">Annuler</button>
            <button type="submit" class="btn primary">Récupérer</button>
          </div>
        </form>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => e.target === overlay && close());
  overlay.querySelectorAll("#rc-close, #rc-cancel, #rc-pk-cancel").forEach((b) =>
    b.addEventListener("click", close)
  );

  // Onglets
  overlay.querySelectorAll(".rc-tab").forEach((tab) =>
    tab.addEventListener("click", () => {
      overlay.querySelectorAll(".rc-tab").forEach((t) => t.classList.toggle("active", t === tab));
      overlay.querySelector("#rc-panel-passkey").hidden = tab.dataset.tab !== "passkey";
      overlay.querySelector("#rc-panel-email").hidden = tab.dataset.tab !== "email";
    })
  );
  // Pré-remplit le handle de la dernière connexion (l'utilisateur peut le changer).
  const pkHandle = overlay.querySelector("#rc-pk-handle");
  const last = lastHandle();
  if (last) {
    pkHandle.value = last;
    overlay.querySelector("#rc-handle").value = last; // onglet e-mail aussi
  }
  pkHandle.focus();
  pkHandle.select();

  // Connexion passkey
  overlay.querySelector("#rc-pk-btn").addEventListener("click", async () => {
    if (!window.PublicKeyCredential) {
      overlay.querySelector("#rc-pk-err").textContent = "Passkeys non supportées sur cet appareil";
      return;
    }
    const handle = overlay.querySelector("#rc-pk-handle").value.trim();
    if (!handle) { overlay.querySelector("#rc-pk-err").textContent = "Handle requis"; return; }
    overlay.querySelector("#rc-pk-err").textContent = "";
    try {
      const options = await api("/api/passkeys/auth/begin", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle }),
      });
      const { startAuthentication } = await import("https://unpkg.com/@simplewebauthn/browser@13/esm/index.js");
      const response = await startAuthentication({ optionsJSON: options });
      // Le serveur ouvre une session cookie (HttpOnly) ; aucune clé n'est stockée côté client.
      const { handle: h } = await api("/api/passkeys/auth/finish", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle, response }),
      });
      setLastHandle(h || handle);
      setSessionHint(true);
      overlay.remove();
      location.assign("/me");
    } catch (e) {
      if (e.name !== "NotAllowedError")
        overlay.querySelector("#rc-pk-err").textContent = e.message || "Authentification annulée";
    }
  });

  // Récupération par email (inchangée)
  overlay.querySelector("#rc-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = overlay.querySelector("#rc-err");
    errEl.textContent = "";
    try {
      const r = await api("/api/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: overlay.querySelector("#rc-handle").value,
          email: overlay.querySelector("#rc-email").value,
        }),
      });
      if (r.sent) {
        overlay.querySelector(".panel").innerHTML = `
          <div class="created">
            <h2>Email envoyé 📬</h2>
            <p class="sub">Un nouveau lien privé pour <strong>@${esc(r.handle)}</strong> vient d'être envoyé à votre adresse. L'ancienne clé ne fonctionne plus.</p>
            <div class="actions"><button type="button" class="btn primary" id="rc-ok">Compris</button></div>
          </div>`;
        overlay.querySelector("#rc-ok").addEventListener("click", () => overlay.remove());
      } else {
        showCreated(overlay, { publicUrl: `/@${r.handle}`, privateUrl: `/k/${encodeURIComponent(r.accessKey)}` });
      }
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

/* --------------------------- Upgrade Premium (CTA) ----------------------- */
// CTA « Passer Premium » de l'accueil. Connecté → on rejoint l'espace qui lance
// le Checkout ; anonyme → on mémorise l'intention puis on ouvre la création de
// compte (reprise automatique du Checkout après inscription, cf. editor handleBilling).
function startPremiumUpgrade() {
  if (isLoggedIn()) {
    location.assign("/me?upgrade=start");
    return;
  }
  try { sessionStorage.setItem("mindlog.pendingUpgrade", "1"); } catch { /* storage indispo */ }
  openCreate();
}

/* ----------------------------- Création (modal) -------------------------- */

function openCreate() {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="panel" role="dialog" aria-modal="true" aria-labelledby="cr-title">
      <button type="button" class="close" id="cr-close" aria-label="Fermer">✕</button>
      <h2 id="cr-title">Créer votre page</h2>
      <p class="sub">Choisissez un handle public. Une clé privée sera générée pour l'édition.</p>
      <form id="create-form">
        <div class="group">
          <label for="cr-handle">Handle</label>
          <div class="handle-input"><span>@</span><input id="cr-handle" autocomplete="off" placeholder="votre-handle" required /></div>
        </div>
        <div class="group">
          <label for="cr-name">Nom affiché (optionnel)</label>
          <input id="cr-name" placeholder="Votre nom" />
        </div>
        <div class="group">
          <label for="cr-email">Email de récupération (optionnel)</label>
          <input id="cr-email" type="email" placeholder="vous@exemple.com" />
          <p class="hint">Permet de récupérer l'accès si vous perdez votre clé privée.</p>
        </div>
        ${TURNSTILE_SITE_KEY ? '<div class="group"><div id="cr-turnstile"></div></div>' : ""}
        <div class="err" id="cr-err"></div>
        <div class="actions">
          <button type="button" class="btn" id="cr-cancel">Annuler</button>
          <button type="submit" class="btn primary">Créer</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(overlay);

  // Widget anti-robot Cloudflare Turnstile (si une clé de site est configurée).
  // On ne bloque PAS l'envoi côté client : le serveur tranche (et court-circuite
  // localhost), ce qui garde le développement et les tests fonctionnels.
  let turnstileToken = "";
  // En dev (hôte .localhost ou loopback), le serveur ignore Turnstile — on
  // n'instancie même pas le widget pour éviter les faux « Verification failed »
  // sous Chrome devtools mobile-emulation (UA spoofé → CF marque suspect).
  const _isDevHost = /(^|\.)localhost$/i.test(location.hostname)
    || location.hostname === "127.0.0.1" || location.hostname === "::1";
  if (TURNSTILE_SITE_KEY && !_isDevHost) {
    const renderTurnstile = () => {
      if (!window.turnstile) return setTimeout(renderTurnstile, 200);
      if (!overlay.isConnected) return; // modale fermée entre-temps
      window.turnstile.render("#cr-turnstile", {
        sitekey: TURNSTILE_SITE_KEY,
        theme: "dark",
        callback: (tok) => (turnstileToken = tok),
        "error-callback": () => (turnstileToken = ""),
        "expired-callback": () => (turnstileToken = ""),
      });
    };
    renderTurnstile();
  } else if (TURNSTILE_SITE_KEY && _isDevHost) {
    const slot = overlay.querySelector("#cr-turnstile");
    if (slot) slot.innerHTML = `<div class="dev-note">Mode dev — anti-bot désactivé</div>`;
  }

  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => e.target === overlay && close());
  overlay.querySelector("#cr-cancel").addEventListener("click", close);
  overlay.querySelector("#cr-close").addEventListener("click", close);
  document.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape") {
      close();
      document.removeEventListener("keydown", esc);
    }
  });
  overlay.querySelector("#cr-handle").focus();

  overlay.querySelector("#create-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = overlay.querySelector("#cr-err");
    errEl.textContent = "";
    const handle = overlay.querySelector("#cr-handle").value;
    const display_name = overlay.querySelector("#cr-name").value;
    const email = overlay.querySelector("#cr-email").value;
    try {
      const r = await api("/api/identities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle, display_name, email, turnstileToken }),
      });
      // Initialise la clé E2E dès la création du compte, sans attendre l'ouverture de l'éditeur.
      ensureE2E(r.handle, r.accessKey).catch(() => {});
      showCreated(overlay, {
        publicUrl: `/@${r.handle}`,
        privateUrl: `/k/${encodeURIComponent(r.accessKey)}`,
        accessKey: r.accessKey,
      });
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

function showCreated(overlay, r) {
  const origin = location.origin;
  const hasPasskey = r.accessKey && window.PublicKeyCredential;
  overlay.querySelector(".panel").innerHTML = `
    <div class="created">
      <h2>Page créée 🎉</h2>
      <p class="sub">Votre lien public est prêt. <strong>Conservez la clé privée</strong> — c'est le seul accès en écriture, elle ne sera plus affichée.</p>

      <label>Lien public</label>
      <div class="url-row"><code>${esc(origin + r.publicUrl)}</code><button class="btn copy" data-copy="${esc(origin + r.publicUrl)}">Copier</button></div>

      <label>Lien privé (avec la clé)</label>
      <div class="url-row"><code>${esc(origin + r.privateUrl)}</code><button class="btn copy" data-copy="${esc(origin + r.privateUrl)}">Copier</button></div>
      <p class="warn">⚠ Sauvegardez ce lien privé maintenant.</p>

      <div class="actions">
        ${hasPasskey ? `<button type="button" class="btn" id="cr-passkey">${icon("shield",15)} Créer une passkey</button>` : ""}
        <a class="btn primary" href="${esc(r.privateUrl)}">Éditer ma page →</a>
      </div>
    </div>`;
  overlay.querySelectorAll(".copy").forEach((b) =>
    b.addEventListener("click", () => {
      copyText(b.dataset.copy);
      toast(t("msg_copied"));
    })
  );
  overlay.querySelector("#cr-passkey")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.innerHTML = `${icon("shield",15)} Création…`;
    try {
      const opts = await api("/api/passkeys/register/begin", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-access-key": r.accessKey },
        body: JSON.stringify({ name: "Ma première passkey" }),
      });
      const { startRegistration } = await import("https://unpkg.com/@simplewebauthn/browser@13/esm/index.js");
      const response = await startRegistration({ optionsJSON: opts });
      await api("/api/passkeys/register/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-access-key": r.accessKey },
        body: JSON.stringify({ name: "Ma première passkey", response }),
      });
      btn.innerHTML = `${icon("shield",15)} Passkey créée ✓`;
    } catch (err) {
      if (err.name !== "NotAllowedError") toast(err.message || "Annulé");
      btn.disabled = false;
      btn.innerHTML = `${icon("shield",15)} Créer une passkey`;
    }
  });
}

/* ------------------------------ QR code ---------------------------------- */

// Normalise une URL de site saisie sans schéma (« exemple.fr » → « https://… »).
function normalizeUrl(u) {
  const v = (u || "").trim();
  return v && !/^https?:\/\//i.test(v) ? `https://${v}` : v;
}

/**
 * Construit une signature email à partir des champs publics de la carte.
 * Renvoie { html, text } : `html` pour un collage enrichi (Gmail/Outlook),
 * `text` en repli pour les éditeurs sans mise en forme.
 */
function buildEmailSignature(data, url) {
  const get = (k) => data.fields?.find((f) => f.key === k)?.value?.trim() || "";
  const name = get("display_name") || data.handle;
  const role = [get("title"), get("company")].filter(Boolean).join(" · ");
  const email = get("email");
  const phone = get("phone");
  const site = normalizeUrl(get("website"));
  const location = get("location");

  // -- Texte brut --
  const text = [
    name,
    role,
    email,
    phone,
    site,
    location,
    `${url} (mindlog · id)`,
  ].filter(Boolean).join("\n");

  // -- HTML (styles inline : seuls fiables dans les clients mail) --
  const blue = "#2563eb";
  const rows = [];
  rows.push(`<div style="font-weight:700;font-size:15px;color:#0f1115">${esc(name)}</div>`);
  if (role) rows.push(`<div style="color:#555;padding-top:1px">${esc(role)}</div>`);
  const lines = [];
  if (email) lines.push(`✉&nbsp;<a href="mailto:${esc(email)}" style="color:${blue};text-decoration:none">${esc(email)}</a>`);
  if (phone) lines.push(`☎&nbsp;<a href="tel:${esc(phone.replace(/\s+/g, ""))}" style="color:#0f1115;text-decoration:none">${esc(phone)}</a>`);
  if (site) lines.push(`🌐&nbsp;<a href="${esc(site)}" style="color:${blue};text-decoration:none">${esc(site.replace(/^https?:\/\//i, ""))}</a>`);
  if (location) lines.push(`📍&nbsp;${esc(location)}`);
  if (lines.length) rows.push(`<div style="padding-top:6px">${lines.join("<br>")}</div>`);
  rows.push(`<div style="padding-top:6px"><a href="${esc(url)}" style="color:${blue};text-decoration:none">@${esc(data.handle)} · mindlog&nbsp;·&nbsp;id</a></div>`);
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#0f1115">${rows.join("")}</div>`;

  return { html, text };
}

// Copie une signature en HTML enrichi (avec repli texte brut) dans le presse-papier.
async function copyRichSignature(sig) {
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([sig.html], { type: "text/html" }),
          "text/plain": new Blob([sig.text], { type: "text/plain" }),
        }),
      ]);
    } else {
      await copyText(sig.text);
    }
    toast("Signature copiée");
  } catch {
    await copyText(sig.text);
    toast("Signature copiée");
  }
}

function openQR(url, label) {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="panel" role="dialog" aria-modal="true" aria-labelledby="qr-title">
      <button type="button" class="close" id="qr-close" aria-label="Fermer">✕</button>
      <h2 id="qr-title">Partager ${esc(label)}</h2>
      <p class="sub">Scannez ce code pour ouvrir la page et toutes ses infos.</p>
      <div class="qr-box" id="qr-box"></div>
      <div class="url-row"><code>${esc(url)}</code><button class="btn copy" data-copy="${esc(url)}">Copier</button></div>
      <div class="actions"><a class="btn primary" id="qr-dl" download="mindlog-qr.png">Télécharger</a></div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => e.target === overlay && close());
  overlay.querySelector("#qr-close").addEventListener("click", close);
  overlay.querySelector(".copy").addEventListener("click", () => {
    copyText(url);
    toast("Copié");
  });

  const box = overlay.querySelector("#qr-box");
  const dl = overlay.querySelector("#qr-dl");
  if (window.QRCode) {
    new window.QRCode(box, {
      text: url,
      width: 200,
      height: 200,
      colorDark: "#0f1115",
      colorLight: "#ffffff",
      correctLevel: window.QRCode.CorrectLevel.M,
    });
    setTimeout(() => {
      const img = box.querySelector("img");
      const canvas = box.querySelector("canvas");
      const src = img?.src || canvas?.toDataURL("image/png");
      if (src) dl.href = src;
      else dl.style.display = "none";
    }, 200);
  } else {
    box.innerHTML = '<p class="sub" style="padding:2rem 0">QR indisponible (librairie non chargée).</p>';
    dl.style.display = "none";
  }
}

/* ----------------------- Conversation éphémère (chat) -------------------- */
// La fenêtre de chat est fournie par le plugin `public/plugins/chat.js`
// (registre de plugins) et exposée via `host.chat.open(handle, key, myHandle)`.

/* ============================ PROFIL PUBLIC ============================== */

// Bouton « ← Retour » unifié : touch target 44×44, label visible, comportement
// prévisible. Préfère history.back() si on est arrivé via navigation interne
// (referrer même origine), sinon retombe sur `fallbackHref`. Annonce le lien
// de destination via aria-label pour les lecteurs d'écran.
function backBtnHtml(fallbackHref, ariaLabel = "Retour") {
  return `<button type="button" class="back-btn" data-fallback="${esc(fallbackHref)}" aria-label="${esc(ariaLabel)}">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
    <span>Retour</span>
  </button>`;
}
function wireBackBtn(root) {
  root.querySelectorAll(".back-btn[data-fallback]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const fallback = btn.dataset.fallback || "/";
      const sameOrigin = document.referrer && new URL(document.referrer, location.href).origin === location.origin;
      if (window.history.length > 1 && sameOrigin) window.history.back();
      else location.assign(fallback);
    });
  });
}

// Index de l'« Espace privé » d'un créateur (route /@handle/space).
// Présente le titre/avatar du créateur, le tarif, la liste des pages premium,
// et un CTA d'abonnement si le visiteur n'a pas accès. Réutilise `data.space`
// déjà calculé côté serveur dans /api/identities/:handle.
async function renderSpaceIndex(handle) {
  app.innerHTML = `<p class="loading">Chargement…</p>`;
  await loadAuth();
  let data;
  try {
    data = await api(`/api/identities/${encodeURIComponent(handle.replace(/^@/, ""))}`, {
      headers: viewerHeaders(),
    });
  } catch {
    app.innerHTML = `
      ${siteHeader({ right: headerAccount() })}
      <div class="card" style="text-align:center;max-width:420px;margin:3rem auto">
        <div class="empty-milo">${miloSvg(110)}</div>
        <h1>Introuvable</h1>
        <p class="subtitle">Aucune identité « @${esc(handle)} ».</p>
        <a class="btn primary" href="/">Retour</a>
      </div>`;
    return;
  }

  const sp = data.space;
  const isSelf = !!(data.viewer && data.viewer.handle === data.handle);
  const canAccess = isSelf || !!sp?.subscribed;
  const pages = Array.isArray(sp?.pages) ? sp.pages : [];
  const price = sp?.price_cents
    ? `${(sp.price_cents / 100).toFixed(2).replace(".", ",")} ${(sp.currency || "eur").toUpperCase()}/mois`
    : "";
  const pageIcon = (t) =>
    t === "gallery" ? icon("image", 16)
    : t === "link"  ? icon("link", 16)
    : t === "file"  ? icon("download", 16)
    : icon("chat", 16);

  // En-tête : avatar + nom + handle du créateur, bouton retour standard.
  const displayName =
    data.fields?.find((f) => f.key === "display_name")?.value || data.handle;
  const avatar = data.hasPhoto
    ? `<img class="spx-avatar" src="/api/identities/${encodeURIComponent(data.handle)}/photo?ts=${Date.now()}" alt="">`
    : data.handle === "milo"
      ? `<div class="spx-avatar spx-avatar-milo">${miloSvg(56)}</div>`
      : `<div class="spx-avatar spx-avatar-gen">${genericAvatarSvg(data.handle, (displayName[0] || "·").toUpperCase())}</div>`;

  const backHref = `/@${esc(handle)}`;

  // Corps : pour un visiteur, l'espace n'existe que si tarif fixé ET au moins
  // une page publiée. Sinon (et hors propriétaire), on bascule sur l'état vide.
  if (!sp || (!isSelf && (!pages.length || !sp.price_cents))) {
    app.innerHTML = `
      ${siteHeader({ right: headerAccount() })}
      <div class="spx" role="main">
        <div class="spx-topbar">${backBtnHtml(backHref, `Retour vers @${esc(handle)}`)}</div>
        <div class="card spx-empty">
          <div class="empty-milo">${miloSvg(80)}</div>
          <h1>Pas d'espace privé</h1>
          <p class="subtitle">@${esc(handle)} n'a pas encore publié de page réservée.</p>
          <a class="btn" href="/@${esc(handle)}">Voir le profil de @${esc(handle)}</a>
        </div>
      </div>`;
    footer.innerHTML = `<a class="brand" href="/" style="justify-content:center"><span class="brand-milo">${miloSvg(40)}</span> mindlog · id</a>`;
    applyTheme(storedTheme() || "dark");
    wireHeaderSearch();
    wireProfileMenuBtn();
    wireBackBtn(app);
    return;
  }

  // Grille de pages : auto-fill 1→3 colonnes selon largeur écran (240px min).
  const pagesHtml = canAccess
    ? `<div class="spx-grid" role="list">
         ${pages.map((p) => {
           const isDraft = p.published === false;
           return `<a class="spx-card${isDraft ? " is-draft" : ""}" role="listitem" href="/@${esc(handle)}/p/${esc(p.slug)}">
             <span class="spx-card-ic">${pageIcon(p.type)}</span>
             <span class="spx-card-title">${esc(p.title)}</span>
             ${isDraft ? `<span class="spx-card-badge">brouillon</span>` : ""}
             <span class="spx-card-arrow" aria-hidden="true">→</span>
           </a>`;
         }).join("")}
       </div>`
    : `<div class="spx-grid spx-grid--teaser" role="list" aria-hidden="true">
         ${pages.map((p) =>
           `<div class="spx-card spx-card--locked" role="listitem">
             <span class="spx-card-ic">${pageIcon(p.type)}</span>
             <span class="spx-card-title">${esc(p.title)}</span>
             <span class="spx-card-lock">${icon("lock", 16)}</span>
           </div>`).join("")}
       </div>`;

  // CTA principal de la page espace privé. Un seul bouton primaire — règle
  // « primary-action ». Pas de tarif fixé = pas d'espace vendable → pas de CTA.
  const cta = isSelf
    ? `<a class="btn primary spx-cta" href="/me/premium" aria-label="Gérer mon espace privé">
         ${icon("sparkles", 18)}<span>Gérer mon espace</span>
       </a>`
    : canAccess
      ? `<div class="spx-status spx-status--ok" role="status">${icon("shield", 16)} Accès débloqué — ${pages.length} page${pages.length > 1 ? "s" : ""} disponible${pages.length > 1 ? "s" : ""}</div>`
      : sp.price_cents
        ? `<button type="button" class="btn primary spx-cta" id="spx-subscribe"
               aria-label="S'abonner à l'espace privé de @${esc(handle)} pour ${esc(price)}">
             ${icon("sparkles", 18)}
             <span class="spx-cta-main">S'abonner pour <b>${esc(price)}</b></span>
           </button>
           <p class="spx-cta-sub">Accès immédiat aux ${pages.length} page${pages.length > 1 ? "s" : ""} réservée${pages.length > 1 ? "s" : ""} · résiliable à tout moment</p>`
        : "";

  app.innerHTML = `
    ${siteHeader({ right: headerAccount() })}
    <div class="spx" role="main">
      <div class="spx-topbar">${backBtnHtml(backHref, `Retour vers @${esc(handle)}`)}</div>

      <header class="spx-hero">
        <div class="spx-hero-id">
          ${avatar}
          <div class="spx-hero-text">
            <p class="spx-hero-eyebrow">${icon("lock", 12)} Espace privé</p>
            <h1 class="spx-hero-title">${esc(displayName)}</h1>
            <p class="spx-hero-meta">
              <a href="/@${esc(handle)}">@${esc(handle)}</a>
              <span aria-hidden="true">·</span>
              <span>${pages.length} page${pages.length > 1 ? "s" : ""}${canAccess ? "" : " réservée" + (pages.length > 1 ? "s" : "")}</span>
              ${price ? `<span aria-hidden="true">·</span><span class="spx-price">${esc(price)}</span>` : ""}
            </p>
          </div>
        </div>
        <div class="spx-hero-cta">${cta}</div>
      </header>

      ${sp?.intro_md ? `<section class="spx-intro" aria-label="Mot d'accueil">${mdLite(sp.intro_md)}</section>` : ""}

      ${pagesHtml}
    </div>`;
  footer.innerHTML = `<a class="brand" href="/" style="justify-content:center"><span class="brand-milo">${miloSvg(40)}</span> mindlog · id</a>`;
  applyTheme(storedTheme() || "dark");
  wireHeaderSearch();
  wireProfileMenuBtn();
  wireBackBtn(app);

  app.querySelector("#spx-subscribe")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    if (!isLoggedIn()) {
      toast("Crée un compte (ou connecte-toi) pour t'abonner à cet espace.");
      openCreate();
      return;
    }
    // « loading-buttons » : désactive le bouton et indique la progression.
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    const original = btn.innerHTML;
    btn.innerHTML = `${icon("sparkles", 18)}<span class="spx-cta-main">Redirection vers le paiement…</span>`;
    try {
      const r = await api(`/api/space/${encodeURIComponent(handle)}/subscribe`, {
        method: "POST",
        headers: viewerHeaders(),
      });
      if (r?.url) { location.assign(r.url); return; }
      if (r?.subscribed) { location.reload(); return; }
      throw new Error("Abonnement indisponible pour le moment.");
    } catch (err) {
      // Fallback dev (pas de Stripe configuré) : POST /api/dev/space-subscription
      // donne l'accès immédiat (chat, lives, notifs). MINDLOG_DEV_PREMIUM côté serveur.
      const msg = String(err?.message || "");
      const isBillingMissing = /paiement indispo|n'est pas encore vendable|stripe/i.test(msg);
      if (isBillingMissing) {
        try {
          await api("/api/dev/space-subscription", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...viewerHeaders() },
            body: JSON.stringify({ handle }),
          });
          toast(`Abonné(e) à @${handle} (dev) ✓`);
          location.reload();
          return;
        } catch (devErr) {
          toast(devErr?.message || "Abonnement dev indisponible.");
        }
      } else {
        toast(msg || "Abonnement indisponible pour le moment.");
      }
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
      btn.innerHTML = original;
    }
  });
}

// Rend le contenu de la page premium selon son type. Le serveur a déjà
// transformé les filenames internes en URLs servables (cf. route GET).
//   - markdown : rendu basique avec mise en forme paragraphe + titres simples
//   - link     : carte avec note + bouton vers l'URL externe (target=_blank)
//   - gallery  : grille d'images/vidéos avec lightbox au clic
//   - file     : bouton de téléchargement
function renderPaidPageContent(data) {
  const raw = data.content || "";
  if (data.type === "link") {
    let o = {};
    try { o = JSON.parse(raw); } catch { /* tolère */ }
    const url = o.url || "";
    return `<div class="pp-link">
      ${o.note ? `<p class="pp-link-note">${esc(o.note)}</p>` : ""}
      <a class="btn primary pp-link-cta" href="${esc(url)}" target="_blank" rel="noopener noreferrer">
        ${icon("link", 16)} Ouvrir ${esc(url.replace(/^https?:\/\//, "").slice(0, 60))} ↗
      </a>
    </div>`;
  }
  if (data.type === "gallery") {
    let items = [];
    try { items = (JSON.parse(raw).items || []).filter((it) => it.url); } catch { /* tolère */ }
    if (!items.length) return `<p class="pp-empty">Aucun média pour l'instant.</p>`;
    return `<div class="pp-gallery">${items.map((it, i) => {
      const isVideo = it.kind === "video";
      return `<button type="button" class="pp-gal-item" data-i="${i}" data-url="${esc(it.url)}" data-kind="${isVideo ? "video" : "image"}">
        ${isVideo
          ? `<video src="${esc(it.url)}" muted playsinline preload="metadata"></video>`
          : `<img src="${esc(it.url)}" alt="${esc(it.caption || "")}" loading="lazy" />`}
        ${it.caption ? `<span class="pp-gal-cap">${esc(it.caption)}</span>` : ""}
      </button>`;
    }).join("")}</div>`;
  }
  if (data.type === "file") {
    let o = {};
    try { o = JSON.parse(raw); } catch { /* tolère */ }
    if (!o.url) return `<p class="pp-empty">Aucun fichier déposé.</p>`;
    const fname = o.name || "fichier";
    const size = o.size ? `<span class="pp-file-size">${(o.size/1024).toFixed(1)} Ko</span>` : "";
    return `<div class="pp-file">
      <div class="pp-file-ic">${icon("download", 28)}</div>
      <div class="pp-file-body">
        <b>${esc(fname)}</b>
        ${size}
      </div>
      <a class="btn primary" href="${esc(o.url)}" download="${esc(fname)}">${icon("download", 14)} Télécharger</a>
    </div>`;
  }
  // markdown : on préserve sauts de ligne, on échappe le HTML, on transforme les
  // # titres et **gras** basiques. Pas un parseur complet, juste lisible.
  return `<div class="pp-markdown">${mdLite(raw)}</div>`;
}

// Mini-rendu markdown (titres ##, gras **, italique *, listes, paragraphes).
function mdLite(src) {
  const lines = String(src || "").split("\n");
  const out = [];
  let inList = false;
  for (const raw of lines) {
    const line = esc(raw)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|\s)\*([^*]+)\*(?=\s|$)/g, "$1<em>$2</em>");
    const h = line.match(/^(#{1,3})\s*(\S.*)/);
    if (h) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h${h[1].length}>${h[2]}</h${h[1].length}>`);
      continue;
    }
    const li = line.match(/^[-*]\s+(.+)/);
    if (li) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${li[1]}</li>`);
      continue;
    }
    if (inList) { out.push("</ul>"); inList = false; }
    if (line.trim()) out.push(`<p>${line}</p>`);
  }
  if (inList) out.push("</ul>");
  return out.join("");
}

// Page payante (Premium marketplace P7) : teaser + déverrouillage. Le contenu
// complet n'est rendu que si le serveur confirme l'accès (achat vérifié).
async function renderPaidPage(handle, slug) {
  app.innerHTML = `<p class="loading">Chargement…</p>`;
  await loadAuth();
  let data;
  try {
    data = await api(`/api/pages/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`, { headers: viewerHeaders() });
  } catch {
    app.innerHTML = `
      <div class="card" style="text-align:center;max-width:360px;margin:3rem auto">
        <div class="empty-milo">${miloSvg(96)}</div>
        <h1>Page introuvable</h1>
        <a class="btn primary" href="/@${esc(handle)}">Voir @${esc(handle)}</a>
      </div>`;
    return;
  }
  const price = `${(data.price_cents / 100).toFixed(2)} ${(data.currency || "eur").toUpperCase()}`;
  app.innerHTML = `
    ${siteHeader({ right: headerAccount() })}
    <div class="spx" role="main">
      <div class="spx-topbar">${backBtnHtml(`/@${esc(handle)}/space`, `Retour à l'espace privé de @${esc(handle)}`)}</div>
      <article class="card pp-view">
        <h1 style="margin:.2rem 0 1rem">${esc(data.title)}</h1>
        ${data.access
          ? renderPaidPageContent(data)
          : `<div class="pp-locked" style="text-align:center;padding:1.5rem 0">
               <div class="empty-milo">${miloSvg(72)}</div>
               <p>Contenu réservé. Débloquez l'accès pour le consulter.</p>
               <button class="btn primary" id="pp-buy">${icon("tag", 16)} Débloquer pour ${esc(price)}</button>
             </div>`}
      </article>
    </div>`;
  footer.innerHTML = `<a class="brand" href="/" style="justify-content:center"><span class="brand-milo">${miloSvg(40)}</span> mindlog · id</a>`;
  applyTheme(storedTheme() || "dark");
  wireBackBtn(app);
  // Lightbox sur clic d'une vignette galerie (réutilise le style .gal-lb).
  app.querySelectorAll(".pp-gal-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const url = btn.dataset.url;
      const kind = btn.dataset.kind;
      const lb = document.createElement("div");
      lb.className = "gal-lb";
      lb.innerHTML = `<div class="gal-lb-inner">${
        kind === "video"
          ? `<video src="${esc(url)}" controls autoplay></video>`
          : `<img src="${esc(url)}" />`
      }<button class="gal-lb-close" title="Fermer">✕</button></div>`;
      lb.addEventListener("click", (e) => { if (e.target === lb) lb.remove(); });
      lb.querySelector(".gal-lb-close").addEventListener("click", () => lb.remove());
      document.body.appendChild(lb);
    });
  });
  app.querySelector("#pp-buy")?.addEventListener("click", async () => {
    if (!isLoggedIn()) {
      toast("Crée un compte (ou connecte-toi) pour acheter cette page.");
      openCreate();
      return;
    }
    try {
      const r = await api(`/api/pages/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}/checkout`, {
        method: "POST",
        headers: viewerHeaders(),
      });
      if (r?.url) location.assign(r.url);
      else if (r?.access) renderPaidPage(handle, slug);
    } catch (e) {
      toast(e?.message || "Achat indisponible pour le moment.");
    }
  });
}

async function renderPublicProfile(handle) {
  app.innerHTML = `<p class="loading">Chargement…</p>`;
  let data;
  await loadAuth(); // résout « suis-je connecté ? » (session cookie ou clé héritée)
  try {
    data = await api(`/api/identities/${encodeURIComponent(handle.replace(/^@/, ""))}`, {
      headers: viewerHeaders(),
    });
  } catch {
    app.innerHTML = `
      <div class="card" style="text-align:center">
        <div class="empty-milo">${miloSvg(110)}</div>
        <h1>Introuvable</h1>
        <p class="subtitle">Aucune identité « @${esc(handle)} ».</p>
        <a class="btn primary" href="/">Retour à l'accueil</a>
      </div>`;
    return;
  }
  const isContact = !!data.viewer?.isContact;
  const isRelated = !!data.viewer?.isRelated;
  const isSelf = myHandle() === data.handle;
  const loggedIn = isLoggedIn();
  if (loggedIn) connectSSE(appState.auth ? null : storedKey()); // temps réel (cookie de session, ou clé héritée)

  // SVG paths : user-plus (non relié) / user-check (relié)
  const REL_SVG_OFF = `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="16" y1="11" x2="22" y2="11"/>`;
  const REL_SVG_ON  = `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/>`;
  const relBtnHtml = () => {
    if (!loggedIn || isSelf) return "";
    const on = isContact || isRelated;
    return `<button class="btn sm rel-toggle-icon${on ? " is-on" : ""}" id="rel-toggle-btn"
      title="${on ? "Retirer de mes relations" : "Ajouter à mes relations"}" aria-pressed="${on}">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${on ? REL_SVG_ON : REL_SVG_OFF}</svg>
    </button>`;
  };

  const _viewerHandle = loggedIn ? myHandle() : null;
  // Boutons « Discuter » + « Appel » : réservés aux contacts, placés dans la
  // colonne profil (et non plus dans l'en-tête du site / la fenêtre de chat).
  const _opts = data.options || {};
  // Gating Premium : si le créateur a un tarif fixé ET bénéfices chat/call
  // activés, les visiteurs non abonnés ne voient PAS les boutons (le
  // serveur renvoie 402 de toute façon, on prévient l'utilisateur).
  const _sp = data.space;
  const _spaceGated = !!(_sp && _sp.price_cents);
  const _benefits = _sp?.benefits || {};
  const _hasSpaceAccess = isSelf || !!_sp?.subscribed;
  const _chatBlockedByPremium = _spaceGated && !!_benefits.chat && !_hasSpaceAccess;
  const _callBlockedByPremium = _spaceGated && !!_benefits.call && !_hasSpaceAccess;
  const _canChat = isContact && _opts.allowChat !== false && !_chatBlockedByPremium;
  const _canCall = isContact && _opts.allowCall !== false && !_callBlockedByPremium;
  // Quand bloqué par premium, on remplace par un CTA d'abonnement plutôt que de
  // tout masquer (l'utilisateur doit savoir comment débloquer).
  const _premiumGateCta = (_chatBlockedByPremium || _callBlockedByPremium) && isContact && !isSelf
    ? `<a class="btn sm primary" href="/@${esc(data.handle)}/space" title="S'abonner pour débloquer chat &amp; appel">${icon("lock", 15)} Réservé aux abonné·e·s</a>`
    : "";
  // ── Bouton « Live » sous Discuter/Appel ──────────────────────────────────
  // S'affiche quand le créateur a activé le bénéfice « lives » de son espace
  // ET qu'un live à venir (kind='live') est planifié dans son agenda. Le badge
  // remonte le nombre de lives planifiés. Cible :
  //   - propriétaire : /me/broadcast (démarrage / planification)
  //   - abonné       : /@handle/space (hub des lives — gate déjà débloquée)
  //   - visiteur     : /@handle/space (CTA d'abonnement)
  const _livesEnabled = _spaceGated && !!_benefits.lives;
  const _nowTs = Date.now();
  const _upcomingLives = _livesEnabled
    ? (data.events || []).filter((e) => e.kind === "live" && (() => {
        const t = new Date(e.starts_at).getTime();
        return Number.isFinite(t) && t >= _nowTs;
      })())
    : [];
  const _liveCount = _upcomingLives.length;
  const _showLiveBtn = _livesEnabled && (isSelf || _liveCount > 0);
  const _liveBadge = _liveCount > 0
    ? `<span class="btn-badge" aria-label="${_liveCount} live${_liveCount > 1 ? "s" : ""} planifié${_liveCount > 1 ? "s" : ""}">${_liveCount}</span>`
    : "";
  const _liveBtnHtml = _showLiveBtn
    ? (isSelf
        ? `<a class="btn sm" href="/me/broadcast" target="_blank" rel="noopener" title="Démarrer ou planifier un live">${icon("users", 15)} Live${_liveBadge}</a>`
        : `<a class="btn sm" href="/@${esc(data.handle)}/space" title="${_hasSpaceAccess ? "Accéder aux lives" : "S'abonner pour suivre les lives"}">${icon("users", 15)} Live${_liveBadge}</a>`)
    : "";
  const _contactActions =
    _canChat || _canCall || _premiumGateCta || _liveBtnHtml
      ? `<div class="profile-contact-actions">
          ${_canChat ? `<button class="btn sm primary" id="chat-btn">${icon("chat", 15)} Discuter</button>` : ""}
          ${_canCall ? `<button class="btn sm" id="call-btn" title="Appel pair-à-pair"${data.pubkey ? "" : " disabled"}>${icon("camera", 15)} Appel</button>` : ""}
          ${_liveBtnHtml}
          ${_premiumGateCta}
        </div>`
      : "";
  const LOG_OUT_SVG = `<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>`;
  // Bouton d'accès à l'« Espace privé » directement depuis le cover hero
  // (rangée d'actions sous l'identité, à côté de Discuter/Appel) : pointe vers
  // /@handle/space, la page index dédiée (titre, prix, liste des pages, paywall).
  // - Propriétaire (isSelf) : lien direct vers /me/premium (gestion).
  // - Visiteur : lien vers /@handle/space (la page gère elle-même les états).
  const _spaceBtnHtml = (() => {
    const sp = data.space;
    if (!sp) return "";
    if (isSelf) {
      return `<a class="btn sm" href="/me/premium">${icon("lock", 15)} Mon espace</a>`;
    }
    const n = Array.isArray(sp.pages) ? sp.pages.length : 0;
    if (!n) return "";
    const cls = sp.subscribed ? "btn sm primary" : "btn sm";
    return `<a class="${cls}" href="/@${esc(data.handle)}/space">${icon("lock", 15)} Espace privé</a>`;
  })();
  // Bouton « Retour » dans la topbar : visible pour les visiteurs (non-isSelf)
  // — connectés ou anonymes. history.back() si historique same-origin distinct,
  // sinon /me (connecté) ou / (anonyme). Évite la boucle back-to-self.
  const _backBtnHtml = !isSelf
    ? `<button type="button" class="btn sm pub-back-btn" id="pub-cover-back" aria-label="Retour">
         <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
         <span>Retour</span>
       </button>`
    : "";
  const _profileActions = {
    isSelf,
    topLeft: "",
    left: "",
    right: relBtnHtml(), // Bouton relation dans la zone cover-actions (bas du hero)
    contact: _contactActions + _spaceBtnHtml,
  };
  // CTA « Créer ma page » : visible pour les visiteurs anonymes. Icône + label
  // sur desktop, icône seule (cercle compact) sur mobile — même esprit que
  // le bouton Retour. Pointe vers la landing.
  const _createCtaHtml = !loggedIn
    ? `<a class="btn sm primary pub-create-cta" id="pub-create-cta" href="/" aria-label="Créer ma page">
         <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
         <span>Créer ma page</span>
       </a>`
    : "";
  app.innerHTML = `
    ${siteHeader({
      center: headerSearchHtml(),
      right: `${_backBtnHtml}${_createCtaHtml}${headerAccount()}`,
    })}
    ${cardViewHtml(data, false, _profileActions)}`;
  footer.innerHTML = `<a class="brand" href="/" style="justify-content:center"><span class="brand-milo">${miloSvg(40)}</span> mindlog · id</a><p style="margin:.5rem 0 0">${CREDIT()}</p>`;

  wirePubTabs();
  wirePubSwipe();

  // Retour : history.back() si on a un historique same-origin, sinon /me pour
  // les connectés, / pour les visiteurs anonymes. Évite de bloquer dans une
  // boucle "back-to-self" si l'utilisateur a navigué entre deux profils.
  app.querySelector("#pub-cover-back")?.addEventListener("click", () => {
    let sameOrigin = false;
    try {
      sameOrigin = !!document.referrer
        && new URL(document.referrer, location.href).origin === location.origin
        && new URL(document.referrer, location.href).pathname !== location.pathname;
    } catch { /* ignore */ }
    if (window.history.length > 1 && sameOrigin) {
      window.history.back();
    } else {
      location.assign(loggedIn ? "/me" : "/");
    }
  });

  // Galerie : montée dans l'onglet Galerie ET en inline bas du panel À propos.
  const galleryP = host.gallery?.mountPublic(app.querySelector("#pub-gallery-slot"), data.handle);
  Promise.resolve(galleryP)
    .then((ok) => {
      if (ok) {
        // Galerie uniquement dans pub-gallery-slot (pas d'inline dans pub-about)
      } else {
        // Galerie placeholder : 9 carrés colorés (3×3) avec lightbox plein écran
        const PH_COLORS = ["#e74c3c","#e67e22","#f1c40f","#2ecc71","#1abc9c",
                           "#3498db","#9b59b6","#e91e63","#00bcd4"];
        const mkGrid = () => `<div class="gal-ph-grid">${
          PH_COLORS.map((c, i) =>
            `<button class="gal-ph" type="button" style="--ph-c:${c}" data-idx="${i}" aria-label="Image ${i+1}"></button>`
          ).join("")
        }</div>`;
        // Inline About : on supprime le titre "Galerie" (frère précédent) + le conteneur
        const _inlineGal = app.querySelector("#pub-about-gallery");
        if (_inlineGal) {
          const prev = _inlineGal.previousElementSibling;
          if (prev?.classList.contains("pub-section-h")) prev.remove();
          _inlineGal.remove();
        }
        const slot = app.querySelector("#pub-gallery-slot");
        if (slot) slot.innerHTML = mkGrid();
        // Wiring lightbox sur tous les carrés
        app.querySelectorAll(".gal-ph").forEach(btn =>
          btn.addEventListener("click", () => openGalLightbox(app, PH_COLORS, +btn.dataset.idx))
        );
      }
    })
    .catch(() => { app.querySelector('[data-tab="gallery"]')?.remove(); })
    .finally(() => {
      // Masque la barre d'onglets si ≤1 onglet visible (inutile avec un seul choix)
      const tabBar = app.querySelector("#pub-tabs");
      if (tabBar) {
        const visible = [...tabBar.querySelectorAll(".pub-tab")]
          .filter(t => getComputedStyle(t).display !== "none");
        if (visible.length <= 1) tabBar.style.display = "none";
      }
    });

  wireHeaderSearch();
  wireProfileMenuBtn(); // profile-chip menu (thème, profil, notifications)

  // Bascule thème de l'en-tête (icône posée par applyTheme, comme en connecté).
  applyTheme(storedTheme() || "dark");
  app.querySelector("#qr-btn")?.addEventListener("click", () =>
    openQR(`${location.origin}/@${data.handle}`, `@${data.handle}`)
  );


  // Espace privé : bouton « S'abonner » → Stripe Checkout subscription mensuelle.
  // Si pas connecté on déclenche la création de compte (le checkout exige une
  // identité). En dev sans Stripe Connect, l'utilisateur peut court-circuiter
  // via Options → Dev → « + Simuler l'abonnement ».
  app.querySelector("#pub-space-subscribe")?.addEventListener("click", async (e) => {
    const h = e.currentTarget.dataset.handle || data.handle;
    if (!isLoggedIn()) {
      toast("Crée un compte (ou connecte-toi) pour t'abonner à cet espace.");
      openCreate();
      return;
    }
    try {
      const r = await api(`/api/space/${encodeURIComponent(h)}/subscribe`, {
        method: "POST",
        headers: viewerHeaders(),
      });
      if (r?.url) location.assign(r.url);
      else if (r?.subscribed) location.reload();
    } catch (err) {
      // Pas de Stripe configuré (dev) → on tente l'endpoint dev en fallback,
      // qui écrit une ligne space_subscriptions provider="dev" et donne accès
      // immédiat (chat, lives, notifs). Gardé côté serveur par MINDLOG_DEV_PREMIUM.
      const msg = String(err?.message || "");
      const isBillingMissing = /paiement indispo|n'est pas encore vendable|stripe/i.test(msg);
      if (isBillingMissing) {
        try {
          await api("/api/dev/space-subscription", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...viewerHeaders() },
            body: JSON.stringify({ handle: h }),
          });
          toast(`Abonné(e) à @${h} (dev) ✓`);
          location.reload();
          return;
        } catch (devErr) {
          toast(devErr?.message || "Abonnement dev indisponible.");
          return;
        }
      }
      toast(msg || "Abonnement indisponible pour le moment.");
    }
  });
  app.querySelector("#chat-btn")?.addEventListener("click", async () => {
    if (!document.getElementById("deck")) await renderPrivate(null);
    // Navigate to the Chat column then simulate a contact click so the
    // conversation opens inline in comm-right (same UX as clicking a contact).
    window.__deckGoLabel?.("Chat");
    const item = document.querySelector(`.comm-contact-item[data-handle="${CSS.escape(data.handle)}"]`);
    if (item) { item.click(); return; }
    // Fallback: handle not in contact list yet, open as deck column
    host.chat.open(data.handle, myKey(), myHandle());
  });
  app.querySelector("#call-btn")?.addEventListener("click", () => {
    if (data.pubkey && host.call) host.call.start(data.handle, data.pubkey, { video: _opts.allowVideo !== false });
  });

  let relActive = isContact || isRelated;
  const relEl = app.querySelector("#rel-toggle-btn");
  if (relEl) {
    const applyRelState = (on) => {
      relEl.classList.toggle("is-on", on);
      relEl.setAttribute("aria-pressed", String(on));
      relEl.title = on ? "Retirer de mes relations" : "Ajouter à mes relations";
      relEl.querySelector("svg").innerHTML = on ? REL_SVG_ON : REL_SVG_OFF;
    };
    relEl.addEventListener("click", async () => {
      if (relEl.dataset.busy) return;
      relEl.dataset.busy = "1";
      const wasActive = relActive;
      relActive = !wasActive;
      applyRelState(relActive);
      try {
        if (wasActive) {
          await api(`/api/relations/${encodeURIComponent(data.handle)}`, {
            method: "DELETE", headers: viewerHeaders(),
          });
          toast("Retiré de vos relations");
        } else {
          const r = await api("/api/relations", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...viewerHeaders() },
            body: JSON.stringify({ handle: data.handle, type: "amis" }),
          });
          toast(r.notified ? `Ajouté ✓ — un email a été envoyé à @${data.handle}` : "Ajouté à vos relations ✓");
        }
      } catch (err) {
        relActive = wasActive;
        applyRelState(relActive);
        toast(err.message);
      }
      delete relEl.dataset.busy;
    });
  }

  // ── Boutons cover haut-gauche ──────────────────────────────────────────────
  app.querySelector("#cv-back-btn")?.addEventListener("click", () => location.assign(loggedIn ? "/me" : "/"));
  app.querySelector("#cv-search-btn")?.addEventListener("click", openSpotlightSearch);
  // Raccourci "/" sur la page profil (header masqué → pas de hdr-q)
  if (!document.body.dataset.spotlightBound) {
    document.body.dataset.spotlightBound = "1";
    document.addEventListener("keydown", (e) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.isContentEditable) return;
      if (document.querySelector('[data-view="profile"]')) { e.preventDefault(); openSpotlightSearch(); }
    });
  }
  app.querySelector("#cv-theme-btn")?.addEventListener("click", toggleTheme);
  app.querySelector("#cv-logout-btn")?.addEventListener("click", async () => {
    try { await api("/api/auth/logout", { method: "POST", headers: jsonAuth() }); } catch {}
    localStorage.removeItem("mindlog.key"); localStorage.removeItem("mindlog.handle");
    location.assign("/");
  });

  // ── Avatar upload (isSelf) ─────────────────────────────────────────────────
  const avFile = app.querySelector("#pub-av-file");
  if (avFile) {
    // Taille d'affichage : S / L / XL — persistée côté serveur (settings.avatar_size)
    // pour être visible des visiteurs. Pas de localStorage : la source de vérité
    // est /api/me (propriétaire) et data.avatarSize (visiteur, via /api/identities).
    // Reclic sur la taille déjà active → bascule la FORME (circle ↔ square).
    let currentSize = data.settings?.avatar_size || data.avatarSize || "l";
    let currentShape = data.settings?.avatar_shape || data.avatarShape || "circle";
    const applyAvLocal = (size, shape) => {
      const w = app.querySelector(".pub-av-wrap");
      if (w) { w.setAttribute("data-size", size || "l"); w.setAttribute("data-shape", shape || "circle"); }
      app.querySelectorAll(".pub-av-size-btn").forEach(b => b.classList.toggle("active", b.dataset.size === size));
    };
    applyAvLocal(currentSize, currentShape);
    const persistAv = async (size, shape) => {
      try {
        await api("/api/me/settings", { method: "PATCH", headers: jsonAuth(), body: JSON.stringify({ avatar_size: size, avatar_shape: shape }) });
      } catch (e) { toast(e?.message || "Échec d'enregistrement."); }
    };
    app.querySelectorAll(".pub-av-size-btn").forEach(b => b.addEventListener("click", () => {
      const s = b.dataset.size;
      if (s === currentSize) {
        // Reclic sur la taille active → bascule la forme.
        currentShape = currentShape === "circle" ? "square" : "circle";
      } else {
        currentSize = s;
      }
      applyAvLocal(currentSize, currentShape);
      void persistAv(currentSize, currentShape);
    }));

    avFile.addEventListener("change", async () => {
      const file = avFile.files?.[0]; if (!file) return;
      const fd = new FormData(); fd.append("photo", file);
      try {
        await api("/api/photo", { method: "POST", headers: viewerHeaders(), body: fd });
        const ts = Date.now();
        const newSrc = `/api/identities/${encodeURIComponent(data.handle)}/photo?ts=${ts}`;
        // Mise à jour immédiate de tous les avatars affichés (cover + mobile cover-about)
        app.querySelectorAll(".pub-cover-av, .pub-cover-av-milo, .pub-cover-av-gen").forEach(el => {
          if (el.tagName === "IMG") { el.src = newSrc; }
          else {
            // Remplace le div générique par une vraie photo
            const newImg = document.createElement("img");
            newImg.className = "pub-cover-av"; newImg.alt = `Photo de @${data.handle}`;
            newImg.src = newSrc;
            el.replaceWith(newImg);
          }
        });
      } catch (e) { toast(e.message); }
      avFile.value = "";
    });
  }

  // ── Badge de plan + menu Premium (isSelf) ─────────────────────────────────
  // Premium : toggle un menu pop-over listant les fonctions débloquées (chaque
  // item mène à /me/premium#anchor). Gratuit : redirige directement vers la
  // page Premium (où l'utilisateur peut s'abonner ou voir l'offre).
  const planBadge = app.querySelector("#pub-plan-badge");
  if (planBadge) {
    const menu = app.querySelector("#pub-plan-menu");
    planBadge.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!menu) { location.assign("/me/premium"); return; }
      const open = !menu.hidden;
      menu.hidden = open;
      planBadge.setAttribute("aria-expanded", String(!open));
    });
    if (menu) {
      // Fermeture au clic dehors ou à Échap.
      document.addEventListener("click", (e) => {
        if (menu.hidden) return;
        if (!menu.contains(e.target) && e.target !== planBadge) {
          menu.hidden = true;
          planBadge.setAttribute("aria-expanded", "false");
        }
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !menu.hidden) {
          menu.hidden = true;
          planBadge.setAttribute("aria-expanded", "false");
          planBadge.focus();
        }
      });
    }
  }

  // ── Drag des badges flottants sur la cover (isSelf) ───────────────────────
  // L'édition d'attributs (label/URL/icône/forme/show_label) vit dans
  // /me/premium (page Gérer). Ici on permet seulement de DÉPLACER les badges,
  // puis on PUT /api/page/buttons avec la liste complète (pos_x/pos_y + autres
  // attributs préservés depuis data.buttons).
  const fbtnLayer = app.querySelector("#pub-fbtn-layer");
  if (isSelf && fbtnLayer) {
    // État cloné — on mute uniquement pos_x/pos_y ; les autres champs restent.
    const state = (Array.isArray(data.buttons) ? data.buttons : []).map((b) => ({
      label: String(b.label || ""),
      url: String(b.url || ""),
      icon: String(b.icon || ""),
      pos_x: Number(b.pos_x ?? 0.5),
      pos_y: Number(b.pos_y ?? 0.9),
      shape: b.shape === "square" ? "square" : "circle",
      show_label: !!b.show_label,
    }));
    let saveTimer = null;
    const save = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        try {
          const buttons = state.filter((b) => b.label && b.url);
          await api("/api/page/buttons", { method: "PUT", headers: jsonAuth(), body: JSON.stringify({ buttons }) });
        } catch (e) { toast(e?.message === "premium required" ? "Réservé aux Premium." : (e?.message || "Échec d'enregistrement.")); }
      }, 280);
    };
    fbtnLayer.querySelectorAll(".pub-fbtn.is-self").forEach((el) => {
      let dragging = false, moved = false, startX = 0, startY = 0;
      // Bloque le drag natif du lien (Chromium/Firefox démarrent une opération
      // de drag-and-drop sur un <a> au pointerdown, ce qui tue nos pointermove).
      el.addEventListener("dragstart", (ev) => ev.preventDefault());
      el.addEventListener("pointerdown", (ev) => {
        if (ev.button !== undefined && ev.button !== 0) return;
        ev.preventDefault(); // évite la sélection / drag fantôme
        dragging = true; moved = false;
        startX = ev.clientX; startY = ev.clientY;
        el.classList.add("is-dragging");
        el.setPointerCapture?.(ev.pointerId);
      });
      el.addEventListener("pointermove", (ev) => {
        if (!dragging) return;
        if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 4) moved = true;
        if (!moved) return;
        ev.preventDefault();
        const rect = fbtnLayer.getBoundingClientRect();
        const nx = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        const ny = Math.max(0, Math.min(1, (ev.clientY - rect.top)  / rect.height));
        const i = Number(el.dataset.i);
        if (state[i]) { state[i].pos_x = nx; state[i].pos_y = ny; }
        el.style.left = `${(nx * 100).toFixed(3)}%`;
        el.style.top  = `${(ny * 100).toFixed(3)}%`;
      });
      const onUp = (ev) => {
        if (!dragging) return;
        dragging = false;
        el.classList.remove("is-dragging");
        el.releasePointerCapture?.(ev.pointerId);
        if (moved) { ev.preventDefault(); ev.stopPropagation(); save(); }
      };
      el.addEventListener("click", (ev) => { if (moved) { ev.preventDefault(); ev.stopPropagation(); } });
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
    });
  }

  // ── Galerie éditable (isSelf) : re-rendu complet depuis l'API à chaque changement ──
  if (isSelf) {
    const PH_COLORS = ["#e74c3c","#e67e22","#f1c40f","#2ecc71","#1abc9c","#3498db","#9b59b6","#e91e63","#00bcd4"];
    const ADD_SVG = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;

    const renderGallery = async () => {
      const container = app.querySelector("#pub-gallery-slot");
      if (!container) return;
      let existing = [];
      try { existing = (await api(`/api/gallery/${encodeURIComponent(data.handle)}`, { headers: viewerHeaders() })).photos || []; } catch {}

      // 9 slots : photos réelles + cases vides
      const html = PH_COLORS.map((c, i) => {
        const p = existing[i];
        return p
          ? `<div class="gal-ph gal-filled" data-photo-id="${p.id}" style="background:url('${p.url}') center/cover no-repeat"></div>`
          : `<div class="gal-ph" style="--ph-c:${c}"></div>`;
      }).join("");
      container.innerHTML = `<div class="gal-ph-grid">${html}</div>`;
      // Ne pas toucher à hidden : le système de tabs gère la visibilité

      // Wiring de chaque slot
      container.querySelectorAll(".gal-ph").forEach((slot) => {
        if (slot.classList.contains("gal-filled")) {
          // Bouton supprimer
          const del = document.createElement("button");
          del.className = "gal-slot-del"; del.type = "button"; del.title = "Supprimer";
          del.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
          slot.appendChild(del);
          del.addEventListener("click", async (e) => {
            e.stopPropagation();
            try { await api(`/api/gallery/${slot.dataset.photoId}`, { method: "DELETE", headers: viewerHeaders() }); renderGallery(); }
            catch (e) { toast(e.message); }
          });
          // Lightbox sur clic photo
          slot.addEventListener("click", (e) => {
            if (e.target.closest(".gal-slot-del")) return;
            const filled = [...container.querySelectorAll(".gal-ph.gal-filled")];
            const idx = filled.indexOf(slot);
            const items = filled.map(s => s.style.backgroundImage.match(/url\(['"]?(.+?)['"]?\)/)?.[1] || "");
            openGalLightbox(app, items, idx);
          });
        } else {
          // Bouton upload
          const lbl = document.createElement("label");
          lbl.className = "gal-slot-upload"; lbl.title = "Ajouter une image";
          lbl.innerHTML = `<input type="file" accept="image/jpeg,image/png,image/webp" style="display:none">${ADD_SVG}`;
          slot.appendChild(lbl);
          const inp = lbl.querySelector("input");
          const upload = async (file) => {
            const fd = new FormData(); fd.append("photos", file);
            try { await api("/api/gallery", { method: "POST", headers: viewerHeaders(), body: fd }); renderGallery(); }
            catch (e) { toast(e.message); }
          };
          inp.addEventListener("change", () => { if (inp.files?.[0]) upload(inp.files[0]); inp.value = ""; });
          slot.addEventListener("dragover", (e) => { e.preventDefault(); slot.classList.add("gal-drag"); });
          slot.addEventListener("dragleave", () => slot.classList.remove("gal-drag"));
          slot.addEventListener("drop", (e) => { e.preventDefault(); slot.classList.remove("gal-drag"); const f = e.dataTransfer.files[0]; if (f) upload(f); });
        }
      });
    };
    setTimeout(renderGallery, 100);
  }

  // editable = isSelf : sur sa propre page publique on peut éditer la dispo
  // (toggle libre/occupé en cliquant un jour) ; sur la page d'un tiers c'est en
  // lecture seule. canBook = !isSelf : on ne se prend pas un RDV à soi-même.
  host.calendar.wire(app.querySelector(".calendar"), data.overrides || {}, isSelf, data.handle, undefined, !isSelf, data.events || []);
  // (bouton « Demander un RDV » retiré : seul le clic sur un jour libre
  // déclenche la modale, comme indiqué par .cal-hint.)

  // Bio inline éditable (isSelf uniquement)
  const bioEdit = app.querySelector("#pub-bio-edit");
  if (bioEdit) {
    const resize = () => { bioEdit.style.height = "auto"; bioEdit.style.height = bioEdit.scrollHeight + "px"; };
    resize();
    bioEdit.addEventListener("input", resize);

    let _bioTimer = null;
    const saveBio = async () => {
      clearTimeout(_bioTimer);
      const value = bioEdit.value;
      try {
        await api("/api/card/field", {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...viewerHeaders() },
          body: JSON.stringify({ key: "bio", value }),
        });
      } catch (e) { toast(e.message); }
    };
    bioEdit.addEventListener("blur", saveBio);
    bioEdit.addEventListener("input", () => { clearTimeout(_bioTimer); _bioTimer = setTimeout(saveBio, 1500); });
  }

}

// — Mode mobile : empile les cartes du profil en un deck qui défile
// HORIZONTALEMENT au swipe (GSAP), avec une flèche animée invitant au geste.
// Sur écran large la page reste une simple colonne verticale (aucun wrapping).
function setupProfileSwipe(page) {
  if (!page) return;
  const mq = window.matchMedia("(max-width: 600px)");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const CHEVRON =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

  function disable() {
    if (!page.dataset.swipe) return;
    const track = page.querySelector(":scope > .pub-track");
    if (track) {
      window.gsap?.set(track, { clearProps: "transform" });
      [...track.children].forEach((slide) => {
        const inner = slide.firstElementChild;
        if (inner) page.insertBefore(inner, track);
      });
      track.remove();
    }
    page.querySelector(":scope > .pub-dots")?.remove();
    page.querySelector(":scope > .pub-swipe-hint")?.remove();
    page.classList.remove("pub-swipe");
    delete page.dataset.swipe;
    page._swipeGo = null;
  }

  function enable() {
    if (page.dataset.swipe || !mq.matches) return;
    const items = [...page.children].filter(
      (el) => el.matches(".card, .pub-section") || (el.id === "pub-gallery-slot" && el.childElementCount > 0)
    );
    if (items.length < 2) return; // un seul volet : rien à faire défiler

    const track = document.createElement("div");
    track.className = "pub-track";
    items.forEach((el) => {
      const slide = document.createElement("div");
      slide.className = "pub-slide";
      slide.appendChild(el);
      track.appendChild(slide);
    });
    page.appendChild(track);

    const dots = document.createElement("div");
    dots.className = "pub-dots";
    dots.innerHTML = items
      .map((_, i) => `<button class="pub-dot" type="button" aria-label="Carte ${i + 1}"></button>`)
      .join("");
    const hint = document.createElement("button");
    hint.type = "button";
    hint.className = "pub-swipe-hint";
    hint.setAttribute("aria-label", "Carte suivante");
    hint.innerHTML = `<span class="pub-swipe-hint-txt">Glissez</span>${CHEVRON}`;
    page.append(dots, hint);
    page.classList.add("pub-swipe");
    page.dataset.swipe = "1";

    const g = window.gsap;
    const dotEls = [...dots.children];
    let index = 0;
    let swiped = false;

    const update = () => {
      dotEls.forEach((d, i) => d.classList.toggle("active", i === index));
      hint.classList.toggle("hidden", index >= items.length - 1);
    };
    const markSwiped = () => {
      if (swiped) return;
      swiped = true;
      if (g) {
        g.killTweensOf(hint.querySelector("svg"));
        g.to(hint, { autoAlpha: 0, duration: 0.3, onComplete: () => hint.classList.add("gone") });
      } else hint.classList.add("gone");
    };
    const go = (i = index, animate = true) => {
      index = Math.max(0, Math.min(items.length - 1, i));
      const x = -index * page.clientWidth;
      if (g && animate && !reduce) g.to(track, { x, duration: 0.5, ease: "power3.out" });
      else if (g) g.set(track, { x });
      else track.style.transform = `translateX(${x}px)`;
      update();
    };
    page._swipeGo = go;

    let sx = null, sy = null;
    page.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    page.addEventListener("touchend", (e) => {
      if (sx == null) return;
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2) { go(index + (dx < 0 ? 1 : -1)); markSwiped(); }
      sx = sy = null;
    }, { passive: true });

    dotEls.forEach((d, i) => d.addEventListener("click", () => { go(i); markSwiped(); }));
    hint.addEventListener("click", () => { go(index + 1); markSwiped(); });

    // Invitation : le chevron oscille tant qu'on n'a pas encore swipé.
    if (g && !reduce) g.fromTo(hint.querySelector("svg"), { x: 0 }, { x: 7, duration: 0.7, repeat: -1, yoyo: true, ease: "sine.inOut" });

    go(0, false);
  }

  page._swipeEnable = enable;
  page._swipeDisable = disable;
  if (mq.matches) requestAnimationFrame(enable);

  // Écouteurs globaux liés une seule fois ; ils agissent sur la .pub-page courante.
  if (!document.body.dataset.pubSwipeBound) {
    document.body.dataset.pubSwipeBound = "1";
    const cur = () => document.querySelector(".pub-page");
    const onMq = (e) => { const p = cur(); if (!p) return; e.matches ? p._swipeEnable?.() : p._swipeDisable?.(); };
    mq.addEventListener ? mq.addEventListener("change", onMq) : mq.addListener?.(onMq);
    window.addEventListener("resize", () => { cur()?._swipeGo?.(); });
  }
}

/* ------------------------- Demande de RDV (modal) ------------------------ */
// La modale de RDV est fournie par le plugin calendrier (`host.calendar.openBooking`).

// Composant RÉUTILISABLE : la carte « profil » de la page individuelle.
// Utilisée par cardViewHtml (page /@handle, colonne 0) ET par la colonne
// fermable « fiche contact » (openContactColumn) → rendu strictement identique.
// `profileActions` = { left, right, contact } : zones d'action injectées (QR,
// bascule relation, boutons Discuter/Appel, bouton Fermer…).
function profileCardHtml(data, profileActions = {}) {
  const get = (k) => data.fields?.find((f) => f.key === k)?.value || "";
  const name = get("display_name") || data.handle;
  const title = get("title");
  const visible = (data.fields || []).filter(
    (f) => f.value && !["display_name", "title"].includes(f.key) && !isSocialKey(f.key)
  );
  const socials = socialLinksHtml(data.fields || []);
  const photo = data.hasPhoto
    ? `<img class="photo" src="/api/identities/${encodeURIComponent(data.handle)}/photo?ts=${Date.now()}" alt="Photo de ${esc(name)}" />`
    : data.handle === "milo"
      ? `<div class="photo milo-photo">${miloSvg(120)}</div>`
      : `<div class="photo avatar">${genericAvatarSvg(data.handle, (name[0] || "·").toUpperCase())}</div>`;
  const rel1 = (data.relations && data.relations[1]) || [];
  const _ls = data.lastSeen ? new Date(data.lastSeen) : null;
  const lastSeenTxt = _ls && !isNaN(_ls) ? _ls.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "";
  const vaultBadge = data.hasVault
    ? `<span class="vault-badge" title="Clés E2E sauvegardées dans le coffre" aria-label="Clé présente dans le coffre">${icon("key", 13)}</span>`
    : "";
  return `<div class="card profile-card" style="position:relative">
          ${profileActions?.left ? `<div class="profile-card-actions profile-card-actions-left">${profileActions.left}</div>` : ""}
          ${profileActions?.right ? `<div class="profile-card-actions profile-card-actions-right">${profileActions.right}</div>` : ""}
          <div class="profile-head">
            <div class="photo-wrap"><span class="photo-frame">${photo}${vaultBadge}</span></div>
            <div class="profile-id">
              <h1>${esc(name)}</h1>
              <p class="handle">@${esc(data.handle)}</p>
              ${title ? `<p class="subtitle">${esc(title)}</p>` : ""}
              ${lastSeenTxt ? `<p class="last-seen">${icon("clock", 12)} Dernière connexion : ${esc(lastSeenTxt)}</p>` : ""}
            </div>
          </div>
          ${
            (data.tags && data.tags.length) || socials
              ? `<div class="profile-meta">${data.tags && data.tags.length ? `<div class="tags">${tagChipsHtml(data.tags, false)}</div>` : ""}${socials}</div>`
              : ""
          }
          ${profileActions?.contact || ""}
          <div class="col-scroll">
            <ul class="fields">
              ${
                visible
                  .map((f) => `<li class="field"><span class="k">${esc(f.label)}</span>${valueHtml(f.key, f.value)}</li>`)
                  .join("") || '<li class="empty">Aucune information publique.</li>'
              }
            </ul>
            ${
              rel1.length
                ? `<div class="section-title">Relations</div><ul class="rels">${relationsListHtml(rel1, false)}</ul>`
                : ""
            }
            <div style="padding-bottom:.6rem"></div>
          </div>
        </div>`;
}

function cardViewHtml(data, editable, profileActions = "") {
  host.calendar.setAvailability(data.availability);
  const isSelf = !!(data.viewer && data.viewer.handle === data.handle);
  const canBook = !isSelf;
  const hasEvents = data.events && data.events.length > 0;
  const hasAvailability = !!data.availability;
  const showAgenda = hasEvents || hasAvailability;
  const nowTs = Date.now();
  // Prochains événements (futurs uniquement) — filtrés côté client pour n'afficher
  // que ceux à venir, même si le serveur a renvoyé des événements passés.
  const upcomingEvents = (data.events || [])
    .filter(e => e.starts_at && new Date(e.starts_at).getTime() >= nowTs)
    .sort((a, b) => (a.starts_at || "").localeCompare(b.starts_at || ""));
  const upcomingGroups = (() => {
    const groups = []; let cur = null;
    for (const e of upcomingEvents) {
      const key = (e.starts_at || "").slice(0, 10);
      if (!cur || cur.key !== key) { cur = { key, label: fmtDayLabel(e.starts_at), items: [] }; groups.push(cur); }
      cur.items.push(e);
    }
    return groups;
  })();

  const get = (k) => data.fields?.find((f) => f.key === k)?.value || "";
  const name = get("display_name") || data.handle;
  const title = get("title");
  const location = get("location");
  // Couverture Premium (P4) : média uploadé (image/vidéo) prioritaire, sinon champ
  // « cover » (URL), sinon image par défaut. La vidéo est rendue via <video>.
  const coverMedia = data.cover || null;
  const coverIsVideo = !!(coverMedia && coverMedia.type === "video");
  const coverUrl =
    (coverMedia && !coverIsVideo ? coverMedia.url : "") || get("cover") || "/static/default-cover.webp";
  // Boutons personnalisés Premium (P5) — version positionnable. Petits boutons
  // (cercle/carré, ~44px) flottants sur la cover-hero, position normalisée 0..1.
  // Propriétaire : drag pour repositionner + panneau d'édition sous la cover.
  // Visiteur : badges cliquables fixes à leur position persistée.
  const pageButtons = Array.isArray(data.buttons) ? data.buttons : [];
  const ICON_HINTS = ["link", "mail", "phone", "calendar", "chat", "image", "user", "users", "tag", "sparkles", "shield", "lock", "send", "zap", "pin", "smartphone", "home", "code"];
  const isPremium = data.plan === "premium";

  // Badge flottant unique. data-id : index dans la liste (sert au drag/save).
  const floatingBtnHtml = (b, i) => {
    const px = Math.max(0, Math.min(1, Number(b.pos_x ?? 0.5)));
    const py = Math.max(0, Math.min(1, Number(b.pos_y ?? 0.9)));
    const shape = b.shape === "square" ? "square" : "circle";
    const showLabel = !!b.show_label;
    const labelTxt = showLabel ? `<span class="pub-fbtn-lbl">${esc(b.label)}</span>` : "";
    // draggable="false" + dragstart preventDefault au wiring : sans ça, le
    // navigateur démarre son drag natif de lien (icône fantôme), qui consomme
    // les pointermove → notre drag personnalisé ne se déclenche pas.
    // data-label : utilisé par le tooltip CSS au survol (cf. .pub-fbtn[data-label]).
    // Pas de title= → évite le double tooltip natif + custom.
    return `<a class="pub-fbtn pub-fbtn--${shape}${showLabel ? " has-label" : ""}${isSelf ? " is-self" : ""}"
       data-i="${i}"
       data-label="${esc(b.label || "")}"
       href="${esc(b.url)}"
       target="_blank" rel="noopener nofollow noreferrer"
       draggable="false"
       style="left:${(px*100).toFixed(3)}%;top:${(py*100).toFixed(3)}%;"
       aria-label="${esc(b.label || b.url)}">${b.icon ? icon(b.icon, 18) : icon("link", 18)}${labelTxt}</a>`;
  };
  const floatingButtonsHtml = pageButtons.length
    ? `<div class="pub-fbtn-layer" id="pub-fbtn-layer">${pageButtons.map(floatingBtnHtml).join("")}</div>`
    : (isSelf ? `<div class="pub-fbtn-layer" id="pub-fbtn-layer" aria-hidden="true"></div>` : "");

  // L'édition des attributs (label/url/icon/forme/show_label) se fait dans
  // /me/premium → bouton « Gérer ». Sur la homepage, seul le DRAG des badges
  // sur la cover est actif côté propriétaire (positionnement direct).
  void ICON_HINTS;
  void isPremium;

  const coverAv = data.hasPhoto
    ? `<img class="pub-cover-av" src="/api/identities/${encodeURIComponent(data.handle)}/photo?ts=${Date.now()}" alt="Photo de ${esc(name)}" />`
    : data.handle === "milo"
      ? `<div class="pub-cover-av pub-cover-av-milo">${miloSvg(48)}</div>`
      : `<div class="pub-cover-av pub-cover-av-gen">${genericAvatarSvg(data.handle, (name[0] || "·").toUpperCase())}</div>`;

  // Contenu « À propos » : champs, tags, socials, relations
  const bio = get("bio");
  const visible = (data.fields || []).filter(
    (f) => f.value && !["display_name", "title", "location", "cover", "bio", "email"].includes(f.key) && !isSocialKey(f.key)
  );
  const socials = socialLinksHtml(data.fields || []);
  const tags = (data.tags && data.tags.length) ? `<div class="tags pub-about-tags">${tagChipsHtml(data.tags, false)}</div>` : "";
  const rel1 = (data.relations && data.relations[1]) || [];
  const vaultBadge = data.hasVault
    ? `<span class="vault-badge" title="Clés E2E sauvegardées">${icon("key", 13)}</span>`
    : "";

  return `
    <div class="pub-hero-page" style="--pub-cover:url('${esc(coverUrl)}')">

      <!-- Hero : couverture prédominante + identité en overlay bas -->
      <div class="pub-cover-hero">
        ${coverIsVideo
          ? `<video class="pub-cover-bg pub-cover-video" src="${esc(coverMedia.url)}" autoplay muted loop playsinline disablepictureinpicture aria-label="Couverture de @${esc(data.handle)}"></video>`
          : `<div class="pub-cover-bg" style="background-image:url('${esc(coverUrl)}')" role="img" aria-label="Couverture de @${esc(data.handle)}"></div>`}
        <!-- Boutons haut-gauche : retour, recherche, déconnexion -->
        <div class="pub-cover-top-left">
          ${profileActions?.topLeft || ""}
        </div>
        <!-- Boutons haut-droite : QR, thème, relation -->
        <div class="pub-cover-top">
          ${profileActions?.left || ""}
        </div>
        <div class="pub-cover-identity">
          <div class="pub-av-wrap${profileActions?.isSelf ? " pub-av-editable" : ""}" data-size="${esc(data.avatarSize || data.settings?.avatar_size || "l")}" data-shape="${esc(data.avatarShape || data.settings?.avatar_shape || "circle")}">
            <div class="pub-av-photo">
              ${coverAv}${vaultBadge}
              ${profileActions?.isSelf ? `
                <label class="pub-av-upload-btn" id="pub-av-upload" title="Changer la photo" aria-label="Changer la photo de profil">
                  <input type="file" id="pub-av-file" accept="image/jpeg,image/png,image/webp,image/gif" style="display:none">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                </label>` : ""}
            </div>
            ${profileActions?.isSelf ? `
              <div class="pub-av-sizes" id="pub-av-sizes">
                <button class="pub-av-size-btn" data-size="s" type="button">S</button>
                <button class="pub-av-size-btn" data-size="l" type="button">L</button>
                <button class="pub-av-size-btn" data-size="xl" type="button">XL</button>
              </div>` : ""}
          </div><!-- /pub-av-wrap -->
          <div class="pub-cover-names">
            <h1 class="pub-cover-name">${esc(name)}</h1>
            <div class="pub-cover-handle-row">
              <p class="pub-cover-handle">@${esc(data.handle)}</p>
              ${profileActions?.isSelf ? `
                <div class="pub-plan-wrap">
                  <button type="button" class="pub-plan-badge ${data.plan === "premium" ? "is-premium" : "is-free"}" id="pub-plan-badge" aria-haspopup="menu" aria-expanded="false" aria-controls="pub-plan-menu">
                    ${data.plan === "premium" ? `${icon("sparkles", 12)} Premium` : `Gratuit`}
                  </button>
                  ${data.plan === "premium" ? `
                  <div class="pub-plan-menu" id="pub-plan-menu" role="menu" hidden>
                    <p class="pub-plan-menu-title">${icon("sparkles", 13)} Tes fonctions premium</p>
                    <a class="pub-plan-item" role="menuitem" href="/me/premium#cover">${icon("image", 14)}<span><b>Couverture</b><small>Photo ou vidéo en bannière</small></span></a>
                    <a class="pub-plan-item" role="menuitem" href="/me/premium#buttons">${icon("link", 14)}<span><b>Boutons personnalisés</b><small>Liens sur ta page publique</small></span></a>
                    <a class="pub-plan-item" role="menuitem" href="/me/premium#pages">${icon("tag", 14)}<span><b>Pages payantes</b><small>Vente d'accès — commission 30 %</small></span></a>
                    <a class="pub-plan-item" role="menuitem" href="/me/premium#gallery">${icon("image", 14)}<span><b>Liens galerie</b><small>Photos cliquables vers une URL</small></span></a>
                    <a class="pub-plan-cta btn sm primary" href="/me/premium">Gérer mon abonnement →</a>
                  </div>` : ""}
                </div>`
              : data.plan === "premium" ? `
                <!-- Visiteur d'un compte premium : badge stylisé indicatif, non cliquable, pas de menu. -->
                <span class="pub-plan-badge is-premium pub-plan-badge--readonly" aria-label="Compte Premium">${icon("sparkles", 12)} Premium</span>`
              : ""}
            </div>
            ${title ? `<p class="pub-cover-title">${esc(title)}</p>` : ""}
            ${location ? `<p class="pub-cover-loc">${icon("pin", 12)} ${esc(location)}</p>` : ""}
          </div>
          <div class="pub-cover-actions">
            ${profileActions?.right || ""}
            ${profileActions?.contact || ""}
          </div>
        </div>
        <!-- Pastilles overlay en bas du héro (mobile uniquement) — 3 slides : home / agenda / gallery -->
        <div class="pub-hero-dots" id="pub-hero-dots" role="group" aria-label="Navigation des sections">
          <button type="button" class="pub-hero-dot is-on" data-tab="home" aria-label="Accueil"></button>
          <button type="button" class="pub-hero-dot" data-tab="agenda" aria-label="Calendrier"></button>
          <button type="button" class="pub-hero-dot" data-tab="gallery" aria-label="Galerie"></button>
        </div>
        <!-- About : intro markdown + tags + socials, modèle Milo (visible sur
             toutes les tailles d'écran). Pour le propriétaire (isSelf) le bloc
             apparaît même vide, avec un CTA pour définir l'intro — ça aide à
             le découvrir. Pour un visiteur, on n'affiche rien si tout est vide. -->
        ${(() => {
          const profileIntroMd = data.profile_intro_md || data.space?.profile_intro_md || "";
          const presentationHtml = profileIntroMd
            ? `<section class="pub-intro" aria-label="Présentation">${mdLite(profileIntroMd)}</section>`
            : (bio ? `<p class="pub-bio">${esc(bio)}</p>` : "");
          const hasAnyContent = !!(presentationHtml || tags || socials);
          if (!hasAnyContent && !isSelf) return "";
          // Propriétaire sans intro → CTA. (S'il a déjà tags/socials mais pas
          // d'intro, on ajoute le CTA en tête pour rester un point d'entrée
          // évident vers l'édition.)
          const ctaHtml = (isSelf && !profileIntroMd)
            ? `<a href="/me#intro" class="pub-intro-cta">${icon("user", 14)} <span>Définir mon intro</span></a>`
            : "";
          return `<div class="pub-cover-about">
            ${ctaHtml}
            ${presentationHtml}
            ${tags}
            ${socials ? `<div class="pub-socials">${socials}</div>` : ""}
          </div>`;
        })()}
        <!-- Calque des boutons flottants — par-dessus la cover, sous l'identity. -->
        ${floatingButtonsHtml}
      </div>

      <!-- Contenu : onglets (desktop) + panneaux scrollables (mobile carousel) -->
      <div class="pub-body">
        <nav class="pub-tabs" id="pub-tabs" role="tablist" aria-label="Sections du profil">
          <button type="button" class="pub-tab is-on" data-tab="about"
            role="tab" aria-selected="true" aria-controls="pub-about">
            ${icon("user", 16)}<span>Accueil</span>
          </button>
          <button type="button" class="pub-tab" data-tab="agenda"
            role="tab" aria-selected="false" aria-controls="pub-agenda">
            ${icon("calendar", 16)}<span>Calendrier</span>
          </button>
          <button type="button" class="pub-tab" data-tab="gallery"
            role="tab" aria-selected="false" aria-controls="pub-gallery-slot">
            ${icon("image", 16)}<span>Galerie</span>
          </button>
        </nav>

        <div class="pub-tab-body" id="pub-tab-body">
          <section id="pub-about" class="pub-tab-panel is-on" role="tabpanel" tabindex="0">
            ${(() => {
              const profileIntroMd = data.profile_intro_md || data.space?.profile_intro_md || "";
              // Présentation unifiée : si intro_md, on l'affiche en HTML et on
              // masque le textarea bio (le proprio édite l'intro via /me/premium).
              if (profileIntroMd) {
                return `<section class="pub-intro" aria-label="Présentation">${mdLite(profileIntroMd)}</section>${
                  isSelf ? `<p class="pub-intro-edit-hint lbl-sm"><a href="/me">${icon("user", 12)} Modifier ma présentation →</a></p>` : ""
                }`;
              }
              return isSelf
                ? `<textarea id="pub-bio-edit" class="pub-bio-edit" placeholder="Décrivez-vous en quelques mots…" rows="3">${esc(bio)}</textarea>`
                : (bio ? `<p class="pub-bio">${esc(bio)}</p>` : "");
            })()}
            ${tags}
            <!-- Boutons personnalisés : badges flottants sur la cover (pas dans la timeline). -->
            ${isSelf ? "" : ""}
            ${socials ? `<div class="pub-socials">${socials}</div>` : ""}
            ${visible.length ? `<ul class="fields pub-fields">${visible.map((f) =>
              `<li class="field"><span class="k">${esc(f.label || f.key)}</span>${valueHtml(f.key, f.value)}</li>`
            ).join("")}</ul>` : ""}
            ${rel1.length ? `<div class="pub-section-h first">${icon("users", 14)} Relations</div><ul class="rels">${relationsListHtml(rel1, false)}</ul>` : ""}
          </section>

          <section id="pub-agenda" class="pub-tab-panel" role="tabpanel" tabindex="-1" hidden>
            ${hasAvailability ? `<div class="pub-section-h first">${icon("clock", 16)} Disponibilités</div>
              <div class="calendar-fill">
                ${host.calendar.html(data.overrides, isSelf, undefined, canBook, data.events || [])}
              </div>
              ${isSelf || data.options?.allowRequests === false ? "" :
                `<p class="cal-hint" role="note">${icon("calendar", 14)} <span>Choisis un <b>jour libre</b> (en vert) pour demander un RDV.</span></p>`}` : ""}
            ${upcomingGroups.length ? `
              <div class="pub-section-h${!hasAvailability ? " first" : ""}">${icon("calendar", 16)} Prochains événements</div>
              <div class="ev-agenda">
                ${upcomingGroups.map(g => `<section class="ev-group">
                  <div class="ev-day">${esc(g.label)}</div>
                  ${g.items.map(e => eventCardHtml(e, false, nowTs)).join("")}
                </section>`).join("")}
              </div>` : ""}
            ${!hasAvailability && !upcomingGroups.length ? `<p class="pub-empty">Pas d'événements publics à venir.</p>` : ""}
          </section>

          <section id="pub-gallery-slot" class="pub-tab-panel" role="tabpanel" tabindex="-1" hidden></section>
        </div>
      </div>
    </div>`;
}

// Spotlight search — overlay centré, déclenché par bouton ou "/" ─────────────
function openSpotlightSearch() {
  if (document.getElementById("cv-search-overlay")) return;
  const el = document.createElement("div");
  el.id = "cv-search-overlay";
  el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
  el.innerHTML = `
    <div class="cv-sb-bg"></div>
    <div class="cv-sb-modal">
      <form class="cv-sb-form" autocomplete="off">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
        <input id="cv-sb-q" type="search" placeholder="Rechercher une identité…" autocomplete="off" spellcheck="false"/>
        <kbd class="cv-sb-esc">Esc</kbd>
      </form>
      <div class="cv-sb-results" id="cv-sb-results" hidden></div>
    </div>`;
  document.body.appendChild(el);
  const inp = el.querySelector("#cv-sb-q");
  const res = el.querySelector("#cv-sb-results");
  requestAnimationFrame(() => inp.focus());

  let timer;
  inp.addEventListener("input", () => {
    clearTimeout(timer);
    const q = inp.value.trim();
    if (!q) { res.hidden = true; return; }
    timer = setTimeout(async () => {
      try {
        const { results: list } = await api(`/api/search?q=${encodeURIComponent(q)}`);
        res.innerHTML = list.length
          ? list.map(r => `<a class="cv-sb-result" href="/@${encodeURIComponent(r.handle)}">
              ${avatarHtml(r.handle, r.has_photo, "av")}
              <span class="meta">
                <span class="nm">${esc(r.display_name || r.handle)}</span>
                <span class="hd">@${esc(r.handle)}${r.title ? " · " + esc(r.title) : ""}</span>
              </span></a>`).join("")
          : `<div class="cv-sb-empty">Aucun résultat</div>`;
        res.hidden = false;
      } catch { /* silent */ }
    }, 200);
  });
  el.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    el.querySelector(".cv-sb-result")?.click();
  });

  const close = () => { el.remove(); document.removeEventListener("keydown", onKey); };
  el.querySelector(".cv-sb-bg").addEventListener("click", close);
  const onKey = (e) => {
    if (e.key === "Escape") close();
    if (e.key === "ArrowDown") { e.preventDefault(); (res.querySelector(".cv-sb-result") || inp).focus(); }
  };
  document.addEventListener("keydown", onKey);
  // Navigation clavier dans les résultats
  res.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); (e.target.nextElementSibling || inp).focus(); }
    if (e.key === "ArrowUp")   { e.preventDefault(); (e.target.previousElementSibling || inp).focus(); }
    if (e.key === "Escape") close();
  });
}

// Lightbox plein écran pour la galerie placeholder (et future galerie réelle).
function openGalLightbox(root, items, startIdx) {
  let idx = startIdx;
  // Réutilise un lightbox existant s'il y en a un
  let lb = document.getElementById("gal-lb");
  if (!lb) {
    lb = document.createElement("div");
    lb.id = "gal-lb";
    lb.setAttribute("role", "dialog");
    lb.setAttribute("aria-modal", "true");
    lb.innerHTML = `
      <div class="gal-lb-bg"></div>
      <div class="gal-lb-box"></div>
      <button class="gal-lb-close" type="button" aria-label="Fermer">✕</button>
      <button class="gal-lb-prev" type="button" aria-label="Précédent">‹</button>
      <button class="gal-lb-next" type="button" aria-label="Suivant">›</button>
      <div class="gal-lb-counter"></div>`;
    document.body.appendChild(lb);
    lb.querySelector(".gal-lb-bg").addEventListener("click", () => lb.remove());
    lb.querySelector(".gal-lb-close").addEventListener("click", () => lb.remove());
    lb.querySelector(".gal-lb-prev").addEventListener("click", () => { idx = (idx - 1 + items.length) % items.length; update(); });
    lb.querySelector(".gal-lb-next").addEventListener("click", () => { idx = (idx + 1) % items.length; update(); });
    const onKey = (e) => {
      if (!document.getElementById("gal-lb")) { document.removeEventListener("keydown", onKey); return; }
      if (e.key === "Escape") { lb.remove(); document.removeEventListener("keydown", onKey); }
      if (e.key === "ArrowLeft") { idx = (idx - 1 + items.length) % items.length; update(); }
      if (e.key === "ArrowRight") { idx = (idx + 1) % items.length; update(); }
    };
    document.addEventListener("keydown", onKey);
  }
  const update = () => {
    const box = lb.querySelector(".gal-lb-box");
    const counter = lb.querySelector(".gal-lb-counter");
    // items peut être un tableau de couleurs ou d'URLs
    const val = items[idx];
    if (val.startsWith("#") || val.startsWith("rgb")) {
      box.style.background = val;
      box.innerHTML = "";
    } else {
      box.style.background = "none";
      box.innerHTML = `<img src="${val}" alt="" style="width:100%;height:100%;object-fit:contain;border-radius:8px">`;
    }
    counter.textContent = `${idx + 1} / ${items.length}`;
    lb.querySelector(".gal-lb-prev").style.display = items.length <= 1 ? "none" : "";
    lb.querySelector(".gal-lb-next").style.display = items.length <= 1 ? "none" : "";
  };
  update();
}

// Flèches stylisées ">" qui indiquent qu'une slide voisine existe (mobile
// carrousel : home / agenda / gallery — gallery peut être absente). Synchro
// à chaque changement de slide actif via syncDot/syncDots. Au clic, navigue
// vers la slide précédente/suivante en réutilisant _pubTabGo.
function pubSlideArrows(activeKey) {
  // Slides actuellement disponibles dans l'ordre, en lisant les dots du DOM.
  // (Le dot "gallery" est retiré si la galerie est vide — cf. catch sur la
  //  requête /api/gallery → retrait du data-tab="gallery".)
  const order = [...document.querySelectorAll(".pub-hero-dot[data-tab]")].map((d) => d.dataset.tab);
  const left  = document.querySelector(".pub-slide-arrow--left");
  const right = document.querySelector(".pub-slide-arrow--right");
  if (!left || !right || !order.length) return;
  // Sur grand écran le carrousel mobile est désactivé : on cache les flèches.
  if (!window.matchMedia("(max-width: 767px)").matches) {
    left.hidden = true; right.hidden = true;
    return;
  }
  const i = Math.max(0, order.indexOf(activeKey));
  left.hidden  = i <= 0;
  right.hidden = i >= order.length - 1;
  left.dataset.target  = i > 0 ? order[i - 1] : "";
  right.dataset.target = i < order.length - 1 ? order[i + 1] : "";
}

// Wiring : injecte (une seule fois) les 2 flèches dans #app, HORS du scroll-
// container .pub-hero-page — sinon leur passage display:none ↔ inline-flex au
// fil des slides provoque un layout shift qui interrompt le scroll-snap natif.
function wirePubSlideArrowsClicks() {
  const appEl = document.getElementById("app");
  if (!appEl) return;
  if (!document.querySelector(".pub-slide-arrow")) {
    const chev = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>`;
    const tpl = document.createElement("div");
    tpl.innerHTML = `
      <button type="button" class="pub-slide-arrow pub-slide-arrow--left" data-dir="prev" aria-label="Page précédente" hidden>${chev}</button>
      <button type="button" class="pub-slide-arrow pub-slide-arrow--right" data-dir="next" aria-label="Page suivante" hidden>${chev}</button>`;
    appEl.append(...tpl.children);
  }
  document.querySelectorAll(".pub-slide-arrow").forEach((b) => {
    if (b.dataset.wired) return;
    b.dataset.wired = "1";
    b.addEventListener("click", () => {
      const target = b.dataset.target;
      if (target && typeof window._pubTabGo === "function") window._pubTabGo(target);
    });
  });
}

function wirePubTabs() {
  wirePubSlideArrowsClicks();
  const tabs = [...document.querySelectorAll("#pub-tabs .pub-tab")];
  const allPanels = [...document.querySelectorAll(".pub-tab-panel")];
  if (!tabs.length) return;
  const tabIds = { about: "pub-about", agenda: "pub-agenda", gallery: "pub-gallery-slot" };

  function syncDots(key) {
    document.querySelectorAll(".pub-hero-dot").forEach((d) =>
      d.classList.toggle("is-on", d.dataset.tab === key));
    tabs.forEach((t) => {
      const on = t.dataset.tab === key;
      t.classList.toggle("is-on", on);
      t.setAttribute("aria-selected", String(on));
    });
    pubSlideArrows(key);
  }

  window._pubTabGo = (tabKey) => {
    const isMobile = window.matchMedia("(max-width: 767px)").matches;
    if (isMobile) {
      // Carrousel : on scrolle horizontalement vers le panneau cible
      // "home" → cover-hero (slide 0), sinon le panneau tab correspondant
      const el = tabKey === "home"
        ? document.querySelector(".pub-cover-hero")
        : document.getElementById(tabIds[tabKey]);
      el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
      syncDots(tabKey);
    } else {
      // Large screen : show/hide — pub-about exclu (toujours visible via CSS sur mobile)
      const switchable = allPanels.filter((p) => p.id !== "pub-about");
      switchable.forEach((p) => { p.hidden = true; p.classList.remove("is-on"); p.tabIndex = -1; });
      const panelId = tabKey === "about" ? "pub-agenda" : (tabIds[tabKey] || "pub-agenda");
      const panel = document.getElementById(panelId);
      if (panel) { panel.hidden = false; panel.classList.add("is-on"); panel.tabIndex = 0; }
      syncDots(tabKey);
    }
  };
  tabs.forEach((t) => t.addEventListener("click", () => window._pubTabGo(t.dataset.tab)));
  // Pastilles hero (mobile) : cliquables pour naviguer
  document.querySelectorAll(".pub-hero-dot[data-tab]").forEach((d) =>
    d.addEventListener("click", () => window._pubTabGo(d.dataset.tab)));
  // Large screen : onglet par défaut = Calendrier (Accueil masqué, 2 onglets)
  if (!window.matchMedia("(max-width: 767px)").matches) {
    window._pubTabGo("agenda");
  }
}

// Carrousel mobile : pub-hero-page est le scroll-container horizontal.
// 3 slides : cover-hero (home) → pub-agenda → pub-gallery-slot.
// pub-about est masqué sur mobile (son contenu est accessible sur grand écran).
function wirePubSwipe() {
  const body = document.getElementById("pub-tab-body");
  if (!body) return;
  // "home" → cover-hero ; les onglets tabs gardent leurs ids
  const tabIds = { "pub-cover-hero": "home", "pub-agenda": "agenda", "pub-gallery-slot": "gallery" };
  // Sur mobile, pub-hero-page est le scroll-container ; sur desktop/tablet, c'est pub-tab-body.
  const isMobile = window.matchMedia("(max-width: 767px)").matches;
  const obsRoot = isMobile ? document.querySelector(".pub-hero-page") : body;
  const syncDot = (key) => {
    document.querySelectorAll(".pub-hero-dot").forEach((d) =>
      d.classList.toggle("is-on", d.dataset.tab === key));
    document.querySelectorAll("#pub-tabs .pub-tab").forEach((t) => {
      const on = t.dataset.tab === key;
      t.classList.toggle("is-on", on);
      t.setAttribute("aria-selected", String(on));
    });
    pubSlideArrows(key);
  };
  const obs = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting && e.intersectionRatio >= 0.5) {
        const key = tabIds[e.target.id] ?? tabIds[e.target.className?.split?.(" ")?.[0]];
        if (key) syncDot(key);
      }
    });
  }, { root: obsRoot, threshold: 0.5 });
  // Observer cover-hero (slide home) + les panneaux agenda/gallery
  if (isMobile) {
    const cover = document.querySelector(".pub-cover-hero");
    if (cover) obs.observe(cover);
  }
  [...document.querySelectorAll(".pub-tab-panel")].forEach((p) => obs.observe(p));
  // Navigation mobile : swipe natif géré par pub-hero-page (scroll-snap), pas de handler custom.
}

// Libellé de jour pour le regroupement (façon agenda Teams) : « Aujourd'hui »,
// « Demain », sinon « lundi 2 juin ». Première lettre capitalisée.
function fmtDayLabel(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dd = new Date(d); dd.setHours(0, 0, 0, 0);
  const diff = Math.round((dd - today) / 86400000);
  const base = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const cap = base.charAt(0).toUpperCase() + base.slice(1);
  if (diff === 0) return `Aujourd'hui · ${cap}`;
  if (diff === 1) return `Demain · ${cap}`;
  if (diff === -1) return `Hier · ${cap}`;
  return cap;
}

const fmtHm = (d) => (d && !isNaN(d) ? d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "");

// Carte d'événement façon Teams : liseré d'accent à gauche, créneau horaire,
// titre, métadonnées (lieu/lien/privé) et actions (éditer/supprimer) en mode édition.
function eventCardHtml(e, editable, now) {
  const start = new Date(e.starts_at);
  const end = e.ends_at ? new Date(e.ends_at) : null;
  const past = ((end && !isNaN(end) ? end : start).getTime() || 0) < now;
  const t0 = fmtHm(start);
  const t1 = fmtHm(end);
  const isLive = e.kind === "live";
  const meta = [
    isLive ? `<span class="ev-live-tag">${icon("users", 12)}Live</span>` : "",
    e.location ? `<span class="ev-loc">${icon("pin", 13)}${esc(e.location)}</span>` : "",
    e.link ? `<a class="ev-link" href="${esc(e.link)}" target="_blank" rel="noopener noreferrer" title="${esc(e.link)}">${icon("link", 13)}Lien</a>` : "",
    editable && e.is_public === 0 ? `<span class="ev-private">${icon("lock", 12)}Privé</span>` : "",
  ].filter(Boolean).join("");
  return `<article class="ev-card${past ? " past" : ""}${isLive ? " ev-card-live" : ""}">
      <div class="ev-time"><span class="ev-t0">${esc(t0) || "—"}</span>${t1 ? `<span class="ev-t1">${esc(t1)}</span>` : ""}</div>
      <div class="ev-main">
        <div class="ev-title">${esc(e.title)}</div>
        ${meta ? `<div class="ev-meta">${meta}</div>` : ""}
      </div>
      ${editable ? `<div class="ev-actions">
        <button type="button" class="ev-act" data-event-edit="${e.id}" title="Modifier" aria-label="Modifier « ${esc(e.title)} »">${icon("pencil", 15)}</button>
        <button type="button" class="ev-act danger" data-del-event="${e.id}" title="Supprimer" aria-label="Supprimer « ${esc(e.title)} »">${icon("trash", 15)}</button>
      </div>` : ""}
    </article>`;
}

function eventsHtml(events, editable) {
  if (!events || !events.length)
    return `<div class="ev-empty">${editable ? "Aucun événement pour l'instant. Ajoutez-en un avec « Nouvel événement »." : "Aucun événement."}</div>`;
  const now = Date.now();
  const sorted = [...events].sort((a, b) => (a.starts_at || "").localeCompare(b.starts_at || ""));
  const groups = [];
  let cur = null;
  for (const e of sorted) {
    const key = (e.starts_at || "").slice(0, 10);
    if (!cur || cur.key !== key) { cur = { key, label: fmtDayLabel(e.starts_at), items: [] }; groups.push(cur); }
    cur.items.push(e);
  }
  return `<div class="ev-agenda">${groups
    .map((g) => `<section class="ev-group"><div class="ev-day">${esc(g.label)}</div>${g.items.map((e) => eventCardHtml(e, editable, now)).join("")}</section>`)
    .join("")}</div>`;
}

/* ============================ ÉDITEUR PRIVÉ ============================== */

// authHeaders / jsonAuth vivent dans net.js (importés). appState.key reste la source de
// vérité ici ; on la reflète dans net.js via setAccessKey() à chaque (ré)auth.

// Charge par jour (clé = jour UTC YYYY-MM-DD), cohérent avec le rendu du
// calendrier : compte les événements + les RDV acceptés tombant ce jour-là.


// Règle de dispo par défaut côté client (miroir de DEFAULT_AVAILABILITY serveur).

// Préférences par défaut côté client (miroir de DEFAULT_SETTINGS du serveur).

// Description de chaque option : libellé + aide affichés dans l'onglet « Options ».
const OPTION_DEFS = [
  { key: "allow_chat", name: "Messagerie", desc: "Autoriser vos contacts à vous écrire (chiffré de bout en bout)." },
  { key: "allow_call", name: "Appels", desc: "Autoriser les appels audio/vidéo pair-à-pair entrants." },
  { key: "allow_video", name: "Vidéo", desc: "Proposer la caméra pendant les appels (sinon audio seul)." },
  { key: "allow_requests", name: "Demandes de RDV", desc: "Autoriser les visiteurs à demander un rendez-vous." },
  { key: "public_availability", name: "Disponibilités publiques", desc: "Afficher vos disponibilités sur votre page publique." },
];



function periodsListHtml(periods) {
  if (!periods.length) return '<p class="empty">Aucune période.</p>';
  return periods
    .map(
      (p, i) => `<div class="avail-period">
        <span class="ap-range">${esc(p.from)} → ${esc(p.to)}</span>
        <span class="ap-status ${p.free ? "free" : "busy"}">${p.free ? "Disponible" : "Occupé"}</span>
        <button type="button" class="icon" data-del-period="${i}" title="Retirer" aria-label="Retirer la période">✕</button>
      </div>`
    )
    .join("");
}

function optionsPanelHtml(settings) {
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const a = normalizeAvailability(s.availability);
  return `
    <p class="lbl-sm" style="margin:.2rem 0 .8rem;line-height:1.45">Choisissez qui peut vous joindre et ce qui est visible publiquement. Modifications enregistrées aussitôt.</p>
    <div class="opt-list">
      ${OPTION_DEFS.map(
        (o) => `<label class="opt-row">
          <span class="opt-text"><span class="opt-name">${esc(o.name)}</span><span class="opt-desc">${esc(o.desc)}</span></span>
          <input type="checkbox" class="opt-toggle" data-setting="${o.key}" ${s[o.key] ? "checked" : ""} />
          <span class="toggle-track" aria-hidden="true"><span class="toggle-thumb"></span></span>
        </label>`
      ).join("")}
    </div>

    <div class="section-title">Disponibilités générales</div>
    <p class="lbl-sm" style="margin:.2rem 0 .6rem;line-height:1.45">Jours libres par défaut. Les exceptions ponctuelles se règlent dans l'agenda (clic sur un jour).</p>
    <div class="avail-days" id="avail-days" role="group" aria-label="Jours libres par défaut">
      ${DOW_LETTERS.map(
        (d, i) => `<button type="button" class="avail-day ${a.weekdays[i] ? "on" : ""}" data-dow="${i}" aria-pressed="${a.weekdays[i]}" title="${DOW_NAMES[i]}">${d}</button>`
      ).join("")}
    </div>
    <label class="opt-row">
      <span class="opt-text"><span class="opt-name">Week-end disponible</span><span class="opt-desc">Bascule samedi + dimanche d'un coup.</span></span>
      <input type="checkbox" class="opt-toggle" id="avail-weekend" ${a.weekdays[5] && a.weekdays[6] ? "checked" : ""} />
      <span class="toggle-track" aria-hidden="true"><span class="toggle-thumb"></span></span>
    </label>

    <div class="section-title">Horaires & créneaux</div>
    <div class="avail-hours">
      <label>De <input type="time" id="avail-start" value="${esc(a.start)}" step="900" /></label>
      <label>à <input type="time" id="avail-end" value="${esc(a.end)}" step="900" /></label>
      <label class="avail-slot">Créneaux
        <select id="avail-slot">
          ${[15, 30, 60].map((m) => `<option value="${m}" ${a.slot_minutes === m ? "selected" : ""}>${m === 60 ? "1 h" : m + " min"}</option>`).join("")}
        </select>
      </label>
    </div>

    <div class="section-title">Périodes <span class="deg">vacances, dispo exceptionnelle…</span></div>
    <div id="avail-periods">${periodsListHtml(a.periods)}</div>
    <div class="avail-period-add">
      <input type="date" id="ap-from" aria-label="Du" />
      <input type="date" id="ap-to" aria-label="Au" />
      <select id="ap-status" aria-label="Statut">
        <option value="busy">Occupé</option>
        <option value="free">Disponible</option>
      </select>
      <button type="button" class="btn sm" id="ap-add">+ Période</button>
    </div>`;
}


/* ----------------------- Navigation par onglets (v2) --------------------- */


// Deck horizontal déplacé dans editor/deck.js (importé en tête).

// Ouvre la fiche d'un contact comme COLONNE FERMABLE du deck (au lieu de quitter
// la page vers /@handle). Insérée juste après « Relations ».

const REL_LABEL = { amis: "Ami", pro: "Pro", autre: "Autre" };


function relItemHtml(r, { editable = false, incoming = false } = {}) {
  const ts = r.created_at ? new Date((r.created_at.replace(" ", "T")) + "Z").getTime() || 0 : 0;
  const search = `${r.display_name || ""} ${r.handle}`.toLowerCase();
  return `
    <li class="rel" data-search="${esc(search)}" data-ts="${ts}">
      <a class="rel-link" href="/@${encodeURIComponent(r.handle)}" target="_blank" rel="noopener noreferrer">
        ${avatarHtml(r.handle, r.has_photo, "av")}
        <span class="meta">
          <span class="nm">${esc(r.display_name || r.handle)}${
    r.mutual ? ' <span class="rel-mutual" title="Relation réciproque (contact)">⇄</span>' : ""
  }</span>
          <span class="hd">@${esc(r.handle)}${
    r.type ? ` <span class="rel-type ${esc(r.type)}">${REL_LABEL[r.type] || r.type}</span>` : ""
  }${r.via ? ` <span class="rel-via">via @${esc(r.via)}</span>` : ""}${
    r.created_at ? ` <span class="rel-date">${relDate(r.created_at)}</span>` : ""
  }</span>
        </span>
      </a>
      ${incoming ? `<button class="btn sm" data-recip="${esc(r.handle)}" title="Ajouter en retour">+ Réciproquer</button>` : ""}
      ${editable ? `<button class="icon" data-del-rel="${esc(r.handle)}" title="Retirer">✕</button>` : ""}
    </li>`;
}

function relationsListHtml(list, editable) {
  if (!list || !list.length) return '<li class="empty">Aucune relation.</li>';
  return list.map((r) => relItemHtml(r, { editable })).join("");
}

function notifTime(s) {
  const d = new Date((String(s || "").replace(" ", "T")) + (String(s).includes("Z") ? "" : "Z"));
  if (isNaN(d)) return "";
  return d.toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function notifItemHtml(n) {
  const inner = `<span class="nt">${esc(n.text)}</span><span class="nd">${esc(notifTime(n.created_at))}</span>`;
  const cls = `notif ${n.read ? "" : "unread"}`;
  // Une notif de message ouvre le chat (popup) plutôt que de naviguer.
  if (n.type === "message" && n.link) {
    const h = n.link.replace(/^\/@/, "");
    return `<li class="${cls}"><button class="notif-act" data-chat-notif="${esc(h)}">${inner}</button></li>`;
  }
  // Notif "ajout en relation" → popup réciproque avant d'ouvrir le profil.
  if (n.type === "relation" && n.link && /^\/@[^/]+$/.test(n.link)) {
    const h = n.link.replace(/^\/@/, "");
    return `<li class="${cls}"><button class="notif-act" data-relation-notif="${esc(h)}">${inner}</button></li>`;
  }
  // Notif liée à un profil → ouvre une COLONNE FERMABLE (fiche contact).
  if (n.link && /^\/@[^/]+$/.test(n.link)) {
    const h = n.link.replace(/^\/@/, "");
    return `<li class="${cls}"><button class="notif-act" data-contact-notif="${esc(h)}">${inner}</button></li>`;
  }
  return `<li class="${cls}">${n.link ? `<a href="${esc(n.link)}">${inner}</a>` : inner}</li>`;
}


// Puces de filtre par statut (avec compteurs). Le filtrage est appliqué côté client.


// Pastilles de tags. editable=true ajoute un bouton de suppression par tag.
function tagChipsHtml(tags, editable) {
  if (!tags || !tags.length)
    return editable ? '<span class="tags-empty">Aucun tag pour l’instant.</span>' : "";
  return tags
    .map(
      (tg) =>
        `<span class="tag-chip">#${esc(tg)}${
          editable ? ` <button class="tag-del" data-del-tag="${esc(tg)}" aria-label="Retirer ${esc(tg)}">✕</button>` : ""
        }</span>`
    )
    .join("");
}

// Panneau d'édition des réseaux : une ligne par réseau (login OU URL collée).

// Liens réseaux pour la carte publique : pastilles cliquables (réseaux remplis).
function socialLinksHtml(fields) {
  const byKey = Object.fromEntries(fields.map((f) => [f.key, f.value]));
  const items = SOCIALS
    .map((net) => ({ net, url: socialUrl(net, byKey[socialFieldKey(net.key)]) }))
    .filter((x) => x.url);
  if (!items.length) return "";
  return `<div class="social-links">${items
    .map(
      ({ net, url }) =>
        `<a class="social-chip" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(net.label)}" aria-label="${esc(net.label)}" style="--sc:${net.color}">${socialIcon(net, 20)}</a>`
    )
    .join("")}</div>`;
}




/* ================================ STATUT ================================= */

function fmtUptime(s) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return [d && `${d}j`, h && `${h}h`, `${m}min`].filter(Boolean).join(" ");
}


/* --------------------------------- Boot ---------------------------------- */

// Bouton thème clair/sombre, toujours visible (coin haut-droit).
function mountThemeToggle() {
  if (document.getElementById("theme-toggle-fixed")) return;
  const b = document.createElement("button");
  b.id = "theme-toggle-fixed";
  b.className = "theme-toggle theme-toggle-fixed";
  b.type = "button";
  b.addEventListener("click", toggleTheme);
  document.body.appendChild(b);
  applyTheme(storedTheme() || "dark"); // pose l'icône
}

document.documentElement.lang = LANG;
document.documentElement.dir = RTL.has(LANG) ? "rtl" : "ltr";
applyAccent(storedAccent() || ACCENTS[0].v);
mountThemeToggle();
setupBrandMilo();
setupMiloEyes();

// Notifications temps réel : toast + mise à jour de la cloche si l'éditeur est ouvert.
onSSE("notif", (d) => {
  if (d?.type === "relation" && d.link && /^\/@[^/]+$/.test(d.link)) {
    const h = d.link.replace(/^\/@/, "");
    // Vérifie en temps réel si la personne est déjà dans nos relations.
    api("/api/me", { headers: authHeaders() }).then((fresh) => {
      appState.myRelations = fresh?.relations?.[1] || [];
      const alreadyAdded = appState.myRelations.some((r) => r.handle === h);
      if (alreadyAdded) { renderPrivate(appState.key); return; }
      confirmDialog(`@${h} vous a ajouté à ses relations.\nVoulez-vous l'ajouter aussi ?`, { ok: "Ajouter", cancel: "Ignorer" }).then(async (ok) => {
        renderPrivate(appState.key);
        if (!ok) return;
        try {
          await api("/api/relations", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...viewerHeaders() },
            body: JSON.stringify({ handle: h, type: "amis" }),
          });
          toast(`@${h} ajouté à vos relations ✓`);
          renderPrivate(appState.key);
        } catch (err) { toast(err.message || "Impossible d'ajouter."); }
      });
    }).catch(() => {});
    // (si /api/me échoue, on ne fait rien — l'utilisateur n'est peut-être pas connecté)
  } else if (d?.text) {
    toast("🔔 " + d.text);
  }
  [document.getElementById("notif-badge"), document.getElementById("chip-notif-dot")].forEach((badge) => {
    if (!badge) return;
    badge.hidden = false;
    badge.textContent = String((parseInt(badge.textContent || "0", 10) || 0) + 1);
  });
  const list = document.getElementById("notif-list");
  if (list) {
    if (list.querySelector(".empty")) list.innerHTML = "";
    list.insertAdjacentHTML("afterbegin", notifItemHtml({ ...d, read: 0 }));
  }
});

// Met à jour EN DIRECT le badge « messages non lus » de l'onglet Chat (barre de
// navigation), sans refresh de page. Le badge a un sélecteur stable
// (data-chat-badge) toujours présent dans le DOM ; on relit /api/me pour le total.
async function updateChatBadge() {
  const el = document.querySelector("[data-chat-badge]");
  if (!el) return;
  try {
    const d = await api("/api/me", { headers: authHeaders() });
    const n = (d.conversations || []).reduce(
      (s, cv) => s + (cv.messages || []).filter((m) => !m.mine && m.read === 0).length, 0);
    if (n) { el.textContent = n > 99 ? "99+" : n; el.hidden = false; }
    else { el.textContent = ""; el.hidden = true; }
  } catch {}
}
// Message entrant en temps réel → recalcule le badge non-lus de la nav.
onSSE("message", () => { updateChatBadge(); });

// Appareil enrôlé / approuvé en temps réel → rafraîchit la liste des appareils.
onSSE("device", (d) => {
  appState.refreshDevices?.();
  if (d.pending) toast?.("Un nouvel appareil attend votre approbation — Options › Accès");
});

/* ----------------------------- Registre de plugins ----------------------- */
// `host` est l'API exposée aux plugins (public/plugins/*.js) : primitives
// partagées + registre. Les plugins n'importent rien de app.js ; ils reçoivent
// `host` à l'enregistrement et y publient leurs capacités (host.chat, host.calendar)
// et d'éventuelles colonnes d'éditeur (hook editorColumns).
const _plugins = [];
Object.assign(host, {
  // utilitaires
  esc, api, toast, confirmDialog, promptDialog, t,
  // temps réel
  connectSSE, onSSE,
  // badge non-lus de la barre de nav (mise à jour en direct depuis le plugin chat)
  updateChatBadge,
  // chiffrement E2E
  ensureE2E, e2eEncrypt, e2eDecrypt,
  e2e: {
    needsRestore: () => !!E2E.needsRestore,
    needsBackup: () => !!E2E.needsBackup,
    openRestore: (onDone) => openE2eRestore(myHandle(), myKey(), onDone),
    openBackup: (onDone) => openE2eBackup(myHandle(), myKey(), onDone),
    recoverKeys: (onDone) => openKeyRecovery(myHandle(), myKey(), onDone),
    vaultGet: e2eVaultGet,
    // Clé publique ECDH de l'utilisateur courant (à figer dans les messages).
    myPub: () => E2E.pubStr,
  },
  // Double Ratchet (forward secrecy) — v2 ; repli automatique sur v1 par l'appelant.
  ratchet: {
    ensurePrekeys: ratchetEnsurePrekeys,
    send: ratchetSend,
    decrypt: ratchetDecrypt,
    recallSent: ratchetRecallSent,
    isV2: isRatchetCiphertext,
  },
  // Multi-appareils (fan-out) : enrôlement + chiffrement vers tous les appareils.
  md: {
    deviceId: mdDeviceId,
    register: mdRegisterDevice,
    fanoutEncrypt: mdFanoutEncrypt,
    decryptEnvelope: mdDecryptEnvelope,
    selfDecrypt: mdSelfDecrypt, // message d'un AUTRE de mes appareils (clé self partagée)
    recallSent: mdRecallSent,
  },
  // Vérification d'identité anti-MITM (numéro de sécurité + statut synchronisé).
  verify: {
    open: openSafetyNumber,
    status: verifyGet,
    safetyNumber,
    sha256hex,
  },
  // Groupes (sender keys) : API + orchestration des clés + chiffrement.
  groups: {
    api: gApi,
    syncKeys: gSyncKeys,
    send: gSendMessage,
    load: gLoadMessages,
    rotate: gRotate,
    attachUpload: gAttachUpload,
    attachDownload: gAttachDownload,
  },
  // Pièces jointes chiffrées éphémères.
  attach: {
    upload: attachEncryptUpload,
    download: attachDownloadDecrypt,
    payload: attachPayload,
    parse: parseAttachment,
    prefix: ATT_PREFIX,
  },
  // helpers de rendu / état
  avatarHtml, notifTime, fmtDate, storedKey, storedHandle,
  jsonAuth, authHeaders,
  // Auth du visiteur courant (session cookie d'abord, clé héritée ensuite).
  myKey, myHandle, viewerHeaders, isLoggedIn, loadAuth,
  currentKey: () => appState.key, // clé d'accès de l'éditeur courant
  // registre
  registerPlugin: (p) => _plugins.push(p),
  getPlugins: () => _plugins,
  // colonnes dynamiques du deck éditeur (ex. conversation de chat)
  openDeckColumn: addDeckColumn,
  closeDeckColumn: removeDeckColumn,
  // visite guidée « Milo » (web) : sélecteur d'ambiance + démarrage direct
  tour: { open: openMiloTourPicker, start: startMiloTour },
});

function openPrivacyPolicy() {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="panel" role="dialog" aria-modal="true" aria-labelledby="pp-title" style="max-height:80vh;overflow-y:auto">
      <button type="button" class="close" id="pp-close" aria-label="Fermer">✕</button>
      <h2 id="pp-title">Politique de confidentialité</h2>
      <h3>Données collectées</h3>
      <p>mindlog · id collecte uniquement les données que vous saisissez : identifiant (handle), nom affiché, email de récupération (optionnel), événements, disponibilités et messages.</p>
      <h3>Stockage local</h3>
      <p>Votre clé d'accès et votre handle sont stockés dans le <strong>localStorage</strong> de votre navigateur si vous choisissez de les mémoriser. Ces données ne quittent pas votre appareil.</p>
      <h3>Chiffrement E2E</h3>
      <p>Les messages sont chiffrés de bout en bout dans votre navigateur avant envoi. Le serveur ne peut pas les lire.</p>
      <p>Pour relire vos messages sur plusieurs appareils, vous pouvez sauvegarder votre clé privée dans un <strong>coffre chiffré</strong> : elle est chiffrée dans votre navigateur (par votre passkey ou une passphrase que vous seul connaissez) puis stockée sous forme illisible. Le serveur ne reçoit jamais ni votre clé, ni votre passphrase, ni le secret de votre passkey — il ne peut donc pas la déchiffrer.</p>
      <h3>Cookies</h3>
      <p>Ce site n'utilise <strong>aucun cookie</strong>, aucun tracker, aucune régie publicitaire.</p>
      <h3>Vos droits (RGPD)</h3>
      <p>Vous pouvez supprimer votre compte et toutes vos données depuis votre espace privé. Pour toute demande : <a href="mailto:milo@mindlog.today">milo@mindlog.today</a></p>
      <h3>Responsable de traitement</h3>
      <p>mindlog · id est édité par <a href="https://le-lab.net" target="_blank" rel="noopener">le-lab.net</a>.</p>
      <div class="actions" style="margin-top:1.5rem"><button class="btn primary" id="pp-ok">Fermer</button></div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => e.target === overlay && close());
  overlay.querySelector("#pp-close").addEventListener("click", close);
  overlay.querySelector("#pp-ok").addEventListener("click", close);
}

function initGdprBanner() {
  if (localStorage.getItem("mk_gdpr_ok")) return;
  const el = document.createElement("div");
  el.id = "gdpr-banner";
  el.className = "gdpr-banner";
  el.innerHTML = `<p>Ce site stocke votre clé d'accès en local (localStorage). Aucun cookie tiers, aucun tracking. <a href="#" id="gdpr-more">Politique de confidentialité</a></p><button class="btn sm primary" id="gdpr-ok">Compris</button>`;
  document.body.appendChild(el);
  el.querySelector("#gdpr-ok").addEventListener("click", () => {
    localStorage.setItem("mk_gdpr_ok", "1");
    el.remove();
  });
  el.querySelector("#gdpr-more").addEventListener("click", (e) => { e.preventDefault(); openPrivacyPolicy(); });
}

(async () => {
  const v = window.__APP_V__ ? `?v=${encodeURIComponent(window.__APP_V__)}` : "";
  initGdprBanner();
  for (const name of ["calendar", "chat", "gallery", "call", "live", "premium-upsell"]) {
    try {
      const mod = await import(`./plugins/${name}.js${v}`);
      mod.default(host);
    } catch (e) {
      console.error(`[plugin] échec du chargement de « ${name} »`, e);
    }
  }
  _plugins.forEach((p) => p.init && p.init(host));
  wireGlobalLogout();
  wireProfileMenu();
  route();
})();











// Builders de vue + utilitaires partagés, consommés par editor/index.js (cycle assumé).
export { PENDING_INVITE, connectSSE, eventsHtml, footer, headerAccount, headerSearchHtml, localPrice, notifItemHtml, openMiloTourPicker, openQR, periodsListHtml, profileCardHtml, relItemHtml, relationsListHtml, tagChipsHtml, wireHeaderSearch, wireProfileMenuBtn };
