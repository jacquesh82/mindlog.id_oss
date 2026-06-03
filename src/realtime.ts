/**
 * Bus temps réel en mémoire (pub/sub par identité), poussé via SSE.
 * SSE est suffisant et adapté ici : flux serveur → client (notifications,
 * nouveaux messages) sur HTTP, sans dépendance ni la complexité de WebRTC.
 */
type Listener = (event: string, data: unknown) => void;

const clients = new Map<number, Set<Listener>>();

export function subscribe(identityId: number, fn: Listener): () => void {
  let set = clients.get(identityId);
  if (!set) clients.set(identityId, (set = new Set()));
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0) clients.delete(identityId);
  };
}

export function publish(identityId: number, event: string, data: unknown): void {
  const set = clients.get(identityId);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(event, data);
    } catch {
      /* ignore un client en erreur */
    }
  }
}
