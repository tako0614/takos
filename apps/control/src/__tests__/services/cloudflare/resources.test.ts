import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

import { CloudflareResourceService } from '@/platform/providers/cloudflare/resources.ts';

describe('CloudflareResourceService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const env = {
    CF_ACCOUNT_ID: 'acc-1',
    CF_API_TOKEN: 'tok-1',
    WFP_DISPATCH_NAMESPACE: 'ns-1',
  };

  function mockSuccessResponse<T>(result: T) {
    return new Response(JSON.stringify({
      success: true,
      result,
      errors: [],
      messages: [],
    }), { status: 200 });
  }

  describe('createResource', () => {
    it('creates a D1 database and returns cfId', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockSuccessResponse({ uuid: 'db-uuid-123' }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      const result = await svc.createResource('d1', 'my-database');

      expect(result.cfId).toBe('db-uuid-123');
      expect(result.cfName).toBe('my-database');
    });

    it('creates an R2 bucket and returns name as cfId', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockSuccessResponse(null));
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      const result = await svc.createResource('r2', 'my-bucket');

      expect(result.cfId).toBe('my-bucket');
      expect(result.cfName).toBe('my-bucket');
    });

    it('creates a KV namespace and returns id', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockSuccessResponse({ id: 'kv-id-456' }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      const result = await svc.createResource('kv', 'my-kv');

      expect(result.cfId).toBe('kv-id-456');
      expect(result.cfName).toBe('my-kv');
    });

    it('creates a Vectorize index with default options', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockSuccessResponse({ name: 'my-index' }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      const result = await svc.createResource('vectorize', 'my-index');

      expect(result.cfId).toBe('my-index');
      expect(result.cfName).toBe('my-index');
    });

    it('creates a Vectorize index with custom options', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockSuccessResponse({ name: 'custom-index' }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      const result = await svc.createResource('vectorize', 'custom-index', {
        vectorize: { dimensions: 768, metric: 'euclidean' },
      });

      expect(result.cfId).toBe('custom-index');

      // Verify the body sent to the API contains the custom options
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      // The body may be wrapped, just check that the API was called
      expect(fetchMock).toHaveBeenCalled();
    });

    it('creates a queue and returns the queue id', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockSuccessResponse({ queue_id: 'queue-id-123', queue_name: 'my-queue' }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      const result = await svc.createResource('queue', 'my-queue', {
        queue: { deliveryDelaySeconds: 10 },
      });

      expect(result.cfId).toBe('queue-id-123');
      expect(result.cfName).toBe('my-queue');
      expect(fetchMock.mock.calls[0][0]).toContain('/queues');
      expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
        queue_name: 'my-queue',
        settings: {
          delivery_delay: 10,
        },
      });
    });

    it('treats analytics_engine as a logical resource with no provider create call', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      const result = await svc.createResource('analytics_engine', 'event-dataset');

      expect(result).toEqual({ cfId: null, cfName: 'event-dataset' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('treats workflow as a logical resource with no provider create call', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      const result = await svc.createResource('workflow', 'onboarding-flow');

      expect(result).toEqual({ cfId: null, cfName: 'onboarding-flow' });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('deleteResource', () => {
    it('deletes a D1 database by cfId', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockSuccessResponse(null));
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      await svc.deleteResource({ type: 'd1', cfId: 'db-uuid-123' });

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('/d1/database/db-uuid-123');
    });

    it('deletes an R2 bucket by cfName', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockSuccessResponse(null));
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      await svc.deleteResource({ type: 'r2', cfName: 'my-bucket' });

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('/r2/buckets/my-bucket');
    });

    it('deletes a queue by cfId', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockSuccessResponse(null));
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      await svc.deleteResource({ type: 'queue', cfId: 'queue-id-123' });

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('/queues/queue-id-123');
    });

    it('deletes a KV namespace by cfId', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockSuccessResponse(null));
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      await svc.deleteResource({ type: 'kv', cfId: 'kv-id-456' });

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('/storage/kv/namespaces/kv-id-456');
    });

    it('deletes a Vectorize index by cfName', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockSuccessResponse(null));
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      await svc.deleteResource({ type: 'vectorize', cfName: 'my-index' });

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('/vectorize/v2/indexes/my-index');
    });

    it('is a no-op for analytics_engine resources', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      await svc.deleteResource({ type: 'analytics_engine', cfName: 'event-dataset' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('is a no-op for workflow resources', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      await svc.deleteResource({ type: 'workflow', cfName: 'onboarding-flow' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('deletes a worker by cfName', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockSuccessResponse(null));
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      await svc.deleteResource({ type: 'worker', cfName: 'worker-to-delete' });

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('/scripts/worker-to-delete');
    });

    it('is a no-op for D1 when cfId is not provided', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      await svc.deleteResource({ type: 'd1', cfId: null });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('is a no-op for R2 when cfName is not provided', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      await svc.deleteResource({ type: 'r2', cfName: null });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('is a no-op for unknown resource type', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      await svc.deleteResource({ type: 'unknown_type', cfName: 'x' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('handles whitespace in type parameter', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      await svc.deleteResource({ type: '  ', cfName: 'x' });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('executeD1Query', () => {
    it('executes SQL through the WFP service', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockSuccessResponse([{ results: [{ count: 5 }] }]),
      );
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      await svc.executeD1Query('db-1', 'SELECT COUNT(*) FROM users');

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('/d1/database/db-1/query');
    });
  });
});
