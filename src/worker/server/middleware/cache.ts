import type { Context, MiddlewareHandler, Next } from "hono";
import { computeSHA256 } from "../../shared/utils/hash.ts";
import { logError, logWarn } from "../../shared/utils/logger.ts";
import { SESSION_COOKIE_NAME } from "../../application/services/identity/session.ts";

// Detect the canonical session cookie by name. Avoid substring matching to
// prevent accidental false positives if the cookie is renamed.
const SESSION_COOKIE_PRESENT = new RegExp(
  `(?:^|;\\s*)${SESSION_COOKIE_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=`,
);

declare global {
  interface CacheStorage {
    readonly default: Cache;
  }
}

export interface CacheConfig {
  ttl: number;
  includeQueryParams?: boolean;
  queryParamsToInclude?: string[];
  cacheTag?: string;
  cacheKeyGenerator?: (c: Context) => string;
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

function generateCacheKey(c: Context, config: CacheConfig): string {
  if (config.cacheKeyGenerator) {
    return config.cacheKeyGenerator(c);
  }

  const url = new URL(c.req.url);
  let cacheKey = `${url.origin}${url.pathname}`;

  if (config.includeQueryParams !== false) {
    const params = new URLSearchParams();

    if (config.queryParamsToInclude) {
      for (const key of config.queryParamsToInclude) {
        const value = url.searchParams.get(key);
        if (value !== null) {
          params.set(key, value);
        }
      }
    } else {
      const sortedKeys = Array.from(url.searchParams.keys()).sort();
      for (const key of sortedKeys) {
        params.set(key, url.searchParams.get(key) ?? "");
      }
    }

    const queryString = params.toString();
    if (queryString) {
      cacheKey += `?${queryString}`;
    }
  }

  return cacheKey;
}

async function generateETag(body: string): Promise<string> {
  const hashHex = await computeSHA256(body);
  return `"${hashHex.substring(0, 16)}"`;
}

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

export function withCache(config: CacheConfig): MiddlewareHandler {
  return async (c: Context, next: Next): Promise<Response | void> => {
    if (c.req.method !== "GET") {
      await next();
      return;
    }

    // Skip caching for authenticated requests. Use the canonical cookie name
    // parser instead of substring matching to avoid serving stale cached
    // responses to logged-in users when the cookie name is renamed.
    const authHeader = c.req.header("Authorization");
    const signatureHeader = c.req.header("Signature");
    const cookie = c.req.header("Cookie");
    if (
      authHeader || signatureHeader ||
      (cookie && SESSION_COOKIE_PRESENT.test(cookie))
    ) {
      await next();
      return;
    }

    const cacheKeyUrl = generateCacheKey(c, config);
    const cacheKey = new Request(cacheKeyUrl, { method: "GET" });

    const cache = caches.default;
    const cachedResponse = await cache.match(cacheKey);

    if (cachedResponse) {
      const ifNoneMatch = c.req.header("If-None-Match");
      const etag = cachedResponse.headers.get("ETag");
      if (ifNoneMatch && etag && ifNoneMatch === etag) {
        return c.body(null, 304);
      }

      const ifModifiedSince = c.req.header("If-Modified-Since");
      const lastModified = cachedResponse.headers.get("Last-Modified");
      if (ifModifiedSince && lastModified) {
        if (new Date(ifModifiedSince) >= new Date(lastModified)) {
          return c.body(null, 304);
        }
      }

      return new Response(cachedResponse.body, {
        status: cachedResponse.status,
        headers: cachedResponse.headers,
      });
    }

    await next();

    if (c.res.status !== 200) return;

    // Never cache responses with Set-Cookie (prevents cache poisoning)
    if (c.res.headers.get("Set-Cookie")) {
      logWarn("Skipping cache for response with Set-Cookie header", {
        module: "middleware/cache",
      });
      return;
    }

    const responseBody = await c.res.text();
    const etag = await generateETag(responseBody);
    const now = new Date();

    const cacheControl = `public, max-age=${config.ttl}`;

    const headers = new Headers(c.res.headers);
    headers.set("Cache-Control", cacheControl);
    headers.set("ETag", etag);
    headers.set("Last-Modified", now.toUTCString());
    if (config.cacheTag) {
      headers.set("Cache-Tag", config.cacheTag);
      // Remember which cache-key URL was stored under this tag so a later
      // `invalidateCache({ tags: [...] })` call can purge it. Multiple tags
      // separated by comma are supported by the Cloudflare convention.
      for (const tag of config.cacheTag.split(",")) {
        const trimmed = tag.trim();
        if (trimmed) rememberCacheTag(trimmed, cacheKeyUrl);
      }
    }
    headers.set("X-Cache", "MISS");

    const responseToCache = new Response(responseBody, {
      status: 200,
      headers,
    });

    runWithWaitUntil(
      c,
      cache.put(cacheKey, responseToCache.clone()),
      "Failed to store response in cache:",
    );

    c.res = new Response(responseBody, { status: 200, headers });
  };
}

/**
 * In-isolate index from Cache-Tag value to the cache-key URLs that were
 * stored under that tag. The Cloudflare Cache API does not support
 * `Cache-Tag` purges from a Worker isolate (those headers are honored only
 * by the edge cache layer / paid purge API), so we maintain our own index
 * to make `invalidateCache({ tags: ... })` work for entries put by
 * `withCache`. Entries are added at put time and pruned when a tag-driven
 * purge runs.
 */
const tagIndex = new Map<string, Set<string>>();

function rememberCacheTag(tag: string, urlKey: string): void {
  let set = tagIndex.get(tag);
  if (!set) {
    set = new Set<string>();
    tagIndex.set(tag, set);
  }
  set.add(urlKey);
}

/**
 * @internal exposed for tests; not part of the stable public surface.
 */
export function _resetCacheTagIndexForTests(): void {
  tagIndex.clear();
}

export type InvalidateCacheTarget =
  | string
  | string[]
  | { urls?: string[]; tags?: string[] };

/**
 * Purge cached responses by URL and/or by `Cache-Tag` value previously set on
 * a response by `withCache`.
 *
 * URL-array calls keep their current behavior: delete matching URLs from
 * `caches.default`. When called with
 * `{ tags: [...] }`, every URL stored under each tag (in this isolate) is
 * purged. The tag index is in-isolate only; cross-isolate tag purges still
 * require an external mechanism (e.g. the Cloudflare cache purge API).
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
    for (const tag of target.tags ?? []) {
      const set = tagIndex.get(tag);
      if (!set) continue;
      for (const url of set) urls.add(url);
      tagIndex.delete(tag);
    }
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
