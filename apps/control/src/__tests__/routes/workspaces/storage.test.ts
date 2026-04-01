import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv, MockR2Bucket } from '../../../../test/integration/setup.ts';

import { assertEquals, assertObjectMatch } from 'jsr:@std/assert';
import { spy } from 'jsr:@std/testing/mock';

const mocks = ({
  requireSpaceAccess: ((..._args: any[]) => undefined) as any,
  createFileRecord: ((..._args: any[]) => undefined) as any,
  uploadPendingFileContent: ((..._args: any[]) => undefined) as any,
  getStorageItem: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/routes/shared/helpers'
// [Deno] vi.mock removed - manually stub imports from '@/services/source/space-storage'
import storageRoutes from '@/routes/spaces/storage';
import { storageUploadsRouteDeps } from '@/routes/spaces/storage-uploads.ts';
import { storageDownloadsRouteDeps } from '@/routes/spaces/storage-downloads.ts';

function createUser(): User {
  return {
    id: 'user-1',
    email: 'user1@example.com',
    name: 'User One',
    username: 'user1',
    bio: null,
    picture: null,
    trust_tier: 'normal',
    setup_completed: true,
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z',
  };
}

function createApp(user: User): Hono<{ Bindings: Env; Variables: { user: User } }> {
  const app = new Hono<{ Bindings: Env; Variables: { user: User } }>();
  storageUploadsRouteDeps.requireSpaceAccess = mocks.requireSpaceAccess;
  storageUploadsRouteDeps.createFileRecord = mocks.createFileRecord;
  storageUploadsRouteDeps.uploadPendingFileContent = mocks.uploadPendingFileContent;
  storageUploadsRouteDeps.getStorageItem = mocks.getStorageItem;
  storageDownloadsRouteDeps.requireSpaceAccess = mocks.requireSpaceAccess;
  storageDownloadsRouteDeps.getStorageItem = mocks.getStorageItem;
  storageDownloadsRouteDeps.getStorageItemByPath = (async () => null) as any;
  storageDownloadsRouteDeps.readFileContent = mocks.getStorageItem;
  storageDownloadsRouteDeps.writeFileContent = mocks.createFileRecord;
  storageDownloadsRouteDeps.getDb = ((db: unknown) => db) as any;
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/api/spaces', storageRoutes);
  return app;
}


  Deno.test('workspace storage upload transport - always returns a same-origin upload URL for worker-relayed uploads', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ space: { id: 'ws-1' } })) as any;
    mocks.createFileRecord = (async () => ({
      file: { id: 'file-1' },
      r2Key: 'ws-storage/ws-1/file-1',
    })) as any;
    mocks.getStorageItem = (async () => ({
      id: 'file-1',
      space_id: 'ws-1',
      parent_id: null,
      name: 'hello.txt',
      path: '/hello.txt',
      type: 'file',
      size: 5,
      mime_type: 'text/plain',
      sha256: null,
      uploaded_by: null,
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
    })) as any;
    mocks.uploadPendingFileContent = spy(async () => ({
      id: 'file-1',
    })) as any;
  const app = createApp(createUser());
    const env = createMockEnv({
      GIT_OBJECTS: new MockR2Bucket(),
    }) as unknown as Env;

    const response = await app.fetch(
      new Request('http://localhost/api/spaces/ws-1/storage/upload-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'hello.txt',
          parent_path: '/',
          size: 5,
          mime_type: 'text/plain',
        }),
      }),
      env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 201);
    await assertObjectMatch(await response.json(), {
      file_id: 'file-1',
      upload_url: 'http://localhost/api/spaces/ws-1/storage/upload/file-1',
      r2_key: 'ws-storage/ws-1/file-1',
    });
})
  Deno.test('workspace storage upload transport - accepts same-origin upload PUT requests through the worker fallback route', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ space: { id: 'ws-1' } })) as any;
    mocks.createFileRecord = (async () => ({
      file: { id: 'file-1' },
      r2Key: 'ws-storage/ws-1/file-1',
    })) as any;
    mocks.getStorageItem = (async () => ({
      id: 'file-1',
      space_id: 'ws-1',
      parent_id: null,
      name: 'hello.txt',
      path: '/hello.txt',
      type: 'file',
      size: 5,
      mime_type: 'text/plain',
      sha256: null,
      uploaded_by: null,
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
    })) as any;
    mocks.uploadPendingFileContent = spy(async () => ({
      id: 'file-1',
    })) as any;
  const app = createApp(createUser());
    const env = createMockEnv({
      GIT_OBJECTS: new MockR2Bucket(),
    }) as unknown as Env;

    const response = await app.fetch(
      new Request('http://localhost/api/spaces/ws-1/storage/upload/file-1', {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: 'hello',
      }),
      env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 204);
    assertEquals(mocks.uploadPendingFileContent.calls[0]?.args[0], env.DB);
    assertEquals(mocks.uploadPendingFileContent.calls[0]?.args[1], env.GIT_OBJECTS);
    assertEquals(mocks.uploadPendingFileContent.calls[0]?.args[2], 'ws-1');
    assertEquals(mocks.uploadPendingFileContent.calls[0]?.args[3], 'file-1');
    assertEquals((mocks.uploadPendingFileContent.calls[0]?.args[4] as ArrayBuffer).byteLength, 5);
    assertEquals(mocks.uploadPendingFileContent.calls[0]?.args[5], 5); // declared size from file record
    assertEquals(mocks.uploadPendingFileContent.calls[0]?.args[6], 'text/plain');
})
  Deno.test('workspace storage upload transport - returns a same-origin download URL for worker-relayed downloads', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ space: { id: 'ws-1' } })) as any;
    mocks.createFileRecord = (async () => ({
      file: { id: 'file-1' },
      r2Key: 'ws-storage/ws-1/file-1',
    })) as any;
    mocks.getStorageItem = (async () => ({
      id: 'file-1',
      space_id: 'ws-1',
      parent_id: null,
      name: 'hello.txt',
      path: '/hello.txt',
      type: 'file',
      size: 5,
      mime_type: 'text/plain',
      sha256: null,
      uploaded_by: null,
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
    })) as any;
    mocks.uploadPendingFileContent = spy(async () => ({
      id: 'file-1',
    })) as any;
    storageDownloadsRouteDeps.requireSpaceAccess = mocks.requireSpaceAccess;
    storageDownloadsRouteDeps.getStorageItem = mocks.getStorageItem;
  const app = createApp(createUser());
    const env = createMockEnv({
      GIT_OBJECTS: new MockR2Bucket(),
    }) as unknown as Env;

    const response = await app.fetch(
      new Request('http://localhost/api/spaces/me/storage/download-url?file_id=file-1'),
      env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    await assertObjectMatch(await response.json(), {
      download_url: 'http://localhost/api/spaces/me/storage/download/file-1',
    });
})
