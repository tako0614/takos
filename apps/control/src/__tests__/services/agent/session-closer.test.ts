import { assertEquals } from "jsr:@std/assert";

import {
  autoCloseSession,
  type SessionCloserDeps,
} from "@/application/services/agent/session-closer.ts";

function createDeps(
  overrides: Partial<SessionCloserDeps> = {},
): SessionCloserDeps {
  return {
    env: {} as SessionCloserDeps["env"],
    db: {} as SessionCloserDeps["db"],
    context: {
      spaceId: "ws-1",
      threadId: "thread-1",
      runId: "run-1",
      userId: "user-1",
    },
    checkCancellation: async () => false,
    emitEvent: async () => {},
    getCurrentSessionId: async () => null,
    ...overrides,
  };
}

Deno.test("autoCloseSession does nothing when no session exists", async () => {
  let emitCount = 0;
  const deps = createDeps({
    emitEvent: async () => {
      emitCount += 1;
    },
    getCurrentSessionId: async () => null,
  });

  await autoCloseSession(deps, "completed");

  assertEquals(emitCount, 0);
});

Deno.test("autoCloseSession does nothing when RUNTIME_HOST is missing", async () => {
  let emitCount = 0;
  const deps = createDeps({
    emitEvent: async () => {
      emitCount += 1;
    },
    getCurrentSessionId: async () => "session-1",
  });

  await autoCloseSession(deps, "completed");

  assertEquals(emitCount, 0);
});
