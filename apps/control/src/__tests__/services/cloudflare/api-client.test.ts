import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

import {
  CloudflareApiClient,
  createCloudflareApiClient,
  type CloudflareApiConfig,
} from '@/services/cloudflare/api-client';
import type { CloudflareAPIError } from '@/services/wfp/client';

describe('createCloudflareApiClient', () => {
  it('returns CloudflareApiClient when CF_ACCOUNT_ID and CF_API_TOKEN are set', () => {
    const client = createCloudflareApiClient({
      CF_ACCOUNT_ID: 'acc-1',
      CF_API_TOKEN: 'tok-1',
      CF_ZONE_ID: 'zone-1',
    });
    expect(client).toBeInstanceOf(CloudflareApiClient);
    expect(client!.accountId).toBe('acc-1');
    expect(client!.zoneId).toBe('zone-1');
  });

  it('returns null when CF_ACCOUNT_ID is missing', () => {
    const client = createCloudflareApiClient({
      CF_API_TOKEN: 'tok-1',
    });
    expect(client).toBeNull();
  });

  it('returns null when CF_API_TOKEN is missing', () => {
    const client = createCloudflareApiClient({
      CF_ACCOUNT_ID: 'acc-1',
    });
    expect(client).toBeNull();
  });

  it('creates client without zoneId', () => {
    const client = createCloudflareApiClient({
      CF_ACCOUNT_ID: 'acc-1',
      CF_API_TOKEN: 'tok-1',
    });
    expect(client).not.toBeNull();
    expect(client!.zoneId).toBeUndefined();
  });
});

describe('CloudflareApiClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const config: CloudflareApiConfig = {
    accountId: 'test-acc',
    apiToken: 'test-token',
    zoneId: 'test-zone',
  };

  function mockFetchSuccess<T>(result: T) {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        result,
        errors: [],
        messages: [],
      }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  describe('fetch', () => {
    it('sends Authorization and Content-Type headers', async () => {
      const fetchMock = mockFetchSuccess({ data: 'ok' });
      const client = new CloudflareApiClient(config);
      const response = await client.fetch<{ data: string }>('/test/path');

      expect(response.result.data).toBe('ok');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain('api.cloudflare.com');
      expect(url).toContain('/test/path');
      expect(init.headers.Authorization).toBe('Bearer test-token');
      expect(init.headers['Content-Type']).toBe('application/json');
    });

    it('throws classified error on non-ok response', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          success: false,
          errors: [{ code: 403, message: 'Forbidden' }],
          messages: [],
          result: null,
        }), { status: 403 }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const client = new CloudflareApiClient(config);
      try {
        await client.fetch('/forbidden');
        expect.unreachable();
      } catch (err) {
        const cfErr = err as CloudflareAPIError;
        expect(cfErr.statusCode).toBe(403);
        expect(cfErr.isRetryable).toBe(false);
      }
    });

    it('throws classified error when success is false in body', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          success: false,
          errors: [{ code: 100, message: 'Validation error' }],
          messages: [],
          result: null,
        }), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const client = new CloudflareApiClient(config);
      await expect(client.fetch('/bad')).rejects.toThrow();
    });

    it('throws timeout error when request aborts', async () => {
      const fetchMock = vi.fn().mockImplementation(() => {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        return Promise.reject(err);
      });
      vi.stubGlobal('fetch', fetchMock);

      const client = new CloudflareApiClient(config);
      await expect(client.fetch('/slow', {}, 1000)).rejects.toThrow('timeout');
    });
  });

  describe('fetchRaw', () => {
    it('returns raw Response without JSON parsing', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response('raw-value', { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const client = new CloudflareApiClient(config);
      const response = await client.fetchRaw('/raw/path');
      const text = await response.text();

      expect(text).toBe('raw-value');
      const init = fetchMock.mock.calls[0][1];
      expect(init.headers.Authorization).toBe('Bearer test-token');
    });
  });

  describe('accountGet', () => {
    it('sends GET to /accounts/{accountId}/<subpath>', async () => {
      const fetchMock = mockFetchSuccess({ items: [1, 2, 3] });
      const client = new CloudflareApiClient(config);
      const result = await client.accountGet<{ items: number[] }>('/workers/scripts');

      expect(result.items).toEqual([1, 2, 3]);
      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain(`/accounts/${config.accountId}/workers/scripts`);
    });
  });

  describe('accountPost', () => {
    it('sends POST with JSON body to account path', async () => {
      const fetchMock = mockFetchSuccess({ id: 'new-resource' });
      const client = new CloudflareApiClient(config);
      const result = await client.accountPost<{ id: string }>('/d1/database', { name: 'my-db' });

      expect(result.id).toBe('new-resource');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain(`/accounts/${config.accountId}/d1/database`);
      expect(init.method).toBe('POST');
      expect(init.body).toBe(JSON.stringify({ name: 'my-db' }));
    });
  });

  describe('accountDelete', () => {
    it('sends DELETE to account path', async () => {
      const fetchMock = mockFetchSuccess(null);
      const client = new CloudflareApiClient(config);
      await client.accountDelete('/d1/database/db-1');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain(`/accounts/${config.accountId}/d1/database/db-1`);
      expect(init.method).toBe('DELETE');
    });
  });

  describe('zonePost', () => {
    it('sends POST to /zones/{zoneId}/<subpath>', async () => {
      const fetchMock = mockFetchSuccess({ id: 'hostname-1' });
      const client = new CloudflareApiClient(config);
      const result = await client.zonePost<{ id: string }>('/custom_hostnames', { hostname: 'api.example.com' });

      expect(result.id).toBe('hostname-1');
      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain(`/zones/${config.zoneId}/custom_hostnames`);
    });

    it('throws when zoneId is not configured', async () => {
      const client = new CloudflareApiClient({ ...config, zoneId: undefined });
      await expect(client.zonePost('/custom_hostnames')).rejects.toThrow('CF_ZONE_ID not configured');
    });
  });

  describe('zoneGet', () => {
    it('sends GET to zone path', async () => {
      const fetchMock = mockFetchSuccess([]);
      const client = new CloudflareApiClient(config);
      await client.zoneGet('/custom_hostnames');

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain(`/zones/${config.zoneId}/custom_hostnames`);
    });

    it('throws when zoneId is not configured', async () => {
      const client = new CloudflareApiClient({ ...config, zoneId: undefined });
      await expect(client.zoneGet('/anything')).rejects.toThrow('CF_ZONE_ID not configured');
    });
  });

  describe('zoneDelete', () => {
    it('sends DELETE to zone path', async () => {
      const fetchMock = mockFetchSuccess(null);
      const client = new CloudflareApiClient(config);
      await client.zoneDelete('/custom_hostnames/h1');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain(`/zones/${config.zoneId}/custom_hostnames/h1`);
      expect(init.method).toBe('DELETE');
    });

    it('throws when zoneId is not configured', async () => {
      const client = new CloudflareApiClient({ ...config, zoneId: undefined });
      await expect(client.zoneDelete('/anything')).rejects.toThrow('CF_ZONE_ID not configured');
    });
  });
});
