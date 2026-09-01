import { expect, test } from "bun:test";
import {
  createMessageSchema,
  getAuthorizedThreadHistory,
  historyQuerySchema,
  timelineQuerySchema,
} from "../threads/messages.ts";
import type { Env } from "../../../shared/types/index.ts";
import {
  MAX_CLIENT_MESSAGE_ATTACHMENTS,
  MAX_CLIENT_MESSAGE_CHARACTERS,
} from "../../../shared/utils/client-message.ts";

test("public message creation accepts only bounded user transcript input", () => {
  expect(
    createMessageSchema.safeParse({
      role: "user",
      content: "hello",
      idempotency_key: "ab".repeat(16),
      metadata: {
        attachments: [{
          file_id: "file_1",
          path: "/chat-attachments/thread/file.txt",
          name: "file.txt",
          mime_type: "text/plain",
          size: 12,
        }],
      },
    }).success,
  ).toBe(true);
  expect(
    createMessageSchema.safeParse({
      role: "user",
      content: "x".repeat(MAX_CLIENT_MESSAGE_CHARACTERS + 1),
    }).success,
  ).toBe(false);
  expect(
    createMessageSchema.safeParse({
      role: "user",
      metadata: {
        attachments: Array.from(
          { length: MAX_CLIENT_MESSAGE_ATTACHMENTS + 1 },
          (_, index) => ({ name: `file-${index}.txt` }),
        ),
      },
    }).success,
  ).toBe(false);
  expect(
    createMessageSchema.safeParse({
      role: "user",
      metadata: { attachments: [{ name: "claim-without-file-id.txt" }] },
    }).success,
  ).toBe(false);
});

test("public clients cannot forge runtime-owned transcript roles or fields", () => {
  for (const role of ["assistant", "system", "tool"] as const) {
    expect(createMessageSchema.safeParse({ role, content: "forged" }).success)
      .toBe(false);
  }
  expect(
    createMessageSchema.safeParse({
      role: "user",
      content: "forged tool output",
      tool_calls: [{ name: "shell" }],
    }).success,
  ).toBe(false);
  expect(
    createMessageSchema.safeParse({
      role: "user",
      content: "opaque metadata",
      metadata: { trusted: true },
    }).success,
  ).toBe(false);
});

test("Chat history queries accept only bounded current projection controls", () => {
  expect(historyQuerySchema.safeParse({
    include_messages: "0",
    root_run_id: "run_request_" + "ab".repeat(16),
  }).success).toBe(true);
  expect(historyQuerySchema.safeParse({ include_messages: "2" }).success)
    .toBe(false);
  expect(historyQuerySchema.safeParse({ root_run_id: "../run" }).success)
    .toBe(false);
  expect(historyQuerySchema.safeParse({ root_run_id: "x".repeat(129) }).success)
    .toBe(false);
  expect(historyQuerySchema.safeParse({ latest: "1" }).success).toBe(true);
  expect(historyQuerySchema.safeParse({ latest: "true" }).success).toBe(false);
  expect(timelineQuerySchema.safeParse({ latest: "1" }).success).toBe(true);
  expect(timelineQuerySchema.safeParse({ latest: "true" }).success).toBe(
    false,
  );
});

test("Chat history forwards the authorized Thread Workspace to its service", async () => {
  let requestedSpaceId: string | undefined;
  const expected = {
    messages: [],
    total: 0,
    limit: 10,
    offset: 0,
    runs: [],
    focus: {
      latest_run_id: null,
      latest_active_run_id: null,
      latest_failed_run_id: null,
      latest_completed_run_id: null,
      resume_run_id: null,
    },
    activeRun: null,
    taskContext: null,
    truncation: {
      message_data: false,
      runs: false,
      artifacts: false,
      events: false,
      event_data: false,
    },
  };

  const actual = await getAuthorizedThreadHistory(
    { DB: {} } as Env,
    "thread_1",
    "user_1",
    { limit: 10, offset: 0, includeMessages: false },
    {
      checkThreadAccess: (async (_db, threadId, userId) => {
        expect(threadId).toBe("thread_1");
        expect(userId).toBe("user_1");
        return {
          thread: {
            id: "thread_1",
            space_id: "space_authorized",
          },
        };
      }) as never,
      getThreadHistory: (async (_env, threadId, options) => {
        expect(threadId).toBe("thread_1");
        requestedSpaceId = options.spaceId;
        return expected;
      }) as never,
    },
  );

  expect(requestedSpaceId).toBe("space_authorized");
  expect(actual).toEqual(expected);
});
