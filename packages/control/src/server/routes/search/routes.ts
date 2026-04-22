import { type Context, Hono } from "hono";
import {
  parseJsonBody,
  spaceAccess,
  type SpaceAccessRouteEnv,
} from "../route-auth.ts";
import { BadRequestError } from "takos-common/errors";
import {
  quickSearchPaths,
  type SearchRequestBody,
  searchWorkspace,
} from "../../../application/services/source/search.ts";
import { CacheTags, CacheTTL } from "../../middleware/cache.ts";
import { computeSHA256 } from "../../../shared/utils/hash.ts";
import { logError } from "../../../shared/utils/logger.ts";

type SearchContext = Context<SpaceAccessRouteEnv>;
const search = new Hono<SpaceAccessRouteEnv>();

function getDefaultCache(): Cache | null {
  const cacheStorage =
    (globalThis as typeof globalThis & { caches?: CacheStorage }).caches;
  if (!cacheStorage || !("default" in cacheStorage)) return null;
  return cacheStorage.default;
}

function normalizeFileTypesForCache(fileTypes?: string[]): string[] {
  if (!fileTypes || fileTypes.length === 0) return [];
  return [...fileTypes].sort();
}

async function createSearchCacheKey(
  c: SearchContext,
  payload: unknown,
): Promise<Request> {
  const url = new URL(c.req.url);
  const hash = await computeSHA256(JSON.stringify(payload));
  return new Request(`${url.origin}/__cache/search/${hash}`, { method: "GET" });
}

function isConditionalCacheHit(c: SearchContext, headers: Headers): boolean {
  const ifNoneMatch = c.req.header("If-None-Match");
  const etag = headers.get("ETag");
  if (ifNoneMatch && etag && ifNoneMatch === etag) return true;
  const ifModifiedSince = c.req.header("If-Modified-Since");
  const lastModified = headers.get("Last-Modified");
  if (!ifModifiedSince || !lastModified) return false;
  const ifModifiedDate = new Date(ifModifiedSince);
  const lastModifiedDate = new Date(lastModified);
  if (
    Number.isNaN(ifModifiedDate.getTime()) ||
    Number.isNaN(lastModifiedDate.getTime())
  ) return false;
  return ifModifiedDate >= lastModifiedDate;
}

async function matchSearchCache(
  c: SearchContext,
  cacheKey: Request,
): Promise<Response | null> {
  const cache = getDefaultCache();
  if (!cache) return null;
  try {
    const cachedResponse = await cache.match(cacheKey);
    if (!cachedResponse) return null;
    const headers = new Headers(cachedResponse.headers);
    headers.set("X-Cache", "HIT");
    if (c.req.method === "GET" && isConditionalCacheHit(c, headers)) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(cachedResponse.body, {
      status: cachedResponse.status,
      headers,
    });
  } catch (err) {
    logError("Failed to read search cache", err, { module: "routes/search" });
    return null;
  }
}

async function storeSearchCache(
  c: SearchContext,
  cacheKey: Request,
  response: Response,
): Promise<void> {
  const cache = getDefaultCache();
  if (!cache) return;
  const cachePut = cache.put(cacheKey, response.clone()).catch((err) => {
    logError("Failed to store search cache", err, { module: "routes/search" });
  });
  const ctx = c.executionCtx;
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(cachePut);
  else await cachePut;
}

async function createCacheableJsonResponse(body: unknown): Promise<Response> {
  const payload = JSON.stringify(body);
  const etag = `"${(await computeSHA256(payload)).substring(0, 16)}"`;
  return new Response(payload, {
    status: 200,
    headers: new Headers({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `private, max-age=${CacheTTL.SEARCH}`,
      "Cache-Tag": CacheTags.SEARCH,
      "ETag": etag,
      "Last-Modified": new Date().toUTCString(),
      "X-Cache": "MISS",
    }),
  });
}

async function resolveCachedSearchResponse(
  c: SearchContext,
  cacheKeyPayload: {
    scope: "workspace" | "quick";
    spaceId: string;
    userId: string;
    query: string;
    type?: string | null;
    fileTypes?: string[];
    limit?: number | null;
  },
  responseBodyFactory: () => Promise<unknown>,
): Promise<Response> {
  const cacheKey = await createSearchCacheKey(c, cacheKeyPayload);
  const cachedResponse = await matchSearchCache(c, cacheKey);
  if (cachedResponse) return cachedResponse;
  const responseBody = await responseBodyFactory();
  const response = await createCacheableJsonResponse(responseBody);
  await storeSearchCache(c, cacheKey, response);
  return response;
}

search.post("/spaces/:spaceId/search", spaceAccess(), async (c) => {
  const user = c.get("user");
  const { space } = c.get("access");
  const body = await parseJsonBody<SearchRequestBody>(c);
  if (!body) throw new BadRequestError("Invalid JSON body");
  if (!body.query || body.query.trim().length === 0) {
    throw new BadRequestError("Query is required");
  }

  return resolveCachedSearchResponse(c, {
    scope: "workspace",
    spaceId: space.id,
    userId: user.id,
    query: body.query,
    type: body.type || null,
    fileTypes: normalizeFileTypesForCache(body.file_types),
    limit: body.limit || null,
  }, async () => {
    const result = await searchWorkspace({
      env: c.env,
      spaceId: space.id,
      query: body.query,
      searchType: body.type,
      fileTypes: body.file_types,
      limit: body.limit,
    });
    return {
      query: body.query,
      results: result.results,
      total: result.total,
      semantic_available: result.semanticAvailable,
    };
  });
});

search.get("/spaces/:spaceId/search/quick", spaceAccess(), async (c) => {
  const user = c.get("user");
  const { space } = c.get("access");
  const query = c.req.query("q");
  if (!query || query.length < 2) return c.json({ results: [] });

  return resolveCachedSearchResponse(c, {
    scope: "quick",
    spaceId: space.id,
    userId: user.id,
    query,
  }, async () => {
    const results = await quickSearchPaths(c.env.DB, space.id, query);
    return { results };
  });
});

export default search;
