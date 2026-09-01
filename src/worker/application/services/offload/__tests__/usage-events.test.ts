import { expect, test } from "bun:test";

import type { ObjectStoreBinding } from "../../../../shared/types/bindings.ts";
import {
  MAX_USAGE_EVENT_METADATA_BYTES,
  MAX_USAGE_EVENT_SEGMENT_COMPRESSED_BYTES,
  readUsageEventArchiveFromR2,
  usageArchiveManifestKey,
  usageSegmentKey,
  writeUsageEventArchiveManifestToR2,
  writeUsageEventSegmentToR2,
} from "../usage-events.ts";
import { emitRunUsageEvent } from "../usage-client.ts";

const encoder = new TextEncoder();

function usageEvent(index: number) {
  return {
    meter_type: "exec_seconds",
    units: index + 1,
    reference_type: "run",
    metadata: JSON.stringify({ index }),
    created_at: "2026-08-10T00:00:00.000Z",
  };
}

function memoryBucket() {
  const objects = new Map<string, Uint8Array>();
  let listCalls = 0;
  let bodyReads = 0;
  let getCalls = 0;
  const bucket = {
    async put(key: string, value: string | ArrayBuffer | ArrayBufferView) {
      const bytes = typeof value === "string"
        ? encoder.encode(value)
        : value instanceof ArrayBuffer
          ? new Uint8Array(value.slice(0))
          : new Uint8Array(
            value.buffer.slice(
              value.byteOffset,
              value.byteOffset + value.byteLength,
            ),
          );
      objects.set(key, bytes);
      return null;
    },
    async get(key: string) {
      getCalls += 1;
      const value = objects.get(key);
      if (!value) return null;
      return {
        size: value.byteLength,
        async arrayBuffer() {
          bodyReads += 1;
          return value.buffer.slice(
            value.byteOffset,
            value.byteOffset + value.byteLength,
          );
        },
        async text() {
          bodyReads += 1;
          return new TextDecoder().decode(value);
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
    get getCalls() {
      return getCalls;
    },
  };
}

test("usage archive keys and writers reject non-canonical input before mutation", async () => {
  expect(usageSegmentKey("run_1", 1)).toBe(
    "runs/run_1/usage/000001.jsonl.gz",
  );
  expect(usageArchiveManifestKey("run_1")).toBe(
    "runs/run_1/usage/manifest.json",
  );
  expect(() => usageSegmentKey("../run", 1)).toThrow(
    "Invalid offloaded usage Run identity",
  );

  let puts = 0;
  const bucket = {
    async put() {
      puts += 1;
      return null;
    },
  } as unknown as ObjectStoreBinding;

  await writeUsageEventSegmentToR2(bucket, "run_1", 1, [usageEvent(0)]);
  expect(puts).toBe(1);
  await expect(writeUsageEventSegmentToR2(
    bucket,
    "run_1",
    1,
    [{ ...usageEvent(0), units: "1" }] as never,
  )).rejects.toThrow("Invalid offloaded usage event");
  await expect(writeUsageEventSegmentToR2(
    bucket,
    "run_1",
    1,
    [{
      ...usageEvent(0),
      metadata: JSON.stringify({ value: "x".repeat(
        MAX_USAGE_EVENT_METADATA_BYTES,
      ) }),
    }],
  )).rejects.toThrow("Invalid offloaded usage event");
  await expect(writeUsageEventSegmentToR2(
    bucket,
    "run_1",
    1,
    Array.from({ length: 201 }, (_, index) => usageEvent(index)),
  )).rejects.toThrow("Invalid offloaded usage event segment");
  await expect(writeUsageEventArchiveManifestToR2(bucket, "run_1", {
    segmentCount: 2,
    eventCount: 1,
    completedAt: "2026-08-10T00:00:00.000Z",
  })).rejects.toThrow("Invalid usage event archive manifest");
  expect(puts).toBe(1);
});

test("usage archive is incomplete without its final manifest", async () => {
  const store = memoryBucket();
  await writeUsageEventSegmentToR2(
    store.bucket,
    "run_1",
    1,
    [usageEvent(0)],
  );

  expect(await readUsageEventArchiveFromR2(store.bucket, "run_1")).toEqual({
    events: [],
    complete: false,
    reason: "manifest_missing",
  });
  expect(store.getCalls).toBe(1);
  expect(store.bodyReads).toBe(0);
  expect(store.listCalls).toBe(0);
});

test("usage archive rejects oversized segments before reading their bodies", async () => {
  let segmentBodyReads = 0;
  const manifest = JSON.stringify({
    version: 1,
    segment_count: 1,
    event_count: 1,
    completed_at: "2026-08-10T00:00:00.000Z",
  });
  const bucket = {
    async get(key: string) {
      if (key.endsWith("manifest.json")) {
        return {
          size: encoder.encode(manifest).byteLength,
          async text() {
            return manifest;
          },
        };
      }
      return {
        size: MAX_USAGE_EVENT_SEGMENT_COMPRESSED_BYTES + 1,
        async arrayBuffer() {
          segmentBodyReads += 1;
          return new ArrayBuffer(0);
        },
      };
    },
  } as unknown as ObjectStoreBinding;

  expect(await readUsageEventArchiveFromR2(bucket, "run_1")).toEqual({
    events: [],
    complete: false,
    reason: "segment_invalid",
  });
  expect(segmentBodyReads).toBe(0);
});

test("usage archive reads only manifest-declared segments and proves cardinality", async () => {
  const store = memoryBucket();
  const events = Array.from({ length: 202 }, (_, index) => usageEvent(index));
  await writeUsageEventSegmentToR2(
    store.bucket,
    "run_1",
    1,
    events.slice(0, 200),
  );
  await writeUsageEventSegmentToR2(
    store.bucket,
    "run_1",
    2,
    events.slice(200),
  );
  await writeUsageEventArchiveManifestToR2(store.bucket, "run_1", {
    segmentCount: 2,
    eventCount: 202,
    completedAt: "2026-08-10T00:01:00.000Z",
  });

  const complete = await readUsageEventArchiveFromR2(
    store.bucket,
    "run_1",
    { maxEvents: 202 },
  );
  expect(complete.complete).toBe(true);
  expect(complete.reason).toBeNull();
  expect(complete.events).toEqual(events);
  expect(store.listCalls).toBe(0);

  const manifestKey = usageArchiveManifestKey("run_1");
  store.objects.set(manifestKey, encoder.encode(JSON.stringify({
    version: 1,
    segment_count: 2,
    event_count: 201,
    completed_at: "2026-08-10T00:01:00.000Z",
  })));
  expect(await readUsageEventArchiveFromR2(
    store.bucket,
    "run_1",
    { maxEvents: 202 },
  )).toEqual({
    events: [],
    complete: false,
    reason: "event_count_mismatch",
  });
  await expect(readUsageEventArchiveFromR2(
    store.bucket,
    "run_1",
    { maxEvents: Number.NaN },
  )).rejects.toThrow("Invalid usage archive event limit");
});

test("usage archive event limits fail closed before segment reads", async () => {
  const store = memoryBucket();
  await writeUsageEventArchiveManifestToR2(store.bucket, "run_1", {
    segmentCount: 1,
    eventCount: 2,
    completedAt: "2026-08-10T00:01:00.000Z",
  });

  expect(await readUsageEventArchiveFromR2(
    store.bucket,
    "run_1",
    { maxEvents: 1 },
  )).toEqual({
    events: [],
    complete: false,
    reason: "event_limit",
  });
  expect(store.getCalls).toBe(1);
  expect(store.bodyReads).toBe(1);
});

test("usage event client propagates notifier rejection", async () => {
  let requestBody: unknown;
  const env = {
    TAKOS_OFFLOAD: {},
    RUN_NOTIFIER: {
      idFromName: (value: string) => value,
      get: () => ({
        fetch: async (request: Request) => {
          requestBody = await request.json();
          return new Response("archive closed", { status: 409 });
        },
      }),
    },
  } as never;

  await expect(emitRunUsageEvent(env, {
    runId: "run_1",
    meterType: "exec_seconds",
    units: 1,
  })).rejects.toThrow("Run usage event rejected: 409 archive closed");
  expect(requestBody).toEqual({
    runId: "run_1",
    meter_type: "exec_seconds",
    units: 1,
  });
});
