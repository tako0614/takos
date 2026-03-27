import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  requireSpaceAccess: vi.fn(),
  listActivityPubStoresForWorkspace: vi.fn(),
  createActivityPubStore: vi.fn(),
  updateActivityPubStore: vi.fn(),
  deleteActivityPubStore: vi.fn(),
}));

vi.mock('@/routes/shared/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/routes/shared/helpers')>();
  return {
    ...actual,
    requireSpaceAccess: mocks.requireSpaceAccess,
  };
});

vi.mock('@/services/activitypub/stores', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/activitypub/stores')>();
  return {
    ...actual,
    listActivityPubStoresForWorkspace: mocks.listActivityPubStoresForWorkspace,
    createActivityPubStore: mocks.createActivityPubStore,
    updateActivityPubStore: mocks.updateActivityPubStore,
    deleteActivityPubStore: mocks.deleteActivityPubStore,
  };
});

import workspaceStoresRoutes from '@/routes/spaces/stores';

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
  app.route('/api/spaces', workspaceStoresRoutes);
  return app;
}

describe('workspace activitypub stores routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSpaceAccess.mockResolvedValue({
      workspace: { id: 'ws-1' },
      member: { role: 'owner' },
    });
  });

  it('lists default and custom stores for a workspace', async () => {
    mocks.listActivityPubStoresForWorkspace.mockResolvedValue([
      {
        accountId: 'ws-1',
        accountSlug: 'alice',
        slug: 'alice',
        name: 'Alice',
        summary: 'Default store',
        iconUrl: null,
        isDefault: true,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
      },
      {
        accountId: 'ws-1',
        accountSlug: 'alice',
        slug: 'oss',
        name: 'OSS Catalog',
        summary: 'Open source picks',
        iconUrl: 'https://cdn.test/oss.png',
        isDefault: false,
        createdAt: '2026-03-02T00:00:00.000Z',
        updatedAt: '2026-03-02T00:00:00.000Z',
      },
    ]);

    const app = createApp(createUser());
    const response = await app.fetch(
      new Request('http://localhost/api/spaces/ws-1/stores'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      stores: [
        {
          slug: 'alice',
          name: 'Alice',
          summary: 'Default store',
          icon_url: null,
          is_default: true,
          created_at: '2026-03-01T00:00:00.000Z',
          updated_at: '2026-03-01T00:00:00.000Z',
        },
        {
          slug: 'oss',
          name: 'OSS Catalog',
          summary: 'Open source picks',
          icon_url: 'https://cdn.test/oss.png',
          is_default: false,
          created_at: '2026-03-02T00:00:00.000Z',
          updated_at: '2026-03-02T00:00:00.000Z',
        },
      ],
    });
  });

  it('creates a custom store for a workspace', async () => {
    mocks.createActivityPubStore.mockResolvedValue({
      accountId: 'ws-1',
      accountSlug: 'alice',
      slug: 'oss',
      name: 'OSS Catalog',
      summary: 'Open source picks',
      iconUrl: null,
      isDefault: false,
      createdAt: '2026-03-02T00:00:00.000Z',
      updatedAt: '2026-03-02T00:00:00.000Z',
    });

    const app = createApp(createUser());
    const response = await app.fetch(
      new Request('http://localhost/api/spaces/ws-1/stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: 'oss',
          name: 'OSS Catalog',
          summary: 'Open source picks',
        }),
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(201);
    expect(mocks.createActivityPubStore).toHaveBeenCalledWith(expect.anything(), 'ws-1', {
      slug: 'oss',
      name: 'OSS Catalog',
      summary: 'Open source picks',
      iconUrl: undefined,
    });
  });

  it('updates a custom store for a workspace', async () => {
    mocks.updateActivityPubStore.mockResolvedValue({
      accountId: 'ws-1',
      accountSlug: 'alice',
      slug: 'oss',
      name: 'OSS Catalog',
      summary: 'Updated summary',
      iconUrl: null,
      isDefault: false,
      createdAt: '2026-03-02T00:00:00.000Z',
      updatedAt: '2026-03-03T00:00:00.000Z',
    });

    const app = createApp(createUser());
    const response = await app.fetch(
      new Request('http://localhost/api/spaces/ws-1/stores/oss', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: 'Updated summary',
        }),
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    expect(mocks.updateActivityPubStore).toHaveBeenCalledWith(expect.anything(), 'ws-1', 'oss', {
      name: undefined,
      summary: 'Updated summary',
      iconUrl: undefined,
    });
  });

  it('deletes a custom store for a workspace', async () => {
    mocks.deleteActivityPubStore.mockResolvedValue(true);

    const app = createApp(createUser());
    const response = await app.fetch(
      new Request('http://localhost/api/spaces/ws-1/stores/oss', {
        method: 'DELETE',
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mocks.deleteActivityPubStore).toHaveBeenCalledWith(expect.anything(), 'ws-1', 'oss');
  });
});
