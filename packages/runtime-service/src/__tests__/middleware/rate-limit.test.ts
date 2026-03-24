import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../../middleware/rate-limit.js';

describe('createRateLimiter maxKeys saturation', () => {
  it('fails closed when the key store is saturated', async () => {
    const limiter = createRateLimiter({
      maxRequests: 5,
      windowMs: 60_000,
      maxKeys: 1,
      keyFn: (c) => c.req.header('x-rate-key') || 'unknown',
    });

    const app = new Hono();
    app.use(limiter);
    app.get('/', (c) => c.json({ ok: true }));

    const first = await app.request('/', {
      headers: { 'x-rate-key': 'key-1' },
    });
    expect(first.status).toBe(200);

    const second = await app.request('/', {
      headers: { 'x-rate-key': 'key-2' },
    });
    expect(second.status).toBe(429);
    expect(await second.json()).toEqual({
      error: 'Rate limiter capacity reached. Please try again later.',
      retry_after_seconds: 60,
    });
    expect(second.headers.get('retry-after')).toBe('60');
  });
});
