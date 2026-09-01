import { expect, test } from "bun:test";
import {
  CHAT_OPERATION_ID_PATTERN,
  chatRunIdForOperation,
  createChatOperationId,
  isActiveChatRun,
  isSameChatDraft,
  shouldRetryChatRun,
} from "../../hooks/chat-operation-id.ts";
import {
  MAX_CHAT_ATTACHMENTS,
  MAX_CHAT_MESSAGE_CHARACTERS,
} from "../../hooks/chat-limits.ts";

test("Chat draft limits mirror the public message boundary", () => {
  expect(MAX_CHAT_MESSAGE_CHARACTERS).toBe(20_000);
  expect(MAX_CHAT_ATTACHMENTS).toBe(10);
});

test("Chat operation IDs are fixed-width cryptographic request keys", () => {
  const key = createChatOperationId({
    getRandomValues<T extends ArrayBufferView | null>(array: T): T {
      if (!(array instanceof Uint8Array)) {
        throw new TypeError("Expected Uint8Array");
      }
      array.fill(0xab);
      return array;
    },
  });
  expect(key).toBe("ab".repeat(16));
  expect(CHAT_OPERATION_ID_PATTERN.test(key)).toBe(true);
  expect(chatRunIdForOperation(key)).toBe(`run_request_${key}`);
  expect(() => chatRunIdForOperation("invalid")).toThrow(
    "Invalid Chat operation id",
  );
});

test("Chat retries reuse an operation only for the exact draft and files", () => {
  const file = new File(["body"], "proof.txt", {
    type: "text/plain",
    lastModified: 123,
  });
  expect(
    isSameChatDraft(
      { input: "retry", files: [file] },
      { input: "retry", files: [file] },
    ),
  ).toBe(true);
  expect(
    isSameChatDraft(
      { input: "retry", files: [file] },
      { input: "changed", files: [file] },
    ),
  ).toBe(false);
  expect(
    isSameChatDraft(
      { input: "retry", files: [file] },
      { input: "retry", files: [] },
    ),
  ).toBe(false);
});

test("Chat retries only terminal failures and reconnects to active Runs", () => {
  expect(shouldRetryChatRun("failed")).toBe(true);
  expect(shouldRetryChatRun("cancelled")).toBe(true);
  expect(shouldRetryChatRun("completed")).toBe(false);
  expect(isActiveChatRun("pending")).toBe(true);
  expect(isActiveChatRun("queued")).toBe(true);
  expect(isActiveChatRun("running")).toBe(true);
  expect(isActiveChatRun("completed")).toBe(false);
});
