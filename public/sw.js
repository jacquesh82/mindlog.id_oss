/**
 * Service worker — coquille PWA (tâche B1).
 *
 * Stratégie volontairement minimale et sûre pour une app E2E :
 *  - /api, /mcp, /oauth, le flux SSE et toute requête non-GET → réseau direct
 *    (jamais interceptés ni mis en cache : contenu chiffré, flux temps réel, mutations).
 *  - Navigations → réseau d'abord, repli sur le shell « / » en cache (offline).
 *  - Assets statiques same-origin → cache d'abord + rafraîchissement en tâche de fond.
 *
 * La version suit STARTED_AT côté serveur (templating __V__) : un nouveau cache est
 * créé à chaque (re)démarrage/déploiement et les anciens sont purgés à l'activation.
 */
const VERSION = "__V__";
const CACHE = "mindlog-shell-" + VERSION;

// Précache atomique (doit exister) + best-effort (icônes, non bloquant).
const CORE = ["/", "/manifest.webmanifest", "/static/milo.svg"];
const EXTRA = ["/static/icon-192.png", "/static/icon-512.png", "/static/maskable-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await cache.addAll(CORE);
      cache.addAll(EXTRA).catch(() => { /* icônes non critiques */ });
      await self.skipWaiting();
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // mutations → réseau direct
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // CDN tiers → réseau direct
  // Endpoints dynamiques : jamais d'interception (E2E, SSE, OAuth, le SW lui-même).
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/mcp") ||
    url.pathname.startsWith("/oauth") ||
    url.pathname === "/sw.js"
  )
    return;

  // Navigations : réseau d'abord, repli sur le shell en cache (app-shell offline).
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match("/", { ignoreSearch: true }).then((r) => r || Response.error())
      )
    );
    return;
  }

  // Assets statiques : cache d'abord, mise à jour en arrière-plan (stale-while-revalidate).
  // IMPORTANT : ne JAMAIS résoudre respondWith() sur `undefined` — sinon le navigateur
  // lève « Failed to convert value to 'Response' » et l'asset échoue. Le repli réseau
  // garantit donc toujours une Response valide (cache si présent, sinon Response.error()).
  event.respondWith(
    caches.match(req).then((cached) => {
      const fromNetwork = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached || Response.error());
      return cached || fromNetwork;
    })
  );
});

// Push « réveil » SANS contenu (E2E) : notification générique. Le contenu réel
// est récupéré et déchiffré à l'ouverture de l'app.
self.addEventListener("push", (event) => {
  event.waitUntil(
    self.registration.showNotification("mindlog · id", {
      body: "Vous avez du nouveau 🦎",
      icon: "/static/icon-192.png",
      badge: "/static/icon-192.png",
      tag: "mindlog",
      renotify: true,
    })
  );
});

// Clic sur la notification : focalise un onglet existant, sinon ouvre l'app.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow("/");
    })
  );
});
