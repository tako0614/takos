import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

import {
  autoCloseSession,
  type SessionCloserDeps,
} from "@/application/services/agent/session-closer.ts";

function createDeps(
  overrides: Partial<SessionCloserDeps> = {},
): SessionCloserDeps {
  return {
    env: {
      RUNTIME_HOST: { fetch: async () => new Response("ok") },
    } as never,
    db: {} as never,
    context: {
      spaceId: "ws-1",
      threadId: "thread-1",
      runId: "run-1",
      userId: "user-1",
    },
    checkCancellation: async () => false,
    emitEvent: async () => {},
    getCurrentSessionId: async () => "session-1",
    ...overrides,
  };
}

Deno.test("autoCloseSession returns immediately when no session exists", async () => {
  const emitEvent = spy(async () => {});
  const getCurrentSessionId = spy(async () => null);

  await autoCloseSession(
    createDeps({
      emitEvent,
      getCurrentSessionId,
    }),
    "completed",
  );

  assertSpyCalls(getCurrentSessionId, 1);
  assertSpyCalls(emitEvent, 0);
});

Deno.test("autoCloseSession returns immediately when RUNTIME_HOST is missing", async () => {
  const emitEvent = spy(async () => {});
  const getCurrentSessionId = spy(async () => "session-1");

  await autoCloseSession(
    createDeps({
      env: {} as never,
      emitEvent,
      getCurrentSessionId,
    }),
    "completed",
  );

  assertSpyCalls(getCurrentSessionId, 1);
  assertSpyCalls(emitEvent, 0);
});
