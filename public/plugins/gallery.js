/**
 * Plugin Galerie — vitrine publique illimitée, alimentée par le STOCKAGE TIERS
 * du créateur (cf. Compte → Stockage). La galerie liste automatiquement les
 * images du dossier `mindlog/public/gallery/` et permet d'en déposer de
 * nouvelles depuis l'app (envoyées directement vers ce stockage). id.mindlog
 * n'héberge rien : les images sont servies par l'URL publique du fournisseur.
 */
import { deleteObject, listPublicGallery, uploadPublic } from "../premium/storage-client.js";

export default function register(host) {

  function itemHtml(it, owner) {
    const url = String(it.url || "");
    const isVideo = it.kind === "video";
    return `<div class="gal-item" data-url="${url.replace(/"/g, "%22")}" data-kind="${isVideo ? "video" : "image"}" data-key="${(it.key || "").replace(/"/g, "%22")}">
      ${isVideo
        ? `<video src="${url}" muted playsinline preload="metadata"></video>`
        : `<img src="${url}" alt="${(it.name || "").replace(/"/g, "&quot;")}" loading="lazy" />`}
      ${owner && it.key ? `<button type="button" class="gal-del" title="Supprimer">✕</button>` : ""}
    </div>`;
  }

  function openLightbox(url, kind) {
    const lb = document.createElement("div");
    lb.className = "gal-lb";
    lb.innerHTML = `<div class="gal-lb-inner">${
      kind === "video" ? `<video src="${url}" controls autoplay></video>` : `<img src="${url}" />`
    }<button class="gal-lb-close" title="Fermer">✕</button></div>`;
    lb.addEventListener("click", e => { if (e.target === lb) lb.remove(); });
    lb.querySelector(".gal-lb-close").addEventListener("click", () => lb.remove());
    document.body.appendChild(lb);
  }

  function wireItems(container, owner) {
    container.querySelectorAll(".gal-item").forEach(item => {
      const media = item.querySelector("img,video");
      if (media) media.addEventListener("click", () => openLightbox(item.dataset.url.replace(/%22/g, '"'), item.dataset.kind));
      if (owner) {
        item.querySelector(".gal-del")?.addEventListener("click", async (e) => {
          e.stopPropagation();
          const key = (item.dataset.key || "").replace(/%22/g, '"');
          if (!key || !(await host.confirmDialog("Supprimer ce média de ton stockage ?", { ok: "Supprimer", cancel: "Annuler", danger: true }))) return;
          try { await deleteObject(key); item.remove(); host.toast("Média supprimé ✓"); }
          catch (err) { host.toast(err?.message || "Suppression échouée."); }
        });
      }
    });
  }

  async function uploadFiles(files, gridEl, handle) {
    const list = [...(files || [])].filter(f => f.type.startsWith("image/") || f.type.startsWith("video/"));
    if (!list.length) return;
    host.toast(`Envoi de ${list.length} média(s) vers ton stockage…`);
    let ok = 0;
    for (const f of list) {
      try {
        const it = await uploadPublic({ file: f, handle });
        const empty = gridEl.querySelector(".gal-empty");
        if (empty) empty.remove();
        const tmp = document.createElement("div");
        tmp.innerHTML = itemHtml(it, true);
        const node = tmp.firstElementChild;
        gridEl.prepend(node);
        wireItems(node, true);
        ok++;
      } catch (err) {
        host.toast(err?.message === "premium required" ? "Stockage réservé au Premium (Compte → Stockage)." : (err?.message || "Upload échoué."));
      }
    }
    if (ok) host.toast(`${ok} média(s) ajouté(s) ✓`);
  }

  host.registerPlugin({
    name: "gallery",

    init(host) {
      host.gallery = {
        // Vue publique du profil : liste la vitrine depuis le stockage du créateur.
        async mountPublic(slot, handle) {
          if (!slot) return false;
          let items;
          try {
            items = await listPublicGallery(handle);
          } catch { return false; }
          if (!items.length) return false;
          slot.innerHTML = `<div class="card pub-section">
            <div class="section-title" style="border-top:none;padding-top:0;margin-top:0">Galerie</div>
            <div class="gal-grid">${items.map((it) => itemHtml(it, false)).join("")}</div>
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
            Galerie <span class="deg">vitrine · depuis ton stockage</span>
          </div>
          <div class="col-scroll">
            <div class="gal-grid" id="gal-grid"><p class="gal-empty">Chargement…</p></div>
            <div class="gal-drop" id="gal-drop" style="margin-top:.5rem">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <span>Glissez des images/vidéos — envoyées vers votre stockage (illimité)</span>
              <label class="btn sm" style="cursor:pointer">Parcourir
                <input type="file" accept="image/*,video/*" multiple hidden id="gal-file" />
              </label>
            </div>
            <p class="lbl-sm" style="opacity:.7;margin:.3rem 0 .5rem">Vitrine publique. Vos médias vivent dans <b>mindlog/public/gallery/</b> de votre stockage (Compte → Stockage). Rien n'est hébergé par id.mindlog.</p>
          </div>
        </div>`,

        wire(root, data) {
          const gridEl = root.querySelector("#gal-grid");
          const dropEl = root.querySelector("#gal-drop");
          const fileEl = root.querySelector("#gal-file");
          const handle = data.handle;

          listPublicGallery(handle)
            .then(items => {
              gridEl.innerHTML = items.length ? items.map((it) => itemHtml(it, true)).join("") : `<p class="gal-empty">Aucun média. Connecte un stockage (Compte → Stockage) puis ajoute des images.</p>`;
              wireItems(gridEl, true);
            })
            .catch(() => { gridEl.innerHTML = `<p class="gal-empty">Connecte d'abord un stockage tiers (Compte → Stockage).</p>`; });

          fileEl.addEventListener("change", () => {
            if (fileEl.files?.length) uploadFiles(fileEl.files, gridEl, handle);
            fileEl.value = "";
          });
          dropEl.addEventListener("dragover", e => { e.preventDefault(); dropEl.classList.add("drag-over"); });
          dropEl.addEventListener("dragleave", () => dropEl.classList.remove("drag-over"));
          dropEl.addEventListener("drop", e => {
            e.preventDefault();
            dropEl.classList.remove("drag-over");
            if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files, gridEl, handle);
          });
        },
      }];
    },
  });
}
