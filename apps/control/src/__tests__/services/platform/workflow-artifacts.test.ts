import { assertEquals, assertNotEquals, assert, assertRejects } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
import {
  buildWorkflowArtifactPrefix,
  listWorkflowArtifactsForRun,
  getWorkflowArtifactById,
  deleteWorkflowArtifactById,
  resolveWorkflowArtifactFileForJob,
} from '@/services/platform/workflow-artifacts';

function createDrizzleMock() {
  const getMock = ((..._args: any[]) => undefined) as any;
  const allMock = ((..._args: any[]) => undefined) as any;
  const runMock = ((..._args: any[]) => undefined) as any;
  const chain = {
    from: (function(this: any) { return this; }),
    where: (function(this: any) { return this; }),
    set: (function(this: any) { return this; }),
    values: (function(this: any) { return this; }),
    innerJoin: (function(this: any) { return this; }),
    orderBy: (function(this: any) { return this; }),
    limit: (function(this: any) { return this; }),
    get: getMock,
    all: allMock,
    run: runMock,
  };
  return {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    _: { get: getMock, all: allMock, run: runMock },
  };
}


  Deno.test('buildWorkflowArtifactPrefix - builds correct prefix from job and artifact name', () => {
  const prefix = buildWorkflowArtifactPrefix('job-1', 'dist');
    assertEquals(prefix, 'actions/artifacts/job-1/dist/');
})

  Deno.test('listWorkflowArtifactsForRun - returns null when run not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => undefined) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await listWorkflowArtifactsForRun({ DB: {} } as any, 'repo-1', 'run-nonexistent');
    assertEquals(result, null);
})
  Deno.test('listWorkflowArtifactsForRun - returns artifacts for valid run', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => ({ id: 'run-1' })) as any; // run found
    drizzle._.all = (async () => [
      { id: 'a1', runId: 'run-1', name: 'dist', r2Key: 'artifacts/a1', sizeBytes: 500, mimeType: null, expiresAt: null, createdAt: '2026-01-01' },
    ]) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await listWorkflowArtifactsForRun({ DB: {} } as any, 'repo-1', 'run-1');
    assertEquals(result.length, 1);
    assertEquals(result![0].name, 'dist');
})

  Deno.test('getWorkflowArtifactById - returns null when not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => undefined) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await getWorkflowArtifactById({ DB: {} } as any, 'repo-1', 'a-nonexistent');
    assertEquals(result, null);
})
  Deno.test('getWorkflowArtifactById - returns artifact with run info when found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => ({
      id: 'a1',
      runId: 'run-1',
      name: 'dist',
      r2Key: 'artifacts/a1',
      sizeBytes: 500,
      mimeType: 'application/zip',
      expiresAt: null,
      createdAt: '2026-01-01',
      repoId: 'repo-1',
    })) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await getWorkflowArtifactById({ DB: {} } as any, 'repo-1', 'a1');
    assertNotEquals(result, null);
    assertEquals(result!.id, 'a1');
    assertEquals(result!.workflowRun.repoId, 'repo-1');
})

  Deno.test('deleteWorkflowArtifactById - returns null when artifact not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => undefined) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await deleteWorkflowArtifactById({ DB: {} } as any, null, 'repo-1', 'a-nonexistent');
    assertEquals(result, null);
})
  Deno.test('deleteWorkflowArtifactById - deletes from R2 and DB', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => ({
      id: 'a1',
      runId: 'run-1',
      name: 'dist',
      r2Key: 'artifacts/a1',
      sizeBytes: 500,
      mimeType: null,
      expiresAt: null,
      createdAt: '2026-01-01',
      repoId: 'repo-1',
      workflowRun: { repoId: 'repo-1' },
    })) as any;
    mocks.getDb = (() => drizzle) as any;

    const bucketDelete = (async () => undefined);
    const bucket = { delete: bucketDelete } as any;

    const result = await deleteWorkflowArtifactById({ DB: {} } as any, bucket, 'repo-1', 'a1');
    assertNotEquals(result, null);
    assertSpyCallArgs(bucketDelete, 0, ['artifacts/a1']);
    assert(drizzle.delete.calls.length > 0);
})

  Deno.test('resolveWorkflowArtifactFileForJob - throws when artifact path is empty', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    mocks.getDb = (() => drizzle) as any;

    await await assertRejects(async () => { await 
      resolveWorkflowArtifactFileForJob(
        { DB: {}, GIT_OBJECTS: null, TENANT_SOURCE: null } as any,
        { repoId: 'r1', runId: 'run-1', jobId: 'job-1', artifactName: 'dist', artifactPath: '' },
      ),
    ; }, 'artifact path is required');
})
  Deno.test('resolveWorkflowArtifactFileForJob - resolves from inventory when available', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => ({
      runId: 'run-1',
      name: 'dist',
      r2Key: 'actions/artifacts/job-1/dist',
      expiresAt: null,
    })) as any;
    mocks.getDb = (() => drizzle) as any;

    const bucketGet = (async () => ({ body: 'content' }));
    const env = {
      DB: {},
      GIT_OBJECTS: { get: bucketGet },
      TENANT_SOURCE: null,
    } as any;

    const result = await resolveWorkflowArtifactFileForJob(env, {
      repoId: 'r1',
      runId: 'run-1',
      jobId: 'job-1',
      artifactName: 'dist',
      artifactPath: 'worker.mjs',
    });

    assertEquals(result.source, 'inventory');
    assertEquals(result.artifactPath, 'worker.mjs');
})
  Deno.test('resolveWorkflowArtifactFileForJob - falls back to prefix when inventory has no object', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => null) as any; // no inventory artifact
    mocks.getDb = (() => drizzle) as any;

    const bucketGet = async (key: string) => {
      if (key === 'actions/artifacts/job-1/dist/worker.mjs') {
        return { body: 'content' };
      }
      return null;
    };
    const env = {
      DB: {},
      GIT_OBJECTS: { get: bucketGet },
      TENANT_SOURCE: null,
    } as any;

    const result = await resolveWorkflowArtifactFileForJob(env, {
      repoId: 'r1',
      runId: 'run-1',
      jobId: 'job-1',
      artifactName: 'dist',
      artifactPath: 'worker.mjs',
    });

    assertEquals(result.source, 'prefix-fallback');
})
  Deno.test('resolveWorkflowArtifactFileForJob - throws when artifact file not found anywhere', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => null) as any;
    mocks.getDb = (() => drizzle) as any;

    const bucketGet = (async () => null);
    const env = {
      DB: {},
      GIT_OBJECTS: { get: bucketGet },
      TENANT_SOURCE: { get: (async () => null) },
    } as any;

    await await assertRejects(async () => { await 
      resolveWorkflowArtifactFileForJob(env, {
        repoId: 'r1',
        runId: 'run-1',
        jobId: 'job-1',
        artifactName: 'dist',
        artifactPath: 'missing.mjs',
      }),
    ; }, 'Workflow artifact file not found');
})