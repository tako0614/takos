import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

import {
  resolveWfpConfig,
  createWfpConfig,
  sanitizeErrorMessage,
  classifyAPIError,
  createTimeoutError,
  WfpClient,
  CF_API_BASE,
  type WFPConfig,
  type CFAPIResponse,
  type CloudflareAPIError,
} from '@/services/wfp/client';

// ---------------------------------------------------------------------------
// resolveWfpConfig
// ---------------------------------------------------------------------------

describe('resolveWfpConfig', () => {
  it('returns config when all values are present', () => {
    const config = resolveWfpConfig({
      CF_ACCOUNT_ID: 'acc-1',
      CF_API_TOKEN: 'tok-1',
      WFP_DISPATCH_NAMESPACE: 'ns-1',
    });
    expect(config).toEqual({
      accountId: 'acc-1',
      apiToken: 'tok-1',
      dispatchNamespace: 'ns-1',
    });
  });

  it('returns null when CF_ACCOUNT_ID is missing', () => {
    const config = resolveWfpConfig({
      CF_ACCOUNT_ID: undefined,
      CF_API_TOKEN: 'tok',
      WFP_DISPATCH_NAMESPACE: 'ns',
    } as never);
    expect(config).toBeNull();
  });

  it('returns null when CF_API_TOKEN is empty string', () => {
    const config = resolveWfpConfig({
      CF_ACCOUNT_ID: 'acc',
      CF_API_TOKEN: '  ',
      WFP_DISPATCH_NAMESPACE: 'ns',
    });
    expect(config).toBeNull();
  });

  it('returns null when WFP_DISPATCH_NAMESPACE is missing', () => {
    const config = resolveWfpConfig({
      CF_ACCOUNT_ID: 'acc',
      CF_API_TOKEN: 'tok',
      WFP_DISPATCH_NAMESPACE: undefined,
    } as never);
    expect(config).toBeNull();
  });

  it('trims whitespace from values', () => {
    const config = resolveWfpConfig({
      CF_ACCOUNT_ID: '  acc  ',
      CF_API_TOKEN: ' tok ',
      WFP_DISPATCH_NAMESPACE: ' ns ',
    });
    expect(config).toEqual({
      accountId: 'acc',
      apiToken: 'tok',
      dispatchNamespace: 'ns',
    });
  });
});

// ---------------------------------------------------------------------------
// createWfpConfig
// ---------------------------------------------------------------------------

describe('createWfpConfig', () => {
  it('returns config for valid env', () => {
    const config = createWfpConfig({
      CF_ACCOUNT_ID: 'acc',
      CF_API_TOKEN: 'tok',
      WFP_DISPATCH_NAMESPACE: 'ns',
    });
    expect(config.accountId).toBe('acc');
  });

  it('throws when config cannot be resolved', () => {
    expect(() => createWfpConfig({} as never)).toThrow('not configured');
  });
});

// ---------------------------------------------------------------------------
// sanitizeErrorMessage
// ---------------------------------------------------------------------------

describe('sanitizeErrorMessage', () => {
  it('redacts Bearer tokens', () => {
    const msg = 'Error: Bearer abc123def';
    expect(sanitizeErrorMessage(msg)).toContain('[REDACTED]');
    expect(sanitizeErrorMessage(msg)).not.toContain('abc123def');
  });

  it('redacts api_token values', () => {
    const msg = 'api_token=my_secret_key';
    expect(sanitizeErrorMessage(msg)).toContain('[REDACTED]');
    expect(sanitizeErrorMessage(msg)).not.toContain('my_secret_key');
  });

  it('redacts authorization values', () => {
    const msg = 'authorization=secret';
    expect(sanitizeErrorMessage(msg)).toContain('[REDACTED]');
  });

  it('redacts secret_key values', () => {
    const msg = 'secret_key=mysecret';
    expect(sanitizeErrorMessage(msg)).toContain('[REDACTED]');
  });

  it('redacts password values', () => {
    const msg = 'password=hunter2';
    expect(sanitizeErrorMessage(msg)).toContain('[REDACTED]');
  });

  it('redacts account IDs in paths', () => {
    const msg = 'accounts/abcdef1234567890abcdef1234567890/workers';
    expect(sanitizeErrorMessage(msg)).toContain('[REDACTED]');
  });

  it('leaves normal messages unchanged', () => {
    const msg = 'Worker deployment failed with status 404';
    expect(sanitizeErrorMessage(msg)).toBe(msg);
  });
});

// ---------------------------------------------------------------------------
// classifyAPIError
// ---------------------------------------------------------------------------

describe('classifyAPIError', () => {
  it('creates error with status code and message from CF errors', () => {
    const response = new Response(null, { status: 400 });
    const data: CFAPIResponse = {
      success: false,
      errors: [{ code: 1001, message: 'Bad request' }],
      messages: [],
      result: null,
    };

    const err = classifyAPIError(response, data);
    expect(err.statusCode).toBe(400);
    expect(err.message).toContain('Bad request');
    expect(err.code).toBe(1001);
    expect(err.isRetryable).toBe(false);
  });

  it('uses status text when no CF errors in data', () => {
    const response = new Response(null, { status: 403, statusText: 'Forbidden' });
    const err = classifyAPIError(response);
    expect(err.message).toContain('403');
    expect(err.message).toContain('Forbidden');
    expect(err.isRetryable).toBe(false);
  });

  it('classifies 429 as rate limited and retryable', () => {
    const headers = new Headers({ 'Retry-After': '30' });
    const response = new Response(null, { status: 429, headers });
    const err = classifyAPIError(response);

    expect(err.isRateLimited).toBe(true);
    expect(err.isRetryable).toBe(true);
    expect(err.retryAfter).toBe(30);
  });

  it('defaults retryAfter to 60 when Retry-After header is missing', () => {
    const response = new Response(null, { status: 429 });
    const err = classifyAPIError(response);
    expect(err.retryAfter).toBe(60);
  });

  it('defaults retryAfter to 60 when Retry-After header is non-numeric', () => {
    const headers = new Headers({ 'Retry-After': 'Wed, 21 Oct 2025 07:28:00 GMT' });
    const response = new Response(null, { status: 429, headers });
    const err = classifyAPIError(response);
    expect(err.retryAfter).toBe(60);
  });

  it('classifies 5xx as retryable', () => {
    const response = new Response(null, { status: 502 });
    const err = classifyAPIError(response);
    expect(err.isRetryable).toBe(true);
  });

  it('sanitizes error messages from CF API', () => {
    const response = new Response(null, { status: 400 });
    const data: CFAPIResponse = {
      success: false,
      errors: [{ code: 1, message: 'Bearer mysecrettoken leaked' }],
      messages: [],
      result: null,
    };
    const err = classifyAPIError(response, data);
    expect(err.message).not.toContain('mysecrettoken');
    expect(err.message).toContain('[REDACTED]');
  });
});

// ---------------------------------------------------------------------------
// createTimeoutError
// ---------------------------------------------------------------------------

describe('createTimeoutError', () => {
  it('creates an error with timeout message and isRetryable flag', () => {
    const err = createTimeoutError(30000);
    expect(err.message).toContain('30 seconds');
    expect(err.isRetryable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// WfpClient
// ---------------------------------------------------------------------------

describe('WfpClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const config: WFPConfig = {
    accountId: 'acc-1',
    apiToken: 'test-token',
    dispatchNamespace: 'ns-1',
  };

  it('sends Authorization header and parses successful JSON response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        result: { data: 'ok' },
        errors: [],
        messages: [],
      }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new WfpClient(config);
    const response = await client.fetch<{ data: string }>('/test/path');

    expect(response.result.data).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${CF_API_BASE}/test/path`);
    expect(init.headers.Authorization).toBe('Bearer test-token');
  });

  it('throws classified error on non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        success: false,
        errors: [{ code: 404, message: 'Not found' }],
        messages: [],
        result: null,
      }), { status: 404 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new WfpClient(config);
    try {
      await client.fetch('/missing');
      expect.unreachable();
    } catch (err) {
      const cfErr = err as CloudflareAPIError;
      expect(cfErr.statusCode).toBe(404);
      expect(cfErr.message).toContain('Not found');
    }
  });

  it('throws classified error when success is false in response body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        success: false,
        errors: [{ code: 100, message: 'fail' }],
        messages: [],
        result: null,
      }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new WfpClient(config);
    await expect(client.fetch('/bad')).rejects.toThrow();
  });

  it('throws timeout error on AbortError', async () => {
    const fetchMock = vi.fn().mockImplementation(() => {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new WfpClient(config);
    await expect(client.fetch('/slow', {}, 1000)).rejects.toThrow('timeout');
  });

  it('merges custom headers with auth header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        result: {},
        errors: [],
        messages: [],
      }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new WfpClient(config);
    await client.fetch('/test', { headers: { 'X-Custom': 'value' } });

    const init = fetchMock.mock.calls[0][1];
    expect(init.headers.Authorization).toBe('Bearer test-token');
    expect(init.headers['X-Custom']).toBe('value');
  });
});
