import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import { assertSpyCalls, spy } from "@takos/test/mock";

import { buildLocalRuntimeHostFetch } from "../runtime-host-fetch.ts";
import type { LocalRuntimeGatewayStub } from "../runtime-types.ts";

function createRuntimeNamespace(stub: LocalRuntimeGatewayStub) {
  return {
    getByName: () => stub,
    idFromName: () => "singleton",
    get: () => stub,
  };
}

test("local runtime-host serves /health without touching the container", async () => {
  const runtimeFetch = spy(async (_request: Request) =>
    new Response("unexpected runtime fetch", { status: 500 })
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
    new Request("http://runtime-host/health", { method: "GET" }),
  );

  assertEquals(response.status, 200);
  assertSpyCalls(runtimeFetch, 0);
});

test("local runtime-host forwards non-health requests to the container stub", async () => {
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
    new Request("http://runtime-host/session/init", { method: "POST" }),
  );

  assertEquals(response.status, 200);
  assertSpyCalls(runtimeFetch, 1);
});

test("local runtime-host injects a proxy token on /sessions creation", async () => {
  let forwarded: Request | undefined;
  const runtimeFetch = spy(async (request: Request) => {
    forwarded = request;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  const stub: LocalRuntimeGatewayStub = {
    fetch: runtimeFetch,
    verifyProxyToken: async () => null,
    revokeSessionProxyTokens: async () => 0,
  };
  const fetch = await buildLocalRuntimeHostFetch({
    RUNTIME_CONTAINER: createRuntimeNamespace(stub) as never,
  });

  await fetch(
    new Request("http://runtime-host/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: "session-id", space_id: "space-a" }),
    }),
  );

  assertSpyCalls(runtimeFetch, 1);
  assertEquals(
    typeof forwarded?.headers.get("X-Takos-Proxy-Token"),
    "string",
  );
});
