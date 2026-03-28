import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '@/tools/types';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '@/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAppDeploymentService = {
  list: vi.fn(),
  get: vi.fn(),
  deployFromRepoRef: vi.fn(),
  remove: vi.fn(),
  rollback: vi.fn(),
};

vi.mock('@/services/platform/app-deployments', () => ({
  AppDeploymentService: vi.fn(() => mockAppDeploymentService),
}));

import {
  APP_DEPLOYMENT_LIST,
  APP_DEPLOYMENT_GET,
  APP_DEPLOYMENT_DEPLOY_FROM_REPO,
  APP_DEPLOYMENT_REMOVE,
  APP_DEPLOYMENT_ROLLBACK,
  WORKSPACE_APP_DEPLOYMENT_TOOLS,
  WORKSPACE_APP_DEPLOYMENT_HANDLERS,
  appDeploymentListHandler,
  appDeploymentGetHandler,
  appDeploymentDeployFromRepoHandler,
  appDeploymentRemoveHandler,
  appDeploymentRollbackHandler,
} from '@/tools/builtin/space-app-deployments';

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
// Tool definitions
// ---------------------------------------------------------------------------

describe('workspace app deployment tool definitions', () => {
  it('defines all five tools', () => {
    expect(WORKSPACE_APP_DEPLOYMENT_TOOLS).toHaveLength(5);
    const names = WORKSPACE_APP_DEPLOYMENT_TOOLS.map((t) => t.name);
    expect(names).toContain('app_deployment_list');
    expect(names).toContain('app_deployment_get');
    expect(names).toContain('app_deployment_deploy_from_repo');
    expect(names).toContain('app_deployment_remove');
    expect(names).toContain('app_deployment_rollback');
  });

  it('all tools have workspace category', () => {
    for (const def of WORKSPACE_APP_DEPLOYMENT_TOOLS) {
      expect(def.category).toBe('workspace');
    }
  });

  it('WORKSPACE_APP_DEPLOYMENT_HANDLERS maps all tools', () => {
    for (const def of WORKSPACE_APP_DEPLOYMENT_TOOLS) {
      expect(WORKSPACE_APP_DEPLOYMENT_HANDLERS).toHaveProperty(def.name);
    }
  });

  it('app_deployment_list has no required params', () => {
    expect(APP_DEPLOYMENT_LIST.parameters.required).toBeUndefined();
  });

  it('app_deployment_get requires app_deployment_id', () => {
    expect(APP_DEPLOYMENT_GET.parameters.required).toEqual(['app_deployment_id']);
  });

  it('app_deployment_deploy_from_repo requires repo_id and ref', () => {
    expect(APP_DEPLOYMENT_DEPLOY_FROM_REPO.parameters.required).toEqual(['repo_id', 'ref']);
  });

  it('app_deployment_remove requires app_deployment_id', () => {
    expect(APP_DEPLOYMENT_REMOVE.parameters.required).toEqual(['app_deployment_id']);
  });

  it('app_deployment_rollback requires app_deployment_id', () => {
    expect(APP_DEPLOYMENT_ROLLBACK.parameters.required).toEqual(['app_deployment_id']);
  });
});

// ---------------------------------------------------------------------------
// appDeploymentListHandler
// ---------------------------------------------------------------------------

describe('appDeploymentListHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a list of app deployments', async () => {
    mockAppDeploymentService.list.mockResolvedValue([
      { id: 'ad-1', name: 'My App', status: 'deployed' },
      { id: 'ad-2', name: 'Other App', status: 'pending' },
    ]);

    const result = JSON.parse(await appDeploymentListHandler({}, makeContext()));

    expect(result.app_deployments).toHaveLength(2);
    expect(result.app_deployments[0].name).toBe('My App');
  });

  it('returns empty list when no deployments', async () => {
    mockAppDeploymentService.list.mockResolvedValue([]);

    const result = JSON.parse(await appDeploymentListHandler({}, makeContext()));
    expect(result.app_deployments).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// appDeploymentGetHandler
// ---------------------------------------------------------------------------

describe('appDeploymentGetHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when app_deployment_id is empty', async () => {
    await expect(
      appDeploymentGetHandler({ app_deployment_id: '' }, makeContext()),
    ).rejects.toThrow('app_deployment_id is required');
  });

  it('throws when deployment not found', async () => {
    mockAppDeploymentService.get.mockResolvedValue(null);

    await expect(
      appDeploymentGetHandler({ app_deployment_id: 'ad-missing' }, makeContext()),
    ).rejects.toThrow('App deployment not found');
  });

  it('returns deployment details', async () => {
    mockAppDeploymentService.get.mockResolvedValue({
      id: 'ad-1',
      name: 'My App',
      status: 'deployed',
    });

    const result = JSON.parse(
      await appDeploymentGetHandler({ app_deployment_id: 'ad-1' }, makeContext()),
    );
    expect(result.app_deployment.id).toBe('ad-1');
    expect(result.app_deployment.status).toBe('deployed');
  });
});

// ---------------------------------------------------------------------------
// appDeploymentDeployFromRepoHandler
// ---------------------------------------------------------------------------

describe('appDeploymentDeployFromRepoHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when repo_id is empty', async () => {
    await expect(
      appDeploymentDeployFromRepoHandler({ repo_id: '', ref: 'main' }, makeContext()),
    ).rejects.toThrow('repo_id is required');
  });

  it('throws when ref is empty', async () => {
    await expect(
      appDeploymentDeployFromRepoHandler({ repo_id: 'r-1', ref: '' }, makeContext()),
    ).rejects.toThrow('ref is required');
  });

  it('throws when ref_type is invalid', async () => {
    await expect(
      appDeploymentDeployFromRepoHandler(
        { repo_id: 'r-1', ref: 'v1.0', ref_type: 'invalid' },
        makeContext(),
      ),
    ).rejects.toThrow('ref_type must be one of');
  });

  it('deploys from repo ref', async () => {
    mockAppDeploymentService.deployFromRepoRef.mockResolvedValue({
      deployment_id: 'd-1',
      status: 'deploying',
    });

    const result = JSON.parse(
      await appDeploymentDeployFromRepoHandler(
        { repo_id: 'r-1', ref: 'main', ref_type: 'branch' },
        makeContext(),
      ),
    );

    expect(result.success).toBe(true);
    expect(result.data.deployment_id).toBe('d-1');
    expect(mockAppDeploymentService.deployFromRepoRef).toHaveBeenCalledWith(
      'ws-test',
      'user-1',
      expect.objectContaining({
        repoId: 'r-1',
        ref: 'main',
        refType: 'branch',
      }),
    );
  });

  it('defaults ref_type to branch', async () => {
    mockAppDeploymentService.deployFromRepoRef.mockResolvedValue({ status: 'ok' });

    await appDeploymentDeployFromRepoHandler(
      { repo_id: 'r-1', ref: 'main' },
      makeContext(),
    );

    expect(mockAppDeploymentService.deployFromRepoRef).toHaveBeenCalledWith(
      'ws-test',
      'user-1',
      expect.objectContaining({ refType: 'branch' }),
    );
  });

  it('passes approval flags', async () => {
    mockAppDeploymentService.deployFromRepoRef.mockResolvedValue({ status: 'ok' });

    await appDeploymentDeployFromRepoHandler(
      {
        repo_id: 'r-1',
        ref: 'main',
        approve_oauth_auto_env: true,
        approve_source_change: true,
      },
      makeContext(),
    );

    expect(mockAppDeploymentService.deployFromRepoRef).toHaveBeenCalledWith(
      'ws-test',
      'user-1',
      expect.objectContaining({
        approveOauthAutoEnv: true,
        approveSourceChange: true,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// appDeploymentRemoveHandler
// ---------------------------------------------------------------------------

describe('appDeploymentRemoveHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when app_deployment_id is empty', async () => {
    await expect(
      appDeploymentRemoveHandler({ app_deployment_id: '' }, makeContext()),
    ).rejects.toThrow('app_deployment_id is required');
  });

  it('removes deployment and returns success', async () => {
    mockAppDeploymentService.remove.mockResolvedValue(undefined);

    const result = JSON.parse(
      await appDeploymentRemoveHandler({ app_deployment_id: 'ad-1' }, makeContext()),
    );

    expect(result.success).toBe(true);
    expect(result.app_deployment_id).toBe('ad-1');
  });
});

// ---------------------------------------------------------------------------
// appDeploymentRollbackHandler
// ---------------------------------------------------------------------------

describe('appDeploymentRollbackHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when app_deployment_id is empty', async () => {
    await expect(
      appDeploymentRollbackHandler({ app_deployment_id: '' }, makeContext()),
    ).rejects.toThrow('app_deployment_id is required');
  });

  it('performs rollback', async () => {
    mockAppDeploymentService.rollback.mockResolvedValue({
      deployment_id: 'd-rollback',
      status: 'deploying',
    });

    const result = JSON.parse(
      await appDeploymentRollbackHandler({ app_deployment_id: 'ad-1' }, makeContext()),
    );

    expect(result.success).toBe(true);
    expect(result.data.deployment_id).toBe('d-rollback');
  });

  it('passes approval flags', async () => {
    mockAppDeploymentService.rollback.mockResolvedValue({ status: 'ok' });

    await appDeploymentRollbackHandler(
      { app_deployment_id: 'ad-1', approve_oauth_auto_env: true },
      makeContext(),
    );

    expect(mockAppDeploymentService.rollback).toHaveBeenCalledWith(
      'ws-test',
      'user-1',
      'ad-1',
      { approveOauthAutoEnv: true },
    );
  });
});
