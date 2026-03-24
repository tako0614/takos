import { describe, expect, it, vi } from 'vitest';
import { MockR2Bucket } from '../../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  gzipCompressString: vi.fn(),
  gzipDecompressToString: vi.fn(),
}));

vi.mock('@/shared/utils/gzip', () => ({
  gzipCompressString: mocks.gzipCompressString,
  gzipDecompressToString: mocks.gzipDecompressToString,
}));

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

describe('segmentIndexForEventId', () => {
  it('returns 1 for event id 1', () => {
    expect(segmentIndexForEventId(1)).toBe(1);
  });

  it('returns 1 for event ids 1..100 (segment size 100)', () => {
    expect(segmentIndexForEventId(100)).toBe(1);
  });

  it('returns 2 for event id 101', () => {
    expect(segmentIndexForEventId(101)).toBe(2);
  });

  it('returns 1 for zero', () => {
    expect(segmentIndexForEventId(0)).toBe(1);
  });

  it('returns 1 for negative numbers', () => {
    expect(segmentIndexForEventId(-5)).toBe(1);
  });

  it('returns 1 for NaN', () => {
    expect(segmentIndexForEventId(NaN)).toBe(1);
  });

  it('returns 1 for Infinity', () => {
    expect(segmentIndexForEventId(Infinity)).toBe(1);
  });
});

describe('buildRunEventSegmentKey', () => {
  it('builds correct key with zero-padded segment index', () => {
    expect(buildRunEventSegmentKey('run-1', 1)).toBe('runs/run-1/events/000001.jsonl.gz');
  });

  it('pads segment index to 6 digits', () => {
    expect(buildRunEventSegmentKey('run-x', 42)).toBe('runs/run-x/events/000042.jsonl.gz');
  });

  it('handles large segment indexes', () => {
    expect(buildRunEventSegmentKey('r', 123456)).toBe('runs/r/events/123456.jsonl.gz');
  });
});

// ---------------------------------------------------------------------------
// writeRunEventSegmentToR2
// ---------------------------------------------------------------------------

describe('writeRunEventSegmentToR2', () => {
  it('compresses events to JSONL and writes to R2', async () => {
    const bucket = new MockR2Bucket();
    const compressed = new ArrayBuffer(8);
    mocks.gzipCompressString.mockResolvedValue(compressed);

    const events: PersistedRunEvent[] = [
      { event_id: 1, type: 'tool_call', data: '{}', created_at: '2025-01-01T00:00:00Z' },
      { event_id: 2, type: 'message', data: '{}', created_at: '2025-01-01T00:00:01Z' },
    ];

    await writeRunEventSegmentToR2(bucket as never, 'run-1', 1, events);

    expect(mocks.gzipCompressString).toHaveBeenCalledTimes(1);
    const jsonl = mocks.gzipCompressString.mock.calls[0][0] as string;
    // Should be JSONL with trailing newline
    const lines = jsonl.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).event_id).toBe(1);

    // Verify data was stored in R2
    const key = buildRunEventSegmentKey('run-1', 1);
    const stored = await bucket.get(key);
    expect(stored).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listRunEventSegmentIndexes
// ---------------------------------------------------------------------------

describe('listRunEventSegmentIndexes', () => {
  it('returns sorted indexes from R2 listing', async () => {
    const bucket = new MockR2Bucket();
    // Simulate storing segments (content does not matter for listing)
    await bucket.put('runs/r1/events/000003.jsonl.gz', 'a');
    await bucket.put('runs/r1/events/000001.jsonl.gz', 'b');
    await bucket.put('runs/r1/events/000002.jsonl.gz', 'c');

    const indexes = await listRunEventSegmentIndexes(bucket as never, 'r1');
    expect(indexes).toEqual([1, 2, 3]);
  });

  it('returns empty array when no segments exist', async () => {
    const bucket = new MockR2Bucket();
    const indexes = await listRunEventSegmentIndexes(bucket as never, 'no-run');
    expect(indexes).toEqual([]);
  });

  it('ignores non-matching keys in the prefix', async () => {
    const bucket = new MockR2Bucket();
    await bucket.put('runs/r1/events/000001.jsonl.gz', 'ok');
    await bucket.put('runs/r1/events/notes.txt', 'bad');

    const indexes = await listRunEventSegmentIndexes(bucket as never, 'r1');
    expect(indexes).toEqual([1]);
  });
});

// ---------------------------------------------------------------------------
// readRunEventSegmentFromR2
// ---------------------------------------------------------------------------

describe('readRunEventSegmentFromR2', () => {
  it('decompresses and parses JSONL events sorted by event_id', async () => {
    const bucket = new MockR2Bucket();
    const key = buildRunEventSegmentKey('run-1', 1);
    await bucket.put(key, 'compressed-data');

    const event1: PersistedRunEvent = { event_id: 2, type: 'message', data: '{}', created_at: '2025-01-01T00:00:01Z' };
    const event2: PersistedRunEvent = { event_id: 1, type: 'tool_call', data: '{}', created_at: '2025-01-01T00:00:00Z' };
    const jsonl = [JSON.stringify(event1), JSON.stringify(event2)].join('\n') + '\n';
    mocks.gzipDecompressToString.mockResolvedValue(jsonl);

    const events = await readRunEventSegmentFromR2(bucket as never, 'run-1', 1);
    expect(events).not.toBeNull();
    expect(events).toHaveLength(2);
    // Sorted by event_id
    expect(events![0].event_id).toBe(1);
    expect(events![1].event_id).toBe(2);
  });

  it('returns null when the segment does not exist', async () => {
    const bucket = new MockR2Bucket();
    const result = await readRunEventSegmentFromR2(bucket as never, 'no-run', 1);
    expect(result).toBeNull();
  });

  it('skips malformed JSON lines', async () => {
    const bucket = new MockR2Bucket();
    const key = buildRunEventSegmentKey('run-1', 1);
    await bucket.put(key, 'compressed-data');

    const valid: PersistedRunEvent = { event_id: 1, type: 'msg', data: '{}', created_at: '2025-01-01T00:00:00Z' };
    const jsonl = `${JSON.stringify(valid)}\n{bad json}\n`;
    mocks.gzipDecompressToString.mockResolvedValue(jsonl);

    const events = await readRunEventSegmentFromR2(bucket as never, 'run-1', 1);
    expect(events).toHaveLength(1);
    expect(events![0].event_id).toBe(1);
  });

  it('skips entries with non-finite event_id', async () => {
    const bucket = new MockR2Bucket();
    const key = buildRunEventSegmentKey('run-1', 1);
    await bucket.put(key, 'compressed-data');

    const jsonl = JSON.stringify({ event_id: 'not_a_number', type: 'x', data: '{}', created_at: 'ts' }) + '\n';
    mocks.gzipDecompressToString.mockResolvedValue(jsonl);

    const events = await readRunEventSegmentFromR2(bucket as never, 'run-1', 1);
    expect(events).toHaveLength(0);
  });

  it('skips entries missing required string fields', async () => {
    const bucket = new MockR2Bucket();
    const key = buildRunEventSegmentKey('run-1', 1);
    await bucket.put(key, 'compressed-data');

    // Missing 'type' field
    const jsonl = JSON.stringify({ event_id: 1, data: '{}', created_at: 'ts' }) + '\n';
    mocks.gzipDecompressToString.mockResolvedValue(jsonl);

    const events = await readRunEventSegmentFromR2(bucket as never, 'run-1', 1);
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getRunEventsAfterFromR2
// ---------------------------------------------------------------------------

describe('getRunEventsAfterFromR2', () => {
  it('filters events after given event id across segments', async () => {
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
      .mockResolvedValueOnce(seg1Events.map(e => JSON.stringify(e)).join('\n') + '\n')
      .mockResolvedValueOnce(seg2Events.map(e => JSON.stringify(e)).join('\n') + '\n');

    const events = await getRunEventsAfterFromR2(bucket as never, 'run-1', 0, 500);
    expect(events.length).toBeGreaterThanOrEqual(1);
    for (const e of events) {
      expect(e.event_id).toBeGreaterThan(0);
    }
  });

  it('respects limit parameter', async () => {
    const bucket = new MockR2Bucket();
    const segKey = buildRunEventSegmentKey('run-2', 1);
    await bucket.put(segKey, 'data');

    const events: PersistedRunEvent[] = Array.from({ length: 10 }, (_, i) => ({
      event_id: i + 1,
      type: 'msg',
      data: '{}',
      created_at: 'ts',
    }));

    mocks.gzipDecompressToString.mockResolvedValue(
      events.map(e => JSON.stringify(e)).join('\n') + '\n',
    );

    const result = await getRunEventsAfterFromR2(bucket as never, 'run-2', 0, 3);
    expect(result).toHaveLength(3);
  });

  it('returns empty array when no segments exist', async () => {
    const bucket = new MockR2Bucket();
    const result = await getRunEventsAfterFromR2(bucket as never, 'empty', 0);
    expect(result).toEqual([]);
  });
});
