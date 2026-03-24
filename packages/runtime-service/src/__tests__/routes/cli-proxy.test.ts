import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, testRequest } from '../setup.js';

const hoisted = vi.hoisted(() => {
  process.env.TAKOS_API_URL = 'https://takos.example.test';
  process.env.PROXY_BASE_URL = 'https://runtime-host.example.test';
  return {
    getSession: vi.fn(),
    fetch: vi.fn(),
  };
});

vi.mock('../../routes/sessions/storage.js', () => ({
  sessionStore: {
    getSession: hoisted.getSession,
  },
}));

import cliProxyRoutes from '../../routes/cli/proxy.js';

describe('cli-proxy route', () => {
  beforeEach(() => {
    hoisted.getSession.mockReset();
    hoisted.fetch.mockReset();
    vi.stubGlobal('fetch', hoisted.fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forwards query parameters via PROXY_BASE_URL while validating the path only', async () => {
    const app = createTestApp();
    app.route('/', cliProxyRoutes);

    hoisted.getSession.mockReturnValue({
      id: 'a12345678901234b',
      spaceId: 'space-a',
      proxyToken: 'random-proxy-token-abc',
      lastAccessedAt: 0,
    });
    hoisted.fetch.mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    });

    const response = await testRequest(app, {
      method: 'GET',
      path: '/cli-proxy/api/repos/repo-1/status',
      query: {
        ref: 'refs/heads/main',
        verbose: '1',
      },
      headers: {
        'X-Takos-Session-Id': 'a12345678901234b',
        'X-Takos-Space-Id': 'space-a',
      },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });

    expect(hoisted.fetch).toHaveBeenCalledTimes(1);
    const forwardedUrl = hoisted.fetch.mock.calls[0]?.[0] as string;
    const forwardedOptions = hoisted.fetch.mock.calls[0]?.[1] as { headers: Record<string, string>; method: string };

    expect(forwardedUrl).toBe('https://runtime-host.example.test/forward/cli-proxy/api/repos/repo-1/status?ref=refs%2Fheads%2Fmain&verbose=1');
    expect(forwardedOptions.method).toBe('GET');
    expect(forwardedOptions.headers['X-Takos-Session-Id']).toBe('a12345678901234b');
    expect(forwardedOptions.headers.Authorization).toBe('Bearer random-proxy-token-abc');
  });
});
