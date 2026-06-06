// editor/index.js — éditeur privé : orchestrateur (renderPrivate) + rendu
// (renderEditor) + câblage (wireEditor) + colonne contact + aides internes.
// Importe le socle (core/state/deck/host/ui/crypto) ; quelques builders de vue
// partagés avec landing/profil viennent de ../app.js (cycle assumé, usage runtime).
// Extrait verbatim de app.js. cf. docs/web-app-split-proposal.md
import { PENDING_INVITE, connectSSE, eventsHtml, footer, headerAccount, headerSearchHtml, notifItemHtml, openMiloTourPicker, openQR, periodsListHtml, profileCardHtml, relItemHtml, relationsListHtml, tagChipsHtml, wireHeaderSearch, wireProfileMenuBtn } from "../app.js";
import { DEFAULT_SETTINGS, DOW_LETTERS, DOW_NAMES, TOUR_SEEN_KEY, app, myHandle, myKey, normalizeAvailability, pick, relDate, setLastHandle, setMeProfile, setSessionHint, setStoredHandle, setStoredKey, storedHandle, storedKey, viewerHeaders } from "../core.js";
import { e2eDecrypt, e2eEncrypt, ensureE2E } from "../crypto/e2e.js";
import { mdDeviceId } from "../crypto/multidevice.js";
import { ratchetEnsurePrekeys } from "../crypto/ratchet.js";
import { E2E } from "../crypto/state.js";
import { e2eSaveVault, e2eVaultGet } from "../crypto/vault.js";
import { host } from "../host.js";
import { CREDIT, t } from "../i18n.js";
import { api, authHeaders, jsonAuth, setAccessKey } from "../net.js";
import { appState } from "../state.js";
import { ACCENT_STORE, applyAccent, applyTheme, storedAccent, toggleTheme } from "../theme.js";
import { confirmDialog, copyText, esc, promptPassphrase, promptPin, toast } from "../ui/dom.js";
import { SOCIALS, SOCIAL_BY_KEY, avatarHtml, genericAvatarSvg, icon, isSocialKey, miloSvg, siteHeader, socialFieldKey, socialIcon, socialUrl } from "../ui/icons.js";
import { openE2eBackup, openE2eRestore } from "../ui/modals.js";
import { openCoverEditor } from "../ui/cover-editor.js";
import { addDeckColumn, deckState, removeDeckColumn } from "./deck.js";
import { renderOptionsColumn } from "./tabs/options.js";
import { renderIdentityColumn } from "./tabs/identity.js";
import { renderAgendaColumn } from "./tabs/agenda.js";
import { renderRelationsColumn } from "./tabs/relations.js";
import { renderNotificationsColumn } from "./tabs/notifications.js";
import { renderAccountColumn } from "./tabs/account.js";
import { pbRowHtml, renderPremiumPage } from "./tabs/premium.js";

export async function consumePendingInvite() {
  let token = null;
  try { token = sessionStorage.getItem(PENDING_INVITE); } catch {}
  if (!token) return;
  try { sessionStorage.removeItem(PENDING_INVITE); } catch {}
  try {
    const r = await api(`/api/invites/${encodeURIComponent(token)}/accept`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() } });
    toast(`Invitation acceptée : vous êtes en contact avec @${r.handle} 🎉`);
  } catch { /* invitation expirée / déjà utilisée */ }
}

export function dayLoadMap(data) {
  const load = {};
  (data.events || []).forEach((e) => {
    const d = (e.starts_at || "").slice(0, 10);
    if (d) load[d] = (load[d] || 0) + 1;
  });
  (data.requests || []).forEach((r) => {
    if (r.day && r.status === "accepted") load[r.day] = (load[r.day] || 0) + 1;
  });
  return load;
}

export async function renderPrivate(key) {
  const cookieMode = !key; // /me : auth par cookie de session ; /k/{clé} : auth par clé
  appState.key = key; // null en mode cookie (l'auth passe par le cookie)
  setAccessKey(appState.key); // reflète la clé dans net.js (authHeaders/jsonAuth)
  app.innerHTML = `<p class="loading">Chargement…</p>`;
  let data;
  try {
    data = await api("/api/me", { headers: authHeaders() });
    appState.myRelations = data?.relations?.[1] || [];
    void window.mindlogLocalPim?.save?.(data); // cache PIM hors-ligne (best-effort)
  } catch {
    // Hors-ligne (échec réseau) : si un cache PIM local existe, on affiche l'éditeur
    // depuis le cache plutôt que d'échouer. Le chat E2E reste indisponible hors-ligne.
    const cachedPim = window.mindlogLocalPim ? await window.mindlogLocalPim.load().catch(() => null) : null;
    if (cachedPim) {
      appState.myRelations = cachedPim?.relations?.[1] || [];
      if (cookieMode) setSessionHint(true);
      appState.auth = { handle: cachedPim.handle, key: appState.key };
      connectSSE(cookieMode ? null : appState.key);
      renderEditor(cachedPim);
      toast("📴 Hors-ligne — données en cache (le chat reprendra en ligne).");
      return;
    }
    if (cookieMode) {
      // Session absente/expirée : on oublie l'indice et on revient à l'accueil.
      setSessionHint(false);
      location.replace("/");
      return;
    }
    app.style.cssText = "display:flex;align-items:center;justify-content:center;min-height:100dvh";
    app.innerHTML = `
      <div class="card" style="text-align:center;max-width:340px">
        <div class="empty-milo">${miloSvg(110)}</div>
        <h1>Clé invalide</h1>
        <p class="subtitle">Ce lien privé ne correspond à aucune identité.</p>
        <a class="btn primary" href="/">Accueil</a>
      </div>`;
    return;
  }
  if (!cookieMode) {
    // Lien /k/{clé} : on échange la clé contre une session cookie afin de la
    // retirer de la barre d'URL, puis on rejoint /me. La clé n'est plus en URL.
    try {
      await api("/api/auth/session-from-key", { method: "POST", headers: { "x-access-key": key } });
      setLastHandle(data.handle);
      setSessionHint(true);
      setStoredKey(null); // migration : plus besoin de conserver la clé en localStorage
      setStoredHandle(null);
      location.replace("/me");
      return;
    } catch {
      // Échec réseau : on poursuit en mode lien classique (clé dans l'URL).
    }
  }
  if (cookieMode) {
    appState.key = data.accessKey || null; // récupère la clé pour afficher le lien privé / QR / rotation
    setAccessKey(appState.key); // reflète la clé (mode cookie) dans net.js
    setSessionHint(true);
    appState.auth = { handle: data.handle, key: appState.key }; // état d'auth cohérent pour les pages suivantes
  }
  setLastHandle(data.handle); // mémorise le handle de la dernière connexion (reconnexion auto + pré-remplissage)
  if (storedKey() === appState.key) setStoredHandle(data.handle); // garde le handle associé à la clé mémorisée
  connectSSE(cookieMode ? null : appState.key); // flux temps réel (notifications, messages)
  // Premium dev : l'état réel vient de /api/me (ligne d'abonnement provider "dev"
  // posée par le toggle Options via POST /api/dev/premium) → par-utilisateur, pas
  // de simulation client. Plus de patch localStorage ici.
  renderEditor(data); // affiche l'UI immédiatement, sans attendre la clé E2E
  // E2E en arrière-plan : ne bloque pas le rendu (la clé n'est utile que pour le chat).
  // On publie aussi le bundle de prekeys dès la connexion : ainsi un contact peut
  // m'écrire en v2 (Double Ratchet) sans attendre que j'ouvre une conversation.
  const hadPubkey = !!data.pubkey;
  ensureE2E(data.handle, appState.key)
    .then(async () => {
      if (!E2E.pubStr && data.pubkey) E2E.pubStr = data.pubkey;
      if (E2E.needsRestore) {
        // Clé dans le coffre mais absente du navigateur → restauration nécessaire.
        toast("🔑 Votre clé E2E est dans le coffre — restaurez-la pour activer la messagerie chiffrée.");
        openE2eRestore(data.handle, appState.key, () => renderPrivate(appState.key));
        return;
      }
      if (!hadPubkey && E2E.pubStr) toast("🔒 Messagerie chiffrée activée ✓");
      // Clé neuve (ou jamais sauvegardée) sans coffre → on FORCE la mise en coffre
      // dès la connexion : sans ça, perte d'appareil = messages illisibles.
      if (E2E.needsBackup) {
        openE2eBackup(data.handle, appState.key, () => renderPrivate(appState.key), { mandatory: true });
      }
      return ratchetEnsurePrekeys(data.handle, appState.key);
    })
    .catch(() => {
      if (!hadPubkey) {
        const msg = window.isSecureContext === false || !crypto.subtle
          ? "🔒 La messagerie chiffrée requiert HTTPS ou localhost (pas disponible sur http://IP)."
          : "⚠ Impossible d'activer la messagerie chiffrée. Rechargez la page pour réessayer.";
        toast(msg);
      }
    });
}

/* --------------------------- Abonnement Premium (P3) --------------------- */
// Intention d'upgrade mémorisée avant inscription (parcours anonyme → compte).
const PENDING_UPGRADE = "mindlog.pendingUpgrade";

// Démarre un abonnement : ouvre le Checkout Stripe (redirection).
async function startCheckout() {
  try {
    const res = await api("/api/billing/checkout", { method: "POST", headers: jsonAuth() });
    if (res?.url) { location.assign(res.url); return; }
    toast(res?.error || "Abonnements momentanément indisponibles.");
  } catch (e) {
    toast(e?.message || "Abonnements momentanément indisponibles.");
  }
}

// Ouvre le portail de facturation Stripe (gérer/résilier/changer de carte).
async function openBillingPortal() {
  try {
    const res = await api("/api/billing/portal", { method: "POST", headers: jsonAuth() });
    if (res?.url) { location.assign(res.url); return; }
    toast(res?.error || "Indisponible pour le moment.");
  } catch (e) {
    toast(e?.message || "Indisponible pour le moment.");
  }
}

// Retour de Stripe : le Premium est activé par le webhook (asynchrone), on
// attend que l'état serveur bascule avant de débloquer l'UI.
async function pollPremiumActivation() {
  toast("Activation de votre Premium…");
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const fresh = await api("/api/me", { headers: authHeaders() });
      if (fresh?.subscription?.plan === "premium" || fresh?.plan === "premium") {
        toast("Bienvenue en Premium ! 🦎");
        renderEditor(fresh);
        return;
      }
    } catch { /* on réessaie */ }
  }
  toast("Activation en cours, cela peut prendre un instant. Rechargez si besoin.");
}

// Gère les retours de paiement (?upgrade=success|cancel|start) et la reprise
// d'intention après inscription (sessionStorage). Appelé en fin de renderEditor.
function handleBilling(data) {
  let upgrade = null;
  let pending = false;
  try {
    upgrade = new URLSearchParams(location.search).get("upgrade");
    pending = sessionStorage.getItem(PENDING_UPGRADE) === "1";
  } catch { /* storage/URL indisponible */ }
  const cleanUrl = () => { try { history.replaceState(null, "", location.pathname); } catch { /* noop */ } };
  const premium = data?.subscription?.plan === "premium" || data?.plan === "premium";

  // Retour d'onboarding Stripe Connect (créateur).
  let connect = null;
  try { connect = new URLSearchParams(location.search).get("connect"); } catch { /* noop */ }
  if (connect === "done") { cleanUrl(); toast("Configuration des paiements enregistrée ✓"); return; }
  if (connect === "refresh") { cleanUrl(); toast("Reprenez la configuration des paiements quand vous voulez."); return; }

  if (upgrade === "cancel") {
    cleanUrl();
    toast("Paiement annulé — vous pouvez réessayer quand vous voulez.");
    return;
  }
  if (upgrade === "success") {
    cleanUrl();
    if (premium) toast("Bienvenue en Premium ! 🦎");
    else void pollPremiumActivation();
    return;
  }
  if (upgrade === "start" || pending) {
    try { sessionStorage.removeItem(PENDING_UPGRADE); } catch { /* noop */ }
    cleanUrl();
    if (premium) { toast("Vous êtes déjà Premium 🦎"); return; }
    void startCheckout();
  }
}

// Icône représentant un type de page (utilisé dans la liste).
const ppTypeIcon = (t) =>
  t === "gallery" ? icon("image", 14)
  : t === "link"  ? icon("link", 14)
  : t === "file"  ? icon("download", 14)
  :                 icon("chat", 14); // markdown par défaut

// Slug auto-généré à partir du titre. Reste éditable par l'utilisateur tant
// qu'il n'a pas saisi son propre slug (suivi via dataset.touched sur l'input).
function slugifyTitle(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

// HTML des champs spécifiques à un type de page. Le payload est lu plus tard
// par collectTypeContent() en relisant ces mêmes inputs.
// Auto-préfixe https:// si l'utilisateur a tapé un domaine sans schéma
// (ex. "exemple.com" → "https://exemple.com"). Conserve mailto:/tel:/data:.
// Évite le rejet serveur silencieux "URL invalide (http/https requis)".
function autoHttps(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/^(https?:\/\/|mailto:|tel:|data:)/i.test(s)) return s;
  return "https://" + s;
}

function ppTypeFieldsHtml(type, current, ctx = {}) {
  if (type === "markdown") {
    const v = typeof current === "string" ? current : "";
    return `<textarea id="pp-md" rows="8" placeholder="# Mon document\n\nContenu réservé aux abonnés…" maxlength="50000">${esc(v)}</textarea>`;
  }
  if (type === "link") {
    const o = (current && typeof current === "object") ? current : {};
    return `<input id="pp-link-url" type="text" inputmode="url" autocomplete="off" placeholder="exemple.com ou https://…" maxlength="2000" value="${esc(o.url || "")}">
            <input id="pp-link-note" placeholder="Note pour l'abonné (optionnel)" maxlength="500" value="${esc(o.note || "")}">`;
  }
  if (type === "gallery") {
    // Système identique à la galerie classique : grille de vignettes + zone de
    // dépôt + sélecteur de fichiers. Les médias sont uploadés sur le serveur
    // (data/page-media/<page_id>/…) puis servis via /api/pages/.../media/….
    const items = (current && Array.isArray(current.items)) ? current.items : [];
    const slug = ctx.slug || "";
    const handle = ctx.handle || "";
    const gridHtml = items.map((it) => galItemHtml(it, handle, slug)).join("");
    return `<div class="gal-grid pp-gal-grid" id="pp-gal-grid" data-slug="${esc(slug)}" data-handle="${esc(handle)}">${gridHtml}</div>
            <div class="gal-drop pp-gal-drop" id="pp-gal-drop">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <span>Glisse des images ou des vidéos (≤25 Mo, max 30)</span>
              <label class="btn sm" style="cursor:pointer">Parcourir
                <input type="file" accept="image/*,video/*" multiple hidden id="pp-gal-file" />
              </label>
            </div>
            <p class="lbl-sm" id="pp-gal-hint" style="margin:.4rem 0 0;opacity:.7">${slug ? "Tes médias sont privés et ne sont accessibles qu'aux abonné·e·s." : "Enregistre la page une première fois pour pouvoir ajouter des médias."}</p>`;
  }
  if (type === "file") {
    const o = (current && typeof current === "object") ? current : {};
    const slug = ctx.slug || "";
    const handle = ctx.handle || "";
    const hasFile = !!o.url;
    const fileUrl = hasFile && !String(o.url).startsWith("http")
      ? `/api/pages/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}/media/${encodeURIComponent(o.url)}`
      : (o.url || "");
    return `<div class="pp-file-state" id="pp-file-state" data-slug="${esc(slug)}" data-handle="${esc(handle)}" data-filename="${esc(o.url || "")}">
        ${hasFile
          ? `<div class="pp-file-card">
              <span class="pp-file-ic">${icon("download", 18)}</span>
              <div class="pp-file-info">
                <b>${esc(o.name || "fichier")}</b>
                <span class="lbl-sm">${o.size ? `${(o.size/1024).toFixed(1)} Ko` : ""}</span>
              </div>
              <a class="btn sm" href="${esc(fileUrl)}" target="_blank" rel="noopener">Aperçu</a>
              <button type="button" class="btn sm danger" id="pp-file-del">Remplacer</button>
            </div>`
          : `<div class="pp-file-empty">
              <span class="pp-file-ic">${icon("download", 22)}</span>
              <p>${slug ? "Choisis un fichier PDF ou ZIP à téléverser (≤25 Mo)." : "Enregistre la page une première fois pour pouvoir téléverser le fichier."}</p>
              <label class="btn primary sm" style="cursor:pointer">Choisir un fichier
                <input type="file" accept=".pdf,.zip,application/pdf,application/zip" hidden id="pp-file-input" ${slug ? "" : "disabled"}>
              </label>
            </div>`}
      </div>`;
  }
  return "";
}

// Vignette unique pour la grille galerie du wizard. data-filename sert au DELETE.
function galItemHtml(it, handle, slug) {
  const filename = String(it.url || "");
  const src = filename.startsWith("http")
    ? filename
    : `/api/pages/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}/media/${encodeURIComponent(filename)}`;
  const isVideo = it.kind === "video" || /\.(mp4|webm|mov)(\?|$)/i.test(filename);
  return `<div class="gal-item" data-filename="${esc(filename)}">
    ${isVideo
      ? `<video src="${esc(src)}" muted playsinline preload="metadata"></video>`
      : `<img src="${esc(src)}" alt="${esc(it.caption || "")}" loading="lazy" />`}
    <button type="button" class="gal-del" title="Supprimer">✕</button>
  </div>`;
}

// Lit les inputs du formulaire et reconstruit le payload `content` attendu
// par le backend (chaîne pour markdown, objet sérialisable pour les autres).
// Pour la galerie : on relit l'état persisté dans #pp-gal-grid (chaque .gal-item
// a son data-filename) — le textarea n'existe plus.
function collectTypeContent(root, type) {
  if (type === "markdown") return root.querySelector("#pp-md")?.value || "";
  if (type === "link") {
    return {
      url: autoHttps(root.querySelector("#pp-link-url")?.value),
      note: (root.querySelector("#pp-link-note")?.value || "").trim(),
    };
  }
  if (type === "gallery") {
    const grid = root.querySelector("#pp-gal-grid");
    if (!grid) return { items: [] };
    const items = [...grid.querySelectorAll(".gal-item")].map((el) => {
      const filename = el.dataset.filename || "";
      const isVideo = !!el.querySelector("video");
      return { url: filename, kind: isVideo ? "video" : "image", caption: "" };
    }).filter((it) => it.url);
    return { items };
  }
  if (type === "file") {
    const st = root.querySelector("#pp-file-state");
    return { url: st?.dataset.filename || "", name: "", size: 0 };
  }
  return null;
}

// Charge le tarif de l'espace + intro Markdown + brancher les sauvegardes.
// Idempotent : appelé à chaque rendu de la page Premium.
async function loadSpacePricing(root) {
  const priceInput = root.querySelector("#sp-price");
  const status = root.querySelector("#sp-status");
  const introTa = root.querySelector("#sp-intro");
  const introStatus = root.querySelector("#sp-intro-status");
  const profIntroTa = root.querySelector("#sp-profile-intro");
  const profIntroStatus = root.querySelector("#sp-profile-intro-status");
  const benefitCbs = root.querySelectorAll(".prem-benefit-cb");
  const benefitStatus = root.querySelector("#prem-benefits-status");
  if (!priceInput && !introTa && !profIntroTa && !benefitCbs.length) return;
  let currentBenefits = { chat: true, call: true, pages: true, rdv: true, lives: true };
  try {
    const sp = await api("/api/space", { headers: authHeaders() });
    if (priceInput && sp.price_cents) priceInput.value = (sp.price_cents / 100).toFixed(2);
    if (status) status.textContent = sp.active ? "✓ vendable" : (sp.price_cents ? "prix défini, activation en attente" : "");
    if (introTa && typeof sp.intro_md === "string") introTa.value = sp.intro_md;
    if (profIntroTa && typeof sp.profile_intro_md === "string") profIntroTa.value = sp.profile_intro_md;
    if (sp.benefits && typeof sp.benefits === "object") {
      currentBenefits = { ...currentBenefits, ...sp.benefits };
      benefitCbs.forEach((cb) => { cb.checked = !!currentBenefits[cb.name]; });
    }
  } catch { /* pas de prix encore */ }
  // Sauvegarde immédiate sur changement de checkbox. Une requête par toggle,
  // suffisamment rare pour ne pas justifier un debounce.
  benefitCbs.forEach((cb) => {
    cb.addEventListener("change", async () => {
      currentBenefits = { ...currentBenefits, [cb.name]: !!cb.checked };
      if (benefitStatus) benefitStatus.textContent = "Enregistrement…";
      try {
        const r = await api("/api/space/benefits", {
          method: "PUT",
          headers: jsonAuth(),
          body: JSON.stringify(currentBenefits),
        });
        if (r?.benefits) currentBenefits = { ...currentBenefits, ...r.benefits };
        if (benefitStatus) benefitStatus.textContent = "✓ enregistré";
      } catch (e) {
        if (benefitStatus) benefitStatus.textContent = "";
        cb.checked = !cb.checked; // revert UI
        currentBenefits = { ...currentBenefits, [cb.name]: !!cb.checked };
        toast(e?.message === "premium required" ? "Réservé aux comptes Premium." : (e?.message || "Échec."));
      }
    });
  });
  root.querySelector("#sp-save")?.addEventListener("click", async () => {
    const price = Math.round(parseFloat(priceInput.value) * 100);
    if (!Number.isFinite(price) || price < 100) { toast("Prix invalide (min 1,00 €)."); return; }
    try {
      const sp = await api("/api/space", { method: "PUT", headers: jsonAuth(), body: JSON.stringify({ price_cents: price }) });
      if (status) status.textContent = sp.active ? "✓ vendable" : "enregistré (activation en attente)";
      toast("Tarif enregistré ✓");
    } catch (e) {
      toast(e?.message === "premium required" ? "Réservé aux comptes Premium." : (e?.message || "Échec."));
    }
  });
  const saveIntro = async (ta, statusEl, endpoint, label) => {
    const val = ta.value || "";
    if (val.length > 4000) { toast("Intro trop longue (max 4000 caractères)."); return; }
    try {
      await api(endpoint, { method: "PUT", headers: jsonAuth(), body: JSON.stringify({ intro_md: val }) });
      if (statusEl) statusEl.textContent = "✓ enregistré";
      toast(`${label} enregistrée ✓`);
    } catch (e) {
      toast(e?.message === "premium required" ? "Réservé aux comptes Premium." : (e?.message || "Échec."));
    }
  };
  root.querySelector("#sp-intro-save")?.addEventListener("click", () =>
    introTa && saveIntro(introTa, introStatus, "/api/space/intro", "Intro de l'espace")
  );
  root.querySelector("#sp-profile-intro-save")?.addEventListener("click", () =>
    profIntroTa && saveIntro(profIntroTa, profIntroStatus, "/api/space/profile-intro", "Intro du profil")
  );
}

// Peuple les blocs « Tarif de l'espace » + « Pages de l'espace » de la page
// Premium (statut Connect, liste de pages, wizard d'ajout). `root` = la page
// Premium (hors #app), donc on requête dans `root`, pas dans `app`.
async function loadPaidPages(root, data) {
  const block = root.querySelector("#pp-block");
  if (!block) return;

  // ── Statut Stripe Connect (partagé avec le bloc tarif) ────────────────────
  const connectEl = root.querySelector("#pp-connect");
  try {
    const st = await api("/api/billing/connect/status", { headers: authHeaders() });
    if (st.chargesEnabled) {
      connectEl.innerHTML = `✅ Paiements actifs — vous pouvez vendre l'accès à votre espace.`;
    } else {
      connectEl.innerHTML = `<button type="button" class="btn sm" id="pp-onboard">Configurer les paiements</button> <span style="opacity:.7">(requis pour vendre)</span>`;
      root.querySelector("#pp-onboard")?.addEventListener("click", async () => {
        try {
          const r = await api("/api/billing/connect/onboard", { method: "POST", headers: jsonAuth() });
          if (r?.url) location.assign(r.url);
        } catch (e) { toast(e?.message || "Indisponible."); }
      });
    }
  } catch { connectEl.innerHTML = ""; }

  // ── Tarif de l'espace ─────────────────────────────────────────────────────
  void loadSpacePricing(root);

  // ── Liste des pages ──────────────────────────────────────────────────────
  const pagesEl = root.querySelector("#pp-pages");
  const countEl = root.querySelector("#pp-count");
  let pages = [];
  try {
    pages = (await api("/api/pages", { headers: authHeaders() })).pages || [];
  } catch { /* liste vide */ }
  if (countEl) countEl.textContent = pages.length ? `${pages.length} page${pages.length > 1 ? "s" : ""}` : "";
  pagesEl.innerHTML = pages.length
    ? pages.map((p) =>
        `<div class="pp-row" data-slug="${esc(p.slug)}">
           <span class="pp-row-ic">${ppTypeIcon(p.type)}</span>
           <b>${esc(p.title)}</b>
           <span class="lbl-sm">/${esc(p.slug)} · ${p.published ? "publiée" : "brouillon"}</span>
           <a href="/@${esc(data.handle)}/p/${esc(p.slug)}" target="_blank" rel="noopener" style="margin-left:auto">Voir ↗</a>
           <button type="button" class="btn sm" data-pp-edit>Éditer</button>
           <button type="button" class="btn sm danger" data-pp-del title="Supprimer">✕</button>
         </div>`
      ).join("")
    : `<p class="lbl-sm">Aucune page pour l'instant. Ajoutez-en une via « + Ajouter une page ».</p>`;

  // Édition / suppression d'une ligne existante : on rouvre le wizard pré-rempli.
  pagesEl.querySelectorAll("[data-pp-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const slug = btn.closest(".pp-row")?.dataset.slug;
      if (!slug) return;
      const ok = await confirmDialog(`Supprimer la page « ${slug} » ?`, { danger: true, ok: "Supprimer" });
      if (!ok) return;
      try {
        await api(`/api/pages/${encodeURIComponent(slug)}`, { method: "DELETE", headers: authHeaders() });
        toast("Page supprimée");
        void loadPaidPages(root, data);
      } catch (e) { toast(e?.message || "Échec."); }
    });
  });
  pagesEl.querySelectorAll("[data-pp-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const slug = btn.closest(".pp-row")?.dataset.slug;
      const page = pages.find((p) => p.slug === slug);
      if (page) openWizardForm(root, data, page);
    });
  });

  // ── Wizard d'ajout ───────────────────────────────────────────────────────
  root.querySelector("#pp-add-btn")?.addEventListener("click", () => openWizardTypeChooser(root, data));
  root.querySelectorAll("[data-wiz-cancel]").forEach((b) => b.addEventListener("click", () => closeWizard(root)));
}

function openWizardTypeChooser(root, data) {
  const wiz = root.querySelector("#pp-wizard");
  if (!wiz) return;
  wiz.hidden = false;
  wiz.querySelector('[data-step="type"]').hidden = false;
  wiz.querySelector('[data-step="form"]').hidden = true;
  // Bind chaque carte de type → ouvre le formulaire dédié.
  wiz.querySelectorAll(".pp-type-card").forEach((card) => {
    if (card.disabled) return;
    card.onclick = () => {
      const type = card.dataset.type;
      openWizardForm(root, data, { type });
    };
  });
  wiz.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function openWizardForm(root, data, page) {
  const wiz = root.querySelector("#pp-wizard");
  if (!wiz) return;
  wiz.hidden = false;
  wiz.querySelector('[data-step="type"]').hidden = true;
  const formStep = wiz.querySelector('[data-step="form"]');
  formStep.hidden = false;

  const isEdit = !!page?.slug;
  const type = page?.type || "markdown";
  const head = wiz.querySelector("#pp-form-head");
  const typeLabel = type === "gallery" ? "Galerie" : type === "link" ? "Lien externe" : type === "file" ? "Fichier" : "Markdown";
  head.innerHTML = `${ppTypeIcon(type)} ${isEdit ? "Éditer" : "Nouvelle page"} — ${typeLabel}`;

  const titleInp = wiz.querySelector("#pp-title");
  const slugInp = wiz.querySelector("#pp-slug");
  const pubInp = wiz.querySelector("#pp-pub");
  titleInp.value = page?.title || "";
  slugInp.value = page?.slug || "";
  slugInp.dataset.touched = isEdit ? "1" : "0";
  // En création : publié par défaut (sinon la page n'apparaît nulle part côté
   // visiteur et le propriétaire ne comprend pas pourquoi rien ne s'affiche).
  pubInp.checked = isEdit ? !!page?.published : true;

  // Auto-slugify : tant que l'utilisateur n'a pas édité le slug à la main,
  // on le met à jour à partir du titre.
  titleInp.oninput = () => {
    if (slugInp.dataset.touched !== "1") slugInp.value = slugifyTitle(titleInp.value);
  };
  slugInp.oninput = () => { slugInp.dataset.touched = "1"; };

  // Champs type-spécifiques : si on édite, parse le content existant.
  let parsed = page?.content;
  if (parsed && typeof parsed === "string" && type !== "markdown") {
    try { parsed = JSON.parse(parsed); } catch { parsed = null; }
  }
  // ctx : nécessaire pour construire les URLs servables des médias galerie/fichier.
  // En création, slug est vide → l'UI affiche un message « enregistre d'abord ».
  const ctx = { slug: page?.slug || "", handle: data.handle };
  wiz.querySelector("#pp-type-fields").innerHTML = ppTypeFieldsHtml(type, parsed, ctx);
  wirePpTypeFields(root, type, ctx);

  wiz.querySelector("[data-wiz-back]").onclick = () => openWizardTypeChooser(root, data);
  wiz.querySelector("#pp-save").onclick = async () => {
    const slug = slugInp.value.trim();
    const title = titleInp.value.trim();
    if (!title) { toast("Titre requis."); return; }
    if (!/^[a-z0-9][a-z0-9-]{0,48}$/.test(slug)) { toast("Slug invalide (a-z, 0-9, tirets)."); return; }
    const content = collectTypeContent(root, type);
    try {
      await api("/api/pages", {
        method: "PUT",
        headers: jsonAuth(),
        body: JSON.stringify({ slug, title, type, content, published: pubInp.checked }),
      });
      toast("Page enregistrée ✓");
      closeWizard(root);
      void loadPaidPages(root, data);
    } catch (e) {
      toast(e?.message === "premium required" ? "Réservé aux comptes Premium." : (e?.message || "Échec."));
    }
  };
  titleInp.focus();
  wiz.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function closeWizard(root) {
  const wiz = root.querySelector("#pp-wizard");
  if (wiz) wiz.hidden = true;
}

// Câble upload/drop/delete pour les types média (gallery + file). Disponible
// seulement après la première sauvegarde de la page (slug existant dans ctx).
function wirePpTypeFields(root, type, ctx) {
  if (type !== "gallery" && type !== "file") return;
  const slug = ctx.slug;
  if (!slug) return; // page pas encore enregistrée → upload désactivé

  if (type === "gallery") {
    const grid = root.querySelector("#pp-gal-grid");
    const drop = root.querySelector("#pp-gal-drop");
    const fileInp = root.querySelector("#pp-gal-file");
    if (!grid || !drop || !fileInp) return;

    const uploadFiles = async (files) => {
      if (!files?.length) return;
      const fd = new FormData();
      for (const f of files) fd.append("media", f);
      try {
        const r = await api(`/api/pages/${encodeURIComponent(slug)}/media`, {
          method: "POST", headers: authHeaders(), body: fd,
        });
        for (const it of (r.added || [])) {
          const tmp = document.createElement("div");
          tmp.innerHTML = galItemHtml(it, ctx.handle, slug);
          const node = tmp.firstElementChild;
          grid.appendChild(node);
          wireGalDelete(node, slug);
        }
        toast(`${r.added?.length || 0} média(s) ajouté(s) ✓`);
      } catch (e) {
        toast(e?.message || "Upload échoué.");
      }
    };

    fileInp.addEventListener("change", () => {
      if (fileInp.files?.length) uploadFiles(fileInp.files);
      fileInp.value = "";
    });
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("drag-over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("drag-over"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("drag-over");
      if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
    });
    grid.querySelectorAll(".gal-item").forEach((el) => wireGalDelete(el, slug));
  }

  if (type === "file") {
    const st = root.querySelector("#pp-file-state");
    if (!st) return;
    const inp = root.querySelector("#pp-file-input");
    const del = root.querySelector("#pp-file-del");
    inp?.addEventListener("change", async () => {
      const file = inp.files?.[0];
      inp.value = "";
      if (!file) return;
      const fd = new FormData();
      fd.append("file", file);
      try {
        const r = await api(`/api/pages/${encodeURIComponent(slug)}/media`, {
          method: "POST", headers: authHeaders(), body: fd,
        });
        const a = r.added?.[0];
        if (a) {
          st.dataset.filename = a.url;
          // Re-rendu local : on remplace l'état vide par la carte fichier.
          const fileUrl = `/api/pages/${encodeURIComponent(ctx.handle)}/${encodeURIComponent(slug)}/media/${encodeURIComponent(a.url)}`;
          st.innerHTML = `<div class="pp-file-card">
            <span class="pp-file-ic">${icon("download", 18)}</span>
            <div class="pp-file-info">
              <b>${esc(a.caption || file.name)}</b>
              <span class="lbl-sm">${(file.size/1024).toFixed(1)} Ko</span>
            </div>
            <a class="btn sm" href="${esc(fileUrl)}" target="_blank" rel="noopener">Aperçu</a>
            <button type="button" class="btn sm danger" id="pp-file-del">Remplacer</button>
          </div>`;
          // Re-câble le bouton de remplacement.
          wirePpTypeFields(root, "file", ctx);
        }
        toast("Fichier téléversé ✓");
      } catch (e) {
        toast(e?.message || "Upload échoué.");
      }
    });
    del?.addEventListener("click", async () => {
      const filename = st.dataset.filename;
      if (!filename) return;
      try {
        await api(`/api/pages/${encodeURIComponent(slug)}/media/${encodeURIComponent(filename)}`, {
          method: "DELETE", headers: authHeaders(),
        });
        st.dataset.filename = "";
        // Re-rendu de l'état vide.
        const handle = ctx.handle;
        st.innerHTML = `<div class="pp-file-empty">
          <span class="pp-file-ic">${icon("download", 22)}</span>
          <p>Choisis un fichier PDF ou ZIP à téléverser (≤25 Mo).</p>
          <label class="btn primary sm" style="cursor:pointer">Choisir un fichier
            <input type="file" accept=".pdf,.zip,application/pdf,application/zip" hidden id="pp-file-input">
          </label>
        </div>`;
        void handle;
        wirePpTypeFields(root, "file", ctx);
        toast("Fichier retiré");
      } catch (e) { toast(e?.message || "Échec."); }
    });
  }
}

function wireGalDelete(itemEl, slug) {
  const btn = itemEl.querySelector(".gal-del");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const filename = itemEl.dataset.filename;
    if (!filename) { itemEl.remove(); return; }
    try {
      await api(`/api/pages/${encodeURIComponent(slug)}/media/${encodeURIComponent(filename)}`, {
        method: "DELETE", headers: authHeaders(),
      });
      itemEl.remove();
    } catch (e) { toast(e?.message || "Suppression échouée."); }
  });
}

export function renderEditor(data) {
  // Invitation en attente (lien `/i/<token>` ouvert avant connexion) → accepter.
  consumePendingInvite();
  // Calendrier de l'éditeur : règle de dispo perso (jours/week-end/périodes).
  host.calendar.setAvailability((data.settings || {}).availability);
  const photo = data.hasPhoto
    ? `<img class="photo" src="/api/identities/${encodeURIComponent(data.handle)}/photo?ts=${Date.now()}" alt="Photo" />`
    : data.handle === "milo"
      ? `<div class="photo milo-photo">${miloSvg(120)}</div>`
      : `<div class="photo avatar">${genericAvatarSvg(
          data.handle,
          ((data.fields.find((f) => f.key === "display_name")?.value || data.handle)[0] || "·").toUpperCase()
        )}</div>`;
  const rel = data.relations || { 1: [], 2: [], 3: [] };
  // Relations directes (degré 1) scindées : amis mis en avant dans l'onglet
  // « Amis », le reste (pro/autre + degrés étendus) dans l'onglet « Réseau ».
  const _deg1 = rel[1] || [];
  const _friends = _deg1.filter((r) => r.type === "amis");
  const _others = _deg1.filter((r) => r.type !== "amis");
  const _incoming = data.incoming || [];
  const _reseauCount = _others.length + _incoming.length + (rel[2]?.length || 0) + (rel[3]?.length || 0);

  // Charge par jour pour la heatmap du calendrier (événements + RDV acceptés).
  const dayLoad = dayLoadMap(data);

  const cols = [
    renderAccountColumn(data, { photo }),
    renderIdentityColumn(data, { photo, fieldEditHtml, socialEditHtml }),
    renderAgendaColumn(data, { reqFilterChips, requestsHtml, dayLoad }),
    renderRelationsColumn(data, { incomingListHtml }),
    renderNotificationsColumn(data, { notifListHtml }),
  ];

  // Colonnes cœur + colonnes contribuées par les plugins (registre). Le tri par
  // `order` fixe l'ordre du deck (voir coreOrders ci-dessous) ; le Compte n'est
  // plus une colonne (déplacé dans l'onglet « Compte » de l'Identité).
  // Panneau Options
  const optCol = renderOptionsColumn(data);

  // Colonne Communications (Discuter + Appel, 2 colonnes WhatsApp-like)
  const commContacts = (() => {
    const convMap = new Map((data.conversations || []).map(c => [c.handle, c]));
    const convList = [...convMap.values()].map(c => {
      const last = (c.messages || []).reduce((mx, m) => m.created_at > mx ? m.created_at : mx, "");
      return { handle: c.handle, displayName: c.display_name || null, hasPhoto: c.has_photo, lastAt: last, unread: (c.messages || []).filter(m => !m.mine && m.read === 0).length, isConv: true };
    });
    const convHandles = new Set(convMap.keys());
    const others = _deg1.filter(r => !convHandles.has(r.handle)).map(r => ({ handle: r.handle, displayName: r.display_name || null, hasPhoto: r.has_photo, lastAt: "", unread: 0, isConv: false }));
    // Tri : non-lus d'abord, puis activité récente, puis contacts favoris, puis alphabétique.
    const favSet = new Set((_deg1 || []).filter(r => r.favorite).map(r => r.handle));
    return [...convList, ...others].sort((a, b) => {
      if ((a.unread > 0) !== (b.unread > 0)) return a.unread > 0 ? -1 : 1;
      if (a.lastAt !== b.lastAt) return b.lastAt.localeCompare(a.lastAt);
      const fa = favSet.has(a.handle), fb = favSet.has(b.handle);
      if (fa !== fb) return fa ? -1 : 1;
      return a.handle.localeCompare(b.handle);
    });
  })();

  function commContactHtml(c) {
    const init = (c.handle[0] || "?").toUpperCase();
    // L'initiale colorée est TOUJOURS rendue en fond ; la photo se superpose et,
    // si elle échoue (404 / has_photo périmé), s'efface pour révéler l'initiale.
    const bg = `hsl(${[...c.handle].reduce((h,x)=>(h*31+x.charCodeAt(0))%360,0)} 40% 46%)`;
    const initSpan = `<span class="comm-av-init" style="background:${bg};color:#fff">${esc(init)}</span>`;
    const av = c.hasPhoto
      ? `<img class="comm-av-img" src="/api/identities/${encodeURIComponent(c.handle)}/photo" alt="" loading="lazy" onerror="this.remove()" />${initSpan}`
      : initSpan;
    const timePart = c.lastAt ? `<span class="comm-time">${new Date(c.lastAt).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}</span>` : "";
    const unread = c.unread ? `<span class="comm-unread">${c.unread}</span>` : "";
    const sub = c.displayName ? esc(c.displayName) : (c.isConv ? `${icon("lock", 11)} Message chiffré` : "Connexion directe");
    return `<div class="comm-contact-item" data-handle="${esc(c.handle)}" data-search="${esc(c.handle + " " + (c.displayName||"")).toLowerCase()}">
      <div class="comm-av">${av}</div>
      <div class="comm-contact-body">
        <div class="comm-contact-name">@${esc(c.handle)}</div>
        <div class="comm-contact-sub">${sub}</div>
      </div>
      <div class="comm-contact-meta">${timePart}${unread}</div>
    </div>`;
  }

  appState.commEmptyHtml = `<div class="comm-empty-state"><h3>Sélectionnez un contact</h3><p>Choisissez un contact pour démarrer une conversation ou passer un appel.</p></div>`;

  const commColHtml = `<div class="comm-wrapper">
    <div class="comm-layout">
      <div class="comm-sidebar">
        <div class="comm-topbar">${icon("chat",16)} Communications</div>
        <div class="comm-search-wrap">
          <input id="comm-search" placeholder="Rechercher un contact…" autocomplete="off" />
        </div>
        <div class="comm-contacts-list" id="comm-contacts">
          ${commContacts.length
            ? (commContacts.some(c => c.isConv) ? `<div class="comm-sep">Conversations récentes</div>` : "")
              + commContacts.filter(c => c.isConv).map(commContactHtml).join("")
              + (commContacts.some(c => !c.isConv) ? `<div class="comm-sep">Connexions directes</div>` : "")
              + commContacts.filter(c => !c.isConv).map(commContactHtml).join("")
            : `<div class="comm-empty-state"><p>Aucun contact. Ajoutez des connexions pour pouvoir discuter.</p></div>`}
        </div>
      </div>
      <div class="comm-right" id="comm-right">${appState.commEmptyHtml}</div>
    </div>
  </div>`;

  // Ordre du menu (communication d'abord) : Accueil · Chat · Notifs · Réseau ·
  // Mon ID · Galerie (plugin, order 45) · Agenda · Options (réglages, en dernier).
  const coreOrders = [5, 40, 50, 30, 20, 60, 10];
  const coreLabels = ["Compte", "Identité", "Agenda", "Relations", "Notifications", "Options", "Chat"];
  const allCols = (() => {
    const list = [...cols, optCol, commColHtml]
      .map((html, i) => ({ order: coreOrders[i], label: coreLabels[i], html }))
      .concat(host.getPlugins().flatMap((p) => (p.editorColumns ? p.editorColumns(host, data) : [])))
      .sort((a, b) => a.order - b.order);
    // Dédoublonnage par label : garde-fou contre une colonne contribuée deux fois
    // par un plugin (ex. « Galerie » en double) → une seule colonne par onglet.
    const seen = new Set();
    return list.filter((c) => (seen.has(c.label) ? false : (seen.add(c.label), true)));
  })();

  const _displayName = data.fields.find(f => f.key === "display_name")?.value || null;
  // Source de vérité la plus riche pour le chip header : on alimente le cache
  // partagé avec le nom et la photo issus de /api/me.
  setMeProfile({ name: _displayName, hasPhoto: data.hasPhoto });
  const BNAV = {
    Identité: { label: "Mon ID", ic: "user" },
    Agenda: { label: "Agenda", ic: "calendar" },
    Relations: { label: "Réseau", ic: "users" },
    Notifications: { label: "Notifs", ic: "bell" },
    Compte: { label: "Compte", ic: "user" },
    Galerie: { label: "Galerie", ic: "image" },
    Options: { label: "Options", ic: "settings" },
    Chat: { label: "Chat", ic: "chat" },
  };
  app.setAttribute("data-view", "private");
  app.innerHTML = `
   ${siteHeader({
     center: headerSearchHtml(),
     right: `<button class="btn sm notif-wrap" id="notif-bell" aria-label="Notifications" style="display:none"><span class="notif-badge" id="notif-badge" ${data.unread ? "" : "hidden"}>${data.unread || ""}</span></button>
       ${headerAccount(data.unread || 0)}`,
   })}
   <div class="deck-viewport" id="deck-viewport">
     <div class="deck" id="deck">
       ${allCols.map((c, i) => `<section class="col" data-col="${i}" data-deck-label="${esc(c.label || "")}">${c.html}</section>`).join("")}
     </div>
   </div>
   <nav class="bottom-nav" id="bottom-nav" aria-label="Navigation principale">
     ${(() => {
       const chatUnread = (data.conversations || []).reduce((s, cv) => s + (cv.messages || []).filter(m => !m.mine && m.read === 0).length, 0);
       const unreadFor = (label) => label === "Notifications" ? (data.unread || 0) : (label === "Chat" ? chatUnread : 0);
       // Refonte 2026 — barre directe (sans menu « Plus ») : Accueil · Chat ·
       // Réseau · Agenda · Galerie · Options. « Mon ID » (Identité) est accessible
       // depuis l'Accueil (« Modifier ma carte ») ; les Notifications via la cloche
       // du header. L'ordre est fixe et chaque label n'apparaît qu'une fois.
       const NAV = ["Chat", "Relations", "Agenda", "Compte"];
       const navBtn = ({ i, label }) => {
         const cfg = BNAV[label] || { label, ic: "circle" };
         const isChat = label === "Chat";
         const hasUnread = unreadFor(label);
         // Le badge Chat est TOUJOURS présent (masqué si 0) avec un sélecteur
         // stable : la mise à jour temps réel (SSE) le retrouve sans re-rendu.
         const badge = isChat
           ? `<span class="bnav-badge" data-chat-badge ${hasUnread ? "" : "hidden"}>${hasUnread ? (hasUnread > 99 ? "99+" : hasUnread) : ""}</span>`
           : (hasUnread ? `<span class="bnav-badge">${hasUnread > 99 ? "99+" : hasUnread}</span>` : "");
         return `<button class="bnav-item" data-col="${i}" type="button" aria-label="${esc(cfg.label)}" title="${esc(cfg.label)}">
           <span class="bnav-pip" aria-hidden="true"></span>
           ${icon(cfg.ic, 22)}
           ${badge}
           <span>${esc(cfg.label)}</span>
         </button>`;
       };
       const seen = new Set();
       return NAV
         .map((lbl) => { const i = allCols.findIndex((c) => c.label === lbl); return i >= 0 ? { i, label: lbl } : null; })
         .filter((x) => x && !seen.has(x.label) && seen.add(x.label))
         .map(navBtn)
         .join("");
     })()}
   </nav>`;
  wireEditor(data);
  wireHeaderSearch();
  wireProfileMenuBtn();
  applyTheme(document.documentElement.getAttribute("data-theme") || "dark"); // pose l'icône sur le bouton fraîchement rendu
  setupTabs();
  // Câblage des colonnes contribuées par les plugins (ex. boutons « Ouvrir » du chat).
  allCols.forEach((c, i) => c.wire && c.wire(app.querySelector(`[data-col="${i}"]`), data));
  // Abonnement : retours de paiement Stripe + reprise d'intention post-inscription.
  handleBilling(data);
}

export function setupTabs() {
  const deck = document.getElementById("deck");
  const nav = document.getElementById("bottom-nav");
  if (!deck || !nav) return;

  const cols = [...deck.querySelectorAll(".col")];
  const navItems = [...nav.querySelectorAll(".bnav-item")];
  deckState.cols = cols;
  const footer = document.getElementById("footer");

  const clamp = (i) => Math.max(0, Math.min(cols.length - 1, i));

  // Mise à jour des états actifs. La barre ne liste plus toutes les colonnes :
  // on apparie par data-col (une colonne non présente dans la barre, ex. Mon ID,
  // n'allume simplement aucune entrée).
  function applyActive(idx) {
    cols.forEach((c, ci) => c.classList.toggle("active", ci === idx));
    navItems.forEach((n) => {
      const on = n.dataset.col != null && n.dataset.col !== "" && Number(n.dataset.col) === idx;
      n.classList.toggle("active", on);
    });
  }

  function go(i) {
    const idx = clamp(i);
    deckState.index = idx;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // Transition de panneau façon 2026 (View Transitions API) : crossfade +
    // montée de la page active, header/rail figés. Repli direct si non supporté
    // ou si l'utilisateur a demandé moins de mouvement.
    if (!reduce && !document.hidden && typeof document.startViewTransition === "function") {
      const vt = document.startViewTransition(() => applyActive(idx));
      // Une transition interrompue (changements d'onglet rapprochés, init) rejette
      // .ready/.finished avec « Transition was skipped » → on absorbe ces rejets
      // pour ne pas polluer la console (la bascule a tout de même eu lieu).
      vt?.ready?.catch(() => {});
      vt?.finished?.catch(() => {});
      vt?.updateCallbackDone?.catch(() => {});
    } else {
      applyActive(idx);
    }
    // Masquer le footer quand le tab Chat est actif (comm-layout plein écran)
    const activeLabel = cols[idx]?.dataset.deckLabel;
    if (footer) footer.style.display = activeLabel === "Chat" ? "none" : "";
    // Scroll en haut de page sauf premier rendu
    if (document.readyState === "complete") window.scrollTo({ top: 0, behavior: "instant" });
  }

  deckState.go = go;
  // Navigation par label sur le closure cols/go courant de l'éditeur (jamais
  // périmé) : hook e2e + pratique au débogage. Inoffensif en prod.
  deckState.goLabel = (label) => {
    const i = cols.findIndex((c) => c.dataset.deckLabel === label);
    if (i >= 0) go(i);
    return i >= 0;
  };
  if (typeof window !== "undefined") window.__deckGoLabel = deckState.goLabel;

  navItems.forEach((btn) => {
    btn.addEventListener("click", () => go(Number(btn.dataset.col)));
  });

  // Navigation clavier (accessibilité)
  nav.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") go(deckState.index + 1);
    if (e.key === "ArrowLeft") go(deckState.index - 1);
  });

  // Indice de navigation (ex. retour depuis la page Premium → onglet Galerie).
  let hintTab = null;
  try { hintTab = sessionStorage.getItem("mindlog.openTab"); sessionStorage.removeItem("mindlog.openTab"); } catch {}
  const hintIdx = hintTab ? cols.findIndex(c => c.dataset.deckLabel === hintTab) : -1;
  if (hintIdx >= 0) {
    deckState.index = hintIdx;
  } else if (deckState.index === 0) {
    // Premier chargement → atterrir sur Chat par défaut.
    const chatIdx = cols.findIndex(c => c.dataset.deckLabel === "Chat");
    if (chatIdx >= 0) deckState.index = chatIdx;
  }
  go(clamp(deckState.index)); // restaure l'onglet actif
}

export async function openContactColumn(handle) {
  const h = String(handle).replace(/^@/, "");
  const closeBtn = `<button type="button" class="close" data-contact-close aria-label="Fermer">✕</button>`;
  const section = addDeckColumn(
    {
      key: `contact:${h}`,
      label: `@${h}`,
      html: `<div class="card profile-card" style="position:relative">${closeBtn}<p class="loading" style="padding:2.5rem 0;text-align:center">Chargement de @${esc(h)}…</p></div>`,
      wire: (overlay) =>
        overlay.querySelector("[data-contact-close]")?.addEventListener("click", () => removeDeckColumn(overlay)),
    }
    // pas d'afterLabel → s'insère juste à droite de la colonne active
  );
  if (!section || section.dataset.contactLoaded) return;

  let data;
  try {
    data = await api(`/api/identities/${encodeURIComponent(h)}`, { headers: viewerHeaders() });
  } catch {
    section.innerHTML = `<div class="card profile-card" style="position:relative">${closeBtn}<p class="empty" style="padding:2rem 0;text-align:center">Profil @${esc(h)} introuvable.</p></div>`;
    section.querySelector("[data-contact-close]")?.addEventListener("click", () => removeDeckColumn(section));
    return;
  }
  section.dataset.contactLoaded = "1";

  const canChat = !!data.viewer?.isContact && data.options?.allowChat !== false;
  const canCall = !!data.viewer?.isContact && data.options?.allowCall !== false;
  // Rendu STRICTEMENT IDENTIQUE à la page individuelle (même composant), avec :
  // bouton Fermer (coin haut-droit) + actions de contact (Voir page / Discuter / Appel).
  const actions = {
    right: closeBtn,
    contact: `<div class="profile-contact-actions">
      <a class="btn sm" href="/@${encodeURIComponent(data.handle)}" target="_blank" rel="noopener noreferrer">Voir la page ↗</a>
      ${canChat ? `<button type="button" class="btn sm primary" data-contact-chat>${icon("chat", 15)} Discuter</button>` : ""}
      ${canCall ? `<button type="button" class="btn sm" data-contact-call${data.pubkey ? "" : " disabled"}>${icon("camera", 15)} Appel</button>` : ""}
    </div>`,
  };
  section.innerHTML = profileCardHtml(data, actions);
  section.querySelector("[data-contact-close]")?.addEventListener("click", () => removeDeckColumn(section));
  section.querySelector("[data-contact-chat]")?.addEventListener("click", () => host.chat.open(data.handle, myKey(), myHandle()));
  section.querySelector("[data-contact-call]")?.addEventListener("click", () => {
    if (data.pubkey && host.call) host.call.start(data.handle, data.pubkey, { video: data.options?.allowVideo !== false });
  });
}

// Page « Espace Premium » : vue plein écran servie à l'URL /me/premium (vraie
// page, ni colonne du deck ni modale). Regroupe abonnement/facturation,
// couverture, boutons personnalisés, pages payantes, liens galerie. Atteinte via
// le bouton « Gérer » du bandeau (location.assign("/me/premium")) ; retour via le
// bouton « ← Retour » ou le bouton retour du navigateur.
export async function renderPremiumFull() {
  app.innerHTML = `<p class="loading">Chargement…</p>`;
  let data;
  try {
    data = await api("/api/me", { headers: authHeaders() });
  } catch {
    location.replace("/me"); // non authentifié → l'éditeur gère la connexion
    return;
  }
  appState.key = data.accessKey || appState.key || null;
  setAccessKey(appState.key);
  appState.auth = { handle: data.handle, key: appState.key };
  app.setAttribute("data-view", "premium");
  app.innerHTML = renderPremiumPage(data);
  wirePremiumPage(app, data);
}

// Câblage de la page Premium (scopé à `root` = #app). Les ids premium
// (#cover-file, #pb-*, #pp-*) ne vivent que sur cette page → pas de collision.
function wirePremiumPage(root, data) {
  if (!root) return;
  const reloadEditor = async () => renderPremiumFull(); // re-render la page Premium
  const premErr = (e) => toast(e?.message === "premium required" ? "Réservé aux comptes Premium." : (e?.message || "Échec."));

  root.querySelector("#prem-back")?.addEventListener("click", () => {
    // history.back si on a un historique même origine, sinon /me (cohérent
    // avec backBtnHtml du SPA).
    const sameOrigin = document.referrer && new URL(document.referrer, location.href).origin === location.origin;
    if (window.history.length > 1 && sameOrigin) window.history.back();
    else location.assign("/me");
  });
  root.querySelector("#prem-portal")?.addEventListener("click", openBillingPortal);

  // Toggle « Profil hors annuaire » : inversé (case cochée = listed_in_directory false).
  const hiddenCb = root.querySelector("#prem-perk-hidden");
  const hiddenStatus = root.querySelector("#prem-perks-status");
  hiddenCb?.addEventListener("change", async () => {
    if (hiddenStatus) hiddenStatus.textContent = "Enregistrement…";
    try {
      await api("/api/me/settings", {
        method: "PATCH",
        headers: jsonAuth(),
        body: JSON.stringify({ listed_in_directory: !hiddenCb.checked }),
      });
      if (hiddenStatus) hiddenStatus.textContent = hiddenCb.checked ? "✓ profil retiré de l'annuaire" : "✓ profil visible dans l'annuaire";
    } catch (e) {
      if (hiddenStatus) hiddenStatus.textContent = "";
      hiddenCb.checked = !hiddenCb.checked; // revert UI
      toast(e?.message || "Échec.");
    }
  });
  root.querySelector("#prem-go-gallery")?.addEventListener("click", () => {
    // Retour à l'éditeur en demandant l'ouverture de l'onglet Galerie (indice lu
    // par setupTabs au prochain rendu).
    try { sessionStorage.setItem("mindlog.openTab", "Galerie"); } catch {}
    location.assign("/me");
  });

  // Couverture (photo / vidéo) : cadrage + recompression côté navigateur
  // (1080×1920 WebP image, WebM VP9 10 s sans audio vidéo) avant upload,
  // pour rester sous COVER_MAX et garantir une lecture <video> fluide.
  const coverInput = root.querySelector("#cover-file");
  coverInput?.addEventListener("change", async () => {
    const file = coverInput.files?.[0];
    coverInput.value = ""; // permet de re-sélectionner le même fichier après annulation
    if (!file) return;
    let out;
    try { out = await openCoverEditor(file); }
    catch (e) { premErr(e); return; }
    if (!out) return; // annulé
    const fd = new FormData();
    fd.append("cover", new File([out.blob], `cover.${out.ext}`, { type: out.type }));
    try { await api("/api/cover", { method: "POST", headers: authHeaders(), body: fd }); toast("Couverture mise à jour ✓"); await reloadEditor(); }
    catch (e) { premErr(e); }
  });
  root.querySelector("#cover-remove")?.addEventListener("click", async () => {
    try { await api("/api/cover", { method: "DELETE", headers: authHeaders() }); toast("Couverture retirée"); await reloadEditor(); }
    catch (e) { premErr(e); }
  });

  // Boutons personnalisés : édition complète (icône, libellé, URL, forme,
  // affichage du libellé). La position (pos_x/pos_y) est portée en data-attr et
  // préservée — la modification de position se fait sur la page publique (drag).
  // Save automatique (debounce 280ms) sur toute mutation.
  const pbList = root.querySelector("#pb-list");
  const pbCount = root.querySelector("#pb-count");
  const pbStatus = root.querySelector("#pb-status");
  const pbAdd = root.querySelector("#pb-add");
  if (pbList) {
    const refreshCount = () => {
      const n = pbList.querySelectorAll(".pb-row").length;
      if (pbCount) pbCount.textContent = `${n}/5`;
      if (pbAdd) pbAdd.disabled = n >= 5;
    };
    // Si l'utilisateur saisit "google.com" (sans https://), on auto-préfixe
     // pour éviter que sanitizeButtonUrl côté serveur rejette silencieusement
    // l'URL (laissant le toast "Enregistré ✓" mensonger).
    const normalizeUrl = (raw) => {
      const s = String(raw || "").trim();
      if (!s) return "";
      if (/^(https?:\/\/|mailto:|tel:)/i.test(s)) return s;
      // Heuristique : ressemble à un domaine ? Sinon, on laisse tel quel.
      if (/^[^\s/]+\.[^\s/]/.test(s)) return "https://" + s;
      return s;
    };
    const collect = () => [...pbList.querySelectorAll(".pb-row")].map((r) => {
      const urlEl = r.querySelector(".pb-url");
      const url = normalizeUrl(urlEl?.value);
      // Met à jour l'input pour montrer la normalisation à l'utilisateur.
      if (urlEl && url && urlEl.value.trim() !== url) urlEl.value = url;
      return {
        label: r.querySelector(".pb-label")?.value.trim() || "",
        url,
        icon: r.querySelector(".pb-icon")?.value.trim() || "",
        pos_x: Number(r.dataset.x ?? 0.5),
        pos_y: Number(r.dataset.y ?? 0.9),
        shape: r.querySelector(".pb-shape")?.dataset.shape === "square" ? "square" : "circle",
        show_label: r.querySelector(".pb-showlbl")?.dataset.on === "1",
      };
    });
    let saveTimer = null;
    let saveDirty = false; // y a-t-il une modif non envoyée ?
    // Envoi synchrone fire-and-forget — utilisé pour ne pas perdre une modif
    // quand l'utilisateur navigue avant la fin du debounce.
    const flushSync = () => {
      if (!saveDirty) return;
      clearTimeout(saveTimer);
      saveDirty = false;
      try {
        const buttons = collect().filter((b) => b.label && b.url);
        // keepalive : le navigateur autorise la requête à se poursuivre même
        // après que la page soit en train de se décharger.
        void fetch("/api/page/buttons", { method: "PUT", headers: jsonAuth(), body: JSON.stringify({ buttons }), keepalive: true });
      } catch {}
    };
    const save = () => {
      saveDirty = true;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        if (pbStatus) pbStatus.textContent = "Enregistrement…";
        try {
          const buttons = collect().filter((b) => b.label && b.url);
          const sent = buttons.length;
          const resp = await api("/api/page/buttons", { method: "PUT", headers: jsonAuth(), body: JSON.stringify({ buttons }) });
          saveDirty = false;
          const got = Array.isArray(resp?.buttons) ? resp.buttons.length : 0;
          if (sent !== got) {
            // Le serveur a rejeté silencieusement des entrées (URL invalide…).
            const msg = `${got}/${sent} enregistré${got > 1 ? "s" : ""} (vérifie les URLs)`;
            console.warn("[buttons.save] rejet silencieux", { sent, got, buttons });
            if (pbStatus) pbStatus.textContent = msg;
          } else if (pbStatus) {
            pbStatus.textContent = "Enregistré ✓";
            setTimeout(() => { if (pbStatus.textContent === "Enregistré ✓") pbStatus.textContent = ""; }, 1500); }
        } catch (e) {
          console.error("[buttons.save] erreur", e);
          if (pbStatus) pbStatus.textContent = e?.message === "premium required" ? "Réservé aux Premium" : (e?.message || "Échec d'enregistrement");
          else toast(e?.message || "Échec d'enregistrement");
        }
      }, 280);
    };
    // Flush au déchargement ou à la navigation (clic sur « Voir ma page »).
    window.addEventListener("beforeunload", flushSync);
    window.addEventListener("pagehide", flushSync);
    root.querySelector('a[href^="/@"]')?.addEventListener("click", flushSync);
    const wireRow = (row) => {
      row.querySelectorAll("input").forEach((inp) => {
        // « input » couvre frappe/coller/effacer → debounce 280ms agrège tout.
        // « blur » garde un filet de sécurité en cas de navigation rapide.
        inp.addEventListener("input", save);
        inp.addEventListener("blur", save);
        inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } });
      });
      row.querySelector(".pb-icon")?.addEventListener("input", (e) => {
        const prev = row.querySelector(".pb-prev-ic");
        if (prev) prev.innerHTML = icon(e.target.value.trim() || "link", 16);
      });
      row.querySelector(".pb-shape")?.addEventListener("click", (e) => {
        const btn = e.currentTarget;
        const next = btn.dataset.shape === "square" ? "circle" : "square";
        btn.dataset.shape = next;
        btn.textContent = next === "square" ? "▢" : "◯";
        save();
      });
      row.querySelector(".pb-showlbl")?.addEventListener("click", (e) => {
        const btn = e.currentTarget;
        const next = btn.dataset.on === "1" ? "0" : "1";
        btn.dataset.on = next;
        btn.classList.toggle("on", next === "1");
        save();
      });
      row.querySelector(".pb-del")?.addEventListener("click", () => {
        row.remove(); refreshCount(); save();
      });
    };
    pbList.querySelectorAll(".pb-row").forEach(wireRow);
    pbAdd?.addEventListener("click", () => {
      const n = pbList.querySelectorAll(".pb-row").length;
      if (n >= 5) return;
      // Position aléatoire dans la zone « visible » du hero — on évite les
      // bords (10 %) et la bande basse occupée par l'identity (avatar/nom/handle).
      const randPx = +(0.10 + Math.random() * 0.80).toFixed(3);
      const randPy = +(0.15 + Math.random() * 0.55).toFixed(3);
      // Pré-remplissage de label + URL pour que le bouton soit immédiatement
      // valide côté serveur (sanitizeButtonUrl exige http(s)://). L'utilisateur
      // les édite ensuite ; au moindre changement, save() repart.
      const tmp = document.createElement("div");
      tmp.innerHTML = pbRowHtml({
        icon: "link", shape: "circle", show_label: false,
        pos_x: randPx, pos_y: randPy,
        label: `Bouton ${n + 1}`,
        url: "https://example.com",
      });
      const row = tmp.firstElementChild;
      pbList.appendChild(row);
      wireRow(row);
      refreshCount();
      // Save immédiat (pas de debounce) pour persister le bouton tout neuf,
      // même si l'utilisateur quitte la page sans le compléter.
      save();
      const lblInp = row.querySelector(".pb-label");
      lblInp?.focus(); lblInp?.select();
    });
    refreshCount();
  }

  // Pages payantes (statut Connect + liste + création).
  void loadPaidPages(root, data);
}

export function notifListHtml(list) {
  if (!list || !list.length) return '<li class="empty">Aucune notification.</li>';
  return list.map(notifItemHtml).join("");
}

export function incomingListHtml(list) {
  if (!list || !list.length) return '<li class="empty">Aucune demande reçue.</li>';
  return list.map((r) => relItemHtml(r, { incoming: true })).join("");
}

export function reqFilterChips(requests) {
  const n = { all: requests.length, pending: 0, accepted: 0, declined: 0 };
  requests.forEach((r) => { n[r.status] = (n[r.status] || 0) + 1; });
  const chip = (val, label) =>
    `<button class="req-chip${val === "pending" ? " active" : ""}" data-req-filter="${val}">${label} <span class="chip-n">${n[val]}</span></button>`;
  return (
    chip("pending", "En attente") +
    chip("all", "Toutes") +
    chip("accepted", "Acceptées") +
    chip("declined", "Refusées")
  );
}

export function requestsHtml(requests) {
  if (!requests.length) return '<li class="empty">Aucune demande.</li>';
  return requests
    .map((r) => {
      const badge =
        r.status === "accepted" ? "ok" : r.status === "declined" ? "no" : "pending";
      const label =
        r.status === "accepted" ? "Acceptée" : r.status === "declined" ? "Refusée" : "En attente";
      return `
      <li class="request" data-status="${r.status}">
        <div class="req-head">
          <strong>${esc(r.name)}</strong>
          <span class="req-status ${badge}">${label}</span>
        </div>
        ${r.day ? `<div class="req-slot">Date souhaitée : ${esc(host.calendar.fmtDay(r.day))}${r.time ? ` à <strong>${esc(r.time)}</strong>` : ""}</div>` : ""}
        ${r.email ? `<div class="req-meta"><a href="mailto:${esc(r.email)}">${esc(r.email)}</a></div>` : ""}
        ${r.message ? `<div class="req-msg">${esc(r.message)}</div>` : ""}
        <div class="req-actions">
          <button class="btn sm" data-req-accept="${r.id}">Accepter</button>
          <button class="btn sm" data-req-decline="${r.id}">Refuser</button>
          <button class="icon" data-req-del="${r.id}" title="Supprimer">✕</button>
        </div>
      </li>`;
    })
    .join("");
}

export function socialEditHtml(fields) {
  const byKey = Object.fromEntries(fields.map((f) => [f.key, f.value]));
  return SOCIALS.map((net) => {
    const val = byKey[socialFieldKey(net.key)] || "";
    const url = socialUrl(net, val);
    return `<div class="social-edit" data-net="${net.key}">
      <span class="social-ic" style="color:${net.color}">${socialIcon(net, 18)}</span>
      <input class="social-input" value="${esc(val)}" placeholder="${esc(net.ph)}" inputmode="url" autocomplete="off" aria-label="${esc(net.label)}" />
      <a class="social-open btn-field-del" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="Ouvrir ${esc(net.label)}" aria-label="Ouvrir ${esc(net.label)}"${url ? "" : " hidden"}>${icon("link", 13)}</a>
    </div>`;
  }).join("");
}

export function fieldEditHtml(f) {
  const vis = f.visibility || (f.is_public ? "public" : "private");
  const opt = (v, label) => `<option value="${v}" ${vis === v ? "selected" : ""}>${label}</option>`;
  const isEnc = typeof f.value === "string" && f.value.startsWith("e2e:");
  const canDelete = f.is_custom;
  return `
    <div class="edit-field" data-key="${esc(f.key)}">
      <span class="lbl">${esc(f.label)}</span>
      <input class="fv" value="${isEnc ? "" : esc(f.value)}" placeholder="${isEnc ? "Chiffré…" : "—"}" data-enc="${isEnc ? esc(f.value) : ""}" />
      <select class="fvis vis-${vis}" title="Visibilité" aria-label="Visibilité de ${esc(f.label)}">
        ${opt("public", "Public")}${opt("contact", "Contact")}${opt("private", "Privé")}
      </select>
      ${canDelete ? `<button class="btn-field-del" title="Supprimer cet attribut" aria-label="Supprimer ${esc(f.label)}">✕</button>` : `<span></span>`}
    </div>`;
}

export function wireEditor(data) {
  // Retaille une image pour qu'elle tienne dans 320×320 (ratio préservé, sans
  // déformation) avant l'envoi. Best-effort : en cas d'échec on garde l'original.
  const resizePhoto = async (blob, max = 320) => {
    try {
      const bmp = await createImageBitmap(blob);
      const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
      return await new Promise((res) => canvas.toBlob((b) => res(b || blob), "image/jpeg", 0.9));
    } catch {
      return blob;
    }
  };

  const uploadPhotoBlob = async (blob) => {
    const resized = await resizePhoto(blob);
    const fd = new FormData();
    fd.append("photo", resized, "photo.jpg");
    await fetch("/api/photo", { method: "POST", headers: authHeaders(), body: fd });
    toast(t("msg_photo_updated"));
    renderPrivate(appState.key);
  };

  app.querySelector('#photo-form input[type=file]').addEventListener("change", async (ev) => {
    const file = ev.target.files[0];
    if (file) await uploadPhotoBlob(file);
  });

  app.querySelector("#take-photo-btn").addEventListener("click", async () => {
    if (!navigator.mediaDevices?.getUserMedia) return toast("Caméra non disponible sur cet appareil.");
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 1280 } } });
    } catch {
      return toast("Accès à la caméra refusé ou indisponible.");
    }

    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `
      <div class="panel" role="dialog" aria-modal="true" style="max-width:480px;padding:1rem">
        <button type="button" class="close" id="cam-close" aria-label="Fermer">✕</button>
        <h2 style="margin-bottom:.75rem">Prendre une photo</h2>
        <video id="cam-video" autoplay playsinline muted style="width:100%;border-radius:8px;background:#000;aspect-ratio:1;object-fit:cover"></video>
        <canvas id="cam-canvas" hidden></canvas>
        <div class="actions" style="margin-top:.75rem">
          <button type="button" class="btn" id="cam-cancel">Annuler</button>
          <button type="button" class="btn primary" id="cam-snap">${icon("camera", 15)} Capturer</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const video = overlay.querySelector("#cam-video");
    video.srcObject = stream;

    const stop = () => { stream.getTracks().forEach((t) => t.stop()); overlay.remove(); };
    overlay.querySelector("#cam-close").addEventListener("click", stop);
    overlay.querySelector("#cam-cancel").addEventListener("click", stop);
    overlay.addEventListener("click", (e) => e.target === overlay && stop());

    overlay.querySelector("#cam-snap").addEventListener("click", async () => {
      const canvas = overlay.querySelector("#cam-canvas");
      const size = Math.min(video.videoWidth, video.videoHeight);
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, (video.videoWidth - size) / 2, (video.videoHeight - size) / 2, size, size, 0, 0, size, size);
      stop();
      canvas.toBlob(async (blob) => { if (blob) await uploadPhotoBlob(blob); }, "image/jpeg", 0.9);
    });
  });

  app.querySelectorAll(".edit-field").forEach((row) => wireFieldRow(row));

  function wireFieldRow(row) {
    const key = row.dataset.key;
    const input = row.querySelector(".fv");
    const vis = row.querySelector(".fvis");
    let saved = input.value;

    // Déchiffrement à l'affichage si la valeur stockée est chiffrée E2E.
    const encRaw = input.dataset.enc;
    if (encRaw && encRaw.startsWith("e2e:") && E2E.priv && E2E.pubStr) {
      const parts = encRaw.split(":");
      e2eDecrypt(E2E.pubStr, parts[1], parts[2]).then((plain) => {
        if (plain != null) {
          input.value = plain;
          input.placeholder = "—";
          saved = plain;
        }
      });
    }

    const save = async () => {
      if (input.value === saved && !vis._dirty) return;
      let value = input.value;
      // Chiffrement pour les champs non publics (to-self : propre clé publique).
      if (vis.value !== "public" && E2E.priv && E2E.pubStr) {
        try {
          const { iv, ciphertext } = await e2eEncrypt(E2E.pubStr, value);
          value = `e2e:${iv}:${ciphertext}`;
        } catch (err) { toast(err.message); return; }
      }
      try {
        await api("/api/card/field", {
          method: "PUT",
          headers: jsonAuth(),
          body: JSON.stringify({ key, value, visibility: vis.value }),
        });
        saved = input.value; // on mémorise le texte en clair
        vis._dirty = false;
        toast(t("msg_saved"));
      } catch (e) { toast(e.message); }
    };
    input.addEventListener("blur", save);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } });
    vis.addEventListener("change", () => {
      vis.className = "fvis vis-" + vis.value;
      vis._dirty = true;
      save();
    });
    row.querySelector(".btn-field-del")?.addEventListener("click", async () => {
      try {
        await api(`/api/card/field/${encodeURIComponent(key)}`, { method: "DELETE", headers: jsonAuth() });
        row.remove();
      } catch (e) { toast(e.message); }
    });
  }

  app.querySelector("#add-field").addEventListener("click", async () => {
    const labelEl = app.querySelector("#nf-label");
    const valueEl = app.querySelector("#nf-value");
    const label = labelEl.value.trim();
    if (!label) return toast(t("msg_key_required"));
    const key = label.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "field";
    const value = valueEl.value.trim();
    try {
      await api("/api/card/field", {
        method: "PUT",
        headers: jsonAuth(),
        body: JSON.stringify({ key, label, value, is_custom: true }),
      });
    } catch (e) { return toast(e.message); }
    await renderPrivate(appState.key);
    app.querySelector(`.edit-field[data-key="${CSS.escape(key)}"] .fv`)?.focus();
  });

  // Tags : ajout + suppression (re-rendu de la colonne après chaque action).
  const addTagEl = app.querySelector("#nt-tag");
  const submitTag = async () => {
    const tag = addTagEl.value.trim();
    if (!tag) return;
    try {
      await api("/api/tags", { method: "POST", headers: jsonAuth(), body: JSON.stringify({ tag }) });
      await renderPrivate(appState.key);
    } catch (e) { toast(e.message); }
  };
  app.querySelector("#add-tag")?.addEventListener("click", submitTag);
  addTagEl?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); void submitTag(); } });
  app.querySelectorAll("[data-del-tag]").forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        await api(`/api/tags/${encodeURIComponent(b.dataset.delTag)}`, { method: "DELETE", headers: jsonAuth() });
        await renderPrivate(appState.key);
      } catch (e) { toast(e.message); }
    })
  );

  // Événements : suppression directe (corbeille sur la carte), création et
  // édition via la modale composer (façon Teams).
  app.querySelectorAll("[data-del-event]").forEach((b) =>
    b.addEventListener("click", async () => {
      const card = b.closest(".ev-card");
      const title = card?.querySelector(".ev-title")?.textContent?.trim() || "cet événement";
      if (!(await confirmDialog(`Supprimer « ${title} » ?`, { ok: "Supprimer", danger: true }))) return;
      await api(`/api/agenda/${b.dataset.delEvent}`, { method: "DELETE", headers: authHeaders() });
      renderPrivate(appState.key);
    })
  );
  // Si le créateur est Premium ET a coché le bénéfice « Lives », la modale
  // propose un type « Live » qui rend l'événement joignable par les abonnés.
  const _liveAvailable = !!data.space?.benefits?.lives;
  app.querySelectorAll("[data-event-new]").forEach((b) =>
    b.addEventListener("click", () => openEventModal(null, { liveAvailable: _liveAvailable }))
  );
  app.querySelectorAll("[data-event-edit]").forEach((b) =>
    b.addEventListener("click", () => {
      const ev = (data.events || []).find((e) => String(e.id) === b.dataset.eventEdit);
      if (ev) openEventModal(ev, { liveAvailable: _liveAvailable });
    })
  );

  // Disponibilités : navigation de mois + bascule des jours (plugin calendrier)
  host.calendar.wire(app.querySelector(".calendar"), data.overrides || {}, true, data.handle, dayLoadMap(data));

  // Aperçu façon téléphone (colonne Accueil) : swipe entre Accueil / Calendrier /
  // Galerie + pastilles de pagination, et montage de la vraie galerie (plugin).
  const ltScreens = app.querySelector("#lt-screens");
  if (ltScreens) {
    const dots = [...app.querySelectorAll("#lt-dots .lt-dot")];
    const goTo = (i) => ltScreens.scrollTo({ left: i * ltScreens.clientWidth, behavior: "smooth" });
    dots.forEach((d, i) => d.addEventListener("click", () => goTo(i)));
    ltScreens.addEventListener("scroll", () => {
      const i = Math.round(ltScreens.scrollLeft / Math.max(1, ltScreens.clientWidth));
      dots.forEach((d, k) => {
        d.classList.toggle("is-on", k === i);
        d.setAttribute("aria-selected", k === i ? "true" : "false");
      });
    }, { passive: true });
    // Galerie réelle (même source que la page publique) ; repli si vide ou erreur.
    const gslot = app.querySelector("#lt-gallery-slot");
    if (gslot) {
      Promise.resolve(host.gallery?.mountPublic?.(gslot, data.handle))
        .then((ok) => { if (!ok) gslot.innerHTML = `<p class="lt-empty">Aucune photo dans ta galerie.</p>`; })
        .catch(() => { gslot.innerHTML = `<p class="lt-empty">Galerie indisponible.</p>`; });
    }
  }

  // QR code de la page publique
  app.querySelector("#qr-btn")?.addEventListener("click", () =>
    openQR(`${location.origin}${data.publicUrl}`, `@${data.handle}`)
  );
  app.querySelector("#hm-qr-btn")?.addEventListener("click", () =>
    openQR(`${location.origin}${data.publicUrl}`, `@${data.handle}`)
  );
  // Tous les toggles data-setting (banner + onglet Options)
  app.querySelectorAll("[data-setting]").forEach((input) => {
    input.addEventListener("change", async () => {
      const key = input.dataset.setting;
      const val = input.checked;
      try {
        await api("/api/me/settings", { method: "PATCH", headers: jsonAuth(), body: JSON.stringify({ [key]: val }) });
      } catch {
        input.checked = !val;
      }
    });
  });
  // Boutons onglet Options
  app.querySelector("#opt-e2e-backup")?.addEventListener("click", () =>
    openE2eBackup(data.handle, appState.key, refreshVaultStatus)
  );
  app.querySelector("#opt-qr-link")?.addEventListener("click", () =>
    openQR(`${location.origin}${data.publicUrl}`, `@${data.handle}`)
  );
  // Communications column wiring
  const commContactList = app.querySelector("#comm-contacts");
  const commRight = app.querySelector("#comm-right");
  if (commContactList && commRight) {
    // Search
    app.querySelector("#comm-search")?.addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      commContactList.querySelectorAll(".comm-contact-item").forEach(el => {
        el.hidden = !!q && !(el.dataset.search || "").includes(q);
      });
    });

    // Contact click → ouvre le chat INLINE dans le panneau droit
    commContactList.addEventListener("click", async (e) => {
      const item = e.target.closest(".comm-contact-item");
      if (!item) return;
      const h = item.dataset.handle;
      commContactList.querySelectorAll(".comm-contact-item").forEach(el => el.classList.toggle("selected", el === item));

      // Intercepter openDeckColumn pour monter dans commRight au lieu d'un tab
      const origOpen = host.openDeckColumn;
      const origClose = host.closeDeckColumn;
      host.openDeckColumn = ({ html, wire }) => {
        commRight.innerHTML = html;
        wire?.(commRight); // wireChat a besoin que #ch-close existe dans le DOM
        // Ajouter le bouton Appel vidéo à droite du bouton Envoyer dans le formulaire
        const form = commRight.querySelector("#ch-form");
        if (form && !form.querySelector("#comm-call-btn")) {
          const placeCall = async () => {
            try {
              const p = await api(`/api/identities/${encodeURIComponent(h)}`, { headers: authHeaders() });
              if (!p.pubkey) return toast("Appels non disponibles pour ce contact.");
              if (host.call) host.call.start(h, p.pubkey, { video: true });
            } catch { toast("Impossible de joindre ce contact."); }
          };
          const b = document.createElement("button");
          b.type = "button";
          b.id = "comm-call-btn";
          b.className = "btn";
          b.title = "Appeler (vidéo activable pendant l'appel)";
          b.setAttribute("aria-label", "Appeler");
          b.innerHTML = icon("phone", 18);
          b.addEventListener("click", placeCall);
          form.appendChild(b);
        }
        return commRight;
      };
      host.closeDeckColumn = (col) => {
        if (col === commRight) {
          commRight.innerHTML = appState.commEmptyHtml;
          commContactList.querySelectorAll(".comm-contact-item").forEach(el => el.classList.remove("selected"));
          host.closeDeckColumn = origClose;
        } else {
          origClose?.(col);
        }
      };
      host.chat.open(h, appState.key, data.handle);
      host.openDeckColumn = origOpen; // restaurer immédiatement
    });
  }
  // Boutons dupliqués dans Options (Accès & Sessions + Appareils)
  const wireAlias = (id2, id1) => {
    const b = app.querySelector(id2);
    if (b) b.addEventListener("click", () => app.querySelector(id1)?.click());
  };
  wireAlias("#toggle-key2",       "#toggle-key");
  wireAlias("#rotate-key2",       "#rotate-key");
  wireAlias("#save-rec2",         "#save-rec");
  wireAlias("#logout-btn2",       "#logout-btn");
  wireAlias("#logout-all-btn2",   "#logout-all-btn");
  wireAlias("#gen-invite2",       "#gen-invite");
  wireAlias("#open-groups2",      "#open-groups");
  wireAlias("#e2e-passkey-save2", "#e2e-passkey-save");
  wireAlias("#e2e-pin-save2",     "#e2e-pin-save");
  wireAlias("#e2e-pass-save2",    "#e2e-pass-save");
  wireAlias("#e2e-restore2",      "#e2e-restore");
  wireAlias("#passkey-add2",      "#passkey-add");
  wireAlias("#export-data2",      "#export-data");
  wireAlias("#delete-account2",   "#delete-account");
  // copy-key2 : même clé que copy-key
  app.querySelector("#toggle-key2")?.addEventListener("click", () => {
    const d = app.querySelector("#key-display2");
    const d1 = app.querySelector("#key-display");
    if (d && d1) d.textContent = d1.textContent;
  });
  // email de récupération (champ dupliqué)
  const rec2 = app.querySelector("#rec-email2");
  const rec1 = app.querySelector("#rec-email");
  if (rec2 && rec1) {
    rec2.addEventListener("change", () => { rec1.value = rec2.value; });
  }
  // Visite guidée « Milo » : lanceur manuel + ouverture auto à la 1re connexion.
  app.querySelector("#hm-tour-btn")?.addEventListener("click", () => openMiloTourPicker());
  // Toggle dev : premium PAR UTILISATEUR. Pose/retire une ligne d'abonnement
  // "dev" pour le compte courant côté serveur, puis recharge. Échoue proprement
  // si l'endpoint est désactivé (prod, ou MINDLOG_DEV_PREMIUM absent).
  app.querySelector("#dev-toggle-premium")?.addEventListener("change", async (e) => {
    const on = e.target.checked;
    try {
      await api("/api/dev/premium", { method: on ? "POST" : "DELETE", headers: jsonAuth() });
    } catch (err) {
      e.target.checked = !on;
      toast(err?.message || "Premium dev indisponible (NODE_ENV=production ou MINDLOG_DEV_PREMIUM absent).");
      return;
    }
    location.reload();
  });

  // Dev : abonnements simulés à des espaces premium d'autres créateurs.
  // Liste, ajout, annulation. Endpoint gardé par DEV_PREMIUM_ENABLED côté serveur.
  const subsList = app.querySelector("#dev-space-subs");
  if (subsList) {
    const refreshSubs = async () => {
      try {
        const r = await api("/api/dev/space-subscriptions", { headers: authHeaders() });
        const active = (r.subscriptions || []).filter((s) => s.status === "active");
        subsList.innerHTML = active.length
          ? active.map((s) =>
              `<li class="opt-dev-sub-row" data-handle="${esc(s.handle)}">
                 <a href="/@${esc(s.handle)}" target="_blank" rel="noopener">@${esc(s.handle)}</a>
                 <span class="lbl-sm">${esc(s.provider || "stripe")}</span>
                 <button type="button" class="btn sm danger" data-dev-sub-cancel>Annuler</button>
               </li>`
            ).join("")
          : `<li class="lbl-sm">Aucun abonnement simulé.</li>`;
        subsList.querySelectorAll("[data-dev-sub-cancel]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const handle = btn.closest("[data-handle]")?.dataset.handle;
            if (!handle) return;
            try {
              await api(`/api/dev/space-subscription/${encodeURIComponent(handle)}`, {
                method: "DELETE",
                headers: jsonAuth(),
              });
              toast("Abonnement simulé retiré");
              await refreshSubs();
            } catch (err) { toast(err?.message || "Échec."); }
          });
        });
      } catch {
        subsList.innerHTML = `<li class="lbl-sm">Dev premium indisponible.</li>`;
      }
    };
    void refreshSubs();
    app.querySelector("#dev-space-add-btn")?.addEventListener("click", async () => {
      const inp = app.querySelector("#dev-space-add-handle");
      const handle = (inp?.value || "").trim().replace(/^@/, "");
      if (!handle) { toast("Saisis un @handle"); return; }
      try {
        await api("/api/dev/space-subscription", {
          method: "POST",
          headers: jsonAuth(),
          body: JSON.stringify({ handle }),
        });
        if (inp) inp.value = "";
        toast(`Abonné(e) simulé(e) à @${handle}`);
        await refreshSubs();
      } catch (err) { toast(err?.message || "Échec."); }
    });
  }

  // Swatches couleur Milo dans l'onglet Options
  app.querySelector("#opt-swatches")?.querySelectorAll(".swatch").forEach((s) =>
    s.addEventListener("click", () => {
      applyAccent(s.dataset.accent);
      try { localStorage.setItem(ACCENT_STORE, s.dataset.accent); } catch {}
    })
  );
  applyAccent(storedAccent() || "#8b8ff5"); // marque le swatch actif

  // Filtre des blocs Options
  app.querySelector("#opt-search")?.addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    app.querySelectorAll("#opt-v2-grid .opt-v2-block").forEach((block) => {
      block.hidden = !!q && !block.textContent.toLowerCase().includes(q);
    });
  });
  if (!localStorage.getItem(TOUR_SEEN_KEY)) {
    // On attend qu'aucun autre overlay (ex. sauvegarde E2E obligatoire à la 1re
    // connexion) ne soit ouvert, pour ne pas empiler les fenêtres modales.
    let tries = 0;
    const tryOpen = () => {
      if (localStorage.getItem(TOUR_SEEN_KEY)) return;
      if (document.querySelector(".overlay") && tries++ < 12) { setTimeout(tryOpen, 1200); return; }
      openMiloTourPicker();
    };
    setTimeout(tryOpen, 1300);
  }

  // Stats + liens "Voir tout" de la home → navigation par data-goto
  app.querySelectorAll(".hm-stat[data-goto], .hm-section-title a[data-goto], .hm-requests-banner[data-goto]").forEach(el => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const label = el.dataset.goto;
      const ci = deckState.cols.findIndex(c => c.dataset.deckLabel === label);
      if (ci >= 0 && deckState.go) deckState.go(ci);
    });
  });

  // Notifications : la cloche mène à la colonne Notifications + marque lues
  const markRead = () => {
    ["#notif-badge", "#chip-notif-dot"].forEach((sel) => {
      const badge = app.querySelector(sel);
      if (badge) { badge.hidden = true; badge.textContent = ""; }
    });
    const count = app.querySelector("#notif-count");
    if (count) count.textContent = "0 non lue(s)";
    app.querySelectorAll("#notif-list .notif.unread").forEach((n) => n.classList.remove("unread"));
    api("/api/notifications/read", { method: "POST", headers: authHeaders() }).catch(() => {});
  };
  app.querySelector("#notif-bell")?.addEventListener("click", () => {
    // Refonte 2026 : les Notifications ne sont plus dans la barre du bas (5
    // entrées max) — la cloche du header est leur point d'accès. On ouvre la
    // colonne « Notifications » par son label (robuste aux index dynamiques).
    deckGoLabel("Notifications");
    markRead();
  });
  app.querySelector("#notif-readall")?.addEventListener("click", markRead);

  // Colonne « Menu » : un clic mène à la colonne ciblée (nav par label, robuste
  // aux index dynamiques). Le bouton « ← Menu » ramène à la colonne Menu.
  const deckGoLabel = (label) => {
    const cols = [...document.querySelectorAll("#deck .col")];
    const i = cols.findIndex((c) => c.dataset.deckLabel === label);
    if (i >= 0 && deckState.go) deckState.go(i);
  };
  app.querySelector("#menu-nav")?.addEventListener("click", (e) => {
    // Stoppe la propagation : sinon le handler de clic au niveau colonne (qui
    // « sélectionne une colonne inactive ») se déclenche ensuite, voit l'index
    // du Menu ≠ nouvelle colonne active et nous ramène aussitôt au Menu.
    const goto = e.target.closest("[data-goto]");
    if (goto) { e.stopPropagation(); deckGoLabel(goto.dataset.goto); return; }
    const act = e.target.closest("[data-action]");
    if (act) { e.stopPropagation(); openContactPicker(act.dataset.action); }
  });
  // Aperçu téléphone : « Prendre rendez-vous » (écran Calendrier) → onglet Agenda.
  app.querySelector("#lt-book")?.addEventListener("click", () => deckGoLabel("Agenda"));

  // Sélecteur de contact : tuiles « Discuter » / « Passer un appel » du Menu.
  async function openContactPicker(mode) {
    let relations = data.relations;
    try {
      const fresh = await api("/api/me", { headers: authHeaders() });
      relations = fresh.relations;
      data.relations = relations;
    } catch {}
    const contacts = (relations?.[1] || []).filter((r) => r.mutual);
    const titleTxt = mode === "call" ? "Passer un appel" : "Discuter";
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `
      <div class="panel picker-panel" role="dialog" aria-modal="true" aria-label="${esc(titleTxt)}">
        <button type="button" class="close" id="pick-x" aria-label="Fermer">✕</button>
        <h2 class="picker-title">${mode === "call" ? icon("camera", 18) : icon("chat", 18)} ${esc(titleTxt)}</h2>
        <p class="sub" style="margin:.1rem 0 .7rem">Choisissez un contact.</p>
        ${contacts.length > 4 ? `<input type="search" id="pick-search" class="pick-search" placeholder="Rechercher un contact…" autocomplete="off" />` : ""}
        <ul class="picker-list">${
          contacts.length
            ? contacts
                .map(
                  (r) => `<li class="picker-li" data-search="${esc(`${r.display_name || ""} ${r.handle}`.toLowerCase())}"><button type="button" class="picker-item" data-h="${esc(r.handle)}">
                    ${avatarHtml(r.handle, r.has_photo, "av")}
                    <span class="meta"><span class="nm">${esc(r.display_name || r.handle)}</span><span class="hd">@${esc(r.handle)}</span></span>
                    <span class="e2e-dot" title="${r.has_pubkey ? "Messagerie chiffrée disponible" : "Clé E2E absente"}">${r.has_pubkey ? "🔒" : "🔓"}</span>
                  </button></li>`
                )
                .join("")
            : '<li class="empty">Aucun contact réciproque. Reliez-vous à quelqu’un dans « Relations » d’abord.</li>'
        }<li class="empty pick-none" hidden>Aucun contact ne correspond.</li></ul>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => { overlay.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (ev) => ev.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("click", (ev) => ev.target === overlay && close());
    overlay.querySelector("#pick-x").onclick = close;
    // Filtre live de la liste (affiché dès > 4 contacts).
    const search = overlay.querySelector("#pick-search");
    if (search) {
      const lis = [...overlay.querySelectorAll(".picker-li")];
      const none = overlay.querySelector(".pick-none");
      search.addEventListener("input", () => {
        const q = search.value.trim().toLowerCase();
        let shown = 0;
        lis.forEach((li) => {
          const ok = !q || (li.dataset.search || "").includes(q);
          li.hidden = !ok;
          if (ok) shown++;
        });
        if (none) none.hidden = shown > 0;
      });
      setTimeout(() => search.focus(), 0);
    }
    overlay.querySelectorAll(".picker-item").forEach((b) =>
      b.addEventListener("click", async () => {
        const h = b.dataset.h;
        close();
        if (mode === "chat") return host.chat.open(h, appState.key, data.handle);
        // Appel : récupérer la clé publique du pair avant de lancer la connexion.
        try {
          const d = await api(`/api/identities/${encodeURIComponent(h)}`, { headers: viewerHeaders() });
          if (!d.pubkey) return toast("Ce contact n'a pas encore activé les appels chiffrés.");
          if (host.call) host.call.start(h, d.pubkey, { video: d.options?.allowVideo !== false });
        } catch {
          toast("Impossible de joindre ce contact.");
        }
      })
    );
  }
  // Clic sur une notif → colonne fermable (jamais de changement d'URL) :
  // message → chat, profil (ex. ajout en relation) → fiche contact.
  // stopPropagation : évite le handler « sélectionner une colonne inactive ».
  app.querySelector("#notif-list")?.addEventListener("click", (e) => {
    const chatB = e.target.closest("[data-chat-notif]");
    if (chatB) { e.stopPropagation(); host.chat.open(chatB.dataset.chatNotif, appState.key, data.handle); return; }
    const relNotifB = e.target.closest("[data-relation-notif]");
    if (relNotifB) {
      e.stopPropagation();
      const h = relNotifB.dataset.relationNotif;
      confirmDialog(`Ajouter @${h} à vos relations ?`, { ok: "Ajouter", cancel: "Ignorer" }).then(async (ok) => {
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
      return;
    }
    const contactB = e.target.closest("[data-contact-notif]");
    if (contactB) { e.stopPropagation(); openContactColumn(contactB.dataset.contactNotif); }
  });

  // Onglets de la colonne Agenda/RDV
  app.querySelectorAll(".agenda-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      app.querySelectorAll(".agenda-tab").forEach((t) => {
        t.classList.toggle("active", t === tab);
        t.setAttribute("aria-selected", String(t === tab));
      });
      const id = tab.dataset.tab;
      app.querySelectorAll(".agenda-panel").forEach((p) => {
        p.hidden = p.id !== `agenda-${id}`;
      });
    });
  });

  // Cliquer une relation ouvre sa page identité publique (/@handle) dans un
  // NOUVEL onglet (target="_blank" sur l'ancre) — on laisse l'ancre agir.
  // Listener posé sur la colonne Relations (recréée à chaque rendu → pas de doublon),
  // stopPropagation pour éviter le handler « sélectionner une colonne inactive ».
  app.querySelector("#rel-tabs")?.closest(".col")?.addEventListener("click", (e) => {
    const link = e.target.closest("a.rel-link");
    if (!link || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.stopPropagation();
  });

  // Chips degré + type de la colonne Relations
  app.querySelectorAll("#rel-degree-chips .rel-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      app.querySelectorAll("#rel-degree-chips .rel-chip").forEach((c) => c.classList.toggle("active", c === chip));
      filterRels();
    });
  });
  app.querySelectorAll("#rel-type-chips .rel-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      app.querySelectorAll("#rel-type-chips .rel-chip").forEach((c) => c.classList.toggle("active", c === chip));
      filterRels();
    });
  });
  // Bannière demandes en attente
  app.querySelector("#rel-pending-toggle")?.addEventListener("click", () => {
    const panel = app.querySelector("#rel-pending-panel");
    const btn = app.querySelector("#rel-pending-toggle");
    if (!panel || !btn) return;
    const expanded = panel.hidden;
    panel.hidden = !expanded;
    btn.setAttribute("aria-expanded", String(expanded));
  });

  // Onglets de la carte Identité (Profil / Réseaux)
  app.querySelectorAll(".id-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      app.querySelectorAll(".id-tab").forEach((t) => {
        t.classList.toggle("active", t === tab);
        t.setAttribute("aria-selected", String(t === tab));
      });
      const id = tab.dataset.tab;
      app.querySelectorAll(".id-panel").forEach((p) => {
        p.hidden = p.id !== `id-${id}`;
      });
    });
  });

  // Onglets de la colonne « Mon compte » (Abonnement / Sécurité / Accès / Données)
  app.querySelectorAll(".opt-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      app.querySelectorAll(".opt-tab").forEach((t) => {
        t.classList.toggle("active", t === tab);
        t.setAttribute("aria-selected", String(t === tab));
      });
      const id = tab.dataset.tab;
      app.querySelectorAll(".opt-panel").forEach((p) => {
        p.hidden = p.id !== `opt-${id}`;
      });
    });
  });

  // Abonnement (Mon compte) : « 1 €/mois » démarre l'abonnement ; « Gérer » ouvre
  // la page dédiée « Espace Premium » (facturation + toutes les fonctions premium).
  app.querySelector("#opt-upgrade-btn")?.addEventListener("click", startCheckout);
  app.querySelector("#opt-portal-btn")?.addEventListener("click", () => location.assign("/me/premium"));

  // Avatar upload depuis l'onglet Compte.
  app.querySelector("#acc-av-upload")?.addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    if (file) await uploadPhotoBlob(file);
  });

  // Personnalisation Premium : couverture, boutons, pages payantes et facturation
  // vivent désormais sur la page dédiée « Espace Premium » (route /me/premium →
  // renderPremiumFull), câblée par wirePremiumPage. Ici on ne garde que le CTA
  // d'upgrade de l'aperçu téléphone (colonne Identité).
  app.querySelector("#lt-go-premium")?.addEventListener("click", startCheckout);

  // Onglet « Options » : chaque bascule enregistre la préférence immédiatement.
  // « Vidéo » dépend d'« Appels » : on la désactive visuellement si les appels
  // sont coupés (la préférence reste mémorisée, mais sans effet).
  const syncVideoDep = () => {
    const call = app.querySelector('.opt-toggle[data-setting="allow_call"]');
    const video = app.querySelector('.opt-toggle[data-setting="allow_video"]');
    if (call && video) video.closest(".opt-row")?.classList.toggle("disabled", !call.checked);
  };
  syncVideoDep();
  app.querySelectorAll(".opt-toggle[data-setting]").forEach((box) => {
    box.addEventListener("change", async () => {
      const key = box.dataset.setting;
      try {
        await api("/api/me/settings", {
          method: "PATCH",
          headers: jsonAuth(),
          body: JSON.stringify({ [key]: box.checked }),
        });
        if (key === "allow_call") syncVideoDep();
        toast("Préférence enregistrée ✓");
      } catch (e) {
        box.checked = !box.checked; // rollback visuel si l'enregistrement échoue
        toast(e.message);
      }
    });
  });

  // Onglet « Options » → Disponibilités générales (jours / week-end / horaires /
  // créneaux / périodes). Tout changement enregistre la règle et rafraîchit le
  // calendrier de l'agenda en place (les jours par défaut suivent la nouvelle règle).
  const availState = normalizeAvailability((data.settings || {}).availability);
  const refreshEditorCalendar = () => {
    host.calendar.setAvailability(availState);
    const fill = app.querySelector(".calendar-fill");
    if (fill && fill.querySelector(".calendar")) {
      const load = dayLoadMap(data);
      fill.innerHTML = host.calendar.html(data.overrides || {}, true, load);
      host.calendar.wire(fill.querySelector(".calendar"), data.overrides || {}, true, data.handle, load);
    }
  };
  const saveAvail = async () => {
    try {
      await api("/api/me/settings", {
        method: "PATCH",
        headers: jsonAuth(),
        body: JSON.stringify({ availability: availState }),
      });
      data.settings = { ...(data.settings || {}), availability: { ...availState } };
      refreshEditorCalendar();
      toast("Disponibilités enregistrées ✓");
    } catch (e) {
      toast(e.message);
    }
  };
  // Jours de la semaine (toggle individuel)
  app.querySelectorAll("#avail-days .avail-day").forEach((b) =>
    b.addEventListener("click", () => {
      const i = Number(b.dataset.dow);
      availState.weekdays[i] = !availState.weekdays[i];
      b.classList.toggle("on", availState.weekdays[i]);
      b.setAttribute("aria-pressed", String(availState.weekdays[i]));
      const wk = app.querySelector("#avail-weekend");
      if (wk) wk.checked = availState.weekdays[5] && availState.weekdays[6];
      saveAvail();
    })
  );
  // Week-end (sam + dim d'un coup)
  app.querySelector("#avail-weekend")?.addEventListener("change", (e) => {
    const on = e.target.checked;
    availState.weekdays[5] = on;
    availState.weekdays[6] = on;
    app.querySelectorAll("#avail-days .avail-day").forEach((b) => {
      const i = Number(b.dataset.dow);
      if (i === 5 || i === 6) {
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", String(on));
      }
    });
    saveAvail();
  });
  // Horaires + finesse des créneaux
  app.querySelector("#avail-start")?.addEventListener("change", (e) => {
    if (e.target.value) { availState.start = e.target.value; saveAvail(); }
  });
  app.querySelector("#avail-end")?.addEventListener("change", (e) => {
    if (e.target.value) { availState.end = e.target.value; saveAvail(); }
  });
  app.querySelector("#avail-slot")?.addEventListener("change", (e) => {
    availState.slot_minutes = Number(e.target.value);
    saveAvail();
  });
  // Périodes : ajout / suppression
  const wirePeriodDeletes = () =>
    app.querySelectorAll("[data-del-period]").forEach((b) =>
      b.addEventListener("click", () => {
        availState.periods.splice(Number(b.dataset.delPeriod), 1);
        const box = app.querySelector("#avail-periods");
        if (box) box.innerHTML = periodsListHtml(availState.periods);
        wirePeriodDeletes();
        saveAvail();
      })
    );
  wirePeriodDeletes();
  app.querySelector("#ap-add")?.addEventListener("click", () => {
    const fromEl = app.querySelector("#ap-from");
    const toEl = app.querySelector("#ap-to");
    const from = fromEl.value, to = toEl.value;
    if (!from || !to) { toast("Renseignez les deux dates."); return; }
    const [f, t] = from <= to ? [from, to] : [to, from];
    availState.periods.push({ from: f, to: t, free: app.querySelector("#ap-status").value === "free" });
    fromEl.value = ""; toEl.value = "";
    const box = app.querySelector("#avail-periods");
    if (box) box.innerHTML = periodsListHtml(availState.periods);
    wirePeriodDeletes();
    saveAvail();
  });

  // Réseaux sociaux : sauvegarde par champ de carte `social_<net>`.
  app.querySelectorAll(".social-edit").forEach((row) => {
    const netKey = row.dataset.net;
    const net = SOCIAL_BY_KEY[netKey];
    const input = row.querySelector(".social-input");
    const open = row.querySelector(".social-open");
    let saved = input.value;
    const refreshOpen = () => {
      const url = socialUrl(net, input.value);
      if (url) { open.href = url; open.hidden = false; }
      else { open.removeAttribute("href"); open.hidden = true; }
    };
    const save = async () => {
      if (input.value.trim() === saved.trim()) return;
      try {
        await api("/api/card/field", {
          method: "PUT",
          headers: jsonAuth(),
          body: JSON.stringify({
            key: socialFieldKey(netKey),
            label: net.label,
            value: input.value.trim(),
            is_custom: true,
            visibility: "public",
          }),
        });
        saved = input.value;
        refreshOpen();
        toast(t("msg_saved"));
      } catch (e) { toast(e.message); }
    };
    input.addEventListener("input", refreshOpen);
    input.addEventListener("blur", save);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } });
  });

  // Onglets de la colonne Compte
  app.querySelectorAll(".acct-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      app.querySelectorAll(".acct-tab").forEach((t) => {
        t.classList.toggle("active", t === tab);
        t.setAttribute("aria-selected", String(t === tab));
      });
      const id = tab.dataset.tab;
      app.querySelectorAll(".acct-panel").forEach((p) => {
        p.hidden = p.id !== `acct-${id}`;
      });
    });
  });

  // Compte : email de récupération
  app.querySelector("#save-rec")?.addEventListener("click", async () => {
    await api("/api/recovery-email", {
      method: "PUT",
      headers: jsonAuth(),
      body: JSON.stringify({ email: app.querySelector("#rec-email").value }),
    });
    toast(t("msg_email_saved"));
  });

  // Invitation de contact : génère un jeton à usage unique → QR + lien à partager.
  app.querySelector("#gen-invite")?.addEventListener("click", async () => {
    try {
      const { token } = await api("/api/invites", { method: "POST", headers: jsonAuth(), body: "{}" });
      openQR(`${location.origin}/i/${token}`, "une invitation de contact");
    } catch (e) {
      toast(e.message || "Échec");
    }
  });
  app.querySelector("#open-groups")?.addEventListener("click", () => host.chat.openGroups(myKey(), myHandle()));

  // Passkeys
  async function refreshPasskeyList() {
    const list = app.querySelector("#passkey-list");
    if (!list) return;
    try {
      const passkeys = await api("/api/passkeys", { headers: authHeaders() });
      if (!passkeys.length) {
        list.innerHTML = `<p class="lbl-sm" style="color:var(--fg-muted)">Aucune passkey enregistrée.</p>`;
        return;
      }
      list.innerHTML = passkeys.map((p) => `
        <div class="passkey-row" data-pk-id="${esc(p.id)}">
          <span class="passkey-icon">${icon("shield", 16)}</span>
          <span class="passkey-name">${esc(p.name)}</span>
          <span class="passkey-meta">${p.backedUp ? "synchronisée" : "cet appareil"} · ${new Date(p.createdAt).toLocaleDateString()}</span>
          <button class="btn sm danger passkey-del" data-pk-id="${esc(p.id)}" title="Supprimer">✕</button>
        </div>`).join("");
      list.querySelectorAll(".passkey-del").forEach((b) =>
        b.addEventListener("click", async () => {
          if (!await confirmDialog("Supprimer cette passkey ?", { ok: "Supprimer", danger: true })) return;
          await api(`/api/passkeys/${encodeURIComponent(b.dataset.pkId)}`, { method: "DELETE", headers: authHeaders() });
          refreshPasskeyList();
        })
      );
    } catch {}
  }
  refreshPasskeyList();

  app.querySelector("#passkey-add")?.addEventListener("click", async () => {
    if (!window.PublicKeyCredential) return toast("Passkeys non supportées sur cet appareil");
    const name = app.querySelector("#passkey-name").value.trim() || "Passkey";
    try {
      // 1. Obtenir les options du serveur
      const options = await api("/api/passkeys/register/begin", {
        method: "POST", headers: jsonAuth(), body: JSON.stringify({ name }),
      });
      // 2. Créer la credential dans le navigateur
      const { startRegistration } = await import("https://unpkg.com/@simplewebauthn/browser@13/esm/index.js");
      const response = await startRegistration({ optionsJSON: options });
      // 3. Envoyer au serveur pour vérification
      await api("/api/passkeys/register/finish", {
        method: "POST", headers: jsonAuth(), body: JSON.stringify({ name, response }),
      });
      app.querySelector("#passkey-name").value = "";
      toast("Passkey enregistrée ✓");
      refreshPasskeyList();
    } catch (e) {
      if (e.name !== "NotAllowedError") toast(e.message || "Enregistrement annulé");
    }
  });

  // Chiffrement des messages : coffre de clé portable (passkey PRF / PIN / passphrase).
  async function refreshVaultStatus() {
    const { vault: vaultStr } = await e2eVaultGet(appState.key);
    const v = vaultStr ? JSON.parse(vaultStr) : null;
    const parts = [];
    if (v?.prf) parts.push("passkey");
    if (v?.pin) parts.push("code PIN");
    if (v?.pass) parts.push("passphrase");
    const hasVault = parts.length > 0;
    // Garder l'état cohérent pour les prochains rendus de la même session.
    data.hasVault = hasVault;

    // Compte (Identité) : texte court.
    const el = app.querySelector("#e2e-vault-status");
    if (el) {
      el.textContent = hasVault ? `Sauvegardé ✓ (${parts.join(" + ")})` : "Non sauvegardé sur ce compte.";
      el.style.color = hasVault ? "var(--success)" : "var(--muted)";
    }

    // Options › Sécurité : bandeau de statut + libellé du bouton de sauvegarde.
    const banner = app.querySelector("#opt-vault-banner");
    if (banner) {
      banner.classList.toggle("ok", hasVault);
      banner.classList.toggle("warn", !hasVault);
      banner.innerHTML = `${icon(hasVault ? "shield" : "key", 20)}
        <div>
          <b>${hasVault ? "Clé sauvegardée dans le coffre" : "Aucune sauvegarde de clé"}</b>
          <p>${hasVault ? "Vos messages chiffrés sont protégés sur tous vos appareils." : "Sans sauvegarde, vos messages sont perdus si vous changez d'appareil."}</p>
        </div>`;
    }
    const backupBtn = app.querySelector("#opt-e2e-backup");
    if (backupBtn) backupBtn.innerHTML = `${icon("download", 14)} ${hasVault ? "Mettre à jour le coffre" : "Sauvegarde rapide"}`;

    // Accueil : badge « E2E activé » / « Sans coffre ».
    const badges = app.querySelector("#hm-vault-badges");
    if (badges) badges.innerHTML = hasVault
      ? `<span class="hm-badge vault">${icon("lock", 11)} E2E activé</span>`
      : `<span class="hm-badge secret">${icon("lock", 11)} Sans coffre</span>`;
  }
  refreshVaultStatus();

  app.querySelector("#e2e-passkey-save")?.addEventListener("click", async () => {
    try {
      await ensureE2E(data.handle, appState.key);
      await e2eSaveVault(data.handle, appState.key, "passkey");
      toast("Clé sauvegardée via passkey ✓");
      refreshVaultStatus();
    } catch (e) {
      if (e.name !== "NotAllowedError") toast(e.message || "Échec");
    }
  });
  app.querySelector("#e2e-pin-save")?.addEventListener("click", async () => {
    const pin = await promptPin("Choisir un code PIN", { confirm: true });
    if (!pin) return;
    try {
      await ensureE2E(data.handle, appState.key);
      await e2eSaveVault(data.handle, appState.key, "pin", pin);
      toast("Clé sauvegardée via code PIN ✓");
      refreshVaultStatus();
    } catch (e) {
      toast(e.message || "Échec");
    }
  });
  app.querySelector("#e2e-pass-save")?.addEventListener("click", async () => {
    const pass = await promptPassphrase("Définir une passphrase de secours", { generate: true });
    if (!pass) return;
    try {
      await ensureE2E(data.handle, appState.key);
      await e2eSaveVault(data.handle, appState.key, "passphrase", pass);
      toast("Clé sauvegardée via passphrase ✓");
      refreshVaultStatus();
    } catch (e) {
      toast(e.message || "Échec");
    }
  });
  app.querySelector("#e2e-restore")?.addEventListener("click", () =>
    openE2eRestore(data.handle, appState.key, refreshVaultStatus)
  );

  // Colonne Compte — clé d'accès
  let keyVisible = false;
  app.querySelector("#toggle-key")?.addEventListener("click", () => {
    keyVisible = !keyVisible;
    app.querySelector("#key-display").textContent = keyVisible ? appState.key : "••••••••••••";
    app.querySelector("#toggle-key").innerHTML = `${icon("key",13)} ${keyVisible ? "Masquer" : "Afficher"}`;
  });

  // Nettoie tout état local de connexion (session, indice, ancienne clé).
  const clearLocalAuth = () => {
    setSessionHint(false);
    setStoredKey(null);
    setStoredHandle(null);
    appState.auth = null;
    appState.authPromise = null;
  };

  app.querySelector("#logout-btn")?.addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST", headers: jsonAuth() });
    } catch {}
    clearLocalAuth();
    location.assign("/");
  });

  app.querySelector("#logout-all-btn")?.addEventListener("click", async () => {
    if (!(await confirmDialog("Déconnecter tous les appareils ? Toutes les sessions seront fermées.", { ok: "Déconnecter tout", danger: true }))) return;
    try {
      await api("/api/auth/logout-all", { method: "POST", headers: jsonAuth() });
    } catch {}
    clearLocalAuth();
    location.assign("/");
  });

  // Code PIN d'appairage : génère un code à 6 chiffres à saisir sur le mobile.
  let pinTimer = null;
  // Génère un PIN d'appairage et l'affiche dans le couple display/hint fourni.
  // Deux emplacements existent (panneau Compte legacy masqué + onglet Accès v2),
  // chacun avec ses propres éléments — d'où le paramétrage plutôt qu'un alias.
  async function genPinInto(btn, display, hint) {
    if (!btn || !display) return;
    btn.disabled = true;
    try {
      const { pin, expiresAt } = await api("/api/auth/pin", { method: "POST", headers: jsonAuth() });
      display.textContent = pin.replace(/(\d{3})(\d{3})/, "$1 $2");
      display.hidden = false;
      if (hint) hint.hidden = false;
      if (pinTimer) clearInterval(pinTimer);
      const tick = () => {
        const left = Math.max(0, Math.round((new Date(expiresAt) - Date.now()) / 1000));
        if (left <= 0) {
          clearInterval(pinTimer);
          pinTimer = null;
          display.hidden = true;
          if (hint) hint.textContent = "Code expiré — générez-en un nouveau.";
        } else {
          const m = Math.floor(left / 60), s = String(left % 60).padStart(2, "0");
          if (hint) hint.textContent = `À saisir dans l'app mobile. Expire dans ${m}:${s}.`;
        }
      };
      tick();
      pinTimer = setInterval(tick, 1000);
    } catch (e) {
      if (hint) { hint.hidden = false; hint.textContent = e.message || "Impossible de générer le code."; }
      else toast(e.message || "Impossible de générer le code.");
    } finally {
      btn.disabled = false;
    }
  }
  app.querySelector("#gen-pin-btn")?.addEventListener("click", () =>
    genPinInto(app.querySelector("#gen-pin-btn"), app.querySelector("#pin-display"), app.querySelector("#pin-hint")));
  app.querySelector("#gen-pin-btn2")?.addEventListener("click", () =>
    genPinInto(app.querySelector("#gen-pin-btn2"), app.querySelector("#pin-display2"), app.querySelector("#pin-hint2")));

  // Liste des sessions/appareils actifs, avec révocation individuelle.
  async function refreshSessions() {
    const box = app.querySelector("#sessions-list");
    if (!box) return;
    try {
      const { sessions } = await api("/api/sessions", { headers: authHeaders() });
      if (!sessions.length) {
        box.innerHTML = `<p class="lbl-sm">Aucune session active.</p>`;
        return;
      }
      box.innerHTML = sessions
        .map((s) => {
          const when = new Date(s.lastSeen + "Z");
          const ua = (s.userAgent || "Appareil inconnu").slice(0, 60);
          return `<div class="session-row" data-sid="${esc(s.id)}" style="display:flex;align-items:center;gap:.5rem;justify-content:space-between;padding:.35rem 0;border-bottom:1px solid var(--line)">
            <span class="lbl-sm" style="flex:1">${esc(ua)}${s.current ? ' · <strong>cet appareil</strong>' : ""}<br><span style="opacity:.7">vu ${isNaN(when) ? "" : when.toLocaleString()}</span></span>
            ${s.current ? "" : `<button class="btn sm danger session-revoke" data-sid="${esc(s.id)}" title="Révoquer">✕</button>`}
          </div>`;
        })
        .join("");
      box.querySelectorAll(".session-revoke").forEach((b) =>
        b.addEventListener("click", async () => {
          await api(`/api/sessions/${encodeURIComponent(b.dataset.sid)}`, { method: "DELETE", headers: authHeaders() });
          refreshSessions();
        })
      );
    } catch {
      box.innerHTML = `<p class="lbl-sm">Sessions indisponibles.</p>`;
    }
  }
  refreshSessions();

  // Multi-appareils : liste des appareils chiffrés, approbation des appareils en
  // attente (réservée à un appareil déjà approuvé) et révocation.
  // Expose au module pour le handler SSE "device" (hors-portée de renderPrivate).
  appState.refreshDevices = async function () {
    const box = app.querySelector("#devices-list");
    if (!box) return;
    const myDid = mdDeviceId();
    const hdr = { ...authHeaders(), "x-device-id": myDid };
    try {
      const { devices } = await api("/api/devices", { headers: hdr });
      if (!devices || !devices.length) {
        box.innerHTML = `<p class="lbl-sm">Aucun appareil enregistré.</p>`;
        return;
      }
      const iAmApproved = devices.some((d) => d.deviceId === myDid && d.approved);
      box.innerHTML = devices
        .map((d) => {
          const isMe = d.deviceId === myDid;
          const badge = d.approved
            ? `<span class="badge-sm" style="color:var(--success)">approuvé</span>`
            : `<span class="badge-sm" style="color:var(--accent-ink)">en attente</span>`;
          let actions = "";
          if (isMe) actions = `<strong class="lbl-sm">cet appareil</strong>`;
          else {
            if (!d.approved && iAmApproved) actions += `<button class="btn sm device-approve" data-pk="${d.id}">Approuver</button>`;
            actions += `<button class="btn sm danger device-revoke" data-pk="${d.id}" title="Révoquer">✕</button>`;
          }
          return `<div class="session-row" style="display:flex;align-items:center;gap:.5rem;justify-content:space-between;padding:.35rem 0;border-bottom:1px solid var(--line)">
            <span class="lbl-sm" style="flex:1">${esc(d.name || "Appareil")} ${badge}</span>
            <span style="display:flex;gap:.35rem;align-items:center">${actions}</span>
          </div>`;
        })
        .join("");
      box.querySelectorAll(".device-approve").forEach((b) =>
        b.addEventListener("click", async () => {
          try {
            await api(`/api/devices/${encodeURIComponent(b.dataset.pk)}/approve`, { method: "POST", headers: hdr });
            toast?.("Appareil approuvé ✅");
          } catch (e) {
            toast?.(e.message || "Échec de l'approbation");
          }
          appState.refreshDevices();
        })
      );
      box.querySelectorAll(".device-revoke").forEach((b) =>
        b.addEventListener("click", async () => {
          if (!(await confirmDialog("Révoquer cet appareil ? Il ne pourra plus lire ni écrire vos messages.", { ok: "Révoquer", danger: true }))) return;
          try {
            await api(`/api/devices/${encodeURIComponent(b.dataset.pk)}`, { method: "DELETE", headers: hdr });
          } catch (e) {
            toast?.(e.message || "Échec");
          }
          appState.refreshDevices();
        })
      );
    } catch {
      box.innerHTML = `<p class="lbl-sm">Appareils indisponibles.</p>`;
    }
  }
  appState.refreshDevices();

  app.querySelector("#rotate-key")?.addEventListener("click", async () => {
    if (!(await confirmDialog("Régénérer la clé ? L'ancien lien privé cessera de fonctionner et les autres appareils seront déconnectés.", { ok: "Régénérer", danger: true }))) return;
    // Le serveur révoque toutes les sessions et en rouvre une (cookie) pour cet appareil.
    await api("/api/access-key/rotate", { method: "POST", headers: authHeaders() });
    setStoredKey(null); // l'ancienne clé éventuellement mémorisée n'est plus valable
    setSessionHint(true);
    appState.auth = null;
    appState.authPromise = null;
    toast("Clé régénérée ✓");
    // Recharge l'espace via la session cookie rafraîchie (récupère la nouvelle clé).
    location.assign("/me");
  });

  // Copie clé / URL publique depuis la colonne Compte
  app.querySelectorAll(".url-row .copy, #copy-key").forEach((b) =>
    b.addEventListener("click", () => {
      copyText(b.dataset.copy);
      toast(t("msg_copied"));
    })
  );

  // Export RGPD
  app.querySelector("#export-data")?.addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = `/api/me/export`;
    a.setAttribute("download", `mindlog-${data.handle}.json`);
    a.style.display = "none";
    // Passe la clé d'accès en header — contournement via fetch + blob
    api("/api/me/export", { headers: authHeaders() })
      .then((raw) => {
        // api() parse le JSON, on re-stringifie pour le téléchargement
        const blob = new Blob([JSON.stringify(raw, null, 2)], { type: "application/json" });
        a.href = URL.createObjectURL(blob);
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
      })
      .catch((e) => toast(e.message));
  });

  // Suppression définitive du compte (RGPD)
  app.querySelector("#delete-account")?.addEventListener("click", async () => {
    if (!(await confirmDialog(
      `Supprimer définitivement @${data.handle} ?\n\nToutes vos données (profil, agenda, relations, messages) seront effacées. Cette action est irréversible.`,
      { ok: "Supprimer", danger: true }
    ))) return;
    try {
      await api("/api/me", { method: "DELETE", headers: authHeaders() });
      // Nettoie le localStorage puis redirige vers la landing
      if (storedHandle() === data.handle) { setStoredKey(null); setStoredHandle(null); }
      toast("Compte supprimé.");
      setTimeout(() => location.assign("/"), 1200);
    } catch (e) {
      toast(e.message);
    }
  });

  // Relations : ajouter (avec type) / retirer
  // Autocomplete sur le champ @handle à relier
  {
    const relHandle = app.querySelector("#rel-handle");
    const relHandleResults = app.querySelector("#rel-handle-results");
    let relHandleTimer;
    const hideRelResults = () => { if (relHandleResults) relHandleResults.hidden = true; };

    relHandle?.addEventListener("input", () => {
      clearTimeout(relHandleTimer);
      const q = relHandle.value.trim();
      if (!q) { hideRelResults(); return; }
      relHandleTimer = setTimeout(async () => {
        try {
          const { results: list } = await api(`/api/search?q=${encodeURIComponent(q)}`);
          if (!list?.length) { hideRelResults(); return; }
          relHandleResults.innerHTML = list.map((r) => {
            const initials = (r.name || r.handle).slice(0, 2).toUpperCase();
            const avatar = r.photo
              ? `<img class="rhr-av" src="${esc(r.photo)}" alt="" loading="lazy" />`
              : `<span class="rhr-av">${esc(initials)}</span>`;
            return `<button class="rel-handle-result" data-handle="${esc(r.handle)}" type="button">
              ${avatar}
              <span class="rhr-info">
                <span class="nm">${esc(r.name || r.handle)}</span>
                <span class="hd">@${esc(r.handle)}</span>
              </span>
            </button>`;
          }).join("");
          relHandleResults.hidden = false;
        } catch { /* silencieux */ }
      }, 200);
    });

    relHandle?.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hideRelResults();
      if (e.key === "ArrowDown") {
        const first = relHandleResults?.querySelector(".rel-handle-result");
        first?.focus();
        e.preventDefault();
      }
    });

    relHandleResults?.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { hideRelResults(); relHandle?.focus(); }
    });

    relHandleResults?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-handle]");
      if (!btn) return;
      relHandle.value = btn.dataset.handle;
      hideRelResults();
      relHandle.focus();
    });

    document.addEventListener("click", (e) => {
      if (!relHandle?.closest(".handle-input")?.contains(e.target)) hideRelResults();
    }, { capture: true });
  }

  app.querySelector("#add-rel")?.addEventListener("click", async () => {
    const handle = app.querySelector("#rel-handle").value.trim();
    const type = app.querySelector("#rel-type").value;
    if (!handle) return toast(t("msg_handle_required"));
    try {
      await api("/api/relations", {
        method: "POST",
        headers: jsonAuth(),
        body: JSON.stringify({ handle, type }),
      });
      renderPrivate(appState.key);
    } catch (e) {
      toast(e.message);
    }
  });
  app.querySelectorAll("[data-del-rel]").forEach((b) =>
    b.addEventListener("click", async () => {
      await api(`/api/relations/${encodeURIComponent(b.dataset.delRel)}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      renderPrivate(appState.key);
    })
  );

  // Réciprocité : ajouter en retour une relation reçue (→ devient un contact)
  app.querySelectorAll("[data-recip]").forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        await api("/api/relations", {
          method: "POST",
          headers: jsonAuth(),
          body: JSON.stringify({ handle: b.dataset.recip, type: "amis" }),
        });
        toast(t("msg_relation_validated"));
        renderPrivate(appState.key);
      } catch (e) {
        toast(e.message);
      }
    })
  );

  // Recherche + chips degré/type des relations
  const relSearch = app.querySelector("#rel-search");
  const filterRels = () => {
    const q = (relSearch?.value || "").trim().toLowerCase();
    const activeDeg = app.querySelector("#rel-degree-chips .rel-chip.active")?.dataset.degree ?? "";
    const activeType = app.querySelector("#rel-type-chips .rel-chip.active")?.dataset.reltype ?? "";
    let anyVisible = false;
    app.querySelectorAll("#rel-all-list .rel").forEach((li) => {
      const okText = !q || (li.dataset.search || "").includes(q);
      const okDeg = !activeDeg || li.dataset.degree === activeDeg;
      const okType = !activeType || li.dataset.type === activeType;
      const show = okText && okDeg && okType;
      li.style.display = show ? "" : "none";
      if (show) anyVisible = true;
    });
    // Hide degree separators when all their items are hidden
    app.querySelectorAll("#rel-all-list .rel-deg-sep").forEach((sep) => {
      const d = sep.dataset.degree;
      const hasVisible = [...app.querySelectorAll(`#rel-all-list .rel[data-degree="${d}"]`)].some(
        (li) => li.style.display !== "none"
      );
      sep.hidden = !hasVisible;
    });
    // Show "no results" message
    const noRes = app.querySelector("#rel-no-results");
    if (noRes) noRes.hidden = anyVisible || !q && !activeDeg && !activeType;
  };
  relSearch?.addEventListener("input", filterRels);

  // Demandes de RDV : statut, suppression, filtre — tout en place (pas de reload,
  // on reste sur l'onglet RDV actif).
  const reqList = app.querySelector("ul.requests");
  const STATUS_BADGE = { accepted: ["ok", "Acceptée"], declined: ["no", "Refusée"], pending: ["pending", "En attente"] };
  const activeReqFilter = () =>
    app.querySelector("[data-req-filter].active")?.dataset.reqFilter || "pending";
  const applyReqFilter = (val) => {
    app.querySelectorAll("li.request").forEach((li) => {
      li.style.display = val === "all" || li.dataset.status === val ? "" : "none";
    });
  };
  // Recompte les puces depuis le DOM et réaffiche l'état vide si besoin.
  const refreshReqChips = () => {
    const lis = [...app.querySelectorAll("li.request")];
    const n = { all: lis.length, pending: 0, accepted: 0, declined: 0 };
    lis.forEach((li) => { n[li.dataset.status] = (n[li.dataset.status] || 0) + 1; });
    app.querySelectorAll("[data-req-filter]").forEach((chip) => {
      const span = chip.querySelector(".chip-n");
      if (span) span.textContent = n[chip.dataset.reqFilter] ?? 0;
    });
    const empty = reqList?.querySelector("li.empty");
    if (!lis.length && reqList && !empty) reqList.innerHTML = '<li class="empty">Aucune demande.</li>';
    applyReqFilter(activeReqFilter());
  };

  const setStatus = async (id, status, btn) => {
    await api(`/api/requests/${id}`, { method: "PATCH", headers: jsonAuth(), body: JSON.stringify({ status }) });
    const li = btn.closest("li.request");
    if (li) {
      li.dataset.status = status;
      const badge = li.querySelector(".req-status");
      const [cls, label] = STATUS_BADGE[status] || STATUS_BADGE.pending;
      if (badge) { badge.className = `req-status ${cls}`; badge.textContent = label; }
    }
    refreshReqChips();
    toast(status === "accepted" ? "Demande acceptée 🦎" : "Demande refusée");
  };
  app.querySelectorAll("[data-req-accept]").forEach((b) =>
    b.addEventListener("click", () => setStatus(b.dataset.reqAccept, "accepted", b))
  );
  app.querySelectorAll("[data-req-decline]").forEach((b) =>
    b.addEventListener("click", () => setStatus(b.dataset.reqDecline, "declined", b))
  );
  app.querySelectorAll("[data-req-del]").forEach((b) =>
    b.addEventListener("click", async () => {
      await api(`/api/requests/${b.dataset.reqDel}`, { method: "DELETE", headers: authHeaders() });
      b.closest("li.request")?.remove();
      refreshReqChips();
      toast("Demande supprimée");
    })
  );

  // Filtre par statut (client) : « En attente » actif par défaut.
  const reqChips = app.querySelectorAll("[data-req-filter]");
  reqChips.forEach((chip) =>
    chip.addEventListener("click", () => {
      reqChips.forEach((c) => c.classList.toggle("active", c === chip));
      applyReqFilter(chip.dataset.reqFilter);
    })
  );
  if (app.querySelector("li.request")) applyReqFilter("pending");

  renderPrivateFooter(data);
}

export function renderPrivateFooter(data) {
  footer.innerHTML = `<p style="margin:.4rem 0"><span class="mobile-hide">${CREDIT()} · </span><a href="${esc(data.publicUrl)}" target="_blank" rel="noopener">Voir ma page ↗</a></p>`;
}

// ISO → valeur d'un <input type="datetime-local"> (heure LOCALE, sans secondes).
function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Modale composer d'événement (création ou édition), inspirée du « New meeting »
// de Teams : titre, créneau début/fin, lieu, lien, notes, visibilité publique.
// `event` null → création (POST /api/agenda) ; sinon édition (PUT /api/agenda/:id).
// opts.liveAvailable : affiche le sélecteur « Événement / Live » (créateur premium
// avec bénéfice lives activé). Un live planifié est visible par tous mais
// joignable uniquement par les abonné·e·s de l'espace premium.
export function openEventModal(event, opts = {}) {
  const editing = !!event;
  const initialKind = editing && event.kind === "live" ? "live" : "event";
  // On expose le toggle si le créateur peut planifier un live, OU si on édite
  // un live existant (pour permettre la rétrogradation en simple événement).
  const showKindToggle = !!opts.liveAvailable || initialKind === "live";
  const overlay = document.createElement("div");
  overlay.className = "overlay open";
  overlay.innerHTML = `
    <div class="panel ev-modal" role="dialog" aria-modal="true" aria-labelledby="ev-modal-title">
      <button type="button" class="close" id="ev-close" aria-label="Fermer">✕</button>
      <h2 id="ev-modal-title">${editing ? "Modifier l'événement" : "Nouvel événement"}</h2>
      <form id="ev-form" novalidate data-kind="${initialKind}">
        ${showKindToggle ? `
        <div class="group ev-kind-row" role="radiogroup" aria-label="Type d'événement">
          <button type="button" class="ev-kind-tab${initialKind === "event" ? " active" : ""}" data-kind="event" role="radio" aria-checked="${initialKind === "event"}">
            ${icon("calendar", 14)} Événement
          </button>
          <button type="button" class="ev-kind-tab${initialKind === "live" ? " active" : ""}" data-kind="live" role="radio" aria-checked="${initialKind === "live"}">
            ${icon("users", 14)} Live
          </button>
        </div>
        <p class="ev-kind-hint" id="ev-kind-hint" ${initialKind === "live" ? "" : "hidden"}>
          ${icon("lock", 12)} Diffusion réservée à tes abonné·e·s premium. L'horaire est visible publiquement.
        </p>` : ""}
        <div class="group">
          <label for="ev-title">Titre</label>
          <input id="ev-title" name="title" maxlength="200" required placeholder="Réunion, rendez-vous, sortie…" value="${editing ? esc(event.title || "") : ""}" />
        </div>
        <div class="group ev-grid2">
          <div>
            <label for="ev-start">Début</label>
            <input id="ev-start" name="starts_at" type="datetime-local" required value="${editing ? toLocalInput(event.starts_at) : ""}" />
          </div>
          <div>
            <label for="ev-end">Fin <span class="opt">(optionnel)</span></label>
            <input id="ev-end" name="ends_at" type="datetime-local" value="${editing ? toLocalInput(event.ends_at) : ""}" />
          </div>
        </div>
        <div class="group">
          <label for="ev-loc">Lieu <span class="opt">(optionnel)</span></label>
          <input id="ev-loc" name="location" maxlength="200" placeholder="Adresse, salle, visio…" value="${editing ? esc(event.location || "") : ""}" />
        </div>
        <div class="group">
          <label for="ev-link">Lien <span class="opt">(optionnel)</span></label>
          <input id="ev-link" name="link" type="url" maxlength="500" placeholder="https://…" value="${editing ? esc(event.link || "") : ""}" />
        </div>
        <div class="group">
          <label for="ev-notes">Notes <span class="opt">(optionnel)</span></label>
          <textarea id="ev-notes" name="notes" rows="3" maxlength="4000" placeholder="Détails, ordre du jour…">${editing ? esc(event.notes || "") : ""}</textarea>
        </div>
        <label class="ev-public-row"><input type="checkbox" id="ev-public" name="is_public" ${editing ? (event.is_public !== 0 ? "checked" : "") : "checked"} /> <span>Visible publiquement sur ma page</span></label>
        <div class="err" id="ev-err"></div>
        <div class="actions">
          ${editing ? `<button type="button" class="btn danger ghost" id="ev-delete">${icon("trash", 15)} Supprimer</button>` : ""}
          <button type="button" class="btn" id="ev-cancel">Annuler</button>
          <button type="submit" class="btn primary">${editing ? "Enregistrer" : "Ajouter"}</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  const errEl = overlay.querySelector("#ev-err");
  overlay.addEventListener("click", (e) => e.target === overlay && close());
  overlay.querySelector("#ev-close").addEventListener("click", close);
  overlay.querySelector("#ev-cancel").addEventListener("click", close);
  overlay.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  setTimeout(() => overlay.querySelector("#ev-title").focus(), 30);

  overlay.querySelector("#ev-delete")?.addEventListener("click", async () => {
    if (!(await confirmDialog(`Supprimer « ${event.title} » ?`, { ok: "Supprimer", danger: true }))) return;
    await api(`/api/agenda/${event.id}`, { method: "DELETE", headers: authHeaders() });
    close();
    renderPrivate(appState.key);
  });

  // Toggle « Événement / Live » : maintient form.dataset.kind, met à jour l'état
  // visuel des deux onglets et révèle un hint contextuel quand on passe en Live.
  const formEl = overlay.querySelector("#ev-form");
  overlay.querySelectorAll(".ev-kind-tab").forEach((tab) =>
    tab.addEventListener("click", () => {
      const k = tab.dataset.kind === "live" ? "live" : "event";
      formEl.dataset.kind = k;
      overlay.querySelectorAll(".ev-kind-tab").forEach((t) => {
        const on = t.dataset.kind === k;
        t.classList.toggle("active", on);
        t.setAttribute("aria-checked", on ? "true" : "false");
      });
      const hint = overlay.querySelector("#ev-kind-hint");
      if (hint) hint.hidden = k !== "live";
    })
  );

  formEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.textContent = "";
    const fd = new FormData(e.target);
    const title = (fd.get("title") || "").trim();
    const start = fd.get("starts_at");
    const end = fd.get("ends_at");
    if (!title) { errEl.textContent = "Le titre est requis."; return; }
    if (!start) { errEl.textContent = "La date de début est requise."; return; }
    if (end && new Date(end) < new Date(start)) { errEl.textContent = "La fin doit suivre le début."; return; }
    const payload = {
      title,
      starts_at: new Date(start).toISOString(),
      ends_at: end ? new Date(end).toISOString() : null,
      location: (fd.get("location") || "").trim(),
      link: (fd.get("link") || "").trim(),
      notes: (fd.get("notes") || "").trim(),
      is_public: fd.get("is_public") === "on",
      kind: formEl.dataset.kind === "live" ? "live" : "event",
    };
    const submitBtn = e.target.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    try {
      await api(editing ? `/api/agenda/${event.id}` : "/api/agenda", {
        method: editing ? "PUT" : "POST",
        headers: jsonAuth(),
        body: JSON.stringify(payload),
      });
      close();
      toast(editing ? "Événement modifié 🦎" : "Événement ajouté 🦎");
      renderPrivate(appState.key);
    } catch (err) {
      submitBtn.disabled = false;
      errEl.textContent = "Échec de l'enregistrement. Réessayez.";
    }
  });
}

