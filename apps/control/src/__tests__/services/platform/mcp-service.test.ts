import type { D1Database } from '@cloudflare/workers-types';

import { assertEquals, assertNotEquals, assert, assertThrows, assertRejects } from 'jsr:@std/assert';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  generateId: (() => 'mcp-new'),
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils'
import {
  assertAllowedMcpEndpointUrl,
  getMcpEndpointUrlOptions,
  listMcpServers,
  deleteMcpServer,
  updateMcpServer,
} from '@/services/platform/mcp';

function createDrizzleMock() {
  const getMock = ((..._args: any[]) => undefined) as any;
  const allMock = ((..._args: any[]) => undefined) as any;
  const runMock = ((..._args: any[]) => undefined) as any;
  const chain = {
    from: (function(this: any) { return this; }),
    where: (function(this: any) { return this; }),
    set: (function(this: any) { return this; }),
    values: (function(this: any) { return this; }),
    returning: (function(this: any) { return this; }),
    orderBy: (function(this: any) { return this; }),
    limit: (function(this: any) { return this; }),
    onConflictDoUpdate: (function(this: any) { return this; }),
    get: getMock,
    all: allMock,
    run: runMock,
  };
  return {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    _: { get: getMock, all: allMock, run: runMock },
  };
}


  Deno.test('getMcpEndpointUrlOptions - returns strict options for production', () => {
  const options = getMcpEndpointUrlOptions({ ENVIRONMENT: 'production' } as any);
    assertEquals(options.allowHttp, false);
    assertEquals(options.allowLocalhost, false);
    assertEquals(options.allowPrivateIp, false);
})
  Deno.test('getMcpEndpointUrlOptions - returns permissive options for development', () => {
  const options = getMcpEndpointUrlOptions({ ENVIRONMENT: 'development' } as any);
    assertEquals(options.allowHttp, true);
    assertEquals(options.allowLocalhost, true);
    assertEquals(options.allowPrivateIp, true);
})

  const strictOptions = {
    allowHttp: false,
    allowLocalhost: false,
    allowPrivateIp: false,
  };

  Deno.test('assertAllowedMcpEndpointUrl - accepts valid HTTPS URL', () => {
  const url = assertAllowedMcpEndpointUrl('https://api.example.com/mcp', strictOptions, 'test');
    assertEquals(url.hostname, 'api.example.com');
})
  Deno.test('assertAllowedMcpEndpointUrl - rejects invalid URL', () => {
  assertThrows(() => { () =>
      assertAllowedMcpEndpointUrl('not-a-url', strictOptions, 'test'),
    ; }, 'test URL is invalid');
})
  Deno.test('assertAllowedMcpEndpointUrl - rejects HTTP when not allowed', () => {
  assertThrows(() => { () =>
      assertAllowedMcpEndpointUrl('http://api.example.com', strictOptions, 'test'),
    ; }, 'test URL must use HTTPS');
})
  Deno.test('assertAllowedMcpEndpointUrl - allows HTTP when option enabled', () => {
  const url = assertAllowedMcpEndpointUrl(
      'http://api.example.com',
      { ...strictOptions, allowHttp: true },
      'test',
    );
    assertEquals(url.protocol, 'http:');
})
  Deno.test('assertAllowedMcpEndpointUrl - rejects URLs with credentials', () => {
  assertThrows(() => { () =>
      assertAllowedMcpEndpointUrl('https://user:pass@api.example.com', strictOptions, 'test'),
    ; }, 'must not include credentials');
})

  Deno.test('listMcpServers - returns empty array when no servers', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => []) as any;
    mocks.getDb = (() => drizzle) as any;

    const servers = await listMcpServers({} as D1Database, 'ws-1');
    assertEquals(servers, []);
})
  Deno.test('listMcpServers - maps server rows correctly', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => [
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
    ]) as any;
    mocks.getDb = (() => drizzle) as any;

    const servers = await listMcpServers({} as D1Database, 'ws-1');
    assertEquals(servers.length, 1);
    assertEquals(servers[0].name, 'test-server');
    assertEquals(servers[0].transport, 'streamable-http');
    assertEquals(servers[0].enabled, true);
})

  Deno.test('deleteMcpServer - returns false when server not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => undefined) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await deleteMcpServer({} as D1Database, 'ws-1', 'nonexistent');
    assertEquals(result, false);
})
  Deno.test('deleteMcpServer - throws when attempting to delete managed server', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => ({ id: 'srv-1', sourceType: 'worker' })) as any;
    mocks.getDb = (() => drizzle) as any;

    await await assertRejects(async () => { await 
      deleteMcpServer({} as D1Database, 'ws-1', 'srv-1'),
    ; }, 'Managed MCP servers must be removed');
})
  Deno.test('deleteMcpServer - deletes external server successfully', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => ({ id: 'srv-1', sourceType: 'external' })) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await deleteMcpServer({} as D1Database, 'ws-1', 'srv-1');
    assertEquals(result, true);
    assert(drizzle.delete.calls.length > 0);
})

  Deno.test('updateMcpServer - returns null when server not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => undefined) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await updateMcpServer({} as D1Database, 'ws-1', 'nonexistent', { enabled: false });
    assertEquals(result, null);
})
  Deno.test('updateMcpServer - throws when renaming managed server', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => ({ id: 'srv-1', sourceType: 'worker' })) as any;
    mocks.getDb = (() => drizzle) as any;

    await await assertRejects(async () => { await 
      updateMcpServer({} as D1Database, 'ws-1', 'srv-1', { name: 'new-name' }),
    ; }, 'Managed MCP server names are controlled');
})
  Deno.test('updateMcpServer - updates enabled status for external server', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get
       = (async () => ({ id: 'srv-1', sourceType: 'external' })) as any // lookup
       = (async () => ({
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
      })) as any; // re-read
    mocks.getDb = (() => drizzle) as any;

    const result = await updateMcpServer({} as D1Database, 'ws-1', 'srv-1', { enabled: false });
    assertNotEquals(result, null);
    assert(drizzle.update.calls.length > 0);
})