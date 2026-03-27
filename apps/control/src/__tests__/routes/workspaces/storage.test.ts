import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv, MockR2Bucket } from '../../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  requireWorkspaceAccess: vi.fn(),
  createFileRecord: vi.fn(),
  uploadPendingFileContent: vi.fn(),
  getStorageItem: vi.fn(),
}));

vi.mock('@/routes/shared/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/routes/shared/helpers')>();
  return {
    ...actual,
    requireWorkspaceAccess: mocks.requireWorkspaceAccess,
  };
});

vi.mock('@/services/source/space-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/source/space-storage')>();
  return {
    ...actual,
    createFileRecord: mocks.createFileRecord,
    getStorageItem: mocks.getStorageItem,
    uploadPendingFileContent: mocks.uploadPendingFileContent,
  };
});

import storageRoutes from '@/routes/spaces/storage';

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
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/api/spaces', storageRoutes);
  return app;
}

describe('workspace storage upload transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireWorkspaceAccess.mockResolvedValue({ workspace: { id: 'ws-1' } });
    mocks.createFileRecord.mockResolvedValue({
      file: { id: 'file-1' },
      r2Key: 'ws-storage/ws-1/file-1',
    });
    mocks.getStorageItem.mockResolvedValue({
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
    });
    mocks.uploadPendingFileContent.mockResolvedValue({
      id: 'file-1',
    });
  });

  it('always returns a same-origin upload URL for worker-relayed uploads', async () => {
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

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      file_id: 'file-1',
      upload_url: 'http://localhost/api/spaces/ws-1/storage/upload/file-1',
      r2_key: 'ws-storage/ws-1/file-1',
    });
  });

  it('accepts same-origin upload PUT requests through the worker fallback route', async () => {
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

    expect(response.status).toBe(204);
    expect(mocks.uploadPendingFileContent).toHaveBeenCalledWith(
      env.DB,
      env.GIT_OBJECTS,
      'ws-1',
      'file-1',
      expect.any(ArrayBuffer),
      5, // declared size from file record
      'text/plain',
    );
  });

  it('returns a same-origin download URL for worker-relayed downloads', async () => {
    const app = createApp(createUser());
    const env = createMockEnv({
      GIT_OBJECTS: new MockR2Bucket(),
    }) as unknown as Env;

    const response = await app.fetch(
      new Request('http://localhost/api/spaces/me/storage/download-url?file_id=file-1'),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      download_url: 'http://localhost/api/spaces/me/storage/download/file-1',
    });
  });
});
