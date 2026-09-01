import { expect, test } from "bun:test";
import { MAX_CHAT_MESSAGE_METADATA_CHARACTERS } from "takos-api-contract/chat-message";
import {
  parseChatMessageMutationResponse,
  parseChatMessages,
  parseChatMessagesResponse,
} from "../../hooks/chat-message-response.ts";
import type { Message } from "../../types/index.ts";

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "message_1",
    thread_id: "thread_1",
    role: "user",
    content: "hello\nworld",
    tool_calls: null,
    tool_call_id: null,
    metadata: "{}",
    sequence: 0,
    created_at: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

test("Chat message responses are fenced to the requested Thread", () => {
  expect(
    parseChatMessagesResponse({
      messages: [message()],
      total: 1,
      limit: 100,
      offset: 0,
      truncation: { message_data: false },
    }, "thread_1", { limit: 100, offset: 0 }).messages,
  ).toEqual([message()]);
  expect(() =>
    parseChatMessagesResponse({
      messages: [message({ thread_id: "thread_2" })],
      total: 1,
      limit: 100,
      offset: 0,
      truncation: { message_data: false },
    }, "thread_1", { limit: 100, offset: 0 })
  ).toThrow("Mismatched Chat message Thread id");
  expect(() =>
    parseChatMessageMutationResponse(
      { message: message({ thread_id: "thread_2" }) },
      "thread_1",
    )
  ).toThrow("Mismatched Chat message Thread id");
});

test("Chat message pages require exact pagination and latest-page evidence", () => {
  const latest = parseChatMessagesResponse({
    messages: [message({ sequence: 150 })],
    total: 151,
    limit: 100,
    offset: 51,
    truncation: { message_data: true },
  }, "thread_1", { limit: 100, latest: true });
  expect(latest.offset).toBe(51);

  expect(() =>
    parseChatMessagesResponse({
      messages: [message()],
      total: 1,
      limit: 100,
      offset: 0,
      truncation: { message_data: false },
      activeRun: { input: "must-not-cross-the-message-timeline" },
    }, "thread_1", { limit: 100, latest: true })
  ).toThrow("Invalid Chat messages response");
  expect(() =>
    parseChatMessagesResponse({
      messages: [message()],
      total: 101,
      limit: 100,
      offset: 0,
      truncation: { message_data: false },
    }, "thread_1", { limit: 100, latest: true })
  ).toThrow("Mismatched Chat message page");
  expect(latest.truncation.message_data).toBe(true);
  expect(() =>
    parseChatMessagesResponse({
      messages: [message()],
      total: 1,
      limit: 100,
      offset: 0,
      truncation: {},
    }, "thread_1", { limit: 100, latest: true })
  ).toThrow("Invalid Chat message truncation");
});

test("Chat message lists reject partial identities and duplicate timelines", () => {
  expect(() => parseChatMessages({}, "thread_1")).toThrow(
    "Invalid Chat message list",
  );
  expect(() =>
    parseChatMessages([
      message(),
      message({ id: "message_2" }),
    ], "thread_1")
  ).toThrow("Duplicate Chat message identity");
  expect(() =>
    parseChatMessages([
      message(),
      message({ sequence: 1 }),
    ], "thread_1")
  ).toThrow("Duplicate Chat message identity");
  expect(() =>
    parseChatMessages([
      message({ id: "message_2", sequence: 2 }),
      message({ id: "message_1", sequence: 1 }),
    ], "thread_1")
  ).toThrow("Unordered Chat message timeline");
});

test("Chat message fields are bounded before verified state is replaced", () => {
  expect(() =>
    parseChatMessages([message({
      metadata: "x".repeat(MAX_CHAT_MESSAGE_METADATA_CHARACTERS + 1),
    })], "thread_1")
  ).toThrow("Invalid Chat message metadata");
  expect(() =>
    parseChatMessages([message({ id: "bad\nid" })], "thread_1")
  ).toThrow("Invalid Chat message id");
  expect(() =>
    parseChatMessages([message({ sequence: -1 })], "thread_1")
  ).toThrow("Invalid Chat message sequence");
  expect(() =>
    parseChatMessages([message({ created_at: "not-a-date" })], "thread_1")
  ).toThrow("Invalid Chat message timestamp");
});
