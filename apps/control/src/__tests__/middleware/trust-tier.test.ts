import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { requireTrustTier, meetsMinTier } from '@/middleware/trust-tier';
import { createMockEnv } from '../../../test/integration/setup';

type TestVars = { user?: User };
type TestEnv = { Bindings: Env; Variables: TestVars };

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    username: 'testuser',
    bio: null,
    picture: null,
    trust_tier: 'normal',
    setup_completed: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createApp(minTier: 'normal' | 'trusted', presetUser?: User) {
  const app = new Hono<TestEnv>();
  // Optionally preset the user (simulates auth middleware having run)
  if (presetUser) {
    app.use('*', async (c, next) => {
      c.set('user', presetUser);
      await next();
    });
  }
  app.use('*', requireTrustTier(minTier));
  app.get('/protected', (c) => c.json({ ok: true }));
  return app;
}

describe('requireTrustTier middleware', () => {
  it('returns 401 when no user is set (unauthenticated)', async () => {
    const app = createApp('normal');
    const res = await app.fetch(
      new Request('https://takos.jp/protected'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: 'Authentication required', code: 'UNAUTHORIZED' });
  });

  it('returns 403 when user trust_tier is "new" but "normal" is required', async () => {
    const app = createApp('normal', makeUser({ trust_tier: 'new' }));
    const res = await app.fetch(
      new Request('https://takos.jp/protected'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({
      error: 'Account too new for this operation',
      code: 'FORBIDDEN',
    });
  });

  it('passes when user trust_tier is "normal" and "normal" is required', async () => {
    const app = createApp('normal', makeUser({ trust_tier: 'normal' }));
    const res = await app.fetch(
      new Request('https://takos.jp/protected'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it('passes when user trust_tier is "trusted" and "normal" is required', async () => {
    const app = createApp('normal', makeUser({ trust_tier: 'trusted' }));
    const res = await app.fetch(
      new Request('https://takos.jp/protected'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it('returns 403 when user trust_tier is "normal" but "trusted" is required', async () => {
    const app = createApp('trusted', makeUser({ trust_tier: 'normal' }));
    const res = await app.fetch(
      new Request('https://takos.jp/protected'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({
      error: 'Account too new for this operation',
      code: 'FORBIDDEN',
    });
  });
});

describe('meetsMinTier', () => {
  it('treats unknown tier as level 0 (same as "new")', () => {
    expect(meetsMinTier('unknown', 'normal')).toBe(false);
    expect(meetsMinTier('unknown', 'new')).toBe(true);
  });

  it('"trusted" meets all tiers', () => {
    expect(meetsMinTier('trusted', 'new')).toBe(true);
    expect(meetsMinTier('trusted', 'normal')).toBe(true);
    expect(meetsMinTier('trusted', 'trusted')).toBe(true);
  });
});
