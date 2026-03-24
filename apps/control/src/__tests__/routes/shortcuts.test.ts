import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  createShortcut: vi.fn(),
  deleteShortcut: vi.fn(),
  getOrCreatePersonalWorkspace: vi.fn(),
  listShortcuts: vi.fn().mockResolvedValue([]),
  updateShortcut: vi.fn(),
}));

vi.mock('@/services/identity/shortcuts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/identity/shortcuts')>();
  return {
    ...actual,
    createShortcut: mocks.createShortcut,
    deleteShortcut: mocks.deleteShortcut,
    listShortcuts: mocks.listShortcuts,
    updateShortcut: mocks.updateShortcut,
  };
});

vi.mock('@/services/identity/spaces', () => ({
  getOrCreatePersonalWorkspace: mocks.getOrCreatePersonalWorkspace,
}));

import shortcutsRoutes from '@/routes/shortcuts';

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
  app.route('/api/shortcuts', shortcutsRoutes);
  return app;
}

describe('shortcuts routes input validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // No longer used since shortcuts now use user.id directly
    mocks.listShortcuts.mockResolvedValue([]);
  });

  it('rejects unknown shortcut resource types', async () => {
    const app = createApp(createUser());
    const response = await app.fetch(
      new Request('http://localhost/api/shortcuts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Legacy Project Shortcut',
          resourceType: 'project',
          resourceId: 'proj-1',
        }),
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: 'BAD_REQUEST',
      error: 'Invalid resourceType. Allowed values: service, resource, link',
    });
    expect(mocks.createShortcut).not.toHaveBeenCalled();
  });
});
