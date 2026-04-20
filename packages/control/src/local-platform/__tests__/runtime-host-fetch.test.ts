import { assertEquals } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

import { buildLocalRuntimeHostFetch } from "../runtime-host-fetch.ts";
import type { LocalRuntimeGatewayStub } from "../runtime-types.ts";

function createRuntimeNamespace(stub: LocalRuntimeGatewayStub) {
  return {
    getByName: () => stub,
    idFromName: () => "singleton",
    get: () => stub,
  };
}

Deno.test("local runtime-host rejects JWT-looking /forward/cli-proxy requests without a valid proxy token", async () => {
  const runtimeFetch = spy(async (_request: Request) =>
    new Response(JSON.stringify({ ok: true }), { status: 200 })
  );
  const stub: LocalRuntimeGatewayStub = {
    fetch: runtimeFetch,
    verifyProxyToken: async () => null,
    revokeSessionProxyTokens: async () => 0,
  };
  const fetch = await buildLocalRuntimeHostFetch({
    RUNTIME_CONTAINER: createRuntimeNamespace(stub) as never,
  });

  const response = await fetch(
    new Request(
      "http://runtime-host/forward/cli-proxy/api/repos/repo-1/status?ref=main",
      {
        method: "GET",
        headers: {
          Authorization: "Bearer header.payload.signature",
          "X-Takos-Session-Id": "session-id",
          "X-Takos-Space-Id": "space-a",
        },
      },
    ),
  );

  assertEquals(response.status, 401);
  assertSpyCalls(runtimeFetch, 0);
});

Deno.test("local runtime-host keeps proxy-token /forward/cli-proxy requests on the control API path", async () => {
  const runtimeFetch = spy(async (_request: Request) =>
    new Response("unexpected runtime fetch", { status: 500 })
  );
  const takosWebFetch = spy(async (_request: Request) =>
    new Response(JSON.stringify({ ok: true }), { status: 200 })
  );
  const stub: LocalRuntimeGatewayStub = {
    fetch: runtimeFetch,
    verifyProxyToken: async (token: string) =>
      token === "proxy-token"
        ? { sessionId: "session-id", spaceId: "space-a" }
        : null,
    revokeSessionProxyTokens: async () => 0,
  };
  const fetch = await buildLocalRuntimeHostFetch({
    RUNTIME_CONTAINER: createRuntimeNamespace(stub) as never,
    TAKOS_WEB: { fetch: takosWebFetch },
  });

  const response = await fetch(
    new Request(
      "http://runtime-host/forward/cli-proxy/api/repos/repo-1/status",
      {
        method: "GET",
        headers: {
          Authorization: "Bearer proxy-token",
          "X-Takos-Session-Id": "session-id",
        },
      },
    ),
  );

  assertEquals(response.status, 200);
  assertSpyCalls(runtimeFetch, 0);
  assertSpyCalls(takosWebFetch, 1);
  const forwarded = takosWebFetch.calls[0]!.args[0] as Request;
  assertEquals(forwarded.url, "http://takos/api/repos/repo-1/status");
  assertEquals(forwarded.headers.get("X-Takos-Internal-Marker"), "1");
  assertEquals(forwarded.headers.get("X-Takos-Session-Id"), "session-id");
  assertEquals(forwarded.headers.get("X-Takos-Space-Id"), "space-a");
});

Deno.test("local runtime-host rejects proxy-token /forward/cli-proxy when session header does not match token", async () => {
  const takosWebFetch = spy(async (_request: Request) =>
    new Response(JSON.stringify({ ok: true }), { status: 200 })
  );
  const stub: LocalRuntimeGatewayStub = {
    fetch: async () =>
      new Response("unexpected runtime fetch", { status: 500 }),
    verifyProxyToken: async (token: string) =>
      token === "proxy-token"
        ? { sessionId: "session-id", spaceId: "space-a" }
        : null,
    revokeSessionProxyTokens: async () => 0,
  };
  const fetch = await buildLocalRuntimeHostFetch({
    RUNTIME_CONTAINER: createRuntimeNamespace(stub) as never,
    TAKOS_WEB: { fetch: takosWebFetch },
  });

  const response = await fetch(
    new Request(
      "http://runtime-host/forward/cli-proxy/api/repos/repo-1/status",
      {
        method: "GET",
        headers: {
          Authorization: "Bearer proxy-token",
          "X-Takos-Session-Id": "other-session-id",
        },
      },
    ),
  );

  assertEquals(response.status, 401);
  assertSpyCalls(takosWebFetch, 0);
});

Deno.test("local runtime-host rejects proxy-token /forward/heartbeat when path session does not match token", async () => {
  const takosWebFetch = spy(async (_request: Request) =>
    new Response(JSON.stringify({ ok: true }), { status: 200 })
  );
  const stub: LocalRuntimeGatewayStub = {
    fetch: async () =>
      new Response("unexpected runtime fetch", { status: 500 }),
    verifyProxyToken: async (token: string) =>
      token === "proxy-token"
        ? { sessionId: "session-id", spaceId: "space-a" }
        : null,
    revokeSessionProxyTokens: async () => 0,
  };
  const fetch = await buildLocalRuntimeHostFetch({
    RUNTIME_CONTAINER: createRuntimeNamespace(stub) as never,
    TAKOS_WEB: { fetch: takosWebFetch },
  });

  const response = await fetch(
    new Request("http://runtime-host/forward/heartbeat/other-session-id", {
      method: "POST",
      headers: {
        Authorization: "Bearer proxy-token",
      },
    }),
  );

  assertEquals(response.status, 401);
  assertSpyCalls(takosWebFetch, 0);
});
