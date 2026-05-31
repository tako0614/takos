import { expect, test } from "bun:test";

import { toMs, toSeconds, ttlMs, ttlSeconds } from "../ttl.ts";

test("ttlMs - tags a number as TtlMs (runtime identity)", () => {
  expect(ttlMs(60_000) as number).toEqual(60_000);
});

test("ttlSeconds - tags a number as TtlSeconds (runtime identity)", () => {
  expect(ttlSeconds(60) as number).toEqual(60);
});

test("toSeconds - converts milliseconds to floored seconds", () => {
  expect(toSeconds(ttlMs(60_000)) as number).toEqual(60);
  expect(toSeconds(ttlMs(1500)) as number).toEqual(1);
  expect(toSeconds(ttlMs(999)) as number).toEqual(0);
});

test("toMs - converts seconds to milliseconds", () => {
  expect(toMs(ttlSeconds(60)) as number).toEqual(60_000);
  expect(toMs(ttlSeconds(0)) as number).toEqual(0);
});

test("toSeconds - matches explicit `/ 1000` conversion for typical TTLs", () => {
  const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  expect(toSeconds(ttlMs(SESSION_TTL_MS)) as number).toEqual(SESSION_TTL_MS / 1000);
});
