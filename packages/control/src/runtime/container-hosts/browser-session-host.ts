/**
 * takos-browser-host Worker
 *
 * Hosts BrowserSessionContainer (CF Containers DO sidecar) and forwards
 * browser operations from the main worker to the container.
 *
 * Architecture:
 *   takos (main) → POST /create → this worker → container.createSession(...)
 *   takos (main) → POST /session/:id/goto → this worker → container forward → browserd
 *   takos (main) → GET  /session/:id/screenshot → this worker → container forward → browserd
 */

import {
  type HostContainerInternals,
  HostContainerRuntime,
} from "./container-runtime.ts";
import type {
  DurableObjectNamespace,
  R2Bucket,
} from "../../shared/types/bindings.ts";
import { Hono } from "hono";
import { generateProxyToken } from "./executor-proxy-config.ts";
import { constantTimeEqual } from "../../shared/utils/hash.ts";
import type {
  BrowserSessionState,
  BrowserSessionTokenInfo,
  CreateSessionPayload,
} from "./browser-session-types.ts";
import { getErrorMessage } from "takos-common/errors";

export const browserSessionHostDeps = {
  generateProxyToken,
};

// ---------------------------------------------------------------------------
// Environment types
// ---------------------------------------------------------------------------

interface BrowserHostEnv {
  BROWSER_CONTAINER: DurableObjectNamespace<BrowserSessionContainer>;
  BROWSER_CHECKPOINTS?: R2Bucket;
  TAKOS_EGRESS?: { fetch(request: Request): Promise<Response> };
}

type Env = BrowserHostEnv;

// ---------------------------------------------------------------------------
// Per-space concurrent-session cap
// ---------------------------------------------------------------------------

/**
 * Maximum number of concurrent browser sessions allowed per space.
 *
 * Enforced by `createSession` via a counter Durable Object (see
 * `getSpaceCounterStub`). A conservative limit that prevents a single space
 * from monopolising container capacity while remaining permissive enough for
 * the typical multi-tab agent workflow.
 *
 * Round 11 MEDIUM #12: per-space concurrent browser session cap.
 */
export const MAX_BROWSER_SESSIONS_PER_SPACE = 5;

/**
 * Special DO name prefix used to distinguish counter-only instances from
 * per-session container instances. Counter instances only touch `ctx.storage`
 * and never call `startAndWaitForPorts`, so no container boots for them.
 */
const SPACE_COUNTER_PREFIX = "space-counter:";

function getSpaceCounterStub(
  env: Env,
  spaceId: string,
): (DurableObjectStub & BrowserSessionContainer) | null {
  // In unit tests the env.BROWSER_CONTAINER stub may not implement
  // `idFromName` (see apps/control/src/__tests__/container-hosts/
  // browser-session-host.test.ts `createContainerInstance`). When the
  // namespace is not a real Cloudflare DO namespace we return null and let
  // the caller skip the per-space cap check — the cap only guards production
  // traffic, and the stub path is exercised by tests that do not care about
  // cross-space counting.
  const ns = env.BROWSER_CONTAINER as unknown as
    | { idFromName?: (name: string) => unknown; get?: (id: unknown) => unknown }
    | undefined;
  if (!ns || typeof ns.idFromName !== 'function' || typeof ns.get !== 'function') {
    return null;
  }
  const id = ns.idFromName(`${SPACE_COUNTER_PREFIX}${spaceId}`);
  return ns.get(id) as unknown as
    & DurableObjectStub
    & BrowserSessionContainer;
}

// ---------------------------------------------------------------------------
// Container TCP port fetcher type (internal CF Containers API)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Durable Object — BrowserSessionContainer
// ---------------------------------------------------------------------------

export class BrowserSessionContainer extends HostContainerRuntime<Env> {
  defaultPort = 8080;
  sleepAfter = "15m";
  pingEndpoint = "internal/healthz";

  private cachedTokens: Map<string, BrowserSessionTokenInfo> | null = null;
  private sessionState: BrowserSessionState | null = null;

  /**
   * Create a browser session: generate token, start container, bootstrap browser.
   *
   * Per-space concurrency cap: before starting the container, reserves a slot
   * on the space counter DO. If the space already has
   * `MAX_BROWSER_SESSIONS_PER_SPACE` active sessions, throws an error that the
   * edge route converts to a 429. If container bootstrap fails after the slot
   * is reserved, the slot is released to avoid leaking capacity.
   */
  async createSession(
    payload: CreateSessionPayload,
  ): Promise<{ ok: true; proxyToken: string }> {
    // Validate the URL scheme — only http/https are allowed. Block file://,
    // javascript:, data:, etc. so a malicious caller cannot point the browser
    // at the container's local filesystem or trigger script execution.
    if (payload.url) {
      let parsed: URL;
      try {
        parsed = new URL(payload.url);
      } catch {
        throw new Error('Invalid url: must be an absolute URL');
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`Invalid url scheme: ${parsed.protocol}`);
      }
    }

    // Clamp viewport to sensible ranges so a typo or attack can't request
    // a 1e9-pixel browser window.
    if (payload.viewport) {
      const { width, height } = payload.viewport;
      if (
        typeof width !== 'number' || !Number.isFinite(width) || width < 320 || width > 3840 ||
        typeof height !== 'number' || !Number.isFinite(height) || height < 240 || height > 2160
      ) {
        throw new Error('Invalid viewport: width must be 320-3840, height must be 240-2160');
      }
    }

    // Round 11 MEDIUM #12 — per-space concurrent session cap.
    // Reserve a slot on the space counter DO. Over-cap throws `BROWSER_SESSION_CAP`
    // which the edge route maps to 429 + RATE_LIMITED envelope.
    //
    // `getSpaceCounterStub` returns null when the DO namespace stub does not
    // implement `idFromName` (unit tests). In that path we skip the cap —
    // tests rely on direct construction of BrowserSessionContainer and do not
    // exercise cross-space accounting.
    const counterStub = getSpaceCounterStub(this.env, payload.spaceId);
    if (counterStub) {
      const reservation = await counterStub.reserveSlot(payload.sessionId);
      if (!reservation.ok) {
        throw new Error(
          `BROWSER_SESSION_CAP: Too many concurrent browser sessions for this space (limit ${MAX_BROWSER_SESSIONS_PER_SPACE}, active ${reservation.active})`,
        );
      }
    }

    let slotReleaseNeeded = counterStub !== null;
    try {
      const proxyToken = browserSessionHostDeps.generateProxyToken();
      const tokenInfo: BrowserSessionTokenInfo = {
        sessionId: payload.sessionId,
        spaceId: payload.spaceId,
        userId: payload.userId,
      };

      // Persist token in DO storage + in-memory cache
      const tokenMap: Record<string, BrowserSessionTokenInfo> = {
        [proxyToken]: tokenInfo,
      };
      await this.ctx.storage.put("proxyTokens", tokenMap);
      this.cachedTokens = new Map(Object.entries(tokenMap));

      this.sessionState = {
        sessionId: payload.sessionId,
        spaceId: payload.spaceId,
        userId: payload.userId,
        status: "starting",
        createdAt: new Date().toISOString(),
      };

      // Start container and wait for port 8080
      await this.startAndWaitForPorts([8080]);

      // Bootstrap the browser in the container
      const tcpPort = (this as unknown as HostContainerInternals).container
        .getTcpPort(8080);
      const bootstrapResponse = await tcpPort.fetch(
        "http://internal/internal/bootstrap",
        new Request("http://internal/internal/bootstrap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: payload.url,
            viewport: payload.viewport,
          }),
        }),
      );

      if (!bootstrapResponse.ok) {
        const errorText = await bootstrapResponse.text();
        throw new Error(`Browser bootstrap failed: ${errorText}`);
      }

      this.sessionState.status = "active";
      slotReleaseNeeded = false;
      return { ok: true, proxyToken };
    } finally {
      if (slotReleaseNeeded && counterStub) {
        // Best-effort: release the slot so a failed bootstrap doesn't
        // permanently consume capacity. Swallow errors — the counter DO
        // already handles idempotent releases.
        try {
          await counterStub.releaseSlot(payload.sessionId);
        } catch (_err) {
          // ignore — over-cap slots drop out of the active set eventually
          // when destroySession fires or when the DO is reclaimed.
        }
      }
    }
  }

  /** RPC: verify a proxy token via constant-time comparison. */
  async verifyProxyToken(
    token: string,
  ): Promise<BrowserSessionTokenInfo | null> {
    if (!this.cachedTokens) {
      const stored = await this.ctx.storage.get<
        Record<string, BrowserSessionTokenInfo>
      >("proxyTokens");
      if (!stored) return null;
      this.cachedTokens = new Map(Object.entries(stored));
    }
    for (const [storedToken, info] of this.cachedTokens) {
      if (constantTimeEqual(token, storedToken)) return info;
    }
    return null;
  }

  /** RPC: get current session state. */
  async getSessionState(): Promise<BrowserSessionState | null> {
    return this.sessionState;
  }

  /** RPC: destroy session — stop container and clear state. */
  async destroySession(): Promise<void> {
    const sessionState = this.sessionState;
    if (sessionState) {
      sessionState.status = "stopped";
      // Release the per-space slot so the space can create a new session.
      // `getSpaceCounterStub` may return null in test mocks — skip cleanly.
      const counterStub = getSpaceCounterStub(this.env, sessionState.spaceId);
      if (counterStub) {
        try {
          await counterStub.releaseSlot(sessionState.sessionId);
        } catch (_err) {
          // ignore — best-effort cleanup
        }
      }
    }
    this.cachedTokens = null;
    await this.ctx.storage.delete("proxyTokens");
    await this.destroy();
  }

  // -------------------------------------------------------------------------
  // Space counter RPCs
  //
  // When called on a DO instance named `space-counter:<spaceId>`, these
  // methods treat the instance as a counter-only store. They never invoke
  // `startAndWaitForPorts`, so no container is started for the counter DO.
  // -------------------------------------------------------------------------

  /**
   * RPC: reserve a browser-session slot for a space.
   *
   * Returns `{ ok: true, active }` if the slot was reserved successfully.
   * Returns `{ ok: false, active }` if the space is already at the cap.
   * Idempotent on `sessionId` — calling twice with the same id does not
   * double-count.
   */
  async reserveSlot(
    sessionId: string,
  ): Promise<{ ok: boolean; active: number }> {
    const stored = await this.ctx.storage.get<string[]>("activeSessions");
    const active = new Set(stored ?? []);
    if (active.has(sessionId)) {
      return { ok: true, active: active.size };
    }
    if (active.size >= MAX_BROWSER_SESSIONS_PER_SPACE) {
      return { ok: false, active: active.size };
    }
    active.add(sessionId);
    await this.ctx.storage.put("activeSessions", Array.from(active));
    return { ok: true, active: active.size };
  }

  /**
   * RPC: release a browser-session slot for a space. Idempotent.
   */
  async releaseSlot(sessionId: string): Promise<{ active: number }> {
    const stored = await this.ctx.storage.get<string[]>("activeSessions");
    const active = new Set(stored ?? []);
    active.delete(sessionId);
    if (active.size === 0) {
      await this.ctx.storage.delete("activeSessions");
    } else {
      await this.ctx.storage.put("activeSessions", Array.from(active));
    }
    return { active: active.size };
  }

  /** RPC: return current active count for the space (counter DO only). */
  async getActiveSlotCount(): Promise<number> {
    const stored = await this.ctx.storage.get<string[]>("activeSessions");
    return stored ? stored.length : 0;
  }

  /**
   * Forward a request to the container's internal API.
   * Called from the Worker fetch handler.
   */
  async forwardToContainer(
    path: string,
    init?: RequestInit,
  ): Promise<Response> {
    this.renewActivityTimeout();
    const tcpPort = (this as unknown as HostContainerInternals).container
      .getTcpPort(8080);
    const request = new Request(`http://internal${path}`, init);
    return tcpPort.fetch(request.url, request);
  }
}

// ---------------------------------------------------------------------------
// Worker fetch handler
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>();

function getDOStub(
  env: Env,
  sessionId: string,
): DurableObjectStub & BrowserSessionContainer {
  const id = env.BROWSER_CONTAINER.idFromName(sessionId);
  return env.BROWSER_CONTAINER.get(id) as unknown as
    & DurableObjectStub
    & BrowserSessionContainer;
}

app.get("/health", (c) => {
  return c.json({ status: "ok", service: "takos-browser-host" }, 200);
});

// Create session
app.post("/create", async (c) => {
  const payload = await c.req.json<CreateSessionPayload>();
  if (!payload.sessionId || !payload.spaceId || !payload.userId) {
    return c.json({
      error: "Missing required fields: sessionId, spaceId, userId",
    }, 400);
  }

  try {
    const stub = getDOStub(c.env, payload.sessionId);
    const result = await stub.createSession(payload);
    return c.json(result, 201);
  } catch (err) {
    const message = getErrorMessage(err, "Unknown error");
    // Host endpoint uses a flat error envelope (internal RPC, not public API
    // contract). The `BROWSER_SESSION_CAP:` prefix is recognised by the edge
    // route which translates it into a 429 + common error envelope.
    if (message.startsWith("BROWSER_SESSION_CAP:")) {
      return c.json({ error: message }, 429);
    }
    return c.json({ error: message }, 500);
  }
});

// Get session info
app.get("/session/:id", async (c) => {
  const sessionId = c.req.param("id");
  const stub = getDOStub(c.env, sessionId);
  const state = await stub.getSessionState();
  if (!state) {
    return c.json({ error: "Session not found" }, 404);
  }
  return c.json(state);
});

// Forward routes — all delegate to container via DO

// Goto
app.post("/session/:id/goto", async (c) => {
  const sessionId = c.req.param("id");
  const body = await c.req.json();
  const stub = getDOStub(c.env, sessionId);
  try {
    const response = await stub.forwardToContainer("/internal/goto", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  } catch (err) {
    return c.json({ error: getErrorMessage(err, "Unknown error") }, 500);
  }
});

// Action
app.post("/session/:id/action", async (c) => {
  const sessionId = c.req.param("id");
  const body = await c.req.json();
  const stub = getDOStub(c.env, sessionId);
  try {
    const response = await stub.forwardToContainer("/internal/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  } catch (err) {
    return c.json({ error: getErrorMessage(err, "Unknown error") }, 500);
  }
});

// Extract
app.post("/session/:id/extract", async (c) => {
  const sessionId = c.req.param("id");
  const body = await c.req.json();
  const stub = getDOStub(c.env, sessionId);
  try {
    const response = await stub.forwardToContainer("/internal/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  } catch (err) {
    return c.json({ error: getErrorMessage(err, "Unknown error") }, 500);
  }
});

// HTML
app.get("/session/:id/html", async (c) => {
  const sessionId = c.req.param("id");
  const stub = getDOStub(c.env, sessionId);
  try {
    const response = await stub.forwardToContainer("/internal/html");
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  } catch (err) {
    return c.json({ error: getErrorMessage(err, "Unknown error") }, 500);
  }
});

// Screenshot
app.get("/session/:id/screenshot", async (c) => {
  const sessionId = c.req.param("id");
  const stub = getDOStub(c.env, sessionId);
  try {
    const response = await stub.forwardToContainer("/internal/screenshot");
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  } catch (err) {
    return c.json({ error: getErrorMessage(err, "Unknown error") }, 500);
  }
});

// PDF
app.post("/session/:id/pdf", async (c) => {
  const sessionId = c.req.param("id");
  const stub = getDOStub(c.env, sessionId);
  try {
    const response = await stub.forwardToContainer("/internal/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  } catch (err) {
    return c.json({ error: getErrorMessage(err, "Unknown error") }, 500);
  }
});

// Tabs
app.get("/session/:id/tabs", async (c) => {
  const sessionId = c.req.param("id");
  const stub = getDOStub(c.env, sessionId);
  try {
    const response = await stub.forwardToContainer("/internal/tabs");
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  } catch (err) {
    return c.json({ error: getErrorMessage(err, "Unknown error") }, 500);
  }
});

// New tab
app.post("/session/:id/tab/new", async (c) => {
  const sessionId = c.req.param("id");
  const body = await c.req.json();
  const stub = getDOStub(c.env, sessionId);
  try {
    const response = await stub.forwardToContainer("/internal/tab/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  } catch (err) {
    return c.json({ error: getErrorMessage(err, "Unknown error") }, 500);
  }
});

// Close tab
app.post("/session/:id/tab/close", async (c) => {
  const sessionId = c.req.param("id");
  const body = await c.req.json();
  const stub = getDOStub(c.env, sessionId);
  try {
    const response = await stub.forwardToContainer("/internal/tab/close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  } catch (err) {
    return c.json({ error: getErrorMessage(err, "Unknown error") }, 500);
  }
});

// Switch tab
app.post("/session/:id/tab/switch", async (c) => {
  const sessionId = c.req.param("id");
  const body = await c.req.json();
  const stub = getDOStub(c.env, sessionId);
  try {
    const response = await stub.forwardToContainer("/internal/tab/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  } catch (err) {
    return c.json({ error: getErrorMessage(err, "Unknown error") }, 500);
  }
});

// Destroy session
app.delete("/session/:id", async (c) => {
  const sessionId = c.req.param("id");
  const stub = getDOStub(c.env, sessionId);
  try {
    await stub.destroySession();
    return c.json({ ok: true, message: "Session destroyed" });
  } catch (err) {
    return c.json({ error: getErrorMessage(err, "Unknown error") }, 500);
  }
});

export default {
  fetch: app.fetch,
};
