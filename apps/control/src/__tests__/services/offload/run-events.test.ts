import { MockR2Bucket } from '../../../../test/integration/setup';

import { assertEquals, assertNotEquals, assert } from 'jsr:@std/assert';
import { assertSpyCalls } from 'jsr:@std/testing/mock';

const mocks = ({
  gzipCompressString: ((..._args: any[]) => undefined) as any,
  gzipDecompressToString: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/gzip'
import {
  segmentIndexForEventId,
  buildRunEventSegmentKey,
  writeRunEventSegmentToR2,
  listRunEventSegmentIndexes,
  readRunEventSegmentFromR2,
  getRunEventsAfterFromR2,
  RUN_EVENT_SEGMENT_SIZE,
  type PersistedRunEvent,
} from '@/services/offload/run-events';

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------


  Deno.test('segmentIndexForEventId - returns 1 for event id 1', () => {
  assertEquals(segmentIndexForEventId(1), 1);
})
  Deno.test('segmentIndexForEventId - returns 1 for event ids 1..100 (segment size 100)', () => {
  assertEquals(segmentIndexForEventId(100), 1);
})
  Deno.test('segmentIndexForEventId - returns 2 for event id 101', () => {
  assertEquals(segmentIndexForEventId(101), 2);
})
  Deno.test('segmentIndexForEventId - returns 1 for zero', () => {
  assertEquals(segmentIndexForEventId(0), 1);
})
  Deno.test('segmentIndexForEventId - returns 1 for negative numbers', () => {
  assertEquals(segmentIndexForEventId(-5), 1);
})
  Deno.test('segmentIndexForEventId - returns 1 for NaN', () => {
  assertEquals(segmentIndexForEventId(NaN), 1);
})
  Deno.test('segmentIndexForEventId - returns 1 for Infinity', () => {
  assertEquals(segmentIndexForEventId(Infinity), 1);
})

  Deno.test('buildRunEventSegmentKey - builds correct key with zero-padded segment index', () => {
  assertEquals(buildRunEventSegmentKey('run-1', 1), 'runs/run-1/events/000001.jsonl.gz');
})
  Deno.test('buildRunEventSegmentKey - pads segment index to 6 digits', () => {
  assertEquals(buildRunEventSegmentKey('run-x', 42), 'runs/run-x/events/000042.jsonl.gz');
})
  Deno.test('buildRunEventSegmentKey - handles large segment indexes', () => {
  assertEquals(buildRunEventSegmentKey('r', 123456), 'runs/r/events/123456.jsonl.gz');
})
// ---------------------------------------------------------------------------
// writeRunEventSegmentToR2
// ---------------------------------------------------------------------------


  Deno.test('writeRunEventSegmentToR2 - compresses events to JSONL and writes to R2', async () => {
  const bucket = new MockR2Bucket();
    const compressed = new ArrayBuffer(8);
    mocks.gzipCompressString = (async () => compressed) as any;

    const events: PersistedRunEvent[] = [
      { event_id: 1, type: 'tool_call', data: '{}', created_at: '2025-01-01T00:00:00Z' },
      { event_id: 2, type: 'message', data: '{}', created_at: '2025-01-01T00:00:01Z' },
    ];

    await writeRunEventSegmentToR2(bucket as never, 'run-1', 1, events);

    assertSpyCalls(mocks.gzipCompressString, 1);
    const jsonl = mocks.gzipCompressString.calls[0][0] as string;
    // Should be JSONL with trailing newline
    const lines = jsonl.split('\n').filter(Boolean);
    assertEquals(lines.length, 2);
    assertEquals(JSON.parse(lines[0]).event_id, 1);

    // Verify data was stored in R2
    const key = buildRunEventSegmentKey('run-1', 1);
    const stored = await bucket.get(key);
    assertNotEquals(stored, null);
})
// ---------------------------------------------------------------------------
// listRunEventSegmentIndexes
// ---------------------------------------------------------------------------


  Deno.test('listRunEventSegmentIndexes - returns sorted indexes from R2 listing', async () => {
  const bucket = new MockR2Bucket();
    // Simulate storing segments (content does not matter for listing)
    await bucket.put('runs/r1/events/000003.jsonl.gz', 'a');
    await bucket.put('runs/r1/events/000001.jsonl.gz', 'b');
    await bucket.put('runs/r1/events/000002.jsonl.gz', 'c');

    const indexes = await listRunEventSegmentIndexes(bucket as never, 'r1');
    assertEquals(indexes, [1, 2, 3]);
})
  Deno.test('listRunEventSegmentIndexes - returns empty array when no segments exist', async () => {
  const bucket = new MockR2Bucket();
    const indexes = await listRunEventSegmentIndexes(bucket as never, 'no-run');
    assertEquals(indexes, []);
})
  Deno.test('listRunEventSegmentIndexes - ignores non-matching keys in the prefix', async () => {
  const bucket = new MockR2Bucket();
    await bucket.put('runs/r1/events/000001.jsonl.gz', 'ok');
    await bucket.put('runs/r1/events/notes.txt', 'bad');

    const indexes = await listRunEventSegmentIndexes(bucket as never, 'r1');
    assertEquals(indexes, [1]);
})
// ---------------------------------------------------------------------------
// readRunEventSegmentFromR2
// ---------------------------------------------------------------------------


  Deno.test('readRunEventSegmentFromR2 - decompresses and parses JSONL events sorted by event_id', async () => {
  const bucket = new MockR2Bucket();
    const key = buildRunEventSegmentKey('run-1', 1);
    await bucket.put(key, 'compressed-data');

    const event1: PersistedRunEvent = { event_id: 2, type: 'message', data: '{}', created_at: '2025-01-01T00:00:01Z' };
    const event2: PersistedRunEvent = { event_id: 1, type: 'tool_call', data: '{}', created_at: '2025-01-01T00:00:00Z' };
    const jsonl = [JSON.stringify(event1), JSON.stringify(event2)].join('\n') + '\n';
    mocks.gzipDecompressToString = (async () => jsonl) as any;

    const events = await readRunEventSegmentFromR2(bucket as never, 'run-1', 1);
    assertNotEquals(events, null);
    assertEquals(events.length, 2);
    // Sorted by event_id
    assertEquals(events![0].event_id, 1);
    assertEquals(events![1].event_id, 2);
})
  Deno.test('readRunEventSegmentFromR2 - returns null when the segment does not exist', async () => {
  const bucket = new MockR2Bucket();
    const result = await readRunEventSegmentFromR2(bucket as never, 'no-run', 1);
    assertEquals(result, null);
})
  Deno.test('readRunEventSegmentFromR2 - skips malformed JSON lines', async () => {
  const bucket = new MockR2Bucket();
    const key = buildRunEventSegmentKey('run-1', 1);
    await bucket.put(key, 'compressed-data');

    const valid: PersistedRunEvent = { event_id: 1, type: 'msg', data: '{}', created_at: '2025-01-01T00:00:00Z' };
    const jsonl = `${JSON.stringify(valid)}\n{bad json}\n`;
    mocks.gzipDecompressToString = (async () => jsonl) as any;

    const events = await readRunEventSegmentFromR2(bucket as never, 'run-1', 1);
    assertEquals(events.length, 1);
    assertEquals(events![0].event_id, 1);
})
  Deno.test('readRunEventSegmentFromR2 - skips entries with non-finite event_id', async () => {
  const bucket = new MockR2Bucket();
    const key = buildRunEventSegmentKey('run-1', 1);
    await bucket.put(key, 'compressed-data');

    const jsonl = JSON.stringify({ event_id: 'not_a_number', type: 'x', data: '{}', created_at: 'ts' }) + '\n';
    mocks.gzipDecompressToString = (async () => jsonl) as any;

    const events = await readRunEventSegmentFromR2(bucket as never, 'run-1', 1);
    assertEquals(events.length, 0);
})
  Deno.test('readRunEventSegmentFromR2 - skips entries missing required string fields', async () => {
  const bucket = new MockR2Bucket();
    const key = buildRunEventSegmentKey('run-1', 1);
    await bucket.put(key, 'compressed-data');

    // Missing 'type' field
    const jsonl = JSON.stringify({ event_id: 1, data: '{}', created_at: 'ts' }) + '\n';
    mocks.gzipDecompressToString = (async () => jsonl) as any;

    const events = await readRunEventSegmentFromR2(bucket as never, 'run-1', 1);
    assertEquals(events.length, 0);
})
// ---------------------------------------------------------------------------
// getRunEventsAfterFromR2
// ---------------------------------------------------------------------------


  Deno.test('getRunEventsAfterFromR2 - filters events after given event id across segments', async () => {
  const bucket = new MockR2Bucket();

    // Create segment 1 with events 1-2
    const seg1Key = buildRunEventSegmentKey('run-1', 1);
    await bucket.put(seg1Key, 'compressed-1');

    // Create segment 2 with events 101-102
    const seg2Key = buildRunEventSegmentKey('run-1', 2);
    await bucket.put(seg2Key, 'compressed-2');

    const seg1Events: PersistedRunEvent[] = [
      { event_id: 1, type: 'a', data: '{}', created_at: 'ts' },
      { event_id: 50, type: 'b', data: '{}', created_at: 'ts' },
    ];
    const seg2Events: PersistedRunEvent[] = [
      { event_id: 101, type: 'c', data: '{}', created_at: 'ts' },
      { event_id: 150, type: 'd', data: '{}', created_at: 'ts' },
    ];

    mocks.gzipDecompressToString
       = (async () => seg1Events.map(e => JSON.stringify(e)).join('\n') + '\n') as any
       = (async () => seg2Events.map(e => JSON.stringify(e)).join('\n') + '\n') as any;

    const events = await getRunEventsAfterFromR2(bucket as never, 'run-1', 0, 500);
    assert(events.length >= 1);
    for (const e of events) {
      assert(e.event_id > 0);
    }
})
  Deno.test('getRunEventsAfterFromR2 - respects limit parameter', async () => {
  const bucket = new MockR2Bucket();
    const segKey = buildRunEventSegmentKey('run-2', 1);
    await bucket.put(segKey, 'data');

    const events: PersistedRunEvent[] = Array.from({ length: 10 }, (_, i) => ({
      event_id: i + 1,
      type: 'msg',
      data: '{}',
      created_at: 'ts',
    }));

    mocks.gzipDecompressToString = (async () => events.map(e => JSON.stringify(e)).join('\n') + '\n',) as any;

    const result = await getRunEventsAfterFromR2(bucket as never, 'run-2', 0, 3);
    assertEquals(result.length, 3);
})
  Deno.test('getRunEventsAfterFromR2 - returns empty array when no segments exist', async () => {
  const bucket = new MockR2Bucket();
    const result = await getRunEventsAfterFromR2(bucket as never, 'empty', 0);
    assertEquals(result, []);
})