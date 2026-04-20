import runtimeHost, {
  buildRuntimeContainerEnv,
  RUNTIME_PROXY_TOKEN_HEADER,
} from "@/runtime/container-hosts/runtime-host.ts";

import { assert, assertEquals } from "jsr:@std/assert";
import {
  assertSpyCallArgs,
  assertSpyCalls,
  spy,
  stub,
} from "jsr:@std/testing/mock";

Deno.test("runtime-host builds the runtime container env from the host worker env", () => {
  assertEquals(
    buildRuntimeContainerEnv({
      ADMIN_DOMAIN: "test.takos.jp",
      PLATFORM_PUBLIC_KEY: "public-key",
      PROXY_BASE_URL: "https://takos-runtime-host-staging.takos.workers.dev",
    }),
    {
      TAKOS_API_URL: "https://test.takos.jp",
      JWT_PUBLIC_KEY: "public-key",
      PROXY_BASE_URL: "https://takos-runtime-host-staging.takos.workers.dev",
    },
  );
});

Deno.test("runtime-host forwards requests through the runtime container DO fetch path", async () => {
  const fetchSpy = spy(async (_request: Request) =>
    new Response("ok", { status: 200 })
  );
  const generateSessionProxyToken = spy(async (
    _sessionId: string,
    _spaceId: string,
  ) => "token");
  const verifyProxyToken = spy(async (_token: string) => null);
  const getByName = spy(() => ({
    fetch: fetchSpy,
    generateSessionProxyToken,
    verifyProxyToken,
  }));
  const env = {
    RUNTIME_CONTAINER: { getByName },
    ADMIN_DOMAIN: "test.takos.jp",
    PLATFORM_PUBLIC_KEY: "public-key",
    PROXY_BASE_URL: "https://takos-runtime-host-staging.takos.workers.dev",
  } as unknown as Parameters<typeof runtimeHost.fetch>[1];
  const request = new Request("https://runtime-host/api/runtime/ping");

  const response = await runtimeHost.fetch(request, env);

  assertSpyCallArgs(getByName, 0, ["singleton"]);
  assertSpyCalls(fetchSpy, 1);
  const forwardedRequest = fetchSpy.calls[0]?.args[0];
  assert(forwardedRequest instanceof Request);
  assertEquals(forwardedRequest.url, request.url);
  assertEquals(forwardedRequest.method, request.method);
  assertEquals(response.status, 200);
  assertEquals(await response.text(), "ok");
});

Deno.test("runtime-host injects a proxy token on runtime session creation", async () => {
  const fetchSpy = spy(async (_request: Request) =>
    new Response("ok", { status: 200 })
  );
  const generateSessionProxyToken = spy(async () => "random-proxy-token-123");
  const verifyProxyToken = spy(async (_token: string) => null);
  const env = {
    RUNTIME_CONTAINER: {
      getByName: () => ({
        fetch: fetchSpy,
        generateSessionProxyToken,
        verifyProxyToken,
      }),
    },
    ADMIN_DOMAIN: "test.takos.jp",
    PLATFORM_PUBLIC_KEY: "public-key",
    PROXY_BASE_URL: "https://takos-runtime-host-staging.takos.workers.dev",
  } as unknown as Parameters<typeof runtimeHost.fetch>[1];

  await runtimeHost.fetch(
    new Request("https://runtime-host/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "session-id-1234567890",
        space_id: "space-a",
      }),
    }),
    env,
  );

  assertSpyCallArgs(generateSessionProxyToken, 0, [
    "session-id-1234567890",
    "space-a",
  ]);
  assertSpyCalls(fetchSpy, 1);
  const forwardedRequest = fetchSpy.calls[0]?.args[0];
  assert(forwardedRequest instanceof Request);
  assertEquals(
    forwardedRequest.headers.get(RUNTIME_PROXY_TOKEN_HEADER),
    "random-proxy-token-123",
  );
  assertEquals(await forwardedRequest.json(), {
    session_id: "session-id-1234567890",
    space_id: "space-a",
  });
});

Deno.test("runtime-host proxies /forward/cli-proxy requests to takos via service binding", async () => {
  const takosWebFetch = spy(async (_request: Request) =>
    new Response(JSON.stringify({ ok: true }), { status: 200 })
  );
  const verifyProxyToken = spy(async (_token: string) => ({
    sessionId: "session-id-1234567890",
    spaceId: "space-a",
  }));
  const env = {
    RUNTIME_CONTAINER: {
      getByName: () => ({ verifyProxyToken }),
    },
    TAKOS_WEB: { fetch: takosWebFetch },
    ADMIN_DOMAIN: "test.takos.jp",
    PLATFORM_PUBLIC_KEY: "public-key",
    PROXY_BASE_URL: "https://takos-runtime-host-staging.takos.workers.dev",
  } as unknown as Parameters<typeof runtimeHost.fetch>[1];

  const response = await runtimeHost.fetch(
    new Request(
      "https://runtime-host/forward/cli-proxy/api/repos/repo-1/status",
      {
        method: "GET",
        headers: {
          Authorization: "Bearer valid-proxy-token",
          "X-Takos-Session-Id": "session-id-1234567890",
        },
      },
    ),
    env,
  );

  assertSpyCallArgs(verifyProxyToken, 0, ["valid-proxy-token"]);
  assertSpyCalls(takosWebFetch, 1);
  const proxiedRequest = takosWebFetch.calls[0]?.args[0];
  assert(proxiedRequest instanceof Request);
  assertEquals(proxiedRequest.url, "https://takos/api/repos/repo-1/status");
  // The marker header distinguishes this call from the unrelated
  // `X-Takos-Internal` shared-secret consumed by executor-proxy-api.ts.
  assertEquals(proxiedRequest.headers.get("X-Takos-Internal-Marker"), "1");
  assertEquals(proxiedRequest.headers.get("X-Takos-Internal"), null);
  assertEquals(
    proxiedRequest.headers.get("X-Takos-Session-Id"),
    "session-id-1234567890",
  );
  assertEquals(proxiedRequest.headers.get("X-Takos-Space-Id"), "space-a");
  assertEquals(response.status, 200);
});

Deno.test("runtime-host proxies /forward/heartbeat requests to takos via service binding", async () => {
  const takosWebFetch = spy(async (_request: Request) =>
    new Response(JSON.stringify({ success: true }), { status: 200 })
  );
  const verifyProxyToken = spy(async (_token: string) => ({
    sessionId: "session-id-1234567890",
    spaceId: "space-a",
  }));
  const env = {
    RUNTIME_CONTAINER: {
      getByName: () => ({ verifyProxyToken }),
    },
    TAKOS_WEB: { fetch: takosWebFetch },
    ADMIN_DOMAIN: "test.takos.jp",
    PLATFORM_PUBLIC_KEY: "public-key",
    PROXY_BASE_URL: "https://takos-runtime-host-staging.takos.workers.dev",
  } as unknown as Parameters<typeof runtimeHost.fetch>[1];

  const response = await runtimeHost.fetch(
    new Request(
      "https://runtime-host/forward/heartbeat/session-id-1234567890",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer valid-proxy-token",
        },
      },
    ),
    env,
  );

  assertSpyCallArgs(verifyProxyToken, 0, ["valid-proxy-token"]);
  assertSpyCalls(takosWebFetch, 1);
  const proxiedRequest = takosWebFetch.calls[0]?.args[0];
  assert(proxiedRequest instanceof Request);
  assertEquals(
    proxiedRequest.url,
    "https://takos/api/sessions/session-id-1234567890/heartbeat",
  );
  assertEquals(proxiedRequest.headers.get("X-Takos-Internal-Marker"), "1");
  assertEquals(proxiedRequest.headers.get("X-Takos-Internal"), null);
  assertEquals(
    proxiedRequest.headers.get("X-Takos-Session-Id"),
    "session-id-1234567890",
  );
  assertEquals(proxiedRequest.headers.get("X-Takos-Space-Id"), "space-a");
  assertEquals(response.status, 200);
});

Deno.test("runtime-host rejects /forward/* requests without a valid proxy token", async () => {
  const verifyProxyToken = spy(async (_token: string) => null);
  const env = {
    RUNTIME_CONTAINER: {
      getByName: () => ({ verifyProxyToken }),
    },
    ADMIN_DOMAIN: "test.takos.jp",
    PLATFORM_PUBLIC_KEY: "public-key",
    PROXY_BASE_URL: "https://takos-runtime-host-staging.takos.workers.dev",
  } as unknown as Parameters<typeof runtimeHost.fetch>[1];

  const response = await runtimeHost.fetch(
    new Request(
      "https://runtime-host/forward/cli-proxy/api/repos/repo-1/status",
      {
        method: "GET",
        headers: {
          Authorization: "Bearer invalid-token",
          "X-Takos-Session-Id": "session-id-1234567890",
        },
      },
    ),
    env,
  );

  assertEquals(response.status, 401);
});

Deno.test("runtime-host surfaces startup failures from the runtime container DO fetch path", async () => {
  const consoleError = stub(console, "error", () => {});
  try {
    const fetchSpy = spy(async (_request: Request) => {
      throw new Error("The container is not running, consider calling start()");
    });
    const generateSessionProxyToken = spy(async (
      _sessionId: string,
      _spaceId: string,
    ) => "token");
    const verifyProxyToken = spy(async (_token: string) => null);
    const env = {
      RUNTIME_CONTAINER: {
        getByName: () => ({
          fetch: fetchSpy,
          generateSessionProxyToken,
          verifyProxyToken,
        }),
      },
      ADMIN_DOMAIN: "test.takos.jp",
      PLATFORM_PUBLIC_KEY: "public-key",
      PROXY_BASE_URL: "https://takos-runtime-host-staging.takos.workers.dev",
    } as unknown as Parameters<typeof runtimeHost.fetch>[1];

    const response = await runtimeHost.fetch(
      new Request("https://runtime-host/api/runtime/ping"),
      env,
    );

    assertEquals(response.status, 500);
    assertEquals(
      await response.text(),
      "Failed to start container: The container is not running, consider calling start()",
    );
  } finally {
    consoleError.restore();
  }
});
