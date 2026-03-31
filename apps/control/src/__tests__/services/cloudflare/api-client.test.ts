import {
  CloudflareApiClient,
  createCloudflareApiClient,
  type CloudflareApiConfig,
} from '@/services/cloudflare/api-client';
import type { CloudflareAPIError } from '@/services/wfp/client';


import { assertEquals, assertNotEquals, assert, assertRejects, assertStringIncludes } from 'jsr:@std/assert';

  Deno.test('createCloudflareApiClient - returns CloudflareApiClient when CF_ACCOUNT_ID and CF_API_TOKEN are set', () => {
  const client = createCloudflareApiClient({
      CF_ACCOUNT_ID: 'acc-1',
      CF_API_TOKEN: 'tok-1',
      CF_ZONE_ID: 'zone-1',
    });
    assert(client instanceof CloudflareApiClient);
    assertEquals(client!.accountId, 'acc-1');
    assertEquals(client!.zoneId, 'zone-1');
})
  Deno.test('createCloudflareApiClient - returns null when CF_ACCOUNT_ID is missing', () => {
  const client = createCloudflareApiClient({
      CF_API_TOKEN: 'tok-1',
    });
    assertEquals(client, null);
})
  Deno.test('createCloudflareApiClient - returns null when CF_API_TOKEN is missing', () => {
  const client = createCloudflareApiClient({
      CF_ACCOUNT_ID: 'acc-1',
    });
    assertEquals(client, null);
})
  Deno.test('createCloudflareApiClient - creates client without zoneId', () => {
  const client = createCloudflareApiClient({
      CF_ACCOUNT_ID: 'acc-1',
      CF_API_TOKEN: 'tok-1',
    });
    assertNotEquals(client, null);
    assertEquals(client!.zoneId, undefined);
})

  const config: CloudflareApiConfig = {
    accountId: 'test-acc',
    apiToken: 'test-token',
    zoneId: 'test-zone',
  };

  function mockFetchSuccess<T>(result: T) {
    const fetchMock = (async () => new Response(JSON.stringify({
        success: true,
        result,
        errors: [],
        messages: [],
      }), { status: 200 }),);
    (globalThis as any).fetch = fetchMock;
    return fetchMock;
  }

  
    Deno.test('CloudflareApiClient - fetch - sends Authorization and Content-Type headers', async () => {
  try {
  const fetchMock = mockFetchSuccess({ data: 'ok' });
      const client = new CloudflareApiClient(config);
      const response = await client.fetch<{ data: string }>('/test/path');

      assertEquals(response.result.data, 'ok');
      const [url, init] = fetchMock.calls[0];
      assertStringIncludes(url, 'api.cloudflare.com');
      assertStringIncludes(url, '/test/path');
      assertEquals(init.headers.Authorization, 'Bearer test-token');
      assertEquals(init.headers['Content-Type'], 'application/json');
  } finally {
  /* TODO: restore stubbed globals manually */ void 0;
  }
})
    Deno.test('CloudflareApiClient - fetch - throws classified error on non-ok response', async () => {
  try {
  const fetchMock = (async () => new Response(JSON.stringify({
          success: false,
          errors: [{ code: 403, message: 'Forbidden' }],
          messages: [],
          result: null,
        }), { status: 403 }),);
      (globalThis as any).fetch = fetchMock;

      const client = new CloudflareApiClient(config);
      try {
        await client.fetch('/forbidden');
        expect.unreachable();
      } catch (err) {
        const cfErr = err as CloudflareAPIError;
        assertEquals(cfErr.statusCode, 403);
        assertEquals(cfErr.isRetryable, false);
      }
  } finally {
  /* TODO: restore stubbed globals manually */ void 0;
  }
})
    Deno.test('CloudflareApiClient - fetch - throws classified error when success is false in body', async () => {
  try {
  const fetchMock = (async () => new Response(JSON.stringify({
          success: false,
          errors: [{ code: 100, message: 'Validation error' }],
          messages: [],
          result: null,
        }), { status: 200 }),);
      (globalThis as any).fetch = fetchMock;

      const client = new CloudflareApiClient(config);
      await await assertRejects(async () => { await client.fetch('/bad'); });
  } finally {
  /* TODO: restore stubbed globals manually */ void 0;
  }
})
    Deno.test('CloudflareApiClient - fetch - throws timeout error when request aborts', async () => {
  try {
  const fetchMock = () => {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        return Promise.reject(err);
      };
      (globalThis as any).fetch = fetchMock;

      const client = new CloudflareApiClient(config);
      await await assertRejects(async () => { await client.fetch('/slow', {}, 1000); }, 'timeout');
  } finally {
  /* TODO: restore stubbed globals manually */ void 0;
  }
})  
  
    Deno.test('CloudflareApiClient - fetchRaw - returns raw Response without JSON parsing', async () => {
  try {
  const fetchMock = (async () => new Response('raw-value', { status: 200 }),);
      (globalThis as any).fetch = fetchMock;

      const client = new CloudflareApiClient(config);
      const response = await client.fetchRaw('/raw/path');
      const text = await response.text();

      assertEquals(text, 'raw-value');
      const init = fetchMock.calls[0][1];
      assertEquals(init.headers.Authorization, 'Bearer test-token');
  } finally {
  /* TODO: restore stubbed globals manually */ void 0;
  }
})  
  
    Deno.test('CloudflareApiClient - accountGet - sends GET to /accounts/{accountId}/<subpath>', async () => {
  try {
  const fetchMock = mockFetchSuccess({ items: [1, 2, 3] });
      const client = new CloudflareApiClient(config);
      const result = await client.accountGet<{ items: number[] }>('/workers/scripts');

      assertEquals(result.items, [1, 2, 3]);
      const url = fetchMock.calls[0][0] as string;
      assertStringIncludes(url, `/accounts/${config.accountId}/workers/scripts`);
  } finally {
  /* TODO: restore stubbed globals manually */ void 0;
  }
})  
  
    Deno.test('CloudflareApiClient - accountPost - sends POST with JSON body to account path', async () => {
  try {
  const fetchMock = mockFetchSuccess({ id: 'new-resource' });
      const client = new CloudflareApiClient(config);
      const result = await client.accountPost<{ id: string }>('/d1/database', { name: 'my-db' });

      assertEquals(result.id, 'new-resource');
      const [url, init] = fetchMock.calls[0];
      assertStringIncludes(url, `/accounts/${config.accountId}/d1/database`);
      assertEquals(init.method, 'POST');
      assertEquals(init.body, JSON.stringify({ name: 'my-db' }));
  } finally {
  /* TODO: restore stubbed globals manually */ void 0;
  }
})  
  
    Deno.test('CloudflareApiClient - accountDelete - sends DELETE to account path', async () => {
  try {
  const fetchMock = mockFetchSuccess(null);
      const client = new CloudflareApiClient(config);
      await client.accountDelete('/d1/database/db-1');

      const [url, init] = fetchMock.calls[0];
      assertStringIncludes(url, `/accounts/${config.accountId}/d1/database/db-1`);
      assertEquals(init.method, 'DELETE');
  } finally {
  /* TODO: restore stubbed globals manually */ void 0;
  }
})  
  
    Deno.test('CloudflareApiClient - zonePost - sends POST to /zones/{zoneId}/<subpath>', async () => {
  try {
  const fetchMock = mockFetchSuccess({ id: 'hostname-1' });
      const client = new CloudflareApiClient(config);
      const result = await client.zonePost<{ id: string }>('/custom_hostnames', { hostname: 'api.example.com' });

      assertEquals(result.id, 'hostname-1');
      const url = fetchMock.calls[0][0] as string;
      assertStringIncludes(url, `/zones/${config.zoneId}/custom_hostnames`);
  } finally {
  /* TODO: restore stubbed globals manually */ void 0;
  }
})
    Deno.test('CloudflareApiClient - zonePost - throws when zoneId is not configured', async () => {
  try {
  const client = new CloudflareApiClient({ ...config, zoneId: undefined });
      await await assertRejects(async () => { await client.zonePost('/custom_hostnames'); }, 'CF_ZONE_ID not configured');
  } finally {
  /* TODO: restore stubbed globals manually */ void 0;
  }
})  
  
    Deno.test('CloudflareApiClient - zoneGet - sends GET to zone path', async () => {
  try {
  const fetchMock = mockFetchSuccess([]);
      const client = new CloudflareApiClient(config);
      await client.zoneGet('/custom_hostnames');

      const url = fetchMock.calls[0][0] as string;
      assertStringIncludes(url, `/zones/${config.zoneId}/custom_hostnames`);
  } finally {
  /* TODO: restore stubbed globals manually */ void 0;
  }
})
    Deno.test('CloudflareApiClient - zoneGet - throws when zoneId is not configured', async () => {
  try {
  const client = new CloudflareApiClient({ ...config, zoneId: undefined });
      await await assertRejects(async () => { await client.zoneGet('/anything'); }, 'CF_ZONE_ID not configured');
  } finally {
  /* TODO: restore stubbed globals manually */ void 0;
  }
})  
  
    Deno.test('CloudflareApiClient - zoneDelete - sends DELETE to zone path', async () => {
  try {
  const fetchMock = mockFetchSuccess(null);
      const client = new CloudflareApiClient(config);
      await client.zoneDelete('/custom_hostnames/h1');

      const [url, init] = fetchMock.calls[0];
      assertStringIncludes(url, `/zones/${config.zoneId}/custom_hostnames/h1`);
      assertEquals(init.method, 'DELETE');
  } finally {
  /* TODO: restore stubbed globals manually */ void 0;
  }
})
    Deno.test('CloudflareApiClient - zoneDelete - throws when zoneId is not configured', async () => {
  try {
  const client = new CloudflareApiClient({ ...config, zoneId: undefined });
      await await assertRejects(async () => { await client.zoneDelete('/anything'); }, 'CF_ZONE_ID not configured');
  } finally {
  /* TODO: restore stubbed globals manually */ void 0;
  }
})  