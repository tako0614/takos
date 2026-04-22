import type { Context, Env, Next } from "hono";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitOptions<E extends Env = Env> {
  maxRequests: number;
  windowMs: number;
  keyFn?: (c: Context<E>) => string;
  maxKeys?: number;
  trustProxyHeaders?: boolean;
}

export const RUNTIME_REMOTE_ADDR_BINDING = "takosRuntimeRemoteAddr";

function cleanAddressCandidate(value: string | undefined): string {
  const candidate = value?.trim() ?? "";
  if (!candidate || candidate.length > 128) return "";
  for (let i = 0; i < candidate.length; i++) {
    const code = candidate.charCodeAt(i);
    if (code <= 32 || code === 127) return "";
  }
  return candidate;
}

function getRemoteAddress<E extends Env>(c: Context<E>): string {
  const env = c.env as Record<string, unknown> | undefined;
  const value = env?.[RUNTIME_REMOTE_ADDR_BINDING];
  return typeof value === "string" ? cleanAddressCandidate(value) : "";
}

function getForwardedAddress<E extends Env>(c: Context<E>): string {
  const forwardedFor = c.req.header("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  const forwardedAddress = cleanAddressCandidate(forwardedFor);
  if (forwardedAddress) return forwardedAddress;
  return cleanAddressCandidate(c.req.header("x-real-ip"));
}

export function getRequestClientAddress<E extends Env>(
  c: Context<E>,
  options: { trustProxyHeaders?: boolean } = {},
): string {
  if (options.trustProxyHeaders) {
    const forwardedAddress = getForwardedAddress(c);
    if (forwardedAddress) return forwardedAddress;
  }
  return getRemoteAddress(c) || "unknown";
}

export function createRateLimiter<E extends Env = Env>(
  options: RateLimitOptions<E>,
) {
  const { maxRequests, windowMs, maxKeys = 10000 } = options;
  const store = new Map<string, RateLimitEntry>();

  const cleanupInterval = Math.min(windowMs, 60_000);
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (now >= entry.resetAt) {
        store.delete(key);
      }
    }
  }, cleanupInterval);
  Deno.unrefTimer(cleanupTimer);

  const defaultKeyFn = (c: Context<E>): string => {
    const ip = getRequestClientAddress(c, {
      trustProxyHeaders: options.trustProxyHeaders === true,
    });
    const spaceId = c.req.header("X-Takos-Space-Id") || "";
    return spaceId ? `${ip}:${spaceId}` : ip;
  };

  const keyFn = options.keyFn || defaultKeyFn;

  const middleware = async (
    c: Context<E>,
    next: Next,
  ): Promise<Response | void> => {
    const key = keyFn(c);
    const now = Date.now();
    let entry = store.get(key);

    if (!entry || now >= entry.resetAt) {
      if (!entry && store.size >= maxKeys) {
        let evicted = false;
        for (const [k, e] of store.entries()) {
          if (now >= e.resetAt) {
            store.delete(k);
            evicted = true;
            break;
          }
        }
        if (!evicted && store.size >= maxKeys) {
          const retryAfter = Math.ceil(windowMs / 1000);
          c.header("Retry-After", String(retryAfter));
          // Common error envelope: { error: { code, message, details } }
          return c.json({
            error: {
              code: "RATE_LIMITED",
              message: "Rate limiter capacity reached. Please try again later.",
              details: { retryAfter },
            },
          }, 429);
        }
      }
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    const remaining = Math.max(0, maxRequests - entry.count);
    c.header("X-RateLimit-Limit", String(maxRequests));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      c.header("Retry-After", String(retryAfter));
      // Common error envelope: { error: { code, message, details } }
      return c.json({
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests. Please try again later.",
          details: { retryAfter },
        },
      }, 429);
    }

    await next();
  };

  Object.assign(middleware, {
    dispose() {
      clearInterval(cleanupTimer);
    },
  });

  return middleware;
}
