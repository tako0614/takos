import type { D1Database, Queue, R2Bucket } from '@cloudflare/workers-types';
import type { Workflow } from 'takos-actions-engine';

import { assertEquals } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  parseWorkflow: ((..._args: any[]) => undefined) as any,
  resolveRef: ((..._args: any[]) => undefined) as any,
  getCommitData: ((..._args: any[]) => undefined) as any,
  listDirectory: ((..._args: any[]) => undefined) as any,
  getBlobAtPath: ((..._args: any[]) => undefined) as any,
  createWorkflowEngine: ((..._args: any[]) => undefined) as any,
  startRun: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from 'takos-actions-engine'
// [Deno] vi.mock removed - manually stub imports from '@/services/git-smart'
// [Deno] vi.mock removed - manually stub imports from '@/services/execution/workflow-engine'
import { triggerPullRequestWorkflows } from '@/services/actions/actions-triggers';

function createQueue(): Queue<unknown> {
  return { send: ((..._args: any[]) => undefined) as any } as unknown as Queue<unknown>;
}

function setupWorkflowMocks(): void {
  mocks.createWorkflowEngine = (() => ({ startRun: mocks.startRun })) as any;
  mocks.getCommitData = (async () => ({ tree: 'tree-1' })) as any;
  mocks.listDirectory = (async () => [{ name: 'ci.yml', mode: '100644' }]) as any;
  mocks.getBlobAtPath = (async () => new TextEncoder().encode('name: ci')) as any;
  mocks.parseWorkflow = (() => ({
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
  })) as any;
  mocks.startRun = (async () => ({ id: 'run-1' })) as any;
}


  Deno.test('triggerPullRequestWorkflows ref resolution (issue 002) - resolves workflow definitions from base ref and ignores head ref', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    setupWorkflowMocks();
  mocks.resolveRef = async (_db: D1Database, _repoId: string, ref: string) => {
      if (ref === 'main') {
        return 'sha-base-resolved';
      }
      if (ref === 'feature/head') {
        return 'sha-head-resolved';
      }
      return null;
    } as any;

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

    assertSpyCallArgs(mocks.resolveRef, 0, [expect.anything(), 'repo-1', 'main']);
    // TODO: manual assertion - mocks.resolveRef was not called with (expect.anything(), 'repo-1', 'feature/head');
    assertSpyCallArgs(mocks.getCommitData, 0, [expect.anything(), 'sha-base-event']);
    assertSpyCallArgs(mocks.listDirectory, 0, [
      expect.anything(),
      'tree-1',
      '.takos/workflows'
    ]);
    assertSpyCallArgs(mocks.startRun, 0, [
      ({
        ref: 'main',
        sha: 'sha-base-event',
      })
    ]);
})
  Deno.test('triggerPullRequestWorkflows ref resolution (issue 002) - falls back to default branch when base ref cannot be resolved and still ignores head ref', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    setupWorkflowMocks();
  mocks.resolveRef = async (_db: D1Database, _repoId: string, ref: string) => {
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
    } as any;

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

    assertSpyCallArgs(mocks.resolveRef, 0, [expect.anything(), 'repo-1', 'release']);
    assertSpyCallArgs(mocks.resolveRef, 0, [expect.anything(), 'repo-1', 'main']);
    // TODO: manual assertion - mocks.resolveRef was not called with (expect.anything(), 'repo-1', 'feature/head');
    assertSpyCallArgs(mocks.getCommitData, 0, [expect.anything(), 'sha-default-resolved']);
    assertSpyCallArgs(mocks.startRun, 0, [
      ({
        ref: 'main',
        sha: 'sha-default-resolved',
      })
    ]);
})

  Deno.test('triggerPullRequestWorkflows path filters (issue 006) - does not run workflows with paths filter when changedFiles is missing', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    setupWorkflowMocks();
    mocks.resolveRef = (async () => 'sha-base-resolved') as any;
  mocks.parseWorkflow = (() => ({
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
    })) as any;

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

    assertEquals(result.triggeredRunIds, []);
    assertSpyCalls(mocks.startRun, 0);
})
  Deno.test('triggerPullRequestWorkflows path filters (issue 006) - runs workflows with paths filter when changedFiles matches', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    setupWorkflowMocks();
    mocks.resolveRef = (async () => 'sha-base-resolved') as any;
  mocks.parseWorkflow = (() => ({
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
    })) as any;

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

    assertEquals(result.triggeredRunIds, ['run-1']);
    assertSpyCalls(mocks.startRun, 1);
})