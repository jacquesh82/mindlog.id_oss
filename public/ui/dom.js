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
    const ppSubmit = () => done(overlay.querySelector("#pp-in").value.trim());
    overlay.querySelector("#pp-ok").onclick = ppSubmit;
    const inp = overlay.querySelector("#pp-in");
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); ppSubmit(); }
      if (e.key === "Escape") done(null);
    });
    inp.focus();
    inp.select();
  });
}

export function promptPin(title, { confirm = false, sub = "" } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    const confirmHtml = confirm
      ? `<div class="group">
          <label for="pin-confirm">Confirmer le code</label>
          <input id="pin-confirm" class="pin-input" type="tel" inputmode="numeric" autocomplete="off" placeholder="••••" />
        </div>`
      : "";
    const subText = sub || (confirm
      ? "Choisissez un code PIN (4 chiffres min). Il protège votre clé de chiffrement — ne l'oubliez pas."
      : "Saisissez votre code PIN pour déverrouiller votre clé.");
    overlay.innerHTML = `
      <div class="panel" role="dialog" aria-modal="true" aria-labelledby="pin-title" style="max-width:360px">
        <button type="button" class="close" id="pin-x" aria-label="Fermer">✕</button>
        <h2 id="pin-title">${esc(title)}</h2>
        <p class="sub">${esc(subText)}</p>
        <div class="group">
          <label for="pin-in">Code PIN</label>
          <input id="pin-in" class="pin-input" type="tel" inputmode="numeric" autocomplete="off" placeholder="••••" />
        </div>
        ${confirmHtml}
        <p id="pin-err" class="err" role="alert"></p>
        <div class="actions">
          <button type="button" class="btn" id="pin-cancel">Annuler</button>
          <button type="button" class="btn primary" id="pin-ok">Valider</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const done = (v) => { overlay.remove(); resolve(v); };
    const err = (m, focusSel) => {
      overlay.querySelector("#pin-err").textContent = m;
      overlay.querySelector(focusSel)?.focus(); // ramène le focus sur le champ fautif (a11y)
    };
    overlay.querySelector("#pin-x").onclick = () => done(null);
    overlay.querySelector("#pin-cancel").onclick = () => done(null);
    overlay.addEventListener("click", (e) => e.target === overlay && done(null));
    const submit = () => {
      const val = overlay.querySelector("#pin-in").value.trim();
      if (val.length < 4) { err("Code PIN trop court (4 chiffres min).", "#pin-in"); return; }
      if (confirm) {
        const val2 = overlay.querySelector("#pin-confirm").value.trim();
        if (val !== val2) { err("Les codes PIN ne correspondent pas.", "#pin-confirm"); return; }
      }
      done(val);
    };
    overlay.querySelector("#pin-ok").onclick = submit;
    overlay.querySelectorAll("#pin-in, #pin-confirm").forEach((inp) => {
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); submit(); }
        if (e.key === "Escape") done(null);
      });
    });
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
