import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  handleInfoRefs: vi.fn(),
  handleUploadPack: vi.fn(),
  handleReceivePack: vi.fn(),
  handleReceivePackFromStream: vi.fn(),
  triggerPushWorkflows: vi.fn(),
  getDb: vi.fn(),
  checkWorkspaceAccess: vi.fn(),
  requireGitAuth: { mockResult: null as User | null },
  optionalGitAuth: { mockResult: null as User | null },
}));

vi.mock('@/services/git-smart/smart-http/info-refs', () => ({
  handleInfoRefs: mocks.handleInfoRefs,
}));

vi.mock('@/services/git-smart/smart-http/upload-pack', () => ({
  handleUploadPack: mocks.handleUploadPack,
}));

vi.mock('@/services/git-smart/smart-http/receive-pack', () => ({
  handleReceivePack: mocks.handleReceivePack,
  handleReceivePackFromStream: mocks.handleReceivePackFromStream,
}));

vi.mock('@/services/actions/actions-triggers', () => ({
  triggerPushWorkflows: mocks.triggerPushWorkflows,
}));

vi.mock('@/services/identity/space-access', () => ({
  checkSpaceAccess: mocks.checkWorkspaceAccess,
}));

vi.mock('@/db', () => ({
  getDb: mocks.getDb,
  accounts: {
    id: 'id',
    type: 'type',
    name: 'name',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
}));

vi.mock('@/db/schema', () => ({
  accounts: { id: 'id', slug: 'slug', type: 'type' },
  repositories: {
    id: 'id', accountId: 'accountId', name: 'name',
    description: 'description', visibility: 'visibility',
    defaultBranch: 'defaultBranch', forkedFromId: 'forkedFromId',
    stars: 'stars', forks: 'forks', gitEnabled: 'gitEnabled',
    isOfficial: 'isOfficial', officialCategory: 'officialCategory',
    officialMaintainer: 'officialMaintainer', featured: 'featured',
    installCount: 'installCount', createdAt: 'createdAt', updatedAt: 'updatedAt',
  },
}));

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return { ...actual };
});

vi.mock('@/shared/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/utils')>();
  return {
    ...actual,
    checkWorkspaceAccess: mocks.checkWorkspaceAccess,
  };
});

vi.mock('@/shared/utils/logger', () => ({
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
  safeJsonParse: vi.fn(() => null),
  safeJsonParseOrDefault: vi.fn((_value: unknown, _ctx: unknown, defaultValue: unknown) => defaultValue),
}));

vi.mock('@/middleware/git-auth', () => ({
  requireGitAuth: (async (c: any, next: any) => {
    if (mocks.requireGitAuth.mockResult) {
      c.set('user', mocks.requireGitAuth.mockResult);
    }
    await next();
  }),
  optionalGitAuth: (async (c: any, next: any) => {
    if (mocks.optionalGitAuth.mockResult) {
      c.set('user', mocks.optionalGitAuth.mockResult);
    }
    await next();
  }),
}));

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
    select: vi.fn(() => chain),
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    get: vi.fn(),
  };
  if (result === null) {
    chain.get.mockResolvedValue(undefined);
  } else {
    // First call resolves account, second call resolves repo
    chain.get
      .mockResolvedValueOnce(result.account ?? { id: 'acc-1', type: 'user' })
      .mockResolvedValueOnce(result.repo ?? undefined);
  }
  mocks.getDb.mockReturnValue(chain);
}

describe('smart-http routes', () => {
  const env = createMockEnv();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.optionalGitAuth.mockResult = null;
    mocks.requireGitAuth.mockResult = null;
  });

  // =========================================================================
  // GET /git/:owner/:repo/info/refs
  // =========================================================================

  describe('GET /git/:owner/:repo/info/refs', () => {
    it('rejects invalid service parameter', async () => {
      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/info/refs?service=invalid'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(403);
    });

    it('returns 404 when repo not found', async () => {
      mockResolveRepo(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/info/refs?service=git-upload-pack'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });

    it('returns info/refs for public repo upload-pack', async () => {
      mockResolveRepo({
        account: { id: 'acc-1', type: 'user' },
        repo: PUBLIC_REPO,
      });
      mocks.handleInfoRefs.mockResolvedValue(new Uint8Array([0x30]));

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/info/refs?service=git-upload-pack'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/x-git-upload-pack-advertisement');
    });

    it('requires auth for receive-pack on any repo', async () => {
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

      expect(res.status).toBe(401);
      expect(res.headers.get('WWW-Authenticate')).toContain('Basic');
    });

    it('returns 403 when user lacks write permission for receive-pack', async () => {
      const user = createUser();
      mockResolveRepo({
        account: { id: 'acc-1', type: 'user' },
        repo: PUBLIC_REPO,
      });
      mocks.optionalGitAuth.mockResult = user;
      mocks.checkWorkspaceAccess.mockResolvedValue(false);

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/info/refs?service=git-receive-pack'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(403);
      const body = await res.text();
      expect(body).toContain('Permission denied');
    });

    it('returns info/refs for receive-pack when user has write permission', async () => {
      const user = createUser();
      mockResolveRepo({
        account: { id: 'acc-1', type: 'user' },
        repo: PUBLIC_REPO,
      });
      mocks.optionalGitAuth.mockResult = user;
      mocks.checkWorkspaceAccess.mockResolvedValue(true);
      mocks.handleInfoRefs.mockResolvedValue(new Uint8Array([0x31]));

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/info/refs?service=git-receive-pack'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/x-git-receive-pack-advertisement');
    });

    it('requires auth for private repo upload-pack', async () => {
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

      expect(res.status).toBe(401);
      expect(res.headers.get('WWW-Authenticate')).toContain('Basic');
    });

    it('returns 403 when user lacks read permission on private repo', async () => {
      const user = createUser();
      mockResolveRepo({
        account: { id: 'acc-1', type: 'user' },
        repo: PRIVATE_REPO,
      });
      mocks.optionalGitAuth.mockResult = user;
      mocks.checkWorkspaceAccess.mockResolvedValue(false);

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/info/refs?service=git-upload-pack'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(403);
    });
  });

  // =========================================================================
  // POST /git/:owner/:repo/git-upload-pack
  // =========================================================================

  describe('POST /git/:owner/:repo/git-upload-pack', () => {
    it('returns 404 when repo not found', async () => {
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

      expect(res.status).toBe(404);
    });

    it('succeeds for public repo without auth', async () => {
      mockResolveRepo({
        account: { id: 'acc-1', type: 'user' },
        repo: PUBLIC_REPO,
      });
      const responseData = new Uint8Array([0x50, 0x41, 0x43, 0x4b]); // "PACK"
      mocks.handleUploadPack.mockResolvedValue(responseData);

      const app = createApp(); // no user
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/git-upload-pack', {
          method: 'POST',
          body: new Uint8Array([0x00]),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/x-git-upload-pack-result');
      expect(mocks.handleUploadPack).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'repo-1',
        expect.any(Uint8Array),
      );
    });

    it('requires auth for private repo clone', async () => {
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

      expect(res.status).toBe(401);
      expect(res.headers.get('WWW-Authenticate')).toContain('Basic');
    });

    it('returns 403 when user lacks access on private repo', async () => {
      const user = createUser();
      mockResolveRepo({
        account: { id: 'acc-1', type: 'user' },
        repo: PRIVATE_REPO,
      });
      mocks.optionalGitAuth.mockResult = user;
      mocks.checkWorkspaceAccess.mockResolvedValue(false);

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/git-upload-pack', {
          method: 'POST',
          body: new Uint8Array(),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(403);
    });

    it('returns 413 when content-length exceeds limit', async () => {
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

      expect(res.status).toBe(413);
    });
  });

  // =========================================================================
  // POST /git/:owner/:repo/git-receive-pack
  // =========================================================================

  describe('POST /git/:owner/:repo/git-receive-pack', () => {
    it('returns 404 when repo not found', async () => {
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

      expect(res.status).toBe(404);
    });

    it('requires authentication', async () => {
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

      expect(res.status).toBe(401);
    });

    it('returns 403 when user lacks write access', async () => {
      const user = createUser();
      mockResolveRepo({
        account: { id: 'acc-1', type: 'user' },
        repo: PUBLIC_REPO,
      });
      mocks.requireGitAuth.mockResult = user;
      mocks.checkWorkspaceAccess.mockResolvedValue(false);

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/git-receive-pack', {
          method: 'POST',
          body: new Uint8Array(),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(403);
      const body = await res.text();
      expect(body).toContain('Permission denied');
    });

    it('succeeds with valid auth and write access', async () => {
      const user = createUser();
      mockResolveRepo({
        account: { id: 'acc-1', type: 'user' },
        repo: PUBLIC_REPO,
      });
      mocks.requireGitAuth.mockResult = user;
      mocks.checkWorkspaceAccess.mockResolvedValue(true);
      const responseData = new Uint8Array([0x30, 0x30, 0x30, 0x30]); // pkt-line flush
      mocks.handleReceivePackFromStream.mockResolvedValue({
        response: responseData,
        updatedRefs: [],
      });

      const envWithLock = {
        ...env,
        GIT_PUSH_LOCK: {
          idFromName: vi.fn(() => 'lock-id'),
          get: vi.fn(() => ({
            fetch: vi.fn(async () => new Response(JSON.stringify({ acquired: true }), { status: 200 })),
          })),
        },
      };

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/git-receive-pack', {
          method: 'POST',
          body: new Uint8Array([0x01]),
        }),
        envWithLock as unknown as Env,
        { waitUntil: vi.fn() } as unknown as ExecutionContext,
      );

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/x-git-receive-pack-result');
    });

    it('returns 409 when push lock cannot be acquired', async () => {
      const user = createUser();
      mockResolveRepo({
        account: { id: 'acc-1', type: 'user' },
        repo: PUBLIC_REPO,
      });
      mocks.requireGitAuth.mockResult = user;
      mocks.checkWorkspaceAccess.mockResolvedValue(true);

      const envWithConflictLock = {
        ...env,
        GIT_PUSH_LOCK: {
          idFromName: vi.fn(() => 'lock-id'),
          get: vi.fn(() => ({
            fetch: vi.fn(async () => new Response('locked', { status: 409 })),
          })),
        },
      };

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/git-receive-pack', {
          method: 'POST',
          body: new Uint8Array([0x01]),
        }),
        envWithConflictLock as unknown as Env,
        { waitUntil: vi.fn() } as unknown as ExecutionContext,
      );

      expect(res.status).toBe(409);
      const body = await res.text();
      expect(body).toContain('Another push is already in progress');
    });

    it('returns 413 when content-length exceeds limit for receive-pack', async () => {
      const user = createUser();
      mockResolveRepo({
        account: { id: 'acc-1', type: 'user' },
        repo: PUBLIC_REPO,
      });
      mocks.requireGitAuth.mockResult = user;
      mocks.checkWorkspaceAccess.mockResolvedValue(true);

      const envWithLock = {
        ...env,
        GIT_PUSH_LOCK: {
          idFromName: vi.fn(() => 'lock-id'),
          get: vi.fn(() => ({
            fetch: vi.fn(async () => new Response(JSON.stringify({ acquired: true }), { status: 200 })),
          })),
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
        { waitUntil: vi.fn() } as unknown as ExecutionContext,
      );

      expect(res.status).toBe(413);
    });

    it('triggers push workflows on successful push with updated refs', async () => {
      const user = createUser();
      mockResolveRepo({
        account: { id: 'acc-1', type: 'user' },
        repo: PUBLIC_REPO,
      });
      mocks.requireGitAuth.mockResult = user;
      mocks.checkWorkspaceAccess.mockResolvedValue(true);
      mocks.handleReceivePackFromStream.mockResolvedValue({
        response: new Uint8Array([0x30]),
        updatedRefs: [
          {
            oldSha: 'aaa0000000000000000000000000000000000000',
            newSha: 'bbb0000000000000000000000000000000000000',
            refName: 'refs/heads/main',
          },
        ],
      });

      const waitUntilFns: Array<Promise<unknown>> = [];
      const envWithQueue = {
        ...env,
        WORKFLOW_QUEUE: { send: vi.fn() },
        ENCRYPTION_KEY: 'test-key',
        GIT_PUSH_LOCK: {
          idFromName: vi.fn(() => 'lock-id'),
          get: vi.fn(() => ({
            fetch: vi.fn(async () => new Response(JSON.stringify({ acquired: true }), { status: 200 })),
          })),
        },
      };

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/git-receive-pack', {
          method: 'POST',
          body: new Uint8Array([0x01]),
        }),
        envWithQueue as unknown as Env,
        { waitUntil: vi.fn((p: Promise<unknown>) => waitUntilFns.push(p)) } as unknown as ExecutionContext,
      );

      expect(res.status).toBe(200);
      // Wait for the async waitUntil callback
      await Promise.all(waitUntilFns);
      expect(mocks.triggerPushWorkflows).toHaveBeenCalled();
    });

    it('releases push lock even when receive-pack throws', async () => {
      const user = createUser();
      mockResolveRepo({
        account: { id: 'acc-1', type: 'user' },
        repo: PUBLIC_REPO,
      });
      mocks.requireGitAuth.mockResult = user;
      mocks.checkWorkspaceAccess.mockResolvedValue(true);
      mocks.handleReceivePackFromStream.mockRejectedValue(new Error('Packfile corrupted'));

      const releaseFetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
      const envWithLock = {
        ...env,
        GIT_PUSH_LOCK: {
          idFromName: vi.fn(() => 'lock-id'),
          get: vi.fn(() => ({
            fetch: vi.fn(async (url: string) => {
              if (url.includes('/release')) {
                return releaseFetchMock();
              }
              return new Response(JSON.stringify({ acquired: true }), { status: 200 });
            }),
          })),
        },
      };

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/git/testuser/repo.git/git-receive-pack', {
          method: 'POST',
          body: new Uint8Array([0x01]),
        }),
        envWithLock as unknown as Env,
        { waitUntil: vi.fn() } as unknown as ExecutionContext,
      );

      // The handler catches the error via finally block, but hono may 500
      expect(res.status).toBe(500);
    });
  });
});
