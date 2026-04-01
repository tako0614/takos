import { assertEquals } from "jsr:@std/assert";

import { SessionState } from "@/application/tools/executor.ts";

Deno.test("SessionState defers clearing the session id while executions are active", () => {
  const state = new SessionState("session-1");

  assertEquals(state.beginExecution(), "session-1");
  state.setSessionId(undefined);

  assertEquals(state.sessionId, "session-1");
  assertEquals(state.hasPendingClear, true);

  state.endExecution();

  assertEquals(state.sessionId, undefined);
  assertEquals(state.hasPendingClear, false);
});

Deno.test("SessionState replaces the session id immediately when a new one is provided", () => {
  const state = new SessionState("session-1");

  state.beginExecution();
  state.setSessionId("session-2");

  assertEquals(state.sessionId, "session-2");
  assertEquals(state.hasPendingClear, false);

  state.endExecution();
  assertEquals(state.sessionId, "session-2");
});

Deno.test("SessionState cleanup resets all transient state", () => {
  const state = new SessionState("session-1");

  state.beginExecution();
  state.setLastContainerStartFailure({
    message: "runtime host unavailable",
  });
  state.setSessionId(undefined);
  state.cleanup();

  assertEquals(state.sessionId, undefined);
  assertEquals(state.lastContainerStartFailure, undefined);
  assertEquals(state.activeExecutions, 0);
  assertEquals(state.hasPendingClear, false);
});
