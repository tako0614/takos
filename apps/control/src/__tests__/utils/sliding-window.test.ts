import { describe, expect, it } from 'vitest';
import {
  hitSlidingWindow,
  cleanupExpiredEntries,
  enforceKeyLimit,
} from '@/utils/rate-limiter';

describe('hitSlidingWindow (dryRun)', () => {
  const config = { maxRequests: 5, windowMs: 10_000 };

  it('allows when no previous timestamps', () => {
    const { result } = hitSlidingWindow([], config, 1_000_000, true);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(5);
    expect(result.total).toBe(5);
  });

  it('decrements remaining based on recent timestamps', () => {
    const now = 1_000_000;
    const timestamps = [now - 1000, now - 2000, now - 3000];
    const { result } = hitSlidingWindow(timestamps, config, now, true);
    expect(result.remaining).toBe(2);
    expect(result.allowed).toBe(true);
  });

  it('returns 0 remaining when at capacity', () => {
    const now = 1_000_000;
    const timestamps = Array.from({ length: 5 }, (_, i) => now - i * 100);
    const { result } = hitSlidingWindow(timestamps, config, now, true);
    expect(result.remaining).toBe(0);
    expect(result.allowed).toBe(false);
  });

  it('excludes expired timestamps', () => {
    const now = 1_000_000;
    // 3 timestamps outside window, 2 inside
    const timestamps = [now - 15000, now - 12000, now - 11000, now - 1000, now - 500];
    const { result } = hitSlidingWindow(timestamps, config, now, true);
    expect(result.remaining).toBe(3);
    expect(result.allowed).toBe(true);
  });

  it('sets reset to earliest valid timestamp + window', () => {
    const now = 1_000_000;
    const timestamps = [now - 5000, now - 1000];
    const { result } = hitSlidingWindow(timestamps, config, now, true);
    expect(result.reset).toBe((now - 5000) + 10_000);
  });

  it('sets reset to now + window when no timestamps', () => {
    const now = 1_000_000;
    const { result } = hitSlidingWindow([], config, now, true);
    expect(result.reset).toBe(now + 10_000);
  });

  it('does not push a timestamp when dryRun is true', () => {
    const now = 1_000_000;
    const { timestamps } = hitSlidingWindow([], config, now, true);
    expect(timestamps).toHaveLength(0);
  });
});

describe('hitSlidingWindow', () => {
  const config = { maxRequests: 3, windowMs: 10_000 };

  it('adds timestamp and returns updated state when allowed', () => {
    const now = 1_000_000;
    const { timestamps, result } = hitSlidingWindow([], config, now);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
    expect(timestamps).toContain(now);
  });

  it('does not add timestamp when at capacity', () => {
    const now = 1_000_000;
    const existing = [now - 100, now - 200, now - 300];
    const { timestamps, result } = hitSlidingWindow(existing, config, now);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(timestamps).toHaveLength(3);
    expect(timestamps).not.toContain(now);
  });

  it('filters expired before checking capacity', () => {
    const now = 1_000_000;
    // 3 expired timestamps + 1 valid
    const existing = [now - 15000, now - 12000, now - 11000, now - 1000];
    const { timestamps, result } = hitSlidingWindow(existing, config, now);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
    expect(timestamps).toHaveLength(2); // 1 valid + 1 new
  });

  it('successive hits consume capacity', () => {
    const now = 1_000_000;
    let ts: number[] = [];

    for (let i = 0; i < 3; i++) {
      const out = hitSlidingWindow(ts, config, now + i);
      ts = out.timestamps;
      expect(out.result.allowed).toBe(true);
    }

    const out = hitSlidingWindow(ts, config, now + 3);
    expect(out.result.allowed).toBe(false);
    expect(out.result.remaining).toBe(0);
  });
});

describe('cleanupExpiredEntries', () => {
  it('removes entries with no valid timestamps', () => {
    const entries = new Map<string, number[]>();
    entries.set('expired', [100, 200, 300]);
    entries.set('valid', [Date.now()]);

    cleanupExpiredEntries(entries, 10_000);
    expect(entries.has('expired')).toBe(false);
    expect(entries.has('valid')).toBe(true);
  });

  it('filters timestamps within entries', () => {
    const now = Date.now();
    const entries = new Map<string, number[]>();
    entries.set('mixed', [now - 20000, now - 15000, now - 1000]);

    cleanupExpiredEntries(entries, 10_000, now);
    expect(entries.get('mixed')).toEqual([now - 1000]);
  });

  it('handles empty map', () => {
    const entries = new Map<string, number[]>();
    cleanupExpiredEntries(entries, 10_000);
    expect(entries.size).toBe(0);
  });
});

describe('enforceKeyLimit', () => {
  it('does nothing when under limit', () => {
    const entries = new Map<string, number[]>();
    entries.set('a', [1]);
    entries.set('b', [2]);

    const removed = enforceKeyLimit(entries, 10);
    expect(removed).toBe(0);
    expect(entries.size).toBe(2);
  });

  it('removes excess entries when at limit', () => {
    const entries = new Map<string, number[]>();
    for (let i = 0; i < 200; i++) {
      entries.set(`key-${i}`, [Date.now()]);
    }

    const removed = enforceKeyLimit(entries, 100);
    expect(removed).toBeGreaterThan(0);
    expect(entries.size).toBeLessThanOrEqual(100);
  });

  it('removes entries from the beginning (oldest insertion)', () => {
    const entries = new Map<string, number[]>();
    entries.set('first', [1]);
    entries.set('second', [2]);
    entries.set('third', [3]);

    enforceKeyLimit(entries, 2);
    // 'first' should be removed as it was inserted first
    expect(entries.has('first')).toBe(false);
  });
});
