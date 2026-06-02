import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import { assertSpyCalls, spy } from "@takos/test/mock";

import runtimeHost, {
  buildRuntimeContainerEnv,
  CONTAINER_EGRESS_PROXY_ENV,
  normalizeGatedEgressProxyUrl,
} from "../runtime-host.ts";

function createRuntimeNamespace(stub: {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  generateSessionProxyToken(
    sessionId: string,
    spaceId: string,
  ): Promise<string>;
  verifyProxyToken(token: string): Promise<
    { sessionId: string; spaceId: string } | null
  >;
  revokeSessionProxyTokens?(sessionId: string): Promise<number>;
}) {
  return {
    getByName: () => stub,
  };
}

function createStub(runtimeFetch: (request: Request) => Promise<Response>) {
  return {
    fetch: runtimeFetch,
    generateSessionProxyToken: async () => "proxy-token",
    verifyProxyToken: async () => null,
    revokeSessionProxyTokens: async () => 0,
  };
}

const baseEnv = {
  ADMIN_DOMAIN: "admin.localhost",
  PROXY_BASE_URL: "http://proxy.localhost",
  PLATFORM_PUBLIC_KEY: "public-key",
};

test("runtime-host serves /health without touching the container", async () => {
  const runtimeFetch = spy(async (_request: Request) =>
    new Response("unexpected runtime fetch", { status: 500 })
  );
  const response = await runtimeHost.fetch(
    new Request("http://runtime-host/health", { method: "GET" }),
    {
      RUNTIME_CONTAINER: createRuntimeNamespace(createStub(runtimeFetch)),
      ...baseEnv,
    } as never,
  );

  assertEquals(response.status, 200);
  assertSpyCalls(runtimeFetch, 0);
});

test("buildRuntimeContainerEnv omits the egress proxy by default (no open/direct fallback)", () => {
  const containerEnv = buildRuntimeContainerEnv({
    ADMIN_DOMAIN: "admin.localhost",
    PROXY_BASE_URL: "http://proxy.localhost",
    PLATFORM_PUBLIC_KEY: "public-key",
  });

  // No egress proxy unless an explicit gated URL is configured. The container's
  // direct outbound must be denied by the infra network policy, not by handing
  // it the control back-channel as a transparent proxy.
  assertEquals(CONTAINER_EGRESS_PROXY_ENV in containerEnv, false);
  // PROXY_BASE_URL is the control back-channel only; it must never become the
  // egress proxy value.
  assertEquals(containerEnv.PROXY_BASE_URL, "http://proxy.localhost");
});

test("buildRuntimeContainerEnv emits a configured gated egress proxy URL", () => {
  const containerEnv = buildRuntimeContainerEnv({
    ADMIN_DOMAIN: "admin.localhost",
    PROXY_BASE_URL: "http://proxy.localhost",
    TAKOS_EGRESS_PROXY_URL: "https://egress.gated.example/proxy",
  });

  assertEquals(
    containerEnv[CONTAINER_EGRESS_PROXY_ENV],
    "https://egress.gated.example/proxy",
  );
});

test("buildRuntimeContainerEnv drops an unsafe egress proxy value (fails closed)", () => {
  // Credentialed and non-HTTP(S) proxy values must not be propagated to the
  // untrusted container; the var is omitted rather than forwarded.
  for (
    const unsafe of [
      "https://user:pass@egress.example/proxy",
      "ftp://egress.example/proxy",
      "not a url",
      "   ",
    ]
  ) {
    const containerEnv = buildRuntimeContainerEnv({
      ADMIN_DOMAIN: "admin.localhost",
      PROXY_BASE_URL: "http://proxy.localhost",
      TAKOS_EGRESS_PROXY_URL: unsafe,
    });
    assertEquals(
      CONTAINER_EGRESS_PROXY_ENV in containerEnv,
      false,
      `expected unsafe egress proxy to be dropped: ${unsafe}`,
    );
  }
});

test("normalizeGatedEgressProxyUrl accepts http(s) and rejects unsafe values", () => {
  assertEquals(
    normalizeGatedEgressProxyUrl("https://egress.example/proxy"),
    "https://egress.example/proxy",
  );
  assertEquals(normalizeGatedEgressProxyUrl(undefined), null);
  assertEquals(normalizeGatedEgressProxyUrl(""), null);
  assertEquals(
    normalizeGatedEgressProxyUrl("https://u:p@egress.example"),
    null,
  );
  assertEquals(normalizeGatedEgressProxyUrl("ftp://egress.example"), null);
  assertEquals(normalizeGatedEgressProxyUrl("garbage"), null);
});

test("runtime-host forwards non-health requests to the container stub", async () => {
  const runtimeFetch = spy(async (_request: Request) =>
    new Response(JSON.stringify({ ok: true }), { status: 200 })
  );
  const response = await runtimeHost.fetch(
    new Request("http://runtime-host/session/init", { method: "POST" }),
    {
      RUNTIME_CONTAINER: createRuntimeNamespace(createStub(runtimeFetch)),
      ...baseEnv,
    } as never,
  );

  assertEquals(response.status, 200);
  assertSpyCalls(runtimeFetch, 1);
});
