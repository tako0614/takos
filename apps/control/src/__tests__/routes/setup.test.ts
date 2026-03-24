import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  lastSetData: null as Record<string, unknown> | null,
}));

vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>();
  return {
    ...actual,
    getDb: () => ({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            get: vi.fn(async () => undefined),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((data: Record<string, unknown>) => {
          mocks.lastSetData = data;
          return {
            where: vi.fn(async () => undefined),
          };
        }),
      })),
    }),
  };
});

import setupRoutes from '@/routes/setup';

type TestEnv = {
  Bindings: Env;
  Variables: {
    user: User;
  };
};

class TestDb {}

function createUser(): User {
  return {
    id: 'user-1',
    principal_id: 'principal-1',
    email: 'user1@example.com',
    name: 'User One',
    username: 'user1',
    bio: null,
    picture: null,
    trust_tier: 'normal',
    setup_completed: false,
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z',
  };
}

function createApp(user: User) {
  const app = new Hono<TestEnv>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/api/setup', setupRoutes);
  return app;
}

describe('setup route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('completes setup with username only (no password)', async () => {
    const db = new TestDb();
    const app = createApp(createUser());

    const response = await app.fetch(
      new Request('http://localhost/api/setup/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'userone',
        }),
      }),
      createMockEnv({ DB: db }) as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      username: 'userone',
    });

    expect(mocks.lastSetData).not.toBeNull();
    const setData = mocks.lastSetData as Record<string, unknown>;

    expect(setData.slug).toBe('userone');
    expect(setData.setupCompleted).toBe(true);
    // No password hash should be set
    expect(setData.passwordHash).toBeUndefined();
  });
});
