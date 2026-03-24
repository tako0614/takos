import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

import {
  WFPService,
  createWfpService,
  getTakosWorkerScript,
  getTakosMigrationSQL,
} from '@/services/wfp/service';
import type { WFPConfig } from '@/services/wfp/client';
import { MockR2Bucket } from '../../../../test/integration/setup';

// ---------------------------------------------------------------------------
// createWfpService
// ---------------------------------------------------------------------------

describe('createWfpService', () => {
  it('returns WFPService when env is configured', () => {
    const svc = createWfpService({
      CF_ACCOUNT_ID: 'acc',
      CF_API_TOKEN: 'tok',
      WFP_DISPATCH_NAMESPACE: 'ns',
    });
    expect(svc).toBeInstanceOf(WFPService);
  });

  it('returns null when env is missing required values', () => {
    const svc = createWfpService({
      CF_ACCOUNT_ID: undefined,
      CF_API_TOKEN: 'tok',
      WFP_DISPATCH_NAMESPACE: 'ns',
    } as never);
    expect(svc).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// WFPService
// ---------------------------------------------------------------------------

describe('WFPService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const config: WFPConfig = {
    accountId: 'test-acc',
    apiToken: 'test-token',
    dispatchNamespace: 'test-ns',
  };

  function mockSuccessResponse<T>(result: T) {
    return new Response(JSON.stringify({
      success: true,
      result,
      errors: [],
      messages: [],
    }), { status: 200 });
  }

  describe('createWorker', () => {
    it('sends PUT request with FormData containing worker script and metadata', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockSuccessResponse({}));
      vi.stubGlobal('fetch', fetchMock);

      const svc = new WFPService(config);
      await svc.createWorker({
        workerName: 'my-worker',
        workerScript: 'export default { fetch() { return new Response("ok"); } }',
        bindings: [
          { type: 'plain_text', name: 'MY_VAR', text: 'value' },
        ],
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain('/scripts/my-worker');
      expect(init.method).toBe('PUT');
    });

    it('serializes vectorize bindings into worker metadata', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockSuccessResponse({}));
      vi.stubGlobal('fetch', fetchMock);

      const svc = new WFPService(config);
      await svc.createWorker({
        workerName: 'vector-worker',
        workerScript: 'export default { fetch() { return new Response("ok"); } }',
        bindings: [
          { type: 'vectorize', name: 'SEARCH_INDEX', index_name: 'semantic-index' },
        ],
      });

      const [, init] = fetchMock.mock.calls[0];
      const metadataBlob = (init.body as FormData).get('metadata') as Blob;
      const metadata = JSON.parse(await metadataBlob.text());
      expect(metadata.bindings).toContainEqual({
        type: 'vectorize',
        name: 'SEARCH_INDEX',
        index_name: 'semantic-index',
      });
    });
  });

  describe('deleteWorker', () => {
    it('sends DELETE request for the worker', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockSuccessResponse(null));
      vi.stubGlobal('fetch', fetchMock);

      const svc = new WFPService(config);
      await svc.deleteWorker('worker-to-delete');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain('/scripts/worker-to-delete');
      expect(init.method).toBe('DELETE');
    });
  });

  describe('getWorker', () => {
    it('returns result from GET request', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockSuccessResponse({ id: 'worker-1', script: 'test' }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const svc = new WFPService(config);
      const result = await svc.getWorker('worker-1');
      expect(result).toEqual({ id: 'worker-1', script: 'test' });
    });
  });

  describe('workerExists', () => {
    it('returns true when worker exists', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockSuccessResponse({}));
      vi.stubGlobal('fetch', fetchMock);

      const svc = new WFPService(config);
      const exists = await svc.workerExists('existing-worker');
      expect(exists).toBe(true);
    });

    it('returns false when worker returns 404', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: false, errors: [{ code: 404, message: 'Not found' }], messages: [], result: null }), { status: 404 }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const svc = new WFPService(config);
      const exists = await svc.workerExists('missing-worker');
      expect(exists).toBe(false);
    });
  });

  describe('listWorkers', () => {
    it('returns workers array from API', async () => {
      const workers = [
        { id: 'w1', script: 'test', created_on: '2025-01-01', modified_on: '2025-01-01' },
      ];
      const fetchMock = vi.fn().mockResolvedValue(mockSuccessResponse(workers));
      vi.stubGlobal('fetch', fetchMock);

      const svc = new WFPService(config);
      const result = await svc.listWorkers();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('w1');
    });
  });

  describe('createD1Database', () => {
    it('returns the uuid from API response', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockSuccessResponse({ uuid: 'db-uuid-123' }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const svc = new WFPService(config);
      const uuid = await svc.createD1Database('my-db');
      expect(uuid).toBe('db-uuid-123');
    });

    it('throws when no uuid returned', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockSuccessResponse({}));
      vi.stubGlobal('fetch', fetchMock);

      const svc = new WFPService(config);
      await expect(svc.createD1Database('my-db')).rejects.toThrow('no UUID');
    });
  });

  describe('createR2Bucket', () => {
    it('sends POST request to create bucket', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockSuccessResponse(null));
      vi.stubGlobal('fetch', fetchMock);

      const svc = new WFPService(config);
      await svc.createR2Bucket('my-bucket');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain('/r2/buckets');
      expect(init.method).toBe('POST');
    });
  });

  describe('createKVNamespace', () => {
    it('returns the id from API response', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockSuccessResponse({ id: 'kv-ns-id' }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const svc = new WFPService(config);
      const id = await svc.createKVNamespace('my-kv');
      expect(id).toBe('kv-ns-id');
    });

    it('throws when no id returned', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockSuccessResponse({}));
      vi.stubGlobal('fetch', fetchMock);

      const svc = new WFPService(config);
      await expect(svc.createKVNamespace('kv')).rejects.toThrow('no ID');
    });
  });

  describe('createVectorizeIndex', () => {
    it('returns the index name', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockSuccessResponse({ name: 'my-index' }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const svc = new WFPService(config);
      const name = await svc.createVectorizeIndex('my-index', {
        dimensions: 1536,
        metric: 'cosine',
      });
      expect(name).toBe('my-index');
    });
  });

  describe('runD1SQL', () => {
    it('returns query results', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockSuccessResponse([{ results: [{ count: 42 }] }]),
      );
      vi.stubGlobal('fetch', fetchMock);

      const svc = new WFPService(config);
      const result = await svc.runD1SQL('db-id', 'SELECT COUNT(*) as count FROM users');
      expect(result).toEqual([{ results: [{ count: 42 }] }]);
    });
  });

  describe('listD1Tables', () => {
    it('extracts table names from D1 query result', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockSuccessResponse([{ results: [{ name: 'users' }, { name: 'posts' }] }]),
      );
      vi.stubGlobal('fetch', fetchMock);

      const svc = new WFPService(config);
      const tables = await svc.listD1Tables('db-id');
      expect(tables).toEqual([{ name: 'users' }, { name: 'posts' }]);
    });
  });

  describe('updateWorkerSettings', () => {
    it('sends PATCH request with settings', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockSuccessResponse(null));
      vi.stubGlobal('fetch', fetchMock);

      const svc = new WFPService(config);
      await svc.updateWorkerSettings({
        workerName: 'w1',
        bindings: [{ type: 'plain_text', name: 'ENV', text: 'prod' }],
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain('/scripts/w1/settings');
      expect(init.method).toBe('PATCH');
    });
  });

  describe('uploadToR2', () => {
    it('sends PUT request to R2 endpoint', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);

      const svc = new WFPService(config);
      await svc.uploadToR2('my-bucket', 'path/to/file.txt', 'file content', {
        contentType: 'text/plain',
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain('/r2/buckets/my-bucket/objects/');
      expect(init.method).toBe('PUT');
      expect(init.headers['Content-Type']).toBe('text/plain');
    });

    it('throws on non-ok response', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response('error', { status: 500 }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const svc = new WFPService(config);
      await expect(svc.uploadToR2('bucket', 'key', 'body')).rejects.toThrow('Failed to upload');
    });
  });

  describe('deployWorkerWithBindings', () => {
    it('throws when neither bundleUrl nor bundleScript provided', async () => {
      const svc = new WFPService(config);
      await expect(
        svc.deployWorkerWithBindings('w1', { bindings: [] }),
      ).rejects.toThrow('Either bundleUrl or bundleScript is required');
    });

    it('uses bundleScript directly when provided', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockSuccessResponse({}));
      vi.stubGlobal('fetch', fetchMock);

      const svc = new WFPService(config);
      await svc.deployWorkerWithBindings('w1', {
        bindings: [{ type: 'plain_text', name: 'VAR', text: 'val' }],
        bundleScript: 'export default {}',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});

// ---------------------------------------------------------------------------
// getTakosWorkerScript
// ---------------------------------------------------------------------------

describe('getTakosWorkerScript', () => {
  it('throws when WORKER_BUNDLES is not configured', async () => {
    await expect(getTakosWorkerScript({ WORKER_BUNDLES: undefined } as never)).rejects.toThrow(
      'WORKER_BUNDLES is not configured',
    );
  });

  it('throws when worker.js is missing from bucket', async () => {
    const bucket = new MockR2Bucket();
    await expect(getTakosWorkerScript({ WORKER_BUNDLES: bucket } as never)).rejects.toThrow(
      'worker.js is missing',
    );
  });

  it('returns worker script content from R2', async () => {
    const bucket = new MockR2Bucket();
    await bucket.put('worker.js', 'export default { fetch() {} }');
    const script = await getTakosWorkerScript({ WORKER_BUNDLES: bucket } as never);
    expect(script).toContain('export default');
  });
});

// ---------------------------------------------------------------------------
// getTakosMigrationSQL
// ---------------------------------------------------------------------------

describe('getTakosMigrationSQL', () => {
  it('returns a non-empty SQL string with CREATE TABLE statements', () => {
    const sql = getTakosMigrationSQL();
    expect(sql.length).toBeGreaterThan(0);
    expect(sql).toContain('CREATE TABLE');
    expect(sql).toContain('local_users');
    expect(sql).toContain('sessions');
    expect(sql).toContain('posts');
  });
});
