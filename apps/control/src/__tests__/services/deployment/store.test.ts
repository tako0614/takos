import { assertEquals } from 'jsr:@std/assert';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
import { toApiDeployment } from '@/services/deployment/store';
import type { DeploymentRow } from '@/services/deployment/store';

function createDrizzleMock() {
  const getMock = ((..._args: any[]) => undefined) as any;
  const allMock = ((..._args: any[]) => undefined) as any;
  const runMock = ((..._args: any[]) => undefined) as any;
  const chain = {
    from: (function(this: any) { return this; }),
    where: (function(this: any) { return this; }),
    set: (function(this: any) { return this; }),
    values: (function(this: any) { return this; }),
    returning: (function(this: any) { return this; }),
    orderBy: (function(this: any) { return this; }),
    limit: (function(this: any) { return this; }),
    get: getMock,
    all: allMock,
    run: runMock,
  };
  return {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    _: { get: getMock, all: allMock, run: runMock, chain },
  };
}


  Deno.test('toApiDeployment - maps deployment row to API deployment format', () => {
  const deploymentRow = {
      id: 'dep-1',
      serviceId: 'w-1',
      accountId: 'space-1',
      version: 3,
      artifactRef: 'worker-w-1-v3',
      bundleR2Key: 'deployments/w-1/3/bundle.js',
      bundleHash: 'sha256-abc',
      bundleSize: 5000,
      wasmR2Key: null,
      wasmHash: null,
      assetsManifest: null,
      runtimeConfigSnapshotJson: '{"compatibility_date":"2024-01-01"}',
      bindingsSnapshotEncrypted: null,
      envVarsSnapshotEncrypted: null,
      deployState: 'completed',
      currentStep: null,
      stepError: null,
      status: 'success',
      routingStatus: 'active',
      routingWeight: 100,
      deployedBy: 'user-1',
      deployMessage: 'Fix bug',
      providerName: 'workers-dispatch',
      targetJson: '{}',
      providerStateJson: '{}',
      idempotencyKey: 'idem-1',
      isRollback: false,
      rollbackFromVersion: null,
      rolledBackAt: null,
      rolledBackBy: null,
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:01:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:01:00.000Z',
    } as unknown as DeploymentRow;

    const result = toApiDeployment(deploymentRow);

    assertEquals(result.id, 'dep-1');
    assertEquals(result.service_id, 'w-1');
    assertEquals(result.worker_id, undefined);
    assertEquals(result.space_id, 'space-1');
    assertEquals(result.version, 3);
    assertEquals(result.artifact_ref, 'worker-w-1-v3');
    assertEquals(result.bundle_r2_key, 'deployments/w-1/3/bundle.js');
    assertEquals(result.bundle_hash, 'sha256-abc');
    assertEquals(result.bundle_size, 5000);
    assertEquals(result.status, 'success');
    assertEquals(result.routing_status, 'active');
    assertEquals(result.routing_weight, 100);
    assertEquals(result.deployed_by, 'user-1');
    assertEquals(result.deploy_message, 'Fix bug');
    assertEquals(result.provider_name, 'workers-dispatch');
    assertEquals(result.idempotency_key, 'idem-1');
    assertEquals(result.is_rollback, false);
})
  Deno.test('toApiDeployment - handles null dates', () => {
  const deploymentRow = {
      id: 'dep-1',
      serviceId: 'w-1',
      accountId: 'space-1',
      version: 1,
      artifactRef: null,
      bundleR2Key: null,
      bundleHash: null,
      bundleSize: null,
      wasmR2Key: null,
      wasmHash: null,
      assetsManifest: null,
      runtimeConfigSnapshotJson: '{}',
      bindingsSnapshotEncrypted: null,
      envVarsSnapshotEncrypted: null,
      deployState: 'pending',
      currentStep: null,
      stepError: null,
      status: 'pending',
      routingStatus: 'active',
      routingWeight: 100,
      deployedBy: null,
      deployMessage: null,
      providerName: 'workers-dispatch',
      targetJson: '{}',
      providerStateJson: '{}',
      idempotencyKey: null,
      isRollback: false,
      rollbackFromVersion: null,
      rolledBackAt: null,
      rolledBackBy: null,
      startedAt: null,
      completedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as unknown as DeploymentRow;

    const result = toApiDeployment(deploymentRow);

    assertEquals(result.service_id, 'w-1');
    assertEquals(result.rolled_back_at, null);
    assertEquals(result.completed_at, null);
    assertEquals(result.deployed_by, null);
})

  Deno.test('getDeploymentById - returns null when deployment not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => undefined) as any;
    mocks.getDb = (() => drizzle) as any;

    const { getDeploymentById } = await import('@/services/deployment/store');
    const result = await getDeploymentById({} as any, 'nonexistent');

    assertEquals(result, null);
})

  Deno.test('getDeploymentHistory - returns mapped deployments ordered by version desc', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => [
      {
        id: 'dep-2',
        serviceId: 'w-1',
        accountId: 'space-1',
        version: 2,
        artifactRef: 'worker-w-1-v2',
        bundleR2Key: null,
        bundleHash: null,
        bundleSize: null,
        wasmR2Key: null,
        wasmHash: null,
        assetsManifest: null,
        runtimeConfigSnapshotJson: '{}',
        bindingsSnapshotEncrypted: null,
        envVarsSnapshotEncrypted: null,
        deployState: 'completed',
        currentStep: null,
        stepError: null,
        status: 'success',
        routingStatus: 'active',
        routingWeight: 100,
        deployedBy: null,
        deployMessage: null,
        providerName: 'workers-dispatch',
        targetJson: '{}',
        providerStateJson: '{}',
        idempotencyKey: null,
        isRollback: false,
        rollbackFromVersion: null,
        rolledBackAt: null,
        rolledBackBy: null,
        startedAt: null,
        completedAt: null,
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    ]) as any;
    mocks.getDb = (() => drizzle) as any;

    const { getDeploymentHistory } = await import('@/services/deployment/store');
    const result = await getDeploymentHistory({} as any, 'w-1', 10);

    assertEquals(result.length, 1);
    assertEquals(result[0].id, 'dep-2');
    assertEquals(result[0].version, 2);
})

  Deno.test('getServiceDeploymentBasics - returns exists: false when worker not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => undefined) as any;
    mocks.getDb = (() => drizzle) as any;

    const { getServiceDeploymentBasics } = await import('@/services/deployment/store');
    const result = await getServiceDeploymentBasics({} as any, 'nonexistent');

    assertEquals(result.exists, false);
    assertEquals(result.id, 'nonexistent');
    assertEquals(result.hostname, null);
    assertEquals(result.activeDeploymentId, null);
})
  Deno.test('getServiceDeploymentBasics - returns worker info when found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => ({
      id: 'w-1',
      hostname: 'test.example.com',
      activeDeploymentId: 'dep-1',
    })) as any;
    mocks.getDb = (() => drizzle) as any;

    const { getServiceDeploymentBasics } = await import('@/services/deployment/store');
    const result = await getServiceDeploymentBasics({} as any, 'w-1');

    assertEquals(result.exists, true);
    assertEquals(result.hostname, 'test.example.com');
    assertEquals(result.activeDeploymentId, 'dep-1');
})