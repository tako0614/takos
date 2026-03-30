import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Env } from '@/types';

const mocks = vi.hoisted(() => ({
  insertResource: vi.fn(),
  insertFailedResource: vi.fn(),
  createResource: vi.fn(),
  generateId: vi.fn(),
  now: vi.fn(),
}));

vi.mock('@/services/resources/store', () => ({
  insertResource: mocks.insertResource,
  insertFailedResource: mocks.insertFailedResource,
}));

vi.mock('@/services/cloudflare/resources', () => ({
  CloudflareResourceService: vi.fn().mockImplementation(() => ({
    createResource: mocks.createResource,
  })),
}));

vi.mock('@/shared/utils', async (importOriginal) => ({
  ...(await importOriginal()),
  generateId: mocks.generateId,
  now: mocks.now,
}));

import { provisionCloudflareResource } from '@/services/resources/lifecycle';

describe('provisionCloudflareResource', () => {
  const mockEnv = {
    DB: {} as any,
    CF_ACCOUNT_ID: 'test-account',
    CF_API_TOKEN: 'test-token',
  } as unknown as Env;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateId.mockReturnValue('generated-id');
    mocks.now.mockReturnValue('2026-01-01T00:00:00.000Z');
  });

  it('provisions a resource and inserts it into the database', async () => {
    mocks.createResource.mockResolvedValue({
      providerResourceId: 'cf-new-id',
      providerResourceName: 'my-db',
    });
    mocks.insertResource.mockResolvedValue(undefined);

    const result = await provisionCloudflareResource(mockEnv, {
      ownerId: 'user-1',
      name: 'My Database',
      type: 'sql',
      providerResourceName: 'my-db',
    });

    expect(result.id).toBe('generated-id');
    expect(result.providerResourceId).toBe('cf-new-id');
    expect(result.providerResourceName).toBe('my-db');
    expect(mocks.createResource).toHaveBeenCalledWith('d1', 'my-db', {});
    expect(mocks.insertResource).toHaveBeenCalledWith(
      mockEnv.DB,
      expect.objectContaining({
        id: 'generated-id',
        owner_id: 'user-1',
        name: 'My Database',
        type: 'd1',
        semantic_type: 'sql',
        driver: 'cloudflare-d1',
        provider_name: 'cloudflare',
        status: 'active',
        provider_resource_id: 'cf-new-id',
        provider_resource_name: 'my-db',
      })
    );
  });

  it('uses provided id and timestamp', async () => {
    mocks.createResource.mockResolvedValue({
      providerResourceId: 'cf-id',
      providerResourceName: 'custom-db',
    });
    mocks.insertResource.mockResolvedValue(undefined);

    const result = await provisionCloudflareResource(mockEnv, {
      id: 'custom-id',
      timestamp: '2026-06-01T00:00:00.000Z',
      ownerId: 'user-1',
      name: 'Custom DB',
      type: 'sql',
      providerResourceName: 'custom-db',
    });

    expect(result.id).toBe('custom-id');
    expect(mocks.insertResource).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'custom-id',
        created_at: '2026-06-01T00:00:00.000Z',
        updated_at: '2026-06-01T00:00:00.000Z',
      })
    );
  });

  it('passes vectorize options to createResource', async () => {
    mocks.createResource.mockResolvedValue({
      providerResourceId: 'cf-vec-id',
      providerResourceName: 'my-vectors',
    });
    mocks.insertResource.mockResolvedValue(undefined);

    await provisionCloudflareResource(mockEnv, {
      ownerId: 'user-1',
      name: 'Vectors',
      type: 'vector_index',
      providerResourceName: 'my-vectors',
      vectorIndex: {
        dimensions: 1536,
        metric: 'cosine',
      },
    });

    expect(mocks.createResource).toHaveBeenCalledWith('vectorize', 'my-vectors', {
      vectorize: { dimensions: 1536, metric: 'cosine' },
    });
  });

  it('provisions a queue resource through the Cloudflare provider', async () => {
    mocks.createResource.mockResolvedValue({
      providerResourceId: 'queue-id-123',
      providerResourceName: 'my-queue',
    });
    mocks.insertResource.mockResolvedValue(undefined);

    const result = await provisionCloudflareResource(mockEnv, {
      ownerId: 'user-1',
      name: 'Queue',
      type: 'queue' as any,
      providerResourceName: 'my-queue',
    });

    expect(result.providerResourceId).toBe('queue-id-123');
    expect(mocks.createResource).toHaveBeenCalledWith('queue', 'my-queue', {});
  });

  it('treats analyticsEngine as a logical resource without provider provisioning', async () => {
    mocks.createResource.mockResolvedValue({
      providerResourceId: null,
      providerResourceName: 'event-dataset',
    });
    mocks.insertResource.mockResolvedValue(undefined);

    const result = await provisionCloudflareResource(mockEnv, {
      ownerId: 'user-1',
      name: 'Analytics',
      type: 'analytics_store',
      providerResourceName: 'event-dataset',
    });

    expect(result).toEqual({
      id: 'generated-id',
      providerResourceId: null,
      providerResourceName: 'event-dataset',
    });
    expect(mocks.createResource).toHaveBeenCalledWith('analytics_engine', 'event-dataset', {});
  });

  it('records failure when recordFailure is true and provider throws', async () => {
    const error = new Error('Cloudflare API error');
    mocks.createResource.mockRejectedValue(error);
    mocks.insertFailedResource.mockResolvedValue(undefined);

    await expect(
      provisionCloudflareResource(mockEnv, {
        ownerId: 'user-1',
        name: 'Failed DB',
        type: 'sql',
        providerResourceName: 'fail-db',
        recordFailure: true,
      })
    ).rejects.toThrow('Cloudflare API error');

    expect(mocks.insertFailedResource).toHaveBeenCalledWith(
      mockEnv.DB,
      expect.objectContaining({
        id: 'generated-id',
        owner_id: 'user-1',
        name: 'Failed DB',
        type: 'd1',
        semantic_type: 'sql',
        driver: 'cloudflare-d1',
        provider_name: 'cloudflare',
        provider_resource_name: 'fail-db',
        config: expect.objectContaining({
          error: 'Cloudflare API error',
        }),
      })
    );
  });

  it('does not record failure when recordFailure is not set', async () => {
    mocks.createResource.mockRejectedValue(new Error('API error'));

    await expect(
      provisionCloudflareResource(mockEnv, {
        ownerId: 'user-1',
        name: 'Failed DB',
        type: 'sql',
        providerResourceName: 'fail-db',
      })
    ).rejects.toThrow('API error');

    expect(mocks.insertFailedResource).not.toHaveBeenCalled();
  });

  it('passes spaceId to insertResource', async () => {
    mocks.createResource.mockResolvedValue({
      providerResourceId: 'cf-id',
      providerResourceName: 'test-db',
    });
    mocks.insertResource.mockResolvedValue(undefined);

    await provisionCloudflareResource(mockEnv, {
      ownerId: 'user-1',
      spaceId: 'space-1',
      name: 'Test DB',
      type: 'sql',
      providerResourceName: 'test-db',
    });

    expect(mocks.insertResource).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        space_id: 'space-1',
      })
    );
  });

  it('passes config to insertResource', async () => {
    mocks.createResource.mockResolvedValue({
      providerResourceId: 'cf-id',
      providerResourceName: 'test-db',
    });
    mocks.insertResource.mockResolvedValue(undefined);

    await provisionCloudflareResource(mockEnv, {
      ownerId: 'user-1',
      name: 'Test DB',
      type: 'sql',
      providerResourceName: 'test-db',
      config: { region: 'us-east-1' },
    });

    expect(mocks.insertResource).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        config: expect.objectContaining({
          region: 'us-east-1',
        }),
      })
    );
  });
});
