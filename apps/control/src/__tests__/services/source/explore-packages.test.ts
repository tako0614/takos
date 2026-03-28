import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

import { getTakopackRatingStats, getTakopackRatingSummary } from '@/services/source/explore-packages';

describe('getTakopackRatingStats', () => {
  it('returns default stats for all repo IDs', async () => {
    const result = await getTakopackRatingStats({} as any, ['repo-1', 'repo-2']);

    expect(result.size).toBe(2);
    expect(result.get('repo-1')).toEqual({ rating_avg: null, rating_count: 0 });
    expect(result.get('repo-2')).toEqual({ rating_avg: null, rating_count: 0 });
  });

  it('returns empty map for empty input', async () => {
    const result = await getTakopackRatingStats({} as any, []);
    expect(result.size).toBe(0);
  });
});

describe('getTakopackRatingSummary', () => {
  it('returns default summary', async () => {
    const result = await getTakopackRatingSummary({} as any, 'repo-1');
    expect(result).toEqual({ rating_avg: null, rating_count: 0 });
  });
});
