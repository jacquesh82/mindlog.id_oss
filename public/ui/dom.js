// ui/dom.js — helpers DOM génériques (échappement, toast, dialogues modaux).
// Module autonome (globals navigateur). Extrait verbatim. cf. docs/web-app-split-proposal.md

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function confirmDialog(message, { ok = "Confirmer", cancel = "Annuler", danger = false } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `
      <div class="panel confirm-panel" role="alertdialog" aria-modal="true">
        <p class="confirm-msg">${esc(message)}</p>
        <div class="actions">
          <button type="button" class="btn" id="cf-no">${esc(cancel)}</button>
          <button type="button" class="btn ${danger ? "danger" : "primary"}" id="cf-yes">${esc(ok)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const done = (v) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === "Escape") done(false);
      if (e.key === "Enter") done(true);
    };
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("click", (e) => e.target === overlay && done(false));
    overlay.querySelector("#cf-no").onclick = () => done(false);
    overlay.querySelector("#cf-yes").onclick = () => done(true);
    overlay.querySelector("#cf-yes").focus();
  });
}

export function promptPassphrase(title, { generate = false } = {}) {
  return new Promise((resolve) => {
    const gen = generate
      ? Array.from(crypto.getRandomValues(new Uint8Array(15)))
          .map((b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32])
          .join("")
          .replace(/(.{5})(?=.)/g, "$1-")
      : "";
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `
      <div class="panel" role="dialog" aria-modal="true" style="max-width:440px">
        <button type="button" class="close" id="pp-x" aria-label="Fermer">✕</button>
        <h2>${esc(title)}</h2>
        <p class="sub">Notez-la précieusement : elle déverrouille vos messages sur un nouveau navigateur. Le serveur ne la connaît pas — elle est irrécupérable si perdue.</p>
        <input id="pp-in" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(gen)}" placeholder="phrase secrète (8 caractères min)" style="width:100%" />
        <div class="actions" style="margin-top:1rem">
          <button type="button" class="btn" id="pp-cancel">Annuler</button>
          <button type="button" class="btn primary" id="pp-ok">Valider</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const done = (v) => { overlay.remove(); resolve(v); };
    overlay.querySelector("#pp-x").onclick = () => done(null);
    overlay.querySelector("#pp-cancel").onclick = () => done(null);
    overlay.addEventListener("click", (e) => e.target === overlay && done(null));
    overlay.querySelector("#pp-ok").onclick = () => done(overlay.querySelector("#pp-in").value.trim());
    const inp = overlay.querySelector("#pp-in");
    inp.focus();
    inp.select();
  });
}

export function promptPin(title, { confirm = false, sub = "" } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    const confirmHtml = confirm
      ? `<input id="pin-confirm" type="tel" inputmode="numeric" autocomplete="off" placeholder="Confirmer le code" style="width:100%;margin-top:.5rem;letter-spacing:.2em;font-size:1.3rem;text-align:center" />`
      : "";
    const subText = sub || (confirm
      ? "Choisissez un code PIN (4 chiffres min). Il protège votre clé de chiffrement — ne l'oubliez pas."
      : "Saisissez votre code PIN pour déverrouiller votre clé.");
    overlay.innerHTML = `
      <div class="panel" role="dialog" aria-modal="true" style="max-width:360px">
        <button type="button" class="close" id="pin-x" aria-label="Fermer">✕</button>
        <h2 style="text-align:center">${esc(title)}</h2>
        <p class="sub" style="text-align:center">${esc(subText)}</p>
        <input id="pin-in" type="tel" inputmode="numeric" autocomplete="off" placeholder="Code PIN" style="width:100%;letter-spacing:.2em;font-size:1.5rem;text-align:center" />
        ${confirmHtml}
        <p id="pin-err" class="lbl-sm" style="color:var(--danger);min-height:1.2em;text-align:center;margin-top:.4rem"></p>
        <div class="actions" style="margin-top:.6rem">
          <button type="button" class="btn" id="pin-cancel">Annuler</button>
          <button type="button" class="btn primary" id="pin-ok">Valider</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const done = (v) => { overlay.remove(); resolve(v); };
    const err = (m) => { overlay.querySelector("#pin-err").textContent = m; };
    overlay.querySelector("#pin-x").onclick = () => done(null);
    overlay.querySelector("#pin-cancel").onclick = () => done(null);
    overlay.addEventListener("click", (e) => e.target === overlay && done(null));
    overlay.querySelector("#pin-ok").onclick = () => {
      const val = overlay.querySelector("#pin-in").value.trim();
      if (val.length < 4) { err("Code PIN trop court (4 chiffres min)."); return; }
      if (confirm) {
        const val2 = overlay.querySelector("#pin-confirm").value.trim();
        if (val !== val2) { err("Les codes PIN ne correspondent pas."); return; }
      }
      done(val);
    };
    overlay.querySelector("#pin-in").focus();
  });
}

export function copyText(text) {
  if (navigator.clipboard) return navigator.clipboard.writeText(text).catch(() => _copyFallback(text));
  _copyFallback(text);
}

export function _copyFallback(text) {
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); } catch {}
  document.body.removeChild(ta);
}

export function toast(msg) {
  let t = document.querySelector(".toast");
  if (!t) {
    t = document.createElement("div");
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 1800);
}
