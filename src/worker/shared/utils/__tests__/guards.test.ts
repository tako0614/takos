import { test } from "bun:test";
import { assert, assertEquals, assertFalse } from "@takos/test/assert";

import { asRecord, isRecord } from "../guards.ts";

test("isRecord accepts plain objects", () => {
  assert(isRecord({}));
  assert(isRecord({ a: 1 }));
});

test("isRecord rejects arrays so a JSON array never passes as a record", () => {
  // The canonical guard must use the !Array.isArray() variant: an array is a
  // typeof "object" value, but it is not a record on validation boundaries.
  assertFalse(isRecord([]));
  assertFalse(isRecord([1, 2, 3]));
});

test("isRecord rejects null and primitives", () => {
  assertFalse(isRecord(null));
  assertFalse(isRecord(undefined));
  assertFalse(isRecord("string"));
  assertFalse(isRecord(42));
  assertFalse(isRecord(true));
});

test("asRecord returns the object for records", () => {
  const value = { a: 1 };
  assertEquals(asRecord(value), value);
});

test("asRecord returns null for arrays, null, and primitives", () => {
  assertEquals(asRecord([]), null);
  assertEquals(asRecord([1, 2, 3]), null);
  assertEquals(asRecord(null), null);
  assertEquals(asRecord(undefined), null);
  assertEquals(asRecord("string"), null);
  assertEquals(asRecord(42), null);
});
