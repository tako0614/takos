import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  requireWorkspaceAccess: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>();
  return { ...actual, getDb: mocks.getDb };
});

vi.mock('@/routes/shared/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/routes/shared/helpers')>();
  return {
    ...actual,
    requireWorkspaceAccess: mocks.requireWorkspaceAccess,
  };
});

import { registerAppApiRoutes } from '@/routes/apps';

function createUser(): User {
  return {
    id: 'user-1',
    email: 'user1@example.com',
    name: 'User One',
    username: 'user1',
    bio: null,
    picture: null,
    trust_tier: 'normal',
    setup_completed: true,
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z',
  };
}

function createApp(user: User): Hono<{ Bindings: Env; Variables: { user: User } }> {
  const app = new Hono<{ Bindings: Env; Variables: { user: User } }>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  registerAppApiRoutes(app);
  return app;
}

describe('apps routes workspace scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scopes app detail lookup to the requested space when X-Takos-Space-Id is provided', async () => {
    const selectGet = vi.fn().mockResolvedValue(undefined);
    mocks.getDb.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          leftJoin: vi.fn(function(this: any) { return this; }),
          where: vi.fn(() => ({
            get: selectGet,
          })),
          get: selectGet,
        })),
      })),
    });
    // Make leftJoin chainable by providing all methods at each level
    mocks.getDb.mockReturnValue({
      select: vi.fn(() => {
        const chain: any = {
          from: vi.fn(() => chain),
          leftJoin: vi.fn(() => chain),
          where: vi.fn(() => chain),
          get: selectGet,
        };
        return chain;
      }),
    });
    mocks.requireWorkspaceAccess.mockResolvedValue({
      workspace: {
        id: 'ws-1',
      },
    });

    const app = createApp(createUser());
    const response = await app.fetch(
      new Request('http://localhost/apps/app-1', {
        headers: {
          'X-Takos-Space-Id': 'team-alpha',
        },
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(404);
    expect(mocks.requireWorkspaceAccess).toHaveBeenCalled();
  });
});
