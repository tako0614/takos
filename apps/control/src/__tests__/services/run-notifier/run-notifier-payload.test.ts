import { buildRunNotifierEmitPayload } from "@/services/run-notifier/run-notifier-payload";

import { assertEquals } from "jsr:@std/assert";

Deno.test("run-notifier-payload helper - adds event_id when present", () => {
  const payload = buildRunNotifierEmitPayload(
    "run-1",
    "run.failed",
    { status: "failed" },
    55,
  );
  assertEquals(payload, {
    runId: "run-1",
    type: "run.failed",
    data: { status: "failed" },
    event_id: 55,
  });
});
Deno.test("run-notifier-payload helper - omits event_id when event id is missing", () => {
  const payload = buildRunNotifierEmitPayload(
    "run-2",
    "progress",
    { phase: "exec" },
    null,
  );
  assertEquals(payload, {
    runId: "run-2",
    type: "progress",
    data: { phase: "exec" },
  });
});
