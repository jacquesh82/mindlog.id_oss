// ui/modals.js — modales E2E (coffre backup/restore, récupération de clé) +
// numéro de sécurité (anti-MITM). Pilotées par callbacks (onDone/onChange).
// Extrait verbatim de app.js. cf. docs/web-app-split-proposal.md
import { ensureE2E } from "../crypto/e2e.js";
import { E2E } from "../crypto/state.js";
import { e2eRestoreVault, e2eSaveVault, e2eVaultGet } from "../crypto/vault.js";
import { groupDigits, safetyNumber, sha256hex, verifyClear, verifyGet, verifyPut } from "../crypto/verify.js";
import { api, authHeaders } from "../net.js";
import { esc, promptPassphrase, promptPin, toast } from "./dom.js";
import { icon } from "./icons.js";

export async function openE2eBackup(handle, accessKey, onDone, opts = {}) {
  await ensureE2E(handle, accessKey);
  const mandatory = !!opts.mandatory;
  // Une passkey est-elle enregistrée sur ce compte ? (chemin PRF « 1 geste »)
  let hasPasskey = false;
  if (window.PublicKeyCredential) {
    try {
      const o = await api("/api/passkeys/auth/begin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle }),
      });
      hasPasskey = !!(o.allowCredentials && o.allowCredentials.length);
    } catch {}
  }
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="panel" role="dialog" aria-modal="true" style="max-width:400px">
      ${mandatory ? "" : `<button type="button" class="close" id="eb-x" aria-label="Fermer">✕</button>`}
      <h2>${mandatory ? "Sécurise ta clé de chiffrement 🔐" : "Sauvegarder ma clé de chiffrement"}</h2>
      <p class="sub">${mandatory
        ? "Avant d'activer la messagerie, protège ta clé : sans elle, tes messages chiffrés seraient <strong>définitivement perdus</strong> si tu changes d'appareil ou vides ton navigateur. <strong>Cette étape est obligatoire.</strong>"
        : "Choisissez comment protéger votre clé pour la restaurer sur un autre appareil."}</p>
      <div style="display:flex;flex-direction:column;gap:.6rem">
        ${hasPasskey ? `<button type="button" class="btn primary" id="eb-passkey">${icon("shield", 15)} Ma passkey <span class="lbl-sm" style="opacity:.7">&nbsp;— un seul geste</span></button>` : ""}
        <button type="button" class="btn${hasPasskey ? "" : " primary"}" id="eb-pin">${icon("lock", 15)} Code PIN <span class="lbl-sm" style="opacity:.7">&nbsp;— plus simple</span></button>
        <button type="button" class="btn" id="eb-pass">${icon("key", 15)} Phrase secrète <span class="lbl-sm" style="opacity:.7">&nbsp;— plus sûr</span></button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  if (!mandatory) {
    overlay.querySelector("#eb-x").onclick = close;
    overlay.addEventListener("click", (e) => e.target === overlay && close());
  }

  overlay.querySelector("#eb-passkey")?.addEventListener("click", async () => {
    try {
      await e2eSaveVault(handle, accessKey, "passkey");
      close();
      toast("🔒 Clé sécurisée avec ta passkey ✓");
      onDone?.();
    } catch (e) {
      toast(e.message || "Passkey indisponible — essaie un code PIN ou une phrase secrète.");
    }
  });

  overlay.querySelector("#eb-pin").addEventListener("click", async () => {
    if (!mandatory) close();
    const pin = await promptPin("Choisir un code PIN", { confirm: true });
    if (!pin) return;
    try {
      await e2eSaveVault(handle, accessKey, "pin", pin);
      close();
      toast("Clé sauvegardée ✓ — restaurable avec votre code PIN.");
      onDone?.();
    } catch (e) {
      toast(e.message || "Sauvegarde impossible");
    }
  });

  overlay.querySelector("#eb-pass").addEventListener("click", async () => {
    if (!mandatory) close();
    const pass = await promptPassphrase("Sauvegarder ma clé de chiffrement", { generate: true });
    if (!pass) return;
    try {
      await e2eSaveVault(handle, accessKey, "passphrase", pass);
      close();
      toast("Clé sauvegardée ✓ — restaurable sur vos autres appareils.");
      onDone?.();
    } catch (e) {
      toast(e.message || "Sauvegarde impossible");
    }
  });
}

export async function openKeyRecovery(handle, accessKey, onDone) {
  const r = await e2eVaultGet(accessKey).catch(() => null);
  const hasVault = !!r?.vault;
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="panel" role="dialog" aria-modal="true" style="max-width:460px">
      <button type="button" class="close" id="kr-x" aria-label="Fermer">✕</button>
      <h2>Message illisible — récupérer la clé 🔑</h2>
      <p class="sub">Ce message a été chiffré avec une clé que <strong>cet appareil ne possède pas</strong>. Voici comment la retrouver.</p>
      <ol style="font-size:.86rem;line-height:1.6;padding-left:1.2rem;margin:.2rem 0 1rem">
        <li><strong>Restaurez vos clés depuis le coffre.</strong> ${hasVault ? "Un coffre existe : si la clé y a été sauvegardée depuis un autre appareil, elle reviendra ici." : "Aucun coffre n'est encore configuré sur ce compte — passez à l'étape&nbsp;2."}</li>
        <li><strong>Sinon, ouvrez mindlog sur l'appareil d'origine</strong> (celui qui a reçu ces messages), allez dans <em>Options&nbsp;› Sécurité</em> et sauvegardez votre clé dans le coffre. Revenez ensuite ici et restaurez.</li>
      </ol>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap">
        ${hasVault ? `<button type="button" class="btn primary" id="kr-restore">${icon("download", 15)} Restaurer depuis le coffre</button>` : ""}
        <button type="button" class="btn" id="kr-later">Plus tard</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector("#kr-x").onclick = close;
  overlay.querySelector("#kr-later").onclick = close;
  overlay.addEventListener("click", (e) => e.target === overlay && close());
  overlay.querySelector("#kr-restore")?.addEventListener("click", () => {
    close();
    openE2eRestore(handle, accessKey, onDone);
  });
}

export async function openE2eRestore(handle, accessKey, onDone) {
  const r = await e2eVaultGet(accessKey);
  if (!r?.vault) { toast("Aucune clé sauvegardée sur ce compte."); return; }
  const v = JSON.parse(r.vault);
  const pinLockedUntil = r.pin_locked_until ? new Date(r.pin_locked_until) : null;
  const pinLocked = pinLockedUntil && pinLockedUntil > new Date();
  const pinLockMsg = pinLocked
    ? `Code PIN verrouillé jusqu'à ${pinLockedUntil.toLocaleTimeString()}.`
    : "";
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="panel" role="dialog" aria-modal="true" style="max-width:440px">
      <button type="button" class="close" id="er-x" aria-label="Fermer">✕</button>
      <h2>Restaurer mes clés 🔑</h2>
      <p class="sub">Récupérez votre clé de chiffrement pour relire vos messages sur ce navigateur.</p>
      <div style="display:flex;flex-direction:column;gap:.5rem">
        ${v.prf ? `<button type="button" class="btn primary" id="er-passkey">${icon("shield", 15)} Avec ma passkey</button>` : ""}
        ${v.pin ? `<button type="button" class="btn${pinLocked ? " disabled" : ""}" id="er-pin" ${pinLocked ? "disabled" : ""}>${icon("lock", 15)} Avec mon code PIN${pinLocked ? " 🔒" : ""}</button>` : ""}
        ${v.pass ? `<button type="button" class="btn" id="er-pass">${icon("key", 15)} Avec ma passphrase</button>` : ""}
      </div>
      <p class="lbl-sm" id="er-err" style="color:var(--danger);margin-top:.6rem;min-height:1em">${esc(pinLockMsg)}</p>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  const err = (m) => (overlay.querySelector("#er-err").textContent = m);
  overlay.querySelector("#er-x").onclick = close;
  overlay.addEventListener("click", (e) => e.target === overlay && close());
  overlay.querySelector("#er-passkey")?.addEventListener("click", async () => {
    err("");
    try {
      if (!(await e2eRestoreVault(handle, accessKey, "passkey")))
        throw new Error("Échec : passkey non reconnue ou PRF indisponible ici.");
      toast("Clés restaurées ✓");
      close();
      onDone && onDone();
      setTimeout(() => location.reload(), 400);
    } catch (e) { err(e.message || "Échec"); }
  });
  overlay.querySelector("#er-pin")?.addEventListener("click", async () => {
    const pin = await promptPin("Code PIN");
    if (!pin) return;
    err("");
    try {
      const ok = await e2eRestoreVault(handle, accessKey, "pin", pin);
      if (!ok) {
        const res = await api("/api/e2e/vault/pin-fail", { method: "POST", headers: authHeaders() });
        const until = res.locked_until ? new Date(res.locked_until).toLocaleTimeString() : null;
        throw new Error(until ? `Code PIN incorrect. Verrouillé jusqu'à ${until}.` : "Code PIN incorrect.");
      }
      await api("/api/e2e/vault/pin-success", { method: "POST", headers: authHeaders() });
      toast("Clés restaurées ✓");
      close();
      onDone && onDone();
      setTimeout(() => location.reload(), 400);
    } catch (e) { err(e.message || "Échec"); }
  });
  overlay.querySelector("#er-pass")?.addEventListener("click", async () => {
    const pass = await promptPassphrase("Votre passphrase de secours");
    if (!pass) return;
    err("");
    try {
      if (!(await e2eRestoreVault(handle, accessKey, "passphrase", pass)))
        throw new Error("Passphrase incorrecte.");
      toast("Clés restaurées ✓");
      close();
      onDone && onDone();
      setTimeout(() => location.reload(), 400);
    } catch (e) { err(e.message || "Échec"); }
  });
}

export async function openSafetyNumber(myHandle, peerHandle, peerPubStr, onChange) {
  const myPub = E2E.pubStr;
  if (!myPub || !peerPubStr) { toast("Clés indisponibles pour la vérification."); return; }
  const sn = await safetyNumber(myHandle, myPub, peerHandle, peerPubStr);
  const hash = await sha256hex(sn);
  const status = await verifyGet(peerHandle);
  let verified = status.safety === hash;
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="panel" role="dialog" aria-modal="true" aria-labelledby="sn-title" style="max-width:460px">
      <button type="button" class="close" id="sn-close" aria-label="Fermer">✕</button>
      <h2 id="sn-title">Vérifier @${esc(peerHandle)} 🔒</h2>
      <p class="sub">Comparez ce numéro avec @${esc(peerHandle)} (en personne, appel, ou scan du QR). S'ils sont identiques, personne ne peut intercepter vos messages.</p>
      <div class="qr-box" id="sn-qr" style="display:flex;justify-content:center;margin:.5rem 0"></div>
      <pre class="sn-digits" style="font-size:1.05rem;letter-spacing:.04em;text-align:center;white-space:pre-wrap;word-break:break-word;margin:.5rem 0">${esc(groupDigits(sn))}</pre>
      <p class="sub" id="sn-state"></p>
      <div class="actions" style="margin-top:1rem">
        <button type="button" class="btn" id="sn-clear">Retirer</button>
        <button type="button" class="btn primary" id="sn-verify">Marquer comme vérifié</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => e.target === overlay && close());
  overlay.querySelector("#sn-close").addEventListener("click", close);
  if (window.QRCode) {
    new window.QRCode(overlay.querySelector("#sn-qr"), {
      text: "mindlog-sn-v1:" + sn, width: 180, height: 180,
      colorDark: "#0f1115", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.M,
    });
  }
  const renderState = () => {
    const el = overlay.querySelector("#sn-state");
    el.textContent = verified ? "✓ Vérifié." : "Non vérifié.";
    el.style.color = verified ? "var(--success)" : "var(--muted)";
    overlay.querySelector("#sn-verify").style.display = verified ? "none" : "";
    overlay.querySelector("#sn-clear").style.display = verified ? "" : "none";
  };
  renderState();
  overlay.querySelector("#sn-verify").addEventListener("click", async () => {
    try { await verifyPut(peerHandle, hash); verified = true; renderState(); onChange && onChange(); }
    catch (e) { toast(e.message || "Échec"); }
  });
  overlay.querySelector("#sn-clear").addEventListener("click", async () => {
    try { await verifyClear(peerHandle); verified = false; renderState(); onChange && onChange(); }
    catch (e) { toast(e.message || "Échec"); }
  });
}
