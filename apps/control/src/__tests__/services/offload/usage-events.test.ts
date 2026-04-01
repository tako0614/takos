import { MockR2Bucket } from "../../../../test/integration/setup.ts";

import { assertEquals, assertNotEquals } from "jsr:@std/assert";
import { assertSpyCalls, spy, stub } from "jsr:@std/testing/mock";

const mocks = {
  gzipCompressString: spy(async (..._args: any[]) => new ArrayBuffer(0)) as any,
  gzipDecompressToString: ((..._args: any[]) => undefined) as any,
};

// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/gzip'
import {
  usageEventsDeps,
  getUsageEventsFromR2,
  type PersistedUsageEvent,
  usageSegmentKey,
  writeUsageEventSegmentToR2,
} from "@/services/offload/usage-events";

const originalUsageEventsDeps = { ...usageEventsDeps };

function restoreUsageEventsDeps() {
  Object.assign(usageEventsDeps, originalUsageEventsDeps);
}

// ---------------------------------------------------------------------------
// usageSegmentKey
// ---------------------------------------------------------------------------

Deno.test("usageSegmentKey - builds key with zero-padded segment index", () => {
  assertEquals(usageSegmentKey("run-1", 1), "runs/run-1/usage/000001.jsonl.gz");
});
Deno.test("usageSegmentKey - pads segment index to 6 digits", () => {
  assertEquals(
    usageSegmentKey("run-x", 42),
    "runs/run-x/usage/000042.jsonl.gz",
  );
});
// ---------------------------------------------------------------------------
// writeUsageEventSegmentToR2
// ---------------------------------------------------------------------------

Deno.test("writeUsageEventSegmentToR2 - does nothing when events array is empty", async () => {
  restoreUsageEventsDeps();
  const bucket = new MockR2Bucket();
  const putSpy = stub(bucket, "put");
  await writeUsageEventSegmentToR2(bucket as never, "run-1", 1, []);
  assertSpyCalls(putSpy, 0);
  assertSpyCalls(mocks.gzipCompressString, 0);
});
Deno.test("writeUsageEventSegmentToR2 - compresses events to JSONL and writes to R2 with metadata", async () => {
  restoreUsageEventsDeps();
  const bucket = new MockR2Bucket();
  const compressed = new ArrayBuffer(4);
  mocks.gzipCompressString = spy(async () => compressed) as any;
  usageEventsDeps.gzipCompressString = mocks.gzipCompressString;

  const events: PersistedUsageEvent[] = [
    {
      meter_type: "llm_tokens_input",
      units: 100,
      created_at: "2025-01-01T00:00:00Z",
    },
    {
      meter_type: "exec_seconds",
      units: 30,
      reference_type: "container",
      created_at: "2025-01-01T00:00:01Z",
    },
  ];

  await writeUsageEventSegmentToR2(bucket as never, "run-1", 1, events);

  assertSpyCalls(mocks.gzipCompressString, 1);
  const jsonl = mocks.gzipCompressString.calls[0].args[0] as string;
  const lines = jsonl.split("\n").filter(Boolean);
  assertEquals(lines.length, 2);

  const parsed0 = JSON.parse(lines[0]);
  assertEquals(parsed0.meter_type, "llm_tokens_input");
  assertEquals(parsed0.units, 100);

  const parsed1 = JSON.parse(lines[1]);
  assertEquals(parsed1.reference_type, "container");

  // Verify key
  const key = usageSegmentKey("run-1", 1);
  const stored = await bucket.get(key);
  assertNotEquals(stored, null);
});
// ---------------------------------------------------------------------------
// getUsageEventsFromR2
// ---------------------------------------------------------------------------

Deno.test("getUsageEventsFromR2 - returns empty array when no usage segments exist", async () => {
  const bucket = new MockR2Bucket();
  const events = await getUsageEventsFromR2(bucket as never, "no-run");
  assertEquals(events, []);
});
Deno.test("getUsageEventsFromR2 - decompresses and parses events from multiple segments", async () => {
  restoreUsageEventsDeps();
  const bucket = new MockR2Bucket();

  const key1 = usageSegmentKey("run-1", 1);
  const key2 = usageSegmentKey("run-1", 2);
  await bucket.put(key1, "compressed-1");
  await bucket.put(key2, "compressed-2");

  const events1: PersistedUsageEvent[] = [
    {
      meter_type: "llm_tokens_input",
      units: 100,
      created_at: "2025-01-01T00:00:00Z",
    },
  ];
  const events2: PersistedUsageEvent[] = [
    {
      meter_type: "exec_seconds",
      units: 30,
      created_at: "2025-01-01T00:00:01Z",
    },
  ];

  let decompressCallCount = 0;
  mocks.gzipDecompressToString = (async () => {
    decompressCallCount++;
    const events = decompressCallCount === 1 ? events1 : events2;
    return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  }) as any;
  usageEventsDeps.gzipDecompressToString = mocks.gzipDecompressToString;

  const result = await getUsageEventsFromR2(bucket as never, "run-1");
  assertEquals(result.length, 2);
  assertEquals(result[0].meter_type, "llm_tokens_input");
  assertEquals(result[1].meter_type, "exec_seconds");
});
Deno.test("getUsageEventsFromR2 - respects maxEvents option", async () => {
  restoreUsageEventsDeps();
  const bucket = new MockR2Bucket();
  const key = usageSegmentKey("run-2", 1);
  await bucket.put(key, "data");

  const events: PersistedUsageEvent[] = Array.from({ length: 10 }, (_, i) => ({
    meter_type: "exec_seconds",
    units: i + 1,
    created_at: `2025-01-01T00:00:${String(i).padStart(2, "0")}Z`,
  }));

  mocks.gzipDecompressToString =
    (async () => events.map((e) => JSON.stringify(e)).join("\n") + "\n") as any;
  usageEventsDeps.gzipDecompressToString = mocks.gzipDecompressToString;

  const result = await getUsageEventsFromR2(bucket as never, "run-2", {
    maxEvents: 3,
  });
  assertEquals(result.length, 3);
});
Deno.test("getUsageEventsFromR2 - clamps maxEvents to at least 1", async () => {
  restoreUsageEventsDeps();
  const bucket = new MockR2Bucket();
  const key = usageSegmentKey("run-3", 1);
  await bucket.put(key, "data");

  const events: PersistedUsageEvent[] = [
    {
      meter_type: "exec_seconds",
      units: 1,
      created_at: "2025-01-01T00:00:00Z",
    },
    {
      meter_type: "exec_seconds",
      units: 2,
      created_at: "2025-01-01T00:00:01Z",
    },
  ];
  mocks.gzipDecompressToString =
    (async () => events.map((e) => JSON.stringify(e)).join("\n") + "\n") as any;
  usageEventsDeps.gzipDecompressToString = mocks.gzipDecompressToString;

  const result = await getUsageEventsFromR2(bucket as never, "run-3", {
    maxEvents: 0,
  });
  assertEquals(result.length, 1);
});
Deno.test("getUsageEventsFromR2 - skips malformed lines during parsing", async () => {
  restoreUsageEventsDeps();
  const bucket = new MockR2Bucket();
  const key = usageSegmentKey("run-4", 1);
  await bucket.put(key, "data");

  const valid: PersistedUsageEvent = {
    meter_type: "exec_seconds",
    units: 10,
    created_at: "2025-01-01T00:00:00Z",
  };
  const jsonl = `${JSON.stringify(valid)}\n{bad json}\n`;
  mocks.gzipDecompressToString = (async () => jsonl) as any;
  usageEventsDeps.gzipDecompressToString = mocks.gzipDecompressToString;

  const result = await getUsageEventsFromR2(bucket as never, "run-4");
  assertEquals(result.length, 1);
  assertEquals(result[0].units, 10);
});
Deno.test("getUsageEventsFromR2 - skips entries missing required fields", async () => {
  restoreUsageEventsDeps();
  const bucket = new MockR2Bucket();
  const key = usageSegmentKey("run-5", 1);
  await bucket.put(key, "data");

  // Missing meter_type
  const jsonl = JSON.stringify({ units: 10, created_at: "ts" }) + "\n";
  mocks.gzipDecompressToString = (async () => jsonl) as any;
  usageEventsDeps.gzipDecompressToString = mocks.gzipDecompressToString;

  const result = await getUsageEventsFromR2(bucket as never, "run-5");
  assertEquals(result.length, 0);
});
Deno.test("getUsageEventsFromR2 - skips entries with non-finite units", async () => {
  restoreUsageEventsDeps();
  const bucket = new MockR2Bucket();
  const key = usageSegmentKey("run-6", 1);
  await bucket.put(key, "data");

  const jsonl =
    JSON.stringify({ meter_type: "x", units: NaN, created_at: "ts" }) + "\n";
  mocks.gzipDecompressToString = (async () => jsonl) as any;
  usageEventsDeps.gzipDecompressToString = mocks.gzipDecompressToString;

  const result = await getUsageEventsFromR2(bucket as never, "run-6");
  assertEquals(result.length, 0);
});
