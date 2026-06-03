// editor/tabs/home.js — colonne « Accueil » : aperçu configurable de la page
// publique (style linktr.ee) à gauche + colonne « back-office » à droite.
// Builder de rendu pur (câblage dans wireEditor). cf. docs/web-app-split-proposal.md
import { esc } from "../../ui/dom.js";
import { SOCIAL_BY_KEY, icon, isSocialKey, miloSvg, socialIcon, socialUrl } from "../../ui/icons.js";

export function renderHomeColumn(data, { photo }) {
  const rel = data.relations || { 1: [], 2: [], 3: [] };
  const _deg1 = rel[1] || [];

  // Helpers home dashboard
  const hmGet = (k) => data.fields?.find(f => f.key === k)?.value?.trim() || "";
  const hmDisplayName = hmGet("display_name");
  const hmTitle = [hmGet("title"), hmGet("company")].filter(Boolean).join(" · ");
  const hmLocation = hmGet("location");
  const hmPending = (data.requests || []).filter(r => r.status === "pending").length;
  const hmEvents = [...(data.events || [])].sort((a, b) => (a.starts_at || "").localeCompare(b.starts_at || "")).slice(0, 4);
  const hmNotifs = (data.notifications || []).slice(0, 4);
  const hmProfilePublic = data.settings?.profile_public !== false;
  const hmAgendaPublic = data.settings?.public_availability !== false;
  const hmGalleryPublic = data.settings?.gallery_public !== false;

  function hmEventCard(e) {
    const d = new Date(e.starts_at);
    const day = isNaN(d) ? "?" : d.getDate();
    const mon = isNaN(d) ? "" : d.toLocaleString("fr-FR", { month: "short" });
    const time = isNaN(d) ? "" : d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    return `<div class="hm-event">
      <div class="hm-event-date"><div class="hm-event-day">${day}</div><div class="hm-event-mon">${mon}</div></div>
      <div class="hm-event-info">
        <div class="hm-event-title">${esc(e.title)}</div>
        <div class="hm-event-meta">${time}${e.location ? ` · ${esc(e.location)}` : ""}</div>
      </div>
    </div>`;
  }

  function hmNotifRow(n) {
    return `<div class="hm-notif ${n.read ? "" : "unread"}">
      <div class="hm-notif-dot"></div>
      <div class="hm-notif-text">${esc(n.text || "")}</div>
    </div>`;
  }

  // Un « lien » de la pile linktr.ee (interne via data-goto, ou externe via href).
  function ltLink({ href = "", goto = "", id = "", ic, label, brand = "", ext = false, muted = false }) {
    const attrs = href
      ? `href="${esc(href)}" target="_blank" rel="noopener noreferrer"`
      : `type="button"${goto ? ` data-goto="${esc(goto)}"` : ""}${id ? ` id="${id}"` : ""}`;
    const tag = href ? "a" : "button";
    return `<${tag} class="lt-link${muted ? " lt-link-muted" : ""}" ${attrs}${brand ? ` style="--lt-brand:${brand}"` : ""}>
      <span class="lt-link-ic">${ic}</span>
      <span class="lt-link-label">${esc(label)}</span>
      ${ext ? `<span class="lt-link-ext" aria-hidden="true">↗</span>` : `<span class="lt-link-go" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></span>`}
    </${tag}>`;
  }

  // Réseaux sociaux renseignés → autant de liens (couleur de marque).
  const socialLinks = (data.fields || [])
    .filter(f => isSocialKey(f.key) && f.value && f.value.trim())
    .map(f => {
      const net = SOCIAL_BY_KEY[f.key.replace(/^social_/, "")];
      if (!net) return "";
      const url = socialUrl(net, f.value);
      if (!url) return "";
      return ltLink({ href: url, ic: socialIcon(net, 18), label: net.label, brand: net.color, ext: true });
    }).join("");

  const vaultBadge = data.hasVault
    ? `<span class="hm-badge vault">${icon("lock", 11)} E2E activé</span>`
    : `<span class="hm-badge secret">${icon("lock", 11)} Sans coffre</span>`;

  return `<div class="hm-dashboard">

      ${hmPending ? `<div class="hm-requests-banner" data-goto="Agenda">
        ${icon("clock", 18)}
        <div><b>${hmPending} demande${hmPending > 1 ? "s" : ""} de RDV</b> <span>en attente de réponse</span></div>
        <span style="margin-left:auto;color:var(--accent-ink);font-size:.8rem">Voir →</span>
      </div>` : ""}

      <div class="hm-row hm-row-hybrid">

        <!-- ===== GAUCHE : aperçu de la page publique (linktr.ee) ===== -->
        <section class="hm-section hm-public">
          <div class="hm-section-title">Aperçu de ta page publique <a href="/@${esc(data.handle)}" target="_blank" rel="noopener noreferrer">Ouvrir ↗</a></div>

          <div class="lt-inner">
            <div class="lt-head">
              <div class="lt-av">${photo}</div>
              ${hmDisplayName ? `<div class="lt-name">${esc(hmDisplayName)}</div>` : ""}
              <div class="lt-handle${hmDisplayName ? "" : " lt-name"}">@${esc(data.handle)}</div>
              ${hmTitle ? `<div class="lt-role">${esc(hmTitle)}</div>` : ""}
              ${hmLocation ? `<div class="lt-loc">${icon("pin", 13)} ${esc(hmLocation)}</div>` : ""}
              <div class="hm-badges" id="hm-vault-badges">${vaultBadge}</div>
            </div>

            <!-- Pile de liens : nav interne en data-goto (délégué via #menu-nav) -->
            <div class="lt-links" id="menu-nav">
              ${ltLink({ href: `/@${esc(data.handle)}`, ic: icon("link", 18), label: "Ma page publique", ext: true })}
              ${ltLink({ id: "hm-qr-btn", ic: icon("qr", 18), label: "Mon QR code" })}
              ${socialLinks}
              ${hmAgendaPublic ? ltLink({ goto: "Agenda", ic: icon("calendar", 18), label: "Prendre rendez-vous" }) : ""}
              ${hmGalleryPublic ? ltLink({ goto: "Galerie", ic: icon("image", 18), label: "Ma galerie" }) : ""}
              ${ltLink({ goto: "Identité", ic: icon("user", 18), label: "Modifier ma carte", muted: true })}
            </div>

            <!-- Config : ce qui est visible publiquement -->
            <div class="lt-config">
              <div class="lt-config-title">Visible publiquement</div>
              <div class="hm-privacy-toggles">
                <label class="hm-toggle">
                  <span class="hm-toggle-ic">${icon("user", 14)}</span>
                  <span class="hm-toggle-label">Profil public</span>
                  <input type="checkbox" data-setting="profile_public" ${hmProfilePublic ? "checked" : ""}>
                  <span class="hm-toggle-sw"></span>
                </label>
                <label class="hm-toggle">
                  <span class="hm-toggle-ic">${icon("calendar", 14)}</span>
                  <span class="hm-toggle-label">Agenda public</span>
                  <input type="checkbox" data-setting="public_availability" ${hmAgendaPublic ? "checked" : ""}>
                  <span class="hm-toggle-sw"></span>
                </label>
                <label class="hm-toggle">
                  <span class="hm-toggle-ic">${icon("image", 14)}</span>
                  <span class="hm-toggle-label">Galerie publique</span>
                  <input type="checkbox" data-setting="gallery_public" ${hmGalleryPublic ? "checked" : ""}>
                  <span class="hm-toggle-sw"></span>
                </label>
              </div>
              <button type="button" class="lt-tour" id="hm-tour-btn" title="Visite guidée avec Milo">🦎 Refaire la visite guidée</button>
            </div>
          </div>
        </section>

        <!-- ===== DROITE : coup d'œil / back-office ===== -->
        <aside class="hm-aside">
          <div class="hm-section">
            <div class="hm-section-title">Coup d'œil</div>
            <div class="hm-stats-grid">
              <div class="hm-stat" data-goto="Relations"><b>${_deg1.length}</b><span>connexions</span></div>
              <div class="hm-stat" data-goto="Notifications"><b>${data.unread || 0}</b><span>non lus</span></div>
              <div class="hm-stat" data-goto="Agenda"><b>${hmPending}</b><span>RDV en attente</span></div>
              <div class="hm-stat" data-goto="Agenda"><b>${data.events?.length || 0}</b><span>événements</span></div>
            </div>
          </div>

          <div class="hm-section">
            <div class="hm-section-title">Prochains événements <a data-goto="Agenda" href="#">Tout voir</a></div>
            <div class="hm-events">
              ${hmEvents.length ? hmEvents.map(hmEventCard).join("") : `<div class="hm-empty">${miloSvg(44)}<br>Aucun événement à venir</div>`}
            </div>
          </div>

          <div class="hm-section">
            <div class="hm-section-title">Activité récente <a data-goto="Notifications" href="#">Tout voir</a></div>
            ${hmNotifs.length ? `<div class="hm-notifs">${hmNotifs.map(hmNotifRow).join("")}</div>` : `<div class="hm-empty">Aucune activité récente</div>`}
          </div>
        </aside>
      </div>

      <!-- Pied de page avec Milo -->
      <div style="text-align:center;padding:1.5rem 0 .5rem;opacity:.5" aria-hidden="true">${miloSvg(56)}</div>
    </div>`;
}
