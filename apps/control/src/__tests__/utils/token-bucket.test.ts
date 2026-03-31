import { hitTokenBucket, type TokenBucketState } from '@/utils/rate-limiter';


import { assertEquals } from 'jsr:@std/assert';

  Deno.test('Token Bucket - starts full and allows immediately', () => {
  const now = 1_000_000;
    const { state, result } = hitTokenBucket(undefined, { maxRequests: 5, windowMs: 10_000 }, now, true);

    assertEquals(result.allowed, true);
    assertEquals(result.remaining, 5);
    assertEquals(result.total, 5);
    assertEquals(state.tokens, 5);
    assertEquals(state.lastRefillMs, now);
})
  Deno.test('Token Bucket - denies after consuming capacity and refills over time', () => {
  const config = { maxRequests: 5, windowMs: 10_000 }; // 1 token per 2000ms
    const t0 = 1_000_000;

    let state: TokenBucketState | undefined = undefined;

    // Consume 5 tokens at the same timestamp.
    for (let i = 0; i < 5; i++) {
      const out = hitTokenBucket(state, config, t0);
      state = out.state;
      assertEquals(out.result.allowed, true);
    }

    // Next hit at the same time is denied.
    {
      const out = hitTokenBucket(state, config, t0);
      state = out.state;
      assertEquals(out.result.allowed, false);
      assertEquals(out.result.remaining, 0);
      assertEquals(out.result.reset, t0 + 2000);
    }

    // After 1 second, still denied (only 0.5 token).
    {
      const out = hitTokenBucket(state, config, t0 + 1000);
      state = out.state;
      assertEquals(out.result.allowed, false);
      assertEquals(out.result.remaining, 0);
      assertEquals(out.result.reset, t0 + 2000);
    }

    // After 2 seconds, 1 token is available and can be consumed.
    {
      const out = hitTokenBucket(state, config, t0 + 2000);
      state = out.state;
      assertEquals(out.result.allowed, true);
      assertEquals(out.result.remaining, 0);
    }
})
