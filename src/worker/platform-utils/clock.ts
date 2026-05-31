/**
 * Clock — injectable time source for deterministic testing.
 *
 * Production code that reads the wall clock should depend on this interface
 * instead of calling `Date.now()` directly. Functions accept a
 * `clock: Clock = systemClock` parameter (typically optional and last in the
 * argument list); tests inject a fake clock to make time-based behaviour
 * deterministic.
 *
 * The `now()` method returns the current time as a Unix epoch millisecond
 * value — matching the semantics of `Date.now()` so call-sites can swap one
 * for the other without further conversion.
 */
export interface Clock {
  now(): number;
}

/** Default production clock that delegates to `Date.now()`. */
export const systemClock: Clock = {
  now: () => Date.now(),
};

/**
 * Construct a fixed clock that always returns `nowMs`. Intended for tests.
 */
export function fixedClock(nowMs: number): Clock {
  return { now: () => nowMs };
}

/**
 * Construct a mutable clock whose returned time can be advanced. Intended for
 * tests that need to simulate the passage of time.
 */
export function manualClock(initialMs: number = 0): Clock & {
  advance(ms: number): void;
  set(ms: number): void;
} {
  let current = initialMs;
  return {
    now: () => current,
    advance(ms: number) {
      current += ms;
    },
    set(ms: number) {
      current = ms;
    },
  };
}
