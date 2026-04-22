import { MockR2Bucket } from "../../../../test/integration/setup.ts";

import {
  makeMessagePreview,
  MESSAGE_OFFLOAD_CONTENT_THRESHOLD_CHARS,
  MESSAGE_PREVIEW_MAX_CHARS,
  messageR2Key,
  type PersistedMessage,
  readMessageFromR2,
  shouldOffloadMessage,
  writeMessageToR2,
} from "@/services/offload/messages";

// ---------------------------------------------------------------------------
// messageR2Key
// ---------------------------------------------------------------------------

import { assertEquals, assertNotEquals } from "jsr:@std/assert";

Deno.test("messageR2Key - builds the expected key", () => {
  assertEquals(
    messageR2Key("thread-1", "msg-1"),
    "threads/thread-1/messages/msg-1.json",
  );
});
Deno.test("messageR2Key - handles ids containing special characters", () => {
  const key = messageR2Key("t/123", "m-456");
  assertEquals(key, "threads/t/123/messages/m-456.json");
});
// ---------------------------------------------------------------------------
// shouldOffloadMessage
// ---------------------------------------------------------------------------

Deno.test("shouldOffloadMessage - always offloads tool messages regardless of content length", () => {
  assertEquals(shouldOffloadMessage({ role: "tool", content: "" }), true);
  assertEquals(shouldOffloadMessage({ role: "tool", content: "short" }), true);
});
Deno.test("shouldOffloadMessage - offloads non-tool messages whose content exceeds threshold", () => {
  const longContent = "x".repeat(MESSAGE_OFFLOAD_CONTENT_THRESHOLD_CHARS + 1);
  assertEquals(
    shouldOffloadMessage({ role: "assistant", content: longContent }),
    true,
  );
});
Deno.test("shouldOffloadMessage - does not offload non-tool messages within threshold", () => {
  const shortContent = "x".repeat(MESSAGE_OFFLOAD_CONTENT_THRESHOLD_CHARS);
  assertEquals(
    shouldOffloadMessage({ role: "assistant", content: shortContent }),
    false,
  );
});
Deno.test("shouldOffloadMessage - does not offload user messages that are short", () => {
  assertEquals(shouldOffloadMessage({ role: "user", content: "hello" }), false);
});
// ---------------------------------------------------------------------------
// makeMessagePreview
// ---------------------------------------------------------------------------

Deno.test("makeMessagePreview - returns content as-is when within limit", () => {
  const content = "a".repeat(MESSAGE_PREVIEW_MAX_CHARS);
  assertEquals(makeMessagePreview(content), content);
});
Deno.test("makeMessagePreview - truncates and appends ellipsis when content exceeds limit", () => {
  const content = "b".repeat(MESSAGE_PREVIEW_MAX_CHARS + 100);
  const preview = makeMessagePreview(content);
  assertEquals(preview.length, MESSAGE_PREVIEW_MAX_CHARS + 3);
  assertEquals(preview.endsWith("..."), true);
});
Deno.test("makeMessagePreview - handles empty string", () => {
  assertEquals(makeMessagePreview(""), "");
});
// ---------------------------------------------------------------------------
// writeMessageToR2 / readMessageFromR2
// ---------------------------------------------------------------------------

Deno.test("writeMessageToR2 - writes a JSON-serialised message and returns the key", async () => {
  const bucket = new MockR2Bucket();
  const payload: PersistedMessage = {
    id: "msg-1",
    thread_id: "thread-1",
    role: "assistant",
    content: "hello world",
    tool_calls: null,
    tool_call_id: null,
    metadata: "{}",
    sequence: 1,
    created_at: "2025-01-01T00:00:00Z",
  };

  const result = await writeMessageToR2(
    bucket as never,
    "thread-1",
    "msg-1",
    payload,
  );
  assertEquals(result.key, "threads/thread-1/messages/msg-1.json");

  // Verify the data was stored
  const stored = await bucket.get(result.key);
  assertNotEquals(stored, null);
  const text = await stored!.text();
  const parsed = JSON.parse(text);
  assertEquals(parsed.id, "msg-1");
  assertEquals(parsed.content, "hello world");
});

Deno.test("readMessageFromR2 - reads and parses a stored message", async () => {
  const bucket = new MockR2Bucket();
  const payload: PersistedMessage = {
    id: "msg-2",
    thread_id: "thread-2",
    role: "user",
    content: "test content",
    tool_calls: null,
    tool_call_id: null,
    metadata: "{}",
    sequence: 2,
    created_at: "2025-01-01T00:00:00Z",
  };

  const key = messageR2Key("thread-2", "msg-2");
  await bucket.put(key, JSON.stringify(payload));

  const result = await readMessageFromR2(bucket as never, key);
  assertNotEquals(result, null);
  assertEquals(result!.id, "msg-2");
  assertEquals(result!.thread_id, "thread-2");
  assertEquals(result!.role, "user");
  assertEquals(result!.content, "test content");
});
Deno.test("readMessageFromR2 - returns null for missing key", async () => {
  const bucket = new MockR2Bucket();
  const result = await readMessageFromR2(bucket as never, "nonexistent");
  assertEquals(result, null);
});
Deno.test("readMessageFromR2 - returns null for invalid JSON", async () => {
  const bucket = new MockR2Bucket();
  await bucket.put("bad-key", "not json");
  const result = await readMessageFromR2(bucket as never, "bad-key");
  assertEquals(result, null);
});
Deno.test("readMessageFromR2 - returns null when parsed object is missing required fields", async () => {
  const bucket = new MockR2Bucket();
  await bucket.put("partial-key", JSON.stringify({ id: 123 })); // id is not string
  const result = await readMessageFromR2(bucket as never, "partial-key");
  assertEquals(result, null);
});
Deno.test("readMessageFromR2 - returns null when id field is missing", async () => {
  const bucket = new MockR2Bucket();
  await bucket.put(
    "no-id",
    JSON.stringify({ thread_id: "t", role: "user", content: "c" }),
  );
  const result = await readMessageFromR2(bucket as never, "no-id");
  assertEquals(result, null);
});
Deno.test("readMessageFromR2 - returns null when content field is missing", async () => {
  const bucket = new MockR2Bucket();
  await bucket.put(
    "no-content",
    JSON.stringify({ id: "x", thread_id: "t", role: "user" }),
  );
  const result = await readMessageFromR2(bucket as never, "no-content");
  assertEquals(result, null);
});
