import type { Context, Next } from 'hono';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  maxRequests: number;
  windowMs: number;
  keyFn?: (c: Context) => string;
  maxKeys?: number;
}

export function createRateLimiter(options: RateLimitOptions) {
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
  if (cleanupTimer.unref) {
    cleanupTimer.unref();
  }

  const defaultKeyFn = (c: Context): string => {
    // In Hono with @hono/node-server, use the client's IP from the
    // incoming connection info or forwarded header.
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip') ||
      'unknown';
    const spaceId = c.req.header('X-Takos-Space-Id') || '';
    return spaceId ? `${ip}:${spaceId}` : ip;
  };

  const keyFn = options.keyFn || defaultKeyFn;

  return async (c: Context, next: Next): Promise<Response | void> => {
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
          c.header('Retry-After', String(retryAfter));
          return c.json({
            error: 'Rate limiter capacity reached. Please try again later.',
            retry_after_seconds: retryAfter,
          }, 429);
        }
      }
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    const remaining = Math.max(0, maxRequests - entry.count);
    c.header('X-RateLimit-Limit', String(maxRequests));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      c.header('Retry-After', String(retryAfter));
      return c.json({
        error: 'Too many requests. Please try again later.',
        retry_after_seconds: retryAfter,
      }, 429);
    }

    await next();
  };
}
