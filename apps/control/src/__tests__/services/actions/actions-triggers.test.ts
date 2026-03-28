import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database, Queue, R2Bucket } from '@cloudflare/workers-types';
import type { Workflow } from 'takos-actions-engine';

const mocks = vi.hoisted(() => ({
  parseWorkflow: vi.fn(),
  resolveRef: vi.fn(),
  getCommitData: vi.fn(),
  listDirectory: vi.fn(),
  getBlobAtPath: vi.fn(),
  createWorkflowEngine: vi.fn(),
  startRun: vi.fn(),
}));

vi.mock('takos-actions-engine', async () => {
  const actual = await vi.importActual<typeof import('takos-actions-engine')>('takos-actions-engine');
  return {
    ...actual,
    parseWorkflow: mocks.parseWorkflow,
  };
});

vi.mock('@/services/git-smart', () => ({
  resolveRef: mocks.resolveRef,
  getCommitData: mocks.getCommitData,
  listDirectory: mocks.listDirectory,
  getBlobAtPath: mocks.getBlobAtPath,
  FILE_MODES: {
    DIRECTORY: '40000',
  },
}));

vi.mock('@/services/execution/workflow-engine', () => ({
  createWorkflowEngine: mocks.createWorkflowEngine,
}));

import { triggerPullRequestWorkflows } from '@/services/actions/actions-triggers';

function createQueue(): Queue<unknown> {
  return { send: vi.fn() } as unknown as Queue<unknown>;
}

function setupWorkflowMocks(): void {
  mocks.createWorkflowEngine.mockReturnValue({ startRun: mocks.startRun });
  mocks.getCommitData.mockResolvedValue({ tree: 'tree-1' });
  mocks.listDirectory.mockResolvedValue([{ name: 'ci.yml', mode: '100644' }]);
  mocks.getBlobAtPath.mockResolvedValue(new TextEncoder().encode('name: ci'));
  mocks.parseWorkflow.mockReturnValue({
    workflow: {
      on: 'pull_request',
      jobs: {
        build: {
          runsOn: 'ubuntu-latest',
          steps: [],
        },
      },
    } as unknown as Workflow,
    diagnostics: [],
  });
  mocks.startRun.mockResolvedValue({ id: 'run-1' });
}

describe('triggerPullRequestWorkflows ref resolution (issue 002)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupWorkflowMocks();
  });

  it('resolves workflow definitions from base ref and ignores head ref', async () => {
    mocks.resolveRef.mockImplementation(async (_db: D1Database, _repoId: string, ref: string) => {
      if (ref === 'main') {
        return 'sha-base-resolved';
      }
      if (ref === 'feature/head') {
        return 'sha-head-resolved';
      }
      return null;
    });

    await triggerPullRequestWorkflows({
      db: {} as D1Database,
      bucket: {} as R2Bucket,
      queue: createQueue(),
      repoId: 'repo-1',
      repoName: 'repo-name',
      defaultBranch: 'main',
      actorId: 'user-1',
      event: {
        action: 'opened',
        number: 1,
        title: 'PR',
        state: 'open',
        merged: false,
        headRef: 'feature/head',
        headSha: 'sha-head-event',
        baseRef: 'main',
        baseSha: 'sha-base-event',
      },
    });

    expect(mocks.resolveRef).toHaveBeenCalledWith(expect.anything(), 'repo-1', 'main');
    expect(mocks.resolveRef).not.toHaveBeenCalledWith(expect.anything(), 'repo-1', 'feature/head');
    expect(mocks.getCommitData).toHaveBeenCalledWith(expect.anything(), 'sha-base-event');
    expect(mocks.listDirectory).toHaveBeenCalledWith(
      expect.anything(),
      'tree-1',
      '.takos/workflows'
    );
    expect(mocks.startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: 'main',
        sha: 'sha-base-event',
      })
    );
  });

  it('falls back to default branch when base ref cannot be resolved and still ignores head ref', async () => {
    mocks.resolveRef.mockImplementation(async (_db: D1Database, _repoId: string, ref: string) => {
      if (ref === 'release') {
        return null;
      }
      if (ref === 'main') {
        return 'sha-default-resolved';
      }
      if (ref === 'feature/head') {
        return 'sha-head-resolved';
      }
      return null;
    });

    await triggerPullRequestWorkflows({
      db: {} as D1Database,
      bucket: {} as R2Bucket,
      queue: createQueue(),
      repoId: 'repo-1',
      repoName: 'repo-name',
      defaultBranch: 'main',
      actorId: 'user-1',
      event: {
        action: 'opened',
        number: 2,
        title: 'PR',
        state: 'open',
        merged: false,
        headRef: 'feature/head',
        headSha: 'sha-head-event',
        baseRef: 'release',
      },
    });

    expect(mocks.resolveRef).toHaveBeenCalledWith(expect.anything(), 'repo-1', 'release');
    expect(mocks.resolveRef).toHaveBeenCalledWith(expect.anything(), 'repo-1', 'main');
    expect(mocks.resolveRef).not.toHaveBeenCalledWith(expect.anything(), 'repo-1', 'feature/head');
    expect(mocks.getCommitData).toHaveBeenCalledWith(expect.anything(), 'sha-default-resolved');
    expect(mocks.startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: 'main',
        sha: 'sha-default-resolved',
      })
    );
  });
});

describe('triggerPullRequestWorkflows path filters (issue 006)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupWorkflowMocks();
    mocks.resolveRef.mockResolvedValue('sha-base-resolved');
  });

  it('does not run workflows with paths filter when changedFiles is missing', async () => {
    mocks.parseWorkflow.mockReturnValue({
      workflow: {
        on: {
          pull_request: {
            paths: ['src/**'],
          },
        },
        jobs: {
          build: {
            runsOn: 'ubuntu-latest',
            steps: [],
          },
        },
      } as unknown as Workflow,
      diagnostics: [],
    });

    const result = await triggerPullRequestWorkflows({
      db: {} as D1Database,
      bucket: {} as R2Bucket,
      queue: createQueue(),
      repoId: 'repo-1',
      repoName: 'repo-name',
      defaultBranch: 'main',
      actorId: 'user-1',
      event: {
        action: 'opened',
        number: 3,
        title: 'PR',
        state: 'open',
        merged: false,
        headRef: 'feature/head',
        baseRef: 'main',
      },
    });

    expect(result.triggeredRunIds).toEqual([]);
    expect(mocks.startRun).not.toHaveBeenCalled();
  });

  it('runs workflows with paths filter when changedFiles matches', async () => {
    mocks.parseWorkflow.mockReturnValue({
      workflow: {
        on: {
          pull_request: {
            paths: ['src/**'],
          },
        },
        jobs: {
          build: {
            runsOn: 'ubuntu-latest',
            steps: [],
          },
        },
      } as unknown as Workflow,
      diagnostics: [],
    });

    const result = await triggerPullRequestWorkflows({
      db: {} as D1Database,
      bucket: {} as R2Bucket,
      queue: createQueue(),
      repoId: 'repo-1',
      repoName: 'repo-name',
      defaultBranch: 'main',
      actorId: 'user-1',
      event: {
        action: 'opened',
        number: 4,
        title: 'PR',
        state: 'open',
        merged: false,
        headRef: 'feature/head',
        baseRef: 'main',
        changedFiles: ['src/web.ts'],
      },
    });

    expect(result.triggeredRunIds).toEqual(['run-1']);
    expect(mocks.startRun).toHaveBeenCalledTimes(1);
  });
});
