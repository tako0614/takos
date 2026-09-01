import {
  MAX_CHAT_MESSAGE_METADATA_CHARACTERS,
  MAX_CHAT_TIMELINE_MESSAGES,
} from "takos-api-contract/chat-message";
import type { Message } from "../types/index.ts";

const MAX_CHAT_MESSAGE_ID_CHARACTERS = 128;
const MAX_CHAT_MESSAGE_CONTENT_CHARACTERS = 4 * 1024 * 1024;
const MAX_CHAT_MESSAGE_TOOL_CALLS_CHARACTERS = 1024 * 1024;
const MAX_CHAT_MESSAGE_TIMESTAMP_CHARACTERS = 64;
const MESSAGE_ROLES = new Set(["user", "assistant", "system", "tool"]);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactFields(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const fields = Object.keys(value);
  return fields.length === expected.length &&
    fields.every((field) => expected.includes(field));
}

function nonnegativeInteger(value: unknown, field: string): number {
  if (
    typeof value !== "number" || !Number.isSafeInteger(value) || value < 0
  ) {
    throw new TypeError(`Invalid Chat message ${field}`);
  }
  return value;
}

function boundedString(
  value: unknown,
  name: string,
  maximum: number,
  allowEmpty = false,
  allowTextWhitespace = false,
): string {
  const invalidControlPattern = allowTextWhitespace
    ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u
    : /[\u0000-\u001f\u007f]/u;
  if (
    typeof value !== "string" || (!allowEmpty && value.length === 0) ||
    value.length > maximum || invalidControlPattern.test(value)
  ) {
    throw new TypeError(`Invalid ${name}`);
  }
  return value;
}

function nullableBoundedString(
  value: unknown,
  name: string,
  maximum: number,
  allowTextWhitespace = false,
): string | null {
  return value === null
    ? null
    : boundedString(value, name, maximum, true, allowTextWhitespace);
}

export function parseChatMessage(
  value: unknown,
  expectedThreadId: string,
): Message {
  const candidate = record(value);
  if (!candidate) throw new TypeError("Invalid Chat message");

  const threadId = boundedString(
    candidate.thread_id,
    "Chat message Thread id",
    MAX_CHAT_MESSAGE_ID_CHARACTERS,
  );
  if (threadId !== expectedThreadId) {
    throw new TypeError("Mismatched Chat message Thread id");
  }
  const role = boundedString(candidate.role, "Chat message role", 16);
  if (!MESSAGE_ROLES.has(role)) throw new TypeError("Invalid Chat message role");
  if (
    typeof candidate.sequence !== "number" ||
    !Number.isSafeInteger(candidate.sequence) || candidate.sequence < 0
  ) {
    throw new TypeError("Invalid Chat message sequence");
  }
  const createdAt = boundedString(
    candidate.created_at,
    "Chat message timestamp",
    MAX_CHAT_MESSAGE_TIMESTAMP_CHARACTERS,
  );
  if (!Number.isFinite(Date.parse(createdAt))) {
    throw new TypeError("Invalid Chat message timestamp");
  }

  return {
    id: boundedString(
      candidate.id,
      "Chat message id",
      MAX_CHAT_MESSAGE_ID_CHARACTERS,
    ),
    thread_id: threadId,
    role: role as Message["role"],
    content: boundedString(
      candidate.content,
      "Chat message content",
      MAX_CHAT_MESSAGE_CONTENT_CHARACTERS,
      true,
      true,
    ),
    tool_calls: nullableBoundedString(
      candidate.tool_calls ?? null,
      "Chat message tool calls",
      MAX_CHAT_MESSAGE_TOOL_CALLS_CHARACTERS,
      true,
    ),
    tool_call_id: nullableBoundedString(
      candidate.tool_call_id ?? null,
      "Chat message tool call id",
      MAX_CHAT_MESSAGE_ID_CHARACTERS,
    ),
    metadata: boundedString(
      candidate.metadata,
      "Chat message metadata",
      MAX_CHAT_MESSAGE_METADATA_CHARACTERS,
      true,
      true,
    ),
    sequence: candidate.sequence,
    created_at: createdAt,
  };
}

export function parseChatMessages(
  value: unknown,
  expectedThreadId: string,
): Message[] {
  if (
    !Array.isArray(value) || value.length > MAX_CHAT_TIMELINE_MESSAGES
  ) {
    throw new TypeError("Invalid Chat message list");
  }
  const messages = value.map((message) =>
    parseChatMessage(message, expectedThreadId)
  );
  const ids = new Set<string>();
  const sequences = new Set<number>();
  for (const message of messages) {
    if (ids.has(message.id) || sequences.has(message.sequence)) {
      throw new TypeError("Duplicate Chat message identity");
    }
    ids.add(message.id);
    sequences.add(message.sequence);
  }
  for (let index = 1; index < messages.length; index++) {
    if (messages[index].sequence <= messages[index - 1].sequence) {
      throw new TypeError("Unordered Chat message timeline");
    }
  }
  return messages;
}

export interface ChatMessageTimelinePage {
  messages: Message[];
  total: number;
  limit: number;
  offset: number;
  truncation: { message_data: boolean };
}

export function parseChatMessagesResponse(
  value: unknown,
  expectedThreadId: string,
  expected: { limit: number; offset?: number; latest?: boolean },
): ChatMessageTimelinePage {
  const candidate = record(value);
  if (
    !candidate ||
    !exactFields(candidate, [
      "messages",
      "total",
      "limit",
      "offset",
      "truncation",
    ])
  ) {
    throw new TypeError("Invalid Chat messages response");
  }
  const messages = parseChatMessages(candidate.messages, expectedThreadId);
  const total = nonnegativeInteger(candidate.total, "total");
  const limit = nonnegativeInteger(candidate.limit, "limit");
  const offset = nonnegativeInteger(candidate.offset, "offset");
  const expectedOffset = expected.latest
    ? Math.max(0, total - expected.limit)
    : expected.offset ?? 0;
  if (
    limit !== expected.limit || limit > MAX_CHAT_TIMELINE_MESSAGES ||
    offset !== expectedOffset || messages.length > limit ||
    messages.length > total
  ) {
    throw new TypeError("Mismatched Chat message page");
  }
  const truncation = record(candidate.truncation);
  if (
    !truncation || !exactFields(truncation, ["message_data"]) ||
    typeof truncation.message_data !== "boolean"
  ) {
    throw new TypeError("Invalid Chat message truncation");
  }
  return {
    messages,
    total,
    limit,
    offset,
    truncation: { message_data: truncation.message_data },
  };
}

export function parseChatMessageMutationResponse(
  value: unknown,
  expectedThreadId: string,
): Message {
  const candidate = record(value);
  if (!candidate) throw new TypeError("Invalid Chat message response");
  return parseChatMessage(candidate.message, expectedThreadId);
}
