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
  ...(await importOriginal<typeof import('@/shared/utils')>()),
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
      cfId: 'cf-new-id',
      cfName: 'my-db',
    });
    mocks.insertResource.mockResolvedValue(undefined);

    const result = await provisionCloudflareResource(mockEnv, {
      ownerId: 'user-1',
      name: 'My Database',
      type: 'd1',
      cfName: 'my-db',
    });

    expect(result.id).toBe('generated-id');
    expect(result.cfId).toBe('cf-new-id');
    expect(result.cfName).toBe('my-db');
    expect(mocks.createResource).toHaveBeenCalledWith('d1', 'my-db', {});
    expect(mocks.insertResource).toHaveBeenCalledWith(
      mockEnv.DB,
      expect.objectContaining({
        id: 'generated-id',
        owner_id: 'user-1',
        name: 'My Database',
        type: 'd1',
        status: 'active',
        cf_id: 'cf-new-id',
        cf_name: 'my-db',
      })
    );
  });

  it('uses provided id and timestamp', async () => {
    mocks.createResource.mockResolvedValue({
      cfId: 'cf-id',
      cfName: 'custom-db',
    });
    mocks.insertResource.mockResolvedValue(undefined);

    const result = await provisionCloudflareResource(mockEnv, {
      id: 'custom-id',
      timestamp: '2026-06-01T00:00:00.000Z',
      ownerId: 'user-1',
      name: 'Custom DB',
      type: 'd1',
      cfName: 'custom-db',
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
      cfId: 'cf-vec-id',
      cfName: 'my-vectors',
    });
    mocks.insertResource.mockResolvedValue(undefined);

    await provisionCloudflareResource(mockEnv, {
      ownerId: 'user-1',
      name: 'Vectors',
      type: 'vectorize' as any,
      cfName: 'my-vectors',
      vectorize: {
        dimensions: 1536,
        metric: 'cosine',
      },
    });

    expect(mocks.createResource).toHaveBeenCalledWith('vectorize', 'my-vectors', {
      vectorize: { dimensions: 1536, metric: 'cosine' },
    });
  });

  it('records failure when recordFailure is true and provider throws', async () => {
    const error = new Error('Cloudflare API error');
    mocks.createResource.mockRejectedValue(error);
    mocks.insertFailedResource.mockResolvedValue(undefined);

    await expect(
      provisionCloudflareResource(mockEnv, {
        ownerId: 'user-1',
        name: 'Failed DB',
        type: 'd1',
        cfName: 'fail-db',
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
        cf_name: 'fail-db',
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
        type: 'd1',
        cfName: 'fail-db',
      })
    ).rejects.toThrow('API error');

    expect(mocks.insertFailedResource).not.toHaveBeenCalled();
  });

  it('passes spaceId to insertResource', async () => {
    mocks.createResource.mockResolvedValue({
      cfId: 'cf-id',
      cfName: 'test-db',
    });
    mocks.insertResource.mockResolvedValue(undefined);

    await provisionCloudflareResource(mockEnv, {
      ownerId: 'user-1',
      spaceId: 'space-1',
      name: 'Test DB',
      type: 'd1',
      cfName: 'test-db',
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
      cfId: 'cf-id',
      cfName: 'test-db',
    });
    mocks.insertResource.mockResolvedValue(undefined);

    await provisionCloudflareResource(mockEnv, {
      ownerId: 'user-1',
      name: 'Test DB',
      type: 'd1',
      cfName: 'test-db',
      config: { region: 'us-east-1' },
    });

    expect(mocks.insertResource).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        config: { region: 'us-east-1' },
      })
    );
  });
});
