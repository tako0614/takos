import { describe, expect, test } from "bun:test";
import {
  parseMemoriesListResponse,
  parseMemoryDeleteResponse,
  parseMemoryMutationResponse,
  parseRemindersListResponse,
  parseReminderMutationResponse,
} from "../../hooks/memory-mutation-response.ts";

const now = "2026-08-09T00:00:00.000Z";

function memory(overrides: Record<string, unknown> = {}) {
  return {
    id: "memory-1",
    space_id: "space-1",
    user_id: "user-1",
    thread_id: null,
    content: "remember",
    type: "semantic",
    category: null,
    summary: null,
    importance: 0.5,
    tags: null,
    occurred_at: now,
    expires_at: null,
    last_accessed_at: null,
    access_count: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function reminder(overrides: Record<string, unknown> = {}) {
  return {
    id: "reminder-1",
    space_id: "space-1",
    user_id: "user-1",
    content: "later",
    context: null,
    trigger_type: "time",
    trigger_value: "tomorrow",
    status: "pending",
    triggered_at: null,
    priority: "normal",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("Memory response parsing", () => {
  test("accepts and projects the Worker's current records", () => {
    expect(parseMemoryMutationResponse(memory(), "space-1").id).toBe(
      "memory-1",
    );
    expect(parseReminderMutationResponse(reminder(), "space-1").id).toBe(
      "reminder-1",
    );
    expect(parseMemoriesListResponse({ memories: [memory()] }, "space-1"))
      .toHaveLength(1);
    expect(parseRemindersListResponse({ reminders: [reminder()] }, "space-1"))
      .toHaveLength(1);
  });

  test("rejects stale wrappers, malformed fields, and duplicate ids", () => {
    expect(() => parseMemoryMutationResponse({ memory: {} }, "space-1"))
      .toThrow(TypeError);
    expect(() => parseReminderMutationResponse({ reminder: {} }, "space-1"))
      .toThrow(TypeError);
    expect(() =>
      parseReminderMutationResponse(
        reminder({ trigger_type: "unsupported" }),
        "space-1",
      )
    ).toThrow(TypeError);
    expect(() =>
      parseMemoriesListResponse({ memories: [memory(), memory()] }, "space-1")
    ).toThrow(TypeError);
    expect(() =>
      parseRemindersListResponse({ reminders: [reminder({ created_at: "bad" })] }, "space-1")
    ).toThrow(TypeError);
  });

  test("rejects cross-space, wrong-id, and invalid numeric state", () => {
    expect(() =>
      parseMemoryMutationResponse(memory({ space_id: "space-other" }), "space-1")
    ).toThrow(TypeError);
    expect(() =>
      parseMemoryMutationResponse(memory({ importance: 2 }), "space-1")
    ).toThrow(TypeError);
    expect(() =>
      parseMemoryMutationResponse(memory(), "space-1", "memory-other")
    ).toThrow(TypeError);
    expect(() =>
      parseReminderMutationResponse(
        reminder({ space_id: "space-other" }),
        "space-1",
      )
    ).toThrow(TypeError);
    expect(() =>
      parseReminderMutationResponse(reminder(), "space-1", "reminder-other")
    ).toThrow(TypeError);
  });

  test("delete responses require explicit accepted success", () => {
    expect(parseMemoryDeleteResponse({ success: true })).toBeUndefined();
    expect(() => parseMemoryDeleteResponse({ success: false })).toThrow(
      TypeError,
    );
    expect(() => parseMemoryDeleteResponse({})).toThrow(TypeError);
  });
});
