// Premium API — stubs actifs en édition communautaire (free).
// premium/index.ts appelle installPremium() au démarrage pour remplacer
// les stubs par les vraies implémentations.

export interface SubscriptionRow {
  identity_id: number;
  provider: string;
  customer_id: string;
  subscription_id: string;
  status: string;
  price_id: string;
  current_period_end: string | null;
  cancel_at_period_end: number;
  updated_at: string;
}

export interface PageButton {
  id: number;
  label: string;
  url: string;
  icon: string;
  position: number;
  pos_x: number;
  pos_y: number;
  shape: string; // "circle" | "square"
  show_label: boolean;
}

// Bénéfices opt-in que le créateur offre à ses abonné·e·s. Quand chat/call
// sont true, ils sont RÉSERVÉS aux abonnés (gating côté serveur + UI).
// Les autres clés (pages, rdv, lives) servent uniquement d'affichage marketing.
export interface SpaceBenefits {
  chat: boolean;   // messagerie E2E réservée aux abonnés
  call: boolean;   // appel audio/vidéo réservé aux abonnés
  pages: boolean;  // affichage marketing (les pages restent toujours premium)
  rdv: boolean;    // RDV prioritaires
  lives: boolean;  // accès aux lives & annonces (à venir)
  gallery?: boolean; // galerie privée (chiffrée) réservée aux abonnés — opt-in
  files?: boolean;   // espace fichiers (chiffré) réservé aux abonnés — opt-in
}

// Valeurs par défaut quand le créateur n'a jamais défini ses bénéfices.
// → tarif fixé : tout activé (la valeur ajoutée principale est le pack complet).
// → pas de tarif : rien d'activé (pas d'espace vendable, pas de gating).
// gallery/files restent opt-in (false) : activés explicitement via « Activer… ».
export const DEFAULT_BENEFITS_PAID: SpaceBenefits = { chat: true, call: true, pages: true, rdv: true, lives: true, gallery: false, files: false };
export const DEFAULT_BENEFITS_FREE: SpaceBenefits = { chat: false, call: false, pages: false, rdv: false, lives: false, gallery: false, files: false };

// Vue publique de l'espace premium d'un créateur, calculée côté serveur
// pour la page /@handle (liste des pages publiées + statut d'accès du viewer).
export interface SpaceInfo {
  price_cents: number;
  currency: string;
  active: boolean;
  // Le viewer est-il propriétaire ou abonné actif → accès débloqué.
  subscribed: boolean;
  // Markdown brut introductif (rendu en HTML côté client). Vide si non défini.
  intro_md: string;          // affiché en haut de /@handle/space
  profile_intro_md: string;  // affiché sur /@handle (zone bio publique)
  // Bénéfices opt-in du créateur (cf. SpaceBenefits).
  benefits: SpaceBenefits;
  // `published` est inclus pour le propriétaire (vue éditeur) et permet
  // d'afficher les brouillons avec un badge dédié. Toujours `true` côté visiteur.
  pages: Array<{ slug: string; title: string; type: string; published?: boolean }>;
}

type IsPremiumFn = (id: number) => Promise<boolean>;
type GetSubscriptionFn = (id: number) => Promise<SubscriptionRow | undefined>;
type ListButtonsFn = (id: number) => Promise<PageButton[]>;
type SanitizeUrlFn = (raw: unknown) => string | null;
type SubscriptionIsPremiumFn = (sub: SubscriptionRow | undefined) => boolean;
type GetSpaceInfoFn = (ownerId: number, viewerId: number | null) => Promise<SpaceInfo | null>;
// Résultat = { chat:true, call:true } quand l'action est permise (par défaut OSS).
// `senderId` est null pour un visiteur non connecté.
type GetContactGatingFn = (recipientId: number, senderId: number | null) => Promise<{ chat: boolean; call: boolean }>;
// Notifications « live » — appelées depuis le core (route agenda) lors d'une
// planification d'événement kind=live. En build OSS, l'implémentation par
// défaut est un no-op : aucun import de `src/premium/*` n'a lieu.
type NotifyLiveScheduledFn = (ownerId: number, event: { title: string; starts_at: string }) => void;

/* ─── Extension MCP : opérations Premium exposées à Milo (MCP cloud) ───────
 * Sert de pont entre `src/mcp-cloud.ts` (core) et `src/premium/store/*`.
 * En build OSS, les shims lèvent / renvoient « pas dispo » : Milo n'expose
 * alors pas les outils correspondants (les call-sites détectent et adaptent
 * via `mcpPremiumAvailable()`). */
export type PageType = "markdown" | "gallery" | "link" | "file";
export interface PremiumPageRow {
  id: number;
  slug: string;
  title: string;
  type: PageType;
  content: string;
  published: number;
  created_at: string;
}
export interface MySpaceFull {
  price_cents: number;
  currency: string;
  active: boolean;
  intro_md: string;
  profile_intro_md: string;
  benefits: SpaceBenefits;
  connect: { connected: boolean; chargesEnabled: boolean; payoutsEnabled: boolean };
  // Stockage tiers (galeries/médias servis hors id.mindlog). Jamais de secrets ici.
  storage: { kind: string | null; configured: boolean };
}
export interface MyOutgoingSubscription {
  owner_handle: string;
  provider: string;
  status: string;
  current_period_end: string | null;
  updated_at: string;
}
export interface PageButtonInput {
  label: string;
  url: string;
  icon?: string;
  pos_x?: number;
  pos_y?: number;
  shape?: string;
  show_label?: boolean;
}

type McpListPagesFn = (ownerId: number) => Promise<PremiumPageRow[]>;
type McpGetPageFn = (ownerId: number, slug: string) => Promise<PremiumPageRow | undefined>;
type McpUpsertPageFn = (
  ownerId: number,
  input: { slug: string; title: string; type: PageType; content?: unknown; published?: boolean }
) => Promise<PremiumPageRow>;
type McpDeletePageFn = (ownerId: number, slug: string) => Promise<boolean>;
type McpGetSpaceFn = (ownerId: number) => Promise<MySpaceFull>;
type McpSetSpacePriceFn = (ownerId: number, priceCents: number, currency: string) => Promise<MySpaceFull>;
type McpSetSpaceIntroFn = (ownerId: number, introMd: string, kind: "space" | "profile") => Promise<MySpaceFull>;
type McpSetSpaceBenefitsFn = (ownerId: number, benefits: SpaceBenefits) => Promise<MySpaceFull>;
type McpListOutgoingSubsFn = (subscriberId: number) => Promise<MyOutgoingSubscription[]>;
type McpSetPageButtonsFn = (ownerId: number, buttons: PageButtonInput[]) => Promise<PageButton[]>;
// Renvoie une URL hostée Stripe que Milo passe à l'humain pour finir le flux
// dans son navigateur ; null si la facturation n'est pas configurée côté serveur.
type McpStartConnectOnboardingFn = (ownerId: number) => Promise<{ url: string } | { error: string }>;
type McpSubscribeCheckoutFn = (
  subscriberId: number,
  ownerHandle: string
) => Promise<{ url: string } | { already: true } | { error: string }>;
type McpBillingPortalFn = (ownerId: number) => Promise<{ url: string } | { error: string }>;
type McpBillingConfiguredFn = () => boolean;

const PREMIUM_ERR = "Premium requis — installez le module premium.";

let _mcpListPages: McpListPagesFn = async () => [];
let _mcpGetPage: McpGetPageFn = async () => undefined;
let _mcpUpsertPage: McpUpsertPageFn = async () => { throw new Error(PREMIUM_ERR); };
let _mcpDeletePage: McpDeletePageFn = async () => false;
let _mcpGetSpace: McpGetSpaceFn = async () => ({
  price_cents: 0, currency: "eur", active: false,
  intro_md: "", profile_intro_md: "",
  benefits: { ...DEFAULT_BENEFITS_FREE },
  connect: { connected: false, chargesEnabled: false, payoutsEnabled: false },
  storage: { kind: null, configured: false },
});
let _mcpSetSpacePrice: McpSetSpacePriceFn = async () => { throw new Error(PREMIUM_ERR); };
let _mcpSetSpaceIntro: McpSetSpaceIntroFn = async () => { throw new Error(PREMIUM_ERR); };
let _mcpSetSpaceBenefits: McpSetSpaceBenefitsFn = async () => { throw new Error(PREMIUM_ERR); };
let _mcpListOutgoingSubs: McpListOutgoingSubsFn = async () => [];
let _mcpSetPageButtons: McpSetPageButtonsFn = async () => { throw new Error(PREMIUM_ERR); };
let _mcpStartConnectOnboarding: McpStartConnectOnboardingFn = async () => ({ error: PREMIUM_ERR });
let _mcpSubscribeCheckout: McpSubscribeCheckoutFn = async () => ({ error: PREMIUM_ERR });
let _mcpBillingPortal: McpBillingPortalFn = async () => ({ error: PREMIUM_ERR });
let _mcpBillingConfigured: McpBillingConfiguredFn = () => false;
let _mcpAvailable = false;

let _isPremium: IsPremiumFn = async () => false;
let _getSubscription: GetSubscriptionFn = async () => undefined;
let _listButtons: ListButtonsFn = async () => [];
let _sanitizeButtonUrl: SanitizeUrlFn = () => null;
let _subscriptionIsPremium: SubscriptionIsPremiumFn = () => false;
let _getSpaceInfo: GetSpaceInfoFn = async () => null;
let _getContactGating: GetContactGatingFn = async () => ({ chat: true, call: true });
let _notifyLiveScheduled: NotifyLiveScheduledFn = () => { /* no-op en OSS */ };

export function installPremium(impl: {
  isPremium: IsPremiumFn;
  getSubscription: GetSubscriptionFn;
  listButtons: ListButtonsFn;
  sanitizeButtonUrl: SanitizeUrlFn;
  subscriptionIsPremium: SubscriptionIsPremiumFn;
  getSpaceInfo: GetSpaceInfoFn;
  getContactGating: GetContactGatingFn;
  notifyLiveScheduled?: NotifyLiveScheduledFn;
  mcp?: {
    listPages: McpListPagesFn;
    getPage: McpGetPageFn;
    upsertPage: McpUpsertPageFn;
    deletePage: McpDeletePageFn;
    getSpace: McpGetSpaceFn;
    setSpacePrice: McpSetSpacePriceFn;
    setSpaceIntro: McpSetSpaceIntroFn;
    setSpaceBenefits: McpSetSpaceBenefitsFn;
    listOutgoingSubs: McpListOutgoingSubsFn;
    setPageButtons: McpSetPageButtonsFn;
    startConnectOnboarding: McpStartConnectOnboardingFn;
    subscribeCheckout: McpSubscribeCheckoutFn;
    billingPortal: McpBillingPortalFn;
    billingConfigured: McpBillingConfiguredFn;
  };
}): void {
  _isPremium = impl.isPremium;
  _getSubscription = impl.getSubscription;
  _listButtons = impl.listButtons;
  _sanitizeButtonUrl = impl.sanitizeButtonUrl;
  _subscriptionIsPremium = impl.subscriptionIsPremium;
  _getSpaceInfo = impl.getSpaceInfo;
  _getContactGating = impl.getContactGating;
  if (impl.notifyLiveScheduled) _notifyLiveScheduled = impl.notifyLiveScheduled;
  if (impl.mcp) {
    _mcpListPages = impl.mcp.listPages;
    _mcpGetPage = impl.mcp.getPage;
    _mcpUpsertPage = impl.mcp.upsertPage;
    _mcpDeletePage = impl.mcp.deletePage;
    _mcpGetSpace = impl.mcp.getSpace;
    _mcpSetSpacePrice = impl.mcp.setSpacePrice;
    _mcpSetSpaceIntro = impl.mcp.setSpaceIntro;
    _mcpSetSpaceBenefits = impl.mcp.setSpaceBenefits;
    _mcpListOutgoingSubs = impl.mcp.listOutgoingSubs;
    _mcpSetPageButtons = impl.mcp.setPageButtons;
    _mcpStartConnectOnboarding = impl.mcp.startConnectOnboarding;
    _mcpSubscribeCheckout = impl.mcp.subscribeCheckout;
    _mcpBillingPortal = impl.mcp.billingPortal;
    _mcpBillingConfigured = impl.mcp.billingConfigured;
    _mcpAvailable = true;
  }
}

export const isPremium = (id: number): Promise<boolean> => _isPremium(id);
export const getSubscription = (id: number): Promise<SubscriptionRow | undefined> => _getSubscription(id);
export const listButtons = (id: number): Promise<PageButton[]> => _listButtons(id);
export const sanitizeButtonUrl = (raw: unknown): string | null => _sanitizeButtonUrl(raw);
// Délègue à l'implémentation Premium (sinon stub free → false).
export const subscriptionIsPremium = (sub: SubscriptionRow | undefined): boolean => _subscriptionIsPremium(sub);
export const getSpaceInfo = (ownerId: number, viewerId: number | null): Promise<SpaceInfo | null> =>
  _getSpaceInfo(ownerId, viewerId);
// Retourne {chat,call} = true si l'action est permise pour ce sender. Quand le
// destinataire a activé chat/call comme bénéfices d'un espace payant, seuls
// les abonnés actifs (et lui-même) peuvent contacter ; sinon comportement libre.
export const getContactGating = (recipientId: number, senderId: number | null): Promise<{ chat: boolean; call: boolean }> =>
  _getContactGating(recipientId, senderId);
// Délègue au module Premium si présent ; sinon no-op silencieux. Le caller
// (route agenda) ne sait pas si l'implém est branchée, et n'a pas à savoir.
export const notifyLiveScheduled: NotifyLiveScheduledFn = (ownerId, event) =>
  _notifyLiveScheduled(ownerId, event);

/* ─── Surface MCP exposée à Milo ─── */
export const mcpPremiumAvailable = (): boolean => _mcpAvailable;
export const mcpListPages = (ownerId: number) => _mcpListPages(ownerId);
export const mcpGetPage = (ownerId: number, slug: string) => _mcpGetPage(ownerId, slug);
export const mcpUpsertPage: McpUpsertPageFn = (ownerId, input) => _mcpUpsertPage(ownerId, input);
export const mcpDeletePage = (ownerId: number, slug: string) => _mcpDeletePage(ownerId, slug);
export const mcpGetSpace = (ownerId: number) => _mcpGetSpace(ownerId);
export const mcpSetSpacePrice = (ownerId: number, priceCents: number, currency = "eur") =>
  _mcpSetSpacePrice(ownerId, priceCents, currency);
export const mcpSetSpaceIntro = (ownerId: number, introMd: string, kind: "space" | "profile") =>
  _mcpSetSpaceIntro(ownerId, introMd, kind);
export const mcpSetSpaceBenefits = (ownerId: number, benefits: SpaceBenefits) =>
  _mcpSetSpaceBenefits(ownerId, benefits);
export const mcpListOutgoingSubs = (subscriberId: number) => _mcpListOutgoingSubs(subscriberId);
export const mcpSetPageButtons = (ownerId: number, buttons: PageButtonInput[]) =>
  _mcpSetPageButtons(ownerId, buttons);
export const mcpStartConnectOnboarding = (ownerId: number) => _mcpStartConnectOnboarding(ownerId);
export const mcpSubscribeCheckout = (subscriberId: number, ownerHandle: string) =>
  _mcpSubscribeCheckout(subscriberId, ownerHandle);
export const mcpBillingPortal = (ownerId: number) => _mcpBillingPortal(ownerId);
export const mcpBillingConfigured = (): boolean => _mcpBillingConfigured();
