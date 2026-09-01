import { expect, test } from "bun:test";
import type { ObjectStoreBinding } from "../../../../shared/types/bindings.ts";
import { gzipCompressString } from "../../../../shared/utils/gzip.ts";
import {
  buildRunEventSegmentKey,
  getRunEventsAfterPageFromR2,
  MAX_PERSISTED_RUN_EVENT_DATA_BYTES,
  MAX_RUN_EVENT_SEGMENT_COMPRESSED_BYTES,
  readRunEventSegmentRecord,
  RUN_EVENT_TRUNCATED_DATA,
  serializeRunEventData,
  writeRunEventSegmentToR2,
} from "../run-events.ts";

function event(id: number, overrides: Record<string, unknown> = {}) {
  return {
    event_id: id,
    type: "message",
    data: JSON.stringify({ id }),
    created_at: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

function memoryBucket() {
  const objects = new Map<string, ArrayBuffer>();
  let listCalls = 0;
  let bodyReads = 0;
  const bucket = {
    async put(key: string, value: ArrayBuffer) {
      objects.set(key, value.slice(0));
      return null;
    },
    async get(key: string) {
      const value = objects.get(key);
      if (!value) return null;
      return {
        size: value.byteLength,
        async arrayBuffer() {
          bodyReads += 1;
          return value.slice(0);
        },
      };
    },
    async list() {
      listCalls += 1;
      return { objects: [], truncated: false, delimitedPrefixes: [] };
    },
  } as unknown as ObjectStoreBinding;
  return {
    bucket,
    objects,
    get listCalls() {
      return listCalls;
    },
    get bodyReads() {
      return bodyReads;
    },
  };
}

test("Run event archive keys reject path and unsafe numeric identities", () => {
  expect(buildRunEventSegmentKey("run_1", 1)).toBe(
    "runs/run_1/events/000001.jsonl.gz",
  );
  expect(() => buildRunEventSegmentKey("../run", 1)).toThrow(
    "Invalid offloaded Run identity",
  );
  expect(() => buildRunEventSegmentKey("run_1", Number.MAX_SAFE_INTEGER + 1))
    .toThrow("Invalid Run event segment index");
});

test("Run event archive validates canonical ordered segments before mutation", async () => {
  let puts = 0;
  const bucket = {
    async put() {
      puts += 1;
      return null;
    },
  } as unknown as ObjectStoreBinding;

  await writeRunEventSegmentToR2(bucket, "run_1", 1, [event(1)] as never);
  expect(puts).toBe(1);
  await expect(writeRunEventSegmentToR2(
    bucket,
    "run_1",
    1,
    [event(2), event(1)] as never,
  )).rejects.toThrow("Invalid offloaded Run event segment");
  await expect(writeRunEventSegmentToR2(
    bucket,
    "run_1",
    1,
    [event(1, { data: "not-json" })] as never,
  )).rejects.toThrow("Invalid offloaded Run event segment");
  await expect(writeRunEventSegmentToR2(
    bucket,
    "run_1",
    1,
    [event(1, { data: JSON.stringify("x".repeat(
      MAX_PERSISTED_RUN_EVENT_DATA_BYTES,
    )) })] as never,
  )).rejects.toThrow("Invalid offloaded Run event segment");
  expect(puts).toBe(1);
});

test("Run event payload serialization bounds realtime and archive copies together", () => {
  expect(serializeRunEventData({ ok: true })).toEqual({
    data: '{"ok":true}',
    truncated: false,
  });
  expect(serializeRunEventData({ value: "x".repeat(
    MAX_PERSISTED_RUN_EVENT_DATA_BYTES,
  ) })).toEqual({
    data: RUN_EVENT_TRUNCATED_DATA,
    truncated: true,
  });
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  expect(serializeRunEventData(circular)).toEqual({
    data: RUN_EVENT_TRUNCATED_DATA,
    truncated: true,
  });
});

test("Run event archive rejects oversized compressed objects before reading", async () => {
  let bodyReads = 0;
  const bucket = {
    async get() {
      return {
        size: MAX_RUN_EVENT_SEGMENT_COMPRESSED_BYTES + 1,
        async arrayBuffer() {
          bodyReads += 1;
          return new ArrayBuffer(0);
        },
      };
    },
  } as unknown as ObjectStoreBinding;

  const result = await readRunEventSegmentRecord(bucket, "run_1", 1);
  expect(result.status).toBe("invalid");
  expect(bodyReads).toBe(0);
});

test("Run event archive preserves bounded identity while marking legacy data loss", async () => {
  const legacy = event(1, { data: "x".repeat(
    MAX_PERSISTED_RUN_EVENT_DATA_BYTES + 1,
  ) });
  const compressed = await gzipCompressString(`${JSON.stringify(legacy)}\n`);
  const bucket = {
    async get() {
      return {
        size: compressed.byteLength,
        async arrayBuffer() {
          return compressed;
        },
      };
    },
  } as unknown as ObjectStoreBinding;

  const result = await readRunEventSegmentRecord(bucket, "run_1", 1);
  expect(result.status).toBe("ok");
  expect(result.dataTruncated).toBe(true);
  expect(result.events).toEqual([{
    ...event(1),
    data: RUN_EVENT_TRUNCATED_DATA,
  }]);
});

test("Run event replay reads only the direct bounded segment window", async () => {
  const store = memoryBucket();
  await writeRunEventSegmentToR2(
    store.bucket,
    "run_1",
    1,
    Array.from({ length: 100 }, (_, index) => event(index + 1)) as never,
  );
  await writeRunEventSegmentToR2(
    store.bucket,
    "run_1",
    2,
    Array.from({ length: 100 }, (_, index) => event(index + 101)) as never,
  );
  await writeRunEventSegmentToR2(
    store.bucket,
    "run_1",
    3,
    [event(201), event(202)] as never,
  );

  const first = await getRunEventsAfterPageFromR2(
    store.bucket,
    "run_1",
    0,
    200,
  );
  expect(first.events).toHaveLength(200);
  expect(first.events[0].event_id).toBe(1);
  expect(first.events.at(-1)?.event_id).toBe(200);
  expect(first.hasMore).toBe(true);
  expect(store.listCalls).toBe(0);
  expect(store.bodyReads).toBe(3);

  const second = await getRunEventsAfterPageFromR2(
    store.bucket,
    "run_1",
    200,
    200,
  );
  expect(second.events.map((value) => value.event_id)).toEqual([201, 202]);
  expect(second.hasMore).toBe(false);
  expect(store.listCalls).toBe(0);
});
