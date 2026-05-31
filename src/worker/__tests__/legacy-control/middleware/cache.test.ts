import { Hono } from "hono";
import type { ExecutionContext } from "hono";
import { CacheTTL, withCache } from "@/middleware/cache";
import { SESSION_COOKIE_NAME } from "@/services/identity/session";
import { assertEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";

class MockCache implements Cache {
  match = spy(
    async (
      _request: RequestInfo | URL,
      _options?: CacheQueryOptions,
    ): Promise<Response | undefined> => undefined,
  );
  put = spy(
    async (
      _request: RequestInfo | URL,
      _response: Response,
    ): Promise<void> => undefined,
  );
  delete = spy(
    async (
      _request: RequestInfo | URL,
      _options?: CacheQueryOptions,
    ): Promise<boolean> => true,
  );

  add(_request: RequestInfo | URL): Promise<void> {
    return Promise.resolve();
  }
  addAll(_requests: Iterable<RequestInfo>): Promise<void> {
    return Promise.resolve();
  }
  keys(
    _request?: RequestInfo | URL,
    _options?: CacheQueryOptions,
  ): Promise<readonly Request[]> {
    return Promise.resolve([]);
  }
  matchAll(
    _request?: RequestInfo | URL,
    _options?: CacheQueryOptions,
  ): Promise<readonly Response[]> {
    return Promise.resolve([]);
  }
}

function createCacheMock(): MockCache {
  return new MockCache();
}

let cache: MockCache;
const originalCachesDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "caches",
);

class MockCacheStorage implements CacheStorage {
  readonly default: Cache;

  constructor(defaultCache: Cache) {
    this.default = defaultCache;
  }

  delete(_cacheName: string): Promise<boolean> {
    return Promise.resolve(true);
  }
  has(_cacheName: string): Promise<boolean> {
    return Promise.resolve(true);
  }
  keys(): Promise<string[]> {
    return Promise.resolve([]);
  }
  match(
    _request: RequestInfo | URL,
    _options?: MultiCacheQueryOptions,
  ): Promise<Response | undefined> {
    return Promise.resolve(undefined);
  }
  open(_cacheName: string): Promise<Cache> {
    return Promise.resolve(this.default);
  }
}

function installCachesMock(): void {
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: new MockCacheStorage(cache),
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
      waitUntil: (_promise: Promise<unknown>) => {},
      passThroughOnException: () => {},
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
