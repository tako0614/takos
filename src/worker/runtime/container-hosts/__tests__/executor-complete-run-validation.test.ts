import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import {
  handleCompleteRun,
  parseCompleteRunMessages,
} from "../executor-control-rpc.ts";

test("complete-run rejects role-invalid and reused tool correlation fields", () => {
  assertEquals(
    parseCompleteRunMessages([
      { role: "assistant", content: "bad", tool_call_id: "call-1" },
    ]),
    null,
  );
  assertEquals(
    parseCompleteRunMessages([
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "call-1", name: "read", arguments: {} }],
      },
      {
        role: "tool",
        content: "result",
        tool_call_id: "call-1",
        tool_calls: [],
      },
    ]),
    null,
  );
  assertEquals(
    parseCompleteRunMessages([
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "call-1", name: "read", arguments: {} }],
      },
      { role: "tool", content: "first", tool_call_id: "call-1" },
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "call-1", name: "read", arguments: {} }],
      },
      { role: "tool", content: "second", tool_call_id: "call-1" },
    ]),
    null,
  );
});

test("complete-run accepts one result for every unique parallel tool call", () => {
  const parsed = parseCompleteRunMessages([
    {
      role: "assistant",
      content: "",
      tool_calls: [
        { id: "call-1", name: "read", arguments: { path: "a" } },
        { id: "call-2", name: "read", arguments: { path: "b" } },
      ],
    },
    { role: "tool", content: "a", tool_call_id: "call-1" },
    { role: "tool", content: "b", tool_call_id: "call-2" },
    { role: "assistant", content: "done" },
  ]);
  assertEquals(parsed?.length, 4);
});

test("complete-run enforces per-message, per-batch, and total transcript bounds", () => {
  assertEquals(
    parseCompleteRunMessages([
      { role: "assistant", content: "x".repeat(512 * 1024 + 1) },
    ]),
    null,
  );
  assertEquals(
    parseCompleteRunMessages([
      {
        role: "assistant",
        content: "",
        tool_calls: Array.from({ length: 17 }, (_, index) => ({
          id: `call-${index}`,
          name: "read",
          arguments: {},
        })),
      },
    ]),
    null,
  );
  const largeArgument = "x".repeat(900 * 1024);
  const oversizedTranscript: Array<Record<string, unknown>> = [];
  for (let batch = 0; batch < 5; batch++) {
    const calls = Array.from({ length: 16 }, (_, index) => ({
      id: `batch-${batch}-call-${index}`,
      name: "read",
      arguments: { payload: largeArgument },
    }));
    oversizedTranscript.push({
      role: "assistant",
      content: "",
      tool_calls: calls,
    });
    oversizedTranscript.push(
      ...calls.map((call) => ({
        role: "tool",
        content: "ok",
        tool_call_id: call.id,
      })),
    );
  }
  assertEquals(parseCompleteRunMessages(oversizedTranscript), null);
});

test("complete-run rejects pathological JSON depth and node counts", () => {
  let deep: Record<string, unknown> = {};
  for (let index = 0; index < 34; index++) deep = { child: deep };
  assertEquals(
    parseCompleteRunMessages([
      { role: "assistant", content: "done", metadata: deep },
    ]),
    null,
  );

  assertEquals(
    parseCompleteRunMessages([
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call-wide",
            name: "write",
            arguments: {
              values: Array.from({ length: 4_100 }, (_, index) => index),
            },
          },
        ],
      },
      { role: "tool", content: "ok", tool_call_id: "call-wide" },
    ]),
    null,
  );
});

test("complete-run requires an exact finite nonnegative integer lease version", async () => {
  const base = {
    runId: "run-1",
    serviceId: "service-1",
    status: "completed",
    usage: { inputTokens: 1, outputTokens: 1 },
    messages: [{ role: "assistant", content: "done" }],
  };
  for (const leaseVersion of [undefined, -1, 1.5, Number.NaN]) {
    const response = await handleCompleteRun(
      {
        ...base,
        ...(leaseVersion === undefined ? {} : { leaseVersion }),
      },
      {} as never,
    );
    assertEquals(response.status, 400);
  }
});

test("complete-run rejects invalid usage before touching the database", async () => {
  const base = {
    runId: "run-1",
    serviceId: "service-1",
    leaseVersion: 1,
    status: "completed",
    messages: [{ role: "assistant", content: "done" }],
  };
  for (const usage of [
    { inputTokens: -1, outputTokens: 1 },
    { inputTokens: 1.5, outputTokens: 1 },
    { inputTokens: 1, outputTokens: -1 },
    { inputTokens: 1, outputTokens: 1, cachedInputTokens: 2 },
  ]) {
    const response = await handleCompleteRun({ ...base, usage }, {} as never);
    assertEquals(response.status, 400);
  }
});

test("complete-run does not grant the container user-cancellation authority", async () => {
  const response = await handleCompleteRun(
    {
      runId: "run-1",
      serviceId: "service-1",
      leaseVersion: 1,
      status: "cancelled",
      usage: { inputTokens: 1, outputTokens: 1 },
      messages: [],
    },
    {} as never,
  );
  assertEquals(response.status, 400);
});
