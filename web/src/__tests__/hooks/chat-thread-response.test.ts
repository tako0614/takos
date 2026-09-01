import { expect, test } from "bun:test";
import {
  MAX_CHAT_THREADS_PER_RESPONSE,
  MAX_CLIENT_THREAD_TITLE_CHARACTERS,
} from "takos-api-contract/chat-thread";
import {
  parseChatThreadActionResponse,
  parseChatThreadInventoryResponse,
  parseChatThreadResponse,
} from "../../hooks/chat-thread-response.ts";
import type { Thread } from "../../types/index.ts";

function thread(overrides: Record<string, unknown> = {}) {
  return {
    id: "thread_1",
    space_id: "space_1",
    title: null,
    locale: "ja",
    status: "active",
    summary: null,
    key_points: "[]",
    retrieval_index: -1,
    context_window: 50,
    created_at: "2026-08-10T00:00:00.000Z",
    updated_at: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

test("Chat Thread responses preserve an untitled exact Workspace record", () => {
  expect(parseChatThreadResponse(
    { thread: thread() },
    { spaceId: "space_1", threadId: "thread_1" },
  )).toEqual(thread() as unknown as Thread);
  expect(() =>
    parseChatThreadResponse(
      { thread: thread({ id: "thread_2" }) },
      { spaceId: "space_1", threadId: "thread_1" },
    )
  ).toThrow("Mismatched Chat Thread identity");
  expect(() =>
    parseChatThreadResponse(
      { thread: thread({ space_id: "space_2" }) },
      { spaceId: "space_1" },
    )
  ).toThrow("Mismatched Chat Thread identity");
});

test("Chat Thread inventory rejects duplicate and malformed runtime state", () => {
  expect(() =>
    parseChatThreadInventoryResponse({
      threads: [thread(), thread()],
      truncated: false,
    }, "space_1")
  ).toThrow("Duplicate Chat Thread identity");
  expect(() =>
    parseChatThreadInventoryResponse({
      threads: [thread({ status: "deleted" })],
      truncated: false,
    }, "space_1")
  ).toThrow("Invalid Chat Thread status");
  expect(() =>
    parseChatThreadInventoryResponse({
      threads: [thread({
        title: "x".repeat(MAX_CLIENT_THREAD_TITLE_CHARACTERS + 1),
      })],
      truncated: false,
    }, "space_1")
  ).toThrow("Invalid Chat Thread title");
  expect(() =>
    parseChatThreadInventoryResponse({
      threads: [thread({ key_points: JSON.stringify(["x".repeat(161)]) })],
      truncated: false,
    }, "space_1")
  ).toThrow("Invalid Chat Thread key_points");
  expect(() =>
    parseChatThreadInventoryResponse({ threads: [], truncated: "false" }, "space_1")
  ).toThrow("Invalid Chat Thread inventory");
  expect(() =>
    parseChatThreadInventoryResponse({
      threads: Array.from(
        { length: MAX_CHAT_THREADS_PER_RESPONSE + 1 },
        (_, index) => thread({ id: `thread_${index}` }),
      ),
      truncated: true,
    }, "space_1")
  ).toThrow("Invalid Chat Thread inventory");
  expect(parseChatThreadInventoryResponse({
    threads: [thread()],
    truncated: true,
  }, "space_1")).toEqual({
    threads: [thread() as unknown as Thread],
    truncated: true,
  });
});

test("Chat Thread actions require explicit canonical acceptance", () => {
  const expected = { threadId: "thread_1", status: "archived" } as const;
  expect(parseChatThreadActionResponse({
    success: true,
    thread_id: "thread_1",
    status: "archived",
  }, expected)).toBeUndefined();
  expect(() => parseChatThreadActionResponse({
    success: true,
    thread_id: "thread_2",
    status: "archived",
  }, expected)).toThrow("Invalid Chat Thread action response");
  expect(() => parseChatThreadActionResponse({
    success: "true",
    thread_id: "thread_1",
    status: "archived",
  }, expected)).toThrow(
    "Invalid Chat Thread action response",
  );
  expect(() => parseChatThreadActionResponse({}, expected)).toThrow(
    "Invalid Chat Thread action response",
  );
  expect(() => parseChatThreadActionResponse({
    success: true,
    thread_id: "thread_1",
    status: "archived",
    extra: true,
  }, expected)).toThrow(
    "Invalid Chat Thread action response",
  );
});
