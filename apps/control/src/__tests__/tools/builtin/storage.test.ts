import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '@/tools/types';
import type { D1Database } from '@takos/cloudflare-compat';
import type { Env } from '@/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSelectGet = vi.fn();
const mockSelectAll = vi.fn();

vi.mock('@/db', () => {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    get: vi.fn(() => mockSelectGet()),
    all: vi.fn(() => mockSelectAll()),
  };
  return {
    getDb: () => ({
      select: vi.fn(() => chain),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          run: vi.fn(async () => ({})),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => ({})),
        })),
      })),
    }),
    files: { id: 'id', accountId: 'account_id', path: 'path', sha256: 'sha256', size: 'size' },
    resources: { id: 'id', ownerAccountId: 'owner_account_id', accountId: 'account_id', name: 'name', type: 'type', status: 'status', cfId: 'cf_id', cfName: 'cf_name' },
  };
});

vi.mock('@/tools/builtin/storage/validators', () => ({
  validateStoragePath: vi.fn((path: string) => {
    if (!path || typeof path !== 'string') throw new Error(`Invalid path: must be a non-empty string`);
    return path.replace(/^\/+/, '').replace(/\/+$/, '');
  }),
  validateR2Key: vi.fn((key: string) => {
    if (!key || typeof key !== 'string') throw new Error(`Invalid key: must be a non-empty string`);
    return key.replace(/^\/+/, '').replace(/\/+$/, '');
  }),
  validateKVKey: vi.fn((key: string) => {
    if (!key || typeof key !== 'string') throw new Error('Invalid KV key: must be a non-empty string');
    return key;
  }),
}));

vi.mock('@/services/platform/infra', () => ({
  createCloudflareApiClient: vi.fn(),
}));

const mockCreateWfp = vi.fn();
vi.mock('@/platform/providers/cloudflare/wfp', () => ({
  createOptionalCloudflareWfpProvider: (...args: unknown[]) => mockCreateWfp(...args),
}));

vi.mock('@/platform/providers/cloudflare/api-client', () => ({
  createCloudflareApiClient: vi.fn(() => ({
    accountGet: vi.fn(async () => []),
  })),
}));

vi.mock('@/shared/utils/hash', () => ({
  computeSHA256: vi.fn(async () => 'sha256hash'),
}));

vi.mock('@/shared/utils', () => ({
  generateId: vi.fn(() => 'gen-id'),
  now: vi.fn(() => '2026-01-01T00:00:00.000Z'),
}));

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
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  list: vi.fn(),
};

const mockR2 = {
  put: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
  list: vi.fn(),
  head: vi.fn(),
};

const mockStmt: any = {
  bind: vi.fn(() => mockStmt),
  all: vi.fn(async () => ({ results: [] })),
  run: vi.fn(async () => ({ meta: { changes: 1 } })),
  first: vi.fn(async () => null),
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
      prepare: vi.fn(() => mockStmt),
    } as unknown as D1Database,
    storage: {
      put: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
    } as unknown as ToolContext['storage'],
    setSessionId: vi.fn(),
    getLastContainerStartFailure: vi.fn(() => undefined),
    setLastContainerStartFailure: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Aggregate definitions
// ---------------------------------------------------------------------------

describe('STORAGE_TOOLS and STORAGE_HANDLERS', () => {
  it('exports combined tool list', () => {
    expect(STORAGE_TOOLS.length).toBeGreaterThanOrEqual(11);
    const names = STORAGE_TOOLS.map((t) => t.name);
    expect(names).toContain('kv_get');
    expect(names).toContain('d1_query');
    expect(names).toContain('r2_upload');
    expect(names).toContain('create_d1');
    expect(names).toContain('list_resources');
  });

  it('STORAGE_HANDLERS has handler for every tool', () => {
    for (const def of STORAGE_TOOLS) {
      expect(STORAGE_HANDLERS).toHaveProperty(def.name);
    }
  });
});

// ---------------------------------------------------------------------------
// KV tools
// ---------------------------------------------------------------------------

describe('KV tool definitions', () => {
  it('kv_get requires namespace and key', () => {
    expect(KV_GET.parameters.required).toEqual(['namespace', 'key']);
    expect(KV_GET.category).toBe('storage');
  });

  it('kv_put requires namespace, key, and value', () => {
    expect(KV_PUT.parameters.required).toEqual(['namespace', 'key', 'value']);
  });

  it('kv_delete requires namespace and key', () => {
    expect(KV_DELETE.parameters.required).toEqual(['namespace', 'key']);
  });

  it('kv_list requires namespace', () => {
    expect(KV_LIST.parameters.required).toEqual(['namespace']);
  });
});

describe('kvGetHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns value when key exists', async () => {
    mockKV.get.mockResolvedValue('my-value');

    const result = await kvGetHandler(
      { namespace: 'HOSTNAME_ROUTING', key: 'test-key' },
      makeContext(),
    );
    expect(result).toBe('Value: my-value');
  });

  it('returns not found when key is null', async () => {
    mockKV.get.mockResolvedValue(null);

    const result = await kvGetHandler(
      { namespace: 'HOSTNAME_ROUTING', key: 'missing' },
      makeContext(),
    );
    expect(result).toContain('Key not found');
  });

  it('throws when namespace is not found', async () => {
    await expect(
      kvGetHandler({ namespace: 'UNKNOWN', key: 'k' }, makeContext()),
    ).rejects.toThrow('KV namespace not found');
  });
});

describe('kvPutHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stores a value', async () => {
    mockKV.put.mockResolvedValue(undefined);

    const result = await kvPutHandler(
      { namespace: 'HOSTNAME_ROUTING', key: 'k', value: 'v' },
      makeContext(),
    );
    expect(result).toBe('Stored: k');
    expect(mockKV.put).toHaveBeenCalledWith('k', 'v', {});
  });

  it('passes TTL option', async () => {
    mockKV.put.mockResolvedValue(undefined);

    await kvPutHandler(
      { namespace: 'HOSTNAME_ROUTING', key: 'k', value: 'v', expiration_ttl: 3600 },
      makeContext(),
    );
    expect(mockKV.put).toHaveBeenCalledWith('k', 'v', { expirationTtl: 3600 });
  });

  it('rejects invalid TTL', async () => {
    await expect(
      kvPutHandler(
        { namespace: 'HOSTNAME_ROUTING', key: 'k', value: 'v', expiration_ttl: 10 },
        makeContext(),
      ),
    ).rejects.toThrow('Invalid TTL');
  });

  it('rejects values exceeding 1MB', async () => {
    const largeValue = 'x'.repeat(1024 * 1024 + 1);
    await expect(
      kvPutHandler(
        { namespace: 'HOSTNAME_ROUTING', key: 'k', value: largeValue },
        makeContext(),
      ),
    ).rejects.toThrow('exceeds maximum size');
  });
});

describe('kvDeleteHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes a key', async () => {
    mockKV.delete.mockResolvedValue(undefined);

    const result = await kvDeleteHandler(
      { namespace: 'HOSTNAME_ROUTING', key: 'k' },
      makeContext(),
    );
    expect(result).toBe('Deleted: k');
  });
});

describe('kvListHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists keys', async () => {
    mockKV.list.mockResolvedValue({
      keys: [
        { name: 'key1' },
        { name: 'key2', expiration: Math.floor(Date.now() / 1000) + 3600 },
      ],
      list_complete: true,
    });

    const result = await kvListHandler(
      { namespace: 'HOSTNAME_ROUTING' },
      makeContext(),
    );
    expect(result).toContain('key1');
    expect(result).toContain('key2');
    expect(result).toContain('expires:');
  });

  it('reports empty namespace', async () => {
    mockKV.list.mockResolvedValue({ keys: [], list_complete: true });

    const result = await kvListHandler(
      { namespace: 'HOSTNAME_ROUTING' },
      makeContext(),
    );
    expect(result).toContain('No keys found');
  });

  it('shows truncation indicator', async () => {
    mockKV.list.mockResolvedValue({
      keys: [{ name: 'k1' }],
      list_complete: false,
    });

    const result = await kvListHandler(
      { namespace: 'HOSTNAME_ROUTING' },
      makeContext(),
    );
    expect(result).toContain('More keys available');
  });
});

// ---------------------------------------------------------------------------
// D1 tools
// ---------------------------------------------------------------------------

describe('D1 tool definitions', () => {
  it('d1_query requires sql', () => {
    expect(D1_QUERY.parameters.required).toEqual(['sql']);
    expect(D1_QUERY.category).toBe('storage');
  });

  it('d1_tables has no required params', () => {
    expect(D1_TABLES.parameters.required).toBeUndefined();
  });

  it('d1_describe requires table', () => {
    expect(D1_DESCRIBE.parameters.required).toEqual(['table']);
  });
});

describe('d1QueryHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('executes a SELECT query and formats results', async () => {
    mockStmt.all.mockResolvedValue({
      results: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
    } as never);

    const result = await d1QueryHandler({ sql: 'SELECT * FROM users' }, makeContext());

    expect(result).toContain('id');
    expect(result).toContain('name');
    expect(result).toContain('Alice');
    expect(result).toContain('(2 rows)');
  });

  it('returns no results message for empty SELECT', async () => {
    mockStmt.all.mockResolvedValue({ results: [] } as never);

    const result = await d1QueryHandler({ sql: 'SELECT * FROM users' }, makeContext());
    expect(result).toBe('No results found.');
  });

  it('executes INSERT and reports changes', async () => {
    mockStmt.run.mockResolvedValue({ meta: { changes: 1 } });

    const result = await d1QueryHandler(
      { sql: "INSERT INTO users (name) VALUES ('test')" },
      makeContext(),
    );
    expect(result).toContain('Changes: 1');
  });

  it('rejects DROP TABLE', async () => {
    await expect(
      d1QueryHandler({ sql: 'DROP TABLE users' }, makeContext()),
    ).rejects.toThrow('Dangerous operation not allowed');
  });

  it('rejects TRUNCATE', async () => {
    await expect(
      d1QueryHandler({ sql: 'TRUNCATE users' }, makeContext()),
    ).rejects.toThrow('Dangerous operation not allowed');
  });

  it('rejects PRAGMA', async () => {
    await expect(
      d1QueryHandler({ sql: 'PRAGMA table_info(users)' }, makeContext()),
    ).rejects.toThrow('Dangerous operation not allowed');
  });

  it('rejects DELETE without WHERE', async () => {
    await expect(
      d1QueryHandler({ sql: 'DELETE FROM users' }, makeContext()),
    ).rejects.toThrow('DELETE operations must include a WHERE clause');
  });

  it('allows DELETE with WHERE', async () => {
    mockStmt.run.mockResolvedValue({ meta: { changes: 1 } });

    const result = await d1QueryHandler(
      { sql: 'DELETE FROM users WHERE id = 1' },
      makeContext(),
    );
    expect(result).toContain('Changes: 1');
  });

  it('rejects UPDATE without WHERE', async () => {
    await expect(
      d1QueryHandler({ sql: "UPDATE users SET name = 'test'" }, makeContext()),
    ).rejects.toThrow('UPDATE operations must include a WHERE clause');
  });

  it('rejects multiple SQL statements', async () => {
    await expect(
      d1QueryHandler({ sql: 'SELECT 1; SELECT 2' }, makeContext()),
    ).rejects.toThrow('Multiple SQL statements not allowed');
  });

  it('rejects comment-based bypass for dangerous operations', async () => {
    await expect(
      d1QueryHandler({ sql: 'DR/**/OP TABLE users' }, makeContext()),
    ).rejects.toThrow('Only SELECT, INSERT, UPDATE (with WHERE), and DELETE (with WHERE) operations are allowed');
  });
});

describe('d1TablesHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists tables and views', async () => {
    mockStmt.all.mockResolvedValue({
      results: [
        { name: 'users', type: 'table' },
        { name: 'user_view', type: 'view' },
      ],
    } as never);

    const result = await d1TablesHandler({}, makeContext());
    expect(result).toContain('Tables (1)');
    expect(result).toContain('users');
    expect(result).toContain('Views (1)');
    expect(result).toContain('user_view');
  });

  it('reports no tables found', async () => {
    mockStmt.all.mockResolvedValue({ results: [] } as never);

    const result = await d1TablesHandler({}, makeContext());
    expect(result).toBe('No tables found in database.');
  });
});

describe('d1DescribeHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when table name is a reserved keyword', async () => {
    await expect(
      d1DescribeHandler({ table: 'select' }, makeContext()),
    ).rejects.toThrow('reserved keyword');
  });

  it('throws for invalid table names', async () => {
    await expect(
      d1DescribeHandler({ table: '123abc' }, makeContext()),
    ).rejects.toThrow('Invalid table name');
  });

  it('throws for sqlite_ internal tables', async () => {
    await expect(
      d1DescribeHandler({ table: 'sqlite_master' }, makeContext()),
    ).rejects.toThrow('Cannot access SQLite internal tables');
  });

  it('throws when table does not exist', async () => {
    mockStmt.first.mockResolvedValue(null as never);

    await expect(
      d1DescribeHandler({ table: 'missing_table' }, makeContext()),
    ).rejects.toThrow('Table not found');
  });

  it('describes table with columns and indexes', async () => {
    mockStmt.first.mockResolvedValueOnce({ name: 'users' } as never);
    mockStmt.all
      .mockResolvedValueOnce({
        results: [
          { cid: 0, name: 'id', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 1 },
          { cid: 1, name: 'name', type: 'TEXT', notnull: 0, dflt_value: "'unnamed'", pk: 0 },
        ],
      } as never)
      .mockResolvedValueOnce({
        results: [
          { seq: 0, name: 'idx_users_name', unique: 1, origin: 'c', partial: 0 },
        ],
      } as never);

    const result = await d1DescribeHandler({ table: 'users' }, makeContext());

    expect(result).toContain('Table: users');
    expect(result).toContain('id | INTEGER');
    expect(result).toContain('name | TEXT');
    expect(result).toContain('idx_users_name');
    expect(result).toContain('UNIQUE');
  });
});

// ---------------------------------------------------------------------------
// R2 tools
// ---------------------------------------------------------------------------

describe('R2 tool definitions', () => {
  it('r2_upload requires bucket, key, file_path', () => {
    expect(R2_UPLOAD.parameters.required).toEqual(['bucket', 'key', 'file_path']);
    expect(R2_UPLOAD.category).toBe('storage');
  });

  it('r2_list requires bucket', () => {
    expect(R2_LIST.parameters.required).toEqual(['bucket']);
  });

  it('r2_info requires bucket and key', () => {
    expect(R2_INFO.parameters.required).toEqual(['bucket', 'key']);
  });
});

describe('r2ListHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists objects in a bucket', async () => {
    mockR2.list.mockResolvedValue({
      objects: [
        { key: 'file1.txt', size: 1024, uploaded: new Date('2026-01-01') },
        { key: 'file2.txt', size: 2048, uploaded: new Date('2026-01-02') },
      ],
      truncated: false,
    });

    const result = await r2ListHandler({ bucket: 'TENANT_SOURCE' }, makeContext());

    expect(result).toContain('file1.txt');
    expect(result).toContain('file2.txt');
  });

  it('reports empty bucket', async () => {
    mockR2.list.mockResolvedValue({ objects: [], truncated: false });

    const result = await r2ListHandler({ bucket: 'TENANT_SOURCE' }, makeContext());
    expect(result).toContain('No objects found');
  });

  it('shows truncation notice', async () => {
    mockR2.list.mockResolvedValue({
      objects: [{ key: 'f.txt', size: 10, uploaded: new Date() }],
      truncated: true,
    });

    const result = await r2ListHandler({ bucket: 'TENANT_SOURCE' }, makeContext());
    expect(result).toContain('More objects available');
  });

  it('throws for unknown bucket', async () => {
    await expect(
      r2ListHandler({ bucket: 'UNKNOWN_BUCKET' }, makeContext()),
    ).rejects.toThrow('R2 bucket not found');
  });
});

describe('r2DeleteHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes an object', async () => {
    mockR2.delete.mockResolvedValue(undefined);

    const result = await r2DeleteHandler(
      { bucket: 'TENANT_SOURCE', key: 'path/to/file.txt' },
      makeContext(),
    );
    expect(result).toContain('Deleted');
  });
});

describe('r2InfoHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns object metadata', async () => {
    mockR2.head.mockResolvedValue({
      size: 4096,
      uploaded: new Date('2026-01-01'),
      httpMetadata: { contentType: 'text/plain' },
      etag: '"abc123"',
      customMetadata: { author: 'user1' },
    });

    const result = await r2InfoHandler(
      { bucket: 'TENANT_SOURCE', key: 'file.txt' },
      makeContext(),
    );

    expect(result).toContain('4096 bytes');
    expect(result).toContain('text/plain');
    expect(result).toContain('author: user1');
  });

  it('throws when object not found', async () => {
    mockR2.head.mockResolvedValue(null);

    await expect(
      r2InfoHandler({ bucket: 'TENANT_SOURCE', key: 'missing' }, makeContext()),
    ).rejects.toThrow('Object not found');
  });
});
