import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  createShortcut: vi.fn(),
  deleteShortcut: vi.fn(),
  getOrCreatePersonalWorkspace: vi.fn(),
  listShortcuts: vi.fn(),
  updateShortcut: vi.fn(),
}));

vi.mock('@/services/identity/shortcuts', async () => {
  const actual = await vi.importActual<typeof import('@/services/identity/shortcuts')>('@/services/identity/shortcuts');
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

import shortcuts from '@/routes/shortcuts';

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
  app.route('/api/shortcuts', shortcuts);
  return app;
}

describe('shortcut create contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // No longer used since shortcuts now use user.id directly
  });

  it('rejects legacy resource types', async () => {
    const app = createApp();
    const response = await app.fetch(
      new Request('http://localhost/api/shortcuts', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Legacy project shortcut',
          resourceType: 'project',
          resourceId: 'project-1',
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

  it('allows current worker/resource/link shortcut types', async () => {
    mocks.createShortcut.mockResolvedValue({
      id: 'shortcut-1',
      user_id: 'user-1',
      space_id: 'space-personal-1',
      resource_type: 'service',
      resource_id: 'worker-1',
      name: 'Service shortcut',
      icon: null,
      position: 0,
      created_at: '2026-03-06T00:00:00.000Z',
      updated_at: '2026-03-06T00:00:00.000Z',
    });

    const app = createApp();
    const response = await app.fetch(
      new Request('http://localhost/api/shortcuts', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Service shortcut',
          resourceType: 'service',
          resourceId: 'worker-1',
        }),
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(201);
    expect(mocks.createShortcut).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      'user-1',
      {
        name: 'Service shortcut',
        resourceType: 'service',
        resourceId: 'worker-1',
      },
    );
  });
});
