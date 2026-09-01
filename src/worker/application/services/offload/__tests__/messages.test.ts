import { expect, test } from "bun:test";
import type { ObjectStoreBinding } from "../../../../shared/types/bindings.ts";
import {
  MAX_OFFLOADED_MESSAGE_OBJECT_BYTES,
  messageR2Key,
  readOffloadedMessageRecord,
  writeMessageToR2,
} from "../messages.ts";

function persisted(overrides: Record<string, unknown> = {}) {
  return {
    id: "message_1",
    thread_id: "thread_1",
    role: "assistant",
    content: "hello",
    tool_calls: null,
    tool_call_id: null,
    metadata: "{}",
    sequence: 1,
    created_at: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

test("offloaded Message keys reject path and ambiguous identities", () => {
  expect(messageR2Key("thread_1", "message_1")).toBe(
    "threads/thread_1/messages/message_1.json",
  );
  expect(() => messageR2Key("../thread", "message_1")).toThrow(
    "Invalid offloaded Message identity",
  );
  expect(() => messageR2Key("thread_1", "message/1")).toThrow(
    "Invalid offloaded Message identity",
  );
});

test("offloaded Message writes validate the canonical payload before R2", async () => {
  let puts = 0;
  const bucket = {
    put: async () => {
      puts++;
    },
  } as unknown as ObjectStoreBinding;

  await writeMessageToR2(
    bucket,
    "thread_1",
    "message_1",
    persisted() as never,
  );
  expect(puts).toBe(1);
  await expect(writeMessageToR2(
    bucket,
    "thread_1",
    "message_1",
    persisted({ metadata: "[]" }) as never,
  )).rejects.toThrow("Invalid offloaded Message payload");
  expect(puts).toBe(1);
});

test("offloaded Message reads reject oversized objects before materialization", async () => {
  let textCalls = 0;
  const bucket = {
    get: async () => ({
      size: MAX_OFFLOADED_MESSAGE_OBJECT_BYTES + 1,
      text: async () => {
        textCalls++;
        return JSON.stringify(persisted());
      },
    }),
  } as unknown as ObjectStoreBinding;

  expect(await readOffloadedMessageRecord(bucket, "oversized")).toBeNull();
  expect(textCalls).toBe(0);
});

test("offloaded Message reads project only a complete bounded record", async () => {
  const body = JSON.stringify(persisted());
  const size = new TextEncoder().encode(body).byteLength;
  const bucket = {
    get: async () => ({ size, text: async () => body }),
  } as unknown as ObjectStoreBinding;

  expect(await readOffloadedMessageRecord(bucket, "message_1")).toEqual({
    message: persisted(),
    size,
  });

  const poisoned = JSON.stringify(persisted({
    secret: "must-not-project",
  }));
  const poisonedBucket = {
    get: async () => ({
      size: new TextEncoder().encode(poisoned).byteLength,
      text: async () => poisoned,
    }),
  } as unknown as ObjectStoreBinding;
  expect(await readOffloadedMessageRecord(poisonedBucket, "message_1"))
    .toBeNull();
});
