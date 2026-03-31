import { assertEquals, assert } from 'jsr:@std/assert';
import { stub } from 'jsr:@std/testing/mock';

const { getConfigMock, getApiRequestTimeoutMsMock } = ({
  getConfigMock: ((..._args: any[]) => undefined) as any,
  getApiRequestTimeoutMsMock: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '../src/lib/config.ts'
import { api } from '../src/lib/api.ts';

function stubFetchResponse(
  body: ConstructorParameters<typeof Response>[0],
  init?: ResponseInit
) {
  const fetchMock = (async () => new Response(body, init));
  (globalThis as any).fetch = fetchMock;
  return fetchMock;
}

function stubFetchError(error: unknown) {
  const fetchMock = (async () => { throw error; });
  (globalThis as any).fetch = fetchMock;
  return fetchMock;
}


  Deno.test('api client - treats 204 responses as success', async () => {
  getConfigMock = (() => ({
      apiUrl: 'https://takos.jp',
      token: 'test-token',
    })) as any;
    getApiRequestTimeoutMsMock = (() => 30_000) as any;
  try {
  stubFetchResponse(null, { status: 204 });

    const result = await api<void>('/api/empty');

    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.data, undefined);
    }
  } finally {
  /* TODO: restore stubbed globals manually */ void 0;
    /* TODO: restore mocks manually */ void 0;
  }
})
  Deno.test('api client - treats 2xx responses with empty body as success', async () => {
  getConfigMock = (() => ({
      apiUrl: 'https://takos.jp',
      token: 'test-token',
    })) as any;
    getApiRequestTimeoutMsMock = (() => 30_000) as any;
  try {
  stubFetchResponse('', { status: 200 });

    const result = await api<void>('/api/empty');

    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.data, undefined);
    }
  } finally {
  /* TODO: restore stubbed globals manually */ void 0;
    /* TODO: restore mocks manually */ void 0;
  }
})
  Deno.test('api client - uses configured default timeout when request timeout is omitted', async () => {
  getConfigMock = (() => ({
      apiUrl: 'https://takos.jp',
      token: 'test-token',
    })) as any;
    getApiRequestTimeoutMsMock = (() => 30_000) as any;
  try {
  stubFetchResponse('{}', { status: 200 });
    const setTimeoutSpy = stub(globalThis, 'setTimeout');
    getApiRequestTimeoutMsMock = (() => 12_345) as any;

    await api('/api/timeout-default');

    assertEquals(setTimeoutSpy.calls.some((call) => call[1] === 12_345), true);
  } finally {
  /* TODO: restore stubbed globals manually */ void 0;
    /* TODO: restore mocks manually */ void 0;
  }
})
  Deno.test('api client - prefers per-request timeout over configured default', async () => {
  getConfigMock = (() => ({
      apiUrl: 'https://takos.jp',
      token: 'test-token',
    })) as any;
    getApiRequestTimeoutMsMock = (() => 30_000) as any;
  try {
  stubFetchResponse('{}', { status: 200 });
    const setTimeoutSpy = stub(globalThis, 'setTimeout');
    getApiRequestTimeoutMsMock = (() => 12_345) as any;

    await api('/api/timeout-override', { timeout: 987 });

    assertEquals(setTimeoutSpy.calls.some((call) => call[1] === 987), true);
  } finally {
  /* TODO: restore stubbed globals manually */ void 0;
    /* TODO: restore mocks manually */ void 0;
  }
})
  Deno.test('api client - returns error from non-2xx JSON payloads', async () => {
  getConfigMock = (() => ({
      apiUrl: 'https://takos.jp',
      token: 'test-token',
    })) as any;
    getApiRequestTimeoutMsMock = (() => 30_000) as any;
  try {
  stubFetchResponse(JSON.stringify({ error: 'Invalid API key' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });

    const result = await api('/api/protected');

    assertEquals(result, { ok: false, error: 'Invalid API key' });
  } finally {
  /* TODO: restore stubbed globals manually */ void 0;
    /* TODO: restore mocks manually */ void 0;
  }
})
  Deno.test('api client - falls back to status text for non-2xx non-JSON payloads', async () => {
  getConfigMock = (() => ({
      apiUrl: 'https://takos.jp',
      token: 'test-token',
    })) as any;
    getApiRequestTimeoutMsMock = (() => 30_000) as any;
  try {
  stubFetchResponse('<html>failure</html>', {
      status: 502,
      statusText: 'Bad Gateway',
      headers: { 'Content-Type': 'text/html' },
    });

    const result = await api('/api/protected');

    assertEquals(result, { ok: false, error: 'Bad Gateway' });
  } finally {
  /* TODO: restore stubbed globals manually */ void 0;
    /* TODO: restore mocks manually */ void 0;
  }
})
  Deno.test('api client - maps AbortError to timeout message', async () => {
  getConfigMock = (() => ({
      apiUrl: 'https://takos.jp',
      token: 'test-token',
    })) as any;
    getApiRequestTimeoutMsMock = (() => 30_000) as any;
  try {
  const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    stubFetchError(abortError);

    const result = await api('/api/slow');

    assertEquals(result, { ok: false, error: 'Request timed out' });
  } finally {
  /* TODO: restore stubbed globals manually */ void 0;
    /* TODO: restore mocks manually */ void 0;
  }
})
  Deno.test('api client - sanitizes generic network errors', async () => {
  getConfigMock = (() => ({
      apiUrl: 'https://takos.jp',
      token: 'test-token',
    })) as any;
    getApiRequestTimeoutMsMock = (() => 30_000) as any;
  try {
  const networkError = new Error('Error: connect ECONNREFUSED /home/alice/.ssh/id_rsa');
    stubFetchError(networkError);

    const result = await api('/api/network');

    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.error, 'Network error: connect ECONNREFUSED [path]');
      assert(!(result.error).includes('/home/alice'));
    }
  } finally {
  /* TODO: restore stubbed globals manually */ void 0;
    /* TODO: restore mocks manually */ void 0;
  }
})
  Deno.test('api client - returns an error for invalid JSON in successful responses', async () => {
  getConfigMock = (() => ({
      apiUrl: 'https://takos.jp',
      token: 'test-token',
    })) as any;
    getApiRequestTimeoutMsMock = (() => 30_000) as any;
  try {
  stubFetchResponse('{invalid json', { status: 200 });

    const result = await api('/api/invalid-json');

    assertEquals(result, { ok: false, error: 'Invalid response from server' });
  } finally {
  /* TODO: restore stubbed globals manually */ void 0;
    /* TODO: restore mocks manually */ void 0;
  }
})