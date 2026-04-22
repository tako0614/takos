import { assert, assertEquals, assertFalse } from "jsr:@std/assert";

const {
  normalizeTimelineEventType,
  summarizeEvent,
} = await import("../../../views/chat/timeline.ts");

Deno.test("normalizeTimelineEventType - unknown events fall back to progress", () => {
  assertEquals(normalizeTimelineEventType("future.benign"), "progress");
});

Deno.test("summarizeEvent - unknown events are treated as non-failed progress", () => {
  const summary = summarizeEvent(
    normalizeTimelineEventType("future.benign"),
    { message: "still working" },
    (key) => key,
  );

  assertEquals(summary.message, "still working");
  assertFalse(summary.failed ?? false);
});

Deno.test("summarizeEvent - failed runs still report failure", () => {
  const summary = summarizeEvent(
    "run.failed",
    { error: "boom" },
    (key) => key,
  );

  assertEquals(summary.message, "timelineRunFailed");
  assertEquals(summary.detail, "boom");
  assert(summary.failed ?? false);
});
