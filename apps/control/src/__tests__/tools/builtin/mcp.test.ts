import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolContext } from '@/tools/types';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '@/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSelectGet = vi.fn();

const mockDb = {
  mcpServer: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    findMany: vi.fn(),
    delete: vi.fn(),
  },
  mcpOAuthPending: {
    create: vi.fn(),
  },
  // Drizzle-chainable select: db.select({...}).from(table).where(...).get()
  select: vi.fn(() => {
    const chain = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      get: vi.fn(() => mockSelectGet()),
      all: vi.fn(() => mockSelectGet()),
    };
    return chain;
  }),
  // Drizzle-chainable insert: db.insert(table).values({...}).run()
  insert: vi.fn(() => ({
    values: vi.fn(() => ({
      run: vi.fn(async () => ({})),
      onConflictDoUpdate: vi.fn(() => ({
        run: vi.fn(async () => ({})),
      })),
    })),
  })),
  // Drizzle-chainable update: db.update(table).set({...}).where(...)
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(async () => ({})),
      run: vi.fn(async () => ({})),
    })),
  })),
};

vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>();
  return {
    ...actual,
    getDb: () => mockDb,
  };
});

vi.mock('@/services/platform/mcp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/platform/mcp')>();
  return {
    ...actual,
    registerExternalMcpServer: vi.fn(actual.registerExternalMcpServer),
    discoverOAuthMetadata: vi.fn(),
    createMcpOAuthPending: vi.fn(),
    listMcpServers: vi.fn(),
    deleteMcpServer: vi.fn(),
  };
});

import {
  registerExternalMcpServer,
  discoverOAuthMetadata,
  createMcpOAuthPending,
  listMcpServers,
  deleteMcpServer,
} from '@/services/platform/mcp';

import {
  mcpAddServerHandler,
  mcpListServersHandler,
  mcpRemoveServerHandler,
} from '@/tools/builtin/mcp';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: 'ws_test',
    threadId: 'th_test',
    runId: 'run_test',
    userId: 'user_test',
    capabilities: ['egress.http'],
    env: {
      ENVIRONMENT: 'production',
      ADMIN_DOMAIN: 'takos.example.com',
      ENCRYPTION_KEY: 'a'.repeat(64),
    } as unknown as Env,
    db: {} as D1Database,
    setSessionId: vi.fn(),
    getLastContainerStartFailure: vi.fn(() => undefined),
    setLastContainerStartFailure: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// mcp_add_server
// ---------------------------------------------------------------------------

describe('mcp_add_server', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(registerExternalMcpServer).mockImplementation(async (...args) => {
      const actual = await vi.importActual<typeof import('@/services/platform/mcp')>('@/services/platform/mcp');
      return actual.registerExternalMcpServer(...args);
    });
    mockDb.mcpServer.findFirst.mockResolvedValue(null);
    mockDb.mcpServer.create.mockResolvedValue({});
    // Drizzle select chain returns null by default (no existing server)
    mockSelectGet.mockResolvedValue(null);
  });

  it('rejects non-HTTPS URLs in production', async () => {
    await expect(
      mcpAddServerHandler({ url: 'http://evil.com', name: 'bad' }, makeContext()),
    ).rejects.toThrow('must use HTTPS');
  });

  it('allows http in development environment', async () => {
    vi.mocked(discoverOAuthMetadata).mockRejectedValue(new Error('no metadata'));

    const ctx = makeContext({ env: { ENVIRONMENT: 'development', ADMIN_DOMAIN: 'localhost', ENCRYPTION_KEY: 'a'.repeat(64) } as unknown as Env });
    const result = JSON.parse(
      await mcpAddServerHandler({ url: 'http://localhost:8080', name: 'local_srv' }, ctx),
    );

    expect(result.status).toBe('registered');
  });

  it('rejects invalid server names', async () => {
    await expect(
      mcpAddServerHandler(
        { url: 'https://mcp.example.com', name: '123invalid' },
        makeContext(),
      ),
    ).rejects.toThrow('name must start with a letter');
  });

  it('returns already_registered when server has token', async () => {
    vi.mocked(registerExternalMcpServer).mockResolvedValue({
      status: 'already_registered',
      name: 'my_mcp',
      url: 'https://mcp.example.com',
      message: 'already registered',
    });

    const result = JSON.parse(
      await mcpAddServerHandler(
        { url: 'https://mcp.example.com', name: 'my_mcp' },
        makeContext(),
      ),
    );

    expect(result.status).toBe('already_registered');
  });

  it('registers without OAuth when discovery fails', async () => {
    vi.mocked(registerExternalMcpServer).mockResolvedValue({
      status: 'registered',
      name: 'noauth_srv',
      url: 'https://mcp.example.com',
      message: 'registered without oauth',
    });

    const result = JSON.parse(
      await mcpAddServerHandler(
        { url: 'https://mcp.example.com', name: 'noauth_srv' },
        makeContext(),
      ),
    );

    expect(result.status).toBe('registered');
  });

  it('returns pending_oauth when OAuth metadata discovered', async () => {
    vi.mocked(registerExternalMcpServer).mockResolvedValue({
      status: 'pending_oauth',
      name: 'oauth_srv',
      url: 'https://mcp.example.com',
      authUrl: 'https://auth.example.com/auth?client_id=takos',
      message: 'authorize this server',
    });

    const result = JSON.parse(
      await mcpAddServerHandler(
        { url: 'https://mcp.example.com', name: 'oauth_srv' },
        makeContext(),
      ),
    );

    expect(result.status).toBe('pending_oauth');
    expect(result.auth_url).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// mcp_list_servers
// ---------------------------------------------------------------------------

describe('mcp_list_servers', () => {
  it('returns list of servers', async () => {
    vi.mocked(listMcpServers).mockResolvedValue([
      {
        id: 's1',
        spaceId: 'ws_test',
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
      },
    ]);

    const result = JSON.parse(await mcpListServersHandler({}, makeContext()));

    expect(result.count).toBe(1);
    expect(result.servers[0].name).toBe('my_mcp');
    expect(result.servers[0].enabled).toBe(true);
    expect(result.servers[0].bundle_deployment_id).toBeNull();
  });

  it('returns empty list when no servers registered', async () => {
    vi.mocked(listMcpServers).mockResolvedValue([]);

    const result = JSON.parse(await mcpListServersHandler({}, makeContext()));
    expect(result.count).toBe(0);
    expect(result.servers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// mcp_remove_server
// ---------------------------------------------------------------------------

describe('mcp_remove_server', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns not_found when server does not exist', async () => {
    mockSelectGet.mockResolvedValue(null);

    const result = JSON.parse(
      await mcpRemoveServerHandler({ name: 'missing' }, makeContext()),
    );
    expect(result.status).toBe('not_found');
  });

  it('deletes and returns removed status', async () => {
    mockSelectGet.mockResolvedValue({ id: 's1' });
    vi.mocked(deleteMcpServer).mockResolvedValue(true);

    const result = JSON.parse(
      await mcpRemoveServerHandler({ name: 'my_mcp' }, makeContext()),
    );
    expect(result.status).toBe('removed');
  });
});
