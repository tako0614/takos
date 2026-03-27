import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '@/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  consumePending: vi.fn(),
  completeFlow: vi.fn(),
  listServers: vi.fn(),
  deleteServer: vi.fn(),
  updateServer: vi.fn(),
  requireSpaceAccess: vi.fn(),
}));

vi.mock('@/services/platform/mcp', () => ({
  consumeMcpOAuthPending: mocks.consumePending,
  completeMcpOAuthFlow: mocks.completeFlow,
  listMcpServers: mocks.listServers,
  deleteMcpServer: mocks.deleteServer,
  updateMcpServer: mocks.updateServer,
}));

// Mock requireSpaceAccess helper
vi.mock('@/routes/shared/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/routes/shared/helpers')>();
  return {
    ...actual,
    requireSpaceAccess: mocks.requireSpaceAccess,
  };
});

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

describe('GET /mcp/oauth/callback', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when error param is present', async () => {
    const app = createApp();
    const res = await app.request('/mcp/oauth/callback?error=access_denied', {}, makeEnv());
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('Authorization Failed');
  });

  it('returns 400 when code or state missing', async () => {
    const app = createApp();
    const res = await app.request('/mcp/oauth/callback?code=abc', {}, makeEnv());
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('Missing code or state');
  });

  it('returns 400 when state is invalid (not found)', async () => {
    mocks.consumePending.mockResolvedValue(null);

    const app = createApp();
    const res = await app.request('/mcp/oauth/callback?code=abc&state=bad_state', {}, makeEnv());
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('Invalid or expired');
  });

  it('returns success HTML when callback completes', async () => {
    mocks.consumePending.mockResolvedValue({
      id: 'p1',
      spaceId: 'ws1',
      serverName: 'my_server',
      serverUrl: 'https://mcp.example.com',
      issuerUrl: 'https://auth.example.com',
      codeVerifier: 'verifier',
      tokenEndpoint: 'https://auth.example.com/token',
      scope: null,
    });
    mocks.completeFlow.mockResolvedValue({ serverId: 's1' });

    const app = createApp();
    const res = await app.request(
      '/mcp/oauth/callback?code=real_code&state=valid_state',
      {},
      makeEnv(),
    );

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('Connected');
    expect(text).toContain('my_server');
  });

  it('returns 500 when completeMcpOAuthFlow throws', async () => {
    mocks.consumePending.mockResolvedValue({
      id: 'p1',
      spaceId: 'ws1',
      serverName: 'srv',
      serverUrl: 'https://mcp.example.com',
      issuerUrl: 'https://auth.example.com',
      codeVerifier: 'verifier',
      tokenEndpoint: 'https://auth.example.com/token',
      scope: null,
    });
    mocks.completeFlow.mockRejectedValue(new Error('token exchange error'));

    const app = createApp();
    const res = await app.request(
      '/mcp/oauth/callback?code=code&state=state',
      {},
      makeEnv(),
    );

    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain('Failed to exchange');
  });

  it('prevents replay: consumeMcpOAuthPending returns null on second call', async () => {
    // First call: valid
    mocks.consumePending.mockResolvedValueOnce({
      id: 'p1',
      spaceId: 'ws1',
      serverName: 'srv',
      serverUrl: 'https://mcp.example.com',
      issuerUrl: 'https://auth.example.com',
      codeVerifier: 'verifier',
      tokenEndpoint: 'https://auth.example.com/token',
      scope: null,
    });
    mocks.completeFlow.mockResolvedValue({ serverId: 's1' });

    const app = createApp();

    const res1 = await app.request('/mcp/oauth/callback?code=c&state=st', {}, makeEnv());
    expect(res1.status).toBe(200);

    // Second call: replay returns null (already consumed)
    mocks.consumePending.mockResolvedValueOnce(null);
    const res2 = await app.request('/mcp/oauth/callback?code=c&state=st', {}, makeEnv());
    expect(res2.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /mcp/servers
// ---------------------------------------------------------------------------

describe('GET /mcp/servers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSpaceAccess.mockResolvedValue({ workspace: { id: 'ws1' } });
    mocks.listServers.mockResolvedValue([]);
  });

  it('returns 401 when unauthenticated', async () => {
    const app = createApp(); // no user
    const res = await app.request('/mcp/servers?spaceId=ws1', {}, makeEnv());
    expect(res.status).toBe(401);
  });

  it('returns 400 when spaceId missing', async () => {
    const app = createApp({ id: 'user1' });
    const res = await app.request('/mcp/servers', {}, makeEnv());
    expect(res.status).toBe(400);
  });

  it('returns server list for authorized user', async () => {
    mocks.listServers.mockResolvedValue([
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
    ]);

    const app = createApp({ id: 'user1' });
    const res = await app.request('/mcp/servers?spaceId=ws1', {}, makeEnv());
    expect(res.status).toBe(200);

    const body = await res.json() as { data: Array<{ name: string; bundle_deployment_id: string | null }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe('my_mcp');
    expect(body.data[0].bundle_deployment_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DELETE /mcp/servers/:id
// ---------------------------------------------------------------------------

describe('DELETE /mcp/servers/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSpaceAccess.mockResolvedValue({ workspace: { id: 'ws1' } });
  });

  it('returns 404 when server not found', async () => {
    mocks.deleteServer.mockResolvedValue(false);

    const app = createApp({ id: 'user1' });
    const res = await app.request(
      '/mcp/servers/nonexistent?spaceId=ws1',
      { method: 'DELETE' },
      makeEnv(),
    );
    expect(res.status).toBe(404);
  });

  it('deletes and returns success', async () => {
    mocks.deleteServer.mockResolvedValue(true);

    const app = createApp({ id: 'user1' });
    const res = await app.request(
      '/mcp/servers/s1?spaceId=ws1',
      { method: 'DELETE' },
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PATCH /mcp/servers/:id
// ---------------------------------------------------------------------------

describe('PATCH /mcp/servers/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSpaceAccess.mockResolvedValue({ workspace: { id: 'ws1' } });
  });

  it('returns 404 when server not found', async () => {
    mocks.updateServer.mockResolvedValue(null);

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
    expect(res.status).toBe(404);
  });

  it('updates server and returns updated record', async () => {
    mocks.updateServer.mockResolvedValue({
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
    });

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
    expect(res.status).toBe(200);

    const body = await res.json() as { data: { enabled: boolean; bundle_deployment_id: string | null } };
    expect(body.data.enabled).toBe(false);
    expect(body.data.bundle_deployment_id).toBeNull();
  });
});
