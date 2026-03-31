import type { Env } from '@/types';

import { assertEquals, assertNotEquals, assert } from 'jsr:@std/assert';
import { assertSpyCalls } from 'jsr:@std/testing/mock';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  generateId: (() => 'infra-new'),
  now: (() => '2026-03-24T00:00:00.000Z'),
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils'
import { InfraService } from '@/services/platform/infra';

function createDrizzleMock() {
  const getMock = ((..._args: any[]) => undefined) as any;
  const allMock = ((..._args: any[]) => undefined) as any;
  const runMock = ((..._args: any[]) => undefined) as any;
  const chain = {
    from: (function(this: any) { return this; }),
    where: (function(this: any) { return this; }),
    set: (function(this: any) { return this; }),
    values: (function(this: any) { return this; }),
    orderBy: (function(this: any) { return this; }),
    get: getMock,
    all: allMock,
    run: runMock,
  };
  return {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    _: { get: getMock, all: allMock, run: runMock },
  };
}

function makeEnv(): Env {
  return { DB: {} } as unknown as Env;
}


  Deno.test('InfraService.upsertWorker - creates a new infra worker when none exists', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => undefined) as any; // no existing
    mocks.getDb = (() => drizzle) as any;

    const service = new InfraService(makeEnv());
    const id = await service.upsertWorker({
      spaceId: 'ws-1',
      bundleDeploymentId: 'bd-1',
      name: 'api-worker',
      runtime: 'cloudflare.worker',
      cloudflareServiceRef: 'cf-api',
    });

    assertEquals(id, 'infra-new');
    assert(drizzle.insert.calls.length > 0);
})
  Deno.test('InfraService.upsertWorker - updates existing infra worker', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => ({ id: 'existing-id' })) as any; // existing found
    mocks.getDb = (() => drizzle) as any;

    const service = new InfraService(makeEnv());
    const id = await service.upsertWorker({
      spaceId: 'ws-1',
      bundleDeploymentId: 'bd-1',
      name: 'api-worker',
      runtime: 'cloudflare.worker',
    });

    assertEquals(id, 'existing-id');
    assert(drizzle.update.calls.length > 0);
})

  Deno.test('InfraService.upsertEndpoint - creates a new endpoint with routes', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => undefined) as any; // no existing
    mocks.getDb = (() => drizzle) as any;

    const service = new InfraService(makeEnv());
    const id = await service.upsertEndpoint({
      spaceId: 'ws-1',
      bundleDeploymentId: 'bd-1',
      name: 'api',
      protocol: 'http',
      targetServiceRef: 'api-worker',
      routes: [{ pathPrefix: '/api' }],
    });

    assertEquals(id, 'infra-new');
    assertSpyCalls(drizzle.insert, 2); // endpoint + route
})
  Deno.test('InfraService.upsertEndpoint - replaces routes when updating existing endpoint', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => ({ id: 'ep-1' })) as any; // existing found
    mocks.getDb = (() => drizzle) as any;

    const service = new InfraService(makeEnv());
    const id = await service.upsertEndpoint({
      spaceId: 'ws-1',
      bundleDeploymentId: 'bd-1',
      name: 'api',
      protocol: 'http',
      targetServiceRef: 'api-worker',
      routes: [{ pathPrefix: '/v2' }, { pathPrefix: '/health', methods: ['GET'] }],
    });

    assertEquals(id, 'ep-1');
    assert(drizzle.delete.calls.length > 0); // delete old routes
    assert(drizzle.update.calls.length > 0);
})

  Deno.test('InfraService.buildRoutingTarget - returns null when no endpoints exist', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => []) as any; // no endpoints
    mocks.getDb = (() => drizzle) as any;

    const service = new InfraService(makeEnv());
    const target = await service.buildRoutingTarget('ws-1', 'bd-1');
    assertEquals(target, null);
})
  Deno.test('InfraService.buildRoutingTarget - builds routing target from endpoints and workers', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all
       = (async () => [
        { id: 'ep-1', accountId: 'ws-1', name: 'api', protocol: 'http', targetServiceRef: 'api-worker', timeoutMs: 30000, bundleDeploymentId: 'bd-1' },
      ]) as any // endpoints
       = (async () => [
        { endpointId: 'ep-1', position: 0, pathPrefix: '/api', methodsJson: null },
      ]) as any // routes
       = (async () => [
        { name: 'api-worker', cloudflareServiceRef: 'cf-api', runtime: 'cloudflare.worker' },
      ]) as any; // workers
    mocks.getDb = (() => drizzle) as any;

    const service = new InfraService(makeEnv());
    const target = await service.buildRoutingTarget('ws-1', 'bd-1');

    assertNotEquals(target, null);
    assertEquals(target!.type, 'http-endpoint-set');
    if (target?.type !== 'http-endpoint-set') {
      throw new Error('expected http-endpoint-set target');
    }
    assertEquals(target.endpoints.length, 1);
    if (target.endpoints[0].target.kind !== 'service-ref') {
      throw new Error('expected service-ref target');
    }
    assertEquals(target.endpoints[0].target.ref, 'cf-api');
})
  Deno.test('InfraService.buildRoutingTarget - skips non-cloudflare.worker endpoints', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all
       = (async () => [
        { id: 'ep-1', accountId: 'ws-1', name: 'api', protocol: 'http', targetServiceRef: 'ext-worker', timeoutMs: null, bundleDeploymentId: 'bd-1' },
      ]) as any
       = (async () => []) as any
       = (async () => [
        { name: 'ext-worker', cloudflareServiceRef: null, runtime: 'docker' },
      ]) as any;
    mocks.getDb = (() => drizzle) as any;

    const service = new InfraService(makeEnv());
    const target = await service.buildRoutingTarget('ws-1', 'bd-1');
    assertEquals(target, null);
})

  Deno.test('InfraService.deleteByBundleDeployment - deletes endpoints, routes, and workers', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => [{ id: 'ep-1' }, { id: 'ep-2' }]) as any; // endpoints to delete
    mocks.getDb = (() => drizzle) as any;

    const service = new InfraService(makeEnv());
    await service.deleteByBundleDeployment('ws-1', 'bd-1');

    // routes for ep-1, routes for ep-2, endpoints, workers
    assertSpyCalls(drizzle.delete, 4);
})