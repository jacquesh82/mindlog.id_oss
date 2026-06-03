/**
 * Web Push (PWA) — tâche B3.
 *
 * Conception alignée sur le modèle E2E « serveur aveugle » : on n'envoie **aucun
 * contenu** dans le push, seulement un « réveil ». Le service worker affiche une
 * notification générique ; à l'ouverture, l'app récupère et déchiffre les messages.
 * On évite ainsi le chiffrement de payload (RFC 8291) et toute fuite côté push.
 *
 * VAPID (RFC 8292) : les clés sont lues depuis l'environnement
 * (`VAPID_PUBLIC_KEY` = point brut base64url ; `VAPID_PRIVATE_KEY` = scalaire d
 * base64url ; `VAPID_SUBJECT` = mailto:). Sans clés configurées, le push est
 * désactivé proprement (comme l'email/Turnstile). Générer une paire :
 * `node scripts/gen-vapid.mjs`.
 */
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "./db.js";
import { pushSubscriptions } from "./schema.js";

const PUB = process.env.VAPID_PUBLIC_KEY ?? "";
const PRIV = process.env.VAPID_PRIVATE_KEY ?? "";
const SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:milo@mindlog.today";

export function pushConfigured(): boolean {
  return !!PUB && !!PRIV;
}

export function vapidPublicKey(): string {
  return PUB;
}

const b64url = (b: Buffer) => b.toString("base64url");
const fromB64url = (s: string) => Buffer.from(s, "base64url");

// Reconstruit la clé privée VAPID (KeyObject) depuis les clés brutes base64url
// (le point public fournit x/y, l'env fournit le scalaire d).
let privKey: crypto.KeyObject | null = null;
function vapidPrivateKey(): crypto.KeyObject {
  if (privKey) return privKey;
  const raw = fromB64url(PUB); // 0x04 || X(32) || Y(32)
  const x = b64url(raw.subarray(1, 33));
  const y = b64url(raw.subarray(33, 65));
  privKey = crypto.createPrivateKey({
    key: { kty: "EC", crv: "P-256", x, y, d: PRIV } as crypto.JsonWebKey,
    format: "jwk",
  });
  return privKey;
}

// JWT VAPID (ES256, signature brute R||S) pour l'en-tête Authorization.
function vapidJwt(aud: string, expSec: number): string {
  const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64url(Buffer.from(JSON.stringify({ aud, exp: expSec, sub: SUBJECT })));
  const signingInput = `${header}.${payload}`;
  const sig = crypto.sign("sha256", Buffer.from(signingInput), {
    key: vapidPrivateKey(),
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${b64url(sig)}`;
}

// Envoie un push SANS payload (réveil) à un endpoint. Best-effort ; renvoie `gone`
// si l'abonnement est expiré (404/410) afin de le purger.
async function sendOne(endpoint: string): Promise<{ ok: boolean; gone: boolean }> {
  const url = new URL(endpoint);
  const aud = `${url.protocol}//${url.host}`;
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  const jwt = vapidJwt(aud, exp);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        TTL: "2419200",
        Authorization: `vapid t=${jwt}, k=${PUB}`,
        "Content-Length": "0",
      },
    });
    return { ok: res.ok, gone: res.status === 404 || res.status === 410 };
  } catch {
    return { ok: false, gone: false };
  }
}

export async function addPushSubscription(
  identityId: number,
  endpoint: string,
  p256dh: string,
  auth: string
): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values({ identity_id: identityId, endpoint, p256dh, auth })
    // Le même endpoint peut se réabonner (autre compte / nouvelles clés) → on rebinde.
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { identity_id: identityId, p256dh, auth },
    });
}

export async function removePushSubscription(identityId: number, endpoint: string): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.identity_id, identityId), eq(pushSubscriptions.endpoint, endpoint)));
}

// Réveille tous les appareils d'une identité (best-effort, sans contenu) et purge
// les abonnements expirés. No-op si le push n'est pas configuré.
export async function pushToIdentity(identityId: number): Promise<void> {
  if (!pushConfigured()) return;
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.identity_id, identityId));
  await Promise.all(
    subs.map(async (s) => {
      const { gone } = await sendOne(s.endpoint);
      if (gone) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
    })
  );
}
