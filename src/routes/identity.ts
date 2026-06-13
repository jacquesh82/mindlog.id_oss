import { Hono } from "hono";
import type { Context } from "hono";
import { readFileSync, writeFileSync, existsSync, rmSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import {
  StoreError,
  createIdentity,
  getIdentityByHandle,
  searchIdentities,
  getEvents,
  getNotifications,
  unreadCount,
  getFields,
  getRelationsByDegree,
  getIncomingRelations,
  getTags,
  setSettings,
  upsertField,
  deleteField,
  addTag,
  removeTag,
  setPhotoFile,
  deleteIdentity,
  setRecoveryEmail,
  recoverByEmail,
  getOverrides,
  getDirectRelations,
  areContacts,
  hasRelation,
  parseSettings,
  getE2eVault,
  getRequests,
  pendingRequestCount,
  setCoverFile,
  setProfileIntro,
  PROFILE_INTRO_MAX_CHARS,
  type Identity,
  type Settings,
} from "../store.js";
import { isPremium, getSubscription, subscriptionIsPremium, listButtons, getSpaceInfo } from "../premium-api.js";
import { listSessions } from "../session.js";
import { getConversationsFor } from "../messages.js";
import { appUrl, isMailConfigured, sendMail } from "../mailer.js";
import { welcomeEmail, recoveryEmail } from "../emails.js";
import { currentIdentity, readBody, exceeds } from "./_ctx.js";

const route = new Hono();

/* ----------------------------- Cloudflare Turnstile ---------------------- */
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY ?? "";
const TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY ?? "";

// Inclut les sous-domaines `*.localhost` (dev Caddy : id.mindlog.localhost) +
// loopback v4/v6 — pour ces hôtes, Turnstile est désactivé côté serveur.
const isLocalHost = (host: string) =>
  /^([^.\s]+\.)*localhost(:\d+)?$/i.test(host)
  || /^127\.0\.0\.1(:\d+)?$/.test(host)
  || /^\[::1\](:\d+)?$/.test(host);

async function verifyTurnstile(token: string, ip?: string): Promise<boolean> {
  if (!TURNSTILE_SECRET_KEY) return true;
  if (!token) return false;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: TURNSTILE_SECRET_KEY,
        response: token,
        ...(ip ? { remoteip: ip } : {}),
      }),
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

const DATA_DIR = resolve(process.cwd(), "data");

const ALLOWED = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
]);

// Couverture Premium (P4) : images + vidéos courtes.
const COVER_ALLOWED = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["video/mp4", ".mp4"],
  ["video/webm", ".webm"],
]);
const COVER_MAX = 25 * 1024 * 1024; // 25 Mo

// Cache buster : mtime du fichier cover (en ms). Sert de query string `?v=…`
// pour invalider le cache navigateur quand l'image est remplacée par une vidéo
// (ou vice-versa) sous le même nom logique.
function coverVersion(coverFile: string): number {
  try { return Math.floor(statSync(resolve(DATA_DIR, coverFile)).mtimeMs); }
  catch { return 0; }
}

function servePhoto(c: Context, id: Identity | undefined) {
  if (!id?.photo_file) return c.json({ error: "no photo" }, 404);
  const p = resolve(DATA_DIR, id.photo_file);
  if (!existsSync(p)) return c.json({ error: "no photo" }, 404);
  const mime =
    [...ALLOWED.entries()].find(([, e]) => e === extname(p))?.[0] ?? "application/octet-stream";
  c.header("Content-Type", mime);
  c.header("Cache-Control", "no-cache");
  return c.body(readFileSync(p));
}

route.post("/api/identities", async (c) => {
  const body = await readBody<{
    turnstileToken: string;
    handle: string;
    display_name: string;
    email: string;
    autoCreated: boolean;
    ack_adult_content: boolean;
  }>(c);
  if (!body.autoCreated && body.ack_adult_content !== true) {
    return c.json({ error: "Vous devez accepter l'engagement : avatar et image de couverture sans contenu 18+ (seuls médias hébergés par la plateforme)." }, 400);
  }
  if (TURNSTILE_SECRET_KEY && !isLocalHost(c.req.header("host") ?? "")) {
    const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0].trim();
    const ok = await verifyTurnstile(body.turnstileToken ?? "", ip);
    if (!ok) return c.json({ error: "Vérification anti-robot échouée. Merci de réessayer." }, 400);
  }
  try {
    const id = await createIdentity(body.handle ?? "", body.display_name, body.email);
    const base = appUrl();
    const publicUrl = `${base}/@${id.handle}`;
    const privateUrl = `${base}/k/${id.access_key}`;
    // À la création d'une page, on envoie le lien public (à partager) + le lien
    // privé avec la clé (seul accès en écriture). Envoi best-effort.
    if (body.email && isMailConfigured()) {
      void sendMail({ to: body.email, ...(await welcomeEmail(id.handle, privateUrl, publicUrl)) }).catch(() => { /* envoi best-effort */ });
    }
    return c.json(
      {
        handle: id.handle,
        accessKey: id.access_key,
        publicUrl,
        privateUrl,
      },
      201
    );
  } catch (e) {
    if (e instanceof StoreError) return c.json({ error: e.message }, e.status as 400);
    throw e;
  }
});

// Récupération de compte par email en cas de perte de clé.
route.post("/api/recover", async (c) => {
  const { handle, email } = await readBody<{ handle: string; email: string }>(c);
  if (!handle || !email) return c.json({ error: "handle et email requis" }, 400);
  try {
    const r = await recoverByEmail(handle, email);
    const link = `${appUrl()}/k/${r.accessKey}`;
    if (isMailConfigured()) {
      try {
        await sendMail({ to: email, ...(await recoveryEmail(r.handle, link)) });
        return c.json({ sent: true, handle: r.handle });
      } catch {
        return c.json({ sent: false, handle: r.handle, accessKey: r.accessKey, privateUrl: `${appUrl()}/k/${r.accessKey}` });
      }
    }
    return c.json({ sent: false, handle: r.handle, accessKey: r.accessKey, privateUrl: `${appUrl()}/k/${r.accessKey}` });
  } catch (e) {
    if (e instanceof StoreError) return c.json({ error: e.message }, e.status as 400);
    throw e;
  }
});

route.get("/api/search", async (c) => {
  const q = c.req.query("q")?.trim() ?? "";
  if (q.length < 1) return c.json({ results: [] });
  // Capability Premium : la recherche par tags est offerte aux abonnés Premium.
  // Les visiteurs anonymes et comptes free n'ont que handle + display_name.
  const viewer = await currentIdentity(c);
  const includeTags = viewer ? await isPremium(viewer.id) : false;
  return c.json({ results: await searchIdentities(q, 12, { includeTags }) });
});

// Carte publique par handle.
route.get("/api/identities/:handle", async (c) => {
  const id = await getIdentityByHandle(c.req.param("handle"));
  if (!id) return c.json({ error: "not found" }, 404);
  const viewer = await currentIdentity(c);
  const isContact = viewer ? await areContacts(viewer.id, id.id) : false;
  const isRelated = viewer ? await hasRelation(viewer.id, id.id) : false;
  const level: "owner" | "contact" | "public" =
    viewer?.id === id.id ? "owner" : isContact ? "contact" : "public";
  const settings = parseSettings(id.settings);
  const isOwner = viewer?.id === id.id;
  // Les disponibilités ne sont exposées qu'au propriétaire si le profil les masque.
  const showAvail = settings.public_availability || isOwner;
  const overrides = showAvail ? await getOverrides(id.id) : [];
  // Features Premium publiques (P4/P5) : couverture + boutons — uniquement si Premium.
  const premium = await isPremium(id.id);
  const cover =
    premium && id.cover_file
      ? { url: `/api/identities/${encodeURIComponent(id.handle)}/cover?v=${coverVersion(id.cover_file)}`, type: id.cover_type || "image" }
      : null;
  return c.json({
    handle: id.handle,
    fields: await getFields(id.id, level),
    events: await getEvents(id.id, false),
    overrides,
    // Règle de dispo générale (jours/week-end/périodes) ou null si masquée.
    availability: showAvail ? settings.availability : null,
    relations: { 1: await getDirectRelations(id.id) },
    // Tags = customisation Premium : les rendre invisibles publiquement quand
    // le compte n'est plus Premium (fin de trial ou annulation). Les données
    // restent en base, on les ré-affichera dès re-souscription.
    tags: premium ? await getTags(id.id) : [],
    hasPhoto: !!id.photo_file,
    // Intro Markdown du profil (OSS) : visible pour tous, qu'on soit Premium ou non.
    profile_intro_md: id.profile_intro_md || "",
    avatarSize: settings.avatar_size,   // taille publique de l'avatar (cf. pub-av-wrap[data-size])
    avatarShape: settings.avatar_shape, // forme publique : "circle" | "square"
    pubkey: id.pubkey,
    // Statut d'offre, public (sans détails de facturation) : pilote l'affichage
    // des fonctions Premium côté visiteur. La vérité reste serveur.
    plan: premium ? "premium" : "free",
    cover,
    buttons: premium ? await listButtons(id.id) : [],
    // Espace premium publique : prix + statut d'abonnement du viewer + liste
    // des pages publiées. Null si le créateur n'a rien publié et pas de tarif.
    space: premium ? await getSpaceInfo(id.id, viewer?.id ?? null) : null,
    // Dernière connexion (max des sessions) + présence d'une clé dans le coffre E2E.
    lastSeen: (await listSessions(id.id)).reduce((m, s) => (s.lastSeen > m ? s.lastSeen : m), ""),
    hasVault: !!(await getE2eVault(id.id)).vault,
    viewer: viewer ? { handle: viewer.handle, isContact, isRelated } : null,
    // Autorisations exposées au visiteur pour afficher/masquer les actions de contact.
    options: {
      allowChat: settings.allow_chat,
      allowCall: settings.allow_call,
      allowVideo: settings.allow_video,
      allowRequests: settings.allow_requests,
      publicAvailability: settings.public_availability,
    },
    private: false,
  });
});

route.get("/api/identities/:handle/photo", async (c) => {
  const id = await getIdentityByHandle(c.req.param("handle"));
  return servePhoto(c, id);
});

// Couverture personnalisée (Premium P4) : servie seulement si le titulaire est Premium.
route.get("/api/identities/:handle/cover", async (c) => {
  const id = await getIdentityByHandle(c.req.param("handle"));
  if (!id?.cover_file || !(await isPremium(id.id))) return c.json({ error: "no cover" }, 404);
  const p = resolve(DATA_DIR, id.cover_file);
  if (!existsSync(p)) return c.json({ error: "no cover" }, 404);
  const mime = [...COVER_ALLOWED.entries()].find(([, e]) => e === extname(p))?.[0] ?? "application/octet-stream";
  c.header("Content-Type", mime);
  c.header("Cache-Control", "public, max-age=3600");
  return c.body(readFileSync(p));
});

// Upload de la couverture (Premium requis). Accepte image ou vidéo courte.
route.post("/api/cover", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  if (!(await isPremium(id.id))) return c.json({ error: "premium required" }, 402);
  const body = await c.req.parseBody();
  const file = body.cover;
  if (!(file instanceof File)) return c.json({ error: "cover file required" }, 400);
  const ext = COVER_ALLOWED.get(file.type);
  if (!ext) return c.json({ error: "unsupported type" }, 415);
  if (file.size > COVER_MAX) return c.json({ error: "max 25MB" }, 413);
  if (id.cover_file && id.cover_file !== `cover-${id.id}${ext}`) {
    rmSync(resolve(DATA_DIR, id.cover_file), { force: true });
  }
  const name = `cover-${id.id}${ext}`;
  writeFileSync(resolve(DATA_DIR, name), Buffer.from(await file.arrayBuffer()));
  const type = file.type.startsWith("video/") ? "video" : "image";
  await setCoverFile(id.id, name, type);
  return c.json({ ok: true, url: `/api/identities/${encodeURIComponent(id.handle)}/cover`, type });
});

route.delete("/api/cover", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  // Cover = feature Premium. La création est gated en POST ; on gate aussi la
  // suppression pour cohérence (cas DB héritée avec cover_file présent alors
  // que le compte n'est plus Premium → on laisse le serveur refuser explicitement).
  if (!(await isPremium(id.id))) return c.json({ error: "premium required" }, 402);
  if (id.cover_file) {
    try { rmSync(resolve(DATA_DIR, id.cover_file)); } catch { /* ignoré */ }
  }
  await setCoverFile(id.id, null, "");
  return c.json({ ok: true });
});

// Carte privée (résolue par la clé ou le cookie de session)
route.get("/api/me", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  // Abonnement (vue propriétaire) : statut + échéance pour l'écran « Abonnement ».
  const sub = await getSubscription(id.id);
  const premium = subscriptionIsPremium(sub);
  return c.json({
    handle: id.handle,
    accessKey: id.access_key,
    plan: premium ? "premium" : "free",
    subscription: {
      plan: premium ? "premium" : "free",
      status: sub?.status ?? "none",
      premiumUntil: sub?.current_period_end ?? null,
      cancelAtPeriodEnd: !!sub?.cancel_at_period_end,
    },
    fields: await getFields(id.id, true),
    events: await getEvents(id.id, true),
    overrides: await getOverrides(id.id),
    relations: await getRelationsByDegree(id.id, 3),
    incoming: await getIncomingRelations(id.id),
    tags: await getTags(id.id),
    notifications: await getNotifications(id.id),
    unread: await unreadCount(id.id),
    conversations: await getConversationsFor(id),
    hasPubkey: !!id.pubkey,
    hasVault: !!(await getE2eVault(id.id)).vault, // coffre E2E présent → cadenas sur l'avatar
    pubkey: id.pubkey || "",
    requests: await getRequests(id.id),
    pending: await pendingRequestCount(id.id),
    recoveryEmail: id.recovery_email,
    hasPhoto: !!id.photo_file,
    profile_intro_md: id.profile_intro_md || "",
    // Couverture + boutons (vue propriétaire) : renvoyés tels quels pour l'édition ;
    // l'affichage public reste conditionné au statut Premium (cf. route publique).
    cover: id.cover_file
      ? { url: `/api/identities/${encodeURIComponent(id.handle)}/cover?v=${coverVersion(id.cover_file)}`, type: id.cover_type || "image" }
      : null,
    buttons: await listButtons(id.id),
    // Espace premium (vue propriétaire) : tarif, intros, bénéfices opt-in.
    // Indispensable côté éditeur pour décider si la modale agenda propose le
    // type « Live » (data.space.benefits.lives) et afficher l'onglet Premium.
    space: premium ? await getSpaceInfo(id.id, id.id) : null,
    settings: parseSettings(id.settings),
    private: true,
    publicUrl: `/@${id.handle}`,
  });
});

// Mise à jour des préférences (onglet « Options »). N'accepte que des booléens connus.
route.patch("/api/me/settings", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const patch = await readBody<Partial<Settings>>(c);
  const premium = await isPremium(id.id);
  const settings = await setSettings(id.id, patch, { isPremium: premium });
  return c.json({ ok: true, settings });
});

// Export RGPD : toutes les données de l'identité en JSON.
route.get("/api/me/export", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const payload = {
    exported_at: new Date().toISOString(),
    handle: id.handle,
    recovery_email: id.recovery_email,
    fields: await getFields(id.id, true),
    events: await getEvents(id.id, true),
    relations: await getDirectRelations(id.id),
    requests: await getRequests(id.id),
    notifications: await getNotifications(id.id),
  };
  c.header("Content-Type", "application/json");
  c.header("Content-Disposition", `attachment; filename="mindlog-${id.handle}.json"`);
  return c.body(JSON.stringify(payload, null, 2));
});

// Suppression définitive du compte (RGPD droit à l'effacement).
route.delete("/api/me", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  if (id.photo_file) {
    try { rmSync(resolve(DATA_DIR, id.photo_file)); } catch { /* ignoré */ }
  }
  await deleteIdentity(id.id);
  return c.json({ ok: true });
});

// Mise à jour de l'email de récupération (auth par clé).
route.put("/api/recovery-email", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const { email } = await readBody<{ email: string }>(c);
  if (typeof email === "string" && email.length > 200) return c.json({ error: "email trop long" }, 400);
  await setRecoveryEmail(id.id, typeof email === "string" ? email : "");
  return c.json({ ok: true });
});

route.put("/api/card/field", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const body = await readBody<{
    key: string;
    label?: string;
    value?: string;
    is_custom?: boolean;
    is_public?: boolean;
    visibility?: string;
    position?: number;
  }>(c);
  if (!body.key) return c.json({ error: "key required" }, 400);
  if (exceeds([[body.key, 100], [body.label, 200], [body.value, 4000]]))
    return c.json({ error: "champ trop long" }, 400);
  return c.json(await upsertField(id.id, { ...body, key: body.key }));
});

route.delete("/api/card/field/:key", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  return (await deleteField(id.id, c.req.param("key")))
    ? c.json({ ok: true })
    : c.json({ error: "not found" }, 404);
});

// Tags du profil = feature Premium (mots-clés affichés sur /@handle + utilisés
// par la recherche). Mutation gated en POST/DELETE ; la lecture reste ouverte
// (cf. /api/me et /@handle/api).
route.post("/api/tags", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  if (!(await isPremium(id.id))) return c.json({ error: "premium required" }, 402);
  const { tag } = await readBody<{ tag: string }>(c);
  if (typeof tag !== "string") return c.json({ error: "tag required" }, 400);
  try {
    return c.json({ tags: await addTag(id.id, tag) }, 201);
  } catch (e) {
    if (e instanceof StoreError) return c.json({ error: e.message }, e.status as 400);
    throw e;
  }
});

route.delete("/api/tags/:tag", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  if (!(await isPremium(id.id))) return c.json({ error: "premium required" }, 402);
  return (await removeTag(id.id, c.req.param("tag")))
    ? c.json({ ok: true })
    : c.json({ error: "not found" }, 404);
});

// Intro du profil (OSS, 0032) : texte Markdown affiché au-dessus de la bio sur
// /@handle. Ouverte à tous les comptes (free ET Premium). Précédemment hébergée
// par `PUT /api/space/profile-intro` côté Premium, conservé pour back-compat.
route.put("/api/me/profile-intro", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const b = await readBody<{ intro_md?: string }>(c);
  const raw = typeof b.intro_md === "string" ? b.intro_md : "";
  if (raw.length > PROFILE_INTRO_MAX_CHARS) {
    return c.json({ error: `intro trop longue (max ${PROFILE_INTRO_MAX_CHARS} caractères)` }, 400);
  }
  const stored = await setProfileIntro(id.id, raw);
  return c.json({ profile_intro_md: stored });
});

route.post("/api/photo", async (c) => {
  const id = await currentIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req.parseBody();
  const file = body.photo;
  if (!(file instanceof File)) return c.json({ error: "photo file required" }, 400);
  const ext = ALLOWED.get(file.type);
  if (!ext) return c.json({ error: "unsupported type" }, 415);
  if (file.size > 5 * 1024 * 1024) return c.json({ error: "max 5MB" }, 413);

  if (id.photo_file && id.photo_file !== `photo-${id.id}${ext}`) {
    rmSync(resolve(DATA_DIR, id.photo_file), { force: true });
  }
  const name = `photo-${id.id}${ext}`;
  writeFileSync(resolve(DATA_DIR, name), Buffer.from(await file.arrayBuffer()));
  await setPhotoFile(id.id, name);
  return c.json({ ok: true });
});

export default route;
export { servePhoto, ALLOWED, DATA_DIR, TURNSTILE_SITE_KEY };
