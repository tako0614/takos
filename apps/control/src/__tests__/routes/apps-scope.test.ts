import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  requireWorkspaceAccess: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@/routes/shared/helpers', async () => {
  const actual = await vi.importActual<typeof import('@/routes/shared/helpers')>('@/routes/shared/helpers');
  return {
    ...actual,
    requireWorkspaceAccess: mocks.requireWorkspaceAccess,
  };
});

import { registerAppApiRoutes } from '@/routes/apps';

function createApp() {
  const app = new Hono<{ Bindings: Env; Variables: { user: User } }>();
  app.use('*', async (c, next) => {
    c.set('user', {
      id: 'user-1',
      name: 'User 1',
      email: 'user1@example.com',
    } as User);
    await next();
  });
  registerAppApiRoutes(app);
  return app;
}

describe('apps detail workspace scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies X-Takos-Space-Id to custom app detail lookups', async () => {
    const selectGet = vi.fn().mockResolvedValue({
      id: 'app-1',
      name: 'custom-app',
      description: 'Custom app',
      icon: null,
      appType: 'custom',
      takosClientKey: null,
      createdAt: '2026-03-06T00:00:00.000Z',
      updatedAt: '2026-03-06T00:00:00.000Z',
      workerHostname: 'custom-app.example.com',
      workerStatus: 'deployed',
      accountName: 'Workspace 1',
      accountSlug: 'team-one',
      accountType: 'team',
    });

    mocks.getDb.mockReturnValue({
      select: vi.fn(() => {
        const chain: any = {
          from: vi.fn(() => chain),
          leftJoin: vi.fn(() => chain),
          where: vi.fn(() => chain),
          limit: vi.fn(() => chain),
          get: selectGet,
        };
        return chain;
      }),
    });
    mocks.requireWorkspaceAccess.mockResolvedValue({
      workspace: {
        id: 'workspace-1',
      },
    });

    const app = createApp();
    const response = await app.fetch(
      new Request('http://localhost/apps/app-1', {
        headers: {
          'X-Takos-Space-Id': 'team-one',
        },
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      app: expect.objectContaining({
        id: 'app-1',
        space_id: 'team-one',
      }),
    });
  });
});
