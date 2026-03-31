import type { Context, MiddlewareHandler, Next } from 'hono';
import { computeSHA256 } from '../../shared/utils/hash.ts';
import { logError, logWarn } from '../../shared/utils/logger.ts';

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
  PUBLIC_LISTING: 300,       // 5 minutes
  SEARCH: 60,                // 1 minute
  PUBLIC_CONTENT: 600,       // 10 minutes
} as const;

export const CacheTags = {
  EXPLORE: 'explore',
  SEARCH: 'search',
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
        params.set(key, url.searchParams.get(key) ?? '');
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
  errorMessage: string
): void {
  const ctx = c.executionCtx;
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(task.catch(err => logError(String(errorMessage), err, { module: 'middleware/cache' })));
  } else {
    task.catch(err => logError(String(errorMessage), err, { module: 'middleware/cache' }));
  }
}

export function withCache(config: CacheConfig): MiddlewareHandler {
  return async (c: Context, next: Next): Promise<Response | void> => {
    if (c.req.method !== 'GET') {
      await next();
      return;
    }

    // Skip caching for authenticated requests
    const authHeader = c.req.header('Authorization');
    const cookie = c.req.header('Cookie');
    if (authHeader || (cookie && cookie.includes('session='))) {
      await next();
      return;
    }

    const cacheKeyUrl = generateCacheKey(c, config);
    const cacheKey = new Request(cacheKeyUrl, { method: 'GET' });

    const cache = caches.default;
    const cachedResponse = await cache.match(cacheKey);

    if (cachedResponse) {
      const ifNoneMatch = c.req.header('If-None-Match');
      const etag = cachedResponse.headers.get('ETag');
      if (ifNoneMatch && etag && ifNoneMatch === etag) {
        return c.body(null, 304);
      }

      const ifModifiedSince = c.req.header('If-Modified-Since');
      const lastModified = cachedResponse.headers.get('Last-Modified');
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
    if (c.res.headers.get('Set-Cookie')) {
      logWarn('Skipping cache for response with Set-Cookie header', { module: 'middleware/cache' });
      return;
    }

    const responseBody = await c.res.text();
    const etag = await generateETag(responseBody);
    const now = new Date();

    const cacheControl = `public, max-age=${config.ttl}`;

    const headers = new Headers(c.res.headers);
    headers.set('Cache-Control', cacheControl);
    headers.set('ETag', etag);
    headers.set('Last-Modified', now.toUTCString());
    if (config.cacheTag) {
      headers.set('Cache-Tag', config.cacheTag);
    }
    headers.set('X-Cache', 'MISS');

    const responseToCache = new Response(responseBody, { status: 200, headers });

    runWithWaitUntil(
      c,
      cache.put(cacheKey, responseToCache.clone()),
      'Failed to store response in cache:'
    );

    c.res = new Response(responseBody, { status: 200, headers });
  };
}

export async function invalidateCache(urls: string[]): Promise<void> {
  const cache = caches.default;
  await Promise.all(
    urls.map(url => cache.delete(new Request(url)))
  );
}

export function invalidateCacheOnMutation(
  urlGenerators: Array<(c: Context) => string | string[]>
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
      'Failed to invalidate cache:'
    );
  };
}
