import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockR2Bucket, MockD1Database } from '../../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  callRuntimeRequest: vi.fn(),
  resolveRef: vi.fn(),
  getCommitData: vi.fn(),
  flattenTree: vi.fn(),
  getBlob: vi.fn(),
  putBlob: vi.fn(),
  buildTreeFromPaths: vi.fn(),
  createCommit: vi.fn(),
  updateBranch: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@/services/execution/runtime', () => ({
  callRuntimeRequest: mocks.callRuntimeRequest,
}));

vi.mock('@/services/git-smart', () => ({
  resolveRef: mocks.resolveRef,
  getCommitData: mocks.getCommitData,
  flattenTree: mocks.flattenTree,
  getBlob: mocks.getBlob,
  putBlob: mocks.putBlob,
  buildTreeFromPaths: mocks.buildTreeFromPaths,
  createCommit: mocks.createCommit,
  updateBranch: mocks.updateBranch,
}));

import {
  RuntimeSessionManager,
  createRuntimeSessionManager,
} from '@/services/sync/runtime-session';

function createMockDrizzle(overrides: Record<string, unknown> = {}) {
  const chain = () => {
    const c: Record<string, unknown> = {};
    c.from = vi.fn().mockReturnValue(c);
    c.where = vi.fn().mockReturnValue(c);
    c.get = vi.fn().mockResolvedValue(null);
    c.all = vi.fn().mockResolvedValue([]);
    c.run = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
    return c;
  };

  return {
    select: vi.fn().mockImplementation(() => chain()),
    update: vi.fn().mockImplementation(() => {
      const c: Record<string, unknown> = {};
      c.set = vi.fn().mockReturnValue(c);
      c.where = vi.fn().mockReturnValue(c);
      c.run = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
      return c;
    }),
    insert: vi.fn().mockImplementation(() => {
      const c: Record<string, unknown> = {};
      c.values = vi.fn().mockReturnValue(c);
      c.run = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
      return c;
    }),
    ...overrides,
  };
}

describe('RuntimeSessionManager', () => {
  const db = new MockD1Database();
  const storage = new MockR2Bucket();
  const spaceId = 'space-1';
  const sessionId = 'session-1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('setRepositoryInfo', () => {
    it('sets repoId, branch, and repoName', () => {
      const env = { DB: db, RUNTIME_HOST: { fetch: vi.fn() } } as never;
      const mgr = createRuntimeSessionManager(env, db as never, storage as never, spaceId, sessionId);
      mgr.setRepositoryInfo('repo-1', 'main', 'my-repo');
      expect(mgr.isGitMode()).toBe(true);
    });
  });

  describe('setRepositories', () => {
    it('sets multiple repos and picks primary', () => {
      const env = { DB: db, RUNTIME_HOST: { fetch: vi.fn() } } as never;
      const mgr = createRuntimeSessionManager(env, db as never, storage as never, spaceId, sessionId);
      mgr.setRepositories([
        { repoId: 'r1', repoName: 'repo-1', branch: 'main' },
        { repoId: 'r2', repoName: 'repo-2', branch: 'dev' },
      ], 'r2');
      expect(mgr.isGitMode()).toBe(true);
    });

    it('defaults to first repo when primaryRepoId is not specified', () => {
      const env = { DB: db, RUNTIME_HOST: { fetch: vi.fn() } } as never;
      const mgr = createRuntimeSessionManager(env, db as never, storage as never, spaceId, sessionId);
      mgr.setRepositories([{ repoId: 'r1', repoName: 'repo-1' }]);
      expect(mgr.isGitMode()).toBe(true);
    });
  });

  describe('isGitMode', () => {
    it('returns false when no repo is set', () => {
      const env = { DB: db, RUNTIME_HOST: { fetch: vi.fn() } } as never;
      const mgr = createRuntimeSessionManager(env, db as never, storage as never, spaceId, sessionId);
      expect(mgr.isGitMode()).toBe(false);
    });
  });

  describe('initSession', () => {
    it('throws when session is not found and skipDbLock is false', async () => {
      const drizzle = createMockDrizzle();
      // session select returns null (not found)
      mocks.getDb.mockReturnValue(drizzle);

      const env = { DB: db, RUNTIME_HOST: { fetch: vi.fn() }, GIT_OBJECTS: storage } as never;
      const mgr = createRuntimeSessionManager(env, db as never, storage as never, spaceId, sessionId);
      mgr.setRepositoryInfo('repo-1', 'main');

      await expect(mgr.initSession()).rejects.toThrow('Session not found');
    });

    it('throws when session is already running', async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({ status: 'running' }),
      };
      const drizzle = createMockDrizzle();
      drizzle.select = vi.fn().mockReturnValue(selectChain);
      mocks.getDb.mockReturnValue(drizzle);

      const env = { DB: db, RUNTIME_HOST: { fetch: vi.fn() }, GIT_OBJECTS: storage } as never;
      const mgr = createRuntimeSessionManager(env, db as never, storage as never, spaceId, sessionId);
      mgr.setRepositoryInfo('repo-1', 'main');

      await expect(mgr.initSession()).rejects.toThrow('Session is already initialized');
    });

    it('throws when repo_id is not set and skipDbLock is true', async () => {
      const env = { DB: db, RUNTIME_HOST: { fetch: vi.fn() }, GIT_OBJECTS: storage } as never;
      const mgr = createRuntimeSessionManager(env, db as never, storage as never, spaceId, sessionId);
      // No repo set

      await expect(mgr.initSession({ skipDbLock: true })).rejects.toThrow(
        'repo_id is required',
      );
    });
  });

  describe('cloneRepository', () => {
    it('returns clone result from runtime', async () => {
      mocks.callRuntimeRequest.mockResolvedValue(
        new Response(JSON.stringify({ success: true, targetDir: '/tmp/repo', branch: 'main' }), { status: 200 }),
      );

      const env = { DB: db, RUNTIME_HOST: { fetch: vi.fn() }, GIT_OBJECTS: storage } as never;
      const mgr = createRuntimeSessionManager(env, db as never, storage as never, spaceId, sessionId);
      const result = await mgr.cloneRepository('my-repo', 'main', '/tmp/repo');

      expect(result.success).toBe(true);
      expect(result.branch).toBe('main');
    });

    it('returns error on failed response', async () => {
      mocks.callRuntimeRequest.mockResolvedValue(
        new Response(JSON.stringify({ error: 'clone failed' }), { status: 500 }),
      );

      const env = { DB: db, RUNTIME_HOST: { fetch: vi.fn() }, GIT_OBJECTS: storage } as never;
      const mgr = createRuntimeSessionManager(env, db as never, storage as never, spaceId, sessionId);
      const result = await mgr.cloneRepository('my-repo', 'main', '/tmp/repo');

      expect(result.success).toBe(false);
      expect(result.error).toBe('clone failed');
    });
  });

  describe('commitChanges', () => {
    it('returns commit result from runtime', async () => {
      mocks.callRuntimeRequest.mockResolvedValue(
        new Response(JSON.stringify({ success: true, committed: true, commitHash: 'abc123' }), { status: 200 }),
      );

      const env = { DB: db, RUNTIME_HOST: { fetch: vi.fn() } } as never;
      const mgr = createRuntimeSessionManager(env, db as never, storage as never, spaceId, sessionId);
      const result = await mgr.commitChanges('/tmp/repo', 'test commit');

      expect(result.success).toBe(true);
      expect(result.commitHash).toBe('abc123');
    });
  });

  describe('pushChanges', () => {
    it('returns push result from runtime', async () => {
      mocks.callRuntimeRequest.mockResolvedValue(
        new Response(JSON.stringify({ success: true, branch: 'main' }), { status: 200 }),
      );

      const env = { DB: db, RUNTIME_HOST: { fetch: vi.fn() } } as never;
      const mgr = createRuntimeSessionManager(env, db as never, storage as never, spaceId, sessionId);
      const result = await mgr.pushChanges('/tmp/repo', 'main');

      expect(result.success).toBe(true);
      expect(result.branch).toBe('main');
    });

    it('returns error on failure', async () => {
      mocks.callRuntimeRequest.mockResolvedValue(
        new Response(JSON.stringify({ error: 'push failed' }), { status: 500 }),
      );

      const env = { DB: db, RUNTIME_HOST: { fetch: vi.fn() } } as never;
      const mgr = createRuntimeSessionManager(env, db as never, storage as never, spaceId, sessionId);
      const result = await mgr.pushChanges('/tmp/repo');

      expect(result.success).toBe(false);
      expect(result.branch).toBe('unknown');
    });
  });

  describe('getWorkDir', () => {
    it('returns session directory path on success', async () => {
      mocks.callRuntimeRequest.mockResolvedValue(new Response('{}', { status: 200 }));

      const env = { DB: db, RUNTIME_HOST: { fetch: vi.fn() } } as never;
      const mgr = createRuntimeSessionManager(env, db as never, storage as never, spaceId, sessionId);
      const dir = await mgr.getWorkDir();

      expect(dir).toBe(`/tmp/takos-session-${sessionId}`);
    });

    it('returns null on failed response', async () => {
      mocks.callRuntimeRequest.mockResolvedValue(new Response('error', { status: 500 }));

      const env = { DB: db, RUNTIME_HOST: { fetch: vi.fn() } } as never;
      const mgr = createRuntimeSessionManager(env, db as never, storage as never, spaceId, sessionId);
      const dir = await mgr.getWorkDir();

      expect(dir).toBeNull();
    });
  });

  describe('syncToGit', () => {
    it('returns error when no repoId is set', async () => {
      const env = { DB: db, RUNTIME_HOST: { fetch: vi.fn() } } as never;
      const mgr = createRuntimeSessionManager(env, db as never, storage as never, spaceId, sessionId);
      // no repo set
      const result = await mgr.syncToGit();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Repository ID not set');
    });
  });

  describe('syncSnapshotToRepo', () => {
    it('returns error when storage bucket is not configured', async () => {
      const env = { DB: db, RUNTIME_HOST: { fetch: vi.fn() } } as never;
      const mgr = createRuntimeSessionManager(env, db as never, undefined, spaceId, sessionId);

      const result = await mgr.syncSnapshotToRepo(
        { files: [{ path: 'a.txt', content: 'hi', size: 2 }], file_count: 1 },
        { repoId: 'repo-1', message: 'test' },
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('R2 storage bucket not configured');
    });

    it('returns error when repoId is empty', async () => {
      const env = { DB: db, RUNTIME_HOST: { fetch: vi.fn() }, GIT_OBJECTS: storage } as never;
      const mgr = createRuntimeSessionManager(env, db as never, storage as never, spaceId, sessionId);

      const result = await mgr.syncSnapshotToRepo(
        { files: [], file_count: 0 },
        { repoId: '', message: 'test' },
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe('Repository ID not set');
    });

    it('returns success with committed=false when no files after filtering', async () => {
      mocks.resolveRef.mockResolvedValue(null);
      const env = { DB: db, RUNTIME_HOST: { fetch: vi.fn() }, GIT_OBJECTS: storage } as never;
      const mgr = createRuntimeSessionManager(env, db as never, storage as never, spaceId, sessionId);

      const result = await mgr.syncSnapshotToRepo(
        { files: [{ path: '.takos-session', content: 'x', size: 1 }], file_count: 1 },
        { repoId: 'repo-1', message: 'test' },
      );
      expect(result.success).toBe(true);
      expect(result.committed).toBe(false);
    });
  });

  describe('destroySession', () => {
    it('calls runtime destroy endpoint without throwing', async () => {
      mocks.callRuntimeRequest.mockResolvedValue(new Response('ok', { status: 200 }));

      const env = { DB: db, RUNTIME_HOST: { fetch: vi.fn() } } as never;
      const mgr = createRuntimeSessionManager(env, db as never, storage as never, spaceId, sessionId);
      await mgr.destroySession();

      expect(mocks.callRuntimeRequest).toHaveBeenCalledTimes(1);
    });

    it('does not throw when runtime call fails', async () => {
      mocks.callRuntimeRequest.mockRejectedValue(new Error('network error'));

      const env = { DB: db, RUNTIME_HOST: { fetch: vi.fn() } } as never;
      const mgr = createRuntimeSessionManager(env, db as never, storage as never, spaceId, sessionId);

      // Should not throw
      await mgr.destroySession();
    });
  });
});

describe('createRuntimeSessionManager', () => {
  it('creates a RuntimeSessionManager instance', () => {
    const db = new MockD1Database();
    const storage = new MockR2Bucket();
    const env = { DB: db, RUNTIME_HOST: { fetch: vi.fn() } } as never;
    const mgr = createRuntimeSessionManager(env, db as never, storage as never, 'sp', 'sess');
    expect(mgr).toBeInstanceOf(RuntimeSessionManager);
  });
});
