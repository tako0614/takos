import { expect, test } from "bun:test";
import type { McpServerRecord } from "../../../types/index.ts";
import {
  createMcpAuthorizationTracker,
  type McpAuthorizationTarget,
  type McpAuthorizationTrackerState,
} from "../../../views/connections/mcp-authorization-tracker.ts";

function server(overrides: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    id: "server-1",
    name: "docs",
    url: "https://connector.example/mcp",
    transport: "streamable-http",
    source_type: "external",
    auth_mode: "oauth_pkce",
    enabled: true,
    managed: false,
    authorization_status: "authorized",
    ...overrides,
  };
}

function target(
  key = "docs",
  name = "docs",
  url = "https://connector.example/mcp",
): McpAuthorizationTarget {
  return {
    key,
    kind: "import",
    name,
    authorizationUrl:
      "https://takos.example/api/mcp/oauth/start?state=" + "a".repeat(32),
    isReady: (entry) =>
      entry.name === name &&
      entry.url === url &&
      entry.authorization_status === "authorized",
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function inertTimers() {
  return {
    setTimer: (() => 1) as unknown as typeof setTimeout,
    clearTimer: (() => undefined) as unknown as typeof clearTimeout,
  };
}

test("MCP authorization retry removes only targets proved ready", async () => {
  let currentSpaceId = "space-a";
  let servers: McpServerRecord[] = [];
  let state!: McpAuthorizationTrackerState;
  let completed = 0;
  const tracker = createMcpAuthorizationTracker({
    currentSpaceId: () => currentSpaceId,
    refresh: async () => {
      servers = [server()];
    },
    servers: () => servers,
    onStateChange: (next) => {
      state = next;
    },
    onAllComplete: () => {
      completed += 1;
    },
    ...inertTimers(),
  });

  tracker.add(currentSpaceId, [target()]);
  expect(state.pending.map((entry) => entry.key)).toEqual(["docs"]);
  expect(await tracker.retry()).toBe(true);
  expect(state.pending).toEqual([]);
  expect(state.spaceId).toBe("");
  expect(completed).toBe(1);
});

test("OAuth completion accepts the same pre-existing server identity", async () => {
  const existing = server({
    id: "server-existing",
    authorization_status: "authorization_required",
  });
  let servers: McpServerRecord[] = [existing];
  let state!: McpAuthorizationTrackerState;
  const tracker = createMcpAuthorizationTracker({
    currentSpaceId: () => "space-a",
    refresh: async () => {
      servers = [{ ...existing, authorization_status: "authorized" }];
    },
    servers: () => servers,
    onStateChange: (next) => {
      state = next;
    },
    onAllComplete: () => undefined,
    ...inertTimers(),
  });

  tracker.add("space-a", [target()]);
  expect(await tracker.retry()).toBe(true);
  expect(state.pending).toEqual([]);
});

test("an old OAuth refresh cannot complete a replacement Workspace tracker", async () => {
  let currentSpaceId = "space-a";
  let servers: McpServerRecord[] = [];
  let state!: McpAuthorizationTrackerState;
  const oldRefresh = deferred();
  let refreshCalls = 0;
  const tracker = createMcpAuthorizationTracker({
    currentSpaceId: () => currentSpaceId,
    refresh: async () => {
      refreshCalls += 1;
      if (refreshCalls === 1) await oldRefresh.promise;
      else {
        servers = [
          server({
            id: "server-b",
            name: "calendar",
            url: "https://calendar.example/mcp",
          }),
        ];
      }
    },
    servers: () => servers,
    onStateChange: (next) => {
      state = next;
    },
    onAllComplete: () => undefined,
    ...inertTimers(),
  });

  tracker.add("space-a", [target()]);
  const oldCheck = tracker.retry();
  currentSpaceId = "space-b";
  tracker.cancel();
  tracker.add("space-b", [
    target(
      "calendar",
      "calendar",
      "https://calendar.example/mcp",
    ),
  ]);
  oldRefresh.resolve();
  expect(await oldCheck).toBe(false);
  expect(state.pending.map((entry) => entry.key)).toEqual(["calendar"]);

  expect(await tracker.retry()).toBe(true);
  expect(state.pending).toEqual([]);
});

test("OAuth retry remains single-flight while refresh is pending", async () => {
  const refresh = deferred();
  let refreshCalls = 0;
  let state!: McpAuthorizationTrackerState;
  const tracker = createMcpAuthorizationTracker({
    currentSpaceId: () => "space-a",
    refresh: async () => {
      refreshCalls += 1;
      await refresh.promise;
    },
    servers: () => [],
    onStateChange: (next) => {
      state = next;
    },
    onAllComplete: () => undefined,
    ...inertTimers(),
  });

  tracker.add("space-a", [target()]);
  const first = tracker.retry();
  expect(state.checking).toBe(true);
  expect(await tracker.retry()).toBe(false);
  expect(refreshCalls).toBe(1);
  refresh.resolve();
  expect(await first).toBe(true);
  expect(state.checking).toBe(false);
  expect(state.pending).toHaveLength(1);
  tracker.cancel();
});

test("automatic OAuth checking stops after its bounded attempt budget", async () => {
  let scheduled: (() => void) | undefined;
  let state!: McpAuthorizationTrackerState;
  const tracker = createMcpAuthorizationTracker({
    currentSpaceId: () => "space-a",
    refresh: async () => undefined,
    servers: () => [],
    onStateChange: (next) => {
      state = next;
    },
    onAllComplete: () => undefined,
    maxAttempts: 1,
    setTimer: ((callback: () => void) => {
      scheduled = callback;
      return 1;
    }) as unknown as typeof setTimeout,
    clearTimer: (() => undefined) as unknown as typeof clearTimeout,
  });

  tracker.add("space-a", [target()]);
  scheduled?.();
  await Promise.resolve();
  await Promise.resolve();
  expect(state.exhausted).toBe(true);
  expect(state.checking).toBe(false);
  tracker.cancel();
});
