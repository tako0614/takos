/**
 * Tests for runtime-host container lifecycle, proxy token management,
 * and forward request handling.
 *
 * Basic fetch/forward tests live in test/runtime-host.test.ts.
 * This file focuses on TakosRuntimeContainer class methods (token lifecycle,
 * buildRuntimeForwardRequest edge cases) and additional error paths.
 */
import {
  buildRuntimeContainerEnv,
  buildRuntimeForwardRequest,
  RUNTIME_PROXY_TOKEN_HEADER,
  RUNTIME_PROXY_TOKEN_TTL_MS,
  type RuntimeHostEnv,
  type RuntimeProxyTokenInfo,
  TakosRuntimeContainer,
} from "@/container-hosts/runtime-host";
import runtimeHost from "@/container-hosts/runtime-host";
import type {
  DurableObjectStateBinding,
  DurableObjectStorageBinding,
} from "../../../shared/types/bindings.ts";

function makeUnusedStubMethods() {
  return {
    fetch: () =>
      Promise.reject(
        new Error(
          "RuntimeContainerStub.fetch should not be called in this test",
        ),
      ),
    generateSessionProxyToken: () =>
      Promise.reject(
        new Error(
          "RuntimeContainerStub.generateSessionProxyToken should not be called in this test",
        ),
      ),
  };
}

// ---------------------------------------------------------------------------
// buildRuntimeContainerEnv
// ---------------------------------------------------------------------------

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "@std/assert";
import { assertSpyCallArgs, assertSpyCalls, spy } from "@std/testing/mock";

// Constructor input shape: TakosRuntimeContainer accepts a
// `DurableObjectStateBinding<Record<string, never>>` and a `RuntimeHostEnv`.
// We model only the storage subset the class actually exercises (get/put);
// other DO state methods are stubbed to throw.
type StorageMap = Map<string, unknown>;

function makeMockCtx(
  storage: StorageMap,
): DurableObjectStateBinding<Record<string, never>> {
  return {
    storage: {
      get: (key: string) =>
        Promise.resolve(storage.get(key) as never | undefined),
      put: (
        keyOrEntries: string | Record<string, unknown>,
        value?: unknown,
      ) => {
        if (typeof keyOrEntries === "string") {
          storage.set(keyOrEntries, value);
        } else {
          for (const [key, entryValue] of Object.entries(keyOrEntries)) {
            storage.set(key, entryValue);
          }
        }
        return Promise.resolve();
      },
      delete: ((keyOrKeys: string | string[]) => {
        if (Array.isArray(keyOrKeys)) {
          let deleted = 0;
          for (const key of keyOrKeys) {
            if (storage.delete(key)) deleted += 1;
          }
          return Promise.resolve(deleted);
        }
        return Promise.resolve(storage.delete(keyOrKeys));
      }) as DurableObjectStorageBinding["delete"],
      list: () => Promise.resolve(new Map()),
      getAlarm: () => Promise.resolve(null),
      setAlarm: () => Promise.resolve(),
      deleteAlarm: () => Promise.resolve(),
    },
    blockConcurrencyWhile: <R>(cb: () => Promise<R>) => cb(),
    getWebSockets: () => [],
    getTags: () => [],
    acceptWebSocket: () => {},
  };
}

function makeContainerEnv(
  overrides: Partial<RuntimeHostEnv> = {},
): RuntimeHostEnv {
  return {
    RUNTIME_CONTAINER: {
      getByName: () => ({
        ...makeUnusedStubMethods(),
        verifyProxyToken: () => Promise.resolve(null),
      }),
    },
    ADMIN_DOMAIN: "test.takos.jp",
    PROXY_BASE_URL: "https://proxy.workers.dev",
    ...overrides,
  };
}

Deno.test("buildRuntimeContainerEnv - includes TAKOS_API_URL from ADMIN_DOMAIN", () => {
  const result = buildRuntimeContainerEnv({
    ADMIN_DOMAIN: "example.takos.jp",
    PROXY_BASE_URL: "",
  });
  assertEquals(result.TAKOS_API_URL, "https://example.takos.jp");
});
Deno.test("buildRuntimeContainerEnv - includes PROXY_BASE_URL when provided", () => {
  const result = buildRuntimeContainerEnv({
    ADMIN_DOMAIN: "test.takos.jp",
    PROXY_BASE_URL: "https://proxy.workers.dev",
  });
  assertEquals(result.PROXY_BASE_URL, "https://proxy.workers.dev");
});
Deno.test("buildRuntimeContainerEnv - omits PROXY_BASE_URL when empty string", () => {
  const result = buildRuntimeContainerEnv({
    ADMIN_DOMAIN: "test.takos.jp",
    PROXY_BASE_URL: "",
  });
  assert(!("PROXY_BASE_URL" in result));
});
Deno.test("buildRuntimeContainerEnv - passes PLATFORM_PUBLIC_KEY as JWT_PUBLIC_KEY", () => {
  const result = buildRuntimeContainerEnv({
    ADMIN_DOMAIN: "test.takos.jp",
    PROXY_BASE_URL: "",
    PLATFORM_PUBLIC_KEY: "platform-public-key",
  });
  assertEquals(result.JWT_PUBLIC_KEY, "platform-public-key");
});
Deno.test("buildRuntimeContainerEnv - omits JWT_PUBLIC_KEY when PLATFORM_PUBLIC_KEY is undefined", () => {
  const result = buildRuntimeContainerEnv({
    ADMIN_DOMAIN: "test.takos.jp",
    PROXY_BASE_URL: "",
  });
  assert(!("JWT_PUBLIC_KEY" in result));
});
// ---------------------------------------------------------------------------
// TakosRuntimeContainer token lifecycle
// ---------------------------------------------------------------------------

let container: TakosRuntimeContainer;
let mockStorage: StorageMap;
Deno.test("TakosRuntimeContainer proxy token lifecycle - generates and verifies a proxy token", async () => {
  mockStorage = new Map();
  container = new TakosRuntimeContainer(
    makeMockCtx(mockStorage),
    makeContainerEnv(),
  );
  const token = await container.generateSessionProxyToken(
    "session-1",
    "space-1",
  );
  assertEquals(typeof token, "string");
  assert(token.length > 20);

  const info = await container.verifyProxyToken(token);
  assertEquals(info, { sessionId: "session-1", spaceId: "space-1" });
});
Deno.test("TakosRuntimeContainer proxy token lifecycle - returns null for unknown tokens", async () => {
  mockStorage = new Map();
  container = new TakosRuntimeContainer(
    makeMockCtx(mockStorage),
    makeContainerEnv(),
  );
  const info = await container.verifyProxyToken("unknown-token-abc");
  assertEquals(info, null);
});
Deno.test("TakosRuntimeContainer proxy token lifecycle - supports multiple tokens concurrently", async () => {
  mockStorage = new Map();
  container = new TakosRuntimeContainer(
    makeMockCtx(mockStorage),
    makeContainerEnv(),
  );
  const token1 = await container.generateSessionProxyToken(
    "session-1",
    "space-1",
  );
  const token2 = await container.generateSessionProxyToken(
    "session-2",
    "space-2",
  );

  assertNotEquals(token1, token2);

  const info1 = await container.verifyProxyToken(token1);
  assertEquals(info1, { sessionId: "session-1", spaceId: "space-1" });

  const info2 = await container.verifyProxyToken(token2);
  assertEquals(info2, { sessionId: "session-2", spaceId: "space-2" });
});
Deno.test("TakosRuntimeContainer proxy token lifecycle - persists tokens to storage", async () => {
  mockStorage = new Map();
  container = new TakosRuntimeContainer(
    makeMockCtx(mockStorage),
    makeContainerEnv(),
  );
  await container.generateSessionProxyToken("s1", "sp1");

  const stored = mockStorage.get("proxyTokens") as Record<string, unknown>;
  assert(stored !== undefined);
  assertEquals(Object.keys(stored).length, 1);
});
Deno.test("TakosRuntimeContainer proxy token lifecycle - expires and purges old tokens", async () => {
  mockStorage = new Map();
  const now = Date.now();
  mockStorage.set("proxyTokens", {
    "expired-token": {
      sessionId: "s-expired",
      spaceId: "sp-expired",
      createdAt: now - RUNTIME_PROXY_TOKEN_TTL_MS - 1000,
      expiresAt: now - 1000,
    },
  });
  container = new TakosRuntimeContainer(
    makeMockCtx(mockStorage),
    makeContainerEnv({ PROXY_BASE_URL: "" }),
  );

  const info = await container.verifyProxyToken("expired-token");
  assertEquals(info, null);
  assertEquals(mockStorage.get("proxyTokens"), {});
});
Deno.test("TakosRuntimeContainer proxy token lifecycle - loads tokens from storage on first verify when cache is empty", async () => {
  mockStorage = new Map();
  container = new TakosRuntimeContainer(
    makeMockCtx(mockStorage),
    makeContainerEnv(),
  );
  // Simulate previously stored token
  mockStorage.set("proxyTokens", {
    "pre-existing-token": { sessionId: "s-old", spaceId: "sp-old" },
  });

  // Create a fresh container (cache is null)
  const freshContainer = new TakosRuntimeContainer(
    makeMockCtx(mockStorage),
    makeContainerEnv({ PROXY_BASE_URL: "" }),
  );

  const info = await freshContainer.verifyProxyToken("pre-existing-token");
  assertEquals(info, { sessionId: "s-old", spaceId: "sp-old" });
});
Deno.test("TakosRuntimeContainer proxy token lifecycle - revokes all tokens for a session", async () => {
  mockStorage = new Map();
  container = new TakosRuntimeContainer(
    makeMockCtx(mockStorage),
    makeContainerEnv({ PROXY_BASE_URL: "" }),
  );
  const token1 = await container.generateSessionProxyToken(
    "session-1",
    "space-1",
  );
  const token2 = await container.generateSessionProxyToken(
    "session-2",
    "space-2",
  );

  assertEquals(await container.revokeSessionProxyTokens("session-1"), 1);
  assertEquals(await container.verifyProxyToken(token1), null);
  assertEquals(await container.verifyProxyToken(token2), {
    sessionId: "session-2",
    spaceId: "space-2",
  });
});
Deno.test("TakosRuntimeContainer proxy token lifecycle - returns null when storage is empty and token is unknown", async () => {
  mockStorage = new Map();
  container = new TakosRuntimeContainer(
    makeMockCtx(mockStorage),
    makeContainerEnv(),
  );
  // Storage has no proxyTokens key — using a fresh, empty map
  const emptyStorage: StorageMap = new Map();
  const freshContainer = new TakosRuntimeContainer(
    makeMockCtx(emptyStorage),
    makeContainerEnv({ PROXY_BASE_URL: "" }),
  );

  const info = await freshContainer.verifyProxyToken("nonexistent");
  assertEquals(info, null);
});
// ---------------------------------------------------------------------------
// buildRuntimeForwardRequest
// ---------------------------------------------------------------------------

// `buildRuntimeForwardRequest` accepts a structural `stub` parameter; the
// (private) `RuntimeContainerStub` type in the production module requires
// fetch + generateSessionProxyToken + verifyProxyToken. Tests only assert on
// the proxy-token spy.
interface ForwardStub {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  generateSessionProxyToken: ReturnType<
    typeof spy<unknown, [string, string], Promise<string>>
  >;
  verifyProxyToken(token: string): Promise<RuntimeProxyTokenInfo | null>;
}

function makeStub(): ForwardStub {
  return {
    fetch: () =>
      Promise.reject(
        new Error("forwardStub.fetch should not be called in this test"),
      ),
    generateSessionProxyToken: spy(
      (_sessionId: string, _spaceId: string) =>
        Promise.resolve("generated-token"),
    ),
    verifyProxyToken: () => Promise.resolve(null),
  };
}

function makeEnv(): RuntimeHostEnv {
  return {
    RUNTIME_CONTAINER: {
      getByName: () => ({
        ...makeUnusedStubMethods(),
        verifyProxyToken: () => Promise.resolve(null),
      }),
    },
    ADMIN_DOMAIN: "test.takos.jp",
    PROXY_BASE_URL: "https://proxy.workers.dev",
  };
}

Deno.test("buildRuntimeForwardRequest - strips existing proxy token headers from forwarded request", async () => {
  const stub = makeStub();
  const request = new Request("https://runtime-host/health", {
    headers: {
      [RUNTIME_PROXY_TOKEN_HEADER]: "should-be-removed",
      "X-Other": "keep",
    },
  });

  const forwarded = await buildRuntimeForwardRequest(request, makeEnv(), stub);
  assertEquals(forwarded.headers.get(RUNTIME_PROXY_TOKEN_HEADER), null);
  assertEquals(forwarded.headers.get("X-Other"), "keep");
});
Deno.test("buildRuntimeForwardRequest - injects proxy token for POST /sessions with session_id and space_id", async () => {
  const stub = makeStub();
  const request = new Request("https://runtime-host/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: "sess-1", space_id: "sp-1" }),
  });

  const forwarded = await buildRuntimeForwardRequest(request, makeEnv(), stub);
  assertEquals(
    forwarded.headers.get(RUNTIME_PROXY_TOKEN_HEADER),
    "generated-token",
  );
  assertSpyCallArgs(stub.generateSessionProxyToken, 0, ["sess-1", "sp-1"]);
});
Deno.test("buildRuntimeForwardRequest - does not inject token for GET /sessions", async () => {
  const stub = makeStub();
  const request = new Request("https://runtime-host/sessions", {
    method: "GET",
  });

  const forwarded = await buildRuntimeForwardRequest(request, makeEnv(), stub);
  assertEquals(forwarded.headers.get(RUNTIME_PROXY_TOKEN_HEADER), null);
  assertSpyCalls(stub.generateSessionProxyToken, 0);
});
Deno.test("buildRuntimeForwardRequest - does not inject token for POST /sessions without session_id", async () => {
  const stub = makeStub();
  const request = new Request("https://runtime-host/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ space_id: "sp-1" }),
  });

  const forwarded = await buildRuntimeForwardRequest(request, makeEnv(), stub);
  assertEquals(forwarded.headers.get(RUNTIME_PROXY_TOKEN_HEADER), null);
});
Deno.test("buildRuntimeForwardRequest - does not inject token for POST /sessions without space_id", async () => {
  const stub = makeStub();
  const request = new Request("https://runtime-host/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: "sess-1" }),
  });

  const forwarded = await buildRuntimeForwardRequest(request, makeEnv(), stub);
  assertEquals(forwarded.headers.get(RUNTIME_PROXY_TOKEN_HEADER), null);
});
Deno.test("buildRuntimeForwardRequest - handles non-JSON body gracefully for POST /sessions", async () => {
  const stub = makeStub();
  const request = new Request("https://runtime-host/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "not-json",
  });

  // Should not throw, just log warning
  const forwarded = await buildRuntimeForwardRequest(request, makeEnv(), stub);
  assertEquals(forwarded.headers.get(RUNTIME_PROXY_TOKEN_HEADER), null);
  assertSpyCalls(stub.generateSessionProxyToken, 0);
});
Deno.test("buildRuntimeForwardRequest - does not inject token for POST to other paths", async () => {
  const stub = makeStub();
  const request = new Request("https://runtime-host/repos/list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: "sess-1", space_id: "sp-1" }),
  });

  const forwarded = await buildRuntimeForwardRequest(request, makeEnv(), stub);
  assertEquals(forwarded.headers.get(RUNTIME_PROXY_TOKEN_HEADER), null);
  assertSpyCalls(stub.generateSessionProxyToken, 0);
});
Deno.test("buildRuntimeForwardRequest - preserves original URL and method", async () => {
  const stub = makeStub();
  const request = new Request("https://runtime-host/health?check=1", {
    method: "GET",
  });

  const forwarded = await buildRuntimeForwardRequest(request, makeEnv(), stub);
  assertEquals(forwarded.url, "https://runtime-host/health?check=1");
  assertEquals(forwarded.method, "GET");
});
Deno.test("buildRuntimeForwardRequest - passes body through for non-GET/HEAD methods", async () => {
  const stub = makeStub();
  const request = new Request("https://runtime-host/repos/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "initial commit" }),
  });

  const forwarded = await buildRuntimeForwardRequest(request, makeEnv(), stub);
  const body = await forwarded.json();
  assertEquals(body, { message: "initial commit" });
});
// ---------------------------------------------------------------------------
// Service fetch handler - error paths
// ---------------------------------------------------------------------------

Deno.test("runtime-host service fetch error paths - returns 401 when /forward/ request has no Authorization header", async () => {
  const env: RuntimeHostEnv = {
    RUNTIME_CONTAINER: {
      getByName: () => ({
        ...makeUnusedStubMethods(),
        verifyProxyToken: () => Promise.resolve(null),
      }),
    },
    ADMIN_DOMAIN: "test.takos.jp",
    PLATFORM_PUBLIC_KEY: "test-public-key",
    PROXY_BASE_URL: "",
  };

  const res = await runtimeHost.fetch(
    new Request("https://runtime-host/forward/api-proxy/api/test"),
    env,
  );
  assertEquals(res.status, 401);
});
Deno.test("runtime-host service fetch error paths - returns 401 when /forward/ request has invalid token", async () => {
  const verifyProxyToken = spy((_token: string) => Promise.resolve(null));
  const env: RuntimeHostEnv = {
    RUNTIME_CONTAINER: {
      getByName: () => ({ ...makeUnusedStubMethods(), verifyProxyToken }),
    },
    ADMIN_DOMAIN: "test.takos.jp",
    PLATFORM_PUBLIC_KEY: "test-public-key",
    PROXY_BASE_URL: "",
  };

  const res = await runtimeHost.fetch(
    new Request("https://runtime-host/forward/api-proxy/api/test", {
      headers: { Authorization: "Bearer bad-token" },
    }),
    env,
  );
  assertEquals(res.status, 401);
  assertSpyCallArgs(verifyProxyToken, 0, ["bad-token"]);
});
Deno.test("runtime-host service fetch error paths - returns 500 when TAKOS_WORKER is not configured for /forward/ requests", async () => {
  const verifyProxyToken = spy((_token: string) =>
    Promise.resolve({ sessionId: "sess-1", spaceId: "sp-1" })
  );
  const env: RuntimeHostEnv = {
    RUNTIME_CONTAINER: {
      getByName: () => ({ ...makeUnusedStubMethods(), verifyProxyToken }),
    },
    ADMIN_DOMAIN: "test.takos.jp",
    PLATFORM_PUBLIC_KEY: "test-public-key",
    PROXY_BASE_URL: "",
    // No TAKOS_WORKER
  };

  const res = await runtimeHost.fetch(
    new Request("https://runtime-host/forward/api-proxy/api/test", {
      headers: {
        Authorization: "Bearer valid-token",
        "X-Takos-Session-Id": "sess-1",
      },
    }),
    env,
  );
  assertEquals(res.status, 500);
  const data = await res.json() as { error?: string };
  assertEquals(data.error, "Internal configuration error");
});
Deno.test("runtime-host service fetch error paths - returns 404 for unknown /forward/ sub-paths", async () => {
  const verifyProxyToken = spy((_token: string) =>
    Promise.resolve({ sessionId: "sess-1", spaceId: "sp-1" })
  );
  const takosWebFetch = spy((_request: Request) =>
    Promise.resolve(new Response())
  );
  const env: RuntimeHostEnv = {
    RUNTIME_CONTAINER: {
      getByName: () => ({ ...makeUnusedStubMethods(), verifyProxyToken }),
    },
    TAKOS_WORKER: { fetch: takosWebFetch },
    ADMIN_DOMAIN: "test.takos.jp",
    PLATFORM_PUBLIC_KEY: "test-public-key",
    PROXY_BASE_URL: "",
  };

  const res = await runtimeHost.fetch(
    new Request("https://runtime-host/forward/unknown-path", {
      headers: { Authorization: "Bearer valid-token" },
    }),
    env,
  );
  assertEquals(res.status, 404);
  assertSpyCalls(takosWebFetch, 0);
});
Deno.test("runtime-host service fetch error paths - returns 401 when /forward/api-proxy lacks X-Takos-Session-Id header", async () => {
  const verifyProxyToken = spy((_token: string) =>
    Promise.resolve({ sessionId: "sess-1", spaceId: "sp-1" })
  );
  const takosWebFetch = spy((_request: Request) =>
    Promise.resolve(new Response())
  );
  const env: RuntimeHostEnv = {
    RUNTIME_CONTAINER: {
      getByName: () => ({ ...makeUnusedStubMethods(), verifyProxyToken }),
    },
    TAKOS_WORKER: { fetch: takosWebFetch },
    ADMIN_DOMAIN: "test.takos.jp",
    PLATFORM_PUBLIC_KEY: "test-public-key",
    PROXY_BASE_URL: "",
  };

  const res = await runtimeHost.fetch(
    new Request("https://runtime-host/forward/api-proxy/api/repos/r1/status", {
      headers: { Authorization: "Bearer valid-token" },
      // Missing X-Takos-Session-Id
    }),
    env,
  );
  assertEquals(res.status, 401);
  assertSpyCalls(takosWebFetch, 0);
});
Deno.test("runtime-host service fetch error paths - returns 401 when /forward/api-proxy session does not match proxy token", async () => {
  const verifyProxyToken = spy((_token: string) =>
    Promise.resolve({ sessionId: "sess-1", spaceId: "sp-1" })
  );
  const takosWebFetch = spy((_request: Request) =>
    Promise.resolve(new Response())
  );
  const env: RuntimeHostEnv = {
    RUNTIME_CONTAINER: {
      getByName: () => ({ ...makeUnusedStubMethods(), verifyProxyToken }),
    },
    TAKOS_WORKER: { fetch: takosWebFetch },
    ADMIN_DOMAIN: "test.takos.jp",
    PLATFORM_PUBLIC_KEY: "test-public-key",
    PROXY_BASE_URL: "",
  };

  const res = await runtimeHost.fetch(
    new Request("https://runtime-host/forward/api-proxy/api/repos/r1/status", {
      headers: {
        Authorization: "Bearer valid-token",
        "X-Takos-Session-Id": "sess-2",
      },
    }),
    env,
  );
  assertEquals(res.status, 401);
  assertSpyCalls(takosWebFetch, 0);
});
Deno.test("runtime-host service fetch error paths - correctly strips /forward/api-proxy from the path when proxying", async () => {
  const takosWebFetch = spy((_request: Request) =>
    Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
  );
  const verifyProxyToken = spy((_token: string) =>
    Promise.resolve({ sessionId: "sess-1", spaceId: "sp-1" })
  );
  const env: RuntimeHostEnv = {
    RUNTIME_CONTAINER: {
      getByName: () => ({ ...makeUnusedStubMethods(), verifyProxyToken }),
    },
    TAKOS_WORKER: { fetch: takosWebFetch },
    ADMIN_DOMAIN: "test.takos.jp",
    PLATFORM_PUBLIC_KEY: "test-public-key",
    PROXY_BASE_URL: "",
  };

  await runtimeHost.fetch(
    new Request(
      "https://runtime-host/forward/api-proxy/api/repos/r1/tree?ref=main",
      {
        headers: {
          Authorization: "Bearer valid-token",
          "X-Takos-Session-Id": "sess-1",
        },
      },
    ),
    env,
  );

  const proxiedRequest = takosWebFetch.calls[0]?.args[0];
  assert(proxiedRequest instanceof Request);
  assertEquals(
    proxiedRequest.url,
    "https://takos/api/repos/r1/tree?ref=main",
  );
});
Deno.test("runtime-host service fetch error paths - proxies heartbeat with correct URL format", async () => {
  const takosWebFetch = spy((_request: Request) =>
    Promise.resolve(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    )
  );
  const verifyProxyToken = spy((_token: string) =>
    Promise.resolve({ sessionId: "my-session-id", spaceId: "sp-1" })
  );
  const env: RuntimeHostEnv = {
    RUNTIME_CONTAINER: {
      getByName: () => ({ ...makeUnusedStubMethods(), verifyProxyToken }),
    },
    TAKOS_WORKER: { fetch: takosWebFetch },
    ADMIN_DOMAIN: "test.takos.jp",
    PLATFORM_PUBLIC_KEY: "test-public-key",
    PROXY_BASE_URL: "",
  };

  await runtimeHost.fetch(
    new Request("https://runtime-host/forward/heartbeat/my-session-id", {
      method: "POST",
      headers: { Authorization: "Bearer valid-token" },
    }),
    env,
  );

  const proxiedRequest = takosWebFetch.calls[0]?.args[0];
  assert(proxiedRequest instanceof Request);
  assertEquals(
    proxiedRequest.url,
    "https://takos/api/sessions/my-session-id/heartbeat",
  );
  assertEquals(proxiedRequest.method, "POST");
  assertEquals(proxiedRequest.headers.get("X-Takos-Internal-Marker"), "1");
  assertEquals(proxiedRequest.headers.get("X-Takos-Internal"), null);
  assertEquals(
    proxiedRequest.headers.get("X-Takos-Session-Id"),
    "my-session-id",
  );
  assertEquals(proxiedRequest.headers.get("X-Takos-Space-Id"), "sp-1");
});
Deno.test("runtime-host service fetch error paths - returns 401 when /forward/heartbeat session does not match proxy token", async () => {
  const takosWebFetch = spy((_request: Request) =>
    Promise.resolve(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    )
  );
  const verifyProxyToken = spy((_token: string) =>
    Promise.resolve({ sessionId: "sess-1", spaceId: "sp-1" })
  );
  const env: RuntimeHostEnv = {
    RUNTIME_CONTAINER: {
      getByName: () => ({ ...makeUnusedStubMethods(), verifyProxyToken }),
    },
    TAKOS_WORKER: { fetch: takosWebFetch },
    ADMIN_DOMAIN: "test.takos.jp",
    PLATFORM_PUBLIC_KEY: "test-public-key",
    PROXY_BASE_URL: "",
  };

  const res = await runtimeHost.fetch(
    new Request("https://runtime-host/forward/heartbeat/sess-2", {
      method: "POST",
      headers: { Authorization: "Bearer valid-token" },
    }),
    env,
  );

  assertEquals(res.status, 401);
  assertSpyCalls(takosWebFetch, 0);
});
Deno.test("runtime-host service fetch error paths - returns 500 when container fetch throws", async () => {
  const stubFetch = (
    _input: RequestInfo | URL,
    _init?: RequestInit,
  ): Promise<Response> => {
    throw new Error("container crashed");
  };
  const env: RuntimeHostEnv = {
    RUNTIME_CONTAINER: {
      getByName: () => ({
        fetch: stubFetch,
        generateSessionProxyToken: () =>
          Promise.reject(
            new Error(
              "RuntimeContainerStub.generateSessionProxyToken should not be called in this test",
            ),
          ),
        verifyProxyToken: () => Promise.resolve(null),
      }),
    },
    ADMIN_DOMAIN: "test.takos.jp",
    PLATFORM_PUBLIC_KEY: "test-public-key",
    PROXY_BASE_URL: "",
  };

  const res = await runtimeHost.fetch(
    new Request("https://runtime-host/api/runtime/ping"),
    env,
  );
  assertEquals(res.status, 500);
  const text = await res.text();
  assertStringIncludes(text, "container crashed");
});
Deno.test("runtime-host service fetch handler - revokes session tokens after successful destroy", async () => {
  const revokeSessionProxyTokens = spy((_sessionId: string) =>
    Promise.resolve(1)
  );
  const stubFetch = spy(
    (_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      ),
  );
  const env: RuntimeHostEnv = {
    RUNTIME_CONTAINER: {
      getByName: () => ({
        fetch: stubFetch,
        generateSessionProxyToken: () =>
          Promise.reject(
            new Error(
              "RuntimeContainerStub.generateSessionProxyToken should not be called in this test",
            ),
          ),
        verifyProxyToken: () => Promise.resolve(null),
        revokeSessionProxyTokens,
      }),
    },
    ADMIN_DOMAIN: "test.takos.jp",
    PLATFORM_PUBLIC_KEY: "test-public-key",
    PROXY_BASE_URL: "",
  };

  const res = await runtimeHost.fetch(
    new Request("https://runtime-host/session/destroy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: "sess-1", space_id: "sp-1" }),
    }),
    env,
  );

  assertEquals(res.status, 200);
  assertSpyCalls(stubFetch, 1);
  assertSpyCallArgs(revokeSessionProxyTokens, 0, ["sess-1"]);
});
