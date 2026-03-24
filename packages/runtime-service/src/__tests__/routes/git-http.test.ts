import { Hono } from 'hono';
import * as fs from 'fs/promises';
import path from 'path';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'child_process';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  reposBaseDir: '/tmp/takos-runtime-git-http-tests',
  spawn: vi.fn(),
  gracefulKill: vi.fn(),
}));

vi.mock('../../shared/config.js', () => ({
  REPOS_BASE_DIR: hoisted.reposBaseDir,
}));

vi.mock('child_process', () => ({
  spawn: hoisted.spawn,
}));

vi.mock('../../utils/process-kill.js', () => ({
  gracefulKill: hoisted.gracefulKill,
}));

import gitHttpRoutes from '../../routes/git/http.js';

interface MockChildProcess extends ChildProcessWithoutNullStreams {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  killed: boolean;
}

function createTestApp() {
  const app = new Hono();
  app.route('/', gitHttpRoutes);
  return app;
}

async function createRepoDir(spaceId: string, repoName: string): Promise<void> {
  await fs.mkdir(path.join(hoisted.reposBaseDir, spaceId, `${repoName}.git`), { recursive: true });
}

function createMockChildProcess(): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    return true;
  }) as ChildProcessWithoutNullStreams['kill'];
  return child;
}

describe('git-http route hardening', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useRealTimers();
    await fs.rm(hoisted.reposBaseDir, { recursive: true, force: true });
    await fs.mkdir(hoisted.reposBaseDir, { recursive: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects workspace-scoped JWT that targets another workspace', async () => {
    const app = new Hono();
    // Simulate service token middleware setting serviceToken on context
    app.use('*', async (c, next) => {
      c.set('serviceToken', { scope_space_id: 'ws-allowed' } as any);
      await next();
    });
    app.route('/', gitHttpRoutes);

    const response = await app.request('/git/ws-denied/repo.git/info/refs?service=git-upload-pack');

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'Token workspace scope does not match requested workspace',
      },
    });
  });

  it('supports LFS batch endpoint and reports missing download objects', async () => {
    const spaceId = 'ws123';
    const repoName = 'repo123';
    const oid = 'a'.repeat(64);
    await createRepoDir(spaceId, repoName);

    const app = createTestApp();

    const batchUpload = await app.request(
      `/git/${spaceId}/${repoName}.git/info/lfs/objects/batch`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/vnd.git-lfs+json',
          'Host': 'localhost',
        },
        body: JSON.stringify({
          operation: 'upload',
          objects: [{ oid, size: 12 }],
        }),
      }
    );

    expect(batchUpload.status).toBe(200);
    const uploadBody = await batchUpload.json();
    expect(uploadBody).toMatchObject({
      transfer: 'basic',
      objects: [
        {
          oid,
          actions: {
            upload: {
              href: expect.stringContaining(`/git/${spaceId}/${repoName}.git/info/lfs/objects/${oid}`),
            },
          },
        },
      ],
    });

    const batchDownload = await app.request(
      `/git/${spaceId}/${repoName}.git/info/lfs/objects/batch`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/vnd.git-lfs+json',
          'Host': 'localhost',
        },
        body: JSON.stringify({
          operation: 'download',
          objects: [{ oid, size: 12 }],
        }),
      }
    );

    expect(batchDownload.status).toBe(200);
    const downloadBody = await batchDownload.json();
    expect(downloadBody).toMatchObject({
      transfer: 'basic',
      objects: [
        {
          oid,
          error: {
            code: 404,
            message: 'Object does not exist',
          },
        },
      ],
    });
  });

  it('returns 400 for invalid oid in both LFS upload/download object handlers', async () => {
    const spaceId = 'ws-invalid-oid';
    const repoName = 'repo-invalid-oid';
    await createRepoDir(spaceId, repoName);
    const app = createTestApp();

    const invalidOid = 'not-a-valid-oid';
    const putResponse = await app.request(
      `/git/${spaceId}/${repoName}.git/info/lfs/objects/${invalidOid}`,
      { method: 'PUT' }
    );
    const getResponse = await app.request(
      `/git/${spaceId}/${repoName}.git/info/lfs/objects/${invalidOid}`
    );

    expect(putResponse.status).toBe(400);
    const putBody = await putResponse.json();
    expect(putBody).toEqual({ error: { code: 'BAD_REQUEST', message: 'Invalid LFS object id' } });
    expect(getResponse.status).toBe(400);
    const getBody = await getResponse.json();
    expect(getBody).toEqual({ error: { code: 'BAD_REQUEST', message: 'Invalid LFS object id' } });
  });

  it('keeps PUT content-length validation response', async () => {
    const app = createTestApp();

    const response = await app.request(
      `/git/ws-content-length/repo-content-length.git/info/lfs/objects/${'a'.repeat(64)}`,
      {
        method: 'PUT',
        headers: {
          'Content-Length': 'abc',
        },
      }
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: { code: 'BAD_REQUEST', message: 'Invalid Content-Length' } });
  });

  it('returns 404 for missing LFS object download', async () => {
    const spaceId = 'ws-missing-object';
    const repoName = 'repo-missing-object';
    const oid = 'b'.repeat(64);
    await createRepoDir(spaceId, repoName);

    const app = createTestApp();
    const response = await app.request(
      `/git/${spaceId}/${repoName}.git/info/lfs/objects/${oid}`
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({ error: { code: 'NOT_FOUND', message: 'LFS object not found' } });
  });
});
