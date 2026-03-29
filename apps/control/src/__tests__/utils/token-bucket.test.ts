import { describe, expect, it } from 'vitest';
import { hitTokenBucket, type TokenBucketState } from '@/utils/rate-limiter';

describe('Token Bucket', () => {
  it('starts full and allows immediately', () => {
    const now = 1_000_000;
    const { state, result } = hitTokenBucket(undefined, { maxRequests: 5, windowMs: 10_000 }, now, true);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(5);
    expect(result.total).toBe(5);
    expect(state.tokens).toBe(5);
    expect(state.lastRefillMs).toBe(now);
  });

  it('denies after consuming capacity and refills over time', () => {
    const config = { maxRequests: 5, windowMs: 10_000 }; // 1 token per 2000ms
    const t0 = 1_000_000;

    let state: TokenBucketState | undefined = undefined;

    // Consume 5 tokens at the same timestamp.
    for (let i = 0; i < 5; i++) {
      const out = hitTokenBucket(state, config, t0);
      state = out.state;
      expect(out.result.allowed).toBe(true);
    }

    // Next hit at the same time is denied.
    {
      const out = hitTokenBucket(state, config, t0);
      state = out.state;
      expect(out.result.allowed).toBe(false);
      expect(out.result.remaining).toBe(0);
      expect(out.result.reset).toBe(t0 + 2000);
    }

    // After 1 second, still denied (only 0.5 token).
    {
      const out = hitTokenBucket(state, config, t0 + 1000);
      state = out.state;
      expect(out.result.allowed).toBe(false);
      expect(out.result.remaining).toBe(0);
      expect(out.result.reset).toBe(t0 + 2000);
    }

    // After 2 seconds, 1 token is available and can be consumed.
    {
      const out = hitTokenBucket(state, config, t0 + 2000);
      state = out.state;
      expect(out.result.allowed).toBe(true);
      expect(out.result.remaining).toBe(0);
    }
  });
});

