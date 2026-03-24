import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { D1Database } from '@takos/cloudflare-compat';
import type { Env } from '@/types';

// ---------------------------------------------------------------------------
// Mock DB
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>();
  return {
    ...actual,
    getDb: mocks.getDb,
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(): D1Database {
  return {} as unknown as D1Database;
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ENCRYPTION_KEY: 'a'.repeat(64), // 32-byte hex key
    ADMIN_DOMAIN: 'takos.example.com',
    ...overrides,
  } as unknown as Env;
}

/**
 * Build a chainable Drizzle mock.
 * Supports select/insert/update/delete chains.
 */
function createDrizzleMock(options: {
  selectGet?: unknown;
  selectAll?: unknown[];
} = {}) {
  const runFn = vi.fn().mockResolvedValue(undefined);

  const selectChain = {
    get: vi.fn().mockResolvedValue(options.selectGet),
    all: vi.fn().mockResolvedValue(options.selectAll ?? []),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
  };
  const selectFrom = {
    where: vi.fn().mockReturnValue(selectChain),
    get: vi.fn().mockResolvedValue(options.selectGet),
    all: vi.fn().mockResolvedValue(options.selectAll ?? []),
    orderBy: vi.fn().mockReturnValue(selectChain),
  };

  return {
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue(selectFrom) }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({}) }),
        run: runFn,
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ run: runFn }),
        run: runFn,
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({ run: runFn }),
      run: runFn,
    }),
  };
}

// ---------------------------------------------------------------------------
// discoverOAuthMetadata
// ---------------------------------------------------------------------------

import { discoverOAuthMetadata } from '@/services/platform/mcp';

describe('discoverOAuthMetadata', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns parsed metadata on 200 response', async () => {
    const meta = {
      issuer: 'https://auth.example.com',
      authorization_endpoint: 'https://auth.example.com/auth',
      token_endpoint: 'https://auth.example.com/token',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(meta),
    } as unknown as Response);

    const result = await discoverOAuthMetadata('https://mcp.example.com');

    expect(result.issuer).toBe('https://auth.example.com');
    expect(result.token_endpoint).toBe('https://auth.example.com/token');
  });

  it('throws when server returns non-200', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as unknown as Response);

    await expect(discoverOAuthMetadata('https://mcp.example.com')).rejects.toThrow(
      'OAuth metadata discovery failed',
    );
  });

  it('throws when required fields are missing', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ issuer: 'https://auth.example.com' }),
    } as unknown as Response);

    await expect(discoverOAuthMetadata('https://mcp.example.com')).rejects.toThrow(
      'missing required fields',
    );
  });
});

// ---------------------------------------------------------------------------
// createMcpOAuthPending
// ---------------------------------------------------------------------------

import { createMcpOAuthPending } from '@/services/platform/mcp';

describe('createMcpOAuthPending', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a pending record and returns an auth URL', async () => {
    const drizzleMock = createDrizzleMock();
    mocks.getDb.mockReturnValue(drizzleMock);
    const db = makeDb();
    const env = makeEnv();

    const { authUrl, state } = await createMcpOAuthPending(db, env, {
      spaceId: 'ws1',
      serverName: 'my_mcp',
      serverUrl: 'https://mcp.example.com',
      issuerUrl: 'https://auth.example.com',
      tokenEndpoint: 'https://auth.example.com/token',
      authorizationEndpoint: 'https://auth.example.com/auth',
      redirectUri: 'https://takos.example.com/api/mcp/oauth/callback',
    });

    expect(state).toBeTruthy();
    expect(authUrl).toContain('https://auth.example.com/auth');
    expect(authUrl).toContain('code_challenge_method=S256');
    expect(authUrl).toContain(`state=${state}`);
    expect(drizzleMock.insert).toHaveBeenCalledOnce();
  });

  it('throws when ENCRYPTION_KEY is not configured', async () => {
    const db = makeDb();
    const env = makeEnv({ ENCRYPTION_KEY: undefined });

    await expect(
      createMcpOAuthPending(db, env, {
        spaceId: 'ws1',
        serverName: 'srv',
        serverUrl: 'https://mcp.example.com',
        issuerUrl: 'https://auth.example.com',
        tokenEndpoint: 'https://auth.example.com/token',
        authorizationEndpoint: 'https://auth.example.com/auth',
        redirectUri: 'https://takos.example.com/api/mcp/oauth/callback',
      }),
    ).rejects.toThrow('ENCRYPTION_KEY');
  });
});

// ---------------------------------------------------------------------------
// consumeMcpOAuthPending
// ---------------------------------------------------------------------------

import { consumeMcpOAuthPending } from '@/services/platform/mcp';

describe('consumeMcpOAuthPending', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when state is not found', async () => {
    const drizzleMock = createDrizzleMock({ selectGet: undefined });
    mocks.getDb.mockReturnValue(drizzleMock);

    const result = await consumeMcpOAuthPending(makeDb(), makeEnv(), 'unknown_state');
    expect(result).toBeNull();
  });

  it('returns null and deletes expired record', async () => {
    const drizzleMock = createDrizzleMock({
      selectGet: {
        id: 'p1',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        state: 'st',
        accountId: 'ws1',
        serverName: 'srv',
        serverUrl: 'https://mcp.example.com',
        issuerUrl: 'https://auth.example.com',
        codeVerifier: '{}',
        tokenEndpoint: 'https://auth.example.com/token',
        scope: null,
      },
    });
    mocks.getDb.mockReturnValue(drizzleMock);

    const result = await consumeMcpOAuthPending(makeDb(), makeEnv(), 'st');
    expect(result).toBeNull();
    expect(drizzleMock.delete).toHaveBeenCalled();
  });

  it('returns null when record does not exist', async () => {
    const drizzleMock = createDrizzleMock({ selectGet: undefined });
    mocks.getDb.mockReturnValue(drizzleMock);

    const result = await consumeMcpOAuthPending(makeDb(), makeEnv(), 'some_state');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listMcpServers / deleteMcpServer / updateMcpServer
// ---------------------------------------------------------------------------

import { listMcpServers, deleteMcpServer, updateMcpServer } from '@/services/platform/mcp';

describe('listMcpServers', () => {
  it('returns mapped server records', async () => {
    const serverRow = {
      id: 's1',
      accountId: 'ws1',
      name: 'my_mcp',
      url: 'https://mcp.example.com',
      transport: 'streamable-http',
      sourceType: 'external',
      authMode: 'oauth_pkce',
      serviceId: null,
      bundleDeploymentId: null,
      oauthScope: 'read',
      oauthIssuerUrl: 'https://auth.example.com',
      oauthTokenExpiresAt: null,
      enabled: true,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };
    const drizzleMock = createDrizzleMock({ selectAll: [serverRow] });
    mocks.getDb.mockReturnValue(drizzleMock);

    const servers = await listMcpServers(makeDb(), 'ws1');

    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe('my_mcp');
    expect(servers[0].enabled).toBe(true);
    expect(servers[0].bundleDeploymentId).toBeNull();
  });
});

describe('deleteMcpServer', () => {
  it('returns false when server not found', async () => {
    const drizzleMock = createDrizzleMock({ selectGet: undefined });
    mocks.getDb.mockReturnValue(drizzleMock);

    const result = await deleteMcpServer(makeDb(), 'ws1', 'nonexistent');
    expect(result).toBe(false);
  });

  it('deletes and returns true when found', async () => {
    const drizzleMock = createDrizzleMock({
      selectGet: { id: 's1', sourceType: 'external' },
    });
    mocks.getDb.mockReturnValue(drizzleMock);

    const result = await deleteMcpServer(makeDb(), 'ws1', 's1');
    expect(result).toBe(true);
    expect(drizzleMock.delete).toHaveBeenCalled();
  });
});

describe('updateMcpServer', () => {
  it('returns null when server not found', async () => {
    const drizzleMock = createDrizzleMock({ selectGet: undefined });
    mocks.getDb.mockReturnValue(drizzleMock);

    const result = await updateMcpServer(makeDb(), 'ws1', 'nonexistent', { enabled: false });
    expect(result).toBeNull();
  });

  it('updates enabled flag', async () => {
    const updatedRow = {
      id: 's1',
      accountId: 'ws1',
      name: 'my_mcp',
      url: 'https://mcp.example.com',
      transport: 'streamable-http',
      sourceType: 'external',
      authMode: 'oauth_pkce',
      serviceId: null,
      bundleDeploymentId: null,
      oauthScope: null,
      oauthIssuerUrl: null,
      oauthTokenExpiresAt: null,
      enabled: false,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z',
    };

    let selectCallIdx = 0;
    const selectResults = [
      { id: 's1', sourceType: 'external' },
      updatedRow,
    ];

    const runFn = vi.fn().mockResolvedValue(undefined);
    const drizzleMock = {
      select: vi.fn().mockImplementation(() => {
        const result = selectResults[selectCallIdx++];
        const chain = {
          get: vi.fn().mockResolvedValue(result),
          all: vi.fn().mockResolvedValue([]),
        };
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue(chain),
            get: vi.fn().mockResolvedValue(result),
            all: vi.fn().mockResolvedValue([]),
          }),
        };
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ run: runFn }),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ run: runFn }),
      }),
    };
    mocks.getDb.mockReturnValue(drizzleMock);

    const result = await updateMcpServer(makeDb(), 'ws1', 's1', { enabled: false });
    expect(result).not.toBeNull();
    expect(result?.enabled).toBe(false);
    expect(result?.bundleDeploymentId).toBeNull();
  });
});
