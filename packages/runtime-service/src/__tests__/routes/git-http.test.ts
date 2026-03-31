import { Hono } from 'hono';
import * as fs from 'fs/promises';
import path from 'path';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'child_process';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { assertEquals, assertObjectMatch } from 'jsr:@std/assert';

const hoisted = ({
  reposBaseDir: '/tmp/takos-runtime-git-http-tests',
  spawn: ((..._args: any[]) => undefined) as any,
  gracefulKill: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '../../shared/config.ts'
// [Deno] vi.mock removed - manually stub imports from 'child_process'
// [Deno] vi.mock removed - manually stub imports from '../../utils/process-kill.ts'
import gitHttpRoutes from '../../routes/git/http.ts';

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
  child.kill = () => {
    child.killed = true;
    return true;
  } as ChildProcessWithoutNullStreams['kill'];
  return child;
}


  Deno.test('git-http route hardening - rejects workspace-scoped JWT that targets another workspace', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    /* TODO: call fakeTime.restore() */ void 0;
    await fs.rm(hoisted.reposBaseDir, { recursive: true, force: true });
    await fs.mkdir(hoisted.reposBaseDir, { recursive: true });
  try {
  const app = new Hono();
    // Simulate service token middleware setting serviceToken on context
    app.use('*', async (c, next) => {
      c.set('serviceToken', { scope_space_id: 'ws-allowed' } as any);
      await next();
    });
    app.route('/', gitHttpRoutes);

    const response = await app.request('/git/ws-denied/repo.git/info/refs?service=git-upload-pack');

    assertEquals(response.status, 403);
    const body = await response.json();
    assertEquals(body, {
      error: {
        code: 'FORBIDDEN',
        message: 'Token workspace scope does not match requested workspace',
      },
    });
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
  }
})
  Deno.test('git-http route hardening - supports LFS batch endpoint and reports missing download objects', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    /* TODO: call fakeTime.restore() */ void 0;
    await fs.rm(hoisted.reposBaseDir, { recursive: true, force: true });
    await fs.mkdir(hoisted.reposBaseDir, { recursive: true });
  try {
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

    assertEquals(batchUpload.status, 200);
    const uploadBody = await batchUpload.json();
    assertObjectMatch(uploadBody, {
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

    assertEquals(batchDownload.status, 200);
    const downloadBody = await batchDownload.json();
    assertObjectMatch(downloadBody, {
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
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
  }
})
  Deno.test('git-http route hardening - returns 400 for invalid oid in both LFS upload/download object handlers', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    /* TODO: call fakeTime.restore() */ void 0;
    await fs.rm(hoisted.reposBaseDir, { recursive: true, force: true });
    await fs.mkdir(hoisted.reposBaseDir, { recursive: true });
  try {
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

    assertEquals(putResponse.status, 400);
    const putBody = await putResponse.json();
    assertEquals(putBody, { error: { code: 'BAD_REQUEST', message: 'Invalid LFS object id' } });
    assertEquals(getResponse.status, 400);
    const getBody = await getResponse.json();
    assertEquals(getBody, { error: { code: 'BAD_REQUEST', message: 'Invalid LFS object id' } });
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
  }
})
  Deno.test('git-http route hardening - keeps PUT content-length validation response', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    /* TODO: call fakeTime.restore() */ void 0;
    await fs.rm(hoisted.reposBaseDir, { recursive: true, force: true });
    await fs.mkdir(hoisted.reposBaseDir, { recursive: true });
  try {
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

    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body, { error: { code: 'BAD_REQUEST', message: 'Invalid Content-Length' } });
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
  }
})
  Deno.test('git-http route hardening - returns 404 for missing LFS object download', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    /* TODO: call fakeTime.restore() */ void 0;
    await fs.rm(hoisted.reposBaseDir, { recursive: true, force: true });
    await fs.mkdir(hoisted.reposBaseDir, { recursive: true });
  try {
  const spaceId = 'ws-missing-object';
    const repoName = 'repo-missing-object';
    const oid = 'b'.repeat(64);
    await createRepoDir(spaceId, repoName);

    const app = createTestApp();
    const response = await app.request(
      `/git/${spaceId}/${repoName}.git/info/lfs/objects/${oid}`
    );

    assertEquals(response.status, 404);
    const body = await response.json();
    assertEquals(body, { error: { code: 'NOT_FOUND', message: 'LFS object not found' } });
  } finally {
  /* TODO: call fakeTime.restore() */ void 0;
  }
})