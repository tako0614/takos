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
  TakosRuntimeContainer,
} from "@/container-hosts/runtime-host";
import runtimeHost from "@/container-hosts/runtime-host";

// ---------------------------------------------------------------------------
// buildRuntimeContainerEnv
// ---------------------------------------------------------------------------

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "jsr:@std/assert";
import { assertSpyCallArgs, assertSpyCalls, spy } from "jsr:@std/testing/mock";

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
Deno.test("buildRuntimeContainerEnv - includes JWT_PUBLIC_KEY when provided", () => {
  const result = buildRuntimeContainerEnv({
    ADMIN_DOMAIN: "test.takos.jp",
    PROXY_BASE_URL: "",
    JWT_PUBLIC_KEY: "my-public-key",
  });
  assertEquals(result.JWT_PUBLIC_KEY, "my-public-key");
});
Deno.test("buildRuntimeContainerEnv - omits JWT_PUBLIC_KEY when undefined", () => {
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
let mockStorage: Map<string, unknown>;
Deno.test("TakosRuntimeContainer proxy token lifecycle - generates and verifies a proxy token", async () => {
  mockStorage = new Map();
  const mockCtx = {
    storage: {
      get: async (key: string) => mockStorage.get(key) ?? undefined,
      put: async (key: string, value: unknown) => {
        mockStorage.set(key, value);
      },
    },
  };
  const mockEnv = {
    ADMIN_DOMAIN: "test.takos.jp",
    PROXY_BASE_URL: "https://proxy.workers.dev",
  };

  container = new TakosRuntimeContainer(mockCtx as any, mockEnv as any);
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
  const mockCtx = {
    storage: {
      get: async (key: string) => mockStorage.get(key) ?? undefined,
      put: async (key: string, value: unknown) => {
        mockStorage.set(key, value);
      },
    },
  };
  const mockEnv = {
    ADMIN_DOMAIN: "test.takos.jp",
    PROXY_BASE_URL: "https://proxy.workers.dev",
  };

  container = new TakosRuntimeContainer(mockCtx as any, mockEnv as any);
  const info = await container.verifyProxyToken("unknown-token-abc");
  assertEquals(info, null);
});
Deno.test("TakosRuntimeContainer proxy token lifecycle - supports multiple tokens concurrently", async () => {
  mockStorage = new Map();
  const mockCtx = {
    storage: {
      get: async (key: string) => mockStorage.get(key) ?? undefined,
      put: async (key: string, value: unknown) => {
        mockStorage.set(key, value);
      },
    },
  };
  const mockEnv = {
    ADMIN_DOMAIN: "test.takos.jp",
    PROXY_BASE_URL: "https://proxy.workers.dev",
  };

  container = new TakosRuntimeContainer(mockCtx as any, mockEnv as any);
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
  const mockCtx = {
    storage: {
      get: async (key: string) => mockStorage.get(key) ?? undefined,
      put: async (key: string, value: unknown) => {
        mockStorage.set(key, value);
      },
    },
  };
  const mockEnv = {
    ADMIN_DOMAIN: "test.takos.jp",
    PROXY_BASE_URL: "https://proxy.workers.dev",
  };

  container = new TakosRuntimeContainer(mockCtx as any, mockEnv as any);
  await container.generateSessionProxyToken("s1", "sp1");

  const stored = mockStorage.get("proxyTokens") as Record<string, unknown>;
  assert(stored !== undefined);
  assertEquals(Object.keys(stored).length, 1);
});
Deno.test("TakosRuntimeContainer proxy token lifecycle - loads tokens from storage on first verify when cache is empty", async () => {
  mockStorage = new Map();
  const mockCtx = {
    storage: {
      get: async (key: string) => mockStorage.get(key) ?? undefined,
      put: async (key: string, value: unknown) => {
        mockStorage.set(key, value);
      },
    },
  };
  const mockEnv = {
    ADMIN_DOMAIN: "test.takos.jp",
    PROXY_BASE_URL: "https://proxy.workers.dev",
  };

  container = new TakosRuntimeContainer(mockCtx as any, mockEnv as any);
  // Simulate previously stored token
  mockStorage.set("proxyTokens", {
    "pre-existing-token": { sessionId: "s-old", spaceId: "sp-old" },
  });

  // Create a fresh container (cache is null)
  const freshCtx = {
    storage: {
      get: async (key: string) => mockStorage.get(key) ?? undefined,
      put: async (key: string, value: unknown) => {
        mockStorage.set(key, value);
      },
    },
  };
  const freshContainer = new TakosRuntimeContainer(freshCtx as any, {
    ADMIN_DOMAIN: "test.takos.jp",
    PROXY_BASE_URL: "",
  } as any);

  const info = await freshContainer.verifyProxyToken("pre-existing-token");
  assertEquals(info, { sessionId: "s-old", spaceId: "sp-old" });
});
Deno.test("TakosRuntimeContainer proxy token lifecycle - returns null when storage is empty and token is unknown", async () => {
  mockStorage = new Map();
  const mockCtx = {
    storage: {
      get: async (key: string) => mockStorage.get(key) ?? undefined,
      put: async (key: string, value: unknown) => {
        mockStorage.set(key, value);
      },
    },
  };
  const mockEnv = {
    ADMIN_DOMAIN: "test.takos.jp",
    PROXY_BASE_URL: "https://proxy.workers.dev",
  };

  container = new TakosRuntimeContainer(mockCtx as any, mockEnv as any);
  // Storage has no proxyTokens key
  const freshCtx = {
    storage: {
      get: async () => undefined,
      put: ((..._args: any[]) => undefined) as any,
    },
  };
  const freshContainer = new TakosRuntimeContainer(freshCtx as any, {
    ADMIN_DOMAIN: "test.takos.jp",
    PROXY_BASE_URL: "",
  } as any);

  const info = await freshContainer.verifyProxyToken("nonexistent");
  assertEquals(info, null);
});
// ---------------------------------------------------------------------------
// buildRuntimeForwardRequest
// ---------------------------------------------------------------------------

function makeStub(overrides: Partial<Record<string, any>> = {}): any {
  return {
    generateSessionProxyToken: spy(
      async (_sessionId: string, _spaceId: string) => "generated-token",
    ),
    ...overrides,
  };
}

function makeEnv(): any {
  return {
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
// Worker fetch handler — error paths
// ---------------------------------------------------------------------------

Deno.test("runtime-host worker fetch error paths - returns 401 when /forward/ request has no Authorization header", async () => {
  const env = {
    RUNTIME_CONTAINER: {
      getByName: () => ({
        verifyProxyToken: ((..._args: any[]) => undefined) as any,
      }),
    },
    ADMIN_DOMAIN: "test.takos.jp",
    PROXY_BASE_URL: "",
  } as unknown as any;

  const res = await runtimeHost.fetch(
    new Request("https://runtime-host/forward/cli-proxy/api/test"),
    env,
  );
  assertEquals(res.status, 401);
});
Deno.test("runtime-host worker fetch error paths - returns 401 when /forward/ request has invalid token", async () => {
  const verifyProxyToken = spy(async (_token: string) => null);
  const env = {
    RUNTIME_CONTAINER: {
      getByName: () => ({ verifyProxyToken }),
    },
    ADMIN_DOMAIN: "test.takos.jp",
    PROXY_BASE_URL: "",
  } as unknown as any;

  const res = await runtimeHost.fetch(
    new Request("https://runtime-host/forward/cli-proxy/api/test", {
      headers: { Authorization: "Bearer bad-token" },
    }),
    env,
  );
  assertEquals(res.status, 401);
  assertSpyCallArgs(verifyProxyToken, 0, ["bad-token"]);
});
Deno.test("runtime-host worker fetch error paths - returns 500 when TAKOS_WEB is not configured for /forward/ requests", async () => {
  const verifyProxyToken = spy(async (_token: string) => ({
    sessionId: "sess-1",
    spaceId: "sp-1",
  }));
  const env = {
    RUNTIME_CONTAINER: {
      getByName: () => ({ verifyProxyToken }),
    },
    ADMIN_DOMAIN: "test.takos.jp",
    PROXY_BASE_URL: "",
    // No TAKOS_WEB
  } as unknown as any;

  const res = await runtimeHost.fetch(
    new Request("https://runtime-host/forward/cli-proxy/api/test", {
      headers: {
        Authorization: "Bearer valid-token",
        "X-Takos-Session-Id": "sess-1",
      },
    }),
    env,
  );
  assertEquals(res.status, 500);
  const data = await res.json() as any;
  assertEquals(data.error, "Internal configuration error");
});
Deno.test("runtime-host worker fetch error paths - returns 404 for unknown /forward/ sub-paths", async () => {
  const verifyProxyToken = spy(async (_token: string) => ({
    sessionId: "sess-1",
    spaceId: "sp-1",
  }));
  const takosWebFetch = spy(async (_request: Request) => new Response());
  const env = {
    RUNTIME_CONTAINER: {
      getByName: () => ({ verifyProxyToken }),
    },
    TAKOS_WEB: { fetch: takosWebFetch },
    ADMIN_DOMAIN: "test.takos.jp",
    PROXY_BASE_URL: "",
  } as unknown as any;

  const res = await runtimeHost.fetch(
    new Request("https://runtime-host/forward/unknown-path", {
      headers: { Authorization: "Bearer valid-token" },
    }),
    env,
  );
  assertEquals(res.status, 404);
  assertSpyCalls(takosWebFetch, 0);
});
Deno.test("runtime-host worker fetch error paths - returns 401 when /forward/cli-proxy lacks X-Takos-Session-Id header", async () => {
  const verifyProxyToken = spy(async (_token: string) => ({
    sessionId: "sess-1",
    spaceId: "sp-1",
  }));
  const takosWebFetch = spy(async (_request: Request) => new Response());
  const env = {
    RUNTIME_CONTAINER: {
      getByName: () => ({ verifyProxyToken }),
    },
    TAKOS_WEB: { fetch: takosWebFetch },
    ADMIN_DOMAIN: "test.takos.jp",
    PROXY_BASE_URL: "",
  } as unknown as any;

  const res = await runtimeHost.fetch(
    new Request("https://runtime-host/forward/cli-proxy/api/repos/r1/status", {
      headers: { Authorization: "Bearer valid-token" },
      // Missing X-Takos-Session-Id
    }),
    env,
  );
  assertEquals(res.status, 401);
  assertSpyCalls(takosWebFetch, 0);
});
Deno.test("runtime-host worker fetch error paths - correctly strips /forward/cli-proxy from the path when proxying", async () => {
  const takosWebFetch = spy(async (_request: Request) =>
    new Response(JSON.stringify({ ok: true }), { status: 200 })
  );
  const verifyProxyToken = spy(async (_token: string) => ({
    sessionId: "sess-1",
    spaceId: "sp-1",
  }));
  const env = {
    RUNTIME_CONTAINER: {
      getByName: () => ({ verifyProxyToken }),
    },
    TAKOS_WEB: { fetch: takosWebFetch },
    ADMIN_DOMAIN: "test.takos.jp",
    PROXY_BASE_URL: "",
  } as unknown as any;

  await runtimeHost.fetch(
    new Request(
      "https://runtime-host/forward/cli-proxy/api/repos/r1/tree?ref=main",
      {
        headers: {
          Authorization: "Bearer valid-token",
          "X-Takos-Session-Id": "sess-1",
        },
      },
    ),
    env,
  );

  const proxiedRequest = takosWebFetch.calls[0]?.args[0] as Request;
  assertEquals(
    proxiedRequest.url,
    "https://takos-web/api/repos/r1/tree?ref=main",
  );
});
Deno.test("runtime-host worker fetch error paths - proxies heartbeat with correct URL format", async () => {
  const takosWebFetch = spy(async (_request: Request) =>
    new Response(JSON.stringify({ success: true }), { status: 200 })
  );
  const verifyProxyToken = spy(async (_token: string) => ({
    sessionId: "sess-1",
    spaceId: "sp-1",
  }));
  const env = {
    RUNTIME_CONTAINER: {
      getByName: () => ({ verifyProxyToken }),
    },
    TAKOS_WEB: { fetch: takosWebFetch },
    ADMIN_DOMAIN: "test.takos.jp",
    PROXY_BASE_URL: "",
  } as unknown as any;

  await runtimeHost.fetch(
    new Request("https://runtime-host/forward/heartbeat/my-session-id", {
      method: "POST",
      headers: { Authorization: "Bearer valid-token" },
    }),
    env,
  );

  const proxiedRequest = takosWebFetch.calls[0]?.args[0] as Request;
  assertEquals(
    proxiedRequest.url,
    "https://takos-web/api/sessions/my-session-id/heartbeat",
  );
  assertEquals(proxiedRequest.method, "POST");
  assertEquals(proxiedRequest.headers.get("X-Takos-Internal"), "1");
  assertEquals(
    proxiedRequest.headers.get("X-Takos-Session-Id"),
    "my-session-id",
  );
  assertEquals(proxiedRequest.headers.get("X-Takos-Space-Id"), "sp-1");
});
Deno.test("runtime-host worker fetch error paths - returns 500 when container fetch throws", async () => {
  const stubFetch = async () => {
    throw new Error("container crashed");
  };
  const env = {
    RUNTIME_CONTAINER: {
      getByName: () => ({
        fetch: stubFetch,
        generateSessionProxyToken: ((..._args: any[]) => undefined) as any,
        verifyProxyToken: ((..._args: any[]) => undefined) as any,
      }),
    },
    ADMIN_DOMAIN: "test.takos.jp",
    PROXY_BASE_URL: "",
  } as unknown as any;

  const res = await runtimeHost.fetch(
    new Request("https://runtime-host/api/runtime/ping"),
    env,
  );
  assertEquals(res.status, 500);
  const text = await res.text();
  assertStringIncludes(text, "container crashed");
});
