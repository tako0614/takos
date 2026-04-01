import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../../test/integration/setup.ts';

import { assert, assertEquals } from 'jsr:@std/assert';
import { assertSpyCalls, spy } from 'jsr:@std/testing/mock';

const mocks = ({
  requireSpaceAccess: ((..._args: any[]) => undefined) as any,
  listActivityPubStoresForWorkspace: ((..._args: any[]) => undefined) as any,
  createActivityPubStore: ((..._args: any[]) => undefined) as any,
  updateActivityPubStore: ((..._args: any[]) => undefined) as any,
  deleteActivityPubStore: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/routes/shared/helpers'
// [Deno] vi.mock removed - manually stub imports from '@/services/activitypub/stores'
import workspaceStoresRoutes from '@/routes/spaces/stores';
import { spacesStoresRouteDeps } from '@/routes/spaces/stores';

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


  Deno.test('workspace activitypub stores routes - lists default and custom stores for a workspace', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({
      space: { id: 'ws-1' },
      membership: { role: 'owner' },
    })) as any;
  mocks.listActivityPubStoresForWorkspace = (async () => [
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
    ]) as any;
  spacesStoresRouteDeps.requireSpaceAccess = mocks.requireSpaceAccess;
  spacesStoresRouteDeps.listActivityPubStoresForWorkspace = mocks.listActivityPubStoresForWorkspace;

    const app = createApp(createUser());
    const response = await app.fetch(
      new Request('http://localhost/api/spaces/ws-1/stores'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    await assertEquals(await response.json(), {
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
})
  Deno.test('workspace activitypub stores routes - creates a custom store for a workspace', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({
      space: { id: 'ws-1' },
      membership: { role: 'owner' },
    })) as any;
  mocks.createActivityPubStore = spy(async () => ({
      accountId: 'ws-1',
      accountSlug: 'alice',
      slug: 'oss',
      name: 'OSS Catalog',
      summary: 'Open source picks',
      iconUrl: null,
      isDefault: false,
      createdAt: '2026-03-02T00:00:00.000Z',
      updatedAt: '2026-03-02T00:00:00.000Z',
    })) as any;
  spacesStoresRouteDeps.requireSpaceAccess = mocks.requireSpaceAccess;
  spacesStoresRouteDeps.createActivityPubStore = mocks.createActivityPubStore;

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

    assertEquals(response.status, 201);
    assertSpyCalls(mocks.createActivityPubStore, 1);
    assert(mocks.createActivityPubStore.calls[0].args[0] != null);
    assertEquals(mocks.createActivityPubStore.calls[0].args.slice(1), ['ws-1', {
      slug: 'oss',
      name: 'OSS Catalog',
      summary: 'Open source picks',
      iconUrl: undefined,
    }]);
})
  Deno.test('workspace activitypub stores routes - updates a custom store for a workspace', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({
      space: { id: 'ws-1' },
      membership: { role: 'owner' },
    })) as any;
  mocks.updateActivityPubStore = spy(async () => ({
      accountId: 'ws-1',
      accountSlug: 'alice',
      slug: 'oss',
      name: 'OSS Catalog',
      summary: 'Updated summary',
      iconUrl: null,
      isDefault: false,
      createdAt: '2026-03-02T00:00:00.000Z',
      updatedAt: '2026-03-03T00:00:00.000Z',
    })) as any;
  spacesStoresRouteDeps.requireSpaceAccess = mocks.requireSpaceAccess;
  spacesStoresRouteDeps.updateActivityPubStore = mocks.updateActivityPubStore;

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

    assertEquals(response.status, 200);
    assertSpyCalls(mocks.updateActivityPubStore, 1);
    assert(mocks.updateActivityPubStore.calls[0].args[0] != null);
    assertEquals(mocks.updateActivityPubStore.calls[0].args.slice(1), ['ws-1', 'oss', {
      name: undefined,
      summary: 'Updated summary',
      iconUrl: undefined,
    }]);
})
  Deno.test('workspace activitypub stores routes - deletes a custom store for a workspace', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({
      space: { id: 'ws-1' },
      membership: { role: 'owner' },
    })) as any;
  mocks.deleteActivityPubStore = spy(async () => true) as any;
  spacesStoresRouteDeps.requireSpaceAccess = mocks.requireSpaceAccess;
  spacesStoresRouteDeps.deleteActivityPubStore = mocks.deleteActivityPubStore;

    const app = createApp(createUser());
    const response = await app.fetch(
      new Request('http://localhost/api/spaces/ws-1/stores/oss', {
        method: 'DELETE',
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    await assertEquals(await response.json(), { success: true });
    assertSpyCalls(mocks.deleteActivityPubStore, 1);
    assert(mocks.deleteActivityPubStore.calls[0].args[0] != null);
    assertEquals(mocks.deleteActivityPubStore.calls[0].args.slice(1), ['ws-1', 'oss']);
})
