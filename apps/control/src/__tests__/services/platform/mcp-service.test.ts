import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  generateId: vi.fn().mockReturnValue('mcp-new'),
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@/shared/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/utils')>()),
  generateId: mocks.generateId,
}));

import {
  assertAllowedMcpEndpointUrl,
  getMcpEndpointUrlOptions,
  listMcpServers,
  deleteMcpServer,
  updateMcpServer,
} from '@/services/platform/mcp';

function createDrizzleMock() {
  const getMock = vi.fn();
  const allMock = vi.fn();
  const runMock = vi.fn();
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    get: getMock,
    all: allMock,
    run: runMock,
  };
  return {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    _: { get: getMock, all: allMock, run: runMock },
  };
}

describe('getMcpEndpointUrlOptions', () => {
  it('returns strict options for production', () => {
    const options = getMcpEndpointUrlOptions({ ENVIRONMENT: 'production' } as any);
    expect(options.allowHttp).toBe(false);
    expect(options.allowLocalhost).toBe(false);
    expect(options.allowPrivateIp).toBe(false);
  });

  it('returns permissive options for development', () => {
    const options = getMcpEndpointUrlOptions({ ENVIRONMENT: 'development' } as any);
    expect(options.allowHttp).toBe(true);
    expect(options.allowLocalhost).toBe(true);
    expect(options.allowPrivateIp).toBe(true);
  });
});

describe('assertAllowedMcpEndpointUrl', () => {
  const strictOptions = {
    allowHttp: false,
    allowLocalhost: false,
    allowPrivateIp: false,
  };

  it('accepts valid HTTPS URL', () => {
    const url = assertAllowedMcpEndpointUrl('https://api.example.com/mcp', strictOptions, 'test');
    expect(url.hostname).toBe('api.example.com');
  });

  it('rejects invalid URL', () => {
    expect(() =>
      assertAllowedMcpEndpointUrl('not-a-url', strictOptions, 'test'),
    ).toThrow('test URL is invalid');
  });

  it('rejects HTTP when not allowed', () => {
    expect(() =>
      assertAllowedMcpEndpointUrl('http://api.example.com', strictOptions, 'test'),
    ).toThrow('test URL must use HTTPS');
  });

  it('allows HTTP when option enabled', () => {
    const url = assertAllowedMcpEndpointUrl(
      'http://api.example.com',
      { ...strictOptions, allowHttp: true },
      'test',
    );
    expect(url.protocol).toBe('http:');
  });

  it('rejects URLs with credentials', () => {
    expect(() =>
      assertAllowedMcpEndpointUrl('https://user:pass@api.example.com', strictOptions, 'test'),
    ).toThrow('must not include credentials');
  });
});

describe('listMcpServers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when no servers', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([]);
    mocks.getDb.mockReturnValue(drizzle);

    const servers = await listMcpServers({} as D1Database, 'ws-1');
    expect(servers).toEqual([]);
  });

  it('maps server rows correctly', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([
      {
        id: 'srv-1',
        accountId: 'ws-1',
        name: 'test-server',
        url: 'https://mcp.example.com',
        transport: 'streamable-http',
        sourceType: 'external',
        authMode: 'oauth_pkce',
        serviceId: null,
        bundleDeploymentId: null,
        oauthScope: 'read write',
        oauthIssuerUrl: 'https://auth.example.com',
        oauthAccessToken: null,
        oauthRefreshToken: null,
        oauthTokenExpiresAt: null,
        enabled: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    mocks.getDb.mockReturnValue(drizzle);

    const servers = await listMcpServers({} as D1Database, 'ws-1');
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe('test-server');
    expect(servers[0].transport).toBe('streamable-http');
    expect(servers[0].enabled).toBe(true);
  });
});

describe('deleteMcpServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false when server not found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(undefined);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await deleteMcpServer({} as D1Database, 'ws-1', 'nonexistent');
    expect(result).toBe(false);
  });

  it('throws when attempting to delete managed server', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce({ id: 'srv-1', sourceType: 'worker' });
    mocks.getDb.mockReturnValue(drizzle);

    await expect(
      deleteMcpServer({} as D1Database, 'ws-1', 'srv-1'),
    ).rejects.toThrow('Managed MCP servers must be removed');
  });

  it('deletes external server successfully', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce({ id: 'srv-1', sourceType: 'external' });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await deleteMcpServer({} as D1Database, 'ws-1', 'srv-1');
    expect(result).toBe(true);
    expect(drizzle.delete).toHaveBeenCalled();
  });
});

describe('updateMcpServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when server not found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(undefined);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await updateMcpServer({} as D1Database, 'ws-1', 'nonexistent', { enabled: false });
    expect(result).toBeNull();
  });

  it('throws when renaming managed server', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce({ id: 'srv-1', sourceType: 'worker' });
    mocks.getDb.mockReturnValue(drizzle);

    await expect(
      updateMcpServer({} as D1Database, 'ws-1', 'srv-1', { name: 'new-name' }),
    ).rejects.toThrow('Managed MCP server names are controlled');
  });

  it('updates enabled status for external server', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get
      .mockResolvedValueOnce({ id: 'srv-1', sourceType: 'external' }) // lookup
      .mockResolvedValueOnce({
        id: 'srv-1',
        accountId: 'ws-1',
        name: 'server',
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
        createdAt: '2026-01-01',
        updatedAt: '2026-03-24',
      }); // re-read
    mocks.getDb.mockReturnValue(drizzle);

    const result = await updateMcpServer({} as D1Database, 'ws-1', 'srv-1', { enabled: false });
    expect(result).not.toBeNull();
    expect(drizzle.update).toHaveBeenCalled();
  });
});
