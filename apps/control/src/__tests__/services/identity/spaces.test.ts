import type { D1Database } from '@cloudflare/workers-types';

import { assertEquals, assertNotEquals } from 'jsr:@std/assert';

function createMockDrizzleDb() {
  const getMock = ((..._args: any[]) => undefined) as any;
  const allMock = ((..._args: any[]) => undefined) as any;
  const chain = {
    from: (function(this: any) { return this; }),
    where: (function(this: any) { return this; }),
    orderBy: (function(this: any) { return this; }),
    limit: (function(this: any) { return this; }),
    set: (function(this: any) { return this; }),
    values: (function(this: any) { return this; }),
    returning: (function(this: any) { return this; }),
    innerJoin: (function(this: any) { return this; }),
    get: getMock,
    all: allMock,
  };
  return {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    _: { get: getMock, all: allMock, chain },
  };
}

const db = createMockDrizzleDb();

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
import {
  getWorkspaceByIdOrSlug,
  getWorkspaceModelSettings,
  getUserByEmail,
  getRepositoryById,
} from '@/services/identity/spaces';


  
    Deno.test('spaces service (Drizzle) - getWorkspaceByIdOrSlug - returns mapped workspace when found by id', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
        id: 'ws-1',
        type: 'team',
        name: 'My Team',
        slug: 'my-team',
        description: 'A team workspace',
        ownerAccountId: 'user-1',
        headSnapshotId: null,
        aiModel: 'gpt-5.4-nano',
        aiProvider: 'openai',
        securityPosture: 'standard',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      })) as any;

      const ws = await getWorkspaceByIdOrSlug({} as D1Database, 'ws-1');

      assertNotEquals(ws, null);
      assertEquals(ws!.id, 'ws-1');
      assertEquals(ws!.kind, 'team');
      assertEquals(ws!.name, 'My Team');
      assertEquals(ws!.slug, 'my-team');
      assertEquals(ws!.owner_principal_id, 'user-1');
      assertEquals(ws!.ai_model, 'gpt-5.4-nano');
      assertEquals(ws!.security_posture, 'standard');
})
    Deno.test('spaces service (Drizzle) - getWorkspaceByIdOrSlug - returns null when not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => null) as any;

      const ws = await getWorkspaceByIdOrSlug({} as D1Database, 'nonexistent');
      assertEquals(ws, null);
})
    Deno.test('spaces service (Drizzle) - getWorkspaceByIdOrSlug - maps user type to user kind', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
        id: 'user-1',
        type: 'user',
        name: 'Alice',
        slug: 'alice',
        description: null,
        ownerAccountId: null,
        headSnapshotId: null,
        aiModel: null,
        aiProvider: null,
        securityPosture: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })) as any;

      const ws = await getWorkspaceByIdOrSlug({} as D1Database, 'alice');
      assertEquals(ws!.kind, 'user');
      // When ownerAccountId is null, owner_principal_id defaults to workspace id
      assertEquals(ws!.owner_principal_id, 'user-1');
})
    Deno.test('spaces service (Drizzle) - getWorkspaceByIdOrSlug - maps restricted_egress security posture', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
        id: 'ws-secure',
        type: 'team',
        name: 'Secure Team',
        slug: 'secure',
        description: null,
        ownerAccountId: 'user-1',
        headSnapshotId: null,
        aiModel: null,
        aiProvider: null,
        securityPosture: 'restricted_egress',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })) as any;

      const ws = await getWorkspaceByIdOrSlug({} as D1Database, 'ws-secure');
      assertEquals(ws!.security_posture, 'restricted_egress');
})  
  
    Deno.test('spaces service (Drizzle) - getWorkspaceModelSettings - returns model settings when found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
        ai_model: 'gpt-5.4-nano',
        ai_provider: 'openai',
        security_posture: 'standard',
      })) as any;

      const settings = await getWorkspaceModelSettings({} as D1Database, 'ws-1');
      assertEquals(settings, {
        ai_model: 'gpt-5.4-nano',
        ai_provider: 'openai',
        security_posture: 'standard',
      });
})
    Deno.test('spaces service (Drizzle) - getWorkspaceModelSettings - returns null when not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => null) as any;

      const settings = await getWorkspaceModelSettings({} as D1Database, 'ws-1');
      assertEquals(settings, null);
})
    Deno.test('spaces service (Drizzle) - getWorkspaceModelSettings - returns null for invalid space ID', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  const settings = await getWorkspaceModelSettings({} as D1Database, '');
      assertEquals(settings, null);
})  
  
    Deno.test('spaces service (Drizzle) - getUserByEmail - returns mapped user when found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
        id: 'user-1',
        email: 'alice@example.com',
        name: 'Alice',
        slug: 'alice',
        bio: 'Hello',
        picture: 'https://example.com/avatar.png',
        trustTier: 'standard',
        setupCompleted: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })) as any;

      const user = await getUserByEmail({} as D1Database, 'alice@example.com');
      assertNotEquals(user, null);
      assertEquals(user!.id, 'user-1');
      assertEquals(user!.email, 'alice@example.com');
      assertEquals(user!.username, 'alice');
      assertEquals(user!.principal_id, 'user-1');
      assertEquals(user!.principal_kind, 'user');
})
    Deno.test('spaces service (Drizzle) - getUserByEmail - returns null when user not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => null) as any;

      const user = await getUserByEmail({} as D1Database, 'nonexistent@example.com');
      assertEquals(user, null);
})
    Deno.test('spaces service (Drizzle) - getUserByEmail - handles null email field gracefully', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
        id: 'user-1',
        email: null,
        name: 'NoEmail',
        slug: 'noemail',
        bio: null,
        picture: null,
        trustTier: 'standard',
        setupCompleted: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })) as any;

      const user = await getUserByEmail({} as D1Database, 'test@example.com');
      assertEquals(user!.email, '');
})  
  
    Deno.test('spaces service (Drizzle) - getRepositoryById - returns mapped repository when found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
        id: 'repo-1',
        accountId: 'ws-1',
        name: 'main',
        description: 'Default repo',
        visibility: 'private',
        defaultBranch: 'main',
        forkedFromId: null,
        stars: 0,
        forks: 0,
        gitEnabled: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })) as any;

      const repo = await getRepositoryById({} as D1Database, 'repo-1');
      assertNotEquals(repo, null);
      assertEquals(repo!.id, 'repo-1');
      assertEquals(repo!.space_id, 'ws-1');
      assertEquals(repo!.name, 'main');
      assertEquals(repo!.default_branch, 'main');
      assertEquals(repo!.visibility, 'private');
})
    Deno.test('spaces service (Drizzle) - getRepositoryById - returns null when not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => null) as any;

      const repo = await getRepositoryById({} as D1Database, 'nonexistent');
      assertEquals(repo, null);
})  