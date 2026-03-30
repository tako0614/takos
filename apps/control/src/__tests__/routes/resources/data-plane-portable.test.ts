import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import type { AuthenticatedRouteEnv } from '@/routes/route-auth';
import type * as DbModule from '@/db';
import { createMockEnv } from '../../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  checkResourceAccess: vi.fn(),
  getPortableSqlDatabase: vi.fn(),
  getPortableObjectStore: vi.fn(),
  getPortableKvStore: vi.fn(),
  isPortableResourceProvider: vi.fn((providerName?: string | null) => providerName != null && providerName !== 'cloudflare'),
  createOptionalCloudflareWfpProvider: vi.fn(),
  resourceRow: null as Record<string, unknown> | null,
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof DbModule>()),
  getDb: mocks.getDb,
}));

vi.mock('@/services/resources', async (importOriginal) => ({
  ...(await importOriginal()),
  checkResourceAccess: mocks.checkResourceAccess,
}));

vi.mock('@/routes/resources/portable-runtime', () => ({
  getPortableSqlDatabase: mocks.getPortableSqlDatabase,
  getPortableObjectStore: mocks.getPortableObjectStore,
  getPortableKvStore: mocks.getPortableKvStore,
  isPortableResourceProvider: mocks.isPortableResourceProvider,
}));

vi.mock('@/platform/providers/cloudflare/wfp.ts', () => ({
  createOptionalCloudflareWfpProvider: mocks.createOptionalCloudflareWfpProvider,
}));

import resourcesRouter from '@/routes/resources';

const TEST_USER_ID = 'user-1';
const TEST_TIMESTAMP = '2026-03-01T00:00:00.000Z';

function createUser(): User {
  return {
    id: TEST_USER_ID,
    email: 'user1@example.com',
    name: 'User One',
    username: 'user1',
    bio: null,
    picture: null,
    trust_tier: 'normal',
    setup_completed: true,
    created_at: TEST_TIMESTAMP,
    updated_at: TEST_TIMESTAMP,
  };
}

function createApp(user: User): Hono<AuthenticatedRouteEnv> {
  const app = new Hono<AuthenticatedRouteEnv>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/api/resources', resourcesRouter);
  return app;
}

function installDbMock() {
  mocks.getDb.mockReturnValue({
    select() {
      return {
        from() {
          return {
            where() {
              return {
                async get() {
                  return mocks.resourceRow;
                },
              };
            },
          };
        },
      };
    },
  });
}

describe('portable resource data-plane routes', () => {
  let app: Hono<AuthenticatedRouteEnv>;
  let env: Env;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resourceRow = null;
    installDbMock();
    app = createApp(createUser());
    env = createMockEnv() as unknown as Env;
    mocks.checkResourceAccess.mockResolvedValue(true);
    mocks.isPortableResourceProvider.mockImplementation((providerName?: string | null) => providerName != null && providerName !== 'cloudflare');
    mocks.createOptionalCloudflareWfpProvider.mockReset();
  });

  it('serves sql tables through the portable sql backend on /sql/tables', async () => {
    mocks.resourceRow = {
      id: 'res-sql',
      ownerAccountId: TEST_USER_ID,
      accountId: 'space-1',
      providerName: 'local',
      name: 'db',
      type: 'd1',
      status: 'active',
      providerResourceId: 'db-res-sql',
      providerResourceName: 'db-res-sql',
      config: '{}',
      metadata: '{}',
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP,
    };
    mocks.getPortableSqlDatabase.mockResolvedValue({
      prepare(sql: string) {
        if (sql.includes('sqlite_master')) {
          return { all: vi.fn().mockResolvedValue({ results: [{ name: 'users' }] }) };
        }
        if (sql.startsWith('PRAGMA table_info')) {
          return { all: vi.fn().mockResolvedValue({ results: [{ name: 'id' }, { name: 'email' }] }) };
        }
        if (sql.startsWith('SELECT COUNT(*)')) {
          return { first: vi.fn().mockResolvedValue(2) };
        }
        throw new Error(`Unexpected SQL in test: ${sql}`);
      },
    });

    const res = await app.fetch(
      new Request('http://localhost/api/resources/res-sql/sql/tables'),
      env,
      {} as ExecutionContext,
    );

    expect(res.status).toBe(200);
    const json = await res.json() as { tables: Array<{ name: string; row_count: number }> };
    expect(json.tables).toEqual([
      expect.objectContaining({ name: 'users', row_count: 2 }),
    ]);
  });

  it('serves object listings and reads through the portable object store on canonical routes', async () => {
    mocks.resourceRow = {
      id: 'res-obj',
      ownerAccountId: TEST_USER_ID,
      accountId: 'space-1',
      providerName: 'k8s',
      name: 'bucket',
      type: 'r2',
      status: 'active',
      providerResourceId: null,
      providerResourceName: 'bucket-res-obj',
      config: '{}',
      metadata: '{}',
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP,
    };
    const bucket = {
      list: vi.fn().mockResolvedValue({
        objects: [{ key: 'hello.txt', size: 5 }],
        truncated: false,
        cursor: '',
      }),
      get: vi.fn().mockResolvedValue({
        size: 5,
        async text() {
          return 'hello';
        },
        writeHttpMetadata(headers: Headers) {
          headers.set('content-type', 'text/plain');
        },
      }),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    mocks.getPortableObjectStore.mockReturnValue(bucket);

    const listRes = await app.fetch(
      new Request('http://localhost/api/resources/res-obj/objects'),
      env,
      {} as ExecutionContext,
    );
    expect(listRes.status).toBe(200);
    const listJson = await listRes.json() as { objects: Array<{ key: string }> };
    expect(listJson.objects).toEqual([{ key: 'hello.txt', size: 5 }]);

    const getRes = await app.fetch(
      new Request('http://localhost/api/resources/res-obj/objects/hello.txt'),
      env,
      {} as ExecutionContext,
    );
    expect(getRes.status).toBe(200);
    const getJson = await getRes.json() as { key: string; value: string; content_type: string };
    expect(getJson).toEqual(expect.objectContaining({
      key: 'hello.txt',
      value: 'hello',
      content_type: 'text/plain',
    }));
  });

  it('mounts kv routes and serves entry reads through the portable kv backend', async () => {
    mocks.resourceRow = {
      id: 'res-kv',
      ownerAccountId: TEST_USER_ID,
      accountId: 'space-1',
      providerName: 'aws',
      name: 'kv-one',
      type: 'kv',
      status: 'active',
      providerResourceId: 'kv-res-kv',
      providerResourceName: 'kv-res-kv',
      config: '{}',
      metadata: '{}',
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP,
    };
    mocks.getPortableKvStore.mockReturnValue({
      list: vi.fn().mockResolvedValue({
        keys: [{ name: 'greeting' }],
        list_complete: true,
        cursor: '',
      }),
      getWithMetadata: vi.fn().mockResolvedValue({
        value: 'hello',
        metadata: { lang: 'en' },
        cacheStatus: null,
      }),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    });

    const res = await app.fetch(
      new Request('http://localhost/api/resources/res-kv/kv/entries/greeting'),
      env,
      {} as ExecutionContext,
    );

    expect(res.status).toBe(200);
    const json = await res.json() as { key: string; value: string; metadata: Record<string, string> };
    expect(json).toEqual(expect.objectContaining({
      key: 'greeting',
      value: 'hello',
      metadata: { lang: 'en' },
    }));
  });

  it('serves object read/write through the Cloudflare WFP provider on canonical routes', async () => {
    mocks.resourceRow = {
      id: 'res-cf-r2',
      ownerAccountId: TEST_USER_ID,
      accountId: 'space-1',
      providerName: 'cloudflare',
      name: 'bucket',
      type: 'r2',
      status: 'active',
      providerResourceId: null,
      providerResourceName: 'bucket-res-cf',
      config: '{}',
      metadata: '{}',
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP,
    };
    const uploadToR2 = vi.fn().mockResolvedValue(undefined);
    const getR2Object = vi.fn().mockResolvedValue({
      body: new TextEncoder().encode('hello from cf').buffer,
      contentType: 'text/plain',
      size: 13,
    });
    mocks.createOptionalCloudflareWfpProvider.mockReturnValue({
      r2: { uploadToR2, getR2Object },
    });

    const putRes = await app.fetch(
      new Request('http://localhost/api/resources/res-cf-r2/objects/hello.txt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'hello from cf', content_type: 'text/plain' }),
      }),
      env,
      {} as ExecutionContext,
    );
    expect(putRes.status).toBe(200);
    expect(uploadToR2).toHaveBeenCalledWith('bucket-res-cf', 'hello.txt', 'hello from cf', {
      contentType: 'text/plain',
    });

    const getRes = await app.fetch(
      new Request('http://localhost/api/resources/res-cf-r2/objects/hello.txt'),
      env,
      {} as ExecutionContext,
    );
    expect(getRes.status).toBe(200);
    const getJson = await getRes.json() as { value: string; content_type: string };
    expect(getJson).toEqual(expect.objectContaining({
      value: 'hello from cf',
      content_type: 'text/plain',
    }));
  });
});
