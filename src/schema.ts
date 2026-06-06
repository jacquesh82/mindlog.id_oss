/**
 * Schéma Drizzle (dialecte PostgreSQL).
 *
 * Un seul schéma sert la prod (node-postgres) ET les tests (PGlite, Postgres
 * en WASM) : PGlite parle le même dialecte, donc aucune divergence.
 *
 * Conventions héritées de l'ancienne base SQLite, conservées pour limiter le
 * churn applicatif :
 *  - les booléens sont des `integer` 0/1 (le code compare `=== 1`, `read = 0`…) ;
 *  - les horodatages sont des `text` ISO-8601 UTC (tri lexicographique =
 *    chronologique ; le client reçoit des chaînes comme avant). Le défaut est
 *    posé au niveau applicatif via `$defaultFn`.
 */
import { sql } from "drizzle-orm";
import { check, integer, pgTable, primaryKey, real, serial, text, index, unique } from "drizzle-orm/pg-core";

const nowIso = () => new Date().toISOString();

export const identities = pgTable("identities", {
  id: serial("id").primaryKey(),
  handle: text("handle").notNull().unique(),
  access_key: text("access_key").notNull().unique(),
  photo_file: text("photo_file"),
  // Couverture personnalisée (Premium, P4) : fichier + type ('image' | 'video').
  cover_file: text("cover_file"),
  cover_type: text("cover_type").notNull().default(""),
  recovery_email: text("recovery_email").notNull().default(""),
  pubkey: text("pubkey").notNull().default(""), // clé publique E2E (ECDH)
  // Préférences du compte (onglet « Options ») au format JSON. Voir DEFAULT_SETTINGS
  // dans store.ts : autorisations chat/appel/vidéo/RDV, visibilité des dispos…
  settings: text("settings").notNull().default("{}"),
  created_at: text("created_at").notNull().$defaultFn(nowIso),
});

// ── Abonnement Premium (P1, cf. docs/premium-offer-plan.md) ───────────────
// Une ligne par identité (PK = identity_id). Source de vérité = le prestataire
// (Stripe), reflétée ici par les webhooks. L'entitlement effectif se calcule via
// `isPremium()` (src/store/subscriptions.ts) — jamais côté client.
export const subscriptions = pgTable(
  "subscriptions",
  {
    identity_id: integer("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("stripe"),
    customer_id: text("customer_id").notNull().default(""), // ex. Stripe customer
    subscription_id: text("subscription_id").notNull().default(""), // ex. Stripe subscription
    // none | incomplete | trialing | active | past_due | canceled
    status: text("status").notNull().default("none"),
    price_id: text("price_id").notNull().default(""),
    current_period_end: text("current_period_end"), // iso, null si inconnu
    cancel_at_period_end: integer("cancel_at_period_end").notNull().default(0),
    updated_at: text("updated_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    primaryKey({ columns: [t.identity_id] }),
    index("idx_sub_customer").on(t.customer_id),
    index("idx_sub_subscription").on(t.subscription_id),
  ]
);

// Idempotence des webhooks (P9) : un event prestataire n'est appliqué qu'une fois
// (Stripe peut re-livrer). PK = identifiant d'événement.
export const billingEvents = pgTable("billing_events", {
  event_id: text("event_id").primaryKey(),
  type: text("type").notNull().default(""),
  created_at: text("created_at").notNull().$defaultFn(nowIso),
});

// ── Marketplace page payante (P7, Stripe Connect) ─────────────────────────
// Compte connecté du créateur (reçoit les paiements, commission plateforme 30 %).
export const connectAccounts = pgTable(
  "connect_accounts",
  {
    identity_id: integer("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    stripe_account_id: text("stripe_account_id").notNull().default(""),
    charges_enabled: integer("charges_enabled").notNull().default(0),
    payouts_enabled: integer("payouts_enabled").notNull().default(0),
    updated_at: text("updated_at").notNull().$defaultFn(nowIso),
  },
  (t) => [primaryKey({ columns: [t.identity_id] }), index("idx_connect_account").on(t.stripe_account_id)]
);

// Page premium d'un créateur. Depuis l'introduction de l'« espace premium »
// (0025), l'accès n'est PAS facturé par page — il l'est par abonnement mensuel
// à l'espace du créateur (cf. `premiumSpace` + `spaceSubscriptions`). Le champ
// `type` détermine la mise en forme et la lecture du `content` :
//   - markdown : `content` = texte MD brut.
//   - gallery  : `content` = JSON `{ items: [{ url, kind, caption? }] }`.
//   - link     : `content` = JSON `{ url, note? }`.
//   - file     : `content` = JSON `{ url, name, size }`.
// `price_cents`/`currency` sont conservés pour compat (legacy one-shot) mais ne
// sont plus exposés en UI : le prix vit côté `premium_space.price_cents`.
export const paidPages = pgTable(
  "paid_pages",
  {
    id: serial("id").primaryKey(),
    identity_id: integer("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    type: text("type").notNull().default("markdown"),
    content: text("content").notNull().default(""),
    price_cents: integer("price_cents").notNull().default(0),
    currency: text("currency").notNull().default("eur"),
    published: integer("published").notNull().default(0),
    created_at: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [unique("uq_paid_page_slug").on(t.identity_id, t.slug), index("idx_paid_pages_identity").on(t.identity_id)]
);

// Accès direct à une page (legacy P7 one-shot). Conservé pour les achats
// historiques ; les nouveaux accès passent par `spaceSubscriptions`.
export const pageAccess = pgTable(
  "page_access",
  {
    id: serial("id").primaryKey(),
    page_id: integer("page_id")
      .notNull()
      .references(() => paidPages.id, { onDelete: "cascade" }),
    buyer_identity_id: integer("buyer_identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"),
    granted_at: text("granted_at").notNull().$defaultFn(nowIso),
  },
  (t) => [unique("uq_page_access").on(t.page_id, t.buyer_identity_id)]
);

// Tarif et état Stripe de l'espace premium d'un créateur. `active=1` signifie
// que `stripe_price_id` est créé chez Stripe et que l'espace peut être vendu.
// 1 ligne par identité (le créateur). Le prix s'applique à tout l'espace —
// l'accès débloque l'intégralité des pages premium publiées du créateur.
export const premiumSpace = pgTable(
  "premium_space",
  {
    identity_id: integer("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    price_cents: integer("price_cents").notNull().default(0),
    currency: text("currency").notNull().default("eur"),
    stripe_product_id: text("stripe_product_id").notNull().default(""),
    stripe_price_id: text("stripe_price_id").notNull().default(""),
    active: integer("active").notNull().default(0),
    // Texte Markdown introductif affiché en haut de /@handle/space (rendu HTML).
    intro_md: text("intro_md").notNull().default(""),
    // Idem pour la page publique /@handle (rendu dans la zone bio).
    profile_intro_md: text("profile_intro_md").notNull().default(""),
    // JSON {chat,call,pages,rdv,lives}. Chaque clé true ⇒ l'avantage est offert
    // aux abonnés du space — pour chat/call, cela impose un gating server-side :
    // les non-abonnés ne peuvent ni écrire ni appeler. Lecture via parseBenefits().
    benefits: text("benefits").notNull().default(""),
    updated_at: text("updated_at").notNull().$defaultFn(nowIso),
  },
  (t) => [primaryKey({ columns: [t.identity_id] })]
);

// Abonnement d'un visiteur à l'espace premium d'un créateur. Source de vérité =
// Stripe (reflété par webhook). L'entitlement effectif se calcule via
// `hasActiveSpaceSubscription()` (store/premiumSpace.ts).
export const spaceSubscriptions = pgTable(
  "space_subscriptions",
  {
    id: serial("id").primaryKey(),
    owner_identity_id: integer("owner_identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    subscriber_identity_id: integer("subscriber_identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("stripe"),
    stripe_subscription_id: text("stripe_subscription_id").notNull().default(""),
    // none | incomplete | trialing | active | past_due | canceled
    status: text("status").notNull().default("none"),
    current_period_end: text("current_period_end"),
    cancel_at_period_end: integer("cancel_at_period_end").notNull().default(0),
    created_at: text("created_at").notNull().$defaultFn(nowIso),
    updated_at: text("updated_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    unique("uq_space_sub").on(t.owner_identity_id, t.subscriber_identity_id),
    index("idx_space_sub_owner").on(t.owner_identity_id),
    index("idx_space_sub_subscriber").on(t.subscriber_identity_id),
    index("idx_space_sub_stripe").on(t.stripe_subscription_id),
  ]
);

// ── Lives Premium (P9, mesh WebRTC) ───────────────────────────────────────
// Un stream live = 1 broadcaster + N viewers reliés en mesh BitTorrent-style.
// Le serveur ne stocke que les métadonnées du stream (manifeste signé, clé
// symétrique chiffrée pour l'owner) et le roster volatile des peers connectés.
// AUCUN media ne transite par le serveur. La clé `Ks` n'est livrée aux abonnés
// que via la voie E2E (chiffrée à la volée à la souscription).
export const liveStreams = pgTable(
  "live_streams",
  {
    id: text("id").primaryKey(), // uuid client
    owner_identity_id: integer("owner_identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    broadcaster_pub: text("broadcaster_pub").notNull().default(""), // Ed25519 pub du broadcaster
    manifest_json: text("manifest_json").notNull().default(""), // manifeste signé (codec, qualités…)
    key_wrap_json: text("key_wrap_json").notNull().default(""), // {Ks chiffré, métadonnées}
    epoch: integer("epoch").notNull().default(0), // rotation Ks
    status: text("status").notNull().default("live"), // live | ended
    started_at: text("started_at").notNull().$defaultFn(nowIso),
    ended_at: text("ended_at"),
  },
  (t) => [
    index("idx_live_streams_owner").on(t.owner_identity_id, t.started_at),
    index("idx_live_streams_status").on(t.status),
  ]
);

// Roster volatile du swarm : chaque peer maintient sa présence par heartbeat.
// `last_seen` < now - 30 s → considéré offline et écarté du roster servi aux
// nouveaux entrants. Le score (0..100) est mesuré par le client et permet
// d'éviter de proposer les peers dégradés comme seeds aux autres.
export const liveSwarmMembers = pgTable(
  "live_swarm_members",
  {
    stream_id: text("stream_id")
      .notNull()
      .references(() => liveStreams.id, { onDelete: "cascade" }),
    identity_id: integer("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    device_id: text("device_id").notNull(),
    role: text("role").notNull().default("viewer"), // broadcaster | viewer
    score: integer("score").notNull().default(50),
    joined_at: text("joined_at").notNull().$defaultFn(nowIso),
    last_seen: text("last_seen").notNull().$defaultFn(nowIso),
  },
  (t) => [
    primaryKey({ columns: [t.stream_id, t.device_id] }),
    index("idx_live_members_stream").on(t.stream_id, t.last_seen),
    index("idx_live_members_identity").on(t.identity_id),
  ]
);

// ── Multi-appareils E2E (P0, cf. docs/multidevice-proposal.md) ────────────
// Un compte (identité) peut lier plusieurs appareils, chacun avec sa PROPRE clé
// E2E. L'enrôlement d'un nouvel appareil doit être APPROUVÉ par un appareil déjà
// actif (`approved=1`) — pas d'auto-enrôlement via la seule clé d'accès. Le
// chiffrement devient per-appareil (fan-out à l'envoi). Limite : 5 appareils/compte.
export const devices = pgTable(
  "devices",
  {
    id: serial("id").primaryKey(),
    identity_id: integer("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    device_id: text("device_id").notNull(), // UUID stable généré par le client
    e2e_pubkey: text("e2e_pubkey").notNull(), // clé publique E2E de CET appareil (JWK)
    name: text("name").notNull().default(""),
    approved: integer("approved").notNull().default(0), // 1 après approbation par un appareil existant
    created_at: text("created_at").notNull().$defaultFn(nowIso),
    last_seen: text("last_seen"),
    revoked_at: text("revoked_at"), // NULL = actif
  },
  (t) => [
    index("idx_devices_identity").on(t.identity_id),
    unique("uq_devices_identity_device").on(t.identity_id, t.device_id),
  ]
);

// Coffre de clé E2E (escrow) : la clé PRIVÉE ECDH, chiffrée côté client, rendue
// portable entre navigateurs. Le serveur ne stocke qu'un JSON OPAQUE (blobs
// AES-GCM dérivés d'une passkey PRF et/ou d'une passphrase) — il ne peut jamais
// lire la clé. 1:1 avec l'identité.
export const e2eVaults = pgTable("e2e_vaults", {
  identity_id: integer("identity_id")
    .primaryKey()
    .references(() => identities.id, { onDelete: "cascade" }),
  vault: text("vault").notNull().default(""),
  updated_at: text("updated_at").notNull().$defaultFn(nowIso),
  pin_fail_count: integer("pin_fail_count").notNull().default(0),
  pin_locked_until: text("pin_locked_until"),
  ratchet_cache: text("ratchet_cache"),
});

// Prekeys X3DH (forward secrecy). Matériel PUBLIC uniquement — même classe de
// confiance que `identities.pubkey`. La SPK (signed prekey) est la clé de pré-
// échange à durée moyenne ; elle n'est pas signée par ECDSA en v1 (l'IK est
// ECDH-only) mais authentifiée implicitement par les DH du X3DH qui mêlent l'IK.
// `spk_sig` est réservée pour un durcissement ECDSA futur. 1:1 avec l'identité.
export const e2ePrekeys = pgTable("e2e_prekeys", {
  identity_id: integer("identity_id")
    .primaryKey()
    .references(() => identities.id, { onDelete: "cascade" }),
  spk_pub: text("spk_pub").notNull(), // clé publique SPK (JWK)
  spk_id: integer("spk_id").notNull(), // identifiant monotone de la SPK
  spk_sig: text("spk_sig").notNull().default(""), // réservé (signature ECDSA future)
  updated_at: text("updated_at").notNull().$defaultFn(nowIso),
});

// Pool de one-time prekeys (OPK) publiques par identité, consommées une par
// handshake X3DH (`consumed` passe à 1). Quand le pool est vide, le handshake
// se fait sans DH4 (FS one-time réduite, session quand même établie).
export const e2eOneTimePrekeys = pgTable(
  "e2e_one_time_prekeys",
  {
    id: serial("id").primaryKey(),
    identity_id: integer("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    opk_id: integer("opk_id").notNull(), // identifiant attribué par le client
    opk_pub: text("opk_pub").notNull(), // clé publique OPK (JWK)
    consumed: integer("consumed").notNull().default(0),
  },
  (t) => [index("idx_opk_identity").on(t.identity_id, t.consumed)]
);

// Prekeys X3DH PAR APPAREIL (multi-appareils). Mêmes rôles que e2e_prekeys /
// e2e_one_time_prekeys mais re-clés sur `devices` : chaque appareil publie sa
// propre SPK + son pool d'OPK. Les tables 1:1 par identité ci-dessus restent
// pour la coexistence pendant la transition (retirées en P7).
export const devicePrekeys = pgTable("device_prekeys", {
  device_pk: integer("device_pk")
    .primaryKey()
    .references(() => devices.id, { onDelete: "cascade" }), // 1 SPK active par appareil
  spk_pub: text("spk_pub").notNull(),
  spk_id: integer("spk_id").notNull(),
  spk_sig: text("spk_sig").notNull().default(""),
  updated_at: text("updated_at").notNull().$defaultFn(nowIso),
});

export const deviceOneTimePrekeys = pgTable(
  "device_one_time_prekeys",
  {
    id: serial("id").primaryKey(),
    device_pk: integer("device_pk")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    opk_id: integer("opk_id").notNull(),
    opk_pub: text("opk_pub").notNull(),
    consumed: integer("consumed").notNull().default(0),
  },
  (t) => [index("idx_device_opk").on(t.device_pk, t.consumed)]
);

// Vérifications d'identité (anti-MITM). `identity_id` a vérifié `peer_id` à un
// numéro de sécurité dont on stocke le hash (sha256). Directionnel et synchronisé
// entre les appareils du même compte. Matériel dérivé de clés PUBLIQUES.
export const e2eVerifications = pgTable(
  "e2e_verifications",
  {
    identity_id: integer("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    peer_id: integer("peer_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    safety_hash: text("safety_hash").notNull(), // sha256 hex du numéro de sécurité
    verified_at: text("verified_at").notNull().$defaultFn(nowIso),
  },
  (t) => [primaryKey({ columns: [t.identity_id, t.peer_id] })]
);

export const cardFields = pgTable(
  "card_fields",
  {
    identity_id: integer("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    value: text("value").notNull().default(""),
    is_custom: integer("is_custom").notNull().default(0),
    is_public: integer("is_public").notNull().default(1),
    visibility: text("visibility").notNull().default("public"), // public | private | contact
    position: integer("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.identity_id, t.key] })]
);

export const events = pgTable(
  "events",
  {
    id: serial("id").primaryKey(),
    identity_id: integer("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    starts_at: text("starts_at").notNull(),
    ends_at: text("ends_at"),
    location: text("location").notNull().default(""),
    link: text("link").notNull().default(""), // URL (page de l'event, visio, post réseau social)
    notes: text("notes").notNull().default(""),
    is_public: integer("is_public").notNull().default(1),
    // 'event' (par défaut) | 'live' : un live planifié dans l'espace premium.
    kind: text("kind").notNull().default("event"),
  },
  (t) => [index("idx_events_identity").on(t.identity_id, t.starts_at)]
);

export const dayOverrides = pgTable(
  "day_overrides",
  {
    identity_id: integer("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    day: text("day").notNull(), // 'YYYY-MM-DD'
    status: text("status").notNull(), // 'free' | 'busy'
  },
  (t) => [primaryKey({ columns: [t.identity_id, t.day] })]
);

export const requests = pgTable(
  "requests",
  {
    id: serial("id").primaryKey(),
    identity_id: integer("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    day: text("day"), // 'YYYY-MM-DD' ou NULL
    time: text("time"), // 'HH:MM' (créneau souhaité) ou NULL
    name: text("name").notNull(),
    email: text("email").notNull().default(""),
    message: text("message").notNull().default(""),
    status: text("status").notNull().default("pending"), // pending | accepted | declined
    // Jalons de rappel déjà envoyés au destinataire (CSV : '1m,1w,3d,1d').
    reminders_sent: text("reminders_sent").notNull().default(""),
    created_at: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [index("idx_requests_identity").on(t.identity_id, t.created_at)]
);

export const relations = pgTable(
  "relations",
  {
    identity_id: integer("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    related_id: integer("related_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("amis"), // amis | pro | autre
    created_at: text("created_at").notNull().default(""),
  },
  (t) => [
    primaryKey({ columns: [t.identity_id, t.related_id] }),
    index("idx_relations_related").on(t.related_id),
    check("relations_no_self", sql`${t.identity_id} <> ${t.related_id}`),
  ]
);

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    pair: text("pair").notNull(), // "minId:maxId"
    sender_id: integer("sender_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    iv: text("iv").notNull(),
    ciphertext: text("ciphertext").notNull(),
    // Clés publiques ECDH figées à l'envoi : `sender_pub` = clé de l'émetteur,
    // `recipient_pub` = clé du destinataire visée. Chaque lecteur déchiffre avec
    // SA clé privée actuelle + la clé publique du pair STOCKÉE ici, donc
    // l'historique reste lisible même si l'autre partie a changé de clé depuis.
    // Vide pour les anciens messages (fallback : clé publiée courante du pair).
    sender_pub: text("sender_pub").notNull().default(""),
    recipient_pub: text("recipient_pub").notNull().default(""),
    created_at: text("created_at").notNull().$defaultFn(nowIso),
    expires_at: text("expires_at").notNull(),
    delivered: integer("delivered").notNull().default(0),
    read: integer("read").notNull().default(0),
    // Lecture unique : le destinataire le « brûle » (supprime) après l'avoir révélé.
    read_once: integer("read_once").notNull().default(0),
    // Multi-appareils : appareil émetteur + id de message LOGIQUE (un même
    // client_msg_id regroupe les N enveloppes per-appareil ; réactions / lecture /
    // suppression s'appliquent au logique). NULL pour les messages mono-session legacy.
    sender_device_pk: integer("sender_device_pk").references(() => devices.id, { onDelete: "set null" }),
    client_msg_id: text("client_msg_id"),
  },
  (t) => [
    index("idx_messages_pair").on(t.pair, t.created_at),
    index("idx_messages_client_msg").on(t.client_msg_id),
  ]
);

// Enveloppes per-appareil d'un message logique (fan-out). Le ciphertext DIFFÈRE
// par appareil destinataire (chiffré pour sa session). Chaque appareil ne lit que
// SES enveloppes (`recipient_device_pk = monAppareil`). Supprimées avec le message.
export const messageEnvelopes = pgTable(
  "message_envelopes",
  {
    id: serial("id").primaryKey(),
    message_id: integer("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    recipient_device_pk: integer("recipient_device_pk")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    iv: text("iv").notNull(),
    ciphertext: text("ciphertext").notNull(),
  },
  (t) => [
    index("idx_envelope_message").on(t.message_id),
    index("idx_envelope_recipient").on(t.recipient_device_pk),
  ]
);

// Pièces jointes chiffrées éphémères. Le serveur ne stocke qu'un BLOB opaque
// (chiffré côté client par une clé AES aléatoire envoyée dans le message). La
// métadonnée + clé voyagent dans le message E2E ; même TTL 24 h que les messages.
export const attachments = pgTable(
  "attachments",
  {
    id: serial("id").primaryKey(),
    pair: text("pair").notNull(), // "minId:maxId" (cf. messages)
    sender_id: integer("sender_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    file: text("file").notNull().default(""), // nom du fichier opaque dans data/
    size: integer("size").notNull().default(0),
    created_at: text("created_at").notNull().$defaultFn(nowIso),
    expires_at: text("expires_at").notNull(),
  },
  (t) => [index("idx_attachments_pair").on(t.pair)]
);

// Groupes de discussion (Option M) : appartenance persistée (métadonnée), mais
// les messages restent ÉPHÉMÈRES (table messages, pair = "g:<id>", TTL 24 h) et le
// contenu E2E (sender keys). Le serveur ne voit jamais le contenu ni les clés.
export const groups = pgTable("groups", {
  id: text("id").primaryKey(), // uuid client
  name: text("name").notNull().default(""),
  created_at: text("created_at").notNull().$defaultFn(nowIso),
});

export const groupMembers = pgTable(
  "group_members",
  {
    group_id: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    identity_id: integer("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"), // admin | member
    joined_at: text("joined_at").notNull().$defaultFn(nowIso),
  },
  (t) => [primaryKey({ columns: [t.group_id, t.identity_id] }), index("idx_group_members_identity").on(t.identity_id)]
);

// Invitations de contact (sans annuaire) : jeton à usage unique partagé par
// QR/lien. À l'acceptation, une relation mutuelle est créée. Élagué à expiration.
export const invites = pgTable("invites", {
  token: text("token").primaryKey(),
  from_id: integer("from_id")
    .notNull()
    .references(() => identities.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("amis"),
  used: integer("used").notNull().default(0),
  created_at: text("created_at").notNull().$defaultFn(nowIso),
  expires_at: text("expires_at").notNull(),
});

// Codes PIN d'appairage : générés depuis une session authentifiée (web) pour
// connecter un nouvel appareil (Android) sans coller la longue clé d'accès. On
// ne stocke que le sha256 du PIN. À usage unique, TTL court, un seul actif par
// identité (en créer un nouveau écrase le précédent). Élagué à expiration.
export const loginPins = pgTable("login_pins", {
  pin_hash: text("pin_hash").primaryKey(), // sha256(pin) hex
  identity_id: integer("identity_id")
    .notNull()
    .references(() => identities.id, { onDelete: "cascade" }),
  expires_at: text("expires_at").notNull(),
  created_at: text("created_at").notNull().$defaultFn(nowIso),
});

export const reactions = pgTable(
  "reactions",
  {
    message_id: integer("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    identity_id: integer("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
  },
  (t) => [primaryKey({ columns: [t.message_id, t.identity_id, t.emoji] })]
);

export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    identity_id: integer("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // relation | request | message
    text: text("text").notNull(),
    link: text("link"),
    read: integer("read").notNull().default(0),
    created_at: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [index("idx_notif_identity").on(t.identity_id, t.read, t.created_at)]
);

export const gallery = pgTable(
  "gallery",
  {
    id: serial("id").primaryKey(),
    identity_id: integer("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    // Lien cliquable optionnel (Premium, P6) : la vignette renvoie vers cette URL.
    link_url: text("link_url").notNull().default(""),
    position: integer("position").notNull().default(0),
    created_at: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [index("idx_gallery_identity").on(t.identity_id, t.position)]
);

// Boutons personnalisés de la page publique (Premium, P5) : libellé + URL +
// icône + position. Édition réservée au titulaire Premium ; lecture publique.
export const pageButtons = pgTable(
  "page_buttons",
  {
    id: serial("id").primaryKey(),
    identity_id: integer("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    url: text("url").notNull(),
    icon: text("icon").notNull().default(""),
    position: integer("position").notNull().default(0),
    // Position normalisée (0..1) sur la cover-hero du profil.
    pos_x: real("pos_x").notNull().default(0.5),
    pos_y: real("pos_y").notNull().default(0.9),
    shape: text("shape").notNull().default("circle"), // "circle" | "square"
    show_label: integer("show_label").notNull().default(0), // 0=icône seule, 1=icône+label
    created_at: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [index("idx_page_buttons_identity").on(t.identity_id, t.position)]
);

export const galleryLikes = pgTable(
  "gallery_likes",
  {
    photo_id: integer("photo_id")
      .notNull()
      .references(() => gallery.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
  },
  (t) => [primaryKey({ columns: [t.photo_id, t.fingerprint] })]
);

export const passkeyCredentials = pgTable(
  "passkey_credentials",
  {
    id: text("id").primaryKey(), // credentialID base64url
    identity_id: integer("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    public_key: text("public_key").notNull(),
    counter: integer("counter").notNull().default(0),
    device_type: text("device_type").notNull().default("singleDevice"),
    backed_up: integer("backed_up").notNull().default(0),
    transports: text("transports").notNull().default("[]"),
    name: text("name").notNull().default(""),
    created_at: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [index("idx_passkey_identity").on(t.identity_id)]
);

export const sessions = pgTable(
  "sessions",
  {
    token_hash: text("token_hash").primaryKey(), // sha256(token), hex
    identity_id: integer("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    created_at: text("created_at").notNull().$defaultFn(nowIso),
    expires_at: text("expires_at").notNull(),
    last_seen: text("last_seen").notNull().$defaultFn(nowIso),
    user_agent: text("user_agent"),
  },
  (t) => [index("idx_sessions_identity").on(t.identity_id)]
);

// Tags publics (mots-clés) du profil, affichés sur la carte.
export const tags = pgTable(
  "tags",
  {
    identity_id: integer("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.identity_id, t.tag] })]
);

// Abonnements Web Push (PWA). Le serveur n'envoie qu'un « réveil » SANS contenu
// (E2E) ; le client récupère puis déchiffre à l'ouverture. p256dh/auth conservés
// pour un éventuel payload chiffré futur (RFC 8291).
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: serial("id").primaryKey(),
    identity_id: integer("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull().default(""),
    auth: text("auth").notNull().default(""),
    created_at: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [index("idx_push_identity").on(t.identity_id)]
);

/* ----------------------------- OAuth 2.1 (MCP) --------------------------- */
// mindlog est à la fois serveur d'autorisation (AS) et serveur de ressources (RS)
// pour le connecteur MCP cloud (/mcp). Voir src/oauth.ts.

// Clients enregistrés (Dynamic Client Registration, RFC 7591).
export const oauthClients = pgTable("oauth_clients", {
  client_id: text("client_id").primaryKey(),
  client_secret_hash: text("client_secret_hash"), // null = client public (PKCE seul)
  client_name: text("client_name").notNull().default(""),
  redirect_uris: text("redirect_uris").notNull(), // JSON array d'URIs
  grant_types: text("grant_types").notNull().default("authorization_code,refresh_token"),
  token_endpoint_auth_method: text("token_endpoint_auth_method").notNull().default("none"),
  created_at: text("created_at").notNull().$defaultFn(nowIso),
});

// Codes d'autorisation à usage unique (TTL court), liés à une identité + PKCE.
export const oauthCodes = pgTable("oauth_codes", {
  code_hash: text("code_hash").primaryKey(), // sha256(code)
  client_id: text("client_id").notNull(),
  identity_id: integer("identity_id")
    .notNull()
    .references(() => identities.id, { onDelete: "cascade" }),
  redirect_uri: text("redirect_uri").notNull(),
  code_challenge: text("code_challenge").notNull(), // PKCE S256
  scope: text("scope").notNull().default(""),
  resource: text("resource"),
  expires_at: text("expires_at").notNull(),
  created_at: text("created_at").notNull().$defaultFn(nowIso),
});

// Tokens d'accès et de rafraîchissement (seul le sha256 est stocké).
export const oauthTokens = pgTable(
  "oauth_tokens",
  {
    token_hash: text("token_hash").primaryKey(),
    kind: text("kind").notNull(), // 'access' | 'refresh'
    client_id: text("client_id").notNull(),
    identity_id: integer("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    scope: text("scope").notNull().default(""),
    resource: text("resource"),
    expires_at: text("expires_at").notNull(),
    created_at: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [index("idx_oauth_tokens_identity").on(t.identity_id)]
);
