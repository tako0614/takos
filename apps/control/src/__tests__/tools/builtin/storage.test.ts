import type { ToolContext } from '@/tools/types';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '@/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

import { assertEquals, assert, assertRejects, assertStringIncludes } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mockSelectGet = ((..._args: any[]) => undefined) as any;
const mockSelectAll = ((..._args: any[]) => undefined) as any;

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/tools/builtin/storage/validators'
// [Deno] vi.mock removed - manually stub imports from '@/services/platform/infra'
const mockCreateWfp = ((..._args: any[]) => undefined) as any;
// [Deno] vi.mock removed - manually stub imports from '@/platform/providers/cloudflare/wfp'
// [Deno] vi.mock removed - manually stub imports from '@/platform/providers/cloudflare/api-client'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/hash'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils'
import {
  KV_GET,
  KV_PUT,
  KV_DELETE,
  KV_LIST,
  kvGetHandler,
  kvPutHandler,
  kvDeleteHandler,
  kvListHandler,
  D1_QUERY,
  D1_TABLES,
  D1_DESCRIBE,
  d1QueryHandler,
  d1TablesHandler,
  d1DescribeHandler,
  R2_UPLOAD,
  R2_DOWNLOAD,
  R2_LIST,
  R2_DELETE,
  R2_INFO,
  r2ListHandler,
  r2DeleteHandler,
  r2InfoHandler,
  STORAGE_TOOLS,
  STORAGE_HANDLERS,
} from '@/tools/builtin/storage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockKV = {
  get: ((..._args: any[]) => undefined) as any,
  put: ((..._args: any[]) => undefined) as any,
  delete: ((..._args: any[]) => undefined) as any,
  list: ((..._args: any[]) => undefined) as any,
};

const mockR2 = {
  put: ((..._args: any[]) => undefined) as any,
  get: ((..._args: any[]) => undefined) as any,
  delete: ((..._args: any[]) => undefined) as any,
  list: ((..._args: any[]) => undefined) as any,
  head: ((..._args: any[]) => undefined) as any,
};

const mockStmt: any = {
  bind: () => mockStmt,
  all: async () => ({ results: [] }),
  run: async () => ({ meta: { changes: 1 } }),
  first: async () => null,
};

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: 'ws-test',
    threadId: 'thread-1',
    runId: 'run-1',
    userId: 'user-1',
    capabilities: [],
    env: {
      HOSTNAME_ROUTING: mockKV,
      TENANT_SOURCE: mockR2,
      TENANT_BUILDS: mockR2,
      WORKER_BUNDLES: mockR2,
      CF_ACCOUNT_ID: 'cf-account',
      CF_API_TOKEN: 'cf-token',
    } as unknown as Env,
    db: {
      prepare: () => mockStmt,
    } as unknown as D1Database,
    storage: {
      put: ((..._args: any[]) => undefined) as any,
      get: ((..._args: any[]) => undefined) as any,
      delete: ((..._args: any[]) => undefined) as any,
    } as unknown as ToolContext['storage'],
    setSessionId: ((..._args: any[]) => undefined) as any,
    getLastContainerStartFailure: () => undefined,
    setLastContainerStartFailure: ((..._args: any[]) => undefined) as any,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Aggregate definitions
// ---------------------------------------------------------------------------


  Deno.test('STORAGE_TOOLS and STORAGE_HANDLERS - exports combined tool list', () => {
  assert(STORAGE_TOOLS.length >= 11);
    const names = STORAGE_TOOLS.map((t) => t.name);
    assertStringIncludes(names, 'kv_get');
    assertStringIncludes(names, 'd1_query');
    assertStringIncludes(names, 'r2_upload');
    assertStringIncludes(names, 'create_d1');
    assertStringIncludes(names, 'list_resources');
})
  Deno.test('STORAGE_TOOLS and STORAGE_HANDLERS - STORAGE_HANDLERS has handler for every tool', () => {
  for (const def of STORAGE_TOOLS) {
      assert(def.name in STORAGE_HANDLERS);
    }
})
// ---------------------------------------------------------------------------
// KV tools
// ---------------------------------------------------------------------------


  Deno.test('KV tool definitions - kv_get requires namespace and key', () => {
  assertEquals(KV_GET.parameters.required, ['namespace', 'key']);
    assertEquals(KV_GET.category, 'storage');
})
  Deno.test('KV tool definitions - kv_put requires namespace, key, and value', () => {
  assertEquals(KV_PUT.parameters.required, ['namespace', 'key', 'value']);
})
  Deno.test('KV tool definitions - kv_delete requires namespace and key', () => {
  assertEquals(KV_DELETE.parameters.required, ['namespace', 'key']);
})
  Deno.test('KV tool definitions - kv_list requires namespace', () => {
  assertEquals(KV_LIST.parameters.required, ['namespace']);
})

  
  Deno.test('kvGetHandler - returns value when key exists', async () => {
  mockKV.get = (async () => 'my-value') as any;

    const result = await kvGetHandler(
      { namespace: 'HOSTNAME_ROUTING', key: 'test-key' },
      makeContext(),
    );
    assertEquals(result, 'Value: my-value');
})
  Deno.test('kvGetHandler - returns not found when key is null', async () => {
  mockKV.get = (async () => null) as any;

    const result = await kvGetHandler(
      { namespace: 'HOSTNAME_ROUTING', key: 'missing' },
      makeContext(),
    );
    assertStringIncludes(result, 'Key not found');
})
  Deno.test('kvGetHandler - throws when namespace is not found', async () => {
  await await assertRejects(async () => { await 
      kvGetHandler({ namespace: 'UNKNOWN', key: 'k' }, makeContext()),
    ; }, 'KV namespace not found');
})

  
  Deno.test('kvPutHandler - stores a value', async () => {
  mockKV.put = (async () => undefined) as any;

    const result = await kvPutHandler(
      { namespace: 'HOSTNAME_ROUTING', key: 'k', value: 'v' },
      makeContext(),
    );
    assertEquals(result, 'Stored: k');
    assertSpyCallArgs(mockKV.put, 0, ['k', 'v', {}]);
})
  Deno.test('kvPutHandler - passes TTL option', async () => {
  mockKV.put = (async () => undefined) as any;

    await kvPutHandler(
      { namespace: 'HOSTNAME_ROUTING', key: 'k', value: 'v', expiration_ttl: 3600 },
      makeContext(),
    );
    assertSpyCallArgs(mockKV.put, 0, ['k', 'v', { expirationTtl: 3600 }]);
})
  Deno.test('kvPutHandler - rejects invalid TTL', async () => {
  await await assertRejects(async () => { await 
      kvPutHandler(
        { namespace: 'HOSTNAME_ROUTING', key: 'k', value: 'v', expiration_ttl: 10 },
        makeContext(),
      ),
    ; }, 'Invalid TTL');
})
  Deno.test('kvPutHandler - rejects values exceeding 1MB', async () => {
  const largeValue = 'x'.repeat(1024 * 1024 + 1);
    await await assertRejects(async () => { await 
      kvPutHandler(
        { namespace: 'HOSTNAME_ROUTING', key: 'k', value: largeValue },
        makeContext(),
      ),
    ; }, 'exceeds maximum size');
})

  
  Deno.test('kvDeleteHandler - deletes a key', async () => {
  mockKV.delete = (async () => undefined) as any;

    const result = await kvDeleteHandler(
      { namespace: 'HOSTNAME_ROUTING', key: 'k' },
      makeContext(),
    );
    assertEquals(result, 'Deleted: k');
})

  
  Deno.test('kvListHandler - lists keys', async () => {
  mockKV.list = (async () => ({
      keys: [
        { name: 'key1' },
        { name: 'key2', expiration: Math.floor(Date.now() / 1000) + 3600 },
      ],
      list_complete: true,
    })) as any;

    const result = await kvListHandler(
      { namespace: 'HOSTNAME_ROUTING' },
      makeContext(),
    );
    assertStringIncludes(result, 'key1');
    assertStringIncludes(result, 'key2');
    assertStringIncludes(result, 'expires:');
})
  Deno.test('kvListHandler - reports empty namespace', async () => {
  mockKV.list = (async () => ({ keys: [], list_complete: true })) as any;

    const result = await kvListHandler(
      { namespace: 'HOSTNAME_ROUTING' },
      makeContext(),
    );
    assertStringIncludes(result, 'No keys found');
})
  Deno.test('kvListHandler - shows truncation indicator', async () => {
  mockKV.list = (async () => ({
      keys: [{ name: 'k1' }],
      list_complete: false,
    })) as any;

    const result = await kvListHandler(
      { namespace: 'HOSTNAME_ROUTING' },
      makeContext(),
    );
    assertStringIncludes(result, 'More keys available');
})
// ---------------------------------------------------------------------------
// D1 tools
// ---------------------------------------------------------------------------


  Deno.test('D1 tool definitions - d1_query requires sql', () => {
  assertEquals(D1_QUERY.parameters.required, ['sql']);
    assertEquals(D1_QUERY.category, 'storage');
})
  Deno.test('D1 tool definitions - d1_tables has no required params', () => {
  assertEquals(D1_TABLES.parameters.required, undefined);
})
  Deno.test('D1 tool definitions - d1_describe requires table', () => {
  assertEquals(D1_DESCRIBE.parameters.required, ['table']);
})

  
  Deno.test('d1QueryHandler - executes a SELECT query and formats results', async () => {
  mockStmt.all = (async () => ({
      results: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
    } as never)) as any;

    const result = await d1QueryHandler({ sql: 'SELECT * FROM users' }, makeContext());

    assertStringIncludes(result, 'id');
    assertStringIncludes(result, 'name');
    assertStringIncludes(result, 'Alice');
    assertStringIncludes(result, '(2 rows)');
})
  Deno.test('d1QueryHandler - returns no results message for empty SELECT', async () => {
  mockStmt.all = (async () => ({ results: [] } as never)) as any;

    const result = await d1QueryHandler({ sql: 'SELECT * FROM users' }, makeContext());
    assertEquals(result, 'No results found.');
})
  Deno.test('d1QueryHandler - executes INSERT and reports changes', async () => {
  mockStmt.run = (async () => ({ meta: { changes: 1 } })) as any;

    const result = await d1QueryHandler(
      { sql: "INSERT INTO users (name) VALUES ('test')" },
      makeContext(),
    );
    assertStringIncludes(result, 'Changes: 1');
})
  Deno.test('d1QueryHandler - rejects DROP TABLE', async () => {
  await await assertRejects(async () => { await 
      d1QueryHandler({ sql: 'DROP TABLE users' }, makeContext()),
    ; }, 'Dangerous operation not allowed');
})
  Deno.test('d1QueryHandler - rejects TRUNCATE', async () => {
  await await assertRejects(async () => { await 
      d1QueryHandler({ sql: 'TRUNCATE users' }, makeContext()),
    ; }, 'Dangerous operation not allowed');
})
  Deno.test('d1QueryHandler - rejects PRAGMA', async () => {
  await await assertRejects(async () => { await 
      d1QueryHandler({ sql: 'PRAGMA table_info(users)' }, makeContext()),
    ; }, 'Dangerous operation not allowed');
})
  Deno.test('d1QueryHandler - rejects DELETE without WHERE', async () => {
  await await assertRejects(async () => { await 
      d1QueryHandler({ sql: 'DELETE FROM users' }, makeContext()),
    ; }, 'DELETE operations must include a WHERE clause');
})
  Deno.test('d1QueryHandler - allows DELETE with WHERE', async () => {
  mockStmt.run = (async () => ({ meta: { changes: 1 } })) as any;

    const result = await d1QueryHandler(
      { sql: 'DELETE FROM users WHERE id = 1' },
      makeContext(),
    );
    assertStringIncludes(result, 'Changes: 1');
})
  Deno.test('d1QueryHandler - rejects UPDATE without WHERE', async () => {
  await await assertRejects(async () => { await 
      d1QueryHandler({ sql: "UPDATE users SET name = 'test'" }, makeContext()),
    ; }, 'UPDATE operations must include a WHERE clause');
})
  Deno.test('d1QueryHandler - rejects multiple SQL statements', async () => {
  await await assertRejects(async () => { await 
      d1QueryHandler({ sql: 'SELECT 1; SELECT 2' }, makeContext()),
    ; }, 'Multiple SQL statements not allowed');
})
  Deno.test('d1QueryHandler - rejects comment-based bypass for dangerous operations', async () => {
  await await assertRejects(async () => { await 
      d1QueryHandler({ sql: 'DR/**/OP TABLE users' }, makeContext()),
    ; }, 'Only SELECT, INSERT, UPDATE (with WHERE), and DELETE (with WHERE) operations are allowed');
})

  
  Deno.test('d1TablesHandler - lists tables and views', async () => {
  mockStmt.all = (async () => ({
      results: [
        { name: 'users', type: 'table' },
        { name: 'user_view', type: 'view' },
      ],
    } as never)) as any;

    const result = await d1TablesHandler({}, makeContext());
    assertStringIncludes(result, 'Tables (1)');
    assertStringIncludes(result, 'users');
    assertStringIncludes(result, 'Views (1)');
    assertStringIncludes(result, 'user_view');
})
  Deno.test('d1TablesHandler - reports no tables found', async () => {
  mockStmt.all = (async () => ({ results: [] } as never)) as any;

    const result = await d1TablesHandler({}, makeContext());
    assertEquals(result, 'No tables found in database.');
})

  
  Deno.test('d1DescribeHandler - throws when table name is a reserved keyword', async () => {
  await await assertRejects(async () => { await 
      d1DescribeHandler({ table: 'select' }, makeContext()),
    ; }, 'reserved keyword');
})
  Deno.test('d1DescribeHandler - throws for invalid table names', async () => {
  await await assertRejects(async () => { await 
      d1DescribeHandler({ table: '123abc' }, makeContext()),
    ; }, 'Invalid table name');
})
  Deno.test('d1DescribeHandler - throws for sqlite_ internal tables', async () => {
  await await assertRejects(async () => { await 
      d1DescribeHandler({ table: 'sqlite_master' }, makeContext()),
    ; }, 'Cannot access SQLite internal tables');
})
  Deno.test('d1DescribeHandler - throws when table does not exist', async () => {
  mockStmt.first = (async () => null as never) as any;

    await await assertRejects(async () => { await 
      d1DescribeHandler({ table: 'missing_table' }, makeContext()),
    ; }, 'Table not found');
})
  Deno.test('d1DescribeHandler - describes table with columns and indexes', async () => {
  mockStmt.first = (async () => ({ name: 'users' } as never)) as any;
    mockStmt.all
       = (async () => ({
        results: [
          { cid: 0, name: 'id', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 1 },
          { cid: 1, name: 'name', type: 'TEXT', notnull: 0, dflt_value: "'unnamed'", pk: 0 },
        ],
      } as never)) as any
       = (async () => ({
        results: [
          { seq: 0, name: 'idx_users_name', unique: 1, origin: 'c', partial: 0 },
        ],
      } as never)) as any;

    const result = await d1DescribeHandler({ table: 'users' }, makeContext());

    assertStringIncludes(result, 'Table: users');
    assertStringIncludes(result, 'id | INTEGER');
    assertStringIncludes(result, 'name | TEXT');
    assertStringIncludes(result, 'idx_users_name');
    assertStringIncludes(result, 'UNIQUE');
})
// ---------------------------------------------------------------------------
// R2 tools
// ---------------------------------------------------------------------------


  Deno.test('R2 tool definitions - r2_upload requires bucket, key, file_path', () => {
  assertEquals(R2_UPLOAD.parameters.required, ['bucket', 'key', 'file_path']);
    assertEquals(R2_UPLOAD.category, 'storage');
})
  Deno.test('R2 tool definitions - r2_list requires bucket', () => {
  assertEquals(R2_LIST.parameters.required, ['bucket']);
})
  Deno.test('R2 tool definitions - r2_info requires bucket and key', () => {
  assertEquals(R2_INFO.parameters.required, ['bucket', 'key']);
})

  
  Deno.test('r2ListHandler - lists objects in a bucket', async () => {
  mockR2.list = (async () => ({
      objects: [
        { key: 'file1.txt', size: 1024, uploaded: new Date('2026-01-01') },
        { key: 'file2.txt', size: 2048, uploaded: new Date('2026-01-02') },
      ],
      truncated: false,
    })) as any;

    const result = await r2ListHandler({ bucket: 'TENANT_SOURCE' }, makeContext());

    assertStringIncludes(result, 'file1.txt');
    assertStringIncludes(result, 'file2.txt');
})
  Deno.test('r2ListHandler - reports empty bucket', async () => {
  mockR2.list = (async () => ({ objects: [], truncated: false })) as any;

    const result = await r2ListHandler({ bucket: 'TENANT_SOURCE' }, makeContext());
    assertStringIncludes(result, 'No objects found');
})
  Deno.test('r2ListHandler - shows truncation notice', async () => {
  mockR2.list = (async () => ({
      objects: [{ key: 'f.txt', size: 10, uploaded: new Date() }],
      truncated: true,
    })) as any;

    const result = await r2ListHandler({ bucket: 'TENANT_SOURCE' }, makeContext());
    assertStringIncludes(result, 'More objects available');
})
  Deno.test('r2ListHandler - throws for unknown bucket', async () => {
  await await assertRejects(async () => { await 
      r2ListHandler({ bucket: 'UNKNOWN_BUCKET' }, makeContext()),
    ; }, 'R2 bucket not found');
})

  
  Deno.test('r2DeleteHandler - deletes an object', async () => {
  mockR2.delete = (async () => undefined) as any;

    const result = await r2DeleteHandler(
      { bucket: 'TENANT_SOURCE', key: 'path/to/file.txt' },
      makeContext(),
    );
    assertStringIncludes(result, 'Deleted');
})

  
  Deno.test('r2InfoHandler - returns object metadata', async () => {
  mockR2.head = (async () => ({
      size: 4096,
      uploaded: new Date('2026-01-01'),
      httpMetadata: { contentType: 'text/plain' },
      etag: '"abc123"',
      customMetadata: { author: 'user1' },
    })) as any;

    const result = await r2InfoHandler(
      { bucket: 'TENANT_SOURCE', key: 'file.txt' },
      makeContext(),
    );

    assertStringIncludes(result, '4096 bytes');
    assertStringIncludes(result, 'text/plain');
    assertStringIncludes(result, 'author: user1');
})
  Deno.test('r2InfoHandler - throws when object not found', async () => {
  mockR2.head = (async () => null) as any;

    await await assertRejects(async () => { await 
      r2InfoHandler({ bucket: 'TENANT_SOURCE', key: 'missing' }, makeContext()),
    ; }, 'Object not found');
})