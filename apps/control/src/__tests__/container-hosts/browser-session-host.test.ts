/**
 * Tests for browser-session-host: Worker fetch handler routes and
 * BrowserSessionContainer class methods.
 *
 * The Worker is a Hono app that delegates to a BrowserSessionContainer
 * Durable Object. We test the routing layer (via app.fetch) and the
 * DO class methods independently.
 */
// [Deno] vi.mock removed - manually stub imports from '@/container-hosts/executor-proxy-config'
// [Deno] vi.mock removed - manually stub imports from '@/utils/hash'
import browserSessionHost, {
  BrowserSessionContainer,
  browserSessionHostDeps,
} from "@/container-hosts/browser-session-host";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { spy } from "jsr:@std/testing/mock";

function makeMockStorage(): any {
  const store = new Map<string, unknown>();
  return {
    get: spy(async (key: string) => store.get(key) ?? null),
    put: spy(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    delete: spy(async (key: string) => {
      store.delete(key);
    }),
    _store: store,
  };
}

function makeMockCtx(): any {
  return {
    storage: makeMockStorage(),
    id: { toString: () => "do-id-abc" },
  };
}

function makeMockTcpPortFetcher(): any {
  return {
    fetch: spy(async () =>
      new Response('{"ok":true}', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    ),
  };
}

function createContainerInstance(): {
  container: BrowserSessionContainer;
  ctx: any;
  tcpPortFetcher: any;
} {
  const ctx = makeMockCtx();
  const env = { BROWSER_CONTAINER: {} } as any;
  const container = new BrowserSessionContainer(ctx, env);

  // Wire up the internal container TCP port mock
  const tcpPortFetcher = makeMockTcpPortFetcher();
  (container as any).container = {
    getTcpPort: () => tcpPortFetcher,
  };

  return { container, ctx, tcpPortFetcher };
}

function makeMockDOStub(overrides: Partial<Record<string, any>> = {}): any {
  return {
    createSession: spy(async () => ({ ok: true, proxyToken: "tok-123" })),
    getSessionState: spy(async () => ({
      sessionId: "sess-1",
      spaceId: "space-1",
      userId: "user-1",
      status: "active",
      createdAt: "2024-01-01T00:00:00Z",
    })),
    destroySession: spy(async () => undefined),
    forwardToContainer: spy(async () =>
      new Response('{"result":"ok"}', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    ),
    verifyProxyToken: spy(async () => null),
    ...overrides,
  };
}

function makeBrowserHostEnv(
  stubOverrides: Partial<Record<string, any>> = {},
): any {
  const stub = makeMockDOStub(stubOverrides);
  return {
    BROWSER_CONTAINER: {
      idFromName: () => ({ toString: () => "do-id" }),
      get: () => stub,
    },
    _stub: stub,
  };
}

async function withDeterministicProxyToken<T>(
  fn: () => Promise<T>,
): Promise<T> {
  const original = browserSessionHostDeps.generateProxyToken;
  browserSessionHostDeps.generateProxyToken = () => "mock-proxy-token-abc123";
  try {
    return await fn();
  } finally {
    browserSessionHostDeps.generateProxyToken = original;
  }
}

// ---------------------------------------------------------------------------
// BrowserSessionContainer class methods
// ---------------------------------------------------------------------------

Deno.test("BrowserSessionContainer - createSession - generates a proxy token and starts the container", async () => {
  await withDeterministicProxyToken(async () => {
    const { container, ctx } = createContainerInstance();

    const result = await container.createSession({
      sessionId: "sess-1",
      spaceId: "space-1",
      userId: "user-1",
      url: "https://example.com",
    });

    assertEquals(result.ok, true);
    assertEquals(result.proxyToken, "mock-proxy-token-abc123");
    assertEquals(ctx.storage._store.get("proxyTokens"), {
      "mock-proxy-token-abc123": {
        sessionId: "sess-1",
        spaceId: "space-1",
        userId: "user-1",
      },
    });
  });
});
Deno.test("BrowserSessionContainer - createSession - sets session state to active after bootstrap", async () => {
  await withDeterministicProxyToken(async () => {
    const { container } = createContainerInstance();

    await container.createSession({
      sessionId: "sess-1",
      spaceId: "space-1",
      userId: "user-1",
    });

    const state = await container.getSessionState();
    assertNotEquals(state, null);
    assertEquals(state!.status, "active");
    assertEquals(state!.sessionId, "sess-1");
  });
});
Deno.test("BrowserSessionContainer - createSession - throws when bootstrap fails", async () => {
  await withDeterministicProxyToken(async () => {
    const { container, tcpPortFetcher } = createContainerInstance();
    tcpPortFetcher.fetch = spy(async () =>
      new Response("container failed", { status: 500 })
    );

    await assertRejects(async () => {
      await container.createSession({
        sessionId: "sess-1",
        spaceId: "space-1",
        userId: "user-1",
      });
    }, "Browser bootstrap failed");
  });
});

Deno.test("BrowserSessionContainer - verifyProxyToken - returns token info for a valid cached token", async () => {
  await withDeterministicProxyToken(async () => {
    const { container } = createContainerInstance();
    await container.createSession({
      sessionId: "sess-1",
      spaceId: "space-1",
      userId: "user-1",
    });

    const info = await container.verifyProxyToken("mock-proxy-token-abc123");
    assertNotEquals(info, null);
    assertEquals(info!.sessionId, "sess-1");
    assertEquals(info!.userId, "user-1");
  });
});
Deno.test("BrowserSessionContainer - verifyProxyToken - returns null for an invalid token", async () => {
  await withDeterministicProxyToken(async () => {
    const { container } = createContainerInstance();
    await container.createSession({
      sessionId: "sess-1",
      spaceId: "space-1",
      userId: "user-1",
    });

    const info = await container.verifyProxyToken("wrong-token");
    assertEquals(info, null);
  });
});
Deno.test("BrowserSessionContainer - verifyProxyToken - loads tokens from storage when cache is empty", async () => {
  const { container, ctx } = createContainerInstance();

  // Simulate a previous session that stored tokens
  ctx.storage._store.set("proxyTokens", {
    "stored-token-xyz": {
      sessionId: "sess-old",
      spaceId: "space-old",
      userId: "user-old",
    },
  });

  // Clear cached tokens by setting internal state
  (container as any).cachedTokens = null;

  const info = await container.verifyProxyToken("stored-token-xyz");
  assertNotEquals(info, null);
  assertEquals(info!.sessionId, "sess-old");
});
Deno.test("BrowserSessionContainer - verifyProxyToken - returns null when no tokens exist in storage", async () => {
  const { container } = createContainerInstance();
  (container as any).cachedTokens = null;

  const info = await container.verifyProxyToken("any-token");
  assertEquals(info, null);
});

Deno.test("BrowserSessionContainer - getSessionState - returns null when no session has been created", async () => {
  const { container } = createContainerInstance();
  const state = await container.getSessionState();
  assertEquals(state, null);
});

Deno.test("BrowserSessionContainer - destroySession - marks session as stopped and clears tokens", async () => {
  const { container, ctx } = createContainerInstance();

  await container.createSession({
    sessionId: "sess-1",
    spaceId: "space-1",
    userId: "user-1",
  });

  await container.destroySession();

  const state = await container.getSessionState();
  assertNotEquals(state, null);
  assertEquals(state!.status, "stopped");
  assertEquals(ctx.storage.delete.calls[0]?.args, ["proxyTokens"]);
});
Deno.test("BrowserSessionContainer - destroySession - handles destroy when no session exists", async () => {
  const { container, ctx } = createContainerInstance();

  // Should not throw
  await container.destroySession();
  assertEquals(ctx.storage.delete.calls[0]?.args, ["proxyTokens"]);
});

// ---------------------------------------------------------------------------
// Per-space concurrent session cap (Round 11 MEDIUM #12)
// ---------------------------------------------------------------------------

Deno.test("BrowserSessionContainer - reserveSlot - accepts the first session for a space", async () => {
  const { container } = createContainerInstance();
  const result = await container.reserveSlot("sess-a");
  assertEquals(result, { ok: true, active: 1 });
});

Deno.test("BrowserSessionContainer - reserveSlot - is idempotent for the same sessionId", async () => {
  const { container } = createContainerInstance();
  const first = await container.reserveSlot("sess-a");
  const second = await container.reserveSlot("sess-a");
  assertEquals(first, { ok: true, active: 1 });
  assertEquals(second, { ok: true, active: 1 });
});

Deno.test(
  "BrowserSessionContainer - reserveSlot - rejects over the MAX_BROWSER_SESSIONS_PER_SPACE cap",
  async () => {
    const { container } = createContainerInstance();
    // Max cap is 5 — fill it up.
    for (const id of ["a", "b", "c", "d", "e"]) {
      const r = await container.reserveSlot(`sess-${id}`);
      assertEquals(r.ok, true);
    }
    const over = await container.reserveSlot("sess-f");
    assertEquals(over, { ok: false, active: 5 });
    // Cap did not drop the pending id.
    const count = await container.getActiveSlotCount();
    assertEquals(count, 5);
  },
);

Deno.test(
  "BrowserSessionContainer - releaseSlot - frees capacity for a new session",
  async () => {
    const { container } = createContainerInstance();
    for (const id of ["a", "b", "c", "d", "e"]) {
      await container.reserveSlot(`sess-${id}`);
    }
    const overBefore = await container.reserveSlot("sess-f");
    assertEquals(overBefore.ok, false);
    await container.releaseSlot("sess-a");
    const afterRelease = await container.reserveSlot("sess-f");
    assertEquals(afterRelease, { ok: true, active: 5 });
  },
);

Deno.test("BrowserSessionContainer - releaseSlot - is idempotent for unknown ids", async () => {
  const { container } = createContainerInstance();
  const result = await container.releaseSlot("not-reserved");
  assertEquals(result, { active: 0 });
});

Deno.test(
  "BrowserSessionContainer - createSession - rejects when the per-space cap is exceeded",
  async () => {
    // Build a minimal counter DO plus a separate session DO. When createSession
    // runs, it calls env.BROWSER_CONTAINER.idFromName('space-counter:...') and
    // then env.BROWSER_CONTAINER.get(id); we route those through a shared
    // counter instance whose storage starts full.
    const counterCtx = makeMockCtx();
    const counterEnv = { BROWSER_CONTAINER: {} } as any;
    const counterContainer = new BrowserSessionContainer(counterCtx, counterEnv);
    for (const id of ["a", "b", "c", "d", "e"]) {
      await counterContainer.reserveSlot(`sess-${id}`);
    }

    const sessionCtx = makeMockCtx();
    const envWithCounter: any = {
      BROWSER_CONTAINER: {
        idFromName: (_name: string) => ({ toString: () => "counter-id" }),
        get: () => counterContainer,
      },
    };
    const sessionContainer = new BrowserSessionContainer(
      sessionCtx,
      envWithCounter,
    );
    (sessionContainer as any).container = {
      getTcpPort: () => makeMockTcpPortFetcher(),
    };

    await assertRejects(
      () =>
        sessionContainer.createSession({
          sessionId: "sess-over",
          spaceId: "space-1",
          userId: "user-1",
        }),
      Error,
      "BROWSER_SESSION_CAP",
    );

    // The counter should still show 5 active — the failed create did not
    // consume an extra slot.
    assertEquals(await counterContainer.getActiveSlotCount(), 5);
  },
);

Deno.test(
  "browser-session-host Worker routes - POST /create - maps cap errors to 429",
  async () => {
    // Wire a DO stub whose createSession throws a BROWSER_SESSION_CAP error.
    const env = makeBrowserHostEnv({
      createSession: spy(async () => {
        throw new Error(
          "BROWSER_SESSION_CAP: Too many concurrent browser sessions for this space (limit 5, active 5)",
        );
      }),
    });
    const res = await browserSessionHost.fetch(
      new Request("http://localhost/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "sess-1",
          spaceId: "space-1",
          userId: "user-1",
        }),
      }),
      env,
    );
    assertEquals(res.status, 429);
    const body = await res.json() as { error: string };
    assertStringIncludes(body.error, "BROWSER_SESSION_CAP");
  },
);

Deno.test("BrowserSessionContainer - forwardToContainer - forwards a request to the internal TCP port", async () => {
  const { container, tcpPortFetcher } = createContainerInstance();
  tcpPortFetcher.fetch = spy(async (_request: Request) =>
    new Response('{"page":"loaded"}', { status: 200 })
  );

  const res = await container.forwardToContainer("/internal/goto", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://example.com" }),
  });

  assertEquals(res.status, 200);
  const callArgs = tcpPortFetcher.fetch.calls[0]?.args as [string, Request];
  assertEquals(callArgs[0], "http://internal/internal/goto");
  assertEquals(callArgs[1].method, "POST");
  assertEquals(callArgs[1].url, "http://internal/internal/goto");
});
// ---------------------------------------------------------------------------
// Worker fetch handler routes
// ---------------------------------------------------------------------------

Deno.test("browser-session-host Worker routes - GET /health - returns 200 with service info", async () => {
  const env = makeBrowserHostEnv();
  const res = await browserSessionHost.fetch(
    new Request("http://localhost/health", { method: "GET" }),
    env,
  );
  assertEquals(res.status, 200);
  const body = await res.json() as any;
  assertEquals(body.status, "ok");
  assertEquals(body.service, "takos-browser-host");
});

Deno.test("browser-session-host Worker routes - POST /create - creates a session with valid payload", async () => {
  const env = makeBrowserHostEnv();
  const res = await browserSessionHost.fetch(
    new Request("http://localhost/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "sess-1",
        spaceId: "space-1",
        userId: "user-1",
        url: "https://example.com",
      }),
    }),
    env,
  );
  assertEquals(res.status, 201);
  const body = await res.json() as any;
  assertEquals(body.ok, true);
  assertEquals(body.proxyToken, "tok-123");
});
Deno.test("browser-session-host Worker routes - POST /create - returns 400 when sessionId is missing", async () => {
  const env = makeBrowserHostEnv();
  const res = await browserSessionHost.fetch(
    new Request("http://localhost/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spaceId: "space-1",
        userId: "user-1",
      }),
    }),
    env,
  );
  assertEquals(res.status, 400);
  const body = await res.json() as any;
  assertStringIncludes(body.error, "Missing required fields");
});
Deno.test("browser-session-host Worker routes - POST /create - returns 400 when spaceId is missing", async () => {
  const env = makeBrowserHostEnv();
  const res = await browserSessionHost.fetch(
    new Request("http://localhost/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "sess-1",
        userId: "user-1",
      }),
    }),
    env,
  );
  assertEquals(res.status, 400);
});
Deno.test("browser-session-host Worker routes - POST /create - returns 400 when userId is missing", async () => {
  const env = makeBrowserHostEnv();
  const res = await browserSessionHost.fetch(
    new Request("http://localhost/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "sess-1",
        spaceId: "space-1",
      }),
    }),
    env,
  );
  assertEquals(res.status, 400);
});
Deno.test("browser-session-host Worker routes - POST /create - returns 500 when createSession throws", async () => {
  const env = makeBrowserHostEnv({
    createSession: async () => {
      throw new Error("Container start failed");
    },
  });
  const res = await browserSessionHost.fetch(
    new Request("http://localhost/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "sess-1",
        spaceId: "space-1",
        userId: "user-1",
      }),
    }),
    env,
  );
  assertEquals(res.status, 500);
  const body = await res.json() as any;
  assertEquals(body.error, "Container start failed");
});

Deno.test("browser-session-host Worker routes - GET /session/:id - returns session state when session exists", async () => {
  const env = makeBrowserHostEnv();
  const res = await browserSessionHost.fetch(
    new Request("http://localhost/session/sess-1", { method: "GET" }),
    env,
  );
  assertEquals(res.status, 200);
  const body = await res.json() as any;
  assertEquals(body.sessionId, "sess-1");
  assertEquals(body.status, "active");
});
Deno.test("browser-session-host Worker routes - GET /session/:id - returns 404 when session does not exist", async () => {
  const env = makeBrowserHostEnv({
    getSessionState: async () => null,
  });
  const res = await browserSessionHost.fetch(
    new Request("http://localhost/session/nonexistent", { method: "GET" }),
    env,
  );
  assertEquals(res.status, 404);
  const body = await res.json() as any;
  assertStringIncludes(body.error, "Session not found");
});

Deno.test("browser-session-host Worker routes - POST /session/:id/goto - forwards goto request to container", async () => {
  const env = makeBrowserHostEnv();
  const res = await browserSessionHost.fetch(
    new Request("http://localhost/session/sess-1/goto", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/page" }),
    }),
    env,
  );
  assertEquals(res.status, 200);
  const callArgs = env._stub.forwardToContainer.calls[0]?.args as [
    string,
    RequestInit,
  ];
  assertEquals(callArgs[0], "/internal/goto");
  assertEquals(callArgs[1].method, "POST");
});
Deno.test("browser-session-host Worker routes - POST /session/:id/goto - returns 500 when forward fails", async () => {
  const env = makeBrowserHostEnv({
    forwardToContainer: async () => {
      throw new Error("Connection lost");
    },
  });
  const res = await browserSessionHost.fetch(
    new Request("http://localhost/session/sess-1/goto", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    }),
    env,
  );
  assertEquals(res.status, 500);
  const body = await res.json() as any;
  assertEquals(body.error, "Connection lost");
});

Deno.test("browser-session-host Worker routes - POST /session/:id/action - forwards action request to container", async () => {
  const env = makeBrowserHostEnv();
  const res = await browserSessionHost.fetch(
    new Request("http://localhost/session/sess-1/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "click", selector: "#btn" }),
    }),
    env,
  );
  assertEquals(res.status, 200);
  const callArgs = env._stub.forwardToContainer.calls[0]?.args as [
    string,
    RequestInit,
  ];
  assertEquals(callArgs[0], "/internal/action");
  assertEquals(callArgs[1].method, "POST");
});

Deno.test("browser-session-host Worker routes - POST /session/:id/extract - forwards extract request to container", async () => {
  const env = makeBrowserHostEnv();
  const res = await browserSessionHost.fetch(
    new Request("http://localhost/session/sess-1/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selector: ".content" }),
    }),
    env,
  );
  assertEquals(res.status, 200);
  const callArgs = env._stub.forwardToContainer.calls[0]?.args as [
    string,
    RequestInit,
  ];
  assertEquals(callArgs[0], "/internal/extract");
  assertEquals(callArgs[1].method, "POST");
});

Deno.test("browser-session-host Worker routes - GET /session/:id/html - forwards html request to container", async () => {
  const env = makeBrowserHostEnv();
  const res = await browserSessionHost.fetch(
    new Request("http://localhost/session/sess-1/html", { method: "GET" }),
    env,
  );
  assertEquals(res.status, 200);
  assertEquals(
    env._stub.forwardToContainer.calls[0]?.args[0],
    "/internal/html",
  );
});

Deno.test("browser-session-host Worker routes - GET /session/:id/screenshot - forwards screenshot request to container", async () => {
  const env = makeBrowserHostEnv();
  const res = await browserSessionHost.fetch(
    new Request("http://localhost/session/sess-1/screenshot", {
      method: "GET",
    }),
    env,
  );
  assertEquals(res.status, 200);
  assertEquals(
    env._stub.forwardToContainer.calls[0]?.args[0],
    "/internal/screenshot",
  );
});
Deno.test("browser-session-host Worker routes - GET /session/:id/screenshot - returns 500 when screenshot forward fails", async () => {
  const env = makeBrowserHostEnv({
    forwardToContainer: async () => {
      throw new Error("Browser crashed");
    },
  });
  const res = await browserSessionHost.fetch(
    new Request("http://localhost/session/sess-1/screenshot", {
      method: "GET",
    }),
    env,
  );
  assertEquals(res.status, 500);
  const body = await res.json() as any;
  assertEquals(body.error, "Browser crashed");
});

Deno.test("browser-session-host Worker routes - POST /session/:id/pdf - forwards pdf request to container", async () => {
  const env = makeBrowserHostEnv();
  const res = await browserSessionHost.fetch(
    new Request("http://localhost/session/sess-1/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }),
    env,
  );
  assertEquals(res.status, 200);
  const callArgs = env._stub.forwardToContainer.calls[0]?.args as [
    string,
    RequestInit,
  ];
  assertEquals(callArgs[0], "/internal/pdf");
  assertEquals(callArgs[1].method, "POST");
});

Deno.test("browser-session-host Worker routes - GET /session/:id/tabs - forwards tabs request to container", async () => {
  const env = makeBrowserHostEnv();
  const res = await browserSessionHost.fetch(
    new Request("http://localhost/session/sess-1/tabs", { method: "GET" }),
    env,
  );
  assertEquals(res.status, 200);
  assertEquals(
    env._stub.forwardToContainer.calls[0]?.args[0],
    "/internal/tabs",
  );
});

Deno.test("browser-session-host Worker routes - POST /session/:id/tab/new - forwards new tab request to container", async () => {
  const env = makeBrowserHostEnv();
  const res = await browserSessionHost.fetch(
    new Request("http://localhost/session/sess-1/tab/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    }),
    env,
  );
  assertEquals(res.status, 200);
  const callArgs = env._stub.forwardToContainer.calls[0]?.args as [
    string,
    RequestInit,
  ];
  assertEquals(callArgs[0], "/internal/tab/new");
  assertEquals(callArgs[1].method, "POST");
});

Deno.test("browser-session-host Worker routes - DELETE /session/:id - destroys the session and returns success", async () => {
  const env = makeBrowserHostEnv();
  const res = await browserSessionHost.fetch(
    new Request("http://localhost/session/sess-1", { method: "DELETE" }),
    env,
  );
  assertEquals(res.status, 200);
  const body = await res.json() as any;
  assertEquals(body.ok, true);
  assertStringIncludes(body.message, "destroyed");
  assert(env._stub.destroySession.calls.length > 0);
});
Deno.test("browser-session-host Worker routes - DELETE /session/:id - returns 500 when destroy fails", async () => {
  const env = makeBrowserHostEnv({
    destroySession: async () => {
      throw new Error("Cleanup failed");
    },
  });
  const res = await browserSessionHost.fetch(
    new Request("http://localhost/session/sess-1", { method: "DELETE" }),
    env,
  );
  assertEquals(res.status, 500);
  const body = await res.json() as any;
  assertEquals(body.error, "Cleanup failed");
});

Deno.test("browser-session-host Worker routes - unknown routes - returns 404 for unmatched routes", async () => {
  const env = makeBrowserHostEnv();
  const res = await browserSessionHost.fetch(
    new Request("http://localhost/nonexistent", { method: "GET" }),
    env,
  );
  assertEquals(res.status, 404);
});
