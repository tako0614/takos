import { expect, test } from "bun:test";
import {
  MAX_CHAT_MESSAGE_METADATA_CHARACTERS,
  MAX_CLIENT_MESSAGE_ATTACHMENTS,
} from "takos-api-contract/chat-message";
import {
  buildChatMessageMetadata,
  isChatAttachmentInlineImageMimeType,
  parseChatMessageMetadata,
} from "../../../views/chat/messageMetadata.ts";

test("message metadata keeps only bounded attachments for the exact Thread", () => {
  const parsed = parseChatMessageMetadata(JSON.stringify({
    attachments: [
      {
        file_id: "file_1",
        path: "/chat-attachments/thread_1/photo.png",
        name: "photo.png",
        mime_type: "image/png",
        size: 42,
      },
      {
        file_id: "file_2",
        path: "/chat-attachments/thread_2/secret.png",
        name: "secret.png",
        mime_type: "image/png",
        size: 42,
      },
      {
        file_id: "file_3",
        path: "/chat-attachments/thread_1/../secret.png",
        name: "secret.png",
        mime_type: "image/png",
        size: 42,
      },
    ],
  }), "thread_1");

  expect(parsed.attachments).toEqual([{
    file_id: "file_1",
    path: "/chat-attachments/thread_1/photo.png",
    name: "photo.png",
    mime_type: "image/png",
    size: 42,
  }]);
});

test("message metadata bounds lists, values, and total parse work", () => {
  const attachments = Array.from(
    { length: MAX_CLIENT_MESSAGE_ATTACHMENTS + 5 },
    (_, index) => ({ name: `file-${index}.txt`, size: index }),
  );
  const parsed = parseChatMessageMetadata(JSON.stringify({
    attachments,
    tool_executions: Array.from({ length: 105 }, (_, index) => ({
      name: `tool_${index}`,
      arguments: {},
      duration_ms: index,
    })),
  }));
  expect(parsed.attachments).toHaveLength(MAX_CLIENT_MESSAGE_ATTACHMENTS);
  expect(parsed.toolExecutions).toHaveLength(100);

  const oversized = parseChatMessageMetadata(
    "x".repeat(MAX_CHAT_MESSAGE_METADATA_CHARACTERS + 1),
  );
  expect(oversized).toEqual({ attachments: [], toolExecutions: [] });
});

test("message attachment image layout excludes active same-origin formats", () => {
  expect(isChatAttachmentInlineImageMimeType("image/png")).toBe(true);
  expect(isChatAttachmentInlineImageMimeType("IMAGE/WEBP")).toBe(true);
  expect(isChatAttachmentInlineImageMimeType("image/svg+xml")).toBe(false);
  expect(isChatAttachmentInlineImageMimeType("text/html")).toBe(false);
});

test("optimistic message metadata remains a bounded display-only projection", () => {
  const metadata = buildChatMessageMetadata({
    attachments: [{
      name: "draft.txt",
      path: "/chat-attachments/thread_1/generated-draft.txt",
      mime_type: "text/plain",
      size: 5,
    }],
  });
  expect(parseChatMessageMetadata(metadata, "thread_1").attachments).toEqual([{
    file_id: undefined,
    name: "draft.txt",
    path: "/chat-attachments/thread_1/generated-draft.txt",
    mime_type: "text/plain",
    size: 5,
  }]);
});
