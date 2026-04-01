import {
  assert,
  assertEquals,
  assertObjectMatch,
  assertStringIncludes,
} from "jsr:@std/assert";

function createRecordedMock<T extends (...args: any[]) => any>(impl: T) {
  const fn = ((...args: Parameters<T>) => {
    fn.calls.push({ args });
    return impl(...args);
  }) as T & { calls: Array<{ args: Parameters<T> }> };
  fn.calls = [];
  return fn;
}

const mocks = {
  groupGet: ((..._args: any[]) => undefined) as any,
  listResources: ((..._args: any[]) => undefined) as any,
  createResource: ((..._args: any[]) => undefined) as any,
  updateManagedResource: ((..._args: any[]) => undefined) as any,
  listGroupManagedServices: ((..._args: any[]) => undefined) as any,
  upsertGroupManagedService: ((..._args: any[]) => undefined) as any,
  createDeployment: ((..._args: any[]) => undefined) as any,
  executeDeployment: ((..._args: any[]) => undefined) as any,
  syncGroupManagedDesiredState: (async () => []) as any,
  reconcileGroupRouting: ((..._args: any[]) => undefined) as any,
  groupUpdateRun: ((..._args: any[]) => undefined) as any,
  getDeploymentById: ((..._args: any[]) => undefined) as any,
  getBundleContent: ((..._args: any[]) => undefined) as any,
};

// [Deno] vi.mock removed - manually stub imports from '@/infra/db/client'
// [Deno] vi.mock removed - manually stub imports from '@/services/entities/resource-ops'
// [Deno] vi.mock removed - manually stub imports from '@/services/entities/group-managed-services'
// [Deno] vi.mock removed - manually stub imports from '@/services/entities/worker-ops'
// [Deno] vi.mock removed - manually stub imports from '@/services/entities/container-ops'
// [Deno] vi.mock removed - manually stub imports from '@/services/entities/service-ops'
// [Deno] vi.mock removed - manually stub imports from '@/services/deployment/group-managed-desired-state'
// [Deno] vi.mock removed - manually stub imports from '@/services/deployment/service'
// [Deno] vi.mock removed - manually stub imports from '@/services/deployment/store'
// [Deno] vi.mock removed - manually stub imports from '@/services/deployment/artifact-io'
// [Deno] vi.mock removed - manually stub imports from '@/services/deployment/group-routing'
import {
  applyManifest,
  getGroupState,
  planManifest,
  applyEngineDeps,
} from "@/services/deployment/apply-engine";

function createFakeDb() {
  return {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                get: async () => mocks.groupGet(),
              };
            },
          };
        },
      };
    },
    update() {
      return {
        set() {
          return {
            where() {
              return {
                run: async () => ({ success: true, meta: {} }),
              };
            },
          };
        },
      };
    },
  };
}

function installApplyEngineDeps() {
  applyEngineDeps.getDb = () => createFakeDb() as never;
  applyEngineDeps.listResources = (...args: Parameters<typeof mocks.listResources>) =>
    mocks.listResources(...args);
  applyEngineDeps.createResource = (...args: Parameters<typeof mocks.createResource>) =>
    mocks.createResource(...args);
  applyEngineDeps.updateManagedResource = (
    ...args: Parameters<typeof mocks.updateManagedResource>
  ) => mocks.updateManagedResource(...args);
  applyEngineDeps.deleteResource = (...args: Parameters<typeof mocks.createResource>) =>
    mocks.createResource(...args);
  applyEngineDeps.deleteWorker = (...args: Parameters<typeof mocks.createResource>) =>
    mocks.createResource(...args);
  applyEngineDeps.deleteContainer = (...args: Parameters<typeof mocks.createResource>) =>
    mocks.createResource(...args);
  applyEngineDeps.deleteService = (...args: Parameters<typeof mocks.createResource>) =>
    mocks.createResource(...args);
  applyEngineDeps.listGroupManagedServices = (
    ...args: Parameters<typeof mocks.listGroupManagedServices>
  ) => mocks.listGroupManagedServices(...args);
  applyEngineDeps.upsertGroupManagedService = (
    ...args: Parameters<typeof mocks.upsertGroupManagedService>
  ) => mocks.upsertGroupManagedService(...args);
  applyEngineDeps.getDeploymentById = (...args: Parameters<typeof mocks.getDeploymentById>) =>
    mocks.getDeploymentById(...args);
  applyEngineDeps.getBundleContent = (...args: Parameters<typeof mocks.getBundleContent>) =>
    mocks.getBundleContent(...args);
  applyEngineDeps.syncGroupManagedDesiredState = (
    ...args: Parameters<typeof mocks.syncGroupManagedDesiredState>
  ) => mocks.syncGroupManagedDesiredState(...args);
  applyEngineDeps.reconcileGroupRouting = (
    ...args: Parameters<typeof mocks.reconcileGroupRouting>
  ) => mocks.reconcileGroupRouting(...args);
  applyEngineDeps.DeploymentService = class {
    constructor(_env: unknown) {}
    createDeployment(...args: Parameters<typeof mocks.createDeployment>) {
      return mocks.createDeployment(...args);
    }
    executeDeployment(...args: Parameters<typeof mocks.executeDeployment>) {
      return mocks.executeDeployment(...args);
    }
  } as never;
}

installApplyEngineDeps();

function makeManifest() {
  return {
    apiVersion: "takos.dev/v1alpha1",
    kind: "App",
    metadata: { name: "demo-app" },
    spec: {
      version: "1.0.0",
      workers: {
        api: {
          build: {
            fromWorkflow: {
              path: ".github/workflows/deploy.yml",
              job: "build",
              artifact: "worker",
              artifactPath: "dist/worker.js",
            },
          },
        },
      },
      routes: [
        { name: "api-route", target: "api", path: "/api" },
      ],
    },
  };
}

Deno.test("group apply engine - plans against canonical group resources/services state", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.reconcileGroupRouting = createRecordedMock(async () => ({
    routes: {},
    failedRoutes: [],
  })) as any;
  mocks.groupUpdateRun = createRecordedMock(async () => undefined) as any;
  mocks.createResource = createRecordedMock(async () => undefined) as any;
  mocks.updateManagedResource = createRecordedMock(async () =>
    undefined
  ) as any;
  const desiredSpecJson = JSON.stringify(makeManifest());

  mocks.groupGet = createRecordedMock(async () => ({
    id: "group-1",
    spaceId: "ws-1",
    name: "demo-app",
    provider: "cloudflare",
    env: "production",
    appVersion: "1.0.0",
    desiredSpecJson,
    providerStateJson: "{}",
    reconcileStatus: "ready",
    lastAppliedAt: "2026-03-29T00:00:00.000Z",
    createdAt: "2026-03-29T00:00:00.000Z",
    updatedAt: "2026-03-29T00:00:00.000Z",
  })) as any;
  mocks.listResources = (async () => []) as any;
  mocks.listGroupManagedServices = (async () => [
    {
      row: {
        id: "svc-api",
        accountId: "ws-1",
        groupId: "group-1",
        serviceType: "app",
        nameType: null,
        status: "deployed",
        config: "{}",
        hostname: "grp-group-1-production-worker-api.example.test",
        routeRef: "grp-group-1-production-worker-api",
        slug: "grp-group-1-production-worker-api",
        activeDeploymentId: null,
        fallbackDeploymentId: null,
        currentVersion: 0,
        workloadKind: "worker-bundle",
        createdAt: "2026-03-29T00:00:00.000Z",
        updatedAt: "2026-03-29T00:00:00.000Z",
      },
      config: {
        managedBy: "group",
        manifestName: "api",
        componentKind: "worker",
        sourceKind: "worker",
        executionProfile: "workers",
        artifactKind: "worker-bundle",
        specFingerprint: JSON.stringify({
          build: {
            fromWorkflow: {
              artifact: "worker",
              artifactPath: "dist/worker.js",
              job: "build",
              path: ".github/workflows/deploy.yml",
            },
          },
        }),
        deployedAt: "2026-03-29T00:00:00.000Z",
      },
    },
  ]) as any;

  const result = await planManifest(
    { DB: {} as never } as never,
    "group-1",
    makeManifest() as never,
  );

  assertEquals(result.diff.hasChanges, false);
  assertEquals(result.diff.summary, {
    create: 0,
    update: 0,
    delete: 0,
    unchanged: 2,
  });
  assertEquals(result.translationReport.provider, "cloudflare");
  assertEquals(result.translationReport.resources, []);
  assertEquals(result.translationReport.workloads, [
    {
      name: "api",
      category: "worker",
      provider: "workers-dispatch",
      runtime: "workers",
      runtimeProfile: "workers",
      status: "native",
      requirements: ["CF_ACCOUNT_ID", "CF_API_TOKEN", "WFP_DISPATCH_NAMESPACE"],
      notes: ["Takos runtime realizes worker workloads directly on the Cloudflare backend."],
    },
  ]);
});
Deno.test("group apply engine - derives observed routes from desiredSpecJson instead of stored observedStateJson", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.reconcileGroupRouting = createRecordedMock(async () => ({
    routes: {},
    failedRoutes: [],
  })) as any;
  mocks.groupUpdateRun = createRecordedMock(async () => undefined) as any;
  mocks.createResource = createRecordedMock(async () => undefined) as any;
  mocks.updateManagedResource = createRecordedMock(async () =>
    undefined
  ) as any;
  mocks.groupGet = createRecordedMock(async () => ({
    id: "group-1",
    spaceId: "ws-1",
    name: "demo-app",
    provider: "cloudflare",
    env: "production",
    appVersion: "1.0.0",
    desiredSpecJson: JSON.stringify(makeManifest()),
    providerStateJson: "{}",
    reconcileStatus: "ready",
    lastAppliedAt: "2026-03-29T00:00:00.000Z",
    createdAt: "2026-03-29T00:00:00.000Z",
    updatedAt: "2026-03-29T00:00:00.000Z",
  })) as any;
  mocks.listResources = createRecordedMock(async () => []) as any;
  mocks.listGroupManagedServices = createRecordedMock(async () => [
    {
      row: {
        id: "svc-api",
        accountId: "ws-1",
        groupId: "group-1",
        serviceType: "app",
        nameType: null,
        status: "deployed",
        config: "{}",
        hostname: "grp-group-1-production-worker-api.example.test",
        routeRef: "grp-group-1-production-worker-api",
        slug: "grp-group-1-production-worker-api",
        activeDeploymentId: null,
        fallbackDeploymentId: null,
        currentVersion: 0,
        workloadKind: "worker-bundle",
        createdAt: "2026-03-29T00:00:00.000Z",
        updatedAt: "2026-03-29T00:00:00.000Z",
      },
      config: {
        managedBy: "group",
        manifestName: "api",
        componentKind: "worker",
        sourceKind: "worker",
        executionProfile: "workers",
        artifactKind: "worker-bundle",
        specFingerprint: JSON.stringify(makeManifest().spec.workers.api),
      },
    },
  ]) as any;

  const state = await getGroupState({ DB: {} as never } as never, "group-1");

  assertObjectMatch(state!.routes["api-route"], {
    path: "/api",
    url: "https://grp-group-1-production-worker-api.example.test/api",
  });
  assertStringIncludes(state!.routes["api-route"]!.url ?? "", "/api");
});
Deno.test("group apply engine - applies worker workloads through deployment service and routing reconcile", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.reconcileGroupRouting = createRecordedMock(async () => ({
    routes: {},
    failedRoutes: [],
  })) as any;
  mocks.groupUpdateRun = createRecordedMock(async () => undefined) as any;
  mocks.createResource = createRecordedMock(async () => undefined) as any;
  mocks.updateManagedResource = createRecordedMock(async () =>
    undefined
  ) as any;
  const manifest = makeManifest();
  mocks.groupGet = createRecordedMock(async () => ({
    id: "group-1",
    spaceId: "ws-1",
    name: "demo-app",
    provider: "cloudflare",
    env: "production",
    appVersion: "1.0.0",
    desiredSpecJson: JSON.stringify(manifest),
    providerStateJson: "{}",
    reconcileStatus: "ready",
    lastAppliedAt: "2026-03-29T00:00:00.000Z",
    createdAt: "2026-03-29T00:00:00.000Z",
    updatedAt: "2026-03-29T00:00:00.000Z",
  })) as any;
  mocks.listResources = createRecordedMock(async () => []) as any;
  mocks.listGroupManagedServices = createRecordedMock(async () => [
    {
      row: {
        id: "svc-api",
        accountId: "ws-1",
        groupId: "group-1",
        serviceType: "app",
        nameType: null,
        status: "pending",
        config: "{}",
        hostname: "grp-group-1-production-worker-api.example.test",
        routeRef: "grp-group-1-production-worker-api",
        slug: "grp-group-1-production-worker-api",
        activeDeploymentId: null,
        fallbackDeploymentId: null,
        currentVersion: 0,
        workloadKind: "worker-bundle",
        createdAt: "2026-03-29T00:00:00.000Z",
        updatedAt: "2026-03-29T00:00:00.000Z",
      },
      config: {
        managedBy: "group",
        manifestName: "api",
        componentKind: "worker",
        specFingerprint: JSON.stringify(manifest.spec.workers?.api),
      },
    },
  ]) as any;
  mocks.upsertGroupManagedService = createRecordedMock(async () => ({
    row: {
      id: "svc-api",
      accountId: "ws-1",
      groupId: "group-1",
      serviceType: "app",
      nameType: null,
      status: "pending",
      config: "{}",
      hostname: "grp-group-1-production-worker-api.example.test",
      routeRef: "grp-group-1-production-worker-api",
      slug: "grp-group-1-production-worker-api",
      activeDeploymentId: null,
      fallbackDeploymentId: null,
      currentVersion: 0,
      workloadKind: "worker-bundle",
      createdAt: "2026-03-29T00:00:00.000Z",
      updatedAt: "2026-03-29T00:00:00.000Z",
    },
    config: {
      managedBy: "group",
      manifestName: "api",
      componentKind: "worker",
      specFingerprint: JSON.stringify(manifest.spec.workers?.api),
    },
  })) as any;
  mocks.createDeployment = createRecordedMock(async () => ({
    id: "dep-1",
  })) as any;
  mocks.executeDeployment = createRecordedMock(async () => ({
    id: "dep-1",
    completed_at: "2026-03-29T00:00:01.000Z",
    provider_state_json: "{}",
    bundle_hash: "sha256:demo",
  })) as any;

  const result = await applyManifest(
    { DB: {} as never } as never,
    "group-1",
    manifest as never,
    {
      artifacts: {
        api: {
          kind: "worker-bundle",
          bundleContent: "export default {}",
        },
      },
    },
  );

  const createDeploymentArgs = mocks.createDeployment.calls[0]
    .args[0] as Record<string, unknown>;
  assertEquals(createDeploymentArgs.serviceId, "svc-api");
  assertEquals(createDeploymentArgs.artifactKind, "worker-bundle");
  assertEquals(
    (createDeploymentArgs.provider as { name?: string }).name,
    "workers-dispatch",
  );
  assertEquals(mocks.executeDeployment.calls[0].args[0], "dep-1");
  assert(mocks.reconcileGroupRouting.calls.length > 0);
  assertEquals(result.applied.length, 1);
  assertEquals(result.applied[0].name, "api");
  assertEquals(result.applied[0].category, "worker");
  assertEquals(result.applied[0].status, "success");
});
Deno.test("group apply engine - resolves worker bundle artifacts from desired manifest direct-artifact references", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.reconcileGroupRouting = createRecordedMock(async () => ({
    routes: {},
    failedRoutes: [],
  })) as any;
  mocks.groupUpdateRun = createRecordedMock(async () => undefined) as any;
  mocks.createResource = createRecordedMock(async () => undefined) as any;
  mocks.updateManagedResource = createRecordedMock(async () =>
    undefined
  ) as any;
  const manifest = {
    ...makeManifest(),
    spec: {
      ...makeManifest().spec,
      workers: {
        api: {
          artifact: {
            kind: "bundle",
            deploymentId: "dep-source",
            artifactRef: "worker-api-v7",
          },
        },
      },
    },
  };

  mocks.groupGet = createRecordedMock(async () => ({
    id: "group-1",
    spaceId: "ws-1",
    name: "demo-app",
    provider: "cloudflare",
    env: "production",
    appVersion: "1.0.0",
    desiredSpecJson: JSON.stringify(manifest),
    providerStateJson: "{}",
    reconcileStatus: "ready",
    lastAppliedAt: "2026-03-29T00:00:00.000Z",
    createdAt: "2026-03-29T00:00:00.000Z",
    updatedAt: "2026-03-29T00:00:00.000Z",
  })) as any;
  mocks.listResources = createRecordedMock(async () => []) as any;
  mocks.listGroupManagedServices = createRecordedMock(async () => []) as any;
  mocks.upsertGroupManagedService = createRecordedMock(async () => ({
    row: {
      id: "svc-api",
      routeRef: "grp-api",
      updatedAt: "2026-03-29T00:00:00.000Z",
    },
    config: {},
  })) as any;
  mocks.getDeploymentById = createRecordedMock(async () => ({
    id: "dep-source",
    bundle_r2_key: "deployments/svc-api/7/bundle.js",
    bundle_hash: null,
    bundle_size: null,
  })) as any;
  mocks.getBundleContent = createRecordedMock(async () =>
    'export default { fetch() { return new Response("ok"); } };'
  ) as any;
  mocks.createDeployment = createRecordedMock(async () => ({
    id: "dep-2",
    version: 2,
    status: "pending",
    deploy_state: "pending",
    artifact_kind: "worker-bundle",
    routing_status: "active",
    routing_weight: 100,
    created_at: "2026-03-29T00:00:00.000Z",
  })) as any;
  mocks.executeDeployment = createRecordedMock(async () => ({
    provider_state_json: "{}",
    completed_at: "2026-03-29T00:00:00.000Z",
    bundle_hash: "sha256-123",
  })) as any;

  await applyManifest(
    { DB: {} as never, WORKER_BUNDLES: {} as never } as never,
    "group-1",
  );

  assertEquals(mocks.getDeploymentById.calls[0].args[1], "dep-source");
  assert(mocks.getBundleContent.calls.length > 0);
  assertStringIncludes(
    mocks.createDeployment.calls[0].args[0].bundleContent as string,
    "export default",
  );
});
Deno.test("group apply engine - passes canonical resource specs into resource creation", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.reconcileGroupRouting =
    (async () => ({ routes: {}, failedRoutes: [] })) as any;
  mocks.groupUpdateRun = (async () => undefined) as any;
  mocks.createResource = createRecordedMock(async () => undefined) as any;
  mocks.updateManagedResource = (async () => undefined) as any;
  const manifest = {
    apiVersion: "takos.dev/v1alpha1",
    kind: "App",
    metadata: { name: "demo-app" },
    spec: {
      version: "1.0.0",
      resources: {
        events: {
          type: "analyticsEngine",
          binding: "EVENTS",
          analyticsEngine: {
            dataset: "tenant-events",
          },
        },
      },
    },
  };

  mocks.groupGet = (async () => ({
    id: "group-1",
    spaceId: "ws-1",
    name: "demo-app",
    provider: "cloudflare",
    env: "production",
    appVersion: "1.0.0",
    desiredSpecJson: JSON.stringify(manifest),
    providerStateJson: "{}",
    reconcileStatus: "ready",
    lastAppliedAt: "2026-03-29T00:00:00.000Z",
    createdAt: "2026-03-29T00:00:00.000Z",
    updatedAt: "2026-03-29T00:00:00.000Z",
  })) as any;
  mocks.listResources = createRecordedMock(async () => []) as any;
  mocks.listGroupManagedServices = createRecordedMock(async () => []) as any;

  await applyManifest(
    { DB: {} as never } as never,
    "group-1",
    manifest as never,
  );

  const createResourceArgs = mocks.createResource.calls[0].args;
  assert(createResourceArgs[0] !== undefined);
  assertEquals(createResourceArgs[1], "group-1");
  assertEquals(createResourceArgs[2], "events");
  assertObjectMatch(createResourceArgs[3] as Record<string, unknown>, {
    type: "analyticsEngine",
    spec: manifest.spec.resources.events,
  });
});
