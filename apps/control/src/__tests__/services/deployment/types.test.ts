import { describe, it, expect } from 'vitest';
import type {
  DeployState,
  DeploymentStatus,
  RoutingStatus,
  DeploymentProviderName,
  Deployment,
  DeploymentEvent,
  CreateDeploymentInput,
  RollbackInput,
  DeploymentTarget,
  DeploymentTargetEndpoint,
  DeploymentTargetArtifact,
} from '@/services/deployment/types';

describe('deployment types', () => {
  it('DeployState has all expected values', () => {
    const states: DeployState[] = [
      'pending',
      'uploading_bundle',
      'creating_resources',
      'deploying_worker',
      'setting_bindings',
      'routing',
      'completed',
      'failed',
      'rolled_back',
    ];
    expect(states).toHaveLength(9);
  });

  it('DeploymentStatus has all expected values', () => {
    const statuses: DeploymentStatus[] = [
      'pending',
      'in_progress',
      'success',
      'failed',
      'rolled_back',
    ];
    expect(statuses).toHaveLength(5);
  });

  it('RoutingStatus has all expected values', () => {
    const statuses: RoutingStatus[] = ['active', 'canary', 'rollback', 'archived'];
    expect(statuses).toHaveLength(4);
  });

  it('DeploymentProviderName has all expected values', () => {
    const providers: DeploymentProviderName[] = ['cloudflare', 'oci'];
    expect(providers).toHaveLength(2);
  });

  it('Deployment interface has required fields', () => {
    const deployment: Deployment = {
      id: 'dep-1',
      service_id: 'w-1',
      worker_id: 'w-1',
      space_id: 'space-1',
      version: 1,
      artifact_ref: 'worker-w-1-v1',
      bundle_r2_key: 'deployments/w-1/1/bundle.js',
      bundle_hash: 'abc123',
      bundle_size: 1000,
      wasm_r2_key: null,
      wasm_hash: null,
      assets_manifest: null,
      runtime_config_snapshot_json: '{}',
      bindings_snapshot_encrypted: null,
      env_vars_snapshot_encrypted: null,
      deploy_state: 'pending',
      current_step: null,
      step_error: null,
      status: 'pending',
      routing_status: 'active',
      routing_weight: 100,
      deployed_by: 'user-1',
      deploy_message: 'Initial deployment',
      provider_name: 'cloudflare',
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

    expect(deployment.id).toBe('dep-1');
    expect(deployment.service_id).toBe('w-1');
    expect(deployment.version).toBe(1);
    expect(deployment.routing_weight).toBe(100);
  });

  it('CreateDeploymentInput has required and optional fields', () => {
    const input: CreateDeploymentInput = {
      workerId: 'w-1',
      spaceId: 'space-1',
      bundleContent: 'export default { fetch() { return new Response("Hello") } }',
    };

    expect(input.workerId).toBe('w-1');
    expect(input.strategy).toBeUndefined();
    expect(input.canaryWeight).toBeUndefined();
  });

  it('CreateDeploymentInput supports canary strategy', () => {
    const input: CreateDeploymentInput = {
      workerId: 'w-1',
      spaceId: 'space-1',
      bundleContent: 'code',
      strategy: 'canary',
      canaryWeight: 10,
    };

    expect(input.strategy).toBe('canary');
    expect(input.canaryWeight).toBe(10);
  });

  it('RollbackInput has required fields', () => {
    const input: RollbackInput = {
      workerId: 'w-1',
      userId: 'user-1',
    };

    expect(input.workerId).toBe('w-1');
    expect(input.targetVersion).toBeUndefined();
  });

  it('DeploymentTarget supports service-ref endpoints', () => {
    const target: DeploymentTarget = {
      route_ref: 'my-worker',
      endpoint: {
        kind: 'service-ref',
        ref: 'my-service',
      },
    };

    expect(target.endpoint?.kind).toBe('service-ref');
  });

  it('DeploymentTarget supports http-url endpoints', () => {
    const target: DeploymentTarget = {
      endpoint: {
        kind: 'http-url',
        base_url: 'https://example.com',
      },
    };

    expect(target.endpoint?.kind).toBe('http-url');
  });

  it('DeploymentTargetArtifact has optional fields', () => {
    const artifact: DeploymentTargetArtifact = {
      image_ref: 'docker.io/my-image:latest',
      exposed_port: 8080,
    };

    expect(artifact.image_ref).toBe('docker.io/my-image:latest');
    expect(artifact.exposed_port).toBe(8080);
  });
});
