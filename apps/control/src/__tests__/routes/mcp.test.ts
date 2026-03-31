import { Hono } from 'hono';
import type { Env } from '@/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

import { assertEquals, assertStringIncludes } from 'jsr:@std/assert';

const mocks = ({
  consumePending: ((..._args: any[]) => undefined) as any,
  completeFlow: ((..._args: any[]) => undefined) as any,
  listServers: ((..._args: any[]) => undefined) as any,
  deleteServer: ((..._args: any[]) => undefined) as any,
  updateServer: ((..._args: any[]) => undefined) as any,
  requireSpaceAccess: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/services/platform/mcp'
// Mock requireSpaceAccess helper
// [Deno] vi.mock removed - manually stub imports from '@/routes/shared/helpers'
import mcpRoutes from '@/routes/mcp';

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

function createApp(user?: { id: string }) {
  const app = new Hono<{ Bindings: Env; Variables: { user?: { id: string } } }>();

  // Inject user variable
  app.use('*', async (c, next) => {
    if (user) c.set('user', user);
    await next();
  });

  app.route('/mcp', mcpRoutes);
  return app;
}

function makeEnv(): Partial<Env> {
  return {
    DB: {} as Env['DB'],
    ADMIN_DOMAIN: 'takos.example.com',
    ENCRYPTION_KEY: 'a'.repeat(64),
  };
}

// ---------------------------------------------------------------------------
// OAuth Callback
// ---------------------------------------------------------------------------


  
  Deno.test('GET /mcp/oauth/callback - returns 400 when error param is present', async () => {
  const app = createApp();
    const res = await app.request('/mcp/oauth/callback?error=access_denied', {}, makeEnv());
    assertEquals(res.status, 400);
    const text = await res.text();
    assertStringIncludes(text, 'Authorization Failed');
})
  Deno.test('GET /mcp/oauth/callback - returns 400 when code or state missing', async () => {
  const app = createApp();
    const res = await app.request('/mcp/oauth/callback?code=abc', {}, makeEnv());
    assertEquals(res.status, 400);
    const text = await res.text();
    assertStringIncludes(text, 'Missing code or state');
})
  Deno.test('GET /mcp/oauth/callback - returns 400 when state is invalid (not found)', async () => {
  mocks.consumePending = (async () => null) as any;

    const app = createApp();
    const res = await app.request('/mcp/oauth/callback?code=abc&state=bad_state', {}, makeEnv());
    assertEquals(res.status, 400);
    const text = await res.text();
    assertStringIncludes(text, 'Invalid or expired');
})
  Deno.test('GET /mcp/oauth/callback - returns success HTML when callback completes', async () => {
  mocks.consumePending = (async () => ({
      id: 'p1',
      spaceId: 'ws1',
      serverName: 'my_server',
      serverUrl: 'https://mcp.example.com',
      issuerUrl: 'https://auth.example.com',
      codeVerifier: 'verifier',
      tokenEndpoint: 'https://auth.example.com/token',
      scope: null,
    })) as any;
    mocks.completeFlow = (async () => ({ serverId: 's1' })) as any;

    const app = createApp();
    const res = await app.request(
      '/mcp/oauth/callback?code=real_code&state=valid_state',
      {},
      makeEnv(),
    );

    assertEquals(res.status, 200);
    const text = await res.text();
    assertStringIncludes(text, 'Connected');
    assertStringIncludes(text, 'my_server');
})
  Deno.test('GET /mcp/oauth/callback - returns 500 when completeMcpOAuthFlow throws', async () => {
  mocks.consumePending = (async () => ({
      id: 'p1',
      spaceId: 'ws1',
      serverName: 'srv',
      serverUrl: 'https://mcp.example.com',
      issuerUrl: 'https://auth.example.com',
      codeVerifier: 'verifier',
      tokenEndpoint: 'https://auth.example.com/token',
      scope: null,
    })) as any;
    mocks.completeFlow = (async () => { throw new Error('token exchange error'); }) as any;

    const app = createApp();
    const res = await app.request(
      '/mcp/oauth/callback?code=code&state=state',
      {},
      makeEnv(),
    );

    assertEquals(res.status, 500);
    const text = await res.text();
    assertStringIncludes(text, 'Failed to exchange');
})
  Deno.test('GET /mcp/oauth/callback - prevents replay: consumeMcpOAuthPending returns null on second call', async () => {
  // First call: valid
    mocks.consumePending = (async () => ({
      id: 'p1',
      spaceId: 'ws1',
      serverName: 'srv',
      serverUrl: 'https://mcp.example.com',
      issuerUrl: 'https://auth.example.com',
      codeVerifier: 'verifier',
      tokenEndpoint: 'https://auth.example.com/token',
      scope: null,
    })) as any;
    mocks.completeFlow = (async () => ({ serverId: 's1' })) as any;

    const app = createApp();

    const res1 = await app.request('/mcp/oauth/callback?code=c&state=st', {}, makeEnv());
    assertEquals(res1.status, 200);

    // Second call: replay returns null (already consumed)
    mocks.consumePending = (async () => null) as any;
    const res2 = await app.request('/mcp/oauth/callback?code=c&state=st', {}, makeEnv());
    assertEquals(res2.status, 400);
})
// ---------------------------------------------------------------------------
// GET /mcp/servers
// ---------------------------------------------------------------------------


  Deno.test('GET /mcp/servers - returns 401 when unauthenticated', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws1' } })) as any;
    mocks.listServers = (async () => []) as any;
  const app = createApp(); // no user
    const res = await app.request('/mcp/servers?spaceId=ws1', {}, makeEnv());
    assertEquals(res.status, 401);
})
  Deno.test('GET /mcp/servers - returns 400 when spaceId missing', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws1' } })) as any;
    mocks.listServers = (async () => []) as any;
  const app = createApp({ id: 'user1' });
    const res = await app.request('/mcp/servers', {}, makeEnv());
    assertEquals(res.status, 400);
})
  Deno.test('GET /mcp/servers - returns server list for authorized user', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws1' } })) as any;
    mocks.listServers = (async () => []) as any;
  mocks.listServers = (async () => [
      {
        id: 's1',
        spaceId: 'ws1',
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
        enabled: true,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    ]) as any;

    const app = createApp({ id: 'user1' });
    const res = await app.request('/mcp/servers?spaceId=ws1', {}, makeEnv());
    assertEquals(res.status, 200);

    const body = await res.json() as { data: Array<{ name: string; bundle_deployment_id: string | null }> };
    assertEquals(body.data.length, 1);
    assertEquals(body.data[0].name, 'my_mcp');
    assertEquals(body.data[0].bundle_deployment_id, null);
})
// ---------------------------------------------------------------------------
// DELETE /mcp/servers/:id
// ---------------------------------------------------------------------------


  Deno.test('DELETE /mcp/servers/:id - returns 404 when server not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws1' } })) as any;
  mocks.deleteServer = (async () => false) as any;

    const app = createApp({ id: 'user1' });
    const res = await app.request(
      '/mcp/servers/nonexistent?spaceId=ws1',
      { method: 'DELETE' },
      makeEnv(),
    );
    assertEquals(res.status, 404);
})
  Deno.test('DELETE /mcp/servers/:id - deletes and returns success', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws1' } })) as any;
  mocks.deleteServer = (async () => true) as any;

    const app = createApp({ id: 'user1' });
    const res = await app.request(
      '/mcp/servers/s1?spaceId=ws1',
      { method: 'DELETE' },
      makeEnv(),
    );
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean };
    assertEquals(body.success, true);
})
// ---------------------------------------------------------------------------
// PATCH /mcp/servers/:id
// ---------------------------------------------------------------------------


  Deno.test('PATCH /mcp/servers/:id - returns 404 when server not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws1' } })) as any;
  mocks.updateServer = (async () => null) as any;

    const app = createApp({ id: 'user1' });
    const res = await app.request(
      '/mcp/servers/nonexistent?spaceId=ws1',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      },
      makeEnv(),
    );
    assertEquals(res.status, 404);
})
  Deno.test('PATCH /mcp/servers/:id - updates server and returns updated record', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws1' } })) as any;
  mocks.updateServer = (async () => ({
      id: 's1',
      spaceId: 'ws1',
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
    })) as any;

    const app = createApp({ id: 'user1' });
    const res = await app.request(
      '/mcp/servers/s1?spaceId=ws1',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      },
      makeEnv(),
    );
    assertEquals(res.status, 200);

    const body = await res.json() as { data: { enabled: boolean; bundle_deployment_id: string | null } };
    assertEquals(body.data.enabled, false);
    assertEquals(body.data.bundle_deployment_id, null);
})