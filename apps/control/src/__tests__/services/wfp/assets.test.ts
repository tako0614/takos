import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

import {
  createAssetsUploadSession,
  uploadAssets,
  uploadAllAssets,
  type AssetUploadFile,
} from '@/services/wfp/assets';
import type { WFPConfig, WfpClient, CFAPIResponse } from '@/services/wfp/client';

// ---------------------------------------------------------------------------
// createAssetsUploadSession
// ---------------------------------------------------------------------------

describe('createAssetsUploadSession', () => {
  it('returns jwt and flattened uploadNeeded from buckets', async () => {
    const mockClient = {
      fetch: vi.fn().mockResolvedValue({
        result: {
          jwt: 'session-jwt-token',
          buckets: [['hash1', 'hash2'], ['hash3']],
        },
        success: true,
        errors: [],
        messages: [],
      } satisfies CFAPIResponse<{ jwt: string; buckets: string[][] }>),
    } as unknown as WfpClient;

    const config: WFPConfig = {
      accountId: 'acc-1',
      apiToken: 'token-1',
      dispatchNamespace: 'ns-1',
    };

    const result = await createAssetsUploadSession(mockClient, config, 'worker-1', {
      'index.html': { hash: 'hash1', size: 100 },
    });

    expect(result.jwt).toBe('session-jwt-token');
    expect(result.uploadNeeded).toEqual(['hash1', 'hash2', 'hash3']);
  });

  it('returns empty uploadNeeded when buckets is absent', async () => {
    const mockClient = {
      fetch: vi.fn().mockResolvedValue({
        result: { jwt: 'token' },
        success: true,
        errors: [],
        messages: [],
      }),
    } as unknown as WfpClient;

    const config: WFPConfig = { accountId: 'a', apiToken: 't', dispatchNamespace: 'ns' };
    const result = await createAssetsUploadSession(mockClient, config, 'w', {});
    expect(result.uploadNeeded).toEqual([]);
  });

  it('calls the correct API path', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      result: { jwt: 'x' },
      success: true,
      errors: [],
      messages: [],
    });
    const mockClient = { fetch: mockFetch } as unknown as WfpClient;
    const config: WFPConfig = { accountId: 'acc-1', apiToken: 't', dispatchNamespace: 'ns-1' };

    await createAssetsUploadSession(mockClient, config, 'my-worker', {});

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const path = mockFetch.mock.calls[0][0] as string;
    expect(path).toContain('/accounts/acc-1/');
    expect(path).toContain('/scripts/my-worker/assets-upload-session');
  });
});

// ---------------------------------------------------------------------------
// uploadAssets
// ---------------------------------------------------------------------------

describe('uploadAssets', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts FormData to the upload endpoint and returns completion JWT', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        result: { jwt: 'completion-jwt' },
        errors: [],
        messages: [],
      }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const config: WFPConfig = { accountId: 'acc-1', apiToken: 'tok', dispatchNamespace: 'ns' };
    const files: Record<string, AssetUploadFile> = {
      'hash1': { base64Content: 'aGVsbG8=', contentType: 'text/html' },
    };

    const jwt = await uploadAssets(config, 'session-jwt', files);
    expect(jwt).toBe('completion-jwt');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/accounts/acc-1/workers/assets/upload');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer session-jwt');
  });

  it('throws on non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const config: WFPConfig = { accountId: 'a', apiToken: 't', dispatchNamespace: 'ns' };
    await expect(uploadAssets(config, 'jwt', {})).rejects.toThrow('Assets upload failed');
  });

  it('throws when response is ok but missing completion JWT', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false, result: {} }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const config: WFPConfig = { accountId: 'a', apiToken: 't', dispatchNamespace: 'ns' };
    await expect(uploadAssets(config, 'jwt', {})).rejects.toThrow('no completion JWT');
  });

  it('throws timeout error on abort', async () => {
    const fetchMock = vi.fn().mockImplementation(() => {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });
    vi.stubGlobal('fetch', fetchMock);

    const config: WFPConfig = { accountId: 'a', apiToken: 't', dispatchNamespace: 'ns' };
    await expect(uploadAssets(config, 'jwt', {})).rejects.toThrow('timeout');
  });
});

// ---------------------------------------------------------------------------
// uploadAllAssets
// ---------------------------------------------------------------------------

describe('uploadAllAssets', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns session JWT directly when all assets are cached', async () => {
    const mockClient = {
      fetch: vi.fn().mockResolvedValue({
        result: { jwt: 'cached-jwt', buckets: [] },
        success: true,
        errors: [],
        messages: [],
      }),
    } as unknown as WfpClient;

    const config: WFPConfig = { accountId: 'a', apiToken: 't', dispatchNamespace: 'ns' };
    const content = new TextEncoder().encode('hello').buffer as ArrayBuffer;

    const jwt = await uploadAllAssets(mockClient, config, 'worker-1', [
      { path: 'index.html', content },
    ]);

    expect(jwt).toBe('cached-jwt');
  });

  it('uploads needed files and returns completion JWT', async () => {
    // We need to mock crypto.subtle.digest for hash computation
    const mockDigest = vi.fn().mockResolvedValue(new ArrayBuffer(32));
    vi.stubGlobal('crypto', {
      subtle: { digest: mockDigest },
    });

    // Client returns one hash that needs uploading
    const mockClient = {
      fetch: vi.fn().mockResolvedValue({
        result: {
          jwt: 'session-jwt',
          buckets: [['00000000000000000000000000000000']],
        },
        success: true,
        errors: [],
        messages: [],
      }),
    } as unknown as WfpClient;

    // Mock global fetch for the upload call
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        result: { jwt: 'completion-jwt' },
        errors: [],
        messages: [],
      }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const config: WFPConfig = { accountId: 'a', apiToken: 't', dispatchNamespace: 'ns' };
    const content = new TextEncoder().encode('test').buffer as ArrayBuffer;

    const jwt = await uploadAllAssets(mockClient, config, 'w', [
      { path: 'index.html', content },
    ]);

    expect(jwt).toBe('completion-jwt');
  });
});
