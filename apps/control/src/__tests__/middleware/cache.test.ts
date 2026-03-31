import { Hono } from "hono";
import type { ExecutionContext } from "hono";
import { CacheTTL, withCache } from "@/middleware/cache";
import { SESSION_COOKIE_NAME } from "@/services/identity/session";
import { assertEquals } from "jsr:@std/assert";
import { assertSpyCalls } from "jsr:@std/testing/mock";

type CacheMock = {
  match: any;
  put: any;
  delete: any;
};

function createCacheMock(): CacheMock {
  return {
    match: async () => undefined,
    put: async () => undefined,
    delete: async () => true,
  };
}

let cache: CacheMock;
Deno.test("withCache - bypasses cache for authenticated session cookies", async () => {
  cache = createCacheMock();
  (globalThis as typeof globalThis & { caches?: CacheStorage }).caches = {
    default: cache as unknown as Cache,
  } as CacheStorage;
  const app = new Hono();
  app.get("/explore", withCache({ ttl: CacheTTL.PUBLIC_LISTING }), (c) => {
    return c.json({ ok: true, source: "live" });
  });

  const res = await app.request("https://takos.test/explore", {
    headers: {
      Cookie: `${SESSION_COOKIE_NAME}=session-123`,
    },
  });

  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, source: "live" });
  assertSpyCalls(cache.match, 0);
  assertSpyCalls(cache.put, 0);
});
Deno.test("withCache - uses cache for anonymous GET requests", async () => {
  cache = createCacheMock();
  (globalThis as typeof globalThis & { caches?: CacheStorage }).caches = {
    default: cache as unknown as Cache,
  } as CacheStorage;
  const app = new Hono();
  app.get("/explore", withCache({ ttl: CacheTTL.PUBLIC_LISTING }), (c) => {
    return c.json({ ok: true, source: "live" });
  });

  const executionCtx: ExecutionContext = {
    waitUntil: ((..._args: any[]) => undefined) as any,
    passThroughOnException: ((..._args: any[]) => undefined) as any,
    props: {},
  };
  const res = await app.request(
    "https://takos.test/explore",
    undefined,
    undefined,
    executionCtx,
  );
  await Promise.resolve();

  assertEquals(res.status, 200);
  assertSpyCalls(cache.match, 1);
  assertSpyCalls(cache.put, 1);
});
