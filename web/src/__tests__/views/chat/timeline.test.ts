import { strict as assert, deepStrictEqual as assertEquals } from "node:assert/strict";
import { test } from "bun:test";


const {
  normalizeTimelineEventType,
  summarizeEvent,
} = await import("../../../views/chat/timeline.ts");

test("normalizeTimelineEventType - unknown events fall back to progress", () => {
  assertEquals(normalizeTimelineEventType("future.benign"), "progress");
});

test("summarizeEvent - unknown events are treated as non-failed progress", () => {
  const summary = summarizeEvent(
    normalizeTimelineEventType("future.benign"),
    { message: "still working" },
    (key) => key,
  );

  assertEquals(summary.message, "still working");
  assert(!summary.failed);
});

test("summarizeEvent - failed runs still report failure", () => {
  const summary = summarizeEvent(
    "run.failed",
    { error: "boom" },
    (key) => key,
  );

  assertEquals(summary.message, "timelineRunFailed");
  assertEquals(summary.detail, "boom");
  assert(summary.failed ?? false);
});
