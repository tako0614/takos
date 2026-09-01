import {
  MAX_PUBLIC_THREAD_SHARE_MESSAGE_CONTENT_BYTES,
  MAX_PUBLIC_THREAD_SHARE_PAGE_CONTENT_BYTES,
  MAX_PUBLIC_THREAD_SHARE_PAGE_SIZE,
  THREAD_SHARE_TOKEN_PATTERN,
  type PublicThreadShareMessage,
  type PublicThreadShareMode,
  type PublicThreadSharePage,
} from "takos-api-contract/thread-share";
import {
  MAX_CHAT_THREAD_ID_CHARACTERS,
  MAX_CLIENT_THREAD_TITLE_CHARACTERS,
} from "takos-api-contract/chat-thread";

const MAX_PUBLIC_ERROR_MESSAGE_CHARACTERS = 1_024;
const MAX_PUBLIC_TIMESTAMP_CHARACTERS = 64;
const MAX_PUBLIC_MESSAGE_ID_CHARACTERS = 256;
const utf8Encoder = new TextEncoder();

export interface SharedThreadPayload {
  token: string;
  share: {
    mode: PublicThreadShareMode;
    expires_at: string | null;
    created_at: string;
  };
  thread: {
    id: string;
    title: string | null;
    created_at: string;
    updated_at: string;
  };
  messages: PublicThreadShareMessage[];
  page: PublicThreadSharePage;
}

export interface SharedThreadError {
  code: string | null;
  message: string | null;
  requiresPassword: boolean;
  invalidPassword: boolean;
  retryAfter: number | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasExactFields(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const fields = Object.keys(value);
  return (
    fields.length === expected.length &&
    fields.every((field) => expected.includes(field))
  );
}

function boundedString(
  value: unknown,
  field: string,
  maximum: number,
  allowEmpty = false,
  allowTextWhitespace = false,
): string {
  const controls = allowTextWhitespace
    ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u
    : /[\u0000-\u001f\u007f]/u;
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    value.length > maximum ||
    controls.test(value)
  ) {
    throw new TypeError(`Invalid shared Thread ${field}`);
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  const result = boundedString(value, field, MAX_PUBLIC_TIMESTAMP_CHARACTERS);
  if (!Number.isFinite(Date.parse(result))) {
    throw new TypeError(`Invalid shared Thread ${field}`);
  }
  return result;
}

function nonnegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Invalid shared Thread ${field}`);
  }
  return value;
}

function parseMessage(value: unknown): PublicThreadShareMessage {
  const message = record(value);
  if (
    !message ||
    !hasExactFields(message, [
      "id",
      "role",
      "content",
      "content_truncated",
      "sequence",
      "created_at",
    ]) ||
    (message.role !== "user" && message.role !== "assistant") ||
    typeof message.content_truncated !== "boolean"
  ) {
    throw new TypeError("Invalid shared Thread message");
  }
  const content = boundedString(
    message.content,
    "message content",
    MAX_PUBLIC_THREAD_SHARE_MESSAGE_CONTENT_BYTES,
    true,
    true,
  );
  if (
    utf8Encoder.encode(content).byteLength >
    MAX_PUBLIC_THREAD_SHARE_MESSAGE_CONTENT_BYTES
  ) {
    throw new TypeError("Oversized shared Thread message content");
  }
  return {
    id: boundedString(
      message.id,
      "message id",
      MAX_PUBLIC_MESSAGE_ID_CHARACTERS,
    ),
    role: message.role,
    content,
    content_truncated: message.content_truncated,
    sequence: nonnegativeInteger(message.sequence, "message sequence"),
    created_at: timestamp(message.created_at, "message timestamp"),
  };
}

export function parseSharedThreadPayload(
  value: unknown,
  expected: { token: string; limit: number; offset: number },
): SharedThreadPayload {
  const payload = record(value);
  if (
    !payload ||
    !hasExactFields(payload, ["share", "token", "thread", "messages", "page"])
  ) {
    throw new TypeError("Invalid shared Thread response");
  }
  const token = boundedString(payload.token, "token", 32);
  if (token !== expected.token || !THREAD_SHARE_TOKEN_PATTERN.test(token)) {
    throw new TypeError("Mismatched shared Thread token");
  }

  const share = record(payload.share);
  if (
    !share ||
    !hasExactFields(share, ["mode", "expires_at", "created_at"]) ||
    (share.mode !== "public" && share.mode !== "password")
  ) {
    throw new TypeError("Invalid shared Thread share metadata");
  }
  const expiresAt =
    share.expires_at === null ? null : timestamp(share.expires_at, "expiry");

  const thread = record(payload.thread);
  if (
    !thread ||
    !hasExactFields(thread, ["id", "title", "created_at", "updated_at"])
  ) {
    throw new TypeError("Invalid shared Thread metadata");
  }
  const title =
    thread.title === null
      ? null
      : boundedString(
          thread.title,
          "title",
          MAX_CLIENT_THREAD_TITLE_CHARACTERS,
          true,
          true,
        );

  if (!Array.isArray(payload.messages)) {
    throw new TypeError("Invalid shared Thread message list");
  }
  if (payload.messages.length > MAX_PUBLIC_THREAD_SHARE_PAGE_SIZE) {
    throw new TypeError("Oversized shared Thread message page");
  }
  const messages = payload.messages.map(parseMessage);
  const messageIds = new Set<string>();
  const sequences = new Set<number>();
  let pageBytes = 0;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (
      messageIds.has(message.id) ||
      sequences.has(message.sequence) ||
      (index > 0 && message.sequence <= messages[index - 1].sequence)
    ) {
      throw new TypeError("Ambiguous shared Thread message page");
    }
    messageIds.add(message.id);
    sequences.add(message.sequence);
    pageBytes += utf8Encoder.encode(message.content).byteLength;
  }
  if (pageBytes > MAX_PUBLIC_THREAD_SHARE_PAGE_CONTENT_BYTES) {
    throw new TypeError("Oversized shared Thread response page");
  }

  const page = record(payload.page);
  if (
    !page ||
    !hasExactFields(page, [
      "limit",
      "offset",
      "has_more",
      "next_offset",
      "message_data_truncated",
    ]) ||
    typeof page.has_more !== "boolean" ||
    typeof page.message_data_truncated !== "boolean"
  ) {
    throw new TypeError("Invalid shared Thread page evidence");
  }
  const limit = nonnegativeInteger(page.limit, "page limit");
  const offset = nonnegativeInteger(page.offset, "page offset");
  const nextOffset =
    page.next_offset === null
      ? null
      : nonnegativeInteger(page.next_offset, "next page offset");
  if (
    limit !== expected.limit ||
    offset !== expected.offset ||
    limit < 1 ||
    limit > MAX_PUBLIC_THREAD_SHARE_PAGE_SIZE ||
    messages.length > limit ||
    (page.has_more && (nextOffset === null || nextOffset <= offset)) ||
    (!page.has_more && nextOffset !== null) ||
    (messages.some((message) => message.content_truncated) &&
      !page.message_data_truncated)
  ) {
    throw new TypeError("Mismatched shared Thread page evidence");
  }

  return {
    token,
    share: {
      mode: share.mode,
      expires_at: expiresAt,
      created_at: timestamp(share.created_at, "share timestamp"),
    },
    thread: {
      id: boundedString(thread.id, "Thread id", MAX_CHAT_THREAD_ID_CHARACTERS),
      title,
      created_at: timestamp(thread.created_at, "Thread creation timestamp"),
      updated_at: timestamp(thread.updated_at, "Thread update timestamp"),
    },
    messages,
    page: {
      limit,
      offset,
      has_more: page.has_more,
      next_offset: nextOffset,
      message_data_truncated: page.message_data_truncated,
    },
  };
}

export function appendSharedThreadPage(
  current: SharedThreadPayload,
  incoming: SharedThreadPayload,
): SharedThreadPayload {
  if (
    current.token !== incoming.token ||
    current.thread.id !== incoming.thread.id ||
    current.share.mode !== incoming.share.mode ||
    current.share.created_at !== incoming.share.created_at ||
    current.share.expires_at !== incoming.share.expires_at ||
    current.page.next_offset !== incoming.page.offset
  ) {
    throw new TypeError("Mismatched shared Thread continuation");
  }
  const ids = new Set(current.messages.map((message) => message.id));
  const sequences = new Set(
    current.messages.map((message) => message.sequence),
  );
  if (
    incoming.messages.some(
      (message) => ids.has(message.id) || sequences.has(message.sequence),
    ) ||
    (current.messages.length > 0 &&
      incoming.messages.length > 0 &&
      incoming.messages[0].sequence <= current.messages.at(-1)!.sequence)
  ) {
    throw new TypeError("Duplicate shared Thread continuation");
  }
  return {
    ...incoming,
    messages: [...current.messages, ...incoming.messages],
    page: {
      ...incoming.page,
      message_data_truncated:
        current.page.message_data_truncated ||
        incoming.page.message_data_truncated,
    },
  };
}

export function parseSharedThreadError(value: unknown): SharedThreadError {
  const envelope = record(value);
  const error = record(envelope?.error);
  const details = record(error?.details);
  const code =
    typeof error?.code === "string" && error.code.length <= 64
      ? error.code
      : null;
  const message =
    typeof error?.message === "string" &&
    error.message.length <= MAX_PUBLIC_ERROR_MESSAGE_CHARACTERS
      ? error.message
      : null;
  const rawRetryAfter = details?.retryAfter;
  const retryAfter =
    typeof rawRetryAfter === "number" &&
    Number.isSafeInteger(rawRetryAfter) &&
    rawRetryAfter >= 0
      ? rawRetryAfter
      : null;
  return {
    code,
    message,
    requiresPassword: details?.requires_password === true,
    invalidPassword: details?.invalid_password === true,
    retryAfter,
  };
}
