import {
  buildRunFailedPayload,
  buildTerminalPayload,
  deriveTerminalStatusFromRunEvent,
  parseRunEventPayload,
} from "@/services/run-notifier/run-events-contract";

import { assertEquals } from "jsr:@std/assert";

Deno.test("run-events-contract - derives terminal status from known terminal event types", () => {
  assertEquals(
    deriveTerminalStatusFromRunEvent("completed", "{}"),
    "completed",
  );
  assertEquals(deriveTerminalStatusFromRunEvent("error", "{}"), "failed");
  assertEquals(
    deriveTerminalStatusFromRunEvent("cancelled", "{}"),
    "cancelled",
  );
  assertEquals(deriveTerminalStatusFromRunEvent("run.failed", "{}"), "failed");
});
Deno.test("run-events-contract - derives terminal status from run_status payload", () => {
  assertEquals(
    deriveTerminalStatusFromRunEvent("run_status", '{"status":"completed"}'),
    "completed",
  );
  assertEquals(
    deriveTerminalStatusFromRunEvent("run_status", {
      run: { status: "failed" },
    }),
    "failed",
  );
  assertEquals(
    deriveTerminalStatusFromRunEvent("run_status", {
      run: { status: "cancelled" },
    }),
    "cancelled",
  );
});
Deno.test("run-events-contract - returns null for non-terminal or malformed payloads", () => {
  assertEquals(deriveTerminalStatusFromRunEvent("thinking", "{}"), null);
  assertEquals(
    deriveTerminalStatusFromRunEvent("run_status", '{"status":"running"}'),
    null,
  );
  assertEquals(
    deriveTerminalStatusFromRunEvent("run_status", "{not-json"),
    null,
  );
  assertEquals(deriveTerminalStatusFromRunEvent("run_status", []), null);
});
Deno.test("run-events-contract - parses object and string payloads consistently", () => {
  assertEquals(parseRunEventPayload('{"ok":true}'), { ok: true });
  assertEquals(parseRunEventPayload({ ok: true }), { ok: true });
  assertEquals(parseRunEventPayload("null"), null);
});
Deno.test("run-events-contract - builds terminal payloads with run context", () => {
  assertEquals(
    buildTerminalPayload("run-1", "completed", { success: true }, "sess-1"),
    {
      status: "completed",
      run: {
        id: "run-1",
        session_id: "sess-1",
      },
      success: true,
    },
  );

  assertEquals(
    buildRunFailedPayload("run-2", "boom", {
      permanent: true,
      sessionId: "sess-2",
    }),
    {
      status: "failed",
      run: {
        id: "run-2",
        session_id: "sess-2",
      },
      error: "boom",
      permanent: true,
    },
  );
});
