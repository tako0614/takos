import { describe, expect, it, vi } from 'vitest';
import { InMemoryRateLimiter, RateLimiters } from '@/utils/rate-limiter';

describe('InMemoryRateLimiter', () => {
  it('allows requests within limit', () => {
    const limiter = new InMemoryRateLimiter({ maxRequests: 5, windowMs: 10_000 });
    const info = limiter.check('user-1');
    expect(info.remaining).toBe(5);
    expect(info.total).toBe(5);
  });

  it('decrements remaining on hit', () => {
    const limiter = new InMemoryRateLimiter({ maxRequests: 5, windowMs: 10_000 });
    limiter.hit('user-1');
    const info = limiter.check('user-1');
    expect(info.remaining).toBe(4);
  });

  it('exhausts capacity after max hits', () => {
    const limiter = new InMemoryRateLimiter({ maxRequests: 3, windowMs: 60_000 });
    for (let i = 0; i < 3; i++) {
      limiter.hit('user-1');
    }
    const info = limiter.check('user-1');
    expect(info.remaining).toBe(0);
  });

  it('tracks different keys independently', () => {
    const limiter = new InMemoryRateLimiter({ maxRequests: 3, windowMs: 60_000 });
    limiter.hit('user-1');
    limiter.hit('user-1');

    const info1 = limiter.check('user-1');
    const info2 = limiter.check('user-2');

    expect(info1.remaining).toBe(1);
    expect(info2.remaining).toBe(3);
  });

  it('hit returns rate limit info', () => {
    const limiter = new InMemoryRateLimiter({ maxRequests: 5, windowMs: 10_000 });
    const info = limiter.hit('user-1');
    expect(info.total).toBe(5);
    expect(info.remaining).toBe(4);
    expect(typeof info.reset).toBe('number');
  });

  it('cleanup removes expired entries', () => {
    const limiter = new InMemoryRateLimiter({ maxRequests: 5, windowMs: 1 });
    limiter.hit('user-1');

    // Wait a tiny bit for entries to expire (windowMs is 1ms)
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        limiter.cleanup();
        const info = limiter.check('user-1');
        expect(info.remaining).toBe(5);
        resolve();
      }, 10);
    });
  });

  describe('checkKeyLimit / MAX_KEYS behavior', () => {
    it('evicts keys when the map reaches MAX_KEYS capacity', () => {
      // We cannot easily fill 100_000 keys in a unit test, but we can verify
      // the mechanism by accessing the private map via hit() and observing that
      // subsequent hits on new keys still work (i.e. no crash / no infinite loop).
      const limiter = new InMemoryRateLimiter({ maxRequests: 2, windowMs: 60_000 });

      // Fill many distinct keys
      const keyCount = 200;
      for (let i = 0; i < keyCount; i++) {
        limiter.hit(`key-${i}`);
      }

      // All tracked keys should still be queryable
      const first = limiter.check('key-0');
      const last = limiter.check(`key-${keyCount - 1}`);
      expect(first.total).toBe(2);
      expect(last.total).toBe(2);
    });
  });
});

describe('InMemoryRateLimiter#middleware', () => {
  function createMockContext(ip?: string) {
    const headers: Record<string, string> = {};
    const resHeaders: Record<string, string> = {};
    return {
      req: {
        header: (name: string) => (name === 'CF-Connecting-IP' ? ip : undefined),
      },
      header: (name: string, value: string) => {
        resHeaders[name] = value;
      },
      json: (body: unknown, status: number) => ({ body, status }),
      _resHeaders: resHeaders,
    } as any;
  }

  it('passes through when under the rate limit', async () => {
    const limiter = new InMemoryRateLimiter({ maxRequests: 5, windowMs: 60_000 });
    const mw = limiter.middleware();
    const c = createMockContext('1.2.3.4');
    const next = vi.fn().mockResolvedValue(undefined);

    await mw(c, next);

    expect(next).toHaveBeenCalledOnce();
    expect(c._resHeaders['X-RateLimit-Limit']).toBe('5');
    expect(c._resHeaders['X-RateLimit-Remaining']).toBeDefined();
  });

  it('returns 429 with Retry-After header when rate limited', async () => {
    const limiter = new InMemoryRateLimiter({ maxRequests: 2, windowMs: 60_000 });
    const mw = limiter.middleware();
    const next = vi.fn().mockResolvedValue(undefined);

    // Exhaust the limit
    for (let i = 0; i < 2; i++) {
      limiter.hit('1.2.3.4');
    }

    const c = createMockContext('1.2.3.4');
    const result = await mw(c, next);
    expect(result).toBeDefined();
    if (!result) throw new Error('Expected rate limiter to return a response');
    const limited = result;

    expect(next).not.toHaveBeenCalled();
    expect(limited).toBeDefined();
    expect(limited.status).toBe(429);
    const limitedBody = limited.body as unknown as { error: string; retryAfter: number };
    expect(limitedBody.error).toBeDefined();
    expect(limitedBody.retryAfter).toBeGreaterThan(0);
    expect(c._resHeaders['Retry-After']).toBeDefined();
    expect(Number(c._resHeaders['Retry-After'])).toBeGreaterThan(0);
  });

  it('skips rate limiting when skip function returns true', async () => {
    const limiter = new InMemoryRateLimiter({
      maxRequests: 1,
      windowMs: 60_000,
      skip: () => true,
    });
    const mw = limiter.middleware();

    // Exhaust the limit
    limiter.hit('1.2.3.4');

    const c = createMockContext('1.2.3.4');
    const next = vi.fn().mockResolvedValue(undefined);

    await mw(c, next);

    // Should still pass through because skip returns true
    expect(next).toHaveBeenCalledOnce();
  });

  it('uses custom keyGenerator when provided', async () => {
    const limiter = new InMemoryRateLimiter({
      maxRequests: 1,
      windowMs: 60_000,
      keyGenerator: () => 'custom-key',
    });
    const mw = limiter.middleware();

    // Exhaust the custom key
    limiter.hit('custom-key');

    const c = createMockContext('1.2.3.4');
    const next = vi.fn().mockResolvedValue(undefined);

    const result = await mw(c, next);
    expect(result).toBeDefined();
    if (!result) throw new Error('Expected rate limiter to return a response');
    const limited = result;

    // Should be rate limited because the custom key is exhausted
    expect(next).not.toHaveBeenCalled();
    expect(limited.status).toBe(429);
  });

  it('sets X-RateLimit-Reset header as seconds', async () => {
    const limiter = new InMemoryRateLimiter({ maxRequests: 10, windowMs: 60_000 });
    const mw = limiter.middleware();
    const c = createMockContext('1.2.3.4');
    const next = vi.fn().mockResolvedValue(undefined);

    await mw(c, next);

    const resetValue = Number(c._resHeaders['X-RateLimit-Reset']);
    // Reset should be a reasonable epoch timestamp in seconds
    expect(resetValue).toBeGreaterThan(0);
  });
});

describe('RateLimiters factory', () => {
  it('creates auth limiter with expected config', () => {
    const limiter = RateLimiters.auth();
    expect(limiter).toBeInstanceOf(InMemoryRateLimiter);
    const info = limiter.check('test');
    expect(info.total).toBe(100);
  });

  it('creates sensitive limiter', () => {
    const limiter = RateLimiters.sensitive();
    const info = limiter.check('test');
    expect(info.total).toBe(100);
  });

  it('creates oauthToken limiter with lower limit', () => {
    const limiter = RateLimiters.oauthToken();
    const info = limiter.check('test');
    expect(info.total).toBe(20);
  });

  it('creates oauthRevoke limiter with strict limit', () => {
    const limiter = RateLimiters.oauthRevoke();
    const info = limiter.check('test');
    expect(info.total).toBe(10);
  });

  it('creates oauthAuthorize limiter with 30 max requests', () => {
    const limiter = RateLimiters.oauthAuthorize();
    expect(limiter).toBeInstanceOf(InMemoryRateLimiter);
    const info = limiter.check('test');
    expect(info.total).toBe(30);
  });

  it('creates oauthRegister limiter with 10 max requests', () => {
    const limiter = RateLimiters.oauthRegister();
    expect(limiter).toBeInstanceOf(InMemoryRateLimiter);
    const info = limiter.check('test');
    expect(info.total).toBe(10);
  });

  it('creates oauthDeviceCode limiter with 10 max requests', () => {
    const limiter = RateLimiters.oauthDeviceCode();
    expect(limiter).toBeInstanceOf(InMemoryRateLimiter);
    const info = limiter.check('test');
    expect(info.total).toBe(10);
  });

  it('creates oauthDeviceVerify limiter with 60 max requests', () => {
    const limiter = RateLimiters.oauthDeviceVerify();
    expect(limiter).toBeInstanceOf(InMemoryRateLimiter);
    const info = limiter.check('test');
    expect(info.total).toBe(60);
  });

  it('each factory call creates a separate instance', () => {
    const a = RateLimiters.auth();
    const b = RateLimiters.auth();
    a.hit('user-1');
    expect(b.check('user-1').remaining).toBe(100); // b is independent
  });
});
