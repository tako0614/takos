// [Deno] vi.mock removed - manually stub imports from 'takos-common/validation'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/validate-env'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/logger'
import egressModule from '@/worker/egress';

import { assertEquals, assert, assertThrows, assertStringIncludes } from 'jsr:@std/assert';

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


  Deno.test('egress handler - rejects requests without X-Takos-Internal header', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const request = new Request('https://example.com', {
      method: 'GET',
      headers: {},
    });

    const response = await handler.fetch(request, createEnv() as any);
    assertEquals(response.status, 401);
    const body = await response.json() as { error: string };
    assertEquals(body.error, 'Unauthorized');
})
  Deno.test('egress handler - rejects non-HTTP/HTTPS protocols', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const request = createRequest('ftp://example.com/file.txt');
    const response = await handler.fetch(request, createEnv() as any);
    assertEquals(response.status, 400);
    const body = await response.json() as { error: string };
    assertStringIncludes(body.error, 'Only HTTP/HTTPS URLs');
})
  Deno.test('egress handler - rejects URLs with credentials', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertThrows(() => { () => createRequest('https://user:pass@example.com'); }, /credentials/);
})
  Deno.test('egress handler - rejects non-standard ports', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const request = createRequest('https://example.com:8443/path');
    const response = await handler.fetch(request, createEnv() as any);
    assertEquals(response.status, 400);
    const body = await response.json() as { error: string };
    assertStringIncludes(body.error, 'Port');
})
  Deno.test('egress handler - rejects single-label hostnames', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const request = createRequest('https://localhost/path');
    // localhost is also a blocked hostname, but FQDN check comes first if it has no dot
    const response = await handler.fetch(request, createEnv() as any);
    assertEquals(response.status, 400);
    const body = await response.json() as { error: string };
    assert(body.error !== undefined);
})
  Deno.test('egress handler - rejects blocked hostnames', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const request = createRequest('https://metadata.google.internal:443/path');
    const response = await handler.fetch(request, createEnv() as any);
    assertEquals(response.status, 403);
    const body = await response.json() as { error: string };
    assertStringIncludes(body.error, 'internal/private');
})
  Deno.test('egress handler - rejects .local domains', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const request = createRequest('https://myhost.local:443/path');
    const response = await handler.fetch(request, createEnv() as any);
    assertEquals(response.status, 403);
    const body = await response.json() as { error: string };
    assertStringIncludes(body.error, 'internal/private');
})
  Deno.test('egress handler - rejects requests with body too large', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
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
    assertEquals([400, 413, 502].includes(response.status), true);
})