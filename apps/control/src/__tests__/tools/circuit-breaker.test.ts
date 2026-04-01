import { CircuitBreaker } from "@/tools/circuit-breaker";

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "jsr:@std/assert";
import { FakeTime } from "jsr:@std/testing/time";

let cb: CircuitBreaker;

Deno.test("CircuitBreaker - initial state - starts in CLOSED state for unknown tools", () => {
  cb = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeout: 1000,
    successThreshold: 2,
  });
  const state = cb.getState("test_tool");
  assertEquals(state.state, "CLOSED");
  assertEquals(state.failures, 0);
  assertEquals(state.successes, 0);
  assertEquals(state.lastFailure, null);
  assertEquals(state.lastSuccess, null);
  assertEquals(state.openedAt, null);
});
Deno.test("CircuitBreaker - initial state - allows execution in CLOSED state", () => {
  cb = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeout: 1000,
    successThreshold: 2,
  });
  const result = cb.canExecute("test_tool");
  assertEquals(result.allowed, true);
  assertEquals(result.reason, undefined);
});

Deno.test("CircuitBreaker - recordSuccess - resets failure count on success in CLOSED state", () => {
  cb = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeout: 1000,
    successThreshold: 2,
  });
  cb.recordFailure("test_tool", "err1");
  cb.recordFailure("test_tool", "err2");
  assertEquals(cb.getState("test_tool").failures, 2);

  cb.recordSuccess("test_tool");
  assertEquals(cb.getState("test_tool").failures, 0);
  assertNotEquals(cb.getState("test_tool").lastSuccess, null);
});

Deno.test("CircuitBreaker - recordFailure - increments failure count", () => {
  cb = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeout: 1000,
    successThreshold: 2,
  });
  cb.recordFailure("test_tool", "err1");
  assertEquals(cb.getState("test_tool").failures, 1);

  cb.recordFailure("test_tool", "err2");
  assertEquals(cb.getState("test_tool").failures, 2);
});
Deno.test("CircuitBreaker - recordFailure - opens circuit after reaching failure threshold", () => {
  cb = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeout: 1000,
    successThreshold: 2,
  });
  cb.recordFailure("test_tool", "err1");
  cb.recordFailure("test_tool", "err2");
  cb.recordFailure("test_tool", "err3");

  const state = cb.getState("test_tool");
  assertEquals(state.state, "OPEN");
  assertNotEquals(state.openedAt, null);
});
Deno.test("CircuitBreaker - recordFailure - blocks execution when circuit is OPEN", () => {
  cb = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeout: 1000,
    successThreshold: 2,
  });
  cb.recordFailure("test_tool", "err1");
  cb.recordFailure("test_tool", "err2");
  cb.recordFailure("test_tool", "err3");

  const result = cb.canExecute("test_tool");
  assertEquals(result.allowed, false);
  assert(result.reason);
  assertStringIncludes(result.reason, "Circuit breaker OPEN");
  assertStringIncludes(result.reason, "test_tool");
});

Deno.test("CircuitBreaker - OPEN -> HALF_OPEN transition - transitions to HALF_OPEN after reset timeout", () => {
  cb = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeout: 1000,
    successThreshold: 2,
  });
  cb.recordFailure("test_tool", "err1");
  cb.recordFailure("test_tool", "err2");
  cb.recordFailure("test_tool", "err3");

  assertEquals(cb.getState("test_tool").state, "OPEN");

  // Simulate time passing
  const fakeTime = new FakeTime();
  try {
    fakeTime.tick(1001);

    const result = cb.canExecute("test_tool");
    assertEquals(result.allowed, true);
    assertEquals(cb.getState("test_tool").state, "HALF_OPEN");
  } finally {
    fakeTime.restore();
  }
});

function goToHalfOpen(toolName: string) {
  const fakeTime = new FakeTime();
  cb.recordFailure(toolName, "err1");
  cb.recordFailure(toolName, "err2");
  cb.recordFailure(toolName, "err3");

  fakeTime.tick(1001);
  cb.canExecute(toolName); // triggers transition
  return fakeTime;
}

Deno.test("CircuitBreaker - HALF_OPEN state - closes circuit after enough successes in HALF_OPEN", () => {
  cb = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeout: 1000,
    successThreshold: 2,
  });
  const fakeTime = goToHalfOpen("test_tool");
  try {
    assertEquals(cb.getState("test_tool").state, "HALF_OPEN");

    cb.recordSuccess("test_tool");
    assertEquals(cb.getState("test_tool").state, "HALF_OPEN");

    cb.recordSuccess("test_tool");
    assertEquals(cb.getState("test_tool").state, "CLOSED");
    assertEquals(cb.getState("test_tool").failures, 0);
    assertEquals(cb.getState("test_tool").openedAt, null);
  } finally {
    fakeTime.restore();
  }
});
Deno.test("CircuitBreaker - HALF_OPEN state - reopens circuit on failure in HALF_OPEN", () => {
  cb = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeout: 1000,
    successThreshold: 2,
  });
  const fakeTime = goToHalfOpen("test_tool");
  try {
    assertEquals(cb.getState("test_tool").state, "HALF_OPEN");

    cb.recordFailure("test_tool", "err_half_open");
    assertEquals(cb.getState("test_tool").state, "OPEN");
  } finally {
    fakeTime.restore();
  }
});

Deno.test("CircuitBreaker - reset - resets a specific tool circuit", () => {
  cb = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeout: 1000,
    successThreshold: 2,
  });
  cb.recordFailure("test_tool", "err1");
  cb.recordFailure("test_tool", "err2");
  assertEquals(cb.getState("test_tool").failures, 2);

  cb.reset("test_tool");
  assertEquals(cb.getState("test_tool").state, "CLOSED");
  assertEquals(cb.getState("test_tool").failures, 0);
});
Deno.test("CircuitBreaker - reset - resetAll clears all circuits", () => {
  cb = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeout: 1000,
    successThreshold: 2,
  });
  cb.recordFailure("tool_a", "err1");
  cb.recordFailure("tool_b", "err1");

  cb.resetAll();

  // getAllStates should be empty immediately after resetAll
  assertEquals(cb.getAllStates().size, 0);
  // getState lazily re-creates entries with default values
  assertEquals(cb.getState("tool_a").failures, 0);
  assertEquals(cb.getState("tool_b").failures, 0);
});

Deno.test("CircuitBreaker - getAllStates - returns a snapshot of all circuit states", () => {
  cb = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeout: 1000,
    successThreshold: 2,
  });
  cb.recordFailure("tool_a", "err1");
  cb.recordSuccess("tool_b");

  const states = cb.getAllStates();
  assertEquals(states.size, 2);
  assertEquals(states.get("tool_a")?.failures, 1);
  assertNotEquals(states.get("tool_b")?.lastSuccess, null);
});
Deno.test("CircuitBreaker - getAllStates - returns copies that do not affect original circuits", () => {
  cb = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeout: 1000,
    successThreshold: 2,
  });
  cb.recordFailure("tool_a", "err1");
  const states = cb.getAllStates();
  const snapshot = states.get("tool_a")!;
  snapshot.failures = 100;

  assertEquals(cb.getState("tool_a").failures, 1);
});

Deno.test("CircuitBreaker - per-tool isolation - tracks circuits independently per tool name", () => {
  cb = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeout: 1000,
    successThreshold: 2,
  });
  cb.recordFailure("tool_a", "err1");
  cb.recordFailure("tool_a", "err2");
  cb.recordFailure("tool_a", "err3");

  assertEquals(cb.canExecute("tool_a").allowed, false);
  assertEquals(cb.canExecute("tool_b").allowed, true);
});

Deno.test("CircuitBreaker - default config - uses default config values when no config provided", () => {
  cb = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeout: 1000,
    successThreshold: 2,
  });
  const defaultCb = new CircuitBreaker();
  // Default threshold is 3
  defaultCb.recordFailure("t", "e");
  defaultCb.recordFailure("t", "e");
  assertEquals(defaultCb.canExecute("t").allowed, true);
  defaultCb.recordFailure("t", "e");
  assertEquals(defaultCb.canExecute("t").allowed, false);
});
