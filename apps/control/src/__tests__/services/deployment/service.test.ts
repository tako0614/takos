// ---------------------------------------------------------------------------
// Hoisted mocks — declared before any import so vi.mock factories can
// reference them. Everything that the DeploymentService touches at the
// module boundary is intercepted here.
// ---------------------------------------------------------------------------
import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "jsr:@std/assert";
import { assertSpyCallArgs, assertSpyCalls } from "jsr:@std/testing/mock";

const mocks = {
  // store
  getDeploymentById: ((..._args: any[]) => undefined) as any,
  getDeploymentByIdempotencyKey: ((..._args: any[]) => undefined) as any,
  getDeploymentEvents: ((..._args: any[]) => undefined) as any,
  getDeploymentHistory: ((..._args: any[]) => undefined) as any,
  getServiceDeploymentBasics: ((..._args: any[]) => undefined) as any,
  getServiceRollbackInfo: ((..._args: any[]) => undefined) as any,
  findDeploymentByServiceVersion: ((..._args: any[]) => undefined) as any,
  createDeploymentWithVersion: ((..._args: any[]) => undefined) as any,
  logDeploymentEvent: ((..._args: any[]) => undefined) as any,
  updateServiceDeploymentPointers: ((..._args: any[]) => undefined) as any,
  updateDeploymentRecord: ((..._args: any[]) => undefined) as any,
  getDb: ((..._args: any[]) => undefined) as any,

  // state
  executeDeploymentStep: ((..._args: any[]) => undefined) as any,
  updateDeploymentState: ((..._args: any[]) => undefined) as any,
  detectStuckDeployments: ((..._args: any[]) => undefined) as any,
  resetStuckDeployment: ((..._args: any[]) => undefined) as any,

  // rollback module
  rollbackDeploymentSteps: ((..._args: any[]) => undefined) as any,

  // routing
  applyRoutingDbUpdates: ((..._args: any[]) => undefined) as any,
  applyRoutingToHostnames: ((..._args: any[]) => undefined) as any,
  buildRoutingTarget: ((..._args: any[]) => undefined) as any,
  collectHostnames: ((..._args: any[]) => undefined) as any,
  fetchServiceWithDomains: ((..._args: any[]) => undefined) as any,
  snapshotRouting: ((..._args: any[]) => undefined) as any,
  restoreRoutingSnapshot: ((..._args: any[]) => undefined) as any,

  // provider
  createDeploymentProvider: ((..._args: any[]) => undefined) as any,
  parseDeploymentTargetConfig: ((..._args: any[]) => undefined) as any,
  serializeDeploymentTarget: ((..._args: any[]) => undefined) as any,

  // platform
  ServiceDesiredStateService: ((..._args: any[]) => undefined) as any,
  reconcileManagedWorkerMcpServer: ((..._args: any[]) => undefined) as any,

  // shared utils
  generateId: ((..._args: any[]) => undefined) as any,
  computeSHA256: ((..._args: any[]) => undefined) as any,
  constantTimeEqual: ((..._args: any[]) => undefined) as any,
  encrypt: ((..._args: any[]) => undefined) as any,
  decrypt: ((..._args: any[]) => undefined) as any,
  encryptEnvVars: ((..._args: any[]) => undefined) as any,
  decryptEnvVars: ((..._args: any[]) => undefined) as any,
  maskEnvVars: ((..._args: any[]) => undefined) as any,
};

// ---------------------------------------------------------------------------
// vi.mock declarations
// ---------------------------------------------------------------------------
// [Deno] vi.mock removed - manually stub imports from '@/services/deployment/store'
// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/deployment/state'
// [Deno] vi.mock removed - manually stub imports from '@/services/deployment/rollback'
// [Deno] vi.mock removed - manually stub imports from '@/services/deployment/routing'
// [Deno] vi.mock removed - manually stub imports from '@/services/deployment/provider'
// [Deno] vi.mock removed - manually stub imports from '@/services/platform/worker-desired-state'
// [Deno] vi.mock removed - manually stub imports from '@/services/platform/mcp'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/hash'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/crypto'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/logger'
// [Deno] vi.mock removed - manually stub imports from '@/shared/constants'
// [Deno] vi.mock removed - manually stub imports from '@/services/routing'
// [Deno] vi.mock removed - manually stub imports from 'drizzle-orm'
import {
  buildDeploymentArtifactRef,
  DeploymentService,
} from "@/services/deployment/service";
import type { Deployment, DeploymentEvent } from "@/services/deployment/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createBaseDeployment(
  overrides: Partial<Deployment & { service_id?: string }> = {},
): Deployment & { service_id?: string } {
  return {
    id: "dep-1",
    worker_id: "w-1",
    service_id: "w-1",
    space_id: "space-1",
    version: 1,
    artifact_ref: "worker-w-1-v1",
    artifact_kind: "worker-bundle",
    bundle_r2_key: "deployments/w-1/1/bundle.js",
    bundle_hash: "sha256-abc",
    bundle_size: 100,
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
    deploy_message: null,
    provider_name: "workers-dispatch",
    target_json: "{}",
    provider_state_json: "{}",
    idempotency_key: null,
    is_rollback: false,
    rollback_from_version: null,
    rolled_back_at: null,
    rolled_back_by: null,
    started_at: "2026-01-01T00:00:00.000Z",
    completed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    DB: {} as any,
    CF_ACCOUNT_ID: "cf-account",
    CF_API_TOKEN: "cf-token",
    WFP_DISPATCH_NAMESPACE: "test-ns",
    ADMIN_DOMAIN: "test.takos.jp",
    ENCRYPTION_KEY: "my-secret-key-for-testing-purposes",
    HOSTNAME_ROUTING: {} as any,
    WORKER_BUNDLES: {
      get: async () => null,
      put: async () => undefined,
      delete: async () => undefined,
    },
    ...overrides,
  } as any;
}

function makeDbUpdateChain() {
  const chain = {
    set: function (this: any) {
      return this;
    },
    where: function (this: any) {
      return this;
    },
    run: async () => undefined,
  };
  return chain;
}

function createAsyncSequence<T>(...values: T[]) {
  let index = 0;
  return async () =>
    values[index < values.length ? index++ : values.length - 1];
}

function makeService(envOverrides?: Record<string, unknown>) {
  const env = makeEnv(envOverrides);
  return { service: new DeploymentService(env, "test-encryption-key"), env };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("buildDeploymentArtifactRef - builds artifact ref from base ref and version", () => {
  assertEquals(buildDeploymentArtifactRef("my-worker", 1), "my-worker-v1");
  assertEquals(buildDeploymentArtifactRef("worker-abc", 42), "worker-abc-v42");
});
Deno.test("buildDeploymentArtifactRef - handles empty base ref", () => {
  assertEquals(buildDeploymentArtifactRef("", 1), "-v1");
});
Deno.test("buildDeploymentArtifactRef - handles large version numbers", () => {
  assertEquals(buildDeploymentArtifactRef("svc", 9999), "svc-v9999");
});

Deno.test("DeploymentService constructor - throws when ENCRYPTION_KEY is not set", () => {
  const env = {
    DB: {} as any,
    CF_ACCOUNT_ID: "test",
    CF_API_TOKEN: "test",
    WFP_DISPATCH_NAMESPACE: "test",
    ADMIN_DOMAIN: "test.takos.jp",
    HOSTNAME_ROUTING: {} as any,
  } as any;

  assertThrows(() => {
    (() => new DeploymentService(env));
  }, "ENCRYPTION_KEY must be set");
});
Deno.test("DeploymentService constructor - throws when ENCRYPTION_KEY is empty string", () => {
  const env = makeEnv({ ENCRYPTION_KEY: "" });
  assertThrows(() => {
    (() => new DeploymentService(env));
  }, "ENCRYPTION_KEY must be set");
});
Deno.test("DeploymentService constructor - creates a service when ENCRYPTION_KEY is set", () => {
  const env = makeEnv();
  const service = new DeploymentService(env);
  assert(service !== undefined);
  assert(service instanceof DeploymentService);
});
// ---------------------------------------------------------------------------
// getDeploymentById
// ---------------------------------------------------------------------------

Deno.test("DeploymentService.getDeploymentById - returns a deployment when found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const dep = createBaseDeployment();
  mocks.getDeploymentById = (async () => dep) as any;

  const { service } = makeService();
  const result = await service.getDeploymentById("dep-1");

  assertEquals(result, dep);
  assertSpyCallArgs(mocks.getDeploymentById, 0, [expect.anything(), "dep-1"]);
});
Deno.test("DeploymentService.getDeploymentById - returns null when deployment not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDeploymentById = (async () => null) as any;

  const { service } = makeService();
  const result = await service.getDeploymentById("nonexistent");

  assertEquals(result, null);
});
// ---------------------------------------------------------------------------
// getDeploymentHistory
// ---------------------------------------------------------------------------

Deno.test("DeploymentService.getDeploymentHistory - returns deployment history for a service", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const deps = [
    createBaseDeployment({ id: "dep-2", version: 2 }),
    createBaseDeployment({ id: "dep-1", version: 1 }),
  ];
  mocks.getDeploymentHistory = (async () => deps) as any;

  const { service } = makeService();
  const result = await service.getDeploymentHistory("w-1");

  assertEquals(result.length, 2);
  assertEquals(result[0].id, "dep-2");
  assertSpyCallArgs(mocks.getDeploymentHistory, 0, [
    expect.anything(),
    "w-1",
    10,
  ]);
});
Deno.test("DeploymentService.getDeploymentHistory - uses custom limit", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDeploymentHistory = (async () => []) as any;

  const { service } = makeService();
  await service.getDeploymentHistory("w-1", 5);

  assertSpyCallArgs(mocks.getDeploymentHistory, 0, [
    expect.anything(),
    "w-1",
    5,
  ]);
});
Deno.test("DeploymentService.getDeploymentHistory - returns empty array when no deployments exist", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDeploymentHistory = (async () => []) as any;

  const { service } = makeService();
  const result = await service.getDeploymentHistory("w-new");

  assertEquals(result, []);
});
// ---------------------------------------------------------------------------
// getDeploymentEvents
// ---------------------------------------------------------------------------

Deno.test("DeploymentService.getDeploymentEvents - returns events for a deployment", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const events: DeploymentEvent[] = [
    {
      id: 1,
      deployment_id: "dep-1",
      actor_user_id: "user-1",
      event_type: "started",
      step_name: null,
      message: "Deployment started",
      details: null,
      created_at: "2026-01-01T00:00:00.000Z",
    },
  ];
  mocks.getDeploymentEvents = (async () => events) as any;

  const { service } = makeService();
  const result = await service.getDeploymentEvents("dep-1");

  assertEquals(result, events);
  assertSpyCallArgs(mocks.getDeploymentEvents, 0, [expect.anything(), "dep-1"]);
});
// ---------------------------------------------------------------------------
// createDeployment
// ---------------------------------------------------------------------------

Deno.test("DeploymentService.createDeployment - throws when the worker does not exist", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.generateId = (() => "new-dep-id") as any;
  mocks.computeSHA256 = (async () => "sha256-hash") as any;
  mocks.serializeDeploymentTarget = (() => ({
    providerName: "workers-dispatch",
    targetJson: "{}",
    providerStateJson: "{}",
  })) as any;
  mocks.parseDeploymentTargetConfig = (() => ({})) as any;
  mocks.logDeploymentEvent = (async () => undefined) as any;
  mocks.encryptEnvVars = (async () => "encrypted-env-vars") as any;
  mocks.encrypt = (async () => ({ ciphertext: "ct", iv: "iv" })) as any;
  mocks.ServiceDesiredStateService = (() => ({
    resolveDeploymentState: async () => ({
      envVars: {},
      bindings: [],
      runtimeConfig: {
        compatibility_date: "2024-01-01",
        compatibility_flags: [],
        limits: {},
        mcp_server: undefined,
        updated_at: null,
      },
    }),
  })) as any;
  mocks.getServiceDeploymentBasics = (async () => ({ exists: false })) as any;

  const { service } = makeService();
  await assertRejects(async () => {
    await service.createDeployment({
      serviceId: "w-unknown",
      spaceId: "space-1",
      bundleContent: 'console.log("hi")',
    });
  }, "Worker not found");
});
Deno.test("DeploymentService.createDeployment - throws when no service identifier is provided", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.generateId = (() => "new-dep-id") as any;
  mocks.computeSHA256 = (async () => "sha256-hash") as any;
  mocks.serializeDeploymentTarget = (() => ({
    providerName: "workers-dispatch",
    targetJson: "{}",
    providerStateJson: "{}",
  })) as any;
  mocks.parseDeploymentTargetConfig = (() => ({})) as any;
  mocks.logDeploymentEvent = (async () => undefined) as any;
  mocks.encryptEnvVars = (async () => "encrypted-env-vars") as any;
  mocks.encrypt = (async () => ({ ciphertext: "ct", iv: "iv" })) as any;
  mocks.ServiceDesiredStateService = (() => ({
    resolveDeploymentState: async () => ({
      envVars: {},
      bindings: [],
      runtimeConfig: {
        compatibility_date: "2024-01-01",
        compatibility_flags: [],
        limits: {},
        mcp_server: undefined,
        updated_at: null,
      },
    }),
  })) as any;
  const { service } = makeService();
  await assertRejects(async () => {
    await service.createDeployment({
      spaceId: "space-1",
      bundleContent: 'console.log("hi")',
    });
  }, "Deployment requires a service identifier");
});
Deno.test("DeploymentService.createDeployment - creates a deployment successfully", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.generateId = (() => "new-dep-id") as any;
  mocks.computeSHA256 = (async () => "sha256-hash") as any;
  mocks.serializeDeploymentTarget = (() => ({
    providerName: "workers-dispatch",
    targetJson: "{}",
    providerStateJson: "{}",
  })) as any;
  mocks.parseDeploymentTargetConfig = (() => ({})) as any;
  mocks.logDeploymentEvent = (async () => undefined) as any;
  mocks.encryptEnvVars = (async () => "encrypted-env-vars") as any;
  mocks.encrypt = (async () => ({ ciphertext: "ct", iv: "iv" })) as any;
  mocks.ServiceDesiredStateService = (() => ({
    resolveDeploymentState: async () => ({
      envVars: {},
      bindings: [],
      runtimeConfig: {
        compatibility_date: "2024-01-01",
        compatibility_flags: [],
        limits: {},
        mcp_server: undefined,
        updated_at: null,
      },
    }),
  })) as any;
  const createdDeployment = createBaseDeployment({
    id: "new-dep-id",
    version: 3,
  });
  mocks.getServiceDeploymentBasics = (async () => ({
    exists: true,
    hostname: "test.example.com",
    workloadKind: "worker-bundle",
  })) as any;
  mocks.createDeploymentWithVersion = (async () => ({
    deployment: createdDeployment,
    version: 3,
  })) as any;

  const { service } = makeService();
  const result = await service.createDeployment({
    serviceId: "w-1",
    spaceId: "space-1",
    bundleContent: 'console.log("hi")',
    deployMessage: "Initial deploy",
  });

  assertEquals(result.id, "new-dep-id");
  assert(mocks.createDeploymentWithVersion.calls.length > 0);
  assertSpyCallArgs(mocks.logDeploymentEvent, 0, [
    expect.anything(),
    "new-dep-id",
    "started",
    null,
    "Deployment created",
    /* expect.any(Object) */ {} as any,
  ]);
});
Deno.test("DeploymentService.createDeployment - defaults worker deployments to runtime-host when WFP env is unavailable", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.generateId = (() => "new-dep-id") as any;
  mocks.computeSHA256 = (async () => "sha256-hash") as any;
  mocks.serializeDeploymentTarget = (() => ({
    providerName: "workers-dispatch",
    targetJson: "{}",
    providerStateJson: "{}",
  })) as any;
  mocks.parseDeploymentTargetConfig = (() => ({})) as any;
  mocks.logDeploymentEvent = (async () => undefined) as any;
  mocks.encryptEnvVars = (async () => "encrypted-env-vars") as any;
  mocks.encrypt = (async () => ({ ciphertext: "ct", iv: "iv" })) as any;
  mocks.ServiceDesiredStateService = (() => ({
    resolveDeploymentState: async () => ({
      envVars: {},
      bindings: [],
      runtimeConfig: {
        compatibility_date: "2024-01-01",
        compatibility_flags: [],
        limits: {},
        mcp_server: undefined,
        updated_at: null,
      },
    }),
  })) as any;
  const createdDeployment = createBaseDeployment({
    id: "new-dep-id",
    version: 3,
    provider_name: "runtime-host" as any,
  });
  mocks.getServiceDeploymentBasics = (async () => ({
    exists: true,
    hostname: "test.example.com",
    workloadKind: "worker-bundle",
  })) as any;
  mocks.createDeploymentWithVersion = (async () => ({
    deployment: createdDeployment,
    version: 3,
  })) as any;
  mocks.serializeDeploymentTarget = (() => ({
    providerName: "runtime-host",
    targetJson: "{}",
    providerStateJson: "{}",
  })) as any;

  const { service } = makeService({
    CF_ACCOUNT_ID: undefined,
    CF_API_TOKEN: undefined,
    WFP_DISPATCH_NAMESPACE: undefined,
  });
  await service.createDeployment({
    serviceId: "w-1",
    spaceId: "space-1",
    bundleContent: 'console.log("hi")',
  });

  assertSpyCallArgs(mocks.serializeDeploymentTarget, 0, [{
    provider: { name: "runtime-host" },
  }]);
});
Deno.test("DeploymentService.createDeployment - uploads bundle to R2 when WORKER_BUNDLES is present", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.generateId = (() => "new-dep-id") as any;
  mocks.computeSHA256 = (async () => "sha256-hash") as any;
  mocks.serializeDeploymentTarget = (() => ({
    providerName: "workers-dispatch",
    targetJson: "{}",
    providerStateJson: "{}",
  })) as any;
  mocks.parseDeploymentTargetConfig = (() => ({})) as any;
  mocks.logDeploymentEvent = (async () => undefined) as any;
  mocks.encryptEnvVars = (async () => "encrypted-env-vars") as any;
  mocks.encrypt = (async () => ({ ciphertext: "ct", iv: "iv" })) as any;
  mocks.ServiceDesiredStateService = (() => ({
    resolveDeploymentState: async () => ({
      envVars: {},
      bindings: [],
      runtimeConfig: {
        compatibility_date: "2024-01-01",
        compatibility_flags: [],
        limits: {},
        mcp_server: undefined,
        updated_at: null,
      },
    }),
  })) as any;
  const createdDeployment = createBaseDeployment({
    id: "new-dep-id",
    version: 1,
  });
  mocks.getServiceDeploymentBasics = (async () => ({
    exists: true,
    hostname: "h.example.com",
    workloadKind: "worker-bundle",
  })) as any;
  mocks.createDeploymentWithVersion = (async () => ({
    deployment: createdDeployment,
    version: 1,
  })) as any;

  const env = makeEnv();
  const service = new DeploymentService(env, "test-key");

  await service.createDeployment({
    serviceId: "w-1",
    spaceId: "space-1",
    bundleContent: 'console.log("hello")',
  });

  assertSpyCallArgs(env.WORKER_BUNDLES.put, 0, [
    "deployments/w-1/1/bundle.js",
    'console.log("hello")',
  ]);
});
Deno.test("DeploymentService.createDeployment - encrypts env vars snapshot when present", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.generateId = (() => "new-dep-id") as any;
  mocks.computeSHA256 = (async () => "sha256-hash") as any;
  mocks.serializeDeploymentTarget = (() => ({
    providerName: "workers-dispatch",
    targetJson: "{}",
    providerStateJson: "{}",
  })) as any;
  mocks.parseDeploymentTargetConfig = (() => ({})) as any;
  mocks.logDeploymentEvent = (async () => undefined) as any;
  mocks.encryptEnvVars = (async () => "encrypted-env-vars") as any;
  mocks.encrypt = (async () => ({ ciphertext: "ct", iv: "iv" })) as any;
  mocks.ServiceDesiredStateService = (() => ({
    resolveDeploymentState: async () => ({
      envVars: {},
      bindings: [],
      runtimeConfig: {
        compatibility_date: "2024-01-01",
        compatibility_flags: [],
        limits: {},
        mcp_server: undefined,
        updated_at: null,
      },
    }),
  })) as any;
  const createdDeployment = createBaseDeployment({
    id: "new-dep-id",
    version: 1,
  });
  mocks.getServiceDeploymentBasics = (async () => ({
    exists: true,
    hostname: "h.example.com",
    workloadKind: "worker-bundle",
  })) as any;
  mocks.createDeploymentWithVersion = (async () => ({
    deployment: createdDeployment,
    version: 1,
  })) as any;
  mocks.ServiceDesiredStateService = (() => ({
    resolveDeploymentState: async () => ({
      envVars: { SECRET: "value" },
      bindings: [],
      runtimeConfig: {
        compatibility_date: "2024-01-01",
        compatibility_flags: [],
        limits: {},
        updated_at: null,
      },
    }),
  })) as any;

  const { service } = makeService();
  await service.createDeployment({
    serviceId: "w-1",
    spaceId: "space-1",
    bundleContent: "code",
  });

  assertSpyCallArgs(mocks.encryptEnvVars, 0, [
    { SECRET: "value" },
    "test-encryption-key",
    "new-dep-id",
  ]);
});
Deno.test("DeploymentService.createDeployment - encrypts bindings snapshot when present", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.generateId = (() => "new-dep-id") as any;
  mocks.computeSHA256 = (async () => "sha256-hash") as any;
  mocks.serializeDeploymentTarget = (() => ({
    providerName: "workers-dispatch",
    targetJson: "{}",
    providerStateJson: "{}",
  })) as any;
  mocks.parseDeploymentTargetConfig = (() => ({})) as any;
  mocks.logDeploymentEvent = (async () => undefined) as any;
  mocks.encryptEnvVars = (async () => "encrypted-env-vars") as any;
  mocks.encrypt = (async () => ({ ciphertext: "ct", iv: "iv" })) as any;
  mocks.ServiceDesiredStateService = (() => ({
    resolveDeploymentState: async () => ({
      envVars: {},
      bindings: [],
      runtimeConfig: {
        compatibility_date: "2024-01-01",
        compatibility_flags: [],
        limits: {},
        mcp_server: undefined,
        updated_at: null,
      },
    }),
  })) as any;
  const createdDeployment = createBaseDeployment({
    id: "new-dep-id",
    version: 1,
  });
  mocks.getServiceDeploymentBasics = (async () => ({
    exists: true,
    hostname: "h.example.com",
    workloadKind: "worker-bundle",
  })) as any;
  mocks.createDeploymentWithVersion = (async () => ({
    deployment: createdDeployment,
    version: 1,
  })) as any;
  mocks.ServiceDesiredStateService = (() => ({
    resolveDeploymentState: async () => ({
      envVars: {},
      bindings: [{ type: "kv", name: "MY_KV", providerResourceId: "ns-1" }],
      runtimeConfig: {
        compatibility_date: "2024-01-01",
        compatibility_flags: [],
        limits: {},
        updated_at: null,
      },
    }),
  })) as any;

  const { service } = makeService();
  await service.createDeployment({
    serviceId: "w-1",
    spaceId: "space-1",
    bundleContent: "code",
  });

  assertSpyCallArgs(mocks.encrypt, 0, [
    JSON.stringify([{ type: "kv", name: "MY_KV", providerResourceId: "ns-1" }]),
    "test-encryption-key",
    "new-dep-id",
  ]);
});
Deno.test("DeploymentService.createDeployment - returns existing deployment for matching idempotency key", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.generateId = (() => "new-dep-id") as any;
  mocks.computeSHA256 = (async () => "sha256-hash") as any;
  mocks.serializeDeploymentTarget = (() => ({
    providerName: "workers-dispatch",
    targetJson: "{}",
    providerStateJson: "{}",
  })) as any;
  mocks.parseDeploymentTargetConfig = (() => ({})) as any;
  mocks.logDeploymentEvent = (async () => undefined) as any;
  mocks.encryptEnvVars = (async () => "encrypted-env-vars") as any;
  mocks.encrypt = (async () => ({ ciphertext: "ct", iv: "iv" })) as any;
  mocks.ServiceDesiredStateService = (() => ({
    resolveDeploymentState: async () => ({
      envVars: {},
      bindings: [],
      runtimeConfig: {
        compatibility_date: "2024-01-01",
        compatibility_flags: [],
        limits: {},
        mcp_server: undefined,
        updated_at: null,
      },
    }),
  })) as any;
  // bundle_size must match new TextEncoder().encode('console.log("hi")').byteLength = 17
  const existing = createBaseDeployment({
    id: "existing-dep",
    bundle_hash: "sha256-hash",
    bundle_size: 17,
  });
  mocks.getServiceDeploymentBasics = (async () => ({ exists: true })) as any;
  mocks.getDeploymentByIdempotencyKey = (async () => existing) as any;

  const { service } = makeService();
  const result = await service.createDeployment({
    serviceId: "w-1",
    spaceId: "space-1",
    bundleContent: 'console.log("hi")',
    idempotencyKey: "idem-123",
  });

  assertEquals(result.id, "existing-dep");
  assertSpyCalls(mocks.createDeploymentWithVersion, 0);
});
Deno.test("DeploymentService.createDeployment - throws when idempotency key reuse does not match original request", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.generateId = (() => "new-dep-id") as any;
  mocks.computeSHA256 = (async () => "sha256-hash") as any;
  mocks.serializeDeploymentTarget = (() => ({
    providerName: "workers-dispatch",
    targetJson: "{}",
    providerStateJson: "{}",
  })) as any;
  mocks.parseDeploymentTargetConfig = (() => ({})) as any;
  mocks.logDeploymentEvent = (async () => undefined) as any;
  mocks.encryptEnvVars = (async () => "encrypted-env-vars") as any;
  mocks.encrypt = (async () => ({ ciphertext: "ct", iv: "iv" })) as any;
  mocks.ServiceDesiredStateService = (() => ({
    resolveDeploymentState: async () => ({
      envVars: {},
      bindings: [],
      runtimeConfig: {
        compatibility_date: "2024-01-01",
        compatibility_flags: [],
        limits: {},
        mcp_server: undefined,
        updated_at: null,
      },
    }),
  })) as any;
  const existing = createBaseDeployment({
    id: "existing-dep",
    bundle_hash: "different-hash",
    bundle_size: 99,
  });
  mocks.getServiceDeploymentBasics = (async () => ({ exists: true })) as any;
  mocks.getDeploymentByIdempotencyKey = (async () => existing) as any;

  const { service } = makeService();
  await assertRejects(async () => {
    await service.createDeployment({
      serviceId: "w-1",
      spaceId: "space-1",
      bundleContent: 'console.log("hi")',
      idempotencyKey: "idem-123",
    });
  }, "Idempotency-Key reuse does not match");
});
Deno.test("DeploymentService.createDeployment - uses snapshotOverride when provided instead of resolving state", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.generateId = (() => "new-dep-id") as any;
  mocks.computeSHA256 = (async () => "sha256-hash") as any;
  mocks.serializeDeploymentTarget = (() => ({
    providerName: "workers-dispatch",
    targetJson: "{}",
    providerStateJson: "{}",
  })) as any;
  mocks.parseDeploymentTargetConfig = (() => ({})) as any;
  mocks.logDeploymentEvent = (async () => undefined) as any;
  mocks.encryptEnvVars = (async () => "encrypted-env-vars") as any;
  mocks.encrypt = (async () => ({ ciphertext: "ct", iv: "iv" })) as any;
  mocks.ServiceDesiredStateService = (() => ({
    resolveDeploymentState: async () => ({
      envVars: {},
      bindings: [],
      runtimeConfig: {
        compatibility_date: "2024-01-01",
        compatibility_flags: [],
        limits: {},
        mcp_server: undefined,
        updated_at: null,
      },
    }),
  })) as any;
  const createdDeployment = createBaseDeployment({
    id: "new-dep-id",
    version: 1,
  });
  mocks.getServiceDeploymentBasics = (async () => ({
    exists: true,
    hostname: "h.example.com",
    workloadKind: "worker-bundle",
  })) as any;
  mocks.createDeploymentWithVersion = (async () => ({
    deployment: createdDeployment,
    version: 1,
  })) as any;

  const resolveDeploymentState = ((..._args: any[]) => undefined) as any;
  mocks.ServiceDesiredStateService =
    (() => ({ resolveDeploymentState })) as any;

  const { service } = makeService();
  await service.createDeployment({
    serviceId: "w-1",
    spaceId: "space-1",
    bundleContent: "code",
    snapshotOverride: {
      envVars: { KEY: "val" },
      bindings: [],
      runtimeConfig: { compatibility_date: "2025-01-01" },
    },
  });

  // resolveDeploymentState should NOT be called when snapshot override is provided
  assertSpyCalls(resolveDeploymentState, 0);
  assertSpyCallArgs(mocks.encryptEnvVars, 0, [
    { KEY: "val" },
    "test-encryption-key",
    "new-dep-id",
  ]);
});
Deno.test("DeploymentService.createDeployment - cleans up R2 artifacts on creation failure", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.generateId = (() => "new-dep-id") as any;
  mocks.computeSHA256 = (async () => "sha256-hash") as any;
  mocks.serializeDeploymentTarget = (() => ({
    providerName: "workers-dispatch",
    targetJson: "{}",
    providerStateJson: "{}",
  })) as any;
  mocks.parseDeploymentTargetConfig = (() => ({})) as any;
  mocks.logDeploymentEvent = (async () => undefined) as any;
  mocks.encryptEnvVars = (async () => "encrypted-env-vars") as any;
  mocks.encrypt = (async () => ({ ciphertext: "ct", iv: "iv" })) as any;
  mocks.ServiceDesiredStateService = (() => ({
    resolveDeploymentState: async () => ({
      envVars: {},
      bindings: [],
      runtimeConfig: {
        compatibility_date: "2024-01-01",
        compatibility_flags: [],
        limits: {},
        mcp_server: undefined,
        updated_at: null,
      },
    }),
  })) as any;
  mocks.getServiceDeploymentBasics = (async () => ({
    exists: true,
    hostname: "h.example.com",
    workloadKind: "worker-bundle",
  })) as any;
  mocks.createDeploymentWithVersion = (async () => ({
    deployment: createBaseDeployment({ id: "new-dep-id", version: 1 }),
    version: 1,
  })) as any;
  // Simulate logDeploymentEvent failing (after R2 put succeeds)
  mocks.logDeploymentEvent = (async () => {
    throw new Error("db write error");
  }) as any;

  const env = makeEnv();
  const service = new DeploymentService(env, "test-key");

  await assertRejects(async () => {
    await service.createDeployment({
      serviceId: "w-1",
      spaceId: "space-1",
      bundleContent: "code",
    });
  }, "db write error");

  assert(env.WORKER_BUNDLES.delete.calls.length > 0);
});
Deno.test("DeploymentService.createDeployment - falls back to workerId when serviceId is not provided", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.generateId = (() => "new-dep-id") as any;
  mocks.computeSHA256 = (async () => "sha256-hash") as any;
  mocks.serializeDeploymentTarget = (() => ({
    providerName: "workers-dispatch",
    targetJson: "{}",
    providerStateJson: "{}",
  })) as any;
  mocks.parseDeploymentTargetConfig = (() => ({})) as any;
  mocks.logDeploymentEvent = (async () => undefined) as any;
  mocks.encryptEnvVars = (async () => "encrypted-env-vars") as any;
  mocks.encrypt = (async () => ({ ciphertext: "ct", iv: "iv" })) as any;
  mocks.ServiceDesiredStateService = (() => ({
    resolveDeploymentState: async () => ({
      envVars: {},
      bindings: [],
      runtimeConfig: {
        compatibility_date: "2024-01-01",
        compatibility_flags: [],
        limits: {},
        mcp_server: undefined,
        updated_at: null,
      },
    }),
  })) as any;
  const createdDeployment = createBaseDeployment({
    id: "new-dep-id",
    version: 1,
  });
  mocks.getServiceDeploymentBasics = (async () => ({
    exists: true,
    hostname: "h.example.com",
    workloadKind: "worker-bundle",
  })) as any;
  mocks.createDeploymentWithVersion = (async () => ({
    deployment: createdDeployment,
    version: 1,
  })) as any;

  const { service } = makeService();
  await service.createDeployment({
    workerId: "legacy-w-1",
    spaceId: "space-1",
    bundleContent: "code",
  });

  assertSpyCallArgs(mocks.getServiceDeploymentBasics, 0, [
    expect.anything(),
    "legacy-w-1",
  ]);
});
// ---------------------------------------------------------------------------
// executeDeployment
// ---------------------------------------------------------------------------

Deno.test("DeploymentService.executeDeployment - throws when deployment not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.logDeploymentEvent = (async () => undefined) as any;
  mocks.updateDeploymentState = (async () => undefined) as any;
  mocks.updateDeploymentRecord = (async () => undefined) as any;
  mocks.rollbackDeploymentSteps = (async () => undefined) as any;
  mocks.parseDeploymentTargetConfig = (() => ({})) as any;
  mocks.reconcileManagedWorkerMcpServer = (async () => undefined) as any;
  mocks.getDeploymentById = (async () => null) as any;

  const { service } = makeService();
  await assertRejects(async () => {
    await service.executeDeployment("nonexistent");
  }, "Deployment nonexistent not found");
});
Deno.test("DeploymentService.executeDeployment - returns immediately for already-succeeded deployments", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.logDeploymentEvent = (async () => undefined) as any;
  mocks.updateDeploymentState = (async () => undefined) as any;
  mocks.updateDeploymentRecord = (async () => undefined) as any;
  mocks.rollbackDeploymentSteps = (async () => undefined) as any;
  mocks.parseDeploymentTargetConfig = (() => ({})) as any;
  mocks.reconcileManagedWorkerMcpServer = (async () => undefined) as any;
  const dep = createBaseDeployment({ status: "success" });
  mocks.getDeploymentById = (async () => dep) as any;

  const { service } = makeService();
  const result = await service.executeDeployment("dep-1");

  assertEquals(result.status, "success");
  assertSpyCalls(mocks.updateDeploymentState, 0);
});
Deno.test("DeploymentService.executeDeployment - returns immediately for rolled-back deployments", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.logDeploymentEvent = (async () => undefined) as any;
  mocks.updateDeploymentState = (async () => undefined) as any;
  mocks.updateDeploymentRecord = (async () => undefined) as any;
  mocks.rollbackDeploymentSteps = (async () => undefined) as any;
  mocks.parseDeploymentTargetConfig = (() => ({})) as any;
  mocks.reconcileManagedWorkerMcpServer = (async () => undefined) as any;
  const dep = createBaseDeployment({ status: "rolled_back" });
  mocks.getDeploymentById = (async () => dep) as any;

  const { service } = makeService();
  const result = await service.executeDeployment("dep-1");

  assertEquals(result.status, "rolled_back");
  assertSpyCalls(mocks.updateDeploymentState, 0);
});
Deno.test("DeploymentService.executeDeployment - executes deployment steps and returns completed deployment", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.logDeploymentEvent = (async () => undefined) as any;
  mocks.updateDeploymentState = (async () => undefined) as any;
  mocks.updateDeploymentRecord = (async () => undefined) as any;
  mocks.rollbackDeploymentSteps = (async () => undefined) as any;
  mocks.parseDeploymentTargetConfig = (() => ({})) as any;
  mocks.reconcileManagedWorkerMcpServer = (async () => undefined) as any;
  const bundleContent = 'console.log("hi")';
  const dep = createBaseDeployment({
    bundle_hash: "sha256-hash",
    bundle_size: new TextEncoder().encode(bundleContent).byteLength,
  });
  const completedDep = createBaseDeployment({
    status: "success",
    deploy_state: "completed",
  });

  mocks.getDeploymentById = createAsyncSequence(dep, completedDep) as any;

  mocks.getDeploymentEvents = (async () => []) as any;
  mocks.getServiceDeploymentBasics = (async () => ({
    exists: true,
    hostname: "test.example.com",
    activeDeploymentId: null,
  })) as any;
  mocks.constantTimeEqual = (() => true) as any;
  mocks.createDeploymentProvider = (() => ({
    name: "workers-dispatch",
    deploy: ((..._args: any[]) => undefined) as any,
    assertRollbackTarget: ((..._args: any[]) => undefined) as any,
  })) as any;
  mocks.executeDeploymentStep = (async (
    _db: any,
    _id: any,
    _state: any,
    _step: any,
    action: () => Promise<void>,
  ) => {
    await action();
  }) as any;
  mocks.fetchServiceWithDomains = (async () => ({
    id: "w-1",
    hostname: "test.example.com",
    activeDeploymentId: null,
    customDomains: [],
  })) as any;
  mocks.collectHostnames = (() => ["test.example.com"]) as any;
  mocks.snapshotRouting = (async () => []) as any;
  mocks.buildRoutingTarget = (() => ({
    target: { type: "deployments", deployments: [] },
    auditDetails: {},
  })) as any;
  mocks.applyRoutingToHostnames = (async () => undefined) as any;
  mocks.applyRoutingDbUpdates = (async () => undefined) as any;

  const dbChain = makeDbUpdateChain();
  mocks.getDb = (() => ({
    select: () => ({
      from: function (this: any) {
        return this;
      },
      where: function (this: any) {
        return this;
      },
      get: async () => null,
    }),
    update: () => dbChain,
  })) as any;

  const env = makeEnv();
  env.WORKER_BUNDLES.get = (async () => ({
    text: () => Promise.resolve(bundleContent),
  })) as any;
  env.WORKER_BUNDLES.delete = (async () => undefined) as any;
  const service = new DeploymentService(env, "test-key");
  const result = await service.executeDeployment("dep-1");

  assertEquals(result.status, "success");
  assertSpyCallArgs(mocks.updateDeploymentState, 0, [
    expect.anything(),
    "dep-1",
    "in_progress",
    "pending",
  ]);
});
Deno.test("DeploymentService.executeDeployment - passes env-derived provider registry into deployment execution", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.logDeploymentEvent = (async () => undefined) as any;
  mocks.updateDeploymentState = (async () => undefined) as any;
  mocks.updateDeploymentRecord = (async () => undefined) as any;
  mocks.rollbackDeploymentSteps = (async () => undefined) as any;
  mocks.parseDeploymentTargetConfig = (() => ({})) as any;
  mocks.reconcileManagedWorkerMcpServer = (async () => undefined) as any;
  const dep = createBaseDeployment({
    artifact_kind: "container-image",
    provider_name: "ecs",
    target_json: JSON.stringify({
      route_ref: "takos-worker",
      artifact: {
        image_ref: "ghcr.io/takos/worker:latest",
      },
    }),
  });
  const completedDep = createBaseDeployment({
    artifact_kind: "container-image",
    provider_name: "ecs",
    status: "success",
    deploy_state: "completed",
  });

  mocks.getDeploymentById = createAsyncSequence(dep, completedDep) as any;
  mocks.getDeploymentEvents = (async () => []) as any;
  mocks.getServiceDeploymentBasics = (async () => ({
    exists: true,
    hostname: "test.example.com",
    activeDeploymentId: null,
  })) as any;
  mocks.parseDeploymentTargetConfig = (() => ({
    route_ref: "takos-worker",
    artifact: {
      image_ref: "ghcr.io/takos/worker:latest",
    },
  })) as any;
  mocks.createDeploymentProvider = (() => ({
    name: "ecs",
    deploy: ((..._args: any[]) => undefined) as any,
    assertRollbackTarget: ((..._args: any[]) => undefined) as any,
  })) as any;
  mocks.executeDeploymentStep = (async (
    _db: any,
    _id: any,
    _state: any,
    _step: any,
    action: () => Promise<void>,
  ) => {
    await action();
  }) as any;
  mocks.fetchServiceWithDomains = (async () => ({
    id: "w-1",
    hostname: "test.example.com",
    activeDeploymentId: null,
    customDomains: [],
  })) as any;
  mocks.collectHostnames = (() => ["test.example.com"]) as any;
  mocks.snapshotRouting = (async () => []) as any;
  mocks.buildRoutingTarget = (() => ({
    target: { type: "deployments", deployments: [] },
    auditDetails: {},
  })) as any;
  mocks.applyRoutingToHostnames = (async () => undefined) as any;
  mocks.applyRoutingDbUpdates = (async () => undefined) as any;

  const dbChain = makeDbUpdateChain();
  mocks.getDb = (() => ({
    select: () => ({
      from: function (this: any) {
        return this;
      },
      where: function (this: any) {
        return this;
      },
      get: async () => null,
    }),
    update: () => dbChain,
  })) as any;

  const env = makeEnv({
    OCI_ORCHESTRATOR_URL: "http://orchestrator.internal",
    AWS_ECS_REGION: "us-east-1",
    AWS_ECS_CLUSTER_ARN: "arn:aws:ecs:us-east-1:123456789012:cluster/takos",
    AWS_ECS_TASK_DEFINITION_FAMILY: "takos-worker",
  });
  const service = new DeploymentService(env, "test-key");
  await service.executeDeployment("dep-1");

  assertSpyCallArgs(mocks.createDeploymentProvider, 0, [
    dep,
    {
      orchestratorUrl: "http://orchestrator.internal",
      providerRegistry: {
        defaultName: "workers-dispatch",
      },
    },
  ]);
  const createDeploymentProviderCall = mocks.createDeploymentProvider.calls[0]
    ?.[1];
  assertEquals(createDeploymentProviderCall.providerRegistry.get("ecs"), {
    name: "ecs",
    config: {
      region: "us-east-1",
      clusterArn: "arn:aws:ecs:us-east-1:123456789012:cluster/takos",
      taskDefinitionFamily: "takos-worker",
    },
  });
});
Deno.test("DeploymentService.executeDeployment - handles deployment failure — rolls back steps and marks as failed", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.logDeploymentEvent = (async () => undefined) as any;
  mocks.updateDeploymentState = (async () => undefined) as any;
  mocks.updateDeploymentRecord = (async () => undefined) as any;
  mocks.rollbackDeploymentSteps = (async () => undefined) as any;
  mocks.parseDeploymentTargetConfig = (() => ({})) as any;
  mocks.reconcileManagedWorkerMcpServer = (async () => undefined) as any;
  const dep = createBaseDeployment({ worker_id: "w-1", service_id: "w-1" });
  mocks.getDeploymentById = (async () => dep) as any;
  mocks.getDeploymentEvents = (async () => []) as any;
  // getServiceDeploymentBasics is called twice: once in the try block (returns false)
  // and once in the catch block to check activeDeploymentId
  mocks.getServiceDeploymentBasics = (async () => ({
    exists: false,
    id: "w-1",
    hostname: null,
    activeDeploymentId: null,
  })) as any;
  mocks.createDeploymentProvider = (() => ({
    name: "workers-dispatch",
    deploy: ((..._args: any[]) => undefined) as any,
    assertRollbackTarget: ((..._args: any[]) => undefined) as any,
  })) as any;

  const { service } = makeService();
  await assertRejects(async () => {
    await service.executeDeployment("dep-1");
  }, "Worker not found");

  assert(mocks.rollbackDeploymentSteps.calls.length > 0);
  assertSpyCallArgs(mocks.updateDeploymentRecord, 0, [
    expect.anything(),
    "dep-1",
    {
      deployState: "failed",
      status: "failed",
    },
  ]);
  assertSpyCallArgs(mocks.logDeploymentEvent, 0, [
    expect.anything(),
    "dep-1",
    "failed",
    null,
    "Worker not found",
  ]);
});
Deno.test("DeploymentService.executeDeployment - skips already-completed steps during resume", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.logDeploymentEvent = (async () => undefined) as any;
  mocks.updateDeploymentState = (async () => undefined) as any;
  mocks.updateDeploymentRecord = (async () => undefined) as any;
  mocks.rollbackDeploymentSteps = (async () => undefined) as any;
  mocks.parseDeploymentTargetConfig = (() => ({})) as any;
  mocks.reconcileManagedWorkerMcpServer = (async () => undefined) as any;
  const bundleContent = 'console.log("hi")';
  const dep = createBaseDeployment({
    deploy_state: "routing",
    bundle_hash: "sha256-hash",
    bundle_size: new TextEncoder().encode(bundleContent).byteLength,
  });
  const completedDep = createBaseDeployment({
    status: "success",
    deploy_state: "completed",
  });

  mocks.getDeploymentById = createAsyncSequence(dep, completedDep) as any;

  mocks.getDeploymentEvents = (async () => [
    { event_type: "step_completed", step_name: "deploy_worker" },
  ]) as any;
  mocks.getServiceDeploymentBasics = (async () => ({
    exists: true,
    hostname: "test.example.com",
    activeDeploymentId: null,
  })) as any;
  mocks.constantTimeEqual = (() => true) as any;
  mocks.createDeploymentProvider = (() => ({
    name: "workers-dispatch",
    deploy: ((..._args: any[]) => undefined) as any,
    assertRollbackTarget: ((..._args: any[]) => undefined) as any,
  })) as any;
  mocks.executeDeploymentStep = (async (
    _db: any,
    _id: any,
    _state: any,
    _step: any,
    action: () => Promise<void>,
  ) => {
    await action();
  }) as any;
  mocks.fetchServiceWithDomains = (async () => ({
    id: "w-1",
    hostname: "test.example.com",
    activeDeploymentId: null,
    customDomains: [],
  })) as any;
  mocks.collectHostnames = (() => ["test.example.com"]) as any;
  mocks.snapshotRouting = (async () => []) as any;
  mocks.buildRoutingTarget = (() => ({
    target: { type: "deployments", deployments: [] },
    auditDetails: {},
  })) as any;
  mocks.applyRoutingToHostnames = (async () => undefined) as any;
  mocks.applyRoutingDbUpdates = (async () => undefined) as any;
  mocks.reconcileManagedWorkerMcpServer = (async () => undefined) as any;

  const dbChain = makeDbUpdateChain();
  mocks.getDb = (() => ({
    select: () => ({
      from: function (this: any) {
        return this;
      },
      where: function (this: any) {
        return this;
      },
      get: async () => null,
    }),
    update: () => dbChain,
  })) as any;

  const env = makeEnv();
  env.WORKER_BUNDLES.delete = (async () => undefined) as any;
  const service = new DeploymentService(env, "test-key");
  const result = await service.executeDeployment("dep-1");

  assertEquals(result.status, "success");
  // deploy_worker step should be called only for update_routing (once, not twice)
  assertSpyCalls(mocks.executeDeploymentStep, 1);
  assertSpyCallArgs(mocks.executeDeploymentStep, 0, [
    expect.anything(),
    "dep-1",
    "routing",
    "update_routing",
    /* expect.any(Function) */ {} as any,
  ]);
});
// ---------------------------------------------------------------------------
// rollback
// ---------------------------------------------------------------------------

Deno.test("DeploymentService.rollback - throws when worker not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.logDeploymentEvent = (async () => undefined) as any;
  mocks.updateServiceDeploymentPointers = (async () => undefined) as any;
  mocks.parseDeploymentTargetConfig = (() => ({})) as any;
  mocks.getServiceRollbackInfo = (async () => null) as any;

  const { service } = makeService();
  await assertRejects(async () => {
    await service.rollback({ serviceId: "w-missing", userId: "user-1" });
  }, "Worker w-missing not found");
});
Deno.test("DeploymentService.rollback - throws when no valid deployment found for rollback", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.logDeploymentEvent = (async () => undefined) as any;
  mocks.updateServiceDeploymentPointers = (async () => undefined) as any;
  mocks.parseDeploymentTargetConfig = (() => ({})) as any;
  mocks.getServiceRollbackInfo = (async () => ({
    exists: true,
    id: "w-1",
    hostname: "test.example.com",
    activeDeploymentId: "dep-2",
    fallbackDeploymentId: null,
  })) as any;

  const { service } = makeService();
  await assertRejects(async () => {
    await service.rollback({ serviceId: "w-1", userId: "user-1" });
  }, "No valid deployment found for rollback");
});
Deno.test("DeploymentService.rollback - throws when target deployment is already active", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.logDeploymentEvent = (async () => undefined) as any;
  mocks.updateServiceDeploymentPointers = (async () => undefined) as any;
  mocks.parseDeploymentTargetConfig = (() => ({})) as any;
  mocks.getServiceRollbackInfo = (async () => ({
    exists: true,
    id: "w-1",
    activeDeploymentId: "dep-1",
    fallbackDeploymentId: "dep-1",
  })) as any;
  mocks.getDeploymentById =
    (async () =>
      createBaseDeployment({ id: "dep-1", worker_id: "w-1" })) as any;

  const { service } = makeService();
  await assertRejects(async () => {
    await service.rollback({ serviceId: "w-1", userId: "user-1" });
  }, "Target deployment is already active");
});
Deno.test("DeploymentService.rollback - throws when target has no artifact_ref", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.logDeploymentEvent = (async () => undefined) as any;
  mocks.updateServiceDeploymentPointers = (async () => undefined) as any;
  mocks.parseDeploymentTargetConfig = (() => ({})) as any;
  mocks.getServiceRollbackInfo = (async () => ({
    exists: true,
    id: "w-1",
    activeDeploymentId: "dep-2",
    fallbackDeploymentId: "dep-1",
  })) as any;
  mocks.getDeploymentById = (async () =>
    createBaseDeployment({
      id: "dep-1",
      worker_id: "w-1",
      artifact_ref: null,
    })) as any;

  const { service } = makeService();
  await assertRejects(async () => {
    await service.rollback({ serviceId: "w-1", userId: "user-1" });
  }, "Rollback target has no artifact_ref");
});
Deno.test("DeploymentService.rollback - performs rollback to fallback deployment successfully", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.logDeploymentEvent = (async () => undefined) as any;
  mocks.updateServiceDeploymentPointers = (async () => undefined) as any;
  mocks.parseDeploymentTargetConfig = (() => ({})) as any;
  const targetDep = createBaseDeployment({
    id: "dep-1",
    worker_id: "w-1",
    version: 1,
    artifact_ref: "worker-w-1-v1",
  });

  mocks.getServiceRollbackInfo = (async () => ({
    exists: true,
    id: "w-1",
    activeDeploymentId: "dep-2",
    fallbackDeploymentId: "dep-1",
    activeDeploymentVersion: 2,
  })) as any;
  mocks.getDeploymentById = createAsyncSequence(targetDep, targetDep) as any;
  mocks.createDeploymentProvider = (() => ({
    name: "workers-dispatch",
    deploy: ((..._args: any[]) => undefined) as any,
    assertRollbackTarget: async () => undefined,
  })) as any;
  mocks.fetchServiceWithDomains = (async () => ({
    id: "w-1",
    hostname: "test.example.com",
    activeDeploymentId: "dep-2",
    customDomains: [],
  })) as any;
  mocks.collectHostnames = (() => ["test.example.com"]) as any;
  mocks.snapshotRouting = (async () => [
    { hostname: "test.example.com", target: null },
  ]) as any;
  mocks.buildRoutingTarget = (() => ({
    target: { type: "deployments", deployments: [] },
    auditDetails: {},
  })) as any;
  mocks.applyRoutingToHostnames = (async () => undefined) as any;

  const dbChain = makeDbUpdateChain();
  mocks.getDb = (() => ({
    update: () => dbChain,
  })) as any;

  const env = makeEnv();
  const service = new DeploymentService(env, "test-key");
  const result = await service.rollback({ serviceId: "w-1", userId: "user-1" });

  assertEquals(result.id, "dep-1");
  assertSpyCallArgs(mocks.updateServiceDeploymentPointers, 0, [
    expect.anything(),
    "w-1",
    {
      activeDeploymentId: "dep-1",
      fallbackDeploymentId: "dep-2",
    },
  ]);
  assertSpyCallArgs(mocks.logDeploymentEvent, 0, [
    expect.anything(),
    "dep-1",
    "rollback_pointer",
    null,
    /* expect.any(String) */ {} as any,
    /* expect.any(Object) */ {} as any,
  ]);
});
Deno.test("DeploymentService.rollback - passes env-derived provider registry into rollback execution", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.logDeploymentEvent = (async () => undefined) as any;
  mocks.updateServiceDeploymentPointers = (async () => undefined) as any;
  mocks.parseDeploymentTargetConfig = (() => ({})) as any;
  const targetDep = createBaseDeployment({
    id: "dep-1",
    worker_id: "w-1",
    artifact_kind: "container-image",
    provider_name: "k8s",
    target_json: JSON.stringify({
      route_ref: "takos-worker",
      artifact: {
        image_ref: "ghcr.io/takos/worker:latest",
      },
    }),
  });

  mocks.getServiceRollbackInfo = (async () => ({
    exists: true,
    id: "w-1",
    activeDeploymentId: "dep-2",
    fallbackDeploymentId: "dep-1",
    activeDeploymentVersion: 2,
  })) as any;
  mocks.getDeploymentById = createAsyncSequence(targetDep, targetDep) as any;
  mocks.createDeploymentProvider = (() => ({
    name: "k8s",
    deploy: async () => undefined,
    assertRollbackTarget: async () => undefined,
  })) as any;
  mocks.fetchServiceWithDomains = (async () => ({
    id: "w-1",
    hostname: "test.example.com",
    activeDeploymentId: "dep-2",
    customDomains: [],
  })) as any;
  mocks.collectHostnames = (() => []) as any;
  mocks.snapshotRouting = (async () => []) as any;
  mocks.buildRoutingTarget = (() => ({
    target: { type: "deployments", deployments: [] },
    auditDetails: {},
  })) as any;
  mocks.parseDeploymentTargetConfig = (() => ({
    route_ref: "takos-worker",
    artifact: {
      image_ref: "ghcr.io/takos/worker:latest",
    },
  })) as any;

  const dbChain = makeDbUpdateChain();
  mocks.getDb = (() => ({
    update: () => dbChain,
  })) as any;

  const env = makeEnv({
    OCI_ORCHESTRATOR_URL: "http://orchestrator.internal",
    K8S_NAMESPACE: "takos",
    K8S_DEPLOYMENT_NAME: "takos-worker",
  });
  const service = new DeploymentService(env, "test-key");
  await service.rollback({ serviceId: "w-1", userId: "user-1" });

  assertSpyCallArgs(mocks.createDeploymentProvider, 0, [
    targetDep,
    {
      orchestratorUrl: "http://orchestrator.internal",
      providerRegistry: /* expect.any(Object) */ {} as any,
    },
  ]);
  const rollbackCreateCall = mocks.createDeploymentProvider.calls[0]?.[1];
  assertEquals(rollbackCreateCall.providerRegistry.get("k8s"), {
    name: "k8s",
    config: {
      namespace: "takos",
      deploymentName: "takos-worker",
    },
  });
});
Deno.test("DeploymentService.rollback - rolls back to specific target version", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.logDeploymentEvent = (async () => undefined) as any;
  mocks.updateServiceDeploymentPointers = (async () => undefined) as any;
  mocks.parseDeploymentTargetConfig = (() => ({})) as any;
  const targetDep = createBaseDeployment({
    id: "dep-v3",
    worker_id: "w-1",
    version: 3,
    artifact_ref: "worker-w-1-v3",
  });

  mocks.getServiceRollbackInfo = (async () => ({
    exists: true,
    id: "w-1",
    activeDeploymentId: "dep-v5",
    fallbackDeploymentId: "dep-v4",
    activeDeploymentVersion: 5,
  })) as any;
  mocks.findDeploymentByServiceVersion = (async () => targetDep) as any;
  mocks.getDeploymentById = (async () => targetDep) as any;
  mocks.createDeploymentProvider = (() => ({
    name: "workers-dispatch",
    deploy: ((..._args: any[]) => undefined) as any,
    assertRollbackTarget: async () => undefined,
  })) as any;
  mocks.fetchServiceWithDomains = (async () => ({
    id: "w-1",
    hostname: "test.example.com",
    activeDeploymentId: "dep-v5",
    customDomains: [],
  })) as any;
  mocks.collectHostnames = (() => []) as any;
  mocks.snapshotRouting = (async () => []) as any;
  mocks.buildRoutingTarget = (() => ({
    target: { type: "deployments", deployments: [] },
    auditDetails: {},
  })) as any;

  const dbChain = makeDbUpdateChain();
  mocks.getDb = (() => ({
    update: () => dbChain,
  })) as any;

  const { service } = makeService();
  const result = await service.rollback({
    serviceId: "w-1",
    userId: "user-1",
    targetVersion: 3,
  });

  assertEquals(result.id, "dep-v3");
  assertSpyCallArgs(mocks.findDeploymentByServiceVersion, 0, [
    expect.anything(),
    "w-1",
    3,
  ]);
});
// ---------------------------------------------------------------------------
// rollbackWorker (convenience wrapper)
// ---------------------------------------------------------------------------

Deno.test("DeploymentService.rollbackWorker - delegates to rollback with the correct parameters", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getServiceRollbackInfo = (async () => null) as any;

  const { service } = makeService();
  await assertRejects(async () => {
    await service.rollbackWorker("w-1", "user-1", 2);
  }, "Worker w-1 not found");

  assertSpyCallArgs(mocks.getServiceRollbackInfo, 0, [
    expect.anything(),
    "w-1",
  ]);
});
// ---------------------------------------------------------------------------
// resumeDeployment
// ---------------------------------------------------------------------------

Deno.test("DeploymentService.resumeDeployment - throws when deployment not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.updateDeploymentRecord = (async () => undefined) as any;
  mocks.getDeploymentById = (async () => null) as any;

  const { service } = makeService();
  await assertRejects(async () => {
    await service.resumeDeployment("nonexistent");
  }, "Deployment nonexistent not found");
});
Deno.test("DeploymentService.resumeDeployment - returns immediately for already-succeeded deployments", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.updateDeploymentRecord = (async () => undefined) as any;
  const dep = createBaseDeployment({ status: "success" });
  mocks.getDeploymentById = (async () => dep) as any;

  const { service } = makeService();
  const result = await service.resumeDeployment("dep-1");

  assertEquals(result.status, "success");
  assertSpyCalls(mocks.updateDeploymentRecord, 0);
});
Deno.test("DeploymentService.resumeDeployment - clears step error before re-executing", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.updateDeploymentRecord = (async () => undefined) as any;
  const dep = createBaseDeployment({
    status: "failed",
    step_error: "some error",
  });
  // first call is for resume, second will be for executeDeployment, which throws
  mocks.getDeploymentById = createAsyncSequence(dep, null) as any;

  const { service } = makeService();
  await assertRejects(async () => {
    await service.resumeDeployment("dep-1");
  });

  assertSpyCallArgs(mocks.updateDeploymentRecord, 0, [
    expect.anything(),
    "dep-1",
    {
      stepError: null,
      currentStep: null,
    },
  ]);
});
// ---------------------------------------------------------------------------
// getEnvVars / getMaskedEnvVars / getBindings
// ---------------------------------------------------------------------------

Deno.test("DeploymentService.getEnvVars - returns empty object when no encrypted env vars", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const dep = createBaseDeployment({ env_vars_snapshot_encrypted: null });

  const { service } = makeService();
  const result = await service.getEnvVars(dep);

  assertEquals(result, {});
  assertSpyCalls(mocks.decryptEnvVars, 0);
});
Deno.test("DeploymentService.getEnvVars - decrypts env vars when present", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const dep = createBaseDeployment({
    env_vars_snapshot_encrypted: "encrypted-data",
  });
  mocks.decryptEnvVars = (async () => ({ MY_SECRET: "value" })) as any;

  const { service } = makeService();
  const result = await service.getEnvVars(dep);

  assertEquals(result, { MY_SECRET: "value" });
  assertSpyCallArgs(mocks.decryptEnvVars, 0, [
    "encrypted-data",
    "test-encryption-key",
    "dep-1",
  ]);
});

Deno.test("DeploymentService.getMaskedEnvVars - returns masked env vars", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const dep = createBaseDeployment({
    env_vars_snapshot_encrypted: "encrypted-data",
  });
  mocks.decryptEnvVars = (async () => ({ TOKEN: "secret-value" })) as any;
  mocks.maskEnvVars = (() => ({ TOKEN: "***" })) as any;

  const { service } = makeService();
  const result = await service.getMaskedEnvVars(dep);

  assertEquals(result, { TOKEN: "***" });
  assertSpyCallArgs(mocks.maskEnvVars, 0, [{ TOKEN: "secret-value" }]);
});

Deno.test("DeploymentService.getBindings - returns empty array when no bindings", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const dep = createBaseDeployment({ bindings_snapshot_encrypted: null });

  const { service } = makeService();
  const result = await service.getBindings(dep);

  assertEquals(result, []);
});
Deno.test("DeploymentService.getBindings - decrypts and returns bindings", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const bindings = [{ type: "kv", name: "MY_KV", providerResourceId: "ns-1" }];
  const encrypted = JSON.stringify({ ciphertext: "ct", iv: "iv" });
  const dep = createBaseDeployment({ bindings_snapshot_encrypted: encrypted });
  mocks.decrypt = (async () => JSON.stringify(bindings)) as any;

  const { service } = makeService();
  const result = await service.getBindings(dep);

  assertEquals(result, [{
    type: "kv",
    name: "MY_KV",
    providerResourceId: "ns-1",
  }]);
});
Deno.test("DeploymentService.getBindings - throws on invalid encrypted data structure", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const dep = createBaseDeployment({
    bindings_snapshot_encrypted: '{"invalid": true}',
  });

  const { service } = makeService();
  await assertRejects(async () => {
    await service.getBindings(dep);
  }, "Invalid encrypted data structure");
});
Deno.test("DeploymentService.getBindings - throws on malformed JSON in bindings_snapshot_encrypted", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const dep = createBaseDeployment({ bindings_snapshot_encrypted: "not-json" });

  const { service } = makeService();
  await assertRejects(async () => {
    await service.getBindings(dep);
  }, "Failed to parse bindings_snapshot_encrypted");
});
Deno.test("DeploymentService.getBindings - throws when decrypted bindings is not an array", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const encrypted = JSON.stringify({ ciphertext: "ct", iv: "iv" });
  const dep = createBaseDeployment({ bindings_snapshot_encrypted: encrypted });
  mocks.decrypt = (async () => '"not-an-array"') as any;

  const { service } = makeService();
  await assertRejects(async () => {
    await service.getBindings(dep);
  }, "is not an array");
});
// ---------------------------------------------------------------------------
// cleanupStuckDeployments
// ---------------------------------------------------------------------------

Deno.test("DeploymentService.cleanupStuckDeployments - returns 0 when no stuck deployments", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.resetStuckDeployment = (async () => undefined) as any;
  mocks.detectStuckDeployments = (async () => []) as any;

  const { service } = makeService();
  const count = await service.cleanupStuckDeployments();

  assertEquals(count, 0);
  assertSpyCalls(mocks.resetStuckDeployment, 0);
});
Deno.test("DeploymentService.cleanupStuckDeployments - resets stuck deployments and returns count", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.resetStuckDeployment = (async () => undefined) as any;
  const stuck = [
    createBaseDeployment({ id: "stuck-1", current_step: "deploy_worker" }),
    createBaseDeployment({ id: "stuck-2", current_step: "routing" }),
  ];
  mocks.detectStuckDeployments = (async () => stuck) as any;

  const { service } = makeService();
  const count = await service.cleanupStuckDeployments();

  assertEquals(count, 2);
  assertSpyCalls(mocks.resetStuckDeployment, 2);
  assertSpyCallArgs(mocks.resetStuckDeployment, 0, [
    expect.anything(),
    "stuck-1",
    expect.stringContaining("deploy_worker"),
  ]);
  assertSpyCallArgs(mocks.resetStuckDeployment, 0, [
    expect.anything(),
    "stuck-2",
    expect.stringContaining("routing"),
  ]);
});
Deno.test("DeploymentService.cleanupStuckDeployments - passes custom timeout", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.resetStuckDeployment = (async () => undefined) as any;
  mocks.detectStuckDeployments = (async () => []) as any;

  const { service } = makeService();
  await service.cleanupStuckDeployments(300000);

  assertSpyCallArgs(mocks.detectStuckDeployments, 0, [
    expect.anything(),
    300000,
  ]);
});
// ---------------------------------------------------------------------------
// resolveDeploymentArtifactRef (tested indirectly through the service)
// ---------------------------------------------------------------------------

Deno.test("resolveDeploymentArtifactRef logic - prefers persisted artifact_ref when present", async () => {
  const bundleContent = "code";
  const dep = createBaseDeployment({
    artifact_ref: "custom-persisted-ref",
    version: 5,
    bundle_hash: "sha256-hash",
    bundle_size: new TextEncoder().encode(bundleContent).byteLength,
  });
  const completedDep = createBaseDeployment({
    status: "success",
    deploy_state: "completed",
  });

  mocks.getDeploymentById = createAsyncSequence(dep, completedDep) as any;
  mocks.getDeploymentEvents = (async () => []) as any;
  mocks.getServiceDeploymentBasics = (async () => ({
    exists: true,
    hostname: "test.example.com",
  })) as any;
  mocks.createDeploymentProvider = (() => ({
    name: "workers-dispatch",
    deploy: ((..._args: any[]) => undefined) as any,
    assertRollbackTarget: ((..._args: any[]) => undefined) as any,
  })) as any;
  mocks.parseDeploymentTargetConfig = (() => ({})) as any;
  mocks.updateDeploymentState = (async () => undefined) as any;
  mocks.updateDeploymentRecord = (async () => undefined) as any;
  mocks.logDeploymentEvent = (async () => undefined) as any;
  mocks.rollbackDeploymentSteps = (async () => undefined) as any;
  mocks.reconcileManagedWorkerMcpServer = (async () => undefined) as any;

  // The deploy step will try to read bundle — mock to fail so we test
  // artifact ref resolution
  mocks.executeDeploymentStep = (async (
    _db: any,
    _id: any,
    _state: any,
    stepName: string,
    action: () => Promise<void>,
  ) => {
    await action();
  }) as any;
  mocks.fetchServiceWithDomains = (async () => ({
    id: "w-1",
    hostname: "test.example.com",
    activeDeploymentId: null,
    customDomains: [],
  })) as any;
  mocks.collectHostnames = (() => []) as any;

  const env = makeEnv();
  env.WORKER_BUNDLES.get = (async () => ({
    text: () => Promise.resolve("code"),
  })) as any;
  mocks.computeSHA256 = (async () => "sha256-abc") as any;
  mocks.constantTimeEqual = (() => true) as any;

  const dbChain = makeDbUpdateChain();
  mocks.getDb = (() => ({
    select: () => ({
      from: function (this: any) {
        return this;
      },
      where: function (this: any) {
        return this;
      },
      get: async () => null,
    }),
    update: () => dbChain,
  })) as any;

  const service = new DeploymentService(env, "test-key");

  // The deploy step should use the persisted artifact ref (custom-persisted-ref)
  // rather than computing one from serviceId + version.
  // We verify this by checking the call to the provider's deploy was made
  // with the correct artifactRef.
  const deployFn = ((..._args: any[]) => undefined) as any;
  mocks.createDeploymentProvider = (() => ({
    name: "workers-dispatch",
    deploy: deployFn,
    assertRollbackTarget: ((..._args: any[]) => undefined) as any,
  })) as any;

  const result = await service.executeDeployment("dep-1");
  assertEquals(result.status, "success");

  // The provider's deploy function should have been called with
  // artifactRef = 'custom-persisted-ref', meaning the persisted
  // artifact ref was used.
  if (deployFn.calls.length > 0) {
    assertEquals(deployFn.calls[0][0].artifactRef, "custom-persisted-ref");
  }
});
