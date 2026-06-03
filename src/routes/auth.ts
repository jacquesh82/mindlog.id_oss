import { Hono } from "hono";
import { getCookie, deleteCookie } from "hono/cookie";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import {
  SESSION_COOKIE,
  createSession,
  destroySession,
  destroyAllSessions,
  listSessions,
  currentSessionTokenHash,
  destroySessionByHash,
} from "../session.js";
import {
  beginRegistration,
  finishRegistration,
  beginAuthentication,
  finishAuthentication,
  getPasskeys,
  deletePasskey,
} from "../passkey.js";
import {
  StoreError,
  rotateAccessKey,
  createLoginPin,
  redeemLoginPin,
  getFields,
} from "../store.js";
import { currentIdentity, readBody, setSessionCookie } from "./_ctx.js";

const route = new Hono();

route.post("/api/access-key/rotate", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const accessKey = await rotateAccessKey(id.id);
  // La rotation invalide tout : on révoque les sessions existantes puis on
  // rouvre une session pour cet appareil.
  await destroyAllSessions(id.id);
  const { token, ttlMs } = await createSession(id.id, c.req.header("user-agent"));
  setSessionCookie(c, token, ttlMs);
  return c.json({ accessKey });
});

/* -------------------------------- Passkeys ------------------------------- */

route.get("/api/passkeys", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  return c.json((await getPasskeys(id.id)).map((p) => ({
    id: p.id,
    name: p.name,
    deviceType: p.device_type,
    backedUp: !!p.backed_up,
    createdAt: p.created_at,
  })));
});

route.post("/api/passkeys/register/begin", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  try {
    const options = await beginRegistration(id);
    return c.json(options);
  } catch (e: unknown) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

route.post("/api/passkeys/register/finish", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const { name = "Passkey", response } = await readBody<{
    name: string;
    response: RegistrationResponseJSON;
  }>(c);
  if (!response) return c.json({ error: "Corps JSON manquant" }, 400);
  try {
    const cred = await finishRegistration(id, response, name.slice(0, 64));
    return c.json({ id: cred.id, name: cred.name, createdAt: cred.created_at });
  } catch (e: unknown) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

route.delete("/api/passkeys/:credId", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  await deletePasskey(id.id, c.req.param("credId"));
  return c.json({ ok: true });
});

route.post("/api/passkeys/auth/begin", async (c) => {
  const { handle = "" } = await readBody<{ handle: string }>(c);
  if (!handle) return c.json({ error: "handle requis" }, 400);
  try {
    const options = await beginAuthentication(handle);
    return c.json(options);
  } catch (e: unknown) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

route.post("/api/passkeys/auth/finish", async (c) => {
  const { handle, response } = await readBody<{
    handle: string;
    response: AuthenticationResponseJSON;
  }>(c);
  if (!handle) return c.json({ error: "handle requis" }, 400);
  if (!response) return c.json({ error: "Corps JSON manquant" }, 400);
  try {
    const identity = await finishAuthentication(handle, response);
    const { token, ttlMs } = await createSession(identity.id, c.req.header("user-agent"));
    setSessionCookie(c, token, ttlMs);
    // accessKey : les clients natifs (Android) s'authentifient par clé d'accès, pas
    // par cookie — on la renvoie pour qu'ils la persistent. Le web l'ignore (cookie).
    return c.json({ handle: identity.handle, accessKey: identity.access_key });
  } catch (e: unknown) {
    return c.json({ error: (e as Error).message }, 401);
  }
});

route.get("/api/session", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ authenticated: false });
  const fields = await getFields(id.id, "owner");
  // `||` volontaire : une valeur vide ("") doit être traitée comme absente (null).
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  const displayName = fields.find((f) => f.key === "display_name")?.value || null;
  return c.json({
    authenticated: true,
    handle: id.handle,
    accessKey: id.access_key,
    displayName,
    hasPhoto: !!id.photo_file,
  });
});

// Échange une clé d'accès valide contre une session cookie.
route.post("/api/auth/session-from-key", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const { token, ttlMs } = await createSession(id.id, c.req.header("user-agent"));
  setSessionCookie(c, token, ttlMs);
  return c.json({ ok: true, handle: id.handle });
});

// Génère un code PIN d'appairage (session authentifiée) pour connecter un
// nouvel appareil sans coller la clé d'accès.
route.post("/api/auth/pin", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const { pin, expiresAt } = await createLoginPin(id.id);
  return c.json({ pin, expiresAt });
});

// Échange un code PIN valide contre la clé d'accès (appareil non authentifié).
route.post("/api/auth/redeem-pin", async (c) => {
  const { pin } = await readBody<{ pin: string }>(c);
  try {
    const { accessKey, handle } = await redeemLoginPin(pin ?? "");
    return c.json({ accessKey, handle });
  } catch (e: unknown) {
    const status = e instanceof StoreError ? e.status : 400;
    return c.json({ error: (e as Error).message }, status as 400);
  }
});

route.post("/api/auth/logout", async (c) => {
  await destroySession(getCookie(c, SESSION_COOKIE));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

route.post("/api/auth/logout-all", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  await destroyAllSessions(id.id);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

route.get("/api/sessions", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const currentHash = currentSessionTokenHash(getCookie(c, SESSION_COOKIE));
  const sessions = (await listSessions(id.id)).map((s) => ({
    id: s.tokenHash,
    createdAt: s.createdAt,
    lastSeen: s.lastSeen,
    userAgent: s.userAgent,
    current: s.tokenHash === currentHash,
  }));
  return c.json({ sessions });
});

route.delete("/api/sessions/:id", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const tokenHash = c.req.param("id");
  await destroySessionByHash(id.id, tokenHash);
  if (currentSessionTokenHash(getCookie(c, SESSION_COOKIE)) === tokenHash) {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
  }
  return c.json({ ok: true });
});

export default route;
