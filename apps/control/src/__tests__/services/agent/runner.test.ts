import { assertEquals } from "jsr:@std/assert";

import {
  isValidToolCallsArray,
  normalizeRunStatus,
} from "@/services/agent/runner";

Deno.test("isValidToolCallsArray accepts valid tool call payloads", () => {
  assertEquals(
    isValidToolCallsArray([
      { id: "tc1", name: "file_read", arguments: { path: "/tmp/demo.txt" } },
      {
        id: "tc2",
        name: "web_fetch",
        arguments: { url: "https://example.com" },
      },
    ]),
    true,
  );
  assertEquals(isValidToolCallsArray([]), true);
});

Deno.test("isValidToolCallsArray rejects malformed payloads", () => {
  assertEquals(isValidToolCallsArray("not-array"), false);
  assertEquals(isValidToolCallsArray(null), false);
  assertEquals(isValidToolCallsArray(undefined), false);
  assertEquals(isValidToolCallsArray([{ id: "tc1" }]), false);
  assertEquals(isValidToolCallsArray([{ id: "tc1", name: "tool" }]), false);
  assertEquals(
    isValidToolCallsArray([{ id: "tc1", name: "tool", arguments: null }]),
    false,
  );
  assertEquals(isValidToolCallsArray([null]), false);
  assertEquals(isValidToolCallsArray(["string"]), false);
});

Deno.test("normalizeRunStatus accepts canonical statuses", () => {
  assertEquals(normalizeRunStatus("pending"), "pending");
  assertEquals(normalizeRunStatus("queued"), "queued");
  assertEquals(normalizeRunStatus("running"), "running");
  assertEquals(normalizeRunStatus("completed"), "completed");
  assertEquals(normalizeRunStatus("failed"), "failed");
  assertEquals(normalizeRunStatus("cancelled"), "cancelled");
});

Deno.test("normalizeRunStatus returns null for unknown statuses", () => {
  assertEquals(normalizeRunStatus("done"), null);
  assertEquals(normalizeRunStatus(""), null);
  assertEquals(normalizeRunStatus(null), null);
  assertEquals(normalizeRunStatus(undefined), null);
});
