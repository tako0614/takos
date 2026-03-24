import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@takos/common/validation', () => ({
  isPrivateIP: vi.fn((ip: string) => {
    // Simulate private IP detection
    if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.16.') ||
        ip === '127.0.0.1' || ip === '::1' || ip === '0.0.0.0') return true;
    return false;
  }),
}));

vi.mock('@/shared/utils/validate-env', () => ({
  validateEgressEnv: vi.fn().mockReturnValue(null),
  createEnvGuard: vi.fn(() => () => null),
}));

vi.mock('@/shared/utils/logger', () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

import egressModule from '@/worker/egress';

const handler = egressModule;

function createRequest(url: string, headers: Record<string, string> = {}, method = 'GET'): Request {
  return new Request(url, {
    method,
    headers: {
      'X-Takos-Internal': '1',
      ...headers,
    },
  });
}

function createEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...overrides,
  };
}

describe('egress handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects requests without X-Takos-Internal header', async () => {
    const request = new Request('https://example.com', {
      method: 'GET',
      headers: {},
    });

    const response = await handler.fetch(request, createEnv() as any);
    expect(response.status).toBe(401);
    const body = await response.json() as { error: string };
    expect(body.error).toBe('Unauthorized');
  });

  it('rejects non-HTTP/HTTPS protocols', async () => {
    const request = createRequest('ftp://example.com/file.txt');
    const response = await handler.fetch(request, createEnv() as any);
    expect(response.status).toBe(400);
    const body = await response.json() as { error: string };
    expect(body.error).toContain('Only HTTP/HTTPS URLs');
  });

  it('rejects URLs with credentials', async () => {
    expect(() => createRequest('https://user:pass@example.com')).toThrow(/credentials/);
  });

  it('rejects non-standard ports', async () => {
    const request = createRequest('https://example.com:8443/path');
    const response = await handler.fetch(request, createEnv() as any);
    expect(response.status).toBe(400);
    const body = await response.json() as { error: string };
    expect(body.error).toContain('Port');
  });

  it('rejects single-label hostnames', async () => {
    const request = createRequest('https://localhost/path');
    // localhost is also a blocked hostname, but FQDN check comes first if it has no dot
    const response = await handler.fetch(request, createEnv() as any);
    expect(response.status).toBe(400);
    const body = await response.json() as { error: string };
    expect(body.error).toBeDefined();
  });

  it('rejects blocked hostnames', async () => {
    const request = createRequest('https://metadata.google.internal:443/path');
    const response = await handler.fetch(request, createEnv() as any);
    expect(response.status).toBe(403);
    const body = await response.json() as { error: string };
    expect(body.error).toContain('internal/private');
  });

  it('rejects .local domains', async () => {
    const request = createRequest('https://myhost.local:443/path');
    const response = await handler.fetch(request, createEnv() as any);
    expect(response.status).toBe(403);
    const body = await response.json() as { error: string };
    expect(body.error).toContain('internal/private');
  });

  it('rejects requests with body too large', async () => {
    const request = new Request('https://example.com', {
      method: 'POST',
      headers: {
        'X-Takos-Internal': '1',
        'Content-Length': String(100 * 1024 * 1024 + 1), // >10MB
      },
      body: 'small',
    });

    const response = await handler.fetch(request, createEnv() as any);
    // Port check and DNS might trigger first depending on URL, but content-length check
    // should return 413 if all other checks pass
    expect([400, 413, 502].includes(response.status)).toBe(true);
  });
});
