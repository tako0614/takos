import type { ObjectStoreBinding } from "../../../shared/types/bindings.ts";
import type { MessageRole } from "../../../shared/types/index.ts";

export type PersistedMessage = {
  id: string;
  thread_id: string;
  role: MessageRole;
  content: string;
  tool_calls: string | null;
  tool_call_id: string | null;
  metadata: string;
  sequence: number;
  created_at: string;
};

export const MESSAGE_OFFLOAD_CONTENT_THRESHOLD_CHARS = 4000;
export const MESSAGE_PREVIEW_MAX_CHARS = 800;
export const MAX_OFFLOADED_MESSAGE_OBJECT_BYTES = 9 * 1024 * 1024;
export const MAX_OFFLOADED_MESSAGE_CONTENT_BYTES = 512 * 1024;
export const MAX_OFFLOADED_MESSAGE_TOOL_CALLS_BYTES = 6 * 1024 * 1024;
export const MAX_MESSAGE_PAGE_HYDRATION_BYTES = 8 * 1024 * 1024;
export const MAX_AGENT_MESSAGE_HYDRATION_BYTES = 16 * 1024 * 1024;
const MAX_OFFLOADED_MESSAGE_ID_CHARACTERS = 256;
const MAX_OFFLOADED_MESSAGE_METADATA_BYTES = 256 * 1024;
const MAX_OFFLOADED_MESSAGE_TIMESTAMP_CHARACTERS = 64;
const MESSAGE_ROLES = new Set<MessageRole>([
  "user",
  "assistant",
  "system",
  "tool",
]);
const encoder = new TextEncoder();

export interface OffloadedMessageRecord {
  message: PersistedMessage;
  size: number;
}

function encodedBytes(value: string): number {
  return encoder.encode(value).byteLength;
}

function isNullableBoundedString(
  value: unknown,
  maximumBytes: number,
): value is string | null {
  return value === null ||
    (typeof value === "string" && encodedBytes(value) <= maximumBytes);
}

function parsePersistedMessage(value: unknown): PersistedMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const expectedFields = new Set([
    "id",
    "thread_id",
    "role",
    "content",
    "tool_calls",
    "tool_call_id",
    "metadata",
    "sequence",
    "created_at",
  ]);
  if (
    Object.keys(candidate).length !== expectedFields.size ||
    !Object.keys(candidate).every((field) => expectedFields.has(field)) ||
    typeof candidate.id !== "string" || !candidate.id ||
    candidate.id.length > MAX_OFFLOADED_MESSAGE_ID_CHARACTERS ||
    typeof candidate.thread_id !== "string" || !candidate.thread_id ||
    candidate.thread_id.length > MAX_OFFLOADED_MESSAGE_ID_CHARACTERS ||
    !MESSAGE_ROLES.has(candidate.role as MessageRole) ||
    typeof candidate.content !== "string" ||
    encodedBytes(candidate.content) > MAX_OFFLOADED_MESSAGE_CONTENT_BYTES ||
    !isNullableBoundedString(
      candidate.tool_calls,
      MAX_OFFLOADED_MESSAGE_TOOL_CALLS_BYTES,
    ) ||
    !isNullableBoundedString(
      candidate.tool_call_id,
      MAX_OFFLOADED_MESSAGE_ID_CHARACTERS,
    ) ||
    typeof candidate.metadata !== "string" ||
    encodedBytes(candidate.metadata) > MAX_OFFLOADED_MESSAGE_METADATA_BYTES ||
    typeof candidate.sequence !== "number" ||
    !Number.isSafeInteger(candidate.sequence) || candidate.sequence < 0 ||
    typeof candidate.created_at !== "string" ||
    candidate.created_at.length > MAX_OFFLOADED_MESSAGE_TIMESTAMP_CHARACTERS ||
    !Number.isFinite(Date.parse(candidate.created_at))
  ) {
    return null;
  }
  try {
    const metadata = JSON.parse(candidate.metadata);
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      return null;
    }
    if (candidate.tool_calls !== null) {
      const toolCalls = JSON.parse(candidate.tool_calls);
      if (!Array.isArray(toolCalls)) return null;
    }
  } catch {
    return null;
  }
  return candidate as unknown as PersistedMessage;
}

function serializePersistedMessage(payload: PersistedMessage): string {
  const parsed = parsePersistedMessage(payload);
  if (!parsed) throw new TypeError("Invalid offloaded Message payload");
  const serialized = JSON.stringify(parsed);
  if (encodedBytes(serialized) > MAX_OFFLOADED_MESSAGE_OBJECT_BYTES) {
    throw new TypeError("Offloaded Message payload exceeds the object limit");
  }
  return serialized;
}

export function messageR2Key(threadId: string, messageId: string): string {
  if (
    !/^[A-Za-z0-9_-]{1,256}$/.test(threadId) ||
    !/^[A-Za-z0-9_-]{1,256}$/.test(messageId)
  ) {
    throw new TypeError("Invalid offloaded Message identity");
  }
  return `threads/${threadId}/messages/${messageId}.json`;
}

export function shouldOffloadMessage(input: {
  role: MessageRole;
  content: string;
}): boolean {
  if (input.role === "tool") return true;
  return input.content.length > MESSAGE_OFFLOAD_CONTENT_THRESHOLD_CHARS;
}

export function makeMessagePreview(content: string): string {
  if (content.length <= MESSAGE_PREVIEW_MAX_CHARS) return content;
  return content.slice(0, MESSAGE_PREVIEW_MAX_CHARS) + "...";
}

export async function writeMessageToR2(
  bucket: ObjectStoreBinding,
  threadId: string,
  messageId: string,
  payload: PersistedMessage,
): Promise<{ key: string }> {
  const key = messageR2Key(threadId, messageId);
  await bucket.put(key, serializePersistedMessage(payload), {
    httpMetadata: { contentType: "application/json" },
  });
  return { key };
}

export async function readMessageFromR2(
  bucket: ObjectStoreBinding,
  key: string,
): Promise<PersistedMessage | null> {
  return (await readOffloadedMessageRecord(bucket, key))?.message ?? null;
}

export async function readOffloadedMessageRecord(
  bucket: ObjectStoreBinding,
  key: string,
): Promise<OffloadedMessageRecord | null> {
  const obj = await bucket.get(key);
  if (!obj) return null;
  if (
    !Number.isSafeInteger(obj.size) || obj.size < 0 ||
    obj.size > MAX_OFFLOADED_MESSAGE_OBJECT_BYTES
  ) {
    return null;
  }
  try {
    const parsed = parsePersistedMessage(JSON.parse(await obj.text()));
    return parsed ? { message: parsed, size: obj.size } : null;
  } catch {
    return null;
  }
}
