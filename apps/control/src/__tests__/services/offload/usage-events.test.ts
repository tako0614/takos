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
  usageSegmentKey,
  writeUsageEventSegmentToR2,
  getUsageEventsFromR2,
  USAGE_EVENT_SEGMENT_SIZE,
  type PersistedUsageEvent,
} from '@/services/offload/usage-events';

// ---------------------------------------------------------------------------
// usageSegmentKey
// ---------------------------------------------------------------------------

describe('usageSegmentKey', () => {
  it('builds key with zero-padded segment index', () => {
    expect(usageSegmentKey('run-1', 1)).toBe('runs/run-1/usage/000001.jsonl.gz');
  });

  it('pads segment index to 6 digits', () => {
    expect(usageSegmentKey('run-x', 42)).toBe('runs/run-x/usage/000042.jsonl.gz');
  });
});

// ---------------------------------------------------------------------------
// writeUsageEventSegmentToR2
// ---------------------------------------------------------------------------

describe('writeUsageEventSegmentToR2', () => {
  it('does nothing when events array is empty', async () => {
    const bucket = new MockR2Bucket();
    const putSpy = vi.spyOn(bucket, 'put');
    await writeUsageEventSegmentToR2(bucket as never, 'run-1', 1, []);
    expect(putSpy).not.toHaveBeenCalled();
    expect(mocks.gzipCompressString).not.toHaveBeenCalled();
  });

  it('compresses events to JSONL and writes to R2 with metadata', async () => {
    const bucket = new MockR2Bucket();
    const compressed = new ArrayBuffer(4);
    mocks.gzipCompressString.mockResolvedValue(compressed);

    const events: PersistedUsageEvent[] = [
      { meter_type: 'llm_tokens_input', units: 100, created_at: '2025-01-01T00:00:00Z' },
      { meter_type: 'exec_seconds', units: 30, reference_type: 'container', created_at: '2025-01-01T00:00:01Z' },
    ];

    await writeUsageEventSegmentToR2(bucket as never, 'run-1', 1, events);

    expect(mocks.gzipCompressString).toHaveBeenCalledTimes(1);
    const jsonl = mocks.gzipCompressString.mock.calls[0][0] as string;
    const lines = jsonl.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);

    const parsed0 = JSON.parse(lines[0]);
    expect(parsed0.meter_type).toBe('llm_tokens_input');
    expect(parsed0.units).toBe(100);

    const parsed1 = JSON.parse(lines[1]);
    expect(parsed1.reference_type).toBe('container');

    // Verify key
    const key = usageSegmentKey('run-1', 1);
    const stored = await bucket.get(key);
    expect(stored).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getUsageEventsFromR2
// ---------------------------------------------------------------------------

describe('getUsageEventsFromR2', () => {
  it('returns empty array when no usage segments exist', async () => {
    const bucket = new MockR2Bucket();
    const events = await getUsageEventsFromR2(bucket as never, 'no-run');
    expect(events).toEqual([]);
  });

  it('decompresses and parses events from multiple segments', async () => {
    const bucket = new MockR2Bucket();

    const key1 = usageSegmentKey('run-1', 1);
    const key2 = usageSegmentKey('run-1', 2);
    await bucket.put(key1, 'compressed-1');
    await bucket.put(key2, 'compressed-2');

    const events1: PersistedUsageEvent[] = [
      { meter_type: 'llm_tokens_input', units: 100, created_at: '2025-01-01T00:00:00Z' },
    ];
    const events2: PersistedUsageEvent[] = [
      { meter_type: 'exec_seconds', units: 30, created_at: '2025-01-01T00:00:01Z' },
    ];

    mocks.gzipDecompressToString
      .mockResolvedValueOnce(events1.map(e => JSON.stringify(e)).join('\n') + '\n')
      .mockResolvedValueOnce(events2.map(e => JSON.stringify(e)).join('\n') + '\n');

    const result = await getUsageEventsFromR2(bucket as never, 'run-1');
    expect(result).toHaveLength(2);
    expect(result[0].meter_type).toBe('llm_tokens_input');
    expect(result[1].meter_type).toBe('exec_seconds');
  });

  it('respects maxEvents option', async () => {
    const bucket = new MockR2Bucket();
    const key = usageSegmentKey('run-2', 1);
    await bucket.put(key, 'data');

    const events: PersistedUsageEvent[] = Array.from({ length: 10 }, (_, i) => ({
      meter_type: 'exec_seconds',
      units: i + 1,
      created_at: `2025-01-01T00:00:${String(i).padStart(2, '0')}Z`,
    }));

    mocks.gzipDecompressToString.mockResolvedValue(
      events.map(e => JSON.stringify(e)).join('\n') + '\n',
    );

    const result = await getUsageEventsFromR2(bucket as never, 'run-2', { maxEvents: 3 });
    expect(result).toHaveLength(3);
  });

  it('clamps maxEvents to at least 1', async () => {
    const bucket = new MockR2Bucket();
    const key = usageSegmentKey('run-3', 1);
    await bucket.put(key, 'data');

    const events: PersistedUsageEvent[] = [
      { meter_type: 'exec_seconds', units: 1, created_at: '2025-01-01T00:00:00Z' },
      { meter_type: 'exec_seconds', units: 2, created_at: '2025-01-01T00:00:01Z' },
    ];
    mocks.gzipDecompressToString.mockResolvedValue(
      events.map(e => JSON.stringify(e)).join('\n') + '\n',
    );

    const result = await getUsageEventsFromR2(bucket as never, 'run-3', { maxEvents: 0 });
    expect(result).toHaveLength(1);
  });

  it('skips malformed lines during parsing', async () => {
    const bucket = new MockR2Bucket();
    const key = usageSegmentKey('run-4', 1);
    await bucket.put(key, 'data');

    const valid: PersistedUsageEvent = { meter_type: 'exec_seconds', units: 10, created_at: '2025-01-01T00:00:00Z' };
    const jsonl = `${JSON.stringify(valid)}\n{bad json}\n`;
    mocks.gzipDecompressToString.mockResolvedValue(jsonl);

    const result = await getUsageEventsFromR2(bucket as never, 'run-4');
    expect(result).toHaveLength(1);
    expect(result[0].units).toBe(10);
  });

  it('skips entries missing required fields', async () => {
    const bucket = new MockR2Bucket();
    const key = usageSegmentKey('run-5', 1);
    await bucket.put(key, 'data');

    // Missing meter_type
    const jsonl = JSON.stringify({ units: 10, created_at: 'ts' }) + '\n';
    mocks.gzipDecompressToString.mockResolvedValue(jsonl);

    const result = await getUsageEventsFromR2(bucket as never, 'run-5');
    expect(result).toHaveLength(0);
  });

  it('skips entries with non-finite units', async () => {
    const bucket = new MockR2Bucket();
    const key = usageSegmentKey('run-6', 1);
    await bucket.put(key, 'data');

    const jsonl = JSON.stringify({ meter_type: 'x', units: NaN, created_at: 'ts' }) + '\n';
    mocks.gzipDecompressToString.mockResolvedValue(jsonl);

    const result = await getUsageEventsFromR2(bucket as never, 'run-6');
    expect(result).toHaveLength(0);
  });
});
