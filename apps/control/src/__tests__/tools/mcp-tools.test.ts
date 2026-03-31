import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '@/types';

import { assertEquals } from 'jsr:@std/assert';
import { assertSpyCalls } from 'jsr:@std/testing/mock';

const {
  mockAll,
  mockConnect,
  mockListTools,
  mockClose,
  mockDecryptAccessToken,
  mockRefreshMcpToken,
  mockAssertAllowedMcpEndpointUrl,
  mockGetMcpEndpointUrlOptions,
} = ({
  mockAll: ((..._args: any[]) => undefined) as any,
  mockConnect: async () => {},
  mockListTools: async () => [{
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
  }],
  mockClose: async () => {},
  mockDecryptAccessToken: async () => 'oauth-token',
  mockRefreshMcpToken: async () => {},
  mockAssertAllowedMcpEndpointUrl: ((..._args: any[]) => undefined) as any,
  mockGetMcpEndpointUrlOptions: () => ({}),
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/platform/mcp'
// [Deno] vi.mock removed - manually stub imports from '@/tools/mcp-client'
import { loadMcpTools } from '@/tools/mcp-tools';

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


  Deno.test('loadMcpTools exposure filtering - does not connect to MCP servers for viewer runs', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mockAll = (async () => [MANAGED_SERVER, EXTERNAL_SERVER]) as any;
  const result = await loadMcpTools(
      {} as D1Database,
      'ws-1',
      {} as Env,
      new Set(),
      { role: 'viewer', capabilities: ['repo.read', 'storage.read'] },
    );

    assertEquals(result.tools.size, 0);
    assertSpyCalls(mockAssertAllowedMcpEndpointUrl, 0);
    assertSpyCalls(mockConnect, 0);
    assertSpyCalls(mockDecryptAccessToken, 0);
    assertSpyCalls(mockRefreshMcpToken, 0);
})
  Deno.test('loadMcpTools exposure filtering - skips external MCP servers when the run lacks egress capability', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mockAll = (async () => [MANAGED_SERVER, EXTERNAL_SERVER]) as any;
  const result = await loadMcpTools(
      {} as D1Database,
      'ws-1',
      {} as Env,
      new Set(),
      { role: 'editor', capabilities: ['repo.read', 'repo.write', 'storage.read', 'storage.write'] },
    );

    assertEquals(result.tools.size, 1);
    assertEquals(Array.from(result.tools.keys()), ['remote_tool']);
    assertSpyCalls(mockConnect, 1);
    assertSpyCalls(mockDecryptAccessToken, 0);
    assertSpyCalls(mockRefreshMcpToken, 0);
})