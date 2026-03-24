import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@takos/cloudflare-compat';
import type { Env } from '@/types';

const {
  mockAll,
  mockConnect,
  mockListTools,
  mockClose,
  mockDecryptAccessToken,
  mockRefreshMcpToken,
  mockAssertAllowedMcpEndpointUrl,
  mockGetMcpEndpointUrlOptions,
} = vi.hoisted(() => ({
  mockAll: vi.fn(),
  mockConnect: vi.fn(async () => {}),
  mockListTools: vi.fn(async () => [{
    sdkTool: { name: 'remote_tool' },
    definition: {
      name: 'remote_tool',
      description: 'Remote MCP tool',
      category: 'mcp',
      parameters: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
  }]),
  mockClose: vi.fn(async () => {}),
  mockDecryptAccessToken: vi.fn(async () => 'oauth-token'),
  mockRefreshMcpToken: vi.fn(async () => {}),
  mockAssertAllowedMcpEndpointUrl: vi.fn(),
  mockGetMcpEndpointUrlOptions: vi.fn(() => ({})),
}));

vi.mock('@/db', () => {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    all: vi.fn(() => mockAll()),
    get: vi.fn(),
  };

  return {
    getDb: () => ({
      select: vi.fn(() => chain),
    }),
    mcpServers: {
      id: 'id',
      name: 'name',
      url: 'url',
      sourceType: 'source_type',
      authMode: 'auth_mode',
      serviceId: 'service_id',
      bundleDeploymentId: 'bundle_deployment_id',
      oauthAccessToken: 'oauth_access_token',
      oauthRefreshToken: 'oauth_refresh_token',
      oauthIssuerUrl: 'oauth_issuer_url',
      oauthTokenExpiresAt: 'oauth_token_expires_at',
      enabled: 'enabled',
      accountId: 'account_id',
    },
  };
});

vi.mock('@/services/platform/mcp', () => ({
  refreshMcpToken: mockRefreshMcpToken,
  decryptAccessToken: mockDecryptAccessToken,
  assertAllowedMcpEndpointUrl: mockAssertAllowedMcpEndpointUrl,
  getMcpEndpointUrlOptions: mockGetMcpEndpointUrlOptions,
}));

vi.mock('@/tools/mcp-client', () => ({
  McpClient: class {
    connect = mockConnect;
    listTools = mockListTools;
    close = mockClose;
  },
}));

import { loadMcpTools } from '@/tools/loaders/mcp-tools';

const MANAGED_SERVER = {
  id: 'managed-1',
  name: 'managed',
  url: 'https://managed.example.com/mcp',
  sourceType: 'managed',
  authMode: 'none',
  serviceId: 'worker-1',
  bundleDeploymentId: null,
  oauthAccessToken: null,
  oauthRefreshToken: null,
  oauthIssuerUrl: null,
  oauthTokenExpiresAt: null,
};

const EXTERNAL_SERVER = {
  id: 'external-1',
  name: 'external',
  url: 'https://external.example.com/mcp',
  sourceType: 'external',
  authMode: 'oauth',
  serviceId: null,
  bundleDeploymentId: null,
  oauthAccessToken: 'encrypted-token',
  oauthRefreshToken: 'encrypted-refresh',
  oauthIssuerUrl: 'https://issuer.example.com',
  oauthTokenExpiresAt: null,
};

describe('loadMcpTools exposure filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAll.mockResolvedValue([MANAGED_SERVER, EXTERNAL_SERVER]);
  });

  it('does not connect to MCP servers for viewer runs', async () => {
    const result = await loadMcpTools(
      {} as D1Database,
      'ws-1',
      {} as Env,
      new Set(),
      { role: 'viewer', capabilities: ['repo.read', 'storage.read'] },
    );

    expect(result.tools.size).toBe(0);
    expect(mockAssertAllowedMcpEndpointUrl).not.toHaveBeenCalled();
    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockDecryptAccessToken).not.toHaveBeenCalled();
    expect(mockRefreshMcpToken).not.toHaveBeenCalled();
  });

  it('skips external MCP servers when the run lacks egress capability', async () => {
    const result = await loadMcpTools(
      {} as D1Database,
      'ws-1',
      {} as Env,
      new Set(),
      { role: 'editor', capabilities: ['repo.read', 'repo.write', 'storage.read', 'storage.write'] },
    );

    expect(result.tools.size).toBe(1);
    expect(Array.from(result.tools.keys())).toEqual(['remote_tool']);
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockDecryptAccessToken).not.toHaveBeenCalled();
    expect(mockRefreshMcpToken).not.toHaveBeenCalled();
  });
});
