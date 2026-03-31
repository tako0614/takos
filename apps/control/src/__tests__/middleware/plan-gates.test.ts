import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup.ts';

import { assertEquals, assertObjectMatch } from 'jsr:@std/assert';
import { assertSpyCalls } from 'jsr:@std/testing/mock';

const mocks = ({
  checkWeeklyRuntimeLimit: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/services/billing/billing'
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


  Deno.test('requireWeeklyRuntimeLimitForAgent - skips read-only methods', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.checkWeeklyRuntimeLimit = (async () => ({
      allowed: true,
      usedSeconds: 10,
      limitSeconds: 18_000,
      remainingSeconds: 17_990,
      windowDays: 7,
      windowStart: '2026-02-20T00:00:00.000Z',
      retryAfterSeconds: 0,
    })) as any;
  const app = createApp();
    const response = await app.fetch(
      new Request('https://takos.jp/api/runs', { method: 'GET' }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    assertSpyCalls(mocks.checkWeeklyRuntimeLimit, 0);
})
  Deno.test('requireWeeklyRuntimeLimitForAgent - passes through when no user is attached', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.checkWeeklyRuntimeLimit = (async () => ({
      allowed: true,
      usedSeconds: 10,
      limitSeconds: 18_000,
      remainingSeconds: 17_990,
      windowDays: 7,
      windowStart: '2026-02-20T00:00:00.000Z',
      retryAfterSeconds: 0,
    })) as any;
  const app = createApp(false);
    const response = await app.fetch(
      new Request('https://takos.jp/api/runs', { method: 'POST' }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 201);
    assertSpyCalls(mocks.checkWeeklyRuntimeLimit, 0);
})
  Deno.test('requireWeeklyRuntimeLimitForAgent - returns 402 when weekly runtime is exceeded', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.checkWeeklyRuntimeLimit = (async () => ({
      allowed: true,
      usedSeconds: 10,
      limitSeconds: 18_000,
      remainingSeconds: 17_990,
      windowDays: 7,
      windowStart: '2026-02-20T00:00:00.000Z',
      retryAfterSeconds: 0,
    })) as any;
  mocks.checkWeeklyRuntimeLimit = (async () => ({
      allowed: false,
      usedSeconds: 18_120,
      limitSeconds: 18_000,
      remainingSeconds: 0,
      windowDays: 7,
      windowStart: '2026-02-20T00:00:00.000Z',
      retryAfterSeconds: 1800,
    })) as any;
    const app = createApp();
    const response = await app.fetch(
      new Request('https://takos.jp/api/runs', { method: 'POST' }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 402);
    assertEquals(response.headers.get('Retry-After'), '1800');
    await assertObjectMatch(await response.json(), {
      error: 'Weekly runtime limit exceeded',
      code: 'PAYMENT_REQUIRED',
      details: {
        reason: expect.stringContaining('Weekly runtime limit reached'),
        used_seconds_7d: 18120,
        limit_seconds_7d: 18000,
        retry_after_seconds: 1800,
      },
    });
})