import {
  MAX_CHAT_THREAD_ID_CHARACTERS,
  MAX_CHAT_THREAD_KEY_POINT_CHARACTERS,
  MAX_CHAT_THREAD_KEY_POINTS,
  MAX_CHAT_THREAD_KEY_POINTS_CHARACTERS,
  MAX_CHAT_THREAD_SUMMARY_CHARACTERS,
  MAX_CHAT_THREAD_TIMESTAMP_CHARACTERS,
  MAX_CHAT_THREADS_PER_RESPONSE,
  MAX_CLIENT_THREAD_TITLE_CHARACTERS,
} from "takos-api-contract/chat-thread";
import type { Thread } from "../types/index.ts";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedText(
  value: unknown,
  field: string,
  maximum: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" || value.length > maximum ||
    (!allowEmpty && !value.trim()) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError(`Invalid Chat Thread ${field}`);
  }
  return value;
}

function opaqueId(value: unknown, field: string): string {
  const id = boundedText(value, field, MAX_CHAT_THREAD_ID_CHARACTERS);
  if (id !== id.trim() || /[\/\\]/u.test(id)) {
    throw new TypeError(`Invalid Chat Thread ${field}`);
  }
  return id;
}

function timestamp(value: unknown, field: string): string {
  const text = boundedText(
    value,
    field,
    MAX_CHAT_THREAD_TIMESTAMP_CHARACTERS,
  );
  if (!Number.isFinite(Date.parse(text))) {
    throw new TypeError(`Invalid Chat Thread ${field}`);
  }
  return text;
}

function keyPoints(value: unknown): string {
  const text = boundedText(
    value,
    "key_points",
    MAX_CHAT_THREAD_KEY_POINTS_CHARACTERS,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TypeError("Invalid Chat Thread key_points");
  }
  if (
    !Array.isArray(parsed) || parsed.length > MAX_CHAT_THREAD_KEY_POINTS ||
    parsed.some((point) =>
      typeof point !== "string" || !point.trim() ||
      point.length > MAX_CHAT_THREAD_KEY_POINT_CHARACTERS ||
      /[\u0000-\u001f\u007f]/u.test(point)
    )
  ) {
    throw new TypeError("Invalid Chat Thread key_points");
  }
  return text;
}

export function parseChatThread(
  value: unknown,
  expected: { spaceId: string; threadId?: string },
): Thread {
  const candidate = record(value);
  if (!candidate) throw new TypeError("Invalid Chat Thread");
  const id = opaqueId(candidate.id, "id");
  const spaceId = opaqueId(candidate.space_id, "Workspace id");
  if (
    spaceId !== expected.spaceId ||
    (expected.threadId !== undefined && id !== expected.threadId)
  ) {
    throw new TypeError("Mismatched Chat Thread identity");
  }
  if (
    candidate.status !== "active" && candidate.status !== "archived"
  ) {
    throw new TypeError("Invalid Chat Thread status");
  }
  if (
    candidate.locale !== null && candidate.locale !== undefined &&
    candidate.locale !== "ja" && candidate.locale !== "en"
  ) {
    throw new TypeError("Invalid Chat Thread locale");
  }
  if (
    typeof candidate.retrieval_index !== "number" ||
    !Number.isSafeInteger(candidate.retrieval_index) ||
    candidate.retrieval_index < -1 ||
    typeof candidate.context_window !== "number" ||
    !Number.isSafeInteger(candidate.context_window) ||
    candidate.context_window < 20 || candidate.context_window > 200
  ) {
    throw new TypeError("Invalid Chat Thread context state");
  }
  const title = candidate.title === null
    ? null
    : boundedText(
      candidate.title,
      "title",
      MAX_CLIENT_THREAD_TITLE_CHARACTERS,
    );
  const summary = candidate.summary === null || candidate.summary === undefined
    ? null
    : boundedText(
      candidate.summary,
      "summary",
      MAX_CHAT_THREAD_SUMMARY_CHARACTERS,
      true,
    );

  return {
    id,
    space_id: spaceId,
    title,
    locale: candidate.locale ?? null,
    status: candidate.status,
    summary,
    key_points: keyPoints(candidate.key_points),
    retrieval_index: candidate.retrieval_index,
    context_window: candidate.context_window,
    created_at: timestamp(candidate.created_at, "created_at"),
    updated_at: timestamp(candidate.updated_at, "updated_at"),
  };
}

export function parseChatThreadInventoryResponse(
  value: unknown,
  expectedSpaceId: string,
): { threads: Thread[]; truncated: boolean } {
  const candidate = record(value);
  if (
    !candidate || !Array.isArray(candidate.threads) ||
    candidate.threads.length > MAX_CHAT_THREADS_PER_RESPONSE ||
    typeof candidate.truncated !== "boolean" ||
    Object.keys(candidate).some((key) => key !== "threads" && key !== "truncated")
  ) {
    throw new TypeError("Invalid Chat Thread inventory");
  }
  const threads = candidate.threads.map((thread) =>
    parseChatThread(thread, { spaceId: expectedSpaceId })
  );
  if (new Set(threads.map((thread) => thread.id)).size !== threads.length) {
    throw new TypeError("Duplicate Chat Thread identity");
  }
  return { threads, truncated: candidate.truncated };
}

export function parseChatThreadResponse(
  value: unknown,
  expected: { spaceId: string; threadId?: string },
): Thread {
  const candidate = record(value);
  if (!candidate) throw new TypeError("Invalid Chat Thread response");
  return parseChatThread(candidate.thread, expected);
}

export function parseChatThreadActionResponse(
  value: unknown,
  expected: {
    threadId: string;
    status: "active" | "archived" | "deleted";
  },
): void {
  const candidate = record(value);
  if (
    !candidate || candidate.success !== true ||
    opaqueId(candidate.thread_id, "action id") !== expected.threadId ||
    candidate.status !== expected.status ||
    Object.keys(candidate).some((key) =>
      key !== "success" && key !== "thread_id" && key !== "status"
    )
  ) {
    throw new TypeError("Invalid Chat Thread action response");
  }
}
