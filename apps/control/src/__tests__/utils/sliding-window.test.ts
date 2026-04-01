import {
  cleanupExpiredEntries,
  enforceKeyLimit,
  hitSlidingWindow,
} from "@/utils/rate-limiter";

import { assert, assertEquals } from "jsr:@std/assert";

const dryRunConfig = { maxRequests: 5, windowMs: 10_000 };

Deno.test("hitSlidingWindow (dryRun) - allows when no previous timestamps", () => {
  const { result } = hitSlidingWindow([], dryRunConfig, 1_000_000, true);
  assertEquals(result.allowed, true);
  assertEquals(result.remaining, 5);
  assertEquals(result.total, 5);
});
Deno.test("hitSlidingWindow (dryRun) - decrements remaining based on recent timestamps", () => {
  const now = 1_000_000;
  const timestamps = [now - 1000, now - 2000, now - 3000];
  const { result } = hitSlidingWindow(timestamps, dryRunConfig, now, true);
  assertEquals(result.remaining, 2);
  assertEquals(result.allowed, true);
});
Deno.test("hitSlidingWindow (dryRun) - returns 0 remaining when at capacity", () => {
  const now = 1_000_000;
  const timestamps = Array.from({ length: 5 }, (_, i) => now - i * 100);
  const { result } = hitSlidingWindow(timestamps, dryRunConfig, now, true);
  assertEquals(result.remaining, 0);
  assertEquals(result.allowed, false);
});
Deno.test("hitSlidingWindow (dryRun) - excludes expired timestamps", () => {
  const now = 1_000_000;
  // 3 timestamps outside window, 2 inside
  const timestamps = [
    now - 15000,
    now - 12000,
    now - 11000,
    now - 1000,
    now - 500,
  ];
  const { result } = hitSlidingWindow(timestamps, dryRunConfig, now, true);
  assertEquals(result.remaining, 3);
  assertEquals(result.allowed, true);
});
Deno.test("hitSlidingWindow (dryRun) - sets reset to earliest valid timestamp + window", () => {
  const now = 1_000_000;
  const timestamps = [now - 5000, now - 1000];
  const { result } = hitSlidingWindow(timestamps, dryRunConfig, now, true);
  assertEquals(result.reset, (now - 5000) + 10_000);
});
Deno.test("hitSlidingWindow (dryRun) - sets reset to now + window when no timestamps", () => {
  const now = 1_000_000;
  const { result } = hitSlidingWindow([], dryRunConfig, now, true);
  assertEquals(result.reset, now + 10_000);
});
Deno.test("hitSlidingWindow (dryRun) - does not push a timestamp when dryRun is true", () => {
  const now = 1_000_000;
  const { timestamps } = hitSlidingWindow([], dryRunConfig, now, true);
  assertEquals(timestamps.length, 0);
});

const runConfig = { maxRequests: 3, windowMs: 10_000 };

Deno.test("hitSlidingWindow - adds timestamp and returns updated state when allowed", () => {
  const now = 1_000_000;
  const { timestamps, result } = hitSlidingWindow([], runConfig, now);
  assertEquals(result.allowed, true);
  assertEquals(result.remaining, 2);
  assertEquals(timestamps.includes(now), true);
});
Deno.test("hitSlidingWindow - does not add timestamp when at capacity", () => {
  const now = 1_000_000;
  const existing = [now - 100, now - 200, now - 300];
  const { timestamps, result } = hitSlidingWindow(existing, runConfig, now);
  assertEquals(result.allowed, false);
  assertEquals(result.remaining, 0);
  assertEquals(timestamps.length, 3);
  assert(!timestamps.includes(now));
});
Deno.test("hitSlidingWindow - filters expired before checking capacity", () => {
  const now = 1_000_000;
  // 3 expired timestamps + 1 valid
  const existing = [now - 15000, now - 12000, now - 11000, now - 1000];
  const { timestamps, result } = hitSlidingWindow(existing, runConfig, now);
  assertEquals(result.allowed, true);
  assertEquals(result.remaining, 1);
  assertEquals(timestamps.length, 2); // 1 valid + 1 new
});
Deno.test("hitSlidingWindow - successive hits consume capacity", () => {
  const now = 1_000_000;
  let ts: number[] = [];

  for (let i = 0; i < 3; i++) {
    const out = hitSlidingWindow(ts, runConfig, now + i);
    ts = out.timestamps;
    assertEquals(out.result.allowed, true);
  }

  const out = hitSlidingWindow(ts, runConfig, now + 3);
  assertEquals(out.result.allowed, false);
  assertEquals(out.result.remaining, 0);
});

Deno.test("cleanupExpiredEntries - removes entries with no valid timestamps", () => {
  const entries = new Map<string, number[]>();
  entries.set("expired", [100, 200, 300]);
  entries.set("valid", [Date.now()]);

  cleanupExpiredEntries(entries, 10_000);
  assertEquals(entries.has("expired"), false);
  assertEquals(entries.has("valid"), true);
});
Deno.test("cleanupExpiredEntries - filters timestamps within entries", () => {
  const now = Date.now();
  const entries = new Map<string, number[]>();
  entries.set("mixed", [now - 20000, now - 15000, now - 1000]);

  cleanupExpiredEntries(entries, 10_000, now);
  assertEquals(entries.get("mixed"), [now - 1000]);
});
Deno.test("cleanupExpiredEntries - handles empty map", () => {
  const entries = new Map<string, number[]>();
  cleanupExpiredEntries(entries, 10_000);
  assertEquals(entries.size, 0);
});

Deno.test("enforceKeyLimit - does nothing when under limit", () => {
  const entries = new Map<string, number[]>();
  entries.set("a", [1]);
  entries.set("b", [2]);

  const removed = enforceKeyLimit(entries, 10);
  assertEquals(removed, 0);
  assertEquals(entries.size, 2);
});
Deno.test("enforceKeyLimit - removes excess entries when at limit", () => {
  const entries = new Map<string, number[]>();
  for (let i = 0; i < 200; i++) {
    entries.set(`key-${i}`, [Date.now()]);
  }

  const removed = enforceKeyLimit(entries, 100);
  assert(removed > 0);
  assert(entries.size <= 100);
});
Deno.test("enforceKeyLimit - removes entries from the beginning (oldest insertion)", () => {
  const entries = new Map<string, number[]>();
  entries.set("first", [1]);
  entries.set("second", [2]);
  entries.set("third", [3]);

  enforceKeyLimit(entries, 2);
  // 'first' should be removed as it was inserted first
  assertEquals(entries.has("first"), false);
});
