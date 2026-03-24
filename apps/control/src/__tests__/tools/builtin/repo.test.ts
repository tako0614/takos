import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolContext } from '@/tools/types';
import type { D1Database } from '@takos/cloudflare-compat';
import type { Env } from '@/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSelectAll = vi.fn();
const mockSelectGet = vi.fn();
const mockUpdateWhere = vi.fn();

vi.mock('@/db', () => {
  const chain = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    get: vi.fn(() => mockSelectGet()),
    all: vi.fn(() => mockSelectAll()),
  };

  return {
    getDb: () => ({
      select: vi.fn(() => chain),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn((...args: unknown[]) => mockUpdateWhere(...args)),
        })),
      })),
    }),
    sessionRepos: {
      id: 'id',
      sessionId: 'session_id',
      repoId: 'repo_id',
      branch: 'branch',
      mountPath: 'mount_path',
      isPrimary: 'is_primary',
      createdAt: 'created_at',
    },
    sessions: {
      id: 'id',
      repoId: 'repo_id',
      branch: 'branch',
      updatedAt: 'updated_at',
    },
    repositories: {
      id: 'id',
      name: 'name',
      accountId: 'account_id',
    },
  };
});

import {
  repoListHandler,
  repoStatusHandler,
  repoSwitchHandler,
  REPO_LIST,
  REPO_STATUS,
  REPO_SWITCH,
  REPO_TOOLS,
} from '@/tools/builtin/repo';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: 'ws-test',
    threadId: 'thread-1',
    runId: 'run-1',
    userId: 'user-1',
    capabilities: ['repo.read'],
    sessionId: 'session-1',
    env: {} as Env,
    db: {} as D1Database,
    setSessionId: vi.fn(),
    getLastContainerStartFailure: vi.fn(() => undefined),
    setLastContainerStartFailure: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('repo tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('definitions', () => {
    it('REPO_LIST has correct properties', () => {
      expect(REPO_LIST.name).toBe('repo_list');
      expect(REPO_LIST.category).toBe('container');
    });

    it('REPO_STATUS has correct properties', () => {
      expect(REPO_STATUS.name).toBe('repo_status');
      expect(REPO_STATUS.category).toBe('container');
    });

    it('REPO_SWITCH requires repo_id', () => {
      expect(REPO_SWITCH.name).toBe('repo_switch');
      expect(REPO_SWITCH.parameters.required).toEqual(['repo_id']);
    });

    it('REPO_TOOLS exports all three tools', () => {
      expect(REPO_TOOLS).toHaveLength(3);
      expect(REPO_TOOLS.map(t => t.name)).toEqual(['repo_list', 'repo_status', 'repo_switch']);
    });
  });

  describe('repoListHandler', () => {
    it('throws when no container session is active', async () => {
      await expect(
        repoListHandler({}, makeContext({ sessionId: undefined })),
      ).rejects.toThrow(/container/i);
    });

    it('returns empty message when no repos mounted', async () => {
      mockSelectAll.mockResolvedValue([]);

      const result = await repoListHandler({}, makeContext());
      expect(result).toContain('No repositories are mounted');
    });

    it('lists mounted repositories', async () => {
      mockSelectAll.mockResolvedValue([
        {
          repoId: 'repo-1',
          branch: 'main',
          mountPath: '/',
          isPrimary: true,
          repoName: 'my-project',
        },
        {
          repoId: 'repo-2',
          branch: 'develop',
          mountPath: '/libs',
          isPrimary: false,
          repoName: 'lib-shared',
        },
      ]);

      const result = await repoListHandler({}, makeContext());

      expect(result).toContain('my-project');
      expect(result).toContain('repo-1');
      expect(result).toContain('[primary]');
      expect(result).toContain('lib-shared');
      expect(result).toContain('develop');
    });
  });

  describe('repoStatusHandler', () => {
    it('throws when no container session is active', async () => {
      await expect(
        repoStatusHandler({}, makeContext({ sessionId: undefined })),
      ).rejects.toThrow(/container/i);
    });

    it('returns no active repository message', async () => {
      mockSelectGet.mockResolvedValue(null);

      const result = await repoStatusHandler({}, makeContext());
      expect(result).toContain('No active repository');
    });

    it('shows the active repository', async () => {
      mockSelectGet.mockResolvedValue({
        repoId: 'repo-1',
        branch: 'main',
        mountPath: '/',
        repoName: 'my-project',
      });

      const result = await repoStatusHandler({}, makeContext());

      expect(result).toContain('Active repository');
      expect(result).toContain('my-project');
      expect(result).toContain('repo-1');
      expect(result).toContain('main');
    });
  });

  describe('repoSwitchHandler', () => {
    it('throws when no container session is active', async () => {
      await expect(
        repoSwitchHandler({ repo_id: 'repo-1' }, makeContext({ sessionId: undefined })),
      ).rejects.toThrow(/container/i);
    });

    it('throws when repo_id is missing', async () => {
      await expect(
        repoSwitchHandler({}, makeContext()),
      ).rejects.toThrow('repo_id is required');
    });

    it('throws when repo_id is not a string', async () => {
      await expect(
        repoSwitchHandler({ repo_id: 123 }, makeContext()),
      ).rejects.toThrow('repo_id is required');
    });

    it('throws when repository is not mounted', async () => {
      mockSelectGet.mockResolvedValue(null);

      await expect(
        repoSwitchHandler({ repo_id: 'repo-unknown' }, makeContext()),
      ).rejects.toThrow('not mounted');
    });

    it('switches the active repository', async () => {
      mockSelectGet.mockResolvedValue({
        id: 'sr-1',
        repoId: 'repo-2',
        branch: 'develop',
        mountPath: '/libs',
        repoName: 'lib-shared',
      });
      mockUpdateWhere.mockResolvedValue({});

      const result = await repoSwitchHandler(
        { repo_id: 'repo-2' },
        makeContext(),
      );

      expect(result).toContain('switched to');
      expect(result).toContain('lib-shared');
      expect(result).toContain('repo-2');
    });
  });
});
