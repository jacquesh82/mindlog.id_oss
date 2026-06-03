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
}

type IsPremiumFn = (id: number) => Promise<boolean>;
type GetSubscriptionFn = (id: number) => Promise<SubscriptionRow | undefined>;
type ListButtonsFn = (id: number) => Promise<PageButton[]>;
type SanitizeUrlFn = (raw: unknown) => string | null;

let _isPremium: IsPremiumFn = async () => false;
let _getSubscription: GetSubscriptionFn = async () => undefined;
let _listButtons: ListButtonsFn = async () => [];
let _sanitizeButtonUrl: SanitizeUrlFn = () => null;

export function installPremium(impl: {
  isPremium: IsPremiumFn;
  getSubscription: GetSubscriptionFn;
  listButtons: ListButtonsFn;
  sanitizeButtonUrl: SanitizeUrlFn;
}): void {
  _isPremium = impl.isPremium;
  _getSubscription = impl.getSubscription;
  _listButtons = impl.listButtons;
  _sanitizeButtonUrl = impl.sanitizeButtonUrl;
}

export const isPremium = (id: number): Promise<boolean> => _isPremium(id);
export const getSubscription = (id: number): Promise<SubscriptionRow | undefined> => _getSubscription(id);
export const listButtons = (id: number): Promise<PageButton[]> => _listButtons(id);
export const sanitizeButtonUrl = (raw: unknown): string | null => _sanitizeButtonUrl(raw);

// Fonction pure : toujours false en free (sub=undefined → false de toute façon).
export function subscriptionIsPremium(_sub: SubscriptionRow | undefined): boolean {
  return false;
}
