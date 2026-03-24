import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolContext } from '@/tools/types';
import type { D1Database } from '@takos/cloudflare-compat';
import type { Env } from '@/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockListWorkspaceCommonEnv = vi.fn();
const mockUpsertWorkspaceCommonEnv = vi.fn();
const mockDeleteWorkspaceCommonEnv = vi.fn();
const mockReconcileWorkersForEnvKey = vi.fn();

vi.mock('@/services/common-env', () => ({
  createCommonEnvService: () => ({
    listWorkspaceCommonEnv: mockListWorkspaceCommonEnv,
    upsertWorkspaceCommonEnv: mockUpsertWorkspaceCommonEnv,
    deleteWorkspaceCommonEnv: mockDeleteWorkspaceCommonEnv,
    reconcileWorkersForEnvKey: mockReconcileWorkersForEnvKey,
  }),
}));

import {
  workspaceEnvListHandler,
  workspaceEnvSetHandler,
  workspaceEnvDeleteHandler,
  WORKSPACE_ENV_LIST,
  WORKSPACE_ENV_SET,
  WORKSPACE_ENV_DELETE,
  WORKSPACE_COMMON_ENV_TOOLS,
} from '@/tools/builtin/workspace-common-env';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: 'ws-test',
    threadId: 'thread-1',
    runId: 'run-1',
    userId: 'user-1',
    capabilities: [],
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

describe('workspace common env tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('definitions', () => {
    it('WORKSPACE_ENV_LIST has correct name', () => {
      expect(WORKSPACE_ENV_LIST.name).toBe('workspace_env_list');
      expect(WORKSPACE_ENV_LIST.category).toBe('workspace');
    });

    it('WORKSPACE_ENV_SET requires name and value', () => {
      expect(WORKSPACE_ENV_SET.name).toBe('workspace_env_set');
      expect(WORKSPACE_ENV_SET.parameters.required).toEqual(['name', 'value']);
    });

    it('WORKSPACE_ENV_DELETE requires name', () => {
      expect(WORKSPACE_ENV_DELETE.name).toBe('workspace_env_delete');
      expect(WORKSPACE_ENV_DELETE.parameters.required).toEqual(['name']);
    });

    it('exports all three tools', () => {
      expect(WORKSPACE_COMMON_ENV_TOOLS).toHaveLength(3);
      expect(WORKSPACE_COMMON_ENV_TOOLS.map(t => t.name)).toEqual([
        'workspace_env_list',
        'workspace_env_set',
        'workspace_env_delete',
      ]);
    });
  });

  describe('workspaceEnvListHandler', () => {
    it('returns list of environment variables', async () => {
      mockListWorkspaceCommonEnv.mockResolvedValue([
        { name: 'API_KEY', value: '***', secret: true },
        { name: 'NODE_ENV', value: 'production', secret: false },
      ]);

      const result = JSON.parse(await workspaceEnvListHandler({}, makeContext()));

      expect(result.count).toBe(2);
      expect(result.env).toHaveLength(2);
      expect(result.env[0].name).toBe('API_KEY');
    });

    it('returns empty list', async () => {
      mockListWorkspaceCommonEnv.mockResolvedValue([]);

      const result = JSON.parse(await workspaceEnvListHandler({}, makeContext()));
      expect(result.count).toBe(0);
      expect(result.env).toEqual([]);
    });
  });

  describe('workspaceEnvSetHandler', () => {
    it('creates an environment variable', async () => {
      mockUpsertWorkspaceCommonEnv.mockResolvedValue(undefined);
      mockReconcileWorkersForEnvKey.mockResolvedValue(undefined);

      const result = JSON.parse(
        await workspaceEnvSetHandler(
          { name: 'MY_VAR', value: 'my_value' },
          makeContext(),
        ),
      );

      expect(result.success).toBe(true);
      expect(result.name).toBe('MY_VAR');
      expect(result.secret).toBe(false);
    });

    it('creates a secret environment variable', async () => {
      mockUpsertWorkspaceCommonEnv.mockResolvedValue(undefined);
      mockReconcileWorkersForEnvKey.mockResolvedValue(undefined);

      const result = JSON.parse(
        await workspaceEnvSetHandler(
          { name: 'API_KEY', value: 'secret123', secret: true },
          makeContext(),
        ),
      );

      expect(result.success).toBe(true);
      expect(result.secret).toBe(true);
    });

    it('throws when name is empty', async () => {
      await expect(
        workspaceEnvSetHandler({ name: '', value: 'val' }, makeContext()),
      ).rejects.toThrow('name is required');
    });

    it('throws when name is whitespace only', async () => {
      await expect(
        workspaceEnvSetHandler({ name: '   ', value: 'val' }, makeContext()),
      ).rejects.toThrow('name is required');
    });

    it('reconciles workers after setting env', async () => {
      mockUpsertWorkspaceCommonEnv.mockResolvedValue(undefined);
      mockReconcileWorkersForEnvKey.mockResolvedValue(undefined);

      await workspaceEnvSetHandler(
        { name: 'MY_VAR', value: 'val' },
        makeContext(),
      );

      expect(mockReconcileWorkersForEnvKey).toHaveBeenCalledWith(
        'ws-test',
        'MY_VAR',
        'workspace_env_put',
      );
    });
  });

  describe('workspaceEnvDeleteHandler', () => {
    it('deletes an environment variable', async () => {
      mockDeleteWorkspaceCommonEnv.mockResolvedValue(true);
      mockReconcileWorkersForEnvKey.mockResolvedValue(undefined);

      const result = JSON.parse(
        await workspaceEnvDeleteHandler({ name: 'MY_VAR' }, makeContext()),
      );

      expect(result.success).toBe(true);
      expect(result.name).toBe('MY_VAR');
    });

    it('throws when name is empty', async () => {
      await expect(
        workspaceEnvDeleteHandler({ name: '' }, makeContext()),
      ).rejects.toThrow('name is required');
    });

    it('throws when variable not found', async () => {
      mockDeleteWorkspaceCommonEnv.mockResolvedValue(false);

      await expect(
        workspaceEnvDeleteHandler({ name: 'MISSING' }, makeContext()),
      ).rejects.toThrow('Environment variable not found: MISSING');
    });

    it('reconciles workers after deletion', async () => {
      mockDeleteWorkspaceCommonEnv.mockResolvedValue(true);
      mockReconcileWorkersForEnvKey.mockResolvedValue(undefined);

      await workspaceEnvDeleteHandler({ name: 'MY_VAR' }, makeContext());

      expect(mockReconcileWorkersForEnvKey).toHaveBeenCalledWith(
        'ws-test',
        'MY_VAR',
        'workspace_env_delete',
      );
    });
  });
});
