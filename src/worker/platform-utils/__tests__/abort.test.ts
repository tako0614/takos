import { expect, test } from "bun:test";
import { combineSignals, throwIfAborted } from "../abort.ts";
import { AppError } from "../errors.ts";

import { assert, assertEquals, assertThrows } from "@takos/test/assert";

// ---------------------------------------------------------------------------
// throwIfAborted
// ---------------------------------------------------------------------------

test("throwIfAborted - no-op when signal is undefined", () => {
  throwIfAborted(undefined);
});

test("throwIfAborted - no-op when signal not aborted", () => {
  const ac = new AbortController();
  throwIfAborted(ac.signal);
});

test("throwIfAborted - throws AppError when aborted", () => {
  const ac = new AbortController();
  ac.abort(new Error("boom"));
  assertThrows(() => throwIfAborted(ac.signal), AppError, "boom");
});

test("throwIfAborted - appends context to message", () => {
  const ac = new AbortController();
  ac.abort(new Error("boom"));
  assertThrows(() => throwIfAborted(ac.signal, "ctx"), AppError, "boom (ctx)");
});

// ---------------------------------------------------------------------------
// combineSignals - 基本動作
// ---------------------------------------------------------------------------

test("combineSignals - empty input returns a non-aborted signal", () => {
  const combined = combineSignals();
  expect(combined.aborted).toEqual(false);
});

test("combineSignals - filters out null/undefined inputs", () => {
  const ac = new AbortController();
  const combined = combineSignals(undefined, ac.signal, null);
  expect(combined.aborted).toEqual(false);
  ac.abort();
  expect(combined.aborted).toEqual(true);
});

test("combineSignals - already-aborted parent propagates immediately", () => {
  const ac1 = new AbortController();
  const ac2 = new AbortController();
  ac1.abort(new Error("pre-aborted"));
  const combined = combineSignals(ac1.signal, ac2.signal);
  expect(combined.aborted).toEqual(true);
  expect(combined.reason instanceof Error).toBeTruthy();
  expect((combined.reason as Error).message).toEqual("pre-aborted");
});

test("combineSignals - aborts when first parent fires", () => {
  const ac1 = new AbortController();
  const ac2 = new AbortController();
  const combined = combineSignals(ac1.signal, ac2.signal);
  ac1.abort(new Error("first"));
  expect(combined.aborted).toEqual(true);
  expect((combined.reason as Error).message).toEqual("first");
});

test("combineSignals - aborts when second parent fires", () => {
  const ac1 = new AbortController();
  const ac2 = new AbortController();
  const combined = combineSignals(ac1.signal, ac2.signal);
  ac2.abort(new Error("second"));
  expect(combined.aborted).toEqual(true);
  expect((combined.reason as Error).message).toEqual("second");
});

// ---------------------------------------------------------------------------
// combineSignals - listener cleanup (leak fix verification)
// ---------------------------------------------------------------------------

/**
 * Wrap an AbortController so we can count the number of currently-attached
 * "abort" listeners on its signal. This is what makes the leak verifiable.
 */
function makeCountedSignal(): {
  signal: AbortSignal;
  count: () => number;
  abort: (reason?: unknown) => void;
} {
  const ac = new AbortController();
  let attached = 0;
  const origAdd = ac.signal.addEventListener.bind(ac.signal);
  const origRemove = ac.signal.removeEventListener.bind(ac.signal);
  ac.signal.addEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => {
    if (type === "abort" && listener) attached++;
    return origAdd(type, listener, options);
  }) as typeof ac.signal.addEventListener;
  ac.signal.removeEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ) => {
    if (type === "abort" && listener) attached--;
    return origRemove(type, listener, options);
  }) as typeof ac.signal.removeEventListener;
  return {
    signal: ac.signal,
    count: () => attached,
    abort: (reason?: unknown) => ac.abort(reason),
  };
}

test("combineSignals - cleans up listeners on parent after combined aborts via parent", () => {
  const parent = makeCountedSignal();
  const child = new AbortController();
  const baseline = parent.count();

  const combined = combineSignals(parent.signal, child.signal);
  expect(parent.count() > baseline).toBeTruthy();

  // Abort via parent — combined should fire and cleanup all listeners.
  parent.abort();
  expect(combined.aborted).toEqual(true);
  expect(parent.count()).toEqual(baseline);
});

test("combineSignals - cleans up listeners on parent after combined aborts via sibling", () => {
  const longLived = makeCountedSignal();
  const baseline = longLived.count();

  // Simulate the leak pattern: many short-lived per-call timeouts paired with
  // one long-lived parent that never aborts. Each call should leave no
  // residual listeners on the long-lived parent.
  for (let i = 0; i < 50; i++) {
    const callTimeout = new AbortController();
    const combined = combineSignals(longLived.signal, callTimeout.signal);
    // Per-call timeout fires (most common termination path).
    callTimeout.abort(new Error(`timeout-${i}`));
    expect(combined.aborted).toEqual(true);
  }

  expect(longLived.count()).toEqual(baseline);
});

test("combineSignals - cleans up listeners when neither parent aborts but combined is no longer referenced via abort", () => {
  // Verify the path where the combined signal is aborted externally is also
  // covered by the controller.signal "abort" cleanup hook. We exercise this by
  // aborting one of the parents which routes through the parent handler →
  // controller.abort → controller.signal "abort" → cleanup.
  const parentA = makeCountedSignal();
  const parentB = makeCountedSignal();
  const baselineA = parentA.count();
  const baselineB = parentB.count();

  combineSignals(parentA.signal, parentB.signal);
  expect(parentA.count() > baselineA).toBeTruthy();
  expect(parentB.count() > baselineB).toBeTruthy();

  parentA.abort();

  expect(parentA.count()).toEqual(baselineA);
  expect(parentB.count()).toEqual(baselineB);
});
