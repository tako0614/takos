import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  checkWeeklyRuntimeLimit: vi.fn(),
}));

vi.mock('@/services/billing/billing', async () => {
  const actual = await vi.importActual<typeof import('@/services/billing/billing')>('@/services/billing/billing');
  return {
    ...actual,
    checkWeeklyRuntimeLimit: mocks.checkWeeklyRuntimeLimit,
  };
});

import { requireWeeklyRuntimeLimitForAgent } from '@/middleware/plan-gates';

type Vars = { user?: User };
type TestEnv = { Bindings: Env; Variables: Vars };

function createApp(withUser = true) {
  const app = new Hono<TestEnv>();
  app.use('*', async (c, next) => {
    if (withUser) {
      c.set('user', {
        id: 'user-1',
        email: 'user1@example.com',
        name: 'User1',
        username: 'user1',
        bio: null,
        picture: null,
        trust_tier: 'normal',
        setup_completed: true,
        created_at: '2026-02-01T00:00:00.000Z',
        updated_at: '2026-02-01T00:00:00.000Z',
      });
    }
    await next();
  });
  app.use('*', requireWeeklyRuntimeLimitForAgent());
  app.post('/api/runs', (c) => c.json({ ok: true }, 201));
  app.get('/api/runs', (c) => c.json({ ok: true }, 200));
  return app;
}

describe('requireWeeklyRuntimeLimitForAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkWeeklyRuntimeLimit.mockResolvedValue({
      allowed: true,
      usedSeconds: 10,
      limitSeconds: 18_000,
      remainingSeconds: 17_990,
      windowDays: 7,
      windowStart: '2026-02-20T00:00:00.000Z',
      retryAfterSeconds: 0,
    });
  });

  it('skips read-only methods', async () => {
    const app = createApp();
    const response = await app.fetch(
      new Request('https://takos.jp/api/runs', { method: 'GET' }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    expect(mocks.checkWeeklyRuntimeLimit).not.toHaveBeenCalled();
  });

  it('passes through when no user is attached', async () => {
    const app = createApp(false);
    const response = await app.fetch(
      new Request('https://takos.jp/api/runs', { method: 'POST' }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(201);
    expect(mocks.checkWeeklyRuntimeLimit).not.toHaveBeenCalled();
  });

  it('returns 402 when weekly runtime is exceeded', async () => {
    mocks.checkWeeklyRuntimeLimit.mockResolvedValueOnce({
      allowed: false,
      usedSeconds: 18_120,
      limitSeconds: 18_000,
      remainingSeconds: 0,
      windowDays: 7,
      windowStart: '2026-02-20T00:00:00.000Z',
      retryAfterSeconds: 1800,
    });
    const app = createApp();
    const response = await app.fetch(
      new Request('https://takos.jp/api/runs', { method: 'POST' }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(402);
    expect(response.headers.get('Retry-After')).toBe('1800');
    await expect(response.json()).resolves.toMatchObject({
      error: 'Weekly runtime limit exceeded',
      code: 'PAYMENT_REQUIRED',
      details: {
        reason: expect.stringContaining('Weekly runtime limit reached'),
        used_seconds_7d: 18120,
        limit_seconds_7d: 18000,
        retry_after_seconds: 1800,
      },
    });
  });
});
