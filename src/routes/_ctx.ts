import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { SESSION_COOKIE, getIdentityBySession } from "../session.js";
import { getIdentityByKey, getIdentityByHandle, addNotification, areContacts, type Identity, type AcceptOutcome } from "../store.js";
import { publish } from "../realtime.js";
import { pushToIdentity } from "../push.js";
import { appUrl, isMailConfigured, sendMail } from "../mailer.js";
import { bookingAcceptedEmail } from "../emails.js";

export const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Un cookie `Secure` est REFUSÉ par le navigateur sur du http:// non-localhost
// (ex. accès LAN via http://192.168.x.x:8787) — il ne serait jamais stocké et la
// session ne s'établirait pas. On se base donc sur le schéma effectif : derrière
// Caddy (prod) `x-forwarded-proto=https` → Secure ; en direct http (localhost ou
// LAN) → pas de Secure, pour que la session fonctionne aussi sur le réseau local.
export const cookieSecure = (c: Context) => {
  const xfProto = c.req.header("x-forwarded-proto")?.split(",")[0].trim();
  if (xfProto) return xfProto === "https";
  return new URL(c.req.url).protocol === "https:";
};

export function setSessionCookie(c: Context, token: string, ttlMs: number) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure(c),
    sameSite: "Lax",
    path: "/",
    maxAge: Math.floor(ttlMs / 1000),
  });
}

export async function currentIdentity(c: Context): Promise<Identity | undefined> {
  // 1) Session par cookie (préférée, non lisible par le JS client).
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const res = await getIdentityBySession(token);
    if (res) {
      // CSRF : pour une mutation authentifiée par cookie (credential ambiant),
      // on exige une provenance même-origine. On accepte l'origine canonique
      // (APP_URL) ET l'origine effective de la requête (schéma + Host vus par le
      // navigateur) — c'est l'invariant anti-CSRF : une attaque cross-site porte
      // l'Origin de l'attaquant, jamais celle de l'app. Ça autorise aussi l'accès
      // LAN (http://192.168.x.x:8787) sans affaiblir la protection.
      if (!SAFE_METHODS.has(c.req.method)) {
        const host = c.req.header("host");
        const proto =
          c.req.header("x-forwarded-proto")?.split(",")[0].trim() ??
          new URL(c.req.url).protocol.replace(/:$/, "");
        const self = host ? `${proto}://${host}` : null;
        const allowed = [appUrl().replace(/\/$/, ""), self].filter(Boolean) as string[];
        const origin = c.req.header("origin")?.replace(/\/$/, "");
        const referer = c.req.header("referer");
        const ok = origin
          ? allowed.includes(origin)
          : !!referer && allowed.some((a) => referer === a || referer.startsWith(a + "/"));
        if (!ok) return undefined;
      }
      if (res.renewedTtlMs) setSessionCookie(c, token, res.renewedTtlMs);
      return res.identity;
    }
  }
  // 2) Clé d'accès : lien privé /k/{clé}, MCP, SSE.
  const key = c.req.header("x-access-key") ?? c.req.query("key");
  return getIdentityByKey(key);
}

/**
 * Lit le corps JSON d'une requête en tolérant l'absence ou un format invalide
 * (renvoie alors un objet vide). Le type `T` décrit les champs attendus ; toutes
 * les clés sont rendues optionnelles car le client n'est pas digne de confiance.
 */
export async function readBody<T extends Record<string, unknown>>(c: Context): Promise<Partial<T>> {
  try {
    const data: unknown = await c.req.json();
    return data as Partial<T>;
  } catch {
    return {};
  }
}

/**
 * Renvoie true si l'une des valeurs string dépasse sa longueur max. Sert de
 * garde-fou anti-abus côté API (le store applique aussi ses propres règles).
 */
export function exceeds(checks: [unknown, number][]): boolean {
  return checks.some(([v, max]) => typeof v === "string" && v.length > max);
}

// Crée une notification persistante ET la pousse en temps réel (SSE).
export async function notify(identityId: number, type: string, text: string, link: string | null = null) {
  await addNotification(identityId, type, text, link);
  publish(identityId, "notif", { type, text, link, created_at: new Date().toISOString() });
  // Réveil Web Push (best-effort, SANS contenu) pour les appareils PWA hors onglet.
  void pushToIdentity(identityId).catch(() => { /* push best-effort */ });
}

// Vérifie que deux identités sont contacts mutuels (helper partagé messaging + e2e).
export async function chatPeers(c: Context): Promise<{ me: Identity; other: Identity } | null> {
  const me = await currentIdentity(c);
  const handle = c.req.param("handle");
  if (!me || !handle) return null;
  const other = await getIdentityByHandle(handle);
  if (!other || !(await areContacts(me.id, other.id))) return null;
  return { me, other };
}

// Effets de bord d'une acceptation de RDV : notifie le demandeur (in-app + email).
// Le chat étant chiffré E2E, aucun message n'est posté côté serveur — on renvoie
// vers la conversation via la notification et l'email.
export async function afterAccept(byHandle: string, r: AcceptOutcome) {
  const requester = r.requester;
  if (!requester) return;
  const link = `/@${byHandle}`;
  await notify(requester.id, "request", `@${byHandle} a accepté votre demande de RDV`, link);
  if (requester.recovery_email && isMailConfigured()) {
    const magicLink = r.accessKey ? `${appUrl()}/k/${r.accessKey}` : undefined;
    void sendMail({
      to: requester.recovery_email,
      ...(await bookingAcceptedEmail(byHandle, { day: r.request?.day ?? null, isNew: !!r.requesterIsNew, magicLink })),
    }).catch(() => { /* envoi best-effort */ });
  }
}
