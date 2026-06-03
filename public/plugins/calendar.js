/* ============================================================================
 * Plugin : Calendrier & demande de RDV
 * ----------------------------------------------------------------------------
 * Disponibilités par jour (libre en semaine, occupé le week-end par défaut ;
 * seules les exceptions sont stockées dans `overrides`) + modale de RDV.
 *
 * S'enregistre via le registre de plugins de app.js et expose ses capacités
 * sous `host.calendar` : { html, wire, openBooking, fmtDay }.
 * N'importe RIEN de app.js : toutes les primitives partagées (esc, api, toast,
 * jsonAuth…) arrivent par l'objet `host` injecté à l'enregistrement.
 * ========================================================================== */

export default function register(host) {
  const { esc, api, toast, jsonAuth, isLoggedIn, viewerHeaders } = host;

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDay = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;

  // Règle de dispo générale courante (jours de semaine + périodes), réglée par
  // l'app avant chaque rendu via setAvailability(). Par défaut : L-V libre.
  const DEFAULT_AVAIL = { weekdays: [true, true, true, true, true, false, false], periods: [] };
  let currentAvail = DEFAULT_AVAIL;
  function setAvailability(a) {
    currentAvail = a && Array.isArray(a.weekdays) && a.weekdays.length === 7
      ? { weekdays: a.weekdays, periods: Array.isArray(a.periods) ? a.periods : [] }
      : DEFAULT_AVAIL;
  }

  // Statut par défaut d'un jour : périodes datées prioritaires, sinon jour de semaine.
  function defaultStatus(iso) {
    for (const p of currentAvail.periods) {
      if (p && iso >= p.from && iso <= p.to) return p.free ? "free" : "busy";
    }
    const wd = new Date(iso + "T00:00:00Z").getUTCDay(); // 0 = dim … 6 = sam
    return currentAvail.weekdays[(wd + 6) % 7] ? "free" : "busy";
  }

  function fmtDay(iso) {
    return new Date(iso + "T00:00:00Z").toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    });
  }

  let calOffset = 0; // mois affiché, relatif au mois courant (persiste entre re-rendus)

  function calYearMonth(offset) {
    const now = new Date();
    let m = now.getMonth() + offset;
    let y = now.getFullYear() + Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    return { y, m };
  }

  // Heatmap de charge : 0-1 = vert, 2-3 = orange, 4+ = rouge.
  function heatClass(n) {
    if (!n) return "heat-0";
    if (n <= 1) return "heat-0";
    if (n <= 3) return "heat-mid";
    return "heat-high";
  }

  // Contenu interne du calendrier pour le mois courant (calOffset).
  // `counts` (optionnel) : map iso→nombre d'événements du jour → heatmap.
  // `canBook` (défaut true) : autorise la prise de RDV sur un jour libre (faux pour
  // sa propre page — on ne se demande pas un RDV à soi-même).
  function calInner(overrides, editable, counts, canBook = true) {
    const { y, m } = calYearMonth(calOffset);
    const now = new Date();
    const todayIso = isoDay(now.getFullYear(), now.getMonth(), now.getDate());
    const first = new Date(Date.UTC(y, m, 1));
    const title = first.toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
    const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const startOffset = (first.getUTCDay() + 6) % 7; // lundi = 0
    const dows = ["L", "M", "M", "J", "V", "S", "D"].map((d) => `<div class="cal-dow">${d}</div>`).join("");

    let cells = "";
    for (let i = 0; i < startOffset; i++) cells += '<div class="cal-cell empty"></div>';
    const heatmap = !!counts && !editable; // heatmap : lecture seule avec compteurs
    for (let d = 1; d <= days; d++) {
      const iso = isoDay(y, m, d);
      const status = overrides[iso] || defaultStatus(iso);
      const past = iso < todayIso;
      const n = counts ? counts[iso] || 0 : 0;
      // En édition, on colore selon la dispo (libre/occupé) — c'est ce qu'on règle ;
      // la charge (heatmap) n'est utilisée qu'en lecture seule avec compteurs.
      const cls = ["cal-cell", heatmap && !editable ? heatClass(n) : status, past ? "past" : ""].join(" ").trim();
      let attr = "";
      if (!past && editable) {
        const load = n ? ` — ${n} événement${n > 1 ? "s" : ""}` : "";
        attr = `data-day="${iso}" title="Cliquer pour basculer dispo/occupé${load}"`;
      } else if (!past && !editable && canBook && status === "free") attr = `data-book="${iso}" title="Demander un RDV ce jour"`;
      // En lecture seule sans prise de RDV (ma propre page), les jours ne sont pas cliquables.
      const inert = past || (!editable && (status === "busy" || !canBook));
      cells += `<button class="${cls}" ${attr} ${inert ? "disabled" : ""}>${d}</button>`;
    }
    // On ne recule pas avant le mois courant.
    const prevDisabled = calOffset <= 0 ? "disabled" : "";
    const legend = heatmap
      ? `
      <div class="cal-legend">
        <span><i class="dot-heat-0"></i> 0-1</span>
        <span><i class="dot-heat-mid"></i> 2-3</span>
        <span><i class="dot-heat-high"></i> 4+</span>
        <span>charge du jour</span>
      </div>`
      : `
      <div class="cal-legend">
        <span><i class="dot-free"></i> Disponible</span>
        <span><i class="dot-busy"></i> Occupé</span>
        ${editable ? "<span>Clic = basculer</span>" : canBook ? "<span>Clic sur un jour libre = RDV</span>" : ""}
      </div>`;
    return `
      <div class="cal-head">
        <button class="cal-nav" type="button" data-cal-prev aria-label="Mois précédent" ${prevDisabled}>‹</button>
        <span class="cal-title">${title}</span>
        <button class="cal-nav" type="button" data-cal-next aria-label="Mois suivant">›</button>
      </div>
      <div class="cal-grid">${dows}${cells}</div>
      ${legend}`;
  }

  function calendarHtml(overrides, editable, counts, canBook = true) {
    return `<div class="calendar">${calInner(overrides || {}, editable, counts, canBook)}</div>`;
  }

  // Câble la navigation de mois + les jours (bascule en édition, RDV en public).
  function wireCalendar(container, overrides, editable, handle, counts, canBook = true) {
    if (!container) return;
    const rerender = () => {
      container.innerHTML = calInner(overrides, editable, counts, canBook);
      wireCalendar(container, overrides, editable, handle, counts, canBook);
    };
    container.querySelector("[data-cal-prev]")?.addEventListener("click", () => {
      if (calOffset > 0) calOffset--;
      rerender();
    });
    container.querySelector("[data-cal-next]")?.addEventListener("click", () => {
      calOffset++;
      rerender();
    });

    if (editable) {
      container.querySelectorAll("[data-day]").forEach((b) =>
        b.addEventListener("click", async () => {
          const day = b.dataset.day;
          // Statut courant calculé depuis l'état (override ou défaut), pas la
          // classe CSS — fiable quel que soit le mode d'affichage de la cellule.
          const cur = overrides[day] || defaultStatus(day);
          const next = cur === "free" ? "busy" : "free";
          try {
            await api(`/api/availability/${day}`, {
              method: "PUT",
              headers: jsonAuth(),
              body: JSON.stringify({ status: next }),
            });
            // MAJ locale puis re-render du seul calendrier (conserve la position du deck).
            if (next === defaultStatus(day)) delete overrides[day];
            else overrides[day] = next;
            rerender();
          } catch (e) {
            toast(e.message);
          }
        })
      );
    } else {
      container.querySelectorAll("[data-book]").forEach((b) =>
        b.addEventListener("click", () =>
          openBooking(handle, { day: b.dataset.book, label: fmtDay(b.dataset.book) })
        )
      );
    }
  }

  // Modale « Demander un RDV » (visiteur).
  function openBooking(handle, day) {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `
      <div class="panel" role="dialog" aria-modal="true" aria-labelledby="bk-title">
        <button type="button" class="close" id="bk-close" aria-label="Fermer">✕</button>
        <h2 id="bk-title">Demander un RDV</h2>
        <p class="sub">${day ? "Date souhaitée : <strong>" + esc(day.label) + "</strong>" : "Laissez vos coordonnées, @" + esc(handle) + " vous recontactera."}</p>
        ${day ? '<div class="bk-slots" id="bk-slots" hidden></div>' : ""}
        <form id="bk-form">
          <div class="group">
            <label for="bk-name">Votre nom</label>
            <input id="bk-name" required />
          </div>
          <div class="group">
            <label for="bk-email">Email</label>
            <input id="bk-email" type="email" placeholder="vous@exemple.com" />
          </div>
          <div class="group">
            <label for="bk-msg">Message (optionnel)</label>
            <textarea id="bk-msg" rows="3"></textarea>
          </div>
          <div class="err" id="bk-err"></div>
          <div class="actions">
            <button type="button" class="btn" id="bk-cancel">Annuler</button>
            <button type="submit" class="btn primary">Envoyer la demande</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(overlay);

    // Créneaux horaires du jour choisi : le visiteur sélectionne une heure précise.
    let selectedTime = null;
    if (day?.day) {
      const slotsBox = overlay.querySelector("#bk-slots");
      api(`/api/identities/${encodeURIComponent(handle)}/slots?day=${encodeURIComponent(day.day)}`, {
        headers: isLoggedIn() ? viewerHeaders() : {},
      })
        .then((res) => {
          if (!slotsBox) return;
          const slots = res.slots || [];
          if (!slots.length) return; // pas de créneaux → demande sans heure précise
          slotsBox.hidden = false;
          slotsBox.innerHTML =
            '<span class="bk-slots-label">Créneau souhaité</span><div class="bk-slot-grid">' +
            slots
              .map(
                (s) =>
                  `<button type="button" class="bk-slot${s.taken ? " taken" : ""}" data-time="${esc(s.time)}" ${s.taken ? "disabled" : ""}>${esc(s.time)}</button>`
              )
              .join("") +
            "</div>";
          slotsBox.querySelectorAll(".bk-slot:not(.taken)").forEach((b) =>
            b.addEventListener("click", () => {
              const on = b.classList.contains("sel");
              slotsBox.querySelectorAll(".bk-slot").forEach((x) => x.classList.remove("sel"));
              if (!on) { b.classList.add("sel"); selectedTime = b.dataset.time; }
              else selectedTime = null;
            })
          );
        })
        .catch(() => { /* créneaux indisponibles → demande sans heure */ });
    }

    // Pre-fill si connecté (session cookie ou clé héritée)
    if (isLoggedIn()) {
      api("/api/me", { headers: viewerHeaders() })
        .then(me => {
          const dn = (me.fields || []).find(f => f.key === "display_name")?.value;
          const nameEl = overlay.querySelector("#bk-name");
          const emailEl = overlay.querySelector("#bk-email");
          if (nameEl && !nameEl.value) nameEl.value = dn || me.handle || "";
          if (emailEl && !emailEl.value) emailEl.value = me.recoveryEmail || "";
        })
        .catch(() => {});
    }

    const close = () => overlay.remove();
    overlay.addEventListener("click", (e) => e.target === overlay && close());
    overlay.querySelector("#bk-cancel").addEventListener("click", close);
    overlay.querySelector("#bk-close").addEventListener("click", close);
    overlay.querySelector("#bk-name").focus();

    overlay.querySelector("#bk-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const errEl = overlay.querySelector("#bk-err");
      errEl.textContent = "";
      try {
        const name = overlay.querySelector("#bk-name").value;
        const email = overlay.querySelector("#bk-email").value;
        await api(`/api/identities/${encodeURIComponent(handle)}/requests`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            day: day ? day.day : null,
            time: selectedTime,
            name,
            email,
            message: overlay.querySelector("#bk-msg").value,
          }),
        });
        close();
        host.toast(host.t("msg_request_sent"));
        // Auto-création de compte si visiteur non connecté + email fourni
        if (!isLoggedIn() && email) autoRegister(name, email).catch(() => {});
      } catch (err) {
        errEl.textContent = err.message;
      }
    });
  }

  async function autoRegister(name, email) {
    const slug = name.toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28) || "visiteur";
    const tries = [slug, `${slug}-${Math.floor(Math.random() * 900 + 100)}`];
    for (const handle of tries) {
      try {
        await api("/api/identities", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ handle, email, display_name: name, autoCreated: true }),
        });
        host.toast("📬 Compte créé — vérifie ta boîte mail pour accéder au chat E2E chiffré");
        return;
      } catch (err) {
        if (!err.message?.includes("handle")) return; // abandon si erreur non liée au handle
      }
    }
  }

  host.registerPlugin({ name: "calendar" });
  // Capacités exposées au cœur de l'app (utilisées en place dans l'éditeur,
  // la vue carte publique et le profil public).
  host.calendar = { html: calendarHtml, wire: wireCalendar, openBooking, fmtDay, defaultStatus, setAvailability };
}
