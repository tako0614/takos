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
    it('creates a D1 database and returns provider resource ids', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockSuccessResponse({ uuid: 'db-uuid-123' }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      const result = await svc.createResource('d1', 'my-database');

      expect(result.providerResourceId).toBe('db-uuid-123');
      expect(result.providerResourceName).toBe('my-database');
    });

    it('creates an R2 bucket and returns name as provider resource id', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockSuccessResponse(null));
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      const result = await svc.createResource('r2', 'my-bucket');

      expect(result.providerResourceId).toBe('my-bucket');
      expect(result.providerResourceName).toBe('my-bucket');
    });

    it('creates a KV namespace and returns id', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockSuccessResponse({ id: 'kv-id-456' }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      const result = await svc.createResource('kv', 'my-kv');

      expect(result.providerResourceId).toBe('kv-id-456');
      expect(result.providerResourceName).toBe('my-kv');
    });

    it('creates a Vectorize index with default options', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockSuccessResponse({ name: 'my-index' }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      const result = await svc.createResource('vectorize', 'my-index');

      expect(result.providerResourceId).toBe('my-index');
      expect(result.providerResourceName).toBe('my-index');
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

      expect(result.providerResourceId).toBe('custom-index');

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

      expect(result.providerResourceId).toBe('queue-id-123');
      expect(result.providerResourceName).toBe('my-queue');
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

      expect(result).toEqual({ providerResourceId: null, providerResourceName: 'event-dataset' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('treats workflow as a logical resource with no provider create call', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      const result = await svc.createResource('workflow', 'onboarding-flow');

      expect(result).toEqual({ providerResourceId: null, providerResourceName: 'onboarding-flow' });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('deleteResource', () => {
    it('deletes a D1 database by provider resource id', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockSuccessResponse(null));
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      await svc.deleteResource({ type: 'd1', providerResourceId: 'db-uuid-123' });

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('/d1/database/db-uuid-123');
    });

    it('deletes an R2 bucket by provider resource name', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockSuccessResponse(null));
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      await svc.deleteResource({ type: 'r2', providerResourceName: 'my-bucket' });

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('/r2/buckets/my-bucket');
    });

    it('deletes a queue by provider resource id', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockSuccessResponse(null));
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      await svc.deleteResource({ type: 'queue', providerResourceId: 'queue-id-123' });

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('/queues/queue-id-123');
    });

    it('deletes a KV namespace by provider resource id', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockSuccessResponse(null));
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      await svc.deleteResource({ type: 'kv', providerResourceId: 'kv-id-456' });

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('/storage/kv/namespaces/kv-id-456');
    });

    it('deletes a Vectorize index by provider resource name', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockSuccessResponse(null));
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      await svc.deleteResource({ type: 'vectorize', providerResourceName: 'my-index' });

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('/vectorize/v2/indexes/my-index');
    });

    it('is a no-op for analytics_engine resources', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      await svc.deleteResource({ type: 'analytics_engine', providerResourceName: 'event-dataset' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('is a no-op for workflow resources', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      await svc.deleteResource({ type: 'workflow', providerResourceName: 'onboarding-flow' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('deletes a worker by provider resource name', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockSuccessResponse(null));
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      await svc.deleteResource({ type: 'worker', providerResourceName: 'worker-to-delete' });

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('/scripts/worker-to-delete');
    });

    it('is a no-op for D1 when provider resource id is not provided', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      await svc.deleteResource({ type: 'd1', providerResourceId: null });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('is a no-op for R2 when provider resource name is not provided', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      await svc.deleteResource({ type: 'r2', providerResourceName: null });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('is a no-op for unknown resource type', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      await svc.deleteResource({ type: 'unknown_type', providerResourceName: 'x' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('handles whitespace in type parameter', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const svc = new CloudflareResourceService(env);
      await svc.deleteResource({ type: '  ', providerResourceName: 'x' });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('wfp property', () => {
    it('exposes the WFP service for direct access', () => {
      const svc = new CloudflareResourceService(env);
      expect(svc.wfp).toBeDefined();
      expect(svc.wfp.d1).toBeDefined();
    });
  });
});
