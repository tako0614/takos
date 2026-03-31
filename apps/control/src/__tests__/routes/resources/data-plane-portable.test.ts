import { Hono } from 'hono';
import type { Env, User } from '@/types';
import type { AuthenticatedRouteEnv } from '@/routes/route-auth';
import type * as DbModule from '@/db';
import { createMockEnv } from '../../../../test/integration/setup';

import { assertEquals } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  checkResourceAccess: ((..._args: any[]) => undefined) as any,
  getPortableSqlDatabase: ((..._args: any[]) => undefined) as any,
  getPortableObjectStore: ((..._args: any[]) => undefined) as any,
  getPortableKvStore: ((..._args: any[]) => undefined) as any,
  isPortableResourceProvider: (providerName?: string | null) => providerName != null && providerName !== 'cloudflare',
  createOptionalCloudflareWfpProvider: ((..._args: any[]) => undefined) as any,
  resourceRow: null as Record<string, unknown> | null,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/resources'
// [Deno] vi.mock removed - manually stub imports from '@/routes/resources/portable-runtime'
// [Deno] vi.mock removed - manually stub imports from '@/platform/providers/cloudflare/wfp.ts'
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
  mocks.getDb = (() => ({
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
  })) as any;
}


  let app: Hono<AuthenticatedRouteEnv>;
  let env: Env;
  Deno.test('portable resource data-plane routes - serves sql tables through the portable sql backend on /sql/tables', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.resourceRow = null;
    installDbMock();
    app = createApp(createUser());
    env = createMockEnv() as unknown as Env;
    delete process.env.POSTGRES_URL;
    delete process.env.DATABASE_URL;
    mocks.checkResourceAccess = (async () => true) as any;
    mocks.isPortableResourceProvider = (providerName?: string | null) => providerName != null && providerName !== 'cloudflare' as any;
    mocks.createOptionalCloudflareWfpProvider;
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
    mocks.getPortableSqlDatabase = (async () => ({
      prepare(sql: string) {
        if (sql.includes('sqlite_master')) {
          return { all: (async () => ({ results: [{ name: 'users' }] })) };
        }
        if (sql.startsWith('PRAGMA table_info')) {
          return { all: (async () => ({ results: [{ name: 'id' }, { name: 'email' }] })) };
        }
        if (sql.startsWith('SELECT COUNT(*)')) {
          return { first: (async () => 2) };
        }
        throw new Error(`Unexpected SQL in test: ${sql}`);
      },
    })) as any;

    const res = await app.fetch(
      new Request('http://localhost/api/resources/res-sql/sql/tables'),
      env,
      {} as ExecutionContext,
    );

    assertEquals(res.status, 200);
    const json = await res.json() as { tables: Array<{ name: string; row_count: number }> };
    assertEquals(json.tables, [
      ({ name: 'users', row_count: 2 }),
    ]);
})
  Deno.test('portable resource data-plane routes - serves sql tables through the portable postgres backend on /sql/tables', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.resourceRow = null;
    installDbMock();
    app = createApp(createUser());
    env = createMockEnv() as unknown as Env;
    delete process.env.POSTGRES_URL;
    delete process.env.DATABASE_URL;
    mocks.checkResourceAccess = (async () => true) as any;
    mocks.isPortableResourceProvider = (providerName?: string | null) => providerName != null && providerName !== 'cloudflare' as any;
    mocks.createOptionalCloudflareWfpProvider;
  process.env.POSTGRES_URL = 'postgresql://takos:takos@postgres:5432/takos';
    mocks.resourceRow = {
      id: 'res-sql-pg',
      ownerAccountId: TEST_USER_ID,
      accountId: 'space-1',
      providerName: 'aws',
      name: 'db',
      type: 'd1',
      status: 'active',
      providerResourceId: 'db-res-sql-pg',
      providerResourceName: 'db-res-sql-pg',
      config: '{}',
      metadata: '{}',
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP,
    };
    mocks.getPortableSqlDatabase = (async () => ({
      prepare(sql: string) {
        if (sql.includes('information_schema.tables')) {
          return { all: (async () => ({ results: [{ table_name: 'users' }] })) };
        }
        if (sql.includes('information_schema.columns')) {
          return {
            bind: () => ({
              all: (async () => ({ results: [{ name: 'id', type: 'integer', nullable: 'NO' }] })),
            }),
          };
        }
        if (sql.startsWith('SELECT COUNT(*)')) {
          return { first: (async () => 3) };
        }
        throw new Error(`Unexpected SQL in postgres test: ${sql}`);
      },
    })) as any;

    const res = await app.fetch(
      new Request('http://localhost/api/resources/res-sql-pg/sql/tables'),
      env,
      {} as ExecutionContext,
    );

    assertEquals(res.status, 200);
    const json = await res.json() as { tables: Array<{ name: string; row_count: number }> };
    assertEquals(json.tables, [
      ({ name: 'users', row_count: 3 }),
    ]);
})
  Deno.test('portable resource data-plane routes - serves object listings and reads through the portable object store on canonical routes', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.resourceRow = null;
    installDbMock();
    app = createApp(createUser());
    env = createMockEnv() as unknown as Env;
    delete process.env.POSTGRES_URL;
    delete process.env.DATABASE_URL;
    mocks.checkResourceAccess = (async () => true) as any;
    mocks.isPortableResourceProvider = (providerName?: string | null) => providerName != null && providerName !== 'cloudflare' as any;
    mocks.createOptionalCloudflareWfpProvider;
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
      list: (async () => ({
        objects: [{ key: 'hello.txt', size: 5 }],
        truncated: false,
        cursor: '',
      })),
      get: (async () => ({
        size: 5,
        async text() {
          return 'hello';
        },
        writeHttpMetadata(headers: Headers) {
          headers.set('content-type', 'text/plain');
        },
      })),
      put: (async () => undefined),
      delete: (async () => undefined),
    };
    mocks.getPortableObjectStore = (() => bucket) as any;

    const listRes = await app.fetch(
      new Request('http://localhost/api/resources/res-obj/objects'),
      env,
      {} as ExecutionContext,
    );
    assertEquals(listRes.status, 200);
    const listJson = await listRes.json() as { objects: Array<{ key: string }> };
    assertEquals(listJson.objects, [{ key: 'hello.txt', size: 5 }]);

    const getRes = await app.fetch(
      new Request('http://localhost/api/resources/res-obj/objects/hello.txt'),
      env,
      {} as ExecutionContext,
    );
    assertEquals(getRes.status, 200);
    const getJson = await getRes.json() as { key: string; value: string; content_type: string };
    assertEquals(getJson, ({
      key: 'hello.txt',
      value: 'hello',
      content_type: 'text/plain',
    }));
})
  Deno.test('portable resource data-plane routes - mounts kv routes and serves entry reads through the portable kv backend', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.resourceRow = null;
    installDbMock();
    app = createApp(createUser());
    env = createMockEnv() as unknown as Env;
    delete process.env.POSTGRES_URL;
    delete process.env.DATABASE_URL;
    mocks.checkResourceAccess = (async () => true) as any;
    mocks.isPortableResourceProvider = (providerName?: string | null) => providerName != null && providerName !== 'cloudflare' as any;
    mocks.createOptionalCloudflareWfpProvider;
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
    mocks.getPortableKvStore = (() => ({
      list: (async () => ({
        keys: [{ name: 'greeting' }],
        list_complete: true,
        cursor: '',
      })),
      getWithMetadata: (async () => ({
        value: 'hello',
        metadata: { lang: 'en' },
        cacheStatus: null,
      })),
      put: (async () => undefined),
      delete: (async () => undefined),
    })) as any;

    const res = await app.fetch(
      new Request('http://localhost/api/resources/res-kv/kv/entries/greeting'),
      env,
      {} as ExecutionContext,
    );

    assertEquals(res.status, 200);
    const json = await res.json() as { key: string; value: string; metadata: Record<string, string> };
    assertEquals(json, ({
      key: 'greeting',
      value: 'hello',
      metadata: { lang: 'en' },
    }));
})
  Deno.test('portable resource data-plane routes - serves object read/write through the Cloudflare WFP provider on canonical routes', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.resourceRow = null;
    installDbMock();
    app = createApp(createUser());
    env = createMockEnv() as unknown as Env;
    delete process.env.POSTGRES_URL;
    delete process.env.DATABASE_URL;
    mocks.checkResourceAccess = (async () => true) as any;
    mocks.isPortableResourceProvider = (providerName?: string | null) => providerName != null && providerName !== 'cloudflare' as any;
    mocks.createOptionalCloudflareWfpProvider;
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
    const uploadToR2 = (async () => undefined);
    const getR2Object = (async () => ({
      body: new TextEncoder().encode('hello from cf').buffer,
      contentType: 'text/plain',
      size: 13,
    }));
    mocks.createOptionalCloudflareWfpProvider = (() => ({
      r2: { uploadToR2, getR2Object },
    })) as any;

    const putRes = await app.fetch(
      new Request('http://localhost/api/resources/res-cf-r2/objects/hello.txt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'hello from cf', content_type: 'text/plain' }),
      }),
      env,
      {} as ExecutionContext,
    );
    assertEquals(putRes.status, 200);
    assertSpyCallArgs(uploadToR2, 0, ['bucket-res-cf', 'hello.txt', 'hello from cf', {
      contentType: 'text/plain',
    }]);

    const getRes = await app.fetch(
      new Request('http://localhost/api/resources/res-cf-r2/objects/hello.txt'),
      env,
      {} as ExecutionContext,
    );
    assertEquals(getRes.status, 200);
    const getJson = await getRes.json() as { value: string; content_type: string };
    assertEquals(getJson, ({
      value: 'hello from cf',
      content_type: 'text/plain',
    }));
})