import { deepStrictEqual as assertEquals } from "node:assert/strict";
import type { RouteState } from "../../types/index.ts";
import {
  normalizeNavigationState,
  parseRoute,
  shouldPushHistory,
} from "../../hooks/router-state.ts";
import { test } from "bun:test";

const assertObjectMatch = (actual: unknown, expected: Record<string, unknown>) => {
  const actualRecord = actual as Record<string, unknown>;
  const actualSubset = Object.fromEntries(
    Object.entries(expected).map(([key]) => [key, actualRecord[key]]),
  );
  assertEquals(actualSubset, expected);
};

test("normalizeNavigationState - clears stale storage state when entering storage", () => {
  const previous: RouteState = {
    view: "chat",
    spaceId: "ws-1",
    threadId: "thread-1",
    runId: "run-1",
    messageId: "msg-1",
  };

  assertEquals(
    normalizeNavigationState(previous, {
      view: "storage",
      spaceId: "ws-2",
      storagePath: "/docs",
    }),
    {
      view: "storage",
      spaceId: "ws-2",
      storagePath: "/docs",
      filePath: undefined,
      fileLine: undefined,
      ref: undefined,
      threadId: undefined,
      runId: undefined,
      messageId: undefined,
    },
  );
});

test("normalizeNavigationState - clears stale storage state when entering chat", () => {
  const previous: RouteState = {
    view: "storage",
    spaceId: "ws-1",
    storagePath: "/docs",
    filePath: "/docs/readme.md",
  };

  assertObjectMatch(
    normalizeNavigationState(previous, {
      view: "chat",
      spaceId: "ws-1",
      threadId: "thread-9",
    }),
    {
      view: "chat",
      spaceId: "ws-1",
      threadId: "thread-9",
      storagePath: undefined,
      filePath: undefined,
      fileLine: undefined,
      ref: undefined,
    },
  );
});

test("normalizeNavigationState - preserves explicit clears while staying in chat", () => {
  const previous: RouteState = {
    view: "chat",
    spaceId: "ws-1",
    threadId: "thread-1",
    runId: "run-1",
    messageId: "msg-1",
  };

  assertEquals(
    normalizeNavigationState(
      previous,
      {
        view: "chat",
        spaceId: "ws-1",
        threadId: undefined,
        runId: undefined,
        messageId: undefined,
      } as unknown as Partial<RouteState>,
    ),
    {
      view: "chat",
      spaceId: "ws-1",
      threadId: undefined,
      runId: undefined,
      messageId: undefined,
      storagePath: undefined,
      filePath: undefined,
      fileLine: undefined,
      ref: undefined,
    },
  );
});

test("normalizeNavigationState - clears stale storage state when leaving storage", () => {
  const previous: RouteState = {
    view: "storage",
    spaceId: "ws-1",
    storagePath: "/docs",
    filePath: "/docs/readme.md",
    fileLine: 12,
  };

  assertObjectMatch(
    normalizeNavigationState(previous, {
      view: "repo",
      username: "alice",
      repoName: "demo",
    }),
    {
      view: "repo",
      username: "alice",
      repoName: "demo",
      storagePath: undefined,
      filePath: undefined,
      fileLine: undefined,
      ref: undefined,
    },
  );
});

test("normalizeNavigationState - preserves explicit clears while staying in storage", () => {
  const previous: RouteState = {
    view: "storage",
    spaceId: "ws-1",
    storagePath: "/docs",
    filePath: "/docs/readme.md",
    fileLine: 12,
  };

  assertEquals(
    normalizeNavigationState(
      previous,
      {
        view: "storage",
        spaceId: "ws-1",
        storagePath: "/docs",
        filePath: undefined,
        fileLine: undefined,
      } as unknown as Partial<RouteState>,
    ),
    {
      view: "storage",
      spaceId: "ws-1",
      storagePath: "/docs",
      filePath: undefined,
      fileLine: undefined,
      ref: undefined,
      threadId: undefined,
      runId: undefined,
      messageId: undefined,
    },
  );
});

test("parseRoute - preserves search params for internal routes", () => {
  assertEquals(
    parseRoute("/chat/ws-1/thread-9", "?message=msg-1&run=run-7"),
    {
      view: "chat",
      spaceId: "ws-1",
      threadId: "thread-9",
      runId: "run-7",
      messageId: "msg-1",
    },
  );
});

test("parseRoute - retired /app shortcuts do not fall through to repo routes", () => {
  assertEquals(parseRoute("/app/store"), { view: "home" });
  assertEquals(parseRoute("/app/docs"), { view: "home" });
});

test("shouldPushHistory - compares pathname and search", () => {
  assertEquals(
    shouldPushHistory(
      "/chat/ws-1/thread-9",
      "?message=msg-1",
      "/chat/ws-1/thread-9?message=msg-1",
    ),
    false,
  );
  assertEquals(
    shouldPushHistory(
      "/chat/ws-1/thread-9",
      "?message=msg-1",
      "/chat/ws-1/thread-9?message=msg-2",
    ),
    true,
  );
});
