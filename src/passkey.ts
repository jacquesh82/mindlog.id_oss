/**
 * Passkey WebAuthn — enregistrement et authentification.
 *
 * Les challenges en attente sont stockés en mémoire (Map) avec TTL 5 min.
 * Acceptable pour un monolithe ; à externaliser (Redis…) si multi-instance.
 */

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { and, desc, eq } from "drizzle-orm";
import { db } from "./db.js";
import { identities, passkeyCredentials } from "./schema.js";
import { appUrl } from "./mailer.js";
import type { Identity } from "./store.js";

function rpConfig() {
  const base = appUrl();
  const url = new URL(base);
  return { rpName: "mindlog id", rpID: url.hostname, origin: base };
}

// Les transports sont stockés sous forme de JSON (tableau de chaînes) ; on les
// relit en tolérant un contenu invalide (renvoie alors un tableau vide).
function parseTransports(json: string): AuthenticatorTransportFuture[] {
  try {
    return JSON.parse(json) as AuthenticatorTransportFuture[];
  } catch {
    return [];
  }
}

interface PendingChallenge {
  challenge: string;
  expires: number;
}

const regChallenges = new Map<number, PendingChallenge>();
const authChallenges = new Map<string, PendingChallenge>();

const TTL_MS = 5 * 60 * 1000;

function pruneExpired<K>(map: Map<K, PendingChallenge>) {
  const now = Date.now();
  for (const [k, v] of map) if (v.expires < now) map.delete(k);
}

export interface PasskeyCredential {
  id: string;
  identity_id: number;
  public_key: string;
  counter: number;
  device_type: string;
  backed_up: number;
  transports: string;
  name: string;
  created_at: string;
}

export async function getPasskeys(identityId: number): Promise<PasskeyCredential[]> {
  return (await db
    .select()
    .from(passkeyCredentials)
    .where(eq(passkeyCredentials.identity_id, identityId))
    .orderBy(desc(passkeyCredentials.created_at)));
}

export async function deletePasskey(identityId: number, credentialId: string): Promise<void> {
  await db
    .delete(passkeyCredentials)
    .where(and(eq(passkeyCredentials.id, credentialId), eq(passkeyCredentials.identity_id, identityId)));
}

/* ------------------------------ Enregistrement --------------------------- */

export async function beginRegistration(identity: Identity) {
  pruneExpired(regChallenges);
  const { rpName, rpID } = rpConfig();

  const existingPasskeys = await getPasskeys(identity.id);

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: new TextEncoder().encode(String(identity.id)),
    userName: identity.handle,
    userDisplayName: identity.handle,
    attestationType: "none",
    excludeCredentials: existingPasskeys.map((p) => ({
      id: p.id,
      transports: parseTransports(p.transports),
    })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });

  regChallenges.set(identity.id, { challenge: options.challenge, expires: Date.now() + TTL_MS });
  return options;
}

export async function finishRegistration(
  identity: Identity,
  body: RegistrationResponseJSON,
  passkeyName: string
): Promise<PasskeyCredential> {
  const pending = regChallenges.get(identity.id);
  if (!pending || pending.expires < Date.now()) throw new Error("Challenge expiré ou introuvable");
  regChallenges.delete(identity.id);

  const { rpID, origin } = rpConfig();

  const verification = await verifyRegistrationResponse({
    response: body,
    expectedChallenge: pending.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
  });

  if (!verification.verified)
    throw new Error("Vérification passkey échouée");

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  const row = {
    id: credential.id,
    identity_id: identity.id,
    public_key: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    device_type: credentialDeviceType,
    backed_up: credentialBackedUp ? 1 : 0,
    transports: JSON.stringify(credential.transports ?? []),
    name: passkeyName || "Passkey",
  };

  await db.insert(passkeyCredentials).values(row);

  const out = await db
    .select()
    .from(passkeyCredentials)
    .where(eq(passkeyCredentials.id, row.id))
    .limit(1);
  return out[0];
}

/* ------------------------------ Authentification ------------------------- */

export async function beginAuthentication(handle: string) {
  pruneExpired(authChallenges);
  const { rpID } = rpConfig();

  const idRows = await db.select({ id: identities.id }).from(identities).where(eq(identities.handle, handle)).limit(1);
  const identity = idRows.at(0);

  const allowCredentials = identity
    ? (await getPasskeys(identity.id)).map((p) => ({ id: p.id, transports: parseTransports(p.transports) }))
    : [];

  const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred", allowCredentials });

  authChallenges.set(handle, { challenge: options.challenge, expires: Date.now() + TTL_MS });
  return options;
}

export async function finishAuthentication(
  handle: string,
  body: AuthenticationResponseJSON
): Promise<Identity> {
  const pending = authChallenges.get(handle);
  if (!pending || pending.expires < Date.now()) throw new Error("Challenge expiré ou introuvable");
  authChallenges.delete(handle);

  const { rpID, origin } = rpConfig();

  const credRows = await db
    .select()
    .from(passkeyCredentials)
    .where(eq(passkeyCredentials.id, body.id))
    .limit(1);
  const cred = credRows[0] as PasskeyCredential | undefined;
  if (!cred) throw new Error("Passkey inconnue");

  const idRows = await db.select().from(identities).where(eq(identities.id, cred.identity_id)).limit(1);
  const identity = idRows[0] as Identity | undefined;
  if (!identity) throw new Error("Identité introuvable");

  const verification = await verifyAuthenticationResponse({
    response: body,
    expectedChallenge: pending.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
    credential: {
      id: cred.id,
      publicKey: isoBase64URL.toBuffer(cred.public_key),
      counter: cred.counter,
      transports: parseTransports(cred.transports),
    },
  });

  if (!verification.verified) throw new Error("Authentification passkey échouée");

  await db
    .update(passkeyCredentials)
    .set({ counter: verification.authenticationInfo.newCounter })
    .where(eq(passkeyCredentials.id, cred.id));

  return identity;
}
