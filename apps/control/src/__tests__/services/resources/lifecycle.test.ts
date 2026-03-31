import type { Env } from '@/types';

import { assertEquals, assertRejects } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  insertResource: ((..._args: any[]) => undefined) as any,
  insertFailedResource: ((..._args: any[]) => undefined) as any,
  createResource: ((..._args: any[]) => undefined) as any,
  deleteResource: ((..._args: any[]) => undefined) as any,
  ensurePortableManagedResource: ((..._args: any[]) => undefined) as any,
  deletePortableManagedResource: ((..._args: any[]) => undefined) as any,
  resolvePortableResourceReferenceId: ((..._args: any[]) => undefined) as any,
  generateId: ((..._args: any[]) => undefined) as any,
  now: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/services/resources/store'
// [Deno] vi.mock removed - manually stub imports from '@/services/cloudflare/resources'
// [Deno] vi.mock removed - manually stub imports from '@/services/resources/portable-runtime'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils'
import {
  deleteManagedResource,
  provisionCloudflareResource,
} from '@/services/resources/lifecycle';


  const mockEnv = {
    DB: {} as any,
    CF_ACCOUNT_ID: 'test-account',
    CF_API_TOKEN: 'test-token',
  } as unknown as Env;
  Deno.test('provisionCloudflareResource - provisions a resource and inserts it into the database', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'generated-id') as any;
    mocks.now = (() => '2026-01-01T00:00:00.000Z') as any;
    mocks.ensurePortableManagedResource = (async () => undefined) as any;
    mocks.deletePortableManagedResource = (async () => undefined) as any;
    mocks.resolvePortableResourceReferenceId = (async () => 'portable-resource-ref') as any;
  mocks.createResource = (async () => ({
      providerResourceId: 'cf-new-id',
      providerResourceName: 'my-db',
    })) as any;
    mocks.insertResource = (async () => undefined) as any;

    const result = await provisionCloudflareResource(mockEnv, {
      ownerId: 'user-1',
      name: 'My Database',
      type: 'sql',
      providerResourceName: 'my-db',
    });

    assertEquals(result.id, 'generated-id');
    assertEquals(result.providerResourceId, 'cf-new-id');
    assertEquals(result.providerResourceName, 'my-db');
    assertSpyCallArgs(mocks.createResource, 0, ['d1', 'my-db', {}]);
    assertSpyCallArgs(mocks.insertResource, 0, [
      mockEnv.DB,
      ({
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
    ]);
})
  Deno.test('provisionCloudflareResource - uses provided id and timestamp', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'generated-id') as any;
    mocks.now = (() => '2026-01-01T00:00:00.000Z') as any;
    mocks.ensurePortableManagedResource = (async () => undefined) as any;
    mocks.deletePortableManagedResource = (async () => undefined) as any;
    mocks.resolvePortableResourceReferenceId = (async () => 'portable-resource-ref') as any;
  mocks.createResource = (async () => ({
      providerResourceId: 'cf-id',
      providerResourceName: 'custom-db',
    })) as any;
    mocks.insertResource = (async () => undefined) as any;

    const result = await provisionCloudflareResource(mockEnv, {
      id: 'custom-id',
      timestamp: '2026-06-01T00:00:00.000Z',
      ownerId: 'user-1',
      name: 'Custom DB',
      type: 'sql',
      providerResourceName: 'custom-db',
    });

    assertEquals(result.id, 'custom-id');
    assertSpyCallArgs(mocks.insertResource, 0, [
      expect.anything(),
      ({
        id: 'custom-id',
        created_at: '2026-06-01T00:00:00.000Z',
        updated_at: '2026-06-01T00:00:00.000Z',
      })
    ]);
})
  Deno.test('provisionCloudflareResource - passes vectorize options to createResource', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'generated-id') as any;
    mocks.now = (() => '2026-01-01T00:00:00.000Z') as any;
    mocks.ensurePortableManagedResource = (async () => undefined) as any;
    mocks.deletePortableManagedResource = (async () => undefined) as any;
    mocks.resolvePortableResourceReferenceId = (async () => 'portable-resource-ref') as any;
  mocks.createResource = (async () => ({
      providerResourceId: 'cf-vec-id',
      providerResourceName: 'my-vectors',
    })) as any;
    mocks.insertResource = (async () => undefined) as any;

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

    assertSpyCallArgs(mocks.createResource, 0, ['vectorize', 'my-vectors', {
      vectorize: { dimensions: 1536, metric: 'cosine' },
    }]);
})
  Deno.test('provisionCloudflareResource - provisions a queue resource through the Cloudflare provider', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'generated-id') as any;
    mocks.now = (() => '2026-01-01T00:00:00.000Z') as any;
    mocks.ensurePortableManagedResource = (async () => undefined) as any;
    mocks.deletePortableManagedResource = (async () => undefined) as any;
    mocks.resolvePortableResourceReferenceId = (async () => 'portable-resource-ref') as any;
  mocks.createResource = (async () => ({
      providerResourceId: 'queue-id-123',
      providerResourceName: 'my-queue',
    })) as any;
    mocks.insertResource = (async () => undefined) as any;

    const result = await provisionCloudflareResource(mockEnv, {
      ownerId: 'user-1',
      name: 'Queue',
      type: 'queue' as any,
      providerResourceName: 'my-queue',
    });

    assertEquals(result.providerResourceId, 'queue-id-123');
    assertSpyCallArgs(mocks.createResource, 0, ['queue', 'my-queue', {}]);
})
  Deno.test('provisionCloudflareResource - treats analyticsEngine as a logical resource without provider provisioning', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'generated-id') as any;
    mocks.now = (() => '2026-01-01T00:00:00.000Z') as any;
    mocks.ensurePortableManagedResource = (async () => undefined) as any;
    mocks.deletePortableManagedResource = (async () => undefined) as any;
    mocks.resolvePortableResourceReferenceId = (async () => 'portable-resource-ref') as any;
  mocks.createResource = (async () => ({
      providerResourceId: null,
      providerResourceName: 'event-dataset',
    })) as any;
    mocks.insertResource = (async () => undefined) as any;

    const result = await provisionCloudflareResource(mockEnv, {
      ownerId: 'user-1',
      name: 'Analytics',
      type: 'analytics_store',
      providerResourceName: 'event-dataset',
    });

    assertEquals(result, {
      id: 'generated-id',
      providerResourceId: null,
      providerResourceName: 'event-dataset',
    });
    assertSpyCallArgs(mocks.createResource, 0, ['analytics_engine', 'event-dataset', {}]);
})
  Deno.test('provisionCloudflareResource - records failure when recordFailure is true and provider throws', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'generated-id') as any;
    mocks.now = (() => '2026-01-01T00:00:00.000Z') as any;
    mocks.ensurePortableManagedResource = (async () => undefined) as any;
    mocks.deletePortableManagedResource = (async () => undefined) as any;
    mocks.resolvePortableResourceReferenceId = (async () => 'portable-resource-ref') as any;
  const error = new Error('Cloudflare API error');
    mocks.createResource = (async () => { throw error; }) as any;
    mocks.insertFailedResource = (async () => undefined) as any;

    await await assertRejects(async () => { await 
      provisionCloudflareResource(mockEnv, {
        ownerId: 'user-1',
        name: 'Failed DB',
        type: 'sql',
        providerResourceName: 'fail-db',
        recordFailure: true,
      })
    ; }, 'Cloudflare API error');

    assertSpyCallArgs(mocks.insertFailedResource, 0, [
      mockEnv.DB,
      ({
        id: 'generated-id',
        owner_id: 'user-1',
        name: 'Failed DB',
        type: 'd1',
        semantic_type: 'sql',
        driver: 'cloudflare-d1',
        provider_name: 'cloudflare',
        provider_resource_name: 'fail-db',
        config: ({
          error: 'Cloudflare API error',
        }),
      })
    ]);
})
  Deno.test('provisionCloudflareResource - does not record failure when recordFailure is not set', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'generated-id') as any;
    mocks.now = (() => '2026-01-01T00:00:00.000Z') as any;
    mocks.ensurePortableManagedResource = (async () => undefined) as any;
    mocks.deletePortableManagedResource = (async () => undefined) as any;
    mocks.resolvePortableResourceReferenceId = (async () => 'portable-resource-ref') as any;
  mocks.createResource = (async () => { throw new Error('API error'); }) as any;

    await await assertRejects(async () => { await 
      provisionCloudflareResource(mockEnv, {
        ownerId: 'user-1',
        name: 'Failed DB',
        type: 'sql',
        providerResourceName: 'fail-db',
      })
    ; }, 'API error');

    assertSpyCalls(mocks.insertFailedResource, 0);
})
  Deno.test('provisionCloudflareResource - passes spaceId to insertResource', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'generated-id') as any;
    mocks.now = (() => '2026-01-01T00:00:00.000Z') as any;
    mocks.ensurePortableManagedResource = (async () => undefined) as any;
    mocks.deletePortableManagedResource = (async () => undefined) as any;
    mocks.resolvePortableResourceReferenceId = (async () => 'portable-resource-ref') as any;
  mocks.createResource = (async () => ({
      providerResourceId: 'cf-id',
      providerResourceName: 'test-db',
    })) as any;
    mocks.insertResource = (async () => undefined) as any;

    await provisionCloudflareResource(mockEnv, {
      ownerId: 'user-1',
      spaceId: 'space-1',
      name: 'Test DB',
      type: 'sql',
      providerResourceName: 'test-db',
    });

    assertSpyCallArgs(mocks.insertResource, 0, [
      expect.anything(),
      ({
        space_id: 'space-1',
      })
    ]);
})
  Deno.test('provisionCloudflareResource - passes config to insertResource', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'generated-id') as any;
    mocks.now = (() => '2026-01-01T00:00:00.000Z') as any;
    mocks.ensurePortableManagedResource = (async () => undefined) as any;
    mocks.deletePortableManagedResource = (async () => undefined) as any;
    mocks.resolvePortableResourceReferenceId = (async () => 'portable-resource-ref') as any;
  mocks.createResource = (async () => ({
      providerResourceId: 'cf-id',
      providerResourceName: 'test-db',
    })) as any;
    mocks.insertResource = (async () => undefined) as any;

    await provisionCloudflareResource(mockEnv, {
      ownerId: 'user-1',
      name: 'Test DB',
      type: 'sql',
      providerResourceName: 'test-db',
      config: { region: 'us-east-1' },
    });

    assertSpyCallArgs(mocks.insertResource, 0, [
      expect.anything(),
      ({
        config: ({
          region: 'us-east-1',
        }),
      })
    ]);
})
  Deno.test('provisionCloudflareResource - records a portable sql resource without Cloudflare API calls', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'generated-id') as any;
    mocks.now = (() => '2026-01-01T00:00:00.000Z') as any;
    mocks.ensurePortableManagedResource = (async () => undefined) as any;
    mocks.deletePortableManagedResource = (async () => undefined) as any;
    mocks.resolvePortableResourceReferenceId = (async () => 'portable-resource-ref') as any;
  mocks.insertResource = (async () => undefined) as any;

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

    assertSpyCalls(mocks.createResource, 0);
    assertSpyCallArgs(mocks.ensurePortableManagedResource, 0, [{
      id: 'generated-id',
      provider_name: 'aws',
      provider_resource_name: 'portable-db',
    }, 'sql']);
    assertEquals(result, {
      id: 'generated-id',
      providerResourceId: 'portable-db-generated-id',
      providerResourceName: 'portable-db',
    });
    assertSpyCallArgs(mocks.insertResource, 0, [
      mockEnv.DB,
      ({
        provider_name: 'aws',
        provider_resource_id: 'portable-db-generated-id',
        provider_resource_name: 'portable-db',
      }),
    ]);
})
  Deno.test('provisionCloudflareResource - supports dry-run portable resources without persistence', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'generated-id') as any;
    mocks.now = (() => '2026-01-01T00:00:00.000Z') as any;
    mocks.ensurePortableManagedResource = (async () => undefined) as any;
    mocks.deletePortableManagedResource = (async () => undefined) as any;
    mocks.resolvePortableResourceReferenceId = (async () => 'portable-resource-ref') as any;
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

    assertEquals(result, {
      id: 'generated-id',
      providerResourceId: 'dryrun-db-generated-id',
      providerResourceName: 'dryrun-db',
    });
    assertSpyCalls(mocks.createResource, 0);
    assertSpyCalls(mocks.insertResource, 0);
    assertSpyCallArgs(mocks.ensurePortableManagedResource, 0, [{
      id: 'generated-id',
      provider_name: 'gcp',
      provider_resource_name: 'dryrun-db',
    }, 'sql']);
})
  Deno.test('provisionCloudflareResource - stores a portable secret reference as provider resource id', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'generated-id') as any;
    mocks.now = (() => '2026-01-01T00:00:00.000Z') as any;
    mocks.ensurePortableManagedResource = (async () => undefined) as any;
    mocks.deletePortableManagedResource = (async () => undefined) as any;
    mocks.resolvePortableResourceReferenceId = (async () => 'portable-resource-ref') as any;
  mocks.insertResource = (async () => undefined) as any;
    mocks.ensurePortableManagedResource = (async () => undefined) as any;

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

    assertEquals(result.providerResourceName, 'portable-secret');
    assertEquals(result.providerResourceId, 'portable-resource-ref');
    assertSpyCallArgs(mocks.insertResource, 0, [
      mockEnv.DB,
      ({
        provider_name: 'local',
        provider_resource_name: 'portable-secret',
        provider_resource_id: 'portable-resource-ref',
      }),
    ]);
})
  Deno.test('provisionCloudflareResource - does not call Cloudflare delete API for non-cloudflare provider', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'generated-id') as any;
    mocks.now = (() => '2026-01-01T00:00:00.000Z') as any;
    mocks.ensurePortableManagedResource = (async () => undefined) as any;
    mocks.deletePortableManagedResource = (async () => undefined) as any;
    mocks.resolvePortableResourceReferenceId = (async () => 'portable-resource-ref') as any;
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

    assertSpyCalls(mocks.deleteResource, 0);
    assertSpyCallArgs(mocks.deletePortableManagedResource, 0, [{
      id: 'remote-id',
      provider_name: 'k8s',
      provider_resource_name: 'portable-db',
    }, 'sql']);
})