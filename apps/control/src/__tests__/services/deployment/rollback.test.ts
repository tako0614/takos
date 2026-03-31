import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  logDeploymentEvent: vi.fn(),
  deleteHostnameRouting: vi.fn(),
  restoreRoutingSnapshot: vi.fn(),
}));

vi.mock('@/services/deployment/store', () => ({
  logDeploymentEvent: mocks.logDeploymentEvent,
}));

vi.mock('@/services/routing/service', () => ({
  deleteHostnameRouting: mocks.deleteHostnameRouting,
}));

vi.mock('@/services/deployment/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/deployment/routing')>()),
  restoreRoutingSnapshot: mocks.restoreRoutingSnapshot,
}));

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

describe('rollbackDeploymentSteps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.logDeploymentEvent.mockResolvedValue(undefined);
    mocks.deleteHostnameRouting.mockResolvedValue(undefined);
    mocks.restoreRoutingSnapshot.mockResolvedValue(undefined);
  });

  it('restores routing snapshot when update_routing was completed', async () => {
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
        deploy: vi.fn(),
        assertRollbackTarget: vi.fn(),
      },
    });

    expect(mocks.restoreRoutingSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      snapshot
    );
    expect(mocks.logDeploymentEvent).toHaveBeenCalledWith(
      expect.anything(),
      'dep-1',
      'rollback_step',
      'update_routing',
      expect.any(String)
    );
  });

  it('falls back to deleteHostnameRouting when no snapshot available', async () => {
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
        deploy: vi.fn(),
        assertRollbackTarget: vi.fn(),
      },
    });

    expect(mocks.deleteHostnameRouting).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: 'test.example.com' })
    );
  });

  it('calls cleanupDeploymentArtifact when deploy_worker was completed', async () => {
    const cleanupMock = vi.fn().mockResolvedValue(undefined);

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
        deploy: vi.fn(),
        assertRollbackTarget: vi.fn(),
        cleanupDeploymentArtifact: cleanupMock,
      },
    });

    expect(cleanupMock).toHaveBeenCalledWith('worker-w-1-v1');
  });

  it('deletes bundle from R2 when available', async () => {
    const deleteMock = vi.fn().mockResolvedValue(undefined);

    await rollbackDeploymentSteps({
      env: {
        DB: {} as any,
        HOSTNAME_ROUTING: {} as any,
        WORKER_BUNDLES: { get: vi.fn(), put: vi.fn(), delete: deleteMock } as any,
      },
      deploymentId: 'dep-1',
      deployment: createBaseDeployment(),
      completedStepNames: [],
      routingRollbackSnapshot: null,
      workerHostname: null,
      deploymentArtifactRef: null,
      provider: {
        name: 'workers-dispatch',
        deploy: vi.fn(),
        assertRollbackTarget: vi.fn(),
      },
    });

    expect(deleteMock).toHaveBeenCalledWith('deployments/w-1/1/bundle.js');
  });

  it('deletes wasm from R2 when available', async () => {
    const deleteMock = vi.fn().mockResolvedValue(undefined);
    const dep = createBaseDeployment();
    dep.wasm_r2_key = 'deployments/w-1/1/module.wasm';

    await rollbackDeploymentSteps({
      env: {
        DB: {} as any,
        HOSTNAME_ROUTING: {} as any,
        WORKER_BUNDLES: { get: vi.fn(), put: vi.fn(), delete: deleteMock } as any,
      },
      deploymentId: 'dep-1',
      deployment: dep,
      completedStepNames: [],
      routingRollbackSnapshot: null,
      workerHostname: null,
      deploymentArtifactRef: null,
      provider: {
        name: 'workers-dispatch',
        deploy: vi.fn(),
        assertRollbackTarget: vi.fn(),
      },
    });

    expect(deleteMock).toHaveBeenCalledWith('deployments/w-1/1/module.wasm');
  });

  it('does nothing when no steps were completed', async () => {
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
        deploy: vi.fn(),
        assertRollbackTarget: vi.fn(),
      },
    });

    expect(mocks.restoreRoutingSnapshot).not.toHaveBeenCalled();
    expect(mocks.deleteHostnameRouting).not.toHaveBeenCalled();
  });

  it('handles routing restore failure gracefully', async () => {
    mocks.restoreRoutingSnapshot.mockRejectedValue(new Error('routing restore failed'));

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
        deploy: vi.fn(),
        assertRollbackTarget: vi.fn(),
      },
    });

    expect(mocks.logDeploymentEvent).toHaveBeenCalledWith(
      expect.anything(),
      'dep-1',
      'rollback_failed',
      'update_routing',
      expect.stringContaining('routing restore failed')
    );
  });
});
