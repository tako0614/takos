import { MockObjectStoreBinding } from "../../../../test/integration/setup.ts";

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";

type AnyMockFn = (...args: unknown[]) => unknown;
const mocks: {
  gzipCompressString: AnyMockFn;
  gzipDecompressToString: AnyMockFn;
} = {
  gzipCompressString: () => undefined,
  gzipDecompressToString: () => undefined,
};

// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/gzip'
import {
  buildRunEventSegmentKey,
  getRunEventsAfterFromR2,
  listRunEventSegmentIndexes,
  type PersistedRunEvent,
  readRunEventSegmentFromR2,
  runEventsDeps,
  segmentIndexForEventId,
  writeRunEventSegmentToR2,
} from "@/services/offload/run-events";

const originalRunEventsDeps = { ...runEventsDeps };

function restoreRunEventsDeps() {
  Object.assign(runEventsDeps, originalRunEventsDeps);
}

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

Deno.test("segmentIndexForEventId - returns 1 for event id 1", () => {
  assertEquals(segmentIndexForEventId(1), 1);
});
Deno.test("segmentIndexForEventId - returns 1 for event ids 1..100 (segment size 100)", () => {
  assertEquals(segmentIndexForEventId(100), 1);
});
Deno.test("segmentIndexForEventId - returns 2 for event id 101", () => {
  assertEquals(segmentIndexForEventId(101), 2);
});
Deno.test("segmentIndexForEventId - returns 1 for zero", () => {
  assertEquals(segmentIndexForEventId(0), 1);
});
Deno.test("segmentIndexForEventId - returns 1 for negative numbers", () => {
  assertEquals(segmentIndexForEventId(-5), 1);
});
Deno.test("segmentIndexForEventId - returns 1 for NaN", () => {
  assertEquals(segmentIndexForEventId(NaN), 1);
});
Deno.test("segmentIndexForEventId - returns 1 for Infinity", () => {
  assertEquals(segmentIndexForEventId(Infinity), 1);
});

Deno.test("buildRunEventSegmentKey - builds correct key with zero-padded segment index", () => {
  assertEquals(
    buildRunEventSegmentKey("run-1", 1),
    "runs/run-1/events/000001.jsonl.gz",
  );
});
Deno.test("buildRunEventSegmentKey - pads segment index to 6 digits", () => {
  assertEquals(
    buildRunEventSegmentKey("run-x", 42),
    "runs/run-x/events/000042.jsonl.gz",
  );
});
Deno.test("buildRunEventSegmentKey - handles large segment indexes", () => {
  assertEquals(
    buildRunEventSegmentKey("r", 123456),
    "runs/r/events/123456.jsonl.gz",
  );
});
// ---------------------------------------------------------------------------
// write run event segment
// ---------------------------------------------------------------------------

Deno.test("run event offload - compresses events to JSONL and writes to the object store", async () => {
  restoreRunEventsDeps();
  const bucket = new MockObjectStoreBinding();
  const compressed = new ArrayBuffer(8);
  const compressSpy = spy(
    async (..._args: Parameters<typeof runEventsDeps.gzipCompressString>) =>
      compressed,
  );
  runEventsDeps.gzipCompressString = compressSpy;

  const events: PersistedRunEvent[] = [
    {
      event_id: 1,
      type: "tool_call",
      data: "{}",
      created_at: "2025-01-01T00:00:00Z",
    },
    {
      event_id: 2,
      type: "message",
      data: "{}",
      created_at: "2025-01-01T00:00:01Z",
    },
  ];

  await writeRunEventSegmentToR2(bucket as never, "run-1", 1, events);

  assertSpyCalls(compressSpy, 1);
  const jsonl = compressSpy.calls[0].args[0] as string;
  // Should be JSONL with trailing newline
  const lines = jsonl.split("\n").filter(Boolean);
  assertEquals(lines.length, 2);
  assertEquals(JSON.parse(lines[0]).event_id, 1);

  // Verify data was stored in the object store
  const key = buildRunEventSegmentKey("run-1", 1);
  const stored = await bucket.get(key);
  assertNotEquals(stored, null);
});
// ---------------------------------------------------------------------------
// listRunEventSegmentIndexes
// ---------------------------------------------------------------------------

Deno.test("listRunEventSegmentIndexes - returns sorted indexes from object store listing", async () => {
  const bucket = new MockObjectStoreBinding();
  // Simulate storing segments (content does not matter for listing)
  await bucket.put("runs/r1/events/000003.jsonl.gz", "a");
  await bucket.put("runs/r1/events/000001.jsonl.gz", "b");
  await bucket.put("runs/r1/events/000002.jsonl.gz", "c");

  const indexes = await listRunEventSegmentIndexes(bucket as never, "r1");
  assertEquals(indexes, [1, 2, 3]);
});
Deno.test("listRunEventSegmentIndexes - returns empty array when no segments exist", async () => {
  const bucket = new MockObjectStoreBinding();
  const indexes = await listRunEventSegmentIndexes(bucket as never, "no-run");
  assertEquals(indexes, []);
});
Deno.test("listRunEventSegmentIndexes - ignores non-matching keys in the prefix", async () => {
  const bucket = new MockObjectStoreBinding();
  await bucket.put("runs/r1/events/000001.jsonl.gz", "ok");
  await bucket.put("runs/r1/events/notes.txt", "bad");

  const indexes = await listRunEventSegmentIndexes(bucket as never, "r1");
  assertEquals(indexes, [1]);
});
// ---------------------------------------------------------------------------
// read run event segment
// ---------------------------------------------------------------------------

Deno.test("run event offload - decompresses and parses JSONL events sorted by event_id", async () => {
  restoreRunEventsDeps();
  const bucket = new MockObjectStoreBinding();
  const key = buildRunEventSegmentKey("run-1", 1);
  await bucket.put(key, "compressed-data");

  const event1: PersistedRunEvent = {
    event_id: 2,
    type: "message",
    data: "{}",
    created_at: "2025-01-01T00:00:01Z",
  };
  const event2: PersistedRunEvent = {
    event_id: 1,
    type: "tool_call",
    data: "{}",
    created_at: "2025-01-01T00:00:00Z",
  };
  const jsonl = [JSON.stringify(event1), JSON.stringify(event2)].join("\n") +
    "\n";
  mocks.gzipDecompressToString = async () => jsonl;
  runEventsDeps.gzipDecompressToString = mocks
    .gzipDecompressToString as typeof runEventsDeps.gzipDecompressToString;

  const events = await readRunEventSegmentFromR2(bucket as never, "run-1", 1);
  assert(events !== null);
  assertEquals(events.length, 2);
  // Sorted by event_id
  assertEquals(events![0].event_id, 1);
  assertEquals(events![1].event_id, 2);
});
Deno.test("run event offload - returns null when the segment does not exist", async () => {
  const bucket = new MockObjectStoreBinding();
  const result = await readRunEventSegmentFromR2(bucket as never, "no-run", 1);
  assertEquals(result, null);
});
Deno.test("run event offload - skips malformed JSON lines", async () => {
  restoreRunEventsDeps();
  const bucket = new MockObjectStoreBinding();
  const key = buildRunEventSegmentKey("run-1", 1);
  await bucket.put(key, "compressed-data");

  const valid: PersistedRunEvent = {
    event_id: 1,
    type: "msg",
    data: "{}",
    created_at: "2025-01-01T00:00:00Z",
  };
  const jsonl = `${JSON.stringify(valid)}\n{bad json}\n`;
  mocks.gzipDecompressToString = async () => jsonl;
  runEventsDeps.gzipDecompressToString = mocks
    .gzipDecompressToString as typeof runEventsDeps.gzipDecompressToString;

  const events = await readRunEventSegmentFromR2(bucket as never, "run-1", 1);
  assert(events !== null);
  assertEquals(events.length, 1);
  assertEquals(events![0].event_id, 1);
});
Deno.test("run event offload - skips entries with non-finite event_id", async () => {
  restoreRunEventsDeps();
  const bucket = new MockObjectStoreBinding();
  const key = buildRunEventSegmentKey("run-1", 1);
  await bucket.put(key, "compressed-data");

  const jsonl = JSON.stringify({
    event_id: "not_a_number",
    type: "x",
    data: "{}",
    created_at: "ts",
  }) + "\n";
  mocks.gzipDecompressToString = async () => jsonl;
  runEventsDeps.gzipDecompressToString = mocks
    .gzipDecompressToString as typeof runEventsDeps.gzipDecompressToString;

  const events = await readRunEventSegmentFromR2(bucket as never, "run-1", 1);
  assert(events !== null);
  assertEquals(events.length, 0);
});
Deno.test("run event offload - skips entries missing required string fields", async () => {
  restoreRunEventsDeps();
  const bucket = new MockObjectStoreBinding();
  const key = buildRunEventSegmentKey("run-1", 1);
  await bucket.put(key, "compressed-data");

  // Missing 'type' field
  const jsonl = JSON.stringify({ event_id: 1, data: "{}", created_at: "ts" }) +
    "\n";
  mocks.gzipDecompressToString = async () => jsonl;
  runEventsDeps.gzipDecompressToString = mocks
    .gzipDecompressToString as typeof runEventsDeps.gzipDecompressToString;

  const events = await readRunEventSegmentFromR2(bucket as never, "run-1", 1);
  assert(events !== null);
  assertEquals(events.length, 0);
});
// ---------------------------------------------------------------------------
// get run events after
// ---------------------------------------------------------------------------

Deno.test("run event offload - filters events after given event id across segments", async () => {
  restoreRunEventsDeps();
  const bucket = new MockObjectStoreBinding();

  // Create segment 1 with events 1-2
  const seg1Key = buildRunEventSegmentKey("run-1", 1);
  await bucket.put(seg1Key, "compressed-1");

  // Create segment 2 with events 101-102
  const seg2Key = buildRunEventSegmentKey("run-1", 2);
  await bucket.put(seg2Key, "compressed-2");

  const seg1Events: PersistedRunEvent[] = [
    { event_id: 1, type: "a", data: "{}", created_at: "ts" },
    { event_id: 50, type: "b", data: "{}", created_at: "ts" },
  ];
  const seg2Events: PersistedRunEvent[] = [
    { event_id: 101, type: "c", data: "{}", created_at: "ts" },
    { event_id: 150, type: "d", data: "{}", created_at: "ts" },
  ];

  let decompressCallCount = 0;
  mocks.gzipDecompressToString = async () => {
    decompressCallCount++;
    const events = decompressCallCount === 1 ? seg1Events : seg2Events;
    return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  };
  runEventsDeps.gzipDecompressToString = mocks
    .gzipDecompressToString as typeof runEventsDeps.gzipDecompressToString;

  const events = await getRunEventsAfterFromR2(
    bucket as never,
    "run-1",
    0,
    500,
  );
  assert(events.length >= 1);
  for (const e of events) {
    assert(e.event_id > 0);
  }
});
Deno.test("run event offload - respects limit parameter", async () => {
  restoreRunEventsDeps();
  const bucket = new MockObjectStoreBinding();
  const segKey = buildRunEventSegmentKey("run-2", 1);
  await bucket.put(segKey, "data");

  const events: PersistedRunEvent[] = Array.from({ length: 10 }, (_, i) => ({
    event_id: i + 1,
    type: "msg",
    data: "{}",
    created_at: "ts",
  }));

  mocks.gzipDecompressToString = async () =>
    events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  runEventsDeps.gzipDecompressToString = mocks
    .gzipDecompressToString as typeof runEventsDeps.gzipDecompressToString;

  const result = await getRunEventsAfterFromR2(bucket as never, "run-2", 0, 3);
  assertEquals(result.length, 3);
});
Deno.test("run event offload - returns empty array when no segments exist", async () => {
  const bucket = new MockObjectStoreBinding();
  const result = await getRunEventsAfterFromR2(bucket as never, "empty", 0);
  assertEquals(result, []);
});
