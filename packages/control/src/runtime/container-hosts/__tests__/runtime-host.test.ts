import { assertEquals } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

import runtimeHost from "../runtime-host.ts";

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

Deno.test("runtime-host rejects JWT-looking /forward/cli-proxy requests without a valid proxy token", async () => {
  const runtimeFetch = spy(async (_request: Request) =>
    new Response("unexpected runtime fetch", { status: 500 })
  );
  const stub = {
    fetch: runtimeFetch,
    generateSessionProxyToken: async () => "proxy-token",
    verifyProxyToken: async () => null,
    revokeSessionProxyTokens: async () => 0,
  };

  const response = await runtimeHost.fetch(
    new Request(
      "http://runtime-host/forward/cli-proxy/api/repos/repo-1/status",
      {
        method: "GET",
        headers: {
          Authorization: "Bearer header.payload.signature",
          "X-Takos-Session-Id": "session-id",
        },
      },
    ),
    {
      RUNTIME_CONTAINER: createRuntimeNamespace(stub),
      ADMIN_DOMAIN: "admin.localhost",
      PROXY_BASE_URL: "http://proxy.localhost",
      PLATFORM_PUBLIC_KEY: "public-key",
    } as never,
  );

  assertEquals(response.status, 401);
  assertSpyCalls(runtimeFetch, 0);
});
