import { strict as assert } from "node:assert";
import runtimeHost, {
  buildRuntimeContainerEnv,
  RUNTIME_PROXY_TOKEN_HEADER,
  type RuntimeHostEnv,
} from "@/runtime/container-hosts/runtime-host.ts";
import { mock, test } from "bun:test";

test("runtime-host builds the runtime container env from the host worker env", () => {
  assert.deepStrictEqual(
    buildRuntimeContainerEnv({
      ADMIN_DOMAIN: "test.takos.jp",
      PLATFORM_PUBLIC_KEY: "public-key",
      PROXY_BASE_URL: "https://staging-admin.example.com",
    }),
    {
      TAKOS_API_URL: "https://test.takos.jp",
      JWT_PUBLIC_KEY: "public-key",
      PROXY_BASE_URL: "https://staging-admin.example.com",
    },
  );
});

test("runtime-host forwards requests through the runtime container DO fetch path", async () => {
  const fetchSpy = mock(async (_request: Request) =>
    new Response("ok", { status: 200 })
  );
  const generateSessionProxyToken = mock(async (
    _sessionId: string,
    _spaceId: string,
  ) => "token");
  const verifyProxyToken = mock(async (_token: string) => null);
  const getByName = mock(() => ({
    fetch: fetchSpy,
    generateSessionProxyToken,
    verifyProxyToken,
  }));
  const env = {
    RUNTIME_CONTAINER: { getByName },
    ADMIN_DOMAIN: "test.takos.jp",
    PLATFORM_PUBLIC_KEY: "public-key",
    PROXY_BASE_URL: "https://staging-admin.example.com",
  } as RuntimeHostEnv;
  const request = new Request("https://runtime-host/api/runtime/ping");

  const response = await runtimeHost.fetch(request, env);

  assert.deepStrictEqual(getByName.mock.calls[0], ["singleton"]);
  assert.deepStrictEqual(fetchSpy.mock.calls.length, 1);
  const forwardedRequest = fetchSpy.mock.calls[0]?.[0];
  assert.ok(forwardedRequest instanceof Request);
  assert.deepStrictEqual(forwardedRequest.url, request.url);
  assert.deepStrictEqual(forwardedRequest.method, request.method);
  assert.deepStrictEqual(response.status, 200);
  assert.deepStrictEqual(await response.text(), "ok");
});

test("runtime-host injects a proxy token on runtime session creation", async () => {
  const fetchSpy = mock(async (_request: Request) =>
    new Response("ok", { status: 200 })
  );
  const generateSessionProxyToken = mock(async () => "random-proxy-token-123");
  const verifyProxyToken = mock(async (_token: string) => null);
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
    PROXY_BASE_URL: "https://staging-admin.example.com",
  } as RuntimeHostEnv;

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

  assert.deepStrictEqual(
    generateSessionProxyToken.mock.calls[0],
    ["session-id-1234567890", "space-a"],
  );
  assert.deepStrictEqual(fetchSpy.mock.calls.length, 1);
  const forwardedRequest = fetchSpy.mock.calls[0]?.[0];
  assert.ok(forwardedRequest instanceof Request);
  assert.deepStrictEqual(
    forwardedRequest.headers.get(RUNTIME_PROXY_TOKEN_HEADER),
    "random-proxy-token-123",
  );
  assert.deepStrictEqual(await forwardedRequest.json(), {
    session_id: "session-id-1234567890",
    space_id: "space-a",
  });
});

test("runtime-host surfaces startup failures from the runtime container DO fetch path", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const fetchSpy = mock(async (_request: Request) => {
      throw new Error("The container is not running, consider calling start()");
    });
    const generateSessionProxyToken = mock(async (
      _sessionId: string,
      _spaceId: string,
    ) => "token");
    const verifyProxyToken = mock(async (_token: string) => null);
    const env: RuntimeHostEnv = {
      RUNTIME_CONTAINER: {
        getByName: () => ({
          fetch: fetchSpy,
          generateSessionProxyToken,
          verifyProxyToken,
        }),
      },
      ADMIN_DOMAIN: "test.takos.jp",
      PLATFORM_PUBLIC_KEY: "public-key",
      PROXY_BASE_URL: "https://staging-admin.example.com",
    };

    const response = await runtimeHost.fetch(
      new Request("https://runtime-host/api/runtime/ping"),
      env,
    );

    assert.deepStrictEqual(response.status, 500);
    assert.deepStrictEqual(
      await response.text(),
      "Failed to start container: The container is not running, consider calling start()",
    );
  } finally {
    console.error = originalConsoleError;
  }
});
