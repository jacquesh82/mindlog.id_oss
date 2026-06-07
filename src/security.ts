/**
 * Middlewares de sécurité transverses : limitation de débit (rate-limiting),
 * en-têtes de sécurité HTTP et limite de taille du corps des requêtes.
 *
 * Le rate-limiter est volontairement en mémoire (fenêtre fixe) : l'app tourne
 * en un seul process Node. Pour un déploiement multi-instances, brancher un
 * store partagé (Redis) derrière la même interface.
 */
import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";

/** IP cliente, en tenant compte des en-têtes de proxy (Cloudflare en tête). */
export function clientIp(c: Context): string {
  return (
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Limiteur de débit par clé (IP par défaut), fenêtre fixe.
 * Renvoie 429 + `Retry-After` au-delà de `max` requêtes par `windowMs`.
 */
export function rateLimit(opts: {
  windowMs: number;
  max: number;
  key?: (c: Context) => string;
  message?: string;
}): MiddlewareHandler {
  const buckets = new Map<string, Bucket>();
  const keyOf = opts.key ?? clientIp;
  return async (c, next) => {
    const now = Date.now();
    const k = keyOf(c);
    let b = buckets.get(k);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(k, b);
    }
    b.count++;
    // Nettoyage opportuniste pour éviter une fuite mémoire sur les clés expirées.
    if (buckets.size > 10000) {
      for (const [kk, bb] of buckets) if (bb.resetAt <= now) buckets.delete(kk);
    }
    c.header("X-RateLimit-Limit", String(opts.max));
    c.header("X-RateLimit-Remaining", String(Math.max(0, opts.max - b.count)));
    if (b.count > opts.max) {
      c.header("Retry-After", String(Math.ceil((b.resetAt - now) / 1000)));
      return c.json({ error: opts.message ?? "Trop de requêtes, réessayez plus tard." }, 429);
    }
    await next();
  };
}

const isLocal = (host: string) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);

/** En-têtes de sécurité HTTP appliqués à toutes les réponses. */
export function securityHeaders(): MiddlewareHandler {
  const csp = [
    "default-src 'self'",
    // Scripts inline du shell + CDN (gsap, qrcode), Turnstile, et unpkg (Swagger UI).
    // 'wasm-unsafe-eval' : requis pour SQLite-WASM (cache PIM hors-ligne) ; n'autorise
    // PAS eval() JS, seulement la compilation WebAssembly.
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdnjs.cloudflare.com https://challenges.cloudflare.com https://unpkg.com",
    "style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com",
    "img-src 'self' data: blob:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "media-src 'self' blob:",
    "connect-src 'self' https://challenges.cloudflare.com",
    // 'self' : pages internes embarquées (ex. /live/broadcast et /live/:id dans
    // le panneau droit de l'onglet Échanges). Cloudflare Turnstile reste autorisé.
    "frame-src 'self' https://challenges.cloudflare.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  return async (c, next) => {
    c.header("Content-Security-Policy", csp);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    // Empêche la fuite de la clé d'accès présente dans l'URL (?key=, /k/...)
    // vers des tiers via l'en-tête Referer.
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header("Cross-Origin-Opener-Policy", "same-origin");
    if (!isLocal(c.req.header("host") ?? "")) {
      c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    await next();
  };
}

/**
 * Limite la taille du corps : 256 Ko pour le JSON, 55 Mo pour les envois
 * multipart (photos : jusqu'à 10 × 5 Mo + surcoût). Renvoie 413 au-delà.
 */
export function requestBodyLimit(): MiddlewareHandler {
  return (c, next) => {
    const ct = c.req.header("content-type") ?? "";
    const max = ct.includes("multipart/form-data") ? 55 * 1024 * 1024 : 256 * 1024;
    return bodyLimit({
      maxSize: max,
      onError: (c) => c.json({ error: "Corps de requête trop volumineux." }, 413),
    })(c, next);
  };
}
