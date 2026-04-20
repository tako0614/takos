import type {
  CreateDeploymentInput,
  Deployment,
  DeploymentBackendName,
  DeploymentStatus,
  DeploymentTarget,
  DeploymentTargetArtifact,
  DeployState,
  RollbackInput,
  RoutingStatus,
} from "@/services/deployment/types";

import { assertEquals } from "jsr:@std/assert";

Deno.test("deployment types - DeployState has all expected values", () => {
  const states: DeployState[] = [
    "pending",
    "uploading_bundle",
    "creating_resources",
    "deploying_worker",
    "setting_bindings",
    "routing",
    "completed",
    "failed",
    "rolled_back",
  ];
  assertEquals(states.length, 9);
});
Deno.test("deployment types - DeploymentStatus has all expected values", () => {
  const statuses: DeploymentStatus[] = [
    "pending",
    "in_progress",
    "success",
    "failed",
    "rolled_back",
  ];
  assertEquals(statuses.length, 5);
});
Deno.test("deployment types - RoutingStatus has all expected values", () => {
  const statuses: RoutingStatus[] = [
    "active",
    "canary",
    "rollback",
    "archived",
  ];
  assertEquals(statuses.length, 4);
});
Deno.test("deployment types - DeploymentBackendName has all expected values", () => {
  const backends: DeploymentBackendName[] = ["workers-dispatch", "oci"];
  assertEquals(backends.length, 2);
});
Deno.test("deployment types - Deployment interface has required fields", () => {
  const deployment: Deployment = {
    id: "dep-1",
    service_id: "w-1",
    worker_id: "w-1",
    space_id: "space-1",
    version: 1,
    artifact_ref: "worker-w-1-v1",
    artifact_kind: "worker-bundle",
    bundle_r2_key: "deployments/w-1/1/bundle.js",
    bundle_hash: "abc123",
    bundle_size: 1000,
    wasm_r2_key: null,
    wasm_hash: null,
    assets_manifest: null,
    runtime_config_snapshot_json: "{}",
    bindings_snapshot_encrypted: null,
    env_vars_snapshot_encrypted: null,
    deploy_state: "pending",
    current_step: null,
    step_error: null,
    status: "pending",
    routing_status: "active",
    routing_weight: 100,
    deployed_by: "user-1",
    deploy_message: "Initial deployment",
    backend_name: "workers-dispatch",
    target_json: "{}",
    backend_state_json: "{}",
    idempotency_key: null,
    is_rollback: false,
    rollback_from_version: null,
    rolled_back_at: null,
    rolled_back_by: null,
    started_at: "2026-01-01T00:00:00.000Z",
    completed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };

  assertEquals(deployment.id, "dep-1");
  assertEquals(deployment.service_id, "w-1");
  assertEquals(deployment.version, 1);
  assertEquals(deployment.routing_weight, 100);
});
Deno.test("deployment types - CreateDeploymentInput has required and optional fields", () => {
  const input: CreateDeploymentInput = {
    workerId: "w-1",
    spaceId: "space-1",
    bundleContent:
      'export default { fetch() { return new Response("Hello") } }',
  };

  assertEquals(input.workerId, "w-1");
  assertEquals(input.strategy, undefined);
  assertEquals(input.canaryWeight, undefined);
});
Deno.test("deployment types - CreateDeploymentInput supports canary strategy", () => {
  const input: CreateDeploymentInput = {
    workerId: "w-1",
    spaceId: "space-1",
    bundleContent: "code",
    strategy: "canary",
    canaryWeight: 10,
  };

  assertEquals(input.strategy, "canary");
  assertEquals(input.canaryWeight, 10);
});
Deno.test("deployment types - RollbackInput has required fields", () => {
  const input: RollbackInput = {
    workerId: "w-1",
    userId: "user-1",
  };

  assertEquals(input.workerId, "w-1");
  assertEquals(input.targetVersion, undefined);
});
Deno.test("deployment types - DeploymentTarget supports service-ref endpoints", () => {
  const target: DeploymentTarget = {
    route_ref: "my-worker",
    endpoint: {
      kind: "service-ref",
      ref: "my-service",
    },
  };

  assertEquals(target.endpoint?.kind, "service-ref");
});
Deno.test("deployment types - DeploymentTarget supports http-url endpoints", () => {
  const target: DeploymentTarget = {
    endpoint: {
      kind: "http-url",
      base_url: "https://example.com",
    },
  };

  assertEquals(target.endpoint?.kind, "http-url");
});
Deno.test("deployment types - DeploymentTargetArtifact has optional fields", () => {
  const artifact: DeploymentTargetArtifact = {
    image_ref: "docker.io/my-image:latest",
    exposed_port: 8080,
  };

  assertEquals(artifact.image_ref, "docker.io/my-image:latest");
  assertEquals(artifact.exposed_port, 8080);
});
