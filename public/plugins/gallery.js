/**
 * Plugin Galerie — jusqu'à 10 photos publiques par identité.
 * Upload en masse (drag & drop ou sélecteur). Like par empreinte navigateur.
 */
export default function register(host) {

  function fingerprint() {
    let fp = localStorage.getItem("mindlog_fp");
    if (!fp) {
      const arr = new Uint8Array(10);
      crypto.getRandomValues(arr);
      fp = Array.from(arr, b => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem("mindlog_fp", fp);
    }
    return fp;
  }

  function itemHtml(p, isOwner) {
    const link = (p.link_url || "").replace(/"/g, "%22");
    return `<div class="gal-item" data-id="${p.id}" data-link="${link}">
      <img src="${p.url}?ts=${p.id}" alt="" loading="lazy" />
      ${!isOwner && link ? `<span class="gal-linkbadge" title="Lien cliquable" aria-hidden="true">🔗</span>` : ""}
      ${isOwner ? `<button class="gal-link${link ? " on" : ""}" title="Lien cliquable (Premium)">🔗</button>` : ""}
      ${isOwner ? `<button class="gal-del" title="Supprimer">✕</button>` : ""}
      <button class="gal-like${p.liked ? " liked" : ""}" data-id="${p.id}" title="J'aime">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="${p.liked ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        <span class="gal-count">${p.likes}</span>
      </button>
    </div>`;
  }

  function gridHtml(photos, isOwner) {
    if (!photos.length) return `<p class="gal-empty">Aucune photo.</p>`;
    return photos.map(p => itemHtml(p, isOwner)).join("");
  }

  function openLightbox(src) {
    const lb = document.createElement("div");
    lb.className = "gal-lb";
    lb.innerHTML = `<div class="gal-lb-inner"><img src="${src}" /><button class="gal-lb-close" title="Fermer">✕</button></div>`;
    lb.addEventListener("click", e => { if (e.target === lb) lb.remove(); });
    lb.querySelector(".gal-lb-close").addEventListener("click", () => lb.remove());
    document.body.appendChild(lb);
  }

  function wireItems(container, isOwner) {
    const fp = fingerprint();

    // Clic image : visiteur avec lien → ouvre le lien (Premium P6) ; sinon lightbox.
    container.querySelectorAll(".gal-item").forEach(item => {
      const img = item.querySelector("img");
      if (!img) return;
      img.addEventListener("click", () => {
        const link = item.dataset.link;
        if (!isOwner && link) { window.open(link, "_blank", "noopener,noreferrer"); return; }
        openLightbox(img.src);
      });
    });

    container.querySelectorAll(".gal-like").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.stopPropagation();
        const id = btn.dataset.id;
        try {
          const r = await host.api(`/api/gallery/${id}/like`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fingerprint: fp }),
          });
          btn.classList.toggle("liked", r.liked);
          btn.querySelector("svg").setAttribute("fill", r.liked ? "currentColor" : "none");
          btn.querySelector(".gal-count").textContent = String(r.likes);
        } catch (err) { host.toast(err.message); }
      });
    });

    if (isOwner) {
      // Définir/retirer le lien cliquable d'une photo (Premium P6).
      container.querySelectorAll(".gal-link").forEach(btn => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const item = btn.closest(".gal-item");
          const id = item.dataset.id;
          const cur = (item.dataset.link || "").replace(/%22/g, '"');
          const url = prompt("Lien cliquable de la photo (https://…, vide pour retirer) :", cur);
          if (url === null) return;
          try {
            const r = await host.api(`/api/gallery/${id}/link`, {
              method: "PATCH",
              headers: { ...host.authHeaders(), "Content-Type": "application/json" },
              body: JSON.stringify({ link_url: url.trim() }),
            });
            item.dataset.link = (r.link_url || "").replace(/"/g, "%22");
            btn.classList.toggle("on", !!r.link_url);
            host.toast(r.link_url ? "Lien enregistré ✓" : "Lien retiré");
          } catch (err) {
            host.toast(err.message === "premium required" ? "Réservé aux comptes Premium." : err.message);
          }
        });
      });
      container.querySelectorAll(".gal-del").forEach(btn => {
        btn.addEventListener("click", async () => {
          const item = btn.closest(".gal-item");
          const id = item.dataset.id;
          try {
            await host.api(`/api/gallery/${id}`, { method: "DELETE", headers: host.authHeaders() });
            item.remove();
          } catch (err) { host.toast(err.message); }
        });
      });
    }
  }

  async function uploadFiles(files, gridEl) {
    const formData = new FormData();
    let count = 0;
    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;
      formData.append("photos", f);
      count++;
      if (count >= 10) break;
    }
    if (!count) return;
    try {
      const r = await host.api("/api/gallery", { method: "POST", headers: host.authHeaders(), body: formData });
      const empty = gridEl.querySelector(".gal-empty");
      if (empty) empty.remove();
      r.photos.forEach(p => {
        const tmp = document.createElement("div");
        tmp.innerHTML = itemHtml({ ...p, liked: false }, true);
        const item = tmp.firstElementChild;
        gridEl.appendChild(item);
        wireItems(item, true);
      });
      host.toast(`${r.photos.length} photo(s) ajoutée(s)`);
    } catch (err) { host.toast(err.message); }
  }

  host.registerPlugin({
    name: "gallery",

    init(host) {
      host.gallery = {
        // Monte la galerie comme une colonne du deck profil. Renvoie true si
        // une colonne a été ajoutée (utilisé pour dimensionner la navigation).
        async mountPublic(slot, handle) {
          if (!slot) return false;
          const fp = fingerprint();
          let photos;
          try {
            const r = await host.api(`/api/gallery/${handle}`, { headers: { "x-fingerprint": fp } });
            photos = r.photos;
          } catch { return false; }
          if (!photos.length) return false;
          slot.innerHTML = `<div class="card pub-section">
            <div class="section-title" style="border-top:none;padding-top:0;margin-top:0">Galerie</div>
            <div class="gal-grid">${gridHtml(photos, false)}</div>
          </div>`;
          wireItems(slot, false);
          return true;
        },
      };
    },

    editorColumns(host, _data) {
      return [{
        order: 45,
        label: "Galerie",
        html: `<div class="card">
          <div class="section-title" style="border-top:none;padding-top:0;margin-top:0">
            Galerie <span class="deg">max 10 photos · publiques</span>
          </div>
          <div class="col-scroll">
            <div class="gal-grid" id="gal-grid"></div>
            <div class="gal-drop" id="gal-drop" style="margin-top:.5rem">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <span>Glissez des images ici</span>
              <label class="btn sm" style="cursor:pointer">Parcourir
                <input type="file" accept="image/*" multiple hidden id="gal-file" />
              </label>
            </div>
            <div style="padding-bottom:.5rem"></div>
          </div>
        </div>`,

        wire(root, data) {
          const gridEl = root.querySelector("#gal-grid");
          const dropEl = root.querySelector("#gal-drop");
          const fileEl = root.querySelector("#gal-file");
          const fp = fingerprint();

          host.api(`/api/gallery/${data.handle}`, { headers: { "x-fingerprint": fp, ...host.authHeaders() } })
            .then(r => { gridEl.innerHTML = gridHtml(r.photos, true); wireItems(gridEl, true); })
            .catch(() => { gridEl.innerHTML = `<p class="gal-empty">Erreur de chargement.</p>`; });

          fileEl.addEventListener("change", () => {
            if (fileEl.files?.length) uploadFiles(fileEl.files, gridEl);
            fileEl.value = "";
          });

          dropEl.addEventListener("dragover", e => { e.preventDefault(); dropEl.classList.add("drag-over"); });
          dropEl.addEventListener("dragleave", () => dropEl.classList.remove("drag-over"));
          dropEl.addEventListener("drop", e => {
            e.preventDefault();
            dropEl.classList.remove("drag-over");
            if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files, gridEl);
          });
        },
      }];
    },
  });
}
