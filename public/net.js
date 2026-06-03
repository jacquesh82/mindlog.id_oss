/* ======================================================================== *
 * net.js — couche réseau + en-têtes d'auth (générique, partagée).
 *
 * Helpers HTTP universels utilisés par app.js ET les modules crypto.
 * Aucune dépendance (feuille). cf. docs/web-crypto-modules.md.
 * ======================================================================== */

// Clé d'accès courante. En mode cookie de session elle est null et l'auth passe
// par le cookie ; en mode lien /k/{clé} on envoie l'en-tête x-access-key.
// app.js détient la source de vérité (`KEY`) et appelle setAccessKey() à chaque
// (ré)authentification pour refléter la valeur ici.
let _accessKey = null;
export function setAccessKey(k) { _accessKey = k || null; }

export const authHeaders = () => (_accessKey ? { "x-access-key": _accessKey } : {});
export const jsonAuth = () => ({ "Content-Type": "application/json", ...authHeaders() });

export async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  const data = res.status === 204 ? null : await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || res.statusText);
  return data;
}
