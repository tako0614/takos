import { Hono } from "hono";
import type { ExecutionContext } from "hono";
import { CacheTTL, withCache } from "@/middleware/cache";
import { SESSION_COOKIE_NAME } from "@/services/identity/session";
import { assertEquals } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

type CacheMock = {
  match: any;
  put: any;
  delete: any;
};

function createCacheMock(): CacheMock {
  return {
    match: spy(async () => undefined),
    put: spy(async () => undefined),
    delete: spy(async () => true),
  };
}

let cache: CacheMock;
const originalCachesDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "caches",
);

function installCachesMock(): void {
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: {
      default: cache as unknown as Cache,
    } as CacheStorage,
  });
}

function restoreCachesMock(): void {
  if (originalCachesDescriptor) {
    Object.defineProperty(globalThis, "caches", originalCachesDescriptor);
    return;
  }
  Reflect.deleteProperty(globalThis, "caches");
}

Deno.test("withCache - bypasses cache for authenticated session cookies", async () => {
  cache = createCacheMock();
  installCachesMock();
  try {
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
  } finally {
    restoreCachesMock();
  }
});

Deno.test("withCache - bypasses cache for signed GET requests", async () => {
  cache = createCacheMock();
  installCachesMock();
  try {
    const app = new Hono();
    app.get(
      "/api/public/stores/curated",
      withCache({ ttl: CacheTTL.PUBLIC_CONTENT }),
      (c) => {
        return c.json({ ok: true, source: "live" });
      },
    );

    const res = await app.request(
      "https://takos.test/api/public/stores/curated",
      {
        headers: {
          Signature:
            'keyId="https://remote.example/users/bob#main-key",signature="abc"',
        },
      },
    );

    assertEquals(res.status, 200);
    assertEquals(await res.json(), { ok: true, source: "live" });
    assertSpyCalls(cache.match, 0);
    assertSpyCalls(cache.put, 0);
  } finally {
    restoreCachesMock();
  }
});

Deno.test("withCache - uses cache for anonymous GET requests", async () => {
  cache = createCacheMock();
  installCachesMock();
  try {
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
  } finally {
    restoreCachesMock();
  }
});
