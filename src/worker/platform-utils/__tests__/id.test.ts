import { expect, test } from "bun:test";
import { generateId } from "../id.ts";

const ALPHABET = /^[a-z0-9]+$/;

test("generateId - returns the requested length with the default", () => {
  expect(generateId().length).toEqual(12);
});

test("generateId - honors an explicit length", () => {
  expect(generateId(24).length).toEqual(24);
  expect(generateId(1).length).toEqual(1);
});

test("generateId - emits only alphabet characters (rejection sampling stays in range)", () => {
  // Generate a large sample so the rejection-sampling refill path is exercised
  // and any out-of-alphabet character (e.g. from an undefined buffer read)
  // would surface.
  for (let i = 0; i < 200; i++) {
    expect(generateId(64)).toMatch(ALPHABET);
  }
});

test("generateId - uses all 36 symbols over a large sample (no symbol is dropped)", () => {
  const seen = new Set<string>();
  // A working uniform generator covers all 36 symbols well within this many
  // draws; the bounded loop also guards against a regression that drops symbols.
  for (let i = 0; i < 50 && seen.size < 36; i++) {
    for (const char of generateId(256)) seen.add(char);
  }
  expect(seen.size).toEqual(36);
});
