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
}

// Valeurs par défaut quand le créateur n'a jamais défini ses bénéfices.
// → tarif fixé : tout activé (la valeur ajoutée principale est le pack complet).
// → pas de tarif : rien d'activé (pas d'espace vendable, pas de gating).
export const DEFAULT_BENEFITS_PAID: SpaceBenefits = { chat: true, call: true, pages: true, rdv: true, lives: true };
export const DEFAULT_BENEFITS_FREE: SpaceBenefits = { chat: false, call: false, pages: false, rdv: false, lives: false };

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
}): void {
  _isPremium = impl.isPremium;
  _getSubscription = impl.getSubscription;
  _listButtons = impl.listButtons;
  _sanitizeButtonUrl = impl.sanitizeButtonUrl;
  _subscriptionIsPremium = impl.subscriptionIsPremium;
  _getSpaceInfo = impl.getSpaceInfo;
  _getContactGating = impl.getContactGating;
  if (impl.notifyLiveScheduled) _notifyLiveScheduled = impl.notifyLiveScheduled;
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
