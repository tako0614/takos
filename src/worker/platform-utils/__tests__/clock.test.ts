import { expect, test } from "bun:test";
import { fixedClock, manualClock, systemClock } from "../clock.ts";

test("systemClock - returns Date.now()-compatible epoch ms", () => {
  const before = Date.now();
  const observed = systemClock.now();
  const after = Date.now();
  expect(observed >= before && observed <= after).toBeTruthy();
});

test("fixedClock - always returns the configured time", () => {
  const clock = fixedClock(1_700_000_000_000);
  expect(clock.now()).toEqual(1_700_000_000_000);
  expect(clock.now()).toEqual(1_700_000_000_000);
});

test("manualClock - starts at the initial value", () => {
  const clock = manualClock(1_000);
  expect(clock.now()).toEqual(1_000);
});

test("manualClock - defaults to zero when no initial value", () => {
  const clock = manualClock();
  expect(clock.now()).toEqual(0);
});

test("manualClock - advance() moves time forward", () => {
  const clock = manualClock(500);
  clock.advance(250);
  expect(clock.now()).toEqual(750);
  clock.advance(50);
  expect(clock.now()).toEqual(800);
});

test("manualClock - set() replaces the current time", () => {
  const clock = manualClock(100);
  clock.set(9_000);
  expect(clock.now()).toEqual(9_000);
});
