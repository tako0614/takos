import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Env } from '@/types';

const mocks = vi.hoisted(() => ({
  insertResource: vi.fn(),
  insertFailedResource: vi.fn(),
  createResource: vi.fn(),
  deleteResource: vi.fn(),
  ensurePortableManagedResource: vi.fn(),
  deletePortableManagedResource: vi.fn(),
  resolvePortableResourceReferenceId: vi.fn(),
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
    deleteResource: mocks.deleteResource,
  })),
}));

vi.mock('@/services/resources/portable-runtime', () => ({
  ensurePortableManagedResource: mocks.ensurePortableManagedResource,
  deletePortableManagedResource: mocks.deletePortableManagedResource,
  resolvePortableResourceReferenceId: mocks.resolvePortableResourceReferenceId,
}));

vi.mock('@/shared/utils', async (importOriginal) => ({
  ...(await importOriginal()),
  generateId: mocks.generateId,
  now: mocks.now,
}));

import {
  deleteManagedResource,
  provisionCloudflareResource,
} from '@/services/resources/lifecycle';

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
    mocks.ensurePortableManagedResource.mockResolvedValue(undefined);
    mocks.deletePortableManagedResource.mockResolvedValue(undefined);
    mocks.resolvePortableResourceReferenceId.mockResolvedValue('portable-resource-ref');
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

  it('records a portable sql resource without Cloudflare API calls', async () => {
    mocks.insertResource.mockResolvedValue(undefined);

    const result = await provisionCloudflareResource({
      DB: mockEnv.DB,
      CF_ACCOUNT_ID: mockEnv.CF_ACCOUNT_ID,
      CF_API_TOKEN: mockEnv.CF_API_TOKEN,
    } as unknown as Env, {
      ownerId: 'user-1',
      name: 'Portable DB',
      type: 'sql',
      providerName: 'aws',
      providerResourceName: 'portable-db',
      persist: true,
    });

    expect(mocks.createResource).not.toHaveBeenCalled();
    expect(mocks.ensurePortableManagedResource).toHaveBeenCalledWith({
      id: 'generated-id',
      provider_name: 'aws',
      provider_resource_name: 'portable-db',
    }, 'sql');
    expect(result).toEqual({
      id: 'generated-id',
      providerResourceId: 'portable-db-generated-id',
      providerResourceName: 'portable-db',
    });
    expect(mocks.insertResource).toHaveBeenCalledWith(
      mockEnv.DB,
      expect.objectContaining({
        provider_name: 'aws',
        provider_resource_id: 'portable-db-generated-id',
        provider_resource_name: 'portable-db',
      }),
    );
  });

  it('supports dry-run portable resources without persistence', async () => {
    const result = await provisionCloudflareResource({
      DB: mockEnv.DB,
      CF_ACCOUNT_ID: mockEnv.CF_ACCOUNT_ID,
      CF_API_TOKEN: mockEnv.CF_API_TOKEN,
    } as unknown as Env, {
      ownerId: 'user-1',
      name: 'Dry-run DB',
      type: 'sql',
      providerName: 'gcp',
      providerResourceName: 'dryrun-db',
      persist: false,
    });

    expect(result).toEqual({
      id: 'generated-id',
      providerResourceId: 'dryrun-db-generated-id',
      providerResourceName: 'dryrun-db',
    });
    expect(mocks.createResource).not.toHaveBeenCalled();
    expect(mocks.insertResource).not.toHaveBeenCalled();
    expect(mocks.ensurePortableManagedResource).toHaveBeenCalledWith({
      id: 'generated-id',
      provider_name: 'gcp',
      provider_resource_name: 'dryrun-db',
    }, 'sql');
  });

  it('stores a portable secret reference as provider resource id', async () => {
    mocks.insertResource.mockResolvedValue(undefined);
    mocks.ensurePortableManagedResource.mockResolvedValue(undefined);

    const result = await provisionCloudflareResource({
      DB: mockEnv.DB,
      CF_ACCOUNT_ID: mockEnv.CF_ACCOUNT_ID,
      CF_API_TOKEN: mockEnv.CF_API_TOKEN,
    } as unknown as Env, {
      ownerId: 'user-1',
      name: 'Portable Secret',
      type: 'secret',
      providerName: 'local',
      providerResourceName: 'portable-secret',
      persist: true,
    });

    expect(result.providerResourceName).toBe('portable-secret');
    expect(result.providerResourceId).toBe('portable-resource-ref');
    expect(mocks.insertResource).toHaveBeenCalledWith(
      mockEnv.DB,
      expect.objectContaining({
        provider_name: 'local',
        provider_resource_name: 'portable-secret',
        provider_resource_id: 'portable-resource-ref',
      }),
    );
  });

  it('does not call Cloudflare delete API for non-cloudflare provider', async () => {
    await deleteManagedResource({
      DB: mockEnv.DB,
      CF_ACCOUNT_ID: mockEnv.CF_ACCOUNT_ID,
      CF_API_TOKEN: mockEnv.CF_API_TOKEN,
    } as unknown as Env, {
      type: 'sql',
      providerName: 'k8s',
      providerResourceId: 'remote-id',
      providerResourceName: 'portable-db',
    });

    expect(mocks.deleteResource).not.toHaveBeenCalled();
    expect(mocks.deletePortableManagedResource).toHaveBeenCalledWith({
      id: 'remote-id',
      provider_name: 'k8s',
      provider_resource_name: 'portable-db',
    }, 'sql');
  });
});
