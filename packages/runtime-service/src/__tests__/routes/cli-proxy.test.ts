import { createTestApp, testRequest } from "../setup.ts";

import { assertEquals, assertNotEquals } from "jsr:@std/assert";
import { assertSpyCalls, stub } from "jsr:@std/testing/mock";
import { RUNTIME_REMOTE_ADDR_BINDING } from "../../middleware/rate-limit.ts";

type CliProxyModule = typeof import("../../routes/cli/proxy.ts");

async function freshImport<T>(relativePath: string): Promise<T> {
  const url = new URL(relativePath, import.meta.url);
  url.searchParams.set("test", crypto.randomUUID());
  return await import(url.href) as T;
}

Deno.test("cli-proxy route - forwards query parameters via PROXY_BASE_URL while validating the path only", async () => {
  const originalTakosApiUrl = Deno.env.get("TAKOS_API_URL");
  const originalProxyBaseUrl = Deno.env.get("PROXY_BASE_URL");
  Deno.env.set("TAKOS_API_URL", "https://takos.example.test");
  Deno.env.set("PROXY_BASE_URL", "https://runtime-host.example.test");

  const heartbeatFetchStub = stub(
    globalThis,
    "fetch",
    (async () =>
      new Response(null, {
        status: 204,
      })) as typeof globalThis.fetch,
  );
  const { sessionStore } = await import("../../routes/sessions/storage.ts");

  const sessionId = "a12345678901234b";
  await sessionStore.getSessionDir(
    sessionId,
    "space-a",
    undefined,
    "random-proxy-token-abc",
  );

  heartbeatFetchStub.restore();

  const fetchSpy = stub(
    globalThis,
    "fetch",
    (async (..._args: Parameters<typeof globalThis.fetch>) => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof globalThis.fetch,
  );

  try {
    const { default: cliProxyRoutes } = await freshImport<CliProxyModule>(
      "../../routes/cli/proxy.ts",
    );
    const app = createTestApp();
    app.route("/", cliProxyRoutes);

    const response = await testRequest(app, {
      method: "GET",
      path: "/cli-proxy/api/repos/repo-1/status",
      query: {
        ref: "refs/heads/main",
        verbose: "1",
      },
      headers: {
        "X-Takos-Session-Id": sessionId,
        "X-Takos-Space-Id": "space-a",
      },
    });

    assertEquals(response.status, 200);
    assertEquals(response.body, { ok: true });

    assertSpyCalls(fetchSpy, 1);
    const [forwardedUrl, forwardedOptions] = fetchSpy.calls[0]!.args as [
      string,
      { headers: Record<string, string>; method: string },
    ];

    assertEquals(
      forwardedUrl,
      "https://runtime-host.example.test/forward/cli-proxy/api/repos/repo-1/status?ref=refs%2Fheads%2Fmain&verbose=1",
    );
    assertEquals(forwardedOptions.method, "GET");
    assertEquals(forwardedOptions.headers["X-Takos-Session-Id"], sessionId);
    assertEquals(
      forwardedOptions.headers.Authorization,
      "Bearer random-proxy-token-abc",
    );

    const mismatchedSpace = await testRequest(app, {
      method: "GET",
      path: "/cli-proxy/api/repos/repo-1/status",
      query: {
        ref: "refs/heads/main",
      },
      headers: {
        "X-Takos-Session-Id": sessionId,
        "X-Takos-Space-Id": "space-b",
      },
    });

    assertEquals(mismatchedSpace.status, 403);
    assertEquals(mismatchedSpace.body, {
      error: {
        code: "FORBIDDEN",
        message: "Session does not belong to the specified space",
      },
    });
    assertSpyCalls(fetchSpy, 1);
  } finally {
    fetchSpy.restore();
    await sessionStore.destroySession(sessionId, "space-a");

    if (originalTakosApiUrl === undefined) {
      Deno.env.delete("TAKOS_API_URL");
    } else {
      Deno.env.set("TAKOS_API_URL", originalTakosApiUrl);
    }
    if (originalProxyBaseUrl === undefined) {
      Deno.env.delete("PROXY_BASE_URL");
    } else {
      Deno.env.set("PROXY_BASE_URL", originalProxyBaseUrl);
    }
  }
});

Deno.test({
  name:
    "runtime service - cli-proxy loopback bypass is disabled unless explicitly enabled",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { createRuntimeServiceApp } = await import("../../app.ts");
    const app = createRuntimeServiceApp({ isProduction: false });
    const sessionId = "a12345678901234c";

    const spoofedLoopback = await testRequest(app as never, {
      method: "GET",
      path: "/cli-proxy/api/repos/repo-1/status",
      headers: {
        "X-Takos-Session-Id": sessionId,
        "x-forwarded-for": "127.0.0.1",
      },
    });
    assertEquals(spoofedLoopback.status, 403);
    assertEquals(spoofedLoopback.body, {
      error: {
        code: "FORBIDDEN",
        message: "Authorization header required",
      },
    });
  },
});

Deno.test({
  name:
    "runtime service - explicitly enabled cli-proxy bypass ignores spoofed forwarding headers and uses connection loopback",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { createRuntimeServiceApp } = await import("../../app.ts");
    const app = createRuntimeServiceApp({
      isProduction: false,
      allowLocalCliProxyBypass: true,
    });
    const sessionId = "a12345678901234c";

    const nonLoopback = await testRequest(app as never, {
      method: "GET",
      path: "/cli-proxy/api/repos/repo-1/status",
      headers: {
        "X-Takos-Session-Id": sessionId,
        "x-forwarded-for": "203.0.113.10",
      },
    });
    assertEquals(nonLoopback.status, 403);
    assertEquals(nonLoopback.body, {
      error: {
        code: "FORBIDDEN",
        message: "Authorization header required",
      },
    });

    const spoofedForwardedLoopback = await testRequest(app as never, {
      method: "GET",
      path: "/cli-proxy/api/repos/repo-1/status",
      headers: {
        "X-Takos-Session-Id": sessionId,
        "x-forwarded-for": "127.0.0.1",
        "x-real-ip": "::1",
      },
    });
    assertEquals(spoofedForwardedLoopback.status, 403);
    assertEquals(spoofedForwardedLoopback.body, {
      error: {
        code: "FORBIDDEN",
        message: "Authorization header required",
      },
    });

    const loopback = await app.request(
      "/cli-proxy/api/repos/repo-1/status",
      {
        method: "GET",
        headers: {
          "X-Takos-Session-Id": sessionId,
        },
      },
      { [RUNTIME_REMOTE_ADDR_BINDING]: "127.0.0.1" },
    );
    assertEquals(loopback.status, 403);
    assertEquals(await loopback.json(), {
      error: {
        code: "FORBIDDEN",
        message: "Session not found",
      },
    });

    const invalidToken = await app.request(
      "/cli-proxy/api/repos/repo-1/status",
      {
        method: "GET",
        headers: {
          Authorization: "Bearer invalid-token",
          "X-Takos-Session-Id": sessionId,
        },
      },
      { [RUNTIME_REMOTE_ADDR_BINDING]: "127.0.0.1" },
    );
    assertNotEquals(await invalidToken.json(), {
      error: {
        code: "FORBIDDEN",
        message: "Session not found",
      },
    });
  },
});

Deno.test({
  name:
    "runtime service - loopback cli-proxy bypass rejects mismatched session space",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const heartbeatFetchStub = stub(
      globalThis,
      "fetch",
      (async () =>
        new Response(null, {
          status: 204,
        })) as typeof globalThis.fetch,
    );
    let heartbeatRestored = false;

    try {
      const { createRuntimeServiceApp } = await import("../../app.ts");
      const { sessionStore } = await import("../../routes/sessions/storage.ts");
      const sessionId = "a12345678901234d";
      await sessionStore.getSessionDir(
        sessionId,
        "space-a",
        undefined,
        "random-proxy-token-abc",
      );

      heartbeatFetchStub.restore();
      heartbeatRestored = true;

      const app = createRuntimeServiceApp({
        isProduction: false,
        allowLocalCliProxyBypass: true,
      });
      const fetchSpy = stub(
        globalThis,
        "fetch",
        (async (..._args: Parameters<typeof globalThis.fetch>) => {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }) as typeof globalThis.fetch,
      );

      try {
        const response = await app.request(
          "/cli-proxy/api/repos/repo-1/status",
          {
            method: "GET",
            headers: {
              "X-Takos-Session-Id": sessionId,
              "X-Takos-Space-Id": "space-b",
            },
          },
          { [RUNTIME_REMOTE_ADDR_BINDING]: "127.0.0.1" },
        );

        assertEquals(response.status, 403);
        assertEquals(await response.json(), {
          error: {
            code: "FORBIDDEN",
            message: "Session does not belong to the specified space",
          },
        });
        assertSpyCalls(fetchSpy, 0);
      } finally {
        fetchSpy.restore();
        await sessionStore.destroySession(sessionId, "space-a");
      }
    } finally {
      if (!heartbeatRestored) {
        heartbeatFetchStub.restore();
      }
    }
  },
});
