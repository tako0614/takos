import type { Context, MiddlewareHandler, Next } from "hono";
import { logError } from "../../shared/utils/logger.ts";

declare global {
  interface CacheStorage {
    readonly default: Cache;
  }
}

export const CacheTTL = {
  PUBLIC_LISTING: 300, // 5 minutes
  SEARCH: 60, // 1 minute
  PUBLIC_CONTENT: 600, // 10 minutes
} as const;

export const CacheTags = {
  EXPLORE: "explore",
  SEARCH: "search",
} as const;

function runWithWaitUntil(
  c: Context,
  task: Promise<void>,
  errorMessage: string,
): void {
  // `c.executionCtx` is a getter that throws when the Hono context was not
  // constructed with one (notably in unit tests using `app.request`). Treat
  // that as "no waitUntil available" so callers can safely fall back to a
  // detached promise.
  let ctx: { waitUntil?: (task: Promise<unknown>) => void } | undefined;
  try {
    ctx = c.executionCtx as typeof ctx;
  } catch {
    ctx = undefined;
  }
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(
      task.catch((err) =>
        logError(String(errorMessage), err, { module: "middleware/cache" })
      ),
    );
  } else {
    task.catch((err) =>
      logError(String(errorMessage), err, { module: "middleware/cache" })
    );
  }
}

export type InvalidateCacheTarget =
  | string
  | string[]
  | { urls?: string[] };

/**
 * Purge cached responses by URL from `caches.default`.
 *
 * Accepts a single URL, an array of URLs, or `{ urls: [...] }`. URLs are
 * deduplicated before deletion.
 */
export async function invalidateCache(
  target: InvalidateCacheTarget,
): Promise<void> {
  const cache = caches.default;
  const urls = new Set<string>();
  if (typeof target === "string") {
    urls.add(target);
  } else if (Array.isArray(target)) {
    for (const url of target) urls.add(url);
  } else {
    for (const url of target.urls ?? []) urls.add(url);
  }
  await Promise.all(
    Array.from(urls, (url) => cache.delete(new Request(url))),
  );
}

export function invalidateCacheOnMutation(
  urlGenerators: Array<(c: Context) => string | string[]>,
): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    await next();

    if (c.res.status < 200 || c.res.status >= 300) return;

    const urlsToInvalidate: string[] = [];
    for (const generator of urlGenerators) {
      const urls = generator(c);
      if (Array.isArray(urls)) {
        urlsToInvalidate.push(...urls);
      } else {
        urlsToInvalidate.push(urls);
      }
    }

    runWithWaitUntil(
      c,
      invalidateCache(urlsToInvalidate),
      "Failed to invalidate cache:",
    );
  };
}
