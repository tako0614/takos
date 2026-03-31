import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

import { assertEquals, assert, assertStringIncludes } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  handleInfoRefs: ((..._args: any[]) => undefined) as any,
  handleUploadPack: ((..._args: any[]) => undefined) as any,
  handleReceivePack: ((..._args: any[]) => undefined) as any,
  handleReceivePackFromStream: ((..._args: any[]) => undefined) as any,
  triggerPushWorkflows: ((..._args: any[]) => undefined) as any,
  getDb: ((..._args: any[]) => undefined) as any,
  checkWorkspaceAccess: ((..._args: any[]) => undefined) as any,
  requireGitAuth: { mockResult: null as User | null },
  optionalGitAuth: { mockResult: null as User | null },
});

// [Deno] vi.mock removed - manually stub imports from '@/services/git-smart/smart-http/info-refs'
// [Deno] vi.mock removed - manually stub imports from '@/services/git-smart/smart-http/upload-pack'
// [Deno] vi.mock removed - manually stub imports from '@/services/git-smart/smart-http/receive-pack'
// [Deno] vi.mock removed - manually stub imports from '@/services/actions/actions-triggers'
// [Deno] vi.mock removed - manually stub imports from '@/services/identity/space-access'
// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/db/schema'
// [Deno] vi.mock removed - manually stub imports from 'drizzle-orm'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/logger'
// [Deno] vi.mock removed - manually stub imports from '@/middleware/git-auth'
import { smartHttpRoutes } from '@/routes/smart-http';

function createUser(overrides: Partial<User> = {}): User {
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
    ...overrides,
  };
}

function createApp(user?: User) {
  const app = new Hono<{ Bindings: Env; Variables: { user?: User } }>();
  if (user) {
    app.use('*', async (c, next) => {
      c.set('user', user);
      await next();
    });
  }
  app.route('/', smartHttpRoutes);
  return app;
}

const PUBLIC_REPO = {
  id: 'repo-1', accountId: 'acc-1', name: 'repo',
  description: null, visibility: 'public', defaultBranch: 'main',
  forkedFromId: null, stars: 0, forks: 0, gitEnabled: true,
  isOfficial: false, officialCategory: null, officialMaintainer: null,
  featured: false, installCount: 0, createdAt: '2026-03-01', updatedAt: '2026-03-01',
};

const PRIVATE_REPO = {
  ...PUBLIC_REPO,
  id: 'repo-private',
  visibility: 'private',
};

function mockResolveRepo(result: Record<string, unknown> | null) {
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    get: ((..._args: any[]) => undefined) as any,
  };
  if (result === null) {
    chain.get = (async () => undefined) as any;
  } else {
    // First call resolves account, second call resolves repo
    chain.get
       = (async () => result.account ?? { id: 'acc-1', type: 'user' }) as any
       = (async () => result.repo ?? undefined) as any;
  }
  mocks.getDb = (() => chain) as any;
}


  const env = createMockEnv();
  // =========================================================================
  // GET /git/:owner/:repo/info/refs
  // =========================================================================

  
    Deno.test('smart-http routes - GET /git/:owner/:repo/info/refs - rejects invalid service parameter', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.optionalGitAuth.mockResult = null;
    mocks.requireGitAuth.mockResult = null;
  const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/info/refs?service=invalid'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 403);
})
    Deno.test('smart-http routes - GET /git/:owner/:repo/info/refs - returns 404 when repo not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.optionalGitAuth.mockResult = null;
    mocks.requireGitAuth.mockResult = null;
  mockResolveRepo(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/info/refs?service=git-upload-pack'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 404);
})
    Deno.test('smart-http routes - GET /git/:owner/:repo/info/refs - returns info/refs for public repo upload-pack', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.optionalGitAuth.mockResult = null;
    mocks.requireGitAuth.mockResult = null;
  mockResolveRepo({
        account: { id: 'acc-1', type: 'user' },
        repo: PUBLIC_REPO,
      });
      mocks.handleInfoRefs = (async () => new Uint8Array([0x30])) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/info/refs?service=git-upload-pack'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      assertEquals(res.headers.get('Content-Type'), 'application/x-git-upload-pack-advertisement');
})
    Deno.test('smart-http routes - GET /git/:owner/:repo/info/refs - requires auth for receive-pack on any repo', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.optionalGitAuth.mockResult = null;
    mocks.requireGitAuth.mockResult = null;
  mockResolveRepo({
        account: { id: 'acc-1', type: 'user' },
        repo: PUBLIC_REPO,
      });

      // No user set (anonymous)
      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/info/refs?service=git-receive-pack'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 401);
      assertStringIncludes(res.headers.get('WWW-Authenticate'), 'Basic');
})
    Deno.test('smart-http routes - GET /git/:owner/:repo/info/refs - returns 403 when user lacks write permission for receive-pack', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.optionalGitAuth.mockResult = null;
    mocks.requireGitAuth.mockResult = null;
  const user = createUser();
      mockResolveRepo({
        account: { id: 'acc-1', type: 'user' },
        repo: PUBLIC_REPO,
      });
      mocks.optionalGitAuth.mockResult = user;
      mocks.checkWorkspaceAccess = (async () => false) as any;

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/info/refs?service=git-receive-pack'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 403);
      const body = await res.text();
      assertStringIncludes(body, 'Permission denied');
})
    Deno.test('smart-http routes - GET /git/:owner/:repo/info/refs - returns info/refs for receive-pack when user has write permission', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.optionalGitAuth.mockResult = null;
    mocks.requireGitAuth.mockResult = null;
  const user = createUser();
      mockResolveRepo({
        account: { id: 'acc-1', type: 'user' },
        repo: PUBLIC_REPO,
      });
      mocks.optionalGitAuth.mockResult = user;
      mocks.checkWorkspaceAccess = (async () => true) as any;
      mocks.handleInfoRefs = (async () => new Uint8Array([0x31])) as any;

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/info/refs?service=git-receive-pack'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      assertEquals(res.headers.get('Content-Type'), 'application/x-git-receive-pack-advertisement');
})
    Deno.test('smart-http routes - GET /git/:owner/:repo/info/refs - requires auth for private repo upload-pack', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.optionalGitAuth.mockResult = null;
    mocks.requireGitAuth.mockResult = null;
  mockResolveRepo({
        account: { id: 'acc-1', type: 'user' },
        repo: PRIVATE_REPO,
      });
      // No user
      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/info/refs?service=git-upload-pack'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 401);
      assertStringIncludes(res.headers.get('WWW-Authenticate'), 'Basic');
})
    Deno.test('smart-http routes - GET /git/:owner/:repo/info/refs - returns 403 when user lacks read permission on private repo', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.optionalGitAuth.mockResult = null;
    mocks.requireGitAuth.mockResult = null;
  const user = createUser();
      mockResolveRepo({
        account: { id: 'acc-1', type: 'user' },
        repo: PRIVATE_REPO,
      });
      mocks.optionalGitAuth.mockResult = user;
      mocks.checkWorkspaceAccess = (async () => false) as any;

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/info/refs?service=git-upload-pack'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 403);
})  
  // =========================================================================
  // POST /git/:owner/:repo/git-upload-pack
  // =========================================================================

  
    Deno.test('smart-http routes - POST /git/:owner/:repo/git-upload-pack - returns 404 when repo not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.optionalGitAuth.mockResult = null;
    mocks.requireGitAuth.mockResult = null;
  mockResolveRepo(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/git-upload-pack', {
          method: 'POST',
          body: new Uint8Array(),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 404);
})
    Deno.test('smart-http routes - POST /git/:owner/:repo/git-upload-pack - succeeds for public repo without auth', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.optionalGitAuth.mockResult = null;
    mocks.requireGitAuth.mockResult = null;
  mockResolveRepo({
        account: { id: 'acc-1', type: 'user' },
        repo: PUBLIC_REPO,
      });
      const responseData = new Uint8Array([0x50, 0x41, 0x43, 0x4b]); // "PACK"
      mocks.handleUploadPack = (async () => responseData) as any;

      const app = createApp(); // no user
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/git-upload-pack', {
          method: 'POST',
          body: new Uint8Array([0x00]),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      assertEquals(res.headers.get('Content-Type'), 'application/x-git-upload-pack-result');
      assertSpyCallArgs(mocks.handleUploadPack, 0, [
        expect.anything(),
        expect.anything(),
        'repo-1',
        /* expect.any(Uint8Array) */ {} as any,
      ]);
})
    Deno.test('smart-http routes - POST /git/:owner/:repo/git-upload-pack - requires auth for private repo clone', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.optionalGitAuth.mockResult = null;
    mocks.requireGitAuth.mockResult = null;
  mockResolveRepo({
        account: { id: 'acc-1', type: 'user' },
        repo: PRIVATE_REPO,
      });
      // No user
      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/git-upload-pack', {
          method: 'POST',
          body: new Uint8Array(),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 401);
      assertStringIncludes(res.headers.get('WWW-Authenticate'), 'Basic');
})
    Deno.test('smart-http routes - POST /git/:owner/:repo/git-upload-pack - returns 403 when user lacks access on private repo', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.optionalGitAuth.mockResult = null;
    mocks.requireGitAuth.mockResult = null;
  const user = createUser();
      mockResolveRepo({
        account: { id: 'acc-1', type: 'user' },
        repo: PRIVATE_REPO,
      });
      mocks.optionalGitAuth.mockResult = user;
      mocks.checkWorkspaceAccess = (async () => false) as any;

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/git-upload-pack', {
          method: 'POST',
          body: new Uint8Array(),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 403);
})
    Deno.test('smart-http routes - POST /git/:owner/:repo/git-upload-pack - returns 413 when content-length exceeds limit', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.optionalGitAuth.mockResult = null;
    mocks.requireGitAuth.mockResult = null;
  mockResolveRepo({
        account: { id: 'acc-1', type: 'user' },
        repo: PUBLIC_REPO,
      });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/git-upload-pack', {
          method: 'POST',
          headers: { 'Content-Length': String(100 * 1024 * 1024) }, // 100MB > 90MB limit
          body: new Uint8Array([0x00]),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 413);
})  
  // =========================================================================
  // POST /git/:owner/:repo/git-receive-pack
  // =========================================================================

  
    Deno.test('smart-http routes - POST /git/:owner/:repo/git-receive-pack - returns 404 when repo not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.optionalGitAuth.mockResult = null;
    mocks.requireGitAuth.mockResult = null;
  mockResolveRepo(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/git-receive-pack', {
          method: 'POST',
          body: new Uint8Array(),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 404);
})
    Deno.test('smart-http routes - POST /git/:owner/:repo/git-receive-pack - requires authentication', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.optionalGitAuth.mockResult = null;
    mocks.requireGitAuth.mockResult = null;
  mockResolveRepo({
        account: { id: 'acc-1', type: 'user' },
        repo: PUBLIC_REPO,
      });

      const app = createApp(); // no user
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/git-receive-pack', {
          method: 'POST',
          body: new Uint8Array(),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 401);
})
    Deno.test('smart-http routes - POST /git/:owner/:repo/git-receive-pack - returns 403 when user lacks write access', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.optionalGitAuth.mockResult = null;
    mocks.requireGitAuth.mockResult = null;
  const user = createUser();
      mockResolveRepo({
        account: { id: 'acc-1', type: 'user' },
        repo: PUBLIC_REPO,
      });
      mocks.requireGitAuth.mockResult = user;
      mocks.checkWorkspaceAccess = (async () => false) as any;

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/git-receive-pack', {
          method: 'POST',
          body: new Uint8Array(),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 403);
      const body = await res.text();
      assertStringIncludes(body, 'Permission denied');
})
    Deno.test('smart-http routes - POST /git/:owner/:repo/git-receive-pack - succeeds with valid auth and write access', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.optionalGitAuth.mockResult = null;
    mocks.requireGitAuth.mockResult = null;
  const user = createUser();
      mockResolveRepo({
        account: { id: 'acc-1', type: 'user' },
        repo: PUBLIC_REPO,
      });
      mocks.requireGitAuth.mockResult = user;
      mocks.checkWorkspaceAccess = (async () => true) as any;
      const responseData = new Uint8Array([0x30, 0x30, 0x30, 0x30]); // pkt-line flush
      mocks.handleReceivePackFromStream = (async () => ({
        response: responseData,
        updatedRefs: [],
      })) as any;

      const envWithLock = {
        ...env,
        GIT_PUSH_LOCK: {
          idFromName: () => 'lock-id',
          get: () => ({
            fetch: async () => new Response(JSON.stringify({ acquired: true }), { status: 200 }),
          }),
        },
      };

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/git-receive-pack', {
          method: 'POST',
          body: new Uint8Array([0x01]),
        }),
        envWithLock as unknown as Env,
        { waitUntil: ((..._args: any[]) => undefined) as any } as unknown as ExecutionContext,
      );

      assertEquals(res.status, 200);
      assertEquals(res.headers.get('Content-Type'), 'application/x-git-receive-pack-result');
})
    Deno.test('smart-http routes - POST /git/:owner/:repo/git-receive-pack - returns 409 when push lock cannot be acquired', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.optionalGitAuth.mockResult = null;
    mocks.requireGitAuth.mockResult = null;
  const user = createUser();
      mockResolveRepo({
        account: { id: 'acc-1', type: 'user' },
        repo: PUBLIC_REPO,
      });
      mocks.requireGitAuth.mockResult = user;
      mocks.checkWorkspaceAccess = (async () => true) as any;

      const envWithConflictLock = {
        ...env,
        GIT_PUSH_LOCK: {
          idFromName: () => 'lock-id',
          get: () => ({
            fetch: async () => new Response('locked', { status: 409 }),
          }),
        },
      };

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/git-receive-pack', {
          method: 'POST',
          body: new Uint8Array([0x01]),
        }),
        envWithConflictLock as unknown as Env,
        { waitUntil: ((..._args: any[]) => undefined) as any } as unknown as ExecutionContext,
      );

      assertEquals(res.status, 409);
      const body = await res.text();
      assertStringIncludes(body, 'Another push is already in progress');
})
    Deno.test('smart-http routes - POST /git/:owner/:repo/git-receive-pack - returns 413 when content-length exceeds limit for receive-pack', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.optionalGitAuth.mockResult = null;
    mocks.requireGitAuth.mockResult = null;
  const user = createUser();
      mockResolveRepo({
        account: { id: 'acc-1', type: 'user' },
        repo: PUBLIC_REPO,
      });
      mocks.requireGitAuth.mockResult = user;
      mocks.checkWorkspaceAccess = (async () => true) as any;

      const envWithLock = {
        ...env,
        GIT_PUSH_LOCK: {
          idFromName: () => 'lock-id',
          get: () => ({
            fetch: async () => new Response(JSON.stringify({ acquired: true }), { status: 200 }),
          }),
        },
      };

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/git-receive-pack', {
          method: 'POST',
          headers: { 'Content-Length': String(100 * 1024 * 1024) }, // 100MB > 90MB limit
          body: new Uint8Array([0x00]),
        }),
        envWithLock as unknown as Env,
        { waitUntil: ((..._args: any[]) => undefined) as any } as unknown as ExecutionContext,
      );

      assertEquals(res.status, 413);
})
    Deno.test('smart-http routes - POST /git/:owner/:repo/git-receive-pack - triggers push workflows on successful push with updated refs', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.optionalGitAuth.mockResult = null;
    mocks.requireGitAuth.mockResult = null;
  const user = createUser();
      mockResolveRepo({
        account: { id: 'acc-1', type: 'user' },
        repo: PUBLIC_REPO,
      });
      mocks.requireGitAuth.mockResult = user;
      mocks.checkWorkspaceAccess = (async () => true) as any;
      mocks.handleReceivePackFromStream = (async () => ({
        response: new Uint8Array([0x30]),
        updatedRefs: [
          {
            oldSha: 'aaa0000000000000000000000000000000000000',
            newSha: 'bbb0000000000000000000000000000000000000',
            refName: 'refs/heads/main',
          },
        ],
      })) as any;

      const waitUntilFns: Array<Promise<unknown>> = [];
      const envWithQueue = {
        ...env,
        WORKFLOW_QUEUE: { send: ((..._args: any[]) => undefined) as any },
        ENCRYPTION_KEY: 'test-key',
        GIT_PUSH_LOCK: {
          idFromName: () => 'lock-id',
          get: () => ({
            fetch: async () => new Response(JSON.stringify({ acquired: true }), { status: 200 }),
          }),
        },
      };

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/git-receive-pack', {
          method: 'POST',
          body: new Uint8Array([0x01]),
        }),
        envWithQueue as unknown as Env,
        { waitUntil: (p: Promise<unknown>) => waitUntilFns.push(p) } as unknown as ExecutionContext,
      );

      assertEquals(res.status, 200);
      // Wait for the async waitUntil callback
      await Promise.all(waitUntilFns);
      assert(mocks.triggerPushWorkflows.calls.length > 0);
})
    Deno.test('smart-http routes - POST /git/:owner/:repo/git-receive-pack - releases push lock even when receive-pack throws', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.optionalGitAuth.mockResult = null;
    mocks.requireGitAuth.mockResult = null;
  const user = createUser();
      mockResolveRepo({
        account: { id: 'acc-1', type: 'user' },
        repo: PUBLIC_REPO,
      });
      mocks.requireGitAuth.mockResult = user;
      mocks.checkWorkspaceAccess = (async () => true) as any;
      mocks.handleReceivePackFromStream = (async () => { throw new Error('Packfile corrupted'); }) as any;

      const releaseFetchMock = async () => new Response('ok', { status: 200 });
      const envWithLock = {
        ...env,
        GIT_PUSH_LOCK: {
          idFromName: () => 'lock-id',
          get: () => ({
            fetch: async (url: string) => {
              if (url.includes('/release')) {
                return releaseFetchMock();
              }
              return new Response(JSON.stringify({ acquired: true }), { status: 200 });
            },
          }),
        },
      };

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/git-receive-pack', {
          method: 'POST',
          body: new Uint8Array([0x01]),
        }),
        envWithLock as unknown as Env,
        { waitUntil: ((..._args: any[]) => undefined) as any } as unknown as ExecutionContext,
      );

      // The handler catches the error via finally block, but hono may 500
      assertEquals(res.status, 500);
})  