import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

import {
  buildWorkflowArtifactPrefix,
  listWorkflowArtifactsForRun,
  getWorkflowArtifactById,
  deleteWorkflowArtifactById,
  resolveWorkflowArtifactFileForJob,
} from '@/services/platform/workflow-artifacts';

function createDrizzleMock() {
  const getMock = vi.fn();
  const allMock = vi.fn();
  const runMock = vi.fn();
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    get: getMock,
    all: allMock,
    run: runMock,
  };
  return {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    _: { get: getMock, all: allMock, run: runMock },
  };
}

describe('buildWorkflowArtifactPrefix', () => {
  it('builds correct prefix from job and artifact name', () => {
    const prefix = buildWorkflowArtifactPrefix('job-1', 'dist');
    expect(prefix).toBe('actions/artifacts/job-1/dist/');
  });
});

describe('listWorkflowArtifactsForRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when run not found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(undefined);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await listWorkflowArtifactsForRun({ DB: {} } as any, 'repo-1', 'run-nonexistent');
    expect(result).toBeNull();
  });

  it('returns artifacts for valid run', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce({ id: 'run-1' }); // run found
    drizzle._.all.mockResolvedValueOnce([
      { id: 'a1', runId: 'run-1', name: 'dist', r2Key: 'artifacts/a1', sizeBytes: 500, mimeType: null, expiresAt: null, createdAt: '2026-01-01' },
    ]);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await listWorkflowArtifactsForRun({ DB: {} } as any, 'repo-1', 'run-1');
    expect(result).toHaveLength(1);
    expect(result![0].name).toBe('dist');
  });
});

describe('getWorkflowArtifactById', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when not found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(undefined);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await getWorkflowArtifactById({ DB: {} } as any, 'repo-1', 'a-nonexistent');
    expect(result).toBeNull();
  });

  it('returns artifact with run info when found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce({
      id: 'a1',
      runId: 'run-1',
      name: 'dist',
      r2Key: 'artifacts/a1',
      sizeBytes: 500,
      mimeType: 'application/zip',
      expiresAt: null,
      createdAt: '2026-01-01',
      repoId: 'repo-1',
    });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await getWorkflowArtifactById({ DB: {} } as any, 'repo-1', 'a1');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('a1');
    expect(result!.workflowRun.repoId).toBe('repo-1');
  });
});

describe('deleteWorkflowArtifactById', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when artifact not found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(undefined);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await deleteWorkflowArtifactById({ DB: {} } as any, null, 'repo-1', 'a-nonexistent');
    expect(result).toBeNull();
  });

  it('deletes from R2 and DB', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce({
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
    });
    mocks.getDb.mockReturnValue(drizzle);

    const bucketDelete = vi.fn().mockResolvedValue(undefined);
    const bucket = { delete: bucketDelete } as any;

    const result = await deleteWorkflowArtifactById({ DB: {} } as any, bucket, 'repo-1', 'a1');
    expect(result).not.toBeNull();
    expect(bucketDelete).toHaveBeenCalledWith('artifacts/a1');
    expect(drizzle.delete).toHaveBeenCalled();
  });
});

describe('resolveWorkflowArtifactFileForJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when artifact path is empty', async () => {
    const drizzle = createDrizzleMock();
    mocks.getDb.mockReturnValue(drizzle);

    await expect(
      resolveWorkflowArtifactFileForJob(
        { DB: {}, GIT_OBJECTS: null, TENANT_SOURCE: null } as any,
        { repoId: 'r1', runId: 'run-1', jobId: 'job-1', artifactName: 'dist', artifactPath: '' },
      ),
    ).rejects.toThrow('artifact path is required');
  });

  it('resolves from inventory when available', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce({
      runId: 'run-1',
      name: 'dist',
      r2Key: 'actions/artifacts/job-1/dist',
      expiresAt: null,
    });
    mocks.getDb.mockReturnValue(drizzle);

    const bucketGet = vi.fn().mockResolvedValue({ body: 'content' });
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

    expect(result.source).toBe('inventory');
    expect(result.artifactPath).toBe('worker.mjs');
  });

  it('falls back to prefix when inventory has no object', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(null); // no inventory artifact
    mocks.getDb.mockReturnValue(drizzle);

    const bucketGet = vi.fn().mockImplementation(async (key: string) => {
      if (key === 'actions/artifacts/job-1/dist/worker.mjs') {
        return { body: 'content' };
      }
      return null;
    });
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

    expect(result.source).toBe('prefix-fallback');
  });

  it('throws when artifact file not found anywhere', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(null);
    mocks.getDb.mockReturnValue(drizzle);

    const bucketGet = vi.fn().mockResolvedValue(null);
    const env = {
      DB: {},
      GIT_OBJECTS: { get: bucketGet },
      TENANT_SOURCE: { get: vi.fn().mockResolvedValue(null) },
    } as any;

    await expect(
      resolveWorkflowArtifactFileForJob(env, {
        repoId: 'r1',
        runId: 'run-1',
        jobId: 'job-1',
        artifactName: 'dist',
        artifactPath: 'missing.mjs',
      }),
    ).rejects.toThrow('Workflow artifact file not found');
  });
});
