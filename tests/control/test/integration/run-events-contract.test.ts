import {
  buildRunFailedPayload,
  buildTerminalPayload,
  RUN_TERMINAL_EVENT_TYPES,
  TERMINAL_STATUS_BY_EVENT_TYPE,
} from "@/application/services/run-notifier/run-events-contract.ts";

import { strict as assert } from "node:assert";
import { test } from "bun:test";

test("run events contract - builds terminal payload with status and run metadata", () => {
  const payload = buildTerminalPayload(
    "run_1",
    "completed",
    { success: true },
    "session_1",
  );

  assert.deepStrictEqual(payload, {
    status: "completed",
    run: {
      id: "run_1",
      session_id: "session_1",
    },
    success: true,
  });
});

test("run events contract - builds failed payload with optional permanence and session id", () => {
  const payload = buildRunFailedPayload("run_2", "failed permanently", {
    permanent: true,
    sessionId: null,
  });

  assert.deepStrictEqual(payload, {
    status: "failed",
    run: {
      id: "run_2",
      session_id: null,
    },
    error: "failed permanently",
    permanent: true,
  });
});

test("run events contract - maps terminal event types to terminal statuses", () => {
  assert.deepStrictEqual(TERMINAL_STATUS_BY_EVENT_TYPE["completed"], "completed");
  assert.deepStrictEqual(TERMINAL_STATUS_BY_EVENT_TYPE["error"], "failed");
  assert.deepStrictEqual(TERMINAL_STATUS_BY_EVENT_TYPE["cancelled"], "cancelled");
  assert.deepStrictEqual(TERMINAL_STATUS_BY_EVENT_TYPE["run.failed"], "failed");
  assert.deepStrictEqual(RUN_TERMINAL_EVENT_TYPES.has("completed"), true);
  assert.deepStrictEqual(RUN_TERMINAL_EVENT_TYPES.has("run.failed"), true);
  assert.deepStrictEqual(
    RUN_TERMINAL_EVENT_TYPES.has("run.status" as never),
    false,
  );
});
