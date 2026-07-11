import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "../agent-models.ts";
import {
  groupCoherentHistoryCandidates,
  isValidToolCallsArray,
  type ConversationHistoryCandidate,
} from "../runner-history.ts";

function candidate(
  sequence: number,
  msg: AgentMessage,
): ConversationHistoryCandidate {
  return { sequence, msg, tokens: 1 };
}

describe("provider-coherent conversation history", () => {
  test("canonical tool calls require non-empty ids/names and object arguments", () => {
    expect(
      isValidToolCallsArray([
        { id: "call-1", name: "read", arguments: { path: "/tmp" } },
      ]),
    ).toBe(true);
    expect(
      isValidToolCallsArray([
        { id: "", name: "read", arguments: { path: "/tmp" } },
      ]),
    ).toBe(false);
    expect(
      isValidToolCallsArray([
        { id: "call-1", name: "read", arguments: [] },
      ]),
    ).toBe(false);
  });

  test("keeps a parallel tool exchange as one indivisible group", () => {
    const groups = groupCoherentHistoryCandidates([
      candidate(1, { role: "user", content: "do both" }),
      candidate(2, {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "call-a", name: "read_a", arguments: {} },
          { id: "call-b", name: "read_b", arguments: {} },
        ],
      }),
      candidate(3, {
        role: "tool",
        content: "b",
        tool_call_id: "call-b",
      }),
      candidate(4, {
        role: "tool",
        content: "a",
        tool_call_id: "call-a",
      }),
      candidate(5, { role: "assistant", content: "done" }),
    ]);

    expect(groups.map((group) => group.map((entry) => entry.sequence))).toEqual([
      [1],
      [2, 3, 4],
      [5],
    ]);
  });

  test("drops orphan results and incomplete empty tool calls", () => {
    const groups = groupCoherentHistoryCandidates([
      candidate(1, {
        role: "tool",
        content: "orphan",
        tool_call_id: "old",
      }),
      candidate(2, {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "call-a", name: "read_a", arguments: {} },
          { id: "call-b", name: "read_b", arguments: {} },
        ],
      }),
      candidate(3, {
        role: "tool",
        content: "only a",
        tool_call_id: "call-a",
      }),
      candidate(4, { role: "user", content: "continue" }),
    ]);

    expect(groups.flat().map((entry) => entry.sequence)).toEqual([4]);
  });

  test("retains text but strips calls from an incomplete assistant exchange", () => {
    const groups = groupCoherentHistoryCandidates([
      candidate(1, {
        role: "assistant",
        content: "I started checking.",
        tool_calls: [{ id: "call-a", name: "read_a", arguments: {} }],
      }),
      candidate(2, { role: "user", content: "new request" }),
    ]);

    expect(groups[0][0].msg).toEqual({
      role: "assistant",
      content: "I started checking.",
    });
    expect(groups[1][0].sequence).toBe(2);
  });
});
