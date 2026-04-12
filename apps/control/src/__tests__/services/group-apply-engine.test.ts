import {
  assert,
  assertEquals,
  assertObjectMatch,
  assertRejects,
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
  assertTranslationSupported: ((..._args: any[]) => undefined) as any,
  groupUpdateRun: ((..._args: any[]) => undefined) as any,
  getDeploymentById: ((..._args: any[]) => undefined) as any,
  findDeploymentByArtifactRef: ((..._args: any[]) => undefined) as any,
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
  applyEngineDeps,
  applyManifest,
  getGroupState,
  planManifest,
} from "@/services/deployment/apply-engine";
import { stableFingerprint } from "@/services/deployment/group-state";
import type { AppManifest } from "@/application/services/source/app-manifest-types.ts";

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
  applyEngineDeps.listResources = (
    ...args: Parameters<typeof mocks.listResources>
  ) => mocks.listResources(...args);
  applyEngineDeps.createResource = (
    ...args: Parameters<typeof mocks.createResource>
  ) => mocks.createResource(...args);
  applyEngineDeps.updateManagedResource = (
    ...args: Parameters<typeof mocks.updateManagedResource>
  ) => mocks.updateManagedResource(...args);
  applyEngineDeps.deleteResource = (
    ...args: Parameters<typeof mocks.createResource>
  ) => mocks.createResource(...args);
  applyEngineDeps.deleteWorker = (
    ...args: Parameters<typeof mocks.createResource>
  ) => mocks.createResource(...args);
  applyEngineDeps.deleteContainer = (
    ...args: Parameters<typeof mocks.createResource>
  ) => mocks.createResource(...args);
  applyEngineDeps.deleteService = (
    ...args: Parameters<typeof mocks.createResource>
  ) => mocks.createResource(...args);
  applyEngineDeps.listGroupManagedServices = (
    ...args: Parameters<typeof mocks.listGroupManagedServices>
  ) => mocks.listGroupManagedServices(...args);
  applyEngineDeps.upsertGroupManagedService = (
    ...args: Parameters<typeof mocks.upsertGroupManagedService>
  ) => mocks.upsertGroupManagedService(...args);
  applyEngineDeps.getDeploymentById = (
    ...args: Parameters<typeof mocks.getDeploymentById>
  ) => mocks.getDeploymentById(...args);
  applyEngineDeps.findDeploymentByArtifactRef = (
    ...args: Parameters<typeof mocks.findDeploymentByArtifactRef>
  ) => mocks.findDeploymentByArtifactRef(...args);
  applyEngineDeps.getBundleContent = (
    ...args: Parameters<typeof mocks.getBundleContent>
  ) => mocks.getBundleContent(...args);
  applyEngineDeps.syncGroupManagedDesiredState = (
    ...args: Parameters<typeof mocks.syncGroupManagedDesiredState>
  ) => mocks.syncGroupManagedDesiredState(...args);
  applyEngineDeps.reconcileGroupRouting = (
    ...args: Parameters<typeof mocks.reconcileGroupRouting>
  ) => mocks.reconcileGroupRouting(...args);
  applyEngineDeps.assertTranslationSupported = (
    ...args: Parameters<typeof mocks.assertTranslationSupported>
  ) => mocks.assertTranslationSupported(...args);
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

function makeManifest(): AppManifest {
  return {
    name: "demo-app",
    version: "1.0.0",
    compute: {
      api: {
        kind: "worker",
        build: {
          fromWorkflow: {
            path: ".takos/workflows/deploy.yml",
            job: "build",
            artifact: "worker",
            artifactPath: "dist/worker.js",
          },
        },
      },
    },
    routes: [
      { target: "api", path: "/api" },
    ],
    publish: [],
    env: {},
  };
}

function makeManagedWorkerRecord(
  options: {
    name?: string;
    status?: string;
    specFingerprint?: string;
    hostname?: string;
    routeRef?: string;
  } = {},
) {
  const manifest = makeManifest();
  const name = options.name ?? "api";
  const hostname = options.hostname ??
    `grp-group-1-production-worker-${name}.example.test`;
  const routeRef = options.routeRef ?? `grp-group-1-production-worker-${name}`;
  return {
    row: {
      id: `svc-${name}`,
      accountId: "ws-1",
      groupId: "group-1",
      serviceType: "app",
      nameType: null,
      status: options.status ?? "deployed",
      config: "{}",
      hostname,
      routeRef,
      slug: routeRef,
      activeDeploymentId: null,
      fallbackDeploymentId: null,
      currentVersion: 0,
      workloadKind: "worker-bundle",
      createdAt: "2026-03-29T00:00:00.000Z",
      updatedAt: "2026-03-29T00:00:00.000Z",
    },
    config: {
      managedBy: "group",
      manifestName: name,
      componentKind: "worker",
      sourceKind: "worker",
      executionProfile: "workers",
      artifactKind: "worker-bundle",
      specFingerprint: options.specFingerprint ??
        stableFingerprint(manifest.compute.api),
      deployedAt: "2026-03-29T00:00:00.000Z",
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
        specFingerprint: stableFingerprint(makeManifest().compute.api),
        deployedAt: "2026-03-29T00:00:00.000Z",
      },
    },
  ]) as any;

  const result = await planManifest(
    { DB: {} as never } as never,
    "group-1",
    makeManifest(),
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
      notes: [
        "Takos runtime realizes worker workloads directly on the Cloudflare backend.",
      ],
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
        specFingerprint: stableFingerprint(makeManifest().compute.api),
      },
    },
  ]) as any;

  const state = await getGroupState({ DB: {} as never } as never, "group-1");

  assertObjectMatch(state!.routes["api:/api"], {
    path: "/api",
    url: "https://grp-group-1-production-worker-api.example.test/api",
  });
  assertStringIncludes(state!.routes["api:/api"]!.url ?? "", "/api");
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
        // Intentionally stale so the diff flags the worker as needing update.
        specFingerprint: "stale-worker-fingerprint",
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
      specFingerprint: stableFingerprint(manifest.compute.api),
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
    manifest,
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

Deno.test("group apply engine - reasserts translation support on the mutating apply path", async () => {
  const manifest = makeManifest();
  mocks.assertTranslationSupported = createRecordedMock(async () =>
    undefined
  ) as any;
  mocks.reconcileGroupRouting = createRecordedMock(async () => ({
    routes: {},
    failedRoutes: [],
  })) as any;
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
    desiredSpecJson: JSON.stringify(manifest),
    providerStateJson: "{}",
    reconcileStatus: "ready",
    lastAppliedAt: "2026-03-29T00:00:00.000Z",
    createdAt: "2026-03-29T00:00:00.000Z",
    updatedAt: "2026-03-29T00:00:00.000Z",
  })) as any;
  mocks.listResources = createRecordedMock(async () => []) as any;
  mocks.listGroupManagedServices = createRecordedMock(async () => [
    makeManagedWorkerRecord({
      status: "pending",
      specFingerprint: "stale-worker-fingerprint",
    }),
  ]) as any;
  mocks.upsertGroupManagedService = createRecordedMock(async () =>
    makeManagedWorkerRecord({
      status: "pending",
      specFingerprint: stableFingerprint(manifest.compute.api),
    })
  ) as any;
  mocks.syncGroupManagedDesiredState = createRecordedMock(
    async () => [],
  ) as any;
  mocks.createDeployment = createRecordedMock(async () => ({
    id: "dep-1",
  })) as any;
  mocks.executeDeployment = createRecordedMock(async () => ({
    id: "dep-1",
    completed_at: "2026-03-29T00:00:01.000Z",
    provider_state_json: "{}",
    bundle_hash: "sha256:demo",
  })) as any;

  await applyManifest(
    { DB: {} as never } as never,
    "group-1",
    manifest,
    {
      artifacts: {
        api: {
          kind: "worker-bundle",
          bundleContent: "export default {}",
        },
      },
    },
  );

  assertEquals(mocks.assertTranslationSupported.calls.length, 1);
});

Deno.test("group apply engine - planManifest runs deploy validation before returning", async () => {
  const manifest = makeManifest();
  manifest.routes.push({ target: "api", path: "/" });
  manifest.routes.push({ target: "api", path: "/" });
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
    makeManagedWorkerRecord({
      status: "pending",
      specFingerprint: stableFingerprint(manifest.compute.api),
    }),
  ]) as any;

  await assertRejects(
    () =>
      planManifest(
        { DB: {} as never } as never,
        "group-1",
        manifest,
      ),
    Error,
    "Deploy validation failed",
  );
});

Deno.test("group apply engine - syncs managed desired state once for multi-workload deploy", async () => {
  const manifest = makeManifest();
  manifest.compute.admin = {
    ...manifest.compute.api,
    build: {
      fromWorkflow: {
        path: ".takos/workflows/deploy.yml",
        job: "build-admin",
        artifact: "admin-worker",
        artifactPath: "dist/admin.js",
      },
    },
  };
  mocks.reconcileGroupRouting = createRecordedMock(async () => ({
    routes: {},
    failedRoutes: [],
  })) as any;
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
    desiredSpecJson: JSON.stringify(manifest),
    providerStateJson: "{}",
    reconcileStatus: "ready",
    lastAppliedAt: "2026-03-29T00:00:00.000Z",
    createdAt: "2026-03-29T00:00:00.000Z",
    updatedAt: "2026-03-29T00:00:00.000Z",
  })) as any;
  mocks.listResources = createRecordedMock(async () => []) as any;
  mocks.listGroupManagedServices = createRecordedMock(async () => [
    makeManagedWorkerRecord({
      name: "api",
      status: "pending",
      specFingerprint: "stale-api-fingerprint",
    }),
    makeManagedWorkerRecord({
      name: "admin",
      status: "pending",
      specFingerprint: "stale-admin-fingerprint",
    }),
  ]) as any;
  mocks.upsertGroupManagedService = createRecordedMock(
    async (_env: unknown, input: { manifestName: string }) =>
      makeManagedWorkerRecord({
        name: input.manifestName,
        status: "pending",
      }),
  ) as any;
  mocks.syncGroupManagedDesiredState = createRecordedMock(
    async () => [],
  ) as any;
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
    manifest,
    {
      artifacts: {
        api: {
          kind: "worker-bundle",
          bundleContent: "export default {}",
        },
        admin: {
          kind: "worker-bundle",
          bundleContent: "export default {}",
        },
      },
    },
  );

  assertEquals(mocks.createDeployment.calls.length, 2);
  assertEquals(mocks.executeDeployment.calls.length, 2);
  assertEquals(mocks.syncGroupManagedDesiredState.calls.length, 1);
  assertEquals(
    result.applied.filter((entry: { category: string }) =>
      entry.category === "worker"
    ).length,
    2,
  );
});

Deno.test("group apply engine - does not reconcile routes after workload deployment failure", async () => {
  const manifest = makeManifest();
  mocks.reconcileGroupRouting = createRecordedMock(async () => ({
    routes: {},
    failedRoutes: [],
  })) as any;
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
    desiredSpecJson: JSON.stringify(manifest),
    providerStateJson: "{}",
    reconcileStatus: "ready",
    lastAppliedAt: "2026-03-29T00:00:00.000Z",
    createdAt: "2026-03-29T00:00:00.000Z",
    updatedAt: "2026-03-29T00:00:00.000Z",
  })) as any;
  mocks.listResources = createRecordedMock(async () => []) as any;
  mocks.listGroupManagedServices = createRecordedMock(async () => [
    makeManagedWorkerRecord({
      status: "pending",
      specFingerprint: "stale-worker-fingerprint",
    }),
  ]) as any;
  mocks.upsertGroupManagedService = createRecordedMock(async () =>
    makeManagedWorkerRecord({
      status: "pending",
      specFingerprint: stableFingerprint(manifest.compute.api),
    })
  ) as any;
  mocks.syncGroupManagedDesiredState = createRecordedMock(
    async () => [],
  ) as any;
  mocks.createDeployment = createRecordedMock(async () => ({
    id: "dep-1",
  })) as any;
  mocks.executeDeployment = createRecordedMock(async () => {
    throw new Error("provider deploy failed");
  }) as any;

  const result = await applyManifest(
    { DB: {} as never } as never,
    "group-1",
    manifest,
    {
      artifacts: {
        api: {
          kind: "worker-bundle",
          bundleContent: "export default {}",
        },
      },
    },
  );

  assertEquals(result.applied.length, 1);
  assertEquals(result.applied[0].status, "failed");
  assertStringIncludes(result.applied[0].error ?? "", "provider deploy failed");
  assertEquals(mocks.syncGroupManagedDesiredState.calls.length, 0);
  assertEquals(mocks.reconcileGroupRouting.calls.length, 0);
});

Deno.test("group apply engine - applies portable worker workloads through runtime-host outside Cloudflare", async () => {
  const manifest = makeManifest();
  mocks.reconcileGroupRouting = createRecordedMock(async () => ({
    routes: {},
    failedRoutes: [],
  })) as any;
  mocks.createResource = createRecordedMock(async () => undefined) as any;
  mocks.updateManagedResource = createRecordedMock(async () =>
    undefined
  ) as any;
  mocks.groupGet = createRecordedMock(async () => ({
    id: "group-1",
    spaceId: "ws-1",
    name: "demo-app",
    provider: "local",
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
    makeManagedWorkerRecord({
      status: "pending",
      specFingerprint: "stale-worker-fingerprint",
    }),
  ]) as any;
  mocks.upsertGroupManagedService = createRecordedMock(async () =>
    makeManagedWorkerRecord({
      status: "pending",
      specFingerprint: stableFingerprint(manifest.compute.api),
    })
  ) as any;
  mocks.syncGroupManagedDesiredState = createRecordedMock(
    async () => [],
  ) as any;
  mocks.createDeployment = createRecordedMock(async () => ({
    id: "dep-1",
  })) as any;
  mocks.executeDeployment = createRecordedMock(async () => ({
    id: "dep-1",
    completed_at: "2026-03-29T00:00:01.000Z",
    provider_state_json: "{}",
    bundle_hash: "sha256:demo",
  })) as any;

  await applyManifest(
    { DB: {} as never } as never,
    "group-1",
    manifest,
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
  assertEquals(
    (createDeploymentArgs.provider as { name?: string }).name,
    "runtime-host",
  );
});

Deno.test("group apply engine - syncs manifest env and publications when workload diff is unchanged", async () => {
  const previousManifest = makeManifest();
  const manifest: AppManifest = {
    ...previousManifest,
    env: { GLOBAL_MODE: "prod" },
    publish: [{ name: "browser", type: "McpServer", path: "/api" }],
  };
  mocks.reconcileGroupRouting = createRecordedMock(async () => ({
    routes: {},
    failedRoutes: [],
  })) as any;
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
    desiredSpecJson: JSON.stringify(previousManifest),
    providerStateJson: "{}",
    reconcileStatus: "ready",
    lastAppliedAt: "2026-03-29T00:00:00.000Z",
    createdAt: "2026-03-29T00:00:00.000Z",
    updatedAt: "2026-03-29T00:00:00.000Z",
  })) as any;
  mocks.listResources = createRecordedMock(async () => []) as any;
  mocks.listGroupManagedServices = createRecordedMock(async () => [
    makeManagedWorkerRecord({
      specFingerprint: stableFingerprint(manifest.compute.api),
    }),
  ]) as any;
  mocks.upsertGroupManagedService = createRecordedMock(async () =>
    makeManagedWorkerRecord()
  ) as any;
  mocks.syncGroupManagedDesiredState = createRecordedMock(
    async () => [],
  ) as any;
  mocks.createDeployment = createRecordedMock(async () => ({
    id: "dep-1",
  })) as any;
  mocks.executeDeployment = createRecordedMock(async () => ({
    id: "dep-1",
  })) as any;

  const result = await applyManifest(
    { DB: {} as never } as never,
    "group-1",
    manifest,
  );

  assertEquals(result.diff.hasChanges, false);
  assertEquals(mocks.createDeployment.calls.length, 0);
  assertEquals(mocks.syncGroupManagedDesiredState.calls.length, 1);
  const syncInput = mocks.syncGroupManagedDesiredState.calls[0]
    .args[1] as { desiredState: { manifest: AppManifest } };
  assertEquals(syncInput.desiredState.manifest.env, { GLOBAL_MODE: "prod" });
  assertEquals(syncInput.desiredState.manifest.publish, manifest.publish);
});

Deno.test("group apply engine - does not reconcile routes after managed-state sync failure", async () => {
  const previousManifest = makeManifest();
  const manifest: AppManifest = {
    ...previousManifest,
    env: { GLOBAL_MODE: "prod" },
  };
  mocks.reconcileGroupRouting = createRecordedMock(async () => ({
    routes: {},
    failedRoutes: [],
  })) as any;
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
    desiredSpecJson: JSON.stringify(previousManifest),
    providerStateJson: "{}",
    reconcileStatus: "ready",
    lastAppliedAt: "2026-03-29T00:00:00.000Z",
    createdAt: "2026-03-29T00:00:00.000Z",
    updatedAt: "2026-03-29T00:00:00.000Z",
  })) as any;
  mocks.listResources = createRecordedMock(async () => []) as any;
  mocks.listGroupManagedServices = createRecordedMock(async () => [
    makeManagedWorkerRecord({
      specFingerprint: stableFingerprint(manifest.compute.api),
    }),
  ]) as any;
  mocks.upsertGroupManagedService = createRecordedMock(async () =>
    makeManagedWorkerRecord()
  ) as any;
  mocks.syncGroupManagedDesiredState = createRecordedMock(
    async () => [{ name: "api", error: "consume sync failed" }],
  ) as any;
  mocks.createDeployment = createRecordedMock(async () => ({
    id: "dep-1",
  })) as any;
  mocks.executeDeployment = createRecordedMock(async () => ({
    id: "dep-1",
  })) as any;

  const result = await applyManifest(
    { DB: {} as never } as never,
    "group-1",
    manifest,
  );

  assertEquals(result.applied.length, 1);
  assertEquals(result.applied[0], {
    name: "api",
    category: "managed-state",
    action: "update",
    status: "failed",
    error: "consume sync failed",
  });
  assertEquals(mocks.createDeployment.calls.length, 0);
  assertEquals(mocks.reconcileGroupRouting.calls.length, 0);
});

Deno.test("group apply engine - passes service healthCheck path to deployment target", async () => {
  const imageRef = `ghcr.io/acme/api@sha256:${"a".repeat(64)}`;
  const manifest: AppManifest = {
    name: "demo-app",
    version: "1.0.0",
    compute: {
      api: {
        kind: "service",
        image: imageRef,
        port: 8080,
        healthCheck: {
          path: "/readyz",
          interval: 15,
          timeout: 3,
          unhealthyThreshold: 2,
        },
      },
    },
    routes: [],
    publish: [],
    env: {},
  };
  const managedRecord = {
    row: {
      id: "svc-api",
      accountId: "ws-1",
      groupId: "group-1",
      serviceType: "service",
      nameType: null,
      status: "pending",
      config: "{}",
      hostname: "grp-group-1-production-service-api.example.test",
      routeRef: null,
      slug: "grp-group-1-production-service-api",
      activeDeploymentId: null,
      fallbackDeploymentId: null,
      currentVersion: 0,
      workloadKind: "container-image",
      createdAt: "2026-03-29T00:00:00.000Z",
      updatedAt: "2026-03-29T00:00:00.000Z",
    },
    config: {
      managedBy: "group",
      manifestName: "api",
      componentKind: "service",
      sourceKind: "service",
      executionProfile: "services",
      artifactKind: "container-image",
      specFingerprint: stableFingerprint(manifest.compute.api),
    },
  };
  mocks.reconcileGroupRouting = createRecordedMock(async () => ({
    routes: {},
    failedRoutes: [],
  })) as any;
  mocks.createResource = createRecordedMock(async () => undefined) as any;
  mocks.updateManagedResource = createRecordedMock(async () =>
    undefined
  ) as any;
  mocks.groupGet = createRecordedMock(async () => ({
    id: "group-1",
    spaceId: "ws-1",
    name: "demo-app",
    provider: "gcp",
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
  mocks.upsertGroupManagedService = createRecordedMock(async () =>
    managedRecord
  ) as any;
  mocks.syncGroupManagedDesiredState = createRecordedMock(
    async () => [],
  ) as any;
  mocks.createDeployment = createRecordedMock(async () => ({
    id: "dep-1",
  })) as any;
  mocks.executeDeployment = createRecordedMock(async () => ({
    id: "dep-1",
    completed_at: "2026-03-29T00:00:01.000Z",
    provider_state_json: "{}",
    bundle_hash: null,
  })) as any;

  await applyManifest(
    {
      DB: {} as never,
      OCI_ORCHESTRATOR_URL: "https://orchestrator.example.test",
    } as never,
    "group-1",
    manifest,
  );

  const createDeploymentArgs = mocks.createDeployment.calls[0]
    .args[0] as Record<string, unknown>;
  assertEquals(createDeploymentArgs.artifactKind, "container-image");
  assertEquals(
    (createDeploymentArgs.provider as { name?: string }).name,
    "cloud-run",
  );
  assertObjectMatch(createDeploymentArgs.target as Record<string, unknown>, {
    artifact: {
      kind: "container-image",
      image_ref: imageRef,
      exposed_port: 8080,
      health_path: "/readyz",
      health_interval: 15,
      health_timeout: 3,
      health_unhealthy_threshold: 2,
    },
  });
});

Deno.test("group apply engine - ignores legacy storage resources during app apply", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.reconcileGroupRouting =
    (async () => ({ routes: {}, failedRoutes: [] })) as any;
  mocks.groupUpdateRun = (async () => undefined) as any;
  mocks.createResource = createRecordedMock(async () => undefined) as any;
  mocks.updateManagedResource = (async () => undefined) as any;
  const manifest: AppManifest = {
    name: "demo-app",
    version: "1.0.0",
    compute: {
      api: {
        kind: "worker",
        build: {
          fromWorkflow: {
            path: ".takos/workflows/deploy.yml",
            job: "build",
            artifact: "worker",
            artifactPath: "dist/worker.js",
          },
        },
      },
    },
    storage: {
      events: {
        type: "queue",
        bind: "EVENTS",
      },
    },
    routes: [],
    publish: [],
    env: {},
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
    manifest,
  );

  assertEquals(mocks.createResource.calls.length, 0);
});
