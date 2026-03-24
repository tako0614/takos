import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getConfigMock, getApiRequestTimeoutMsMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn(),
  getApiRequestTimeoutMsMock: vi.fn(),
}));

vi.mock('../src/lib/config.js', () => ({
  getConfig: getConfigMock,
  getApiRequestTimeoutMs: getApiRequestTimeoutMsMock,
}));

import { api } from '../src/lib/api.js';

function stubFetchResponse(
  body: ConstructorParameters<typeof Response>[0],
  init?: ResponseInit
) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(body, init));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function stubFetchError(error: unknown) {
  const fetchMock = vi.fn().mockRejectedValue(error);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('api client', () => {
  beforeEach(() => {
    getConfigMock.mockReturnValue({
      apiUrl: 'https://takos.jp',
      token: 'test-token',
    });
    getApiRequestTimeoutMsMock.mockReturnValue(30_000);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('treats 204 responses as success', async () => {
    stubFetchResponse(null, { status: 204 });

    const result = await api<void>('/api/empty');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBeUndefined();
    }
  });

  it('treats 2xx responses with empty body as success', async () => {
    stubFetchResponse('', { status: 200 });

    const result = await api<void>('/api/empty');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBeUndefined();
    }
  });

  it('uses configured default timeout when request timeout is omitted', async () => {
    stubFetchResponse('{}', { status: 200 });
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    getApiRequestTimeoutMsMock.mockReturnValue(12_345);

    await api('/api/timeout-default');

    expect(setTimeoutSpy.mock.calls.some((call) => call[1] === 12_345)).toBe(true);
  });

  it('prefers per-request timeout over configured default', async () => {
    stubFetchResponse('{}', { status: 200 });
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    getApiRequestTimeoutMsMock.mockReturnValue(12_345);

    await api('/api/timeout-override', { timeout: 987 });

    expect(setTimeoutSpy.mock.calls.some((call) => call[1] === 987)).toBe(true);
  });

  it('returns error from non-2xx JSON payloads', async () => {
    stubFetchResponse(JSON.stringify({ error: 'Invalid API key' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });

    const result = await api('/api/protected');

    expect(result).toEqual({ ok: false, error: 'Invalid API key' });
  });

  it('falls back to status text for non-2xx non-JSON payloads', async () => {
    stubFetchResponse('<html>failure</html>', {
      status: 502,
      statusText: 'Bad Gateway',
      headers: { 'Content-Type': 'text/html' },
    });

    const result = await api('/api/protected');

    expect(result).toEqual({ ok: false, error: 'Bad Gateway' });
  });

  it('maps AbortError to timeout message', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    stubFetchError(abortError);

    const result = await api('/api/slow');

    expect(result).toEqual({ ok: false, error: 'Request timed out' });
  });

  it('sanitizes generic network errors', async () => {
    const networkError = new Error('Error: connect ECONNREFUSED /home/alice/.ssh/id_rsa');
    stubFetchError(networkError);

    const result = await api('/api/network');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Network error: connect ECONNREFUSED [path]');
      expect(result.error).not.toContain('/home/alice');
    }
  });

  it('returns an error for invalid JSON in successful responses', async () => {
    stubFetchResponse('{invalid json', { status: 200 });

    const result = await api('/api/invalid-json');

    expect(result).toEqual({ ok: false, error: 'Invalid response from server' });
  });
});
