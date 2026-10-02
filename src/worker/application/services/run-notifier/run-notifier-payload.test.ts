import { expect, test } from "bun:test";
import { buildRunNotifierEmitPayload } from "./run-notifier-payload.ts";

test("SQL-backed Run event payload carries a stable retry key", () => {
  const payload = buildRunNotifierEmitPayload("run-1", "run.progress", { step: 2 }, 42);
  expect(payload).toEqual({
    runId: "run-1", type: "run.progress", data: { step: 2 },
    event_id: 42, dedup_key: "run:run-1:event:42",
  });
  expect(buildRunNotifierEmitPayload("run-1", "run.progress", { step: 2 }))
    .not.toHaveProperty("dedup_key");
});
