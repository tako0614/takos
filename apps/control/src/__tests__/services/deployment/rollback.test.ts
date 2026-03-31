import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  logDeploymentEvent: ((..._args: any[]) => undefined) as any,
  deleteHostnameRouting: ((..._args: any[]) => undefined) as any,
  restoreRoutingSnapshot: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/services/deployment/store'
// [Deno] vi.mock removed - manually stub imports from '@/services/routing/service'
// [Deno] vi.mock removed - manually stub imports from '@/services/deployment/routing'
import { rollbackDeploymentSteps } from '@/services/deployment/rollback';
import type { Deployment } from '@/services/deployment/types';

function createBaseDeployment(): Deployment {
  return {
    id: 'dep-1',
    service_id: 'w-1',
    worker_id: 'w-1',
    space_id: 'space-1',
    version: 1,
    artifact_ref: 'worker-w-1-v1',
    artifact_kind: 'worker-bundle',
    bundle_r2_key: 'deployments/w-1/1/bundle.js',
    bundle_hash: null,
    bundle_size: null,
    wasm_r2_key: null,
    wasm_hash: null,
    assets_manifest: null,
    runtime_config_snapshot_json: '{}',
    bindings_snapshot_encrypted: null,
    env_vars_snapshot_encrypted: null,
    deploy_state: 'failed',
    current_step: 'deploy_worker',
    step_error: 'deploy failed',
    status: 'failed',
    routing_status: 'active',
    routing_weight: 100,
    deployed_by: 'user-1',
    deploy_message: null,
    provider_name: 'workers-dispatch',
    target_json: '{}',
    provider_state_json: '{}',
    idempotency_key: null,
    is_rollback: false,
    rollback_from_version: null,
    rolled_back_at: null,
    rolled_back_by: null,
    started_at: '2026-01-01T00:00:00.000Z',
    completed_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}


  Deno.test('rollbackDeploymentSteps - restores routing snapshot when update_routing was completed', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.logDeploymentEvent = (async () => undefined) as any;
    mocks.deleteHostnameRouting = (async () => undefined) as any;
    mocks.restoreRoutingSnapshot = (async () => undefined) as any;
  const snapshot = [
      { hostname: 'test.example.com', target: { type: 'deployments' as const, deployments: [] } },
    ];

    await rollbackDeploymentSteps({
      env: { DB: {} as any, HOSTNAME_ROUTING: {} as any },
      deploymentId: 'dep-1',
      deployment: createBaseDeployment(),
      completedStepNames: ['update_routing'],
      routingRollbackSnapshot: snapshot,
      workerHostname: 'test.example.com',
      deploymentArtifactRef: 'worker-w-1-v1',
      provider: {
        name: 'workers-dispatch',
        deploy: ((..._args: any[]) => undefined) as any,
        assertRollbackTarget: ((..._args: any[]) => undefined) as any,
      },
    });

    assertSpyCallArgs(mocks.restoreRoutingSnapshot, 0, [
      expect.anything(),
      snapshot
    ]);
    assertSpyCallArgs(mocks.logDeploymentEvent, 0, [
      expect.anything(),
      'dep-1',
      'rollback_step',
      'update_routing',
      /* expect.any(String) */ {} as any
    ]);
})
  Deno.test('rollbackDeploymentSteps - falls back to deleteHostnameRouting when no snapshot available', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.logDeploymentEvent = (async () => undefined) as any;
    mocks.deleteHostnameRouting = (async () => undefined) as any;
    mocks.restoreRoutingSnapshot = (async () => undefined) as any;
  await rollbackDeploymentSteps({
      env: { DB: {} as any, HOSTNAME_ROUTING: {} as any },
      deploymentId: 'dep-1',
      deployment: createBaseDeployment(),
      completedStepNames: ['update_routing'],
      routingRollbackSnapshot: null,
      workerHostname: 'test.example.com',
      deploymentArtifactRef: null,
      provider: {
        name: 'workers-dispatch',
        deploy: ((..._args: any[]) => undefined) as any,
        assertRollbackTarget: ((..._args: any[]) => undefined) as any,
      },
    });

    assertSpyCallArgs(mocks.deleteHostnameRouting, 0, [
      ({ hostname: 'test.example.com' })
    ]);
})
  Deno.test('rollbackDeploymentSteps - calls cleanupDeploymentArtifact when deploy_worker was completed', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.logDeploymentEvent = (async () => undefined) as any;
    mocks.deleteHostnameRouting = (async () => undefined) as any;
    mocks.restoreRoutingSnapshot = (async () => undefined) as any;
  const cleanupMock = (async () => undefined);

    await rollbackDeploymentSteps({
      env: { DB: {} as any, HOSTNAME_ROUTING: {} as any },
      deploymentId: 'dep-1',
      deployment: createBaseDeployment(),
      completedStepNames: ['deploy_worker'],
      routingRollbackSnapshot: null,
      workerHostname: null,
      deploymentArtifactRef: 'worker-w-1-v1',
      provider: {
        name: 'workers-dispatch',
        deploy: ((..._args: any[]) => undefined) as any,
        assertRollbackTarget: ((..._args: any[]) => undefined) as any,
        cleanupDeploymentArtifact: cleanupMock,
      },
    });

    assertSpyCallArgs(cleanupMock, 0, ['worker-w-1-v1']);
})
  Deno.test('rollbackDeploymentSteps - deletes bundle from R2 when available', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.logDeploymentEvent = (async () => undefined) as any;
    mocks.deleteHostnameRouting = (async () => undefined) as any;
    mocks.restoreRoutingSnapshot = (async () => undefined) as any;
  const deleteMock = (async () => undefined);

    await rollbackDeploymentSteps({
      env: {
        DB: {} as any,
        HOSTNAME_ROUTING: {} as any,
        WORKER_BUNDLES: { get: ((..._args: any[]) => undefined) as any, put: ((..._args: any[]) => undefined) as any, delete: deleteMock } as any,
      },
      deploymentId: 'dep-1',
      deployment: createBaseDeployment(),
      completedStepNames: [],
      routingRollbackSnapshot: null,
      workerHostname: null,
      deploymentArtifactRef: null,
      provider: {
        name: 'workers-dispatch',
        deploy: ((..._args: any[]) => undefined) as any,
        assertRollbackTarget: ((..._args: any[]) => undefined) as any,
      },
    });

    assertSpyCallArgs(deleteMock, 0, ['deployments/w-1/1/bundle.js']);
})
  Deno.test('rollbackDeploymentSteps - deletes wasm from R2 when available', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.logDeploymentEvent = (async () => undefined) as any;
    mocks.deleteHostnameRouting = (async () => undefined) as any;
    mocks.restoreRoutingSnapshot = (async () => undefined) as any;
  const deleteMock = (async () => undefined);
    const dep = createBaseDeployment();
    dep.wasm_r2_key = 'deployments/w-1/1/module.wasm';

    await rollbackDeploymentSteps({
      env: {
        DB: {} as any,
        HOSTNAME_ROUTING: {} as any,
        WORKER_BUNDLES: { get: ((..._args: any[]) => undefined) as any, put: ((..._args: any[]) => undefined) as any, delete: deleteMock } as any,
      },
      deploymentId: 'dep-1',
      deployment: dep,
      completedStepNames: [],
      routingRollbackSnapshot: null,
      workerHostname: null,
      deploymentArtifactRef: null,
      provider: {
        name: 'workers-dispatch',
        deploy: ((..._args: any[]) => undefined) as any,
        assertRollbackTarget: ((..._args: any[]) => undefined) as any,
      },
    });

    assertSpyCallArgs(deleteMock, 0, ['deployments/w-1/1/module.wasm']);
})
  Deno.test('rollbackDeploymentSteps - does nothing when no steps were completed', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.logDeploymentEvent = (async () => undefined) as any;
    mocks.deleteHostnameRouting = (async () => undefined) as any;
    mocks.restoreRoutingSnapshot = (async () => undefined) as any;
  await rollbackDeploymentSteps({
      env: { DB: {} as any, HOSTNAME_ROUTING: {} as any },
      deploymentId: 'dep-1',
      deployment: { ...createBaseDeployment(), bundle_r2_key: null },
      completedStepNames: [],
      routingRollbackSnapshot: null,
      workerHostname: null,
      deploymentArtifactRef: null,
      provider: {
        name: 'workers-dispatch',
        deploy: ((..._args: any[]) => undefined) as any,
        assertRollbackTarget: ((..._args: any[]) => undefined) as any,
      },
    });

    assertSpyCalls(mocks.restoreRoutingSnapshot, 0);
    assertSpyCalls(mocks.deleteHostnameRouting, 0);
})
  Deno.test('rollbackDeploymentSteps - handles routing restore failure gracefully', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.logDeploymentEvent = (async () => undefined) as any;
    mocks.deleteHostnameRouting = (async () => undefined) as any;
    mocks.restoreRoutingSnapshot = (async () => undefined) as any;
  mocks.restoreRoutingSnapshot = (async () => { throw new Error('routing restore failed'); }) as any;

    // Should not throw
    await rollbackDeploymentSteps({
      env: { DB: {} as any, HOSTNAME_ROUTING: {} as any },
      deploymentId: 'dep-1',
      deployment: createBaseDeployment(),
      completedStepNames: ['update_routing'],
      routingRollbackSnapshot: [{ hostname: 'test.example.com', target: null }],
      workerHostname: null,
      deploymentArtifactRef: null,
      provider: {
        name: 'workers-dispatch',
        deploy: ((..._args: any[]) => undefined) as any,
        assertRollbackTarget: ((..._args: any[]) => undefined) as any,
      },
    });

    assertSpyCallArgs(mocks.logDeploymentEvent, 0, [
      expect.anything(),
      'dep-1',
      'rollback_failed',
      'update_routing',
      expect.stringContaining('routing restore failed')
    ]);
})