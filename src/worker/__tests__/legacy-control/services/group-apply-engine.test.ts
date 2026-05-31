import {
  assert,
  assertEquals,
  assertObjectMatch,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";

type RecordedMock = {
  (...args: unknown[]): unknown;
  calls: Array<{ args: unknown[] }>;
};

function createRecordedMock(
  impl: (...args: unknown[]) => unknown,
): RecordedMock {
  const fn = ((...args: unknown[]) => {
    fn.calls.push({ args });
    return impl(...args);
  }) as RecordedMock;
  fn.calls = [];
  return fn;
}

const mocks: {
  groupGet: RecordedMock;
  listResources: RecordedMock;
  createResource: RecordedMock;
  updateManagedResource: RecordedMock;
  listGroupManagedServices: RecordedMock;
  upsertGroupManagedService: RecordedMock;
  createDeployment: RecordedMock;
  executeDeployment: RecordedMock;
  captureManagedWorkloadDesiredState: RecordedMock;
  restoreManagedWorkloadDesiredState: RecordedMock;
  syncGroupManagedDesiredState: RecordedMock;
  syncGroupPublicationDesiredState: RecordedMock;
  reconcileGroupRouting: RecordedMock;
  assertTranslationSupported: RecordedMock;
  groupUpdateRun: RecordedMock;
  getDeploymentById: RecordedMock;
  findDeploymentByArtifactRef: RecordedMock;
  getBundleContent: RecordedMock;
} = {
  groupGet: createRecordedMock(() => undefined),
  listResources: createRecordedMock(() => undefined),
  createResource: createRecordedMock(() => undefined),
  updateManagedResource: createRecordedMock(() => undefined),
  listGroupManagedServices: createRecordedMock(() => undefined),
  upsertGroupManagedService: createRecordedMock(() => undefined),
  createDeployment: createRecordedMock(() => undefined),
  executeDeployment: createRecordedMock(() => undefined),
  captureManagedWorkloadDesiredState: createRecordedMock(async () => ({
    spaceId: "ws-1",
    serviceId: "svc-api",
    serviceName: "demo-app:api",
    consumes: [],
    localEnvVars: [],
  })),
  restoreManagedWorkloadDesiredState: createRecordedMock(async () => undefined),
  syncGroupManagedDesiredState: createRecordedMock(async () => []),
  syncGroupPublicationDesiredState: createRecordedMock(async () => []),
  reconcileGroupRouting: createRecordedMock(() => undefined),
  assertTranslationSupported: createRecordedMock(() => undefined),
  groupUpdateRun: createRecordedMock(() => undefined),
  getDeploymentById: createRecordedMock(() => undefined),
  findDeploymentByArtifactRef: createRecordedMock(() => undefined),
  getBundleContent: createRecordedMock(() => undefined),
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
  applyEngineDeps.listResources =
    ((...args: unknown[]) =>
      mocks.listResources(...args)) as typeof applyEngineDeps.listResources;
  applyEngineDeps.createResource =
    ((...args: unknown[]) =>
      mocks.createResource(...args)) as typeof applyEngineDeps.createResource;
  applyEngineDeps.updateManagedResource =
    ((...args: unknown[]) =>
      mocks.updateManagedResource(
        ...args,
      )) as typeof applyEngineDeps.updateManagedResource;
  applyEngineDeps.deleteResource =
    ((...args: unknown[]) =>
      mocks.createResource(...args)) as typeof applyEngineDeps.deleteResource;
  applyEngineDeps.deleteWorker =
    ((...args: unknown[]) =>
      mocks.createResource(...args)) as typeof applyEngineDeps.deleteWorker;
  applyEngineDeps.deleteContainer =
    ((...args: unknown[]) =>
      mocks.createResource(...args)) as typeof applyEngineDeps.deleteContainer;
  applyEngineDeps.deleteService =
    ((...args: unknown[]) =>
      mocks.createResource(...args)) as typeof applyEngineDeps.deleteService;
  applyEngineDeps.listGroupManagedServices =
    ((...args: unknown[]) =>
      mocks.listGroupManagedServices(
        ...args,
      )) as typeof applyEngineDeps.listGroupManagedServices;
  applyEngineDeps.upsertGroupManagedService =
    ((...args: unknown[]) =>
      mocks.upsertGroupManagedService(
        ...args,
      )) as typeof applyEngineDeps.upsertGroupManagedService;
  applyEngineDeps.getDeploymentById =
    ((...args: unknown[]) =>
      mocks.getDeploymentById(
        ...args,
      )) as typeof applyEngineDeps.getDeploymentById;
  applyEngineDeps.findDeploymentByArtifactRef =
    ((...args: unknown[]) =>
      mocks.findDeploymentByArtifactRef(
        ...args,
      )) as typeof applyEngineDeps.findDeploymentByArtifactRef;
  applyEngineDeps.getBundleContent =
    ((...args: unknown[]) =>
      mocks.getBundleContent(
        ...args,
      )) as typeof applyEngineDeps.getBundleContent;
  applyEngineDeps.syncGroupManagedDesiredState =
    ((...args: unknown[]) =>
      mocks.syncGroupManagedDesiredState(
        ...args,
      )) as typeof applyEngineDeps.syncGroupManagedDesiredState;
  applyEngineDeps.syncGroupPublicationDesiredState =
    ((...args: unknown[]) =>
      mocks.syncGroupPublicationDesiredState(
        ...args,
      )) as typeof applyEngineDeps.syncGroupPublicationDesiredState;
  applyEngineDeps.captureManagedWorkloadDesiredState =
    ((...args: unknown[]) =>
      mocks.captureManagedWorkloadDesiredState(
        ...args,
      )) as typeof applyEngineDeps.captureManagedWorkloadDesiredState;
  applyEngineDeps.restoreManagedWorkloadDesiredState =
    ((...args: unknown[]) =>
      mocks.restoreManagedWorkloadDesiredState(
        ...args,
      )) as typeof applyEngineDeps.restoreManagedWorkloadDesiredState;
  applyEngineDeps.reconcileGroupRouting =
    ((...args: unknown[]) =>
      mocks.reconcileGroupRouting(
        ...args,
      )) as typeof applyEngineDeps.reconcileGroupRouting;
  applyEngineDeps.assertTranslationSupported =
    ((...args: unknown[]) =>
      mocks.assertTranslationSupported(
        ...args,
      )) as typeof applyEngineDeps.assertTranslationSupported;
  type DeploymentServiceCtor = typeof applyEngineDeps.DeploymentService;
  type DeploymentServiceInstance = InstanceType<DeploymentServiceCtor>;
  const FakeDeploymentService = class {
    constructor(_env: unknown) {}
    createDeployment(...args: unknown[]) {
      return mocks.createDeployment(...args);
    }
    executeDeployment(...args: unknown[]) {
      return mocks.executeDeployment(...args);
    }
  } as new (
    ...args: ConstructorParameters<DeploymentServiceCtor>
  ) => DeploymentServiceInstance;
  applyEngineDeps.DeploymentService = FakeDeploymentService;
}

installApplyEngineDeps();

function makeManifest(): AppManifest {
  return {
    name: "demo-app",
    version: "1.0.0",
    compute: {
      api: {
        kind: "worker",
      },
    },
    routes: [
      { target: "api", path: "/api" },
    ],
    publish: [],
    env: {},
  };
}

function workloadFingerprint(manifest: AppManifest, name = "api"): string {
  return stableFingerprint({
    spec: manifest.compute[name],
    manifestEnv: manifest.env ?? {},
  });
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
      specFingerprint: options.specFingerprint ?? workloadFingerprint(manifest),
      deployedAt: "2026-03-29T00:00:00.000Z",
    },
  };
}

Deno.test("group apply engine - plans against canonical group resources/services state", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.reconcileGroupRouting = createRecordedMock(async () => ({
    routes: {},
    failedRoutes: [],
  }));
  mocks.groupUpdateRun = createRecordedMock(async () => undefined);
  mocks.createResource = createRecordedMock(async () => undefined);
  mocks.updateManagedResource = createRecordedMock(async () => undefined);
  const desiredSpecJson = JSON.stringify(makeManifest());

  mocks.groupGet = createRecordedMock(async () => ({
    id: "group-1",
    spaceId: "ws-1",
    name: "demo-app",
    backend: "cloudflare",
    env: "production",
    appVersion: "1.0.0",
    desiredSpecJson,
    backendStateJson: "{}",
    reconcileStatus: "ready",
    lastAppliedAt: "2026-03-29T00:00:00.000Z",
    createdAt: "2026-03-29T00:00:00.000Z",
    updatedAt: "2026-03-29T00:00:00.000Z",
  }));
  mocks.listResources = createRecordedMock(async () => []);
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
        specFingerprint: workloadFingerprint(makeManifest()),
        deployedAt: "2026-03-29T00:00:00.000Z",
      },
    },
  ]);

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
  assertEquals(result.translationReport.workloads, [
    {
      name: "api",
      category: "worker",
      runtime: "workers",
      runtimeProfile: "workers",
      status: "compatible",
      requirements: [],
      notes: [
        "tenant runtime realizes worker workloads through the worker runtime.",
      ],
    },
  ]);
});

Deno.test("group apply engine - derives observed routes from desiredSpecJson instead of stored observedStateJson", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.reconcileGroupRouting = createRecordedMock(async () => ({
    routes: {},
    failedRoutes: [],
  }));
  mocks.groupUpdateRun = createRecordedMock(async () => undefined);
  mocks.createResource = createRecordedMock(async () => undefined);
  mocks.updateManagedResource = createRecordedMock(async () => undefined);
  mocks.groupGet = createRecordedMock(async () => ({
    id: "group-1",
    spaceId: "ws-1",
    name: "demo-app",
    backend: "cloudflare",
    env: "production",
    appVersion: "1.0.0",
    desiredSpecJson: JSON.stringify(makeManifest()),
    backendStateJson: "{}",
    reconcileStatus: "ready",
    lastAppliedAt: "2026-03-29T00:00:00.000Z",
    createdAt: "2026-03-29T00:00:00.000Z",
    updatedAt: "2026-03-29T00:00:00.000Z",
  }));
  mocks.listResources = createRecordedMock(async () => []);
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
        specFingerprint: workloadFingerprint(makeManifest()),
      },
    },
  ]);

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
  }));
  mocks.groupUpdateRun = createRecordedMock(async () => undefined);
  mocks.createResource = createRecordedMock(async () => undefined);
  mocks.updateManagedResource = createRecordedMock(async () => undefined);
  const manifest = makeManifest();
  mocks.groupGet = createRecordedMock(async () => ({
    id: "group-1",
    spaceId: "ws-1",
    name: "demo-app",
    backend: "cloudflare",
    env: "production",
    appVersion: "1.0.0",
    desiredSpecJson: JSON.stringify(manifest),
    backendStateJson: "{}",
    reconcileStatus: "ready",
    lastAppliedAt: "2026-03-29T00:00:00.000Z",
    createdAt: "2026-03-29T00:00:00.000Z",
    updatedAt: "2026-03-29T00:00:00.000Z",
  }));
  mocks.listResources = createRecordedMock(async () => []);
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
  ]);
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
      specFingerprint: workloadFingerprint(manifest),
    },
  }));
  mocks.createDeployment = createRecordedMock(async () => ({
    id: "dep-1",
  }));
  mocks.executeDeployment = createRecordedMock(async () => ({
    id: "dep-1",
    completed_at: "2026-03-29T00:00:01.000Z",
    backend_state_json: "{}",
    bundle_hash: "sha256:demo",
  }));

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
    (createDeploymentArgs.backend as { name?: string }).name,
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
  mocks.assertTranslationSupported = createRecordedMock(async () => undefined);
  mocks.reconcileGroupRouting = createRecordedMock(async () => ({
    routes: {},
    failedRoutes: [],
  }));
  mocks.createResource = createRecordedMock(async () => undefined);
  mocks.updateManagedResource = createRecordedMock(async () => undefined);
  mocks.groupGet = createRecordedMock(async () => ({
    id: "group-1",
    spaceId: "ws-1",
    name: "demo-app",
    backend: "cloudflare",
    env: "production",
    appVersion: "1.0.0",
    desiredSpecJson: JSON.stringify(manifest),
    backendStateJson: "{}",
    reconcileStatus: "ready",
    lastAppliedAt: "2026-03-29T00:00:00.000Z",
    createdAt: "2026-03-29T00:00:00.000Z",
    updatedAt: "2026-03-29T00:00:00.000Z",
  }));
  mocks.listResources = createRecordedMock(async () => []);
  mocks.listGroupManagedServices = createRecordedMock(async () => [
    makeManagedWorkerRecord({
      status: "pending",
      specFingerprint: "stale-worker-fingerprint",
    }),
  ]);
  mocks.upsertGroupManagedService = createRecordedMock(async () =>
    makeManagedWorkerRecord({
      status: "pending",
      specFingerprint: workloadFingerprint(manifest),
    })
  );
  mocks.syncGroupManagedDesiredState = createRecordedMock(
    async () => [],
  );
  mocks.createDeployment = createRecordedMock(async () => ({
    id: "dep-1",
  }));
  mocks.executeDeployment = createRecordedMock(async () => ({
    id: "dep-1",
    completed_at: "2026-03-29T00:00:01.000Z",
    backend_state_json: "{}",
    bundle_hash: "sha256:demo",
  }));

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
    backend: "cloudflare",
    env: "production",
    appVersion: "1.0.0",
    desiredSpecJson: JSON.stringify(manifest),
    backendStateJson: "{}",
    reconcileStatus: "ready",
    lastAppliedAt: "2026-03-29T00:00:00.000Z",
    createdAt: "2026-03-29T00:00:00.000Z",
    updatedAt: "2026-03-29T00:00:00.000Z",
  }));
  mocks.listResources = createRecordedMock(async () => []);
  mocks.listGroupManagedServices = createRecordedMock(async () => [
    makeManagedWorkerRecord({
      status: "pending",
      specFingerprint: workloadFingerprint(manifest),
    }),
  ]);

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

Deno.test("group apply engine - syncs managed desired state before multi-workload deploy", async () => {
  const manifest = makeManifest();
  manifest.compute.admin = {
    ...manifest.compute.api,
  };
  mocks.reconcileGroupRouting = createRecordedMock(async () => ({
    routes: {},
    failedRoutes: [],
  }));
  mocks.createResource = createRecordedMock(async () => undefined);
  mocks.updateManagedResource = createRecordedMock(async () => undefined);
  mocks.groupGet = createRecordedMock(async () => ({
    id: "group-1",
    spaceId: "ws-1",
    name: "demo-app",
    backend: "cloudflare",
    env: "production",
    appVersion: "1.0.0",
    desiredSpecJson: JSON.stringify(manifest),
    backendStateJson: "{}",
    reconcileStatus: "ready",
    lastAppliedAt: "2026-03-29T00:00:00.000Z",
    createdAt: "2026-03-29T00:00:00.000Z",
    updatedAt: "2026-03-29T00:00:00.000Z",
  }));
  mocks.listResources = createRecordedMock(async () => []);
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
  ]);
  mocks.upsertGroupManagedService = createRecordedMock(
    async (..._args: unknown[]) => {
      const input = _args[1] as { manifestName: string };
      return makeManagedWorkerRecord({
        name: input.manifestName,
        status: "pending",
      });
    },
  );
  mocks.syncGroupManagedDesiredState = createRecordedMock(
    async () => [],
  );
  mocks.createDeployment = createRecordedMock(async () => ({
    id: "dep-1",
  }));
  mocks.executeDeployment = createRecordedMock(async () => ({
    id: "dep-1",
    completed_at: "2026-03-29T00:00:01.000Z",
    backend_state_json: "{}",
    bundle_hash: "sha256:demo",
  }));

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
  assertEquals(mocks.syncGroupManagedDesiredState.calls.length, 3);
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
  }));
  mocks.createResource = createRecordedMock(async () => undefined);
  mocks.updateManagedResource = createRecordedMock(async () => undefined);
  mocks.groupGet = createRecordedMock(async () => ({
    id: "group-1",
    spaceId: "ws-1",
    name: "demo-app",
    backend: "cloudflare",
    env: "production",
    appVersion: "1.0.0",
    desiredSpecJson: JSON.stringify(manifest),
    backendStateJson: "{}",
    reconcileStatus: "ready",
    lastAppliedAt: "2026-03-29T00:00:00.000Z",
    createdAt: "2026-03-29T00:00:00.000Z",
    updatedAt: "2026-03-29T00:00:00.000Z",
  }));
  mocks.listResources = createRecordedMock(async () => []);
  mocks.listGroupManagedServices = createRecordedMock(async () => [
    makeManagedWorkerRecord({
      status: "pending",
      specFingerprint: "stale-worker-fingerprint",
    }),
  ]);
  mocks.upsertGroupManagedService = createRecordedMock(async () =>
    makeManagedWorkerRecord({
      status: "pending",
      specFingerprint: workloadFingerprint(manifest),
    })
  );
  mocks.syncGroupManagedDesiredState = createRecordedMock(
    async () => [],
  );
  mocks.createDeployment = createRecordedMock(async () => ({
    id: "dep-1",
  }));
  mocks.executeDeployment = createRecordedMock(async () => {
    throw new Error("backend deploy failed");
  });

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
  assertStringIncludes(result.applied[0].error ?? "", "backend deploy failed");
  assertEquals(mocks.syncGroupManagedDesiredState.calls.length, 1);
  assertEquals(mocks.reconcileGroupRouting.calls.length, 0);
});

Deno.test("group apply engine - applies portable workloads through runtime-host outside provider-specific backends", async () => {
  const manifest = makeManifest();
  mocks.reconcileGroupRouting = createRecordedMock(async () => ({
    routes: {},
    failedRoutes: [],
  }));
  mocks.createResource = createRecordedMock(async () => undefined);
  mocks.updateManagedResource = createRecordedMock(async () => undefined);
  mocks.groupGet = createRecordedMock(async () => ({
    id: "group-1",
    spaceId: "ws-1",
    name: "demo-app",
    backend: "local",
    env: "production",
    appVersion: "1.0.0",
    desiredSpecJson: JSON.stringify(manifest),
    backendStateJson: "{}",
    reconcileStatus: "ready",
    lastAppliedAt: "2026-03-29T00:00:00.000Z",
    createdAt: "2026-03-29T00:00:00.000Z",
    updatedAt: "2026-03-29T00:00:00.000Z",
  }));
  mocks.listResources = createRecordedMock(async () => []);
  mocks.listGroupManagedServices = createRecordedMock(async () => [
    makeManagedWorkerRecord({
      status: "pending",
      specFingerprint: "stale-worker-fingerprint",
    }),
  ]);
  mocks.upsertGroupManagedService = createRecordedMock(async () =>
    makeManagedWorkerRecord({
      status: "pending",
      specFingerprint: workloadFingerprint(manifest),
    })
  );
  mocks.syncGroupManagedDesiredState = createRecordedMock(
    async () => [],
  );
  mocks.createDeployment = createRecordedMock(async () => ({
    id: "dep-1",
  }));
  mocks.executeDeployment = createRecordedMock(async () => ({
    id: "dep-1",
    completed_at: "2026-03-29T00:00:01.000Z",
    backend_state_json: "{}",
    bundle_hash: "sha256:demo",
  }));

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
    (createDeploymentArgs.backend as { name?: string }).name,
    "runtime-host",
  );
});

Deno.test("group apply engine - redeploys manifest env and syncs publications", async () => {
  const previousManifest = makeManifest();
  const manifest: AppManifest = {
    ...previousManifest,
    env: { GLOBAL_MODE: "prod" },
    routes: [{ id: "api-route", target: "api", path: "/api" }],
    publish: [{
      name: "browser",
      type: "McpServer",
      outputs: {
        default: { kind: "url", routeRef: "api-route" },
      },
      spec: { transport: "streamable-http" },
    }],
  };
  mocks.reconcileGroupRouting = createRecordedMock(async () => ({
    routes: {},
    failedRoutes: [],
  }));
  mocks.createResource = createRecordedMock(async () => undefined);
  mocks.updateManagedResource = createRecordedMock(async () => undefined);
  mocks.groupGet = createRecordedMock(async () => ({
    id: "group-1",
    spaceId: "ws-1",
    name: "demo-app",
    backend: "cloudflare",
    env: "production",
    appVersion: "1.0.0",
    desiredSpecJson: JSON.stringify(previousManifest),
    backendStateJson: "{}",
    reconcileStatus: "ready",
    lastAppliedAt: "2026-03-29T00:00:00.000Z",
    createdAt: "2026-03-29T00:00:00.000Z",
    updatedAt: "2026-03-29T00:00:00.000Z",
  }));
  mocks.listResources = createRecordedMock(async () => []);
  mocks.listGroupManagedServices = createRecordedMock(async () => [
    makeManagedWorkerRecord({
      specFingerprint: workloadFingerprint(previousManifest),
    }),
  ]);
  mocks.upsertGroupManagedService = createRecordedMock(async () =>
    makeManagedWorkerRecord({ specFingerprint: workloadFingerprint(manifest) })
  );
  mocks.syncGroupManagedDesiredState = createRecordedMock(
    async () => [],
  );
  mocks.createDeployment = createRecordedMock(async () => ({
    id: "dep-1",
  }));
  mocks.executeDeployment = createRecordedMock(async () => ({
    id: "dep-1",
  }));

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

  assertEquals(result.diff.hasChanges, true);
  assertEquals(mocks.createDeployment.calls.length, 1);
  assertEquals(mocks.syncGroupManagedDesiredState.calls.length, 2);
  const syncInput = mocks.syncGroupManagedDesiredState.calls[0]
    .args[1] as { desiredState: { manifest: AppManifest } };
  assertEquals(syncInput.desiredState.manifest.env, { GLOBAL_MODE: "prod" });
  assertEquals(syncInput.desiredState.manifest.publish, manifest.publish);
});

Deno.test("group apply engine - does not reconcile routes after managed-state sync failure", async () => {
  const previousManifest = makeManifest();
  const manifest: AppManifest = {
    ...previousManifest,
    routes: [{ id: "api-route", target: "api", path: "/api" }],
    publish: [{
      name: "browser",
      type: "McpServer",
      outputs: {
        default: { kind: "url", routeRef: "api-route" },
      },
      spec: { transport: "streamable-http" },
    }],
  };
  mocks.reconcileGroupRouting = createRecordedMock(async () => ({
    routes: {},
    failedRoutes: [],
  }));
  mocks.createResource = createRecordedMock(async () => undefined);
  mocks.updateManagedResource = createRecordedMock(async () => undefined);
  mocks.groupGet = createRecordedMock(async () => ({
    id: "group-1",
    spaceId: "ws-1",
    name: "demo-app",
    backend: "cloudflare",
    env: "production",
    appVersion: "1.0.0",
    desiredSpecJson: JSON.stringify(previousManifest),
    backendStateJson: "{}",
    reconcileStatus: "ready",
    lastAppliedAt: "2026-03-29T00:00:00.000Z",
    createdAt: "2026-03-29T00:00:00.000Z",
    updatedAt: "2026-03-29T00:00:00.000Z",
  }));
  mocks.listResources = createRecordedMock(async () => []);
  mocks.listGroupManagedServices = createRecordedMock(async () => [
    makeManagedWorkerRecord({
      specFingerprint: workloadFingerprint(previousManifest),
    }),
  ]);
  mocks.upsertGroupManagedService = createRecordedMock(async () =>
    makeManagedWorkerRecord()
  );
  mocks.syncGroupManagedDesiredState = createRecordedMock(
    async () => [{ name: "api", error: "consume sync failed" }],
  );
  mocks.createDeployment = createRecordedMock(async () => ({
    id: "dep-1",
  }));
  mocks.executeDeployment = createRecordedMock(async () => ({
    id: "dep-1",
  }));

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
      specFingerprint: workloadFingerprint(manifest),
    },
  };
  mocks.reconcileGroupRouting = createRecordedMock(async () => ({
    routes: {},
    failedRoutes: [],
  }));
  mocks.createResource = createRecordedMock(async () => undefined);
  mocks.updateManagedResource = createRecordedMock(async () => undefined);
  mocks.groupGet = createRecordedMock(async () => ({
    id: "group-1",
    spaceId: "ws-1",
    name: "demo-app",
    backend: "gcp",
    env: "production",
    appVersion: "1.0.0",
    desiredSpecJson: JSON.stringify(manifest),
    backendStateJson: "{}",
    reconcileStatus: "ready",
    lastAppliedAt: "2026-03-29T00:00:00.000Z",
    createdAt: "2026-03-29T00:00:00.000Z",
    updatedAt: "2026-03-29T00:00:00.000Z",
  }));
  mocks.listResources = createRecordedMock(async () => []);
  mocks.listGroupManagedServices = createRecordedMock(async () => []);
  mocks.upsertGroupManagedService = createRecordedMock(async () =>
    managedRecord
  );
  mocks.syncGroupManagedDesiredState = createRecordedMock(
    async () => [],
  );
  mocks.createDeployment = createRecordedMock(async () => ({
    id: "dep-1",
  }));
  mocks.executeDeployment = createRecordedMock(async () => ({
    id: "dep-1",
    completed_at: "2026-03-29T00:00:01.000Z",
    backend_state_json: "{}",
    bundle_hash: null,
  }));

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
    (createDeploymentArgs.backend as { name?: string }).name,
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

Deno.test("group apply engine - rejects unsupported storage resources during app apply", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.reconcileGroupRouting = createRecordedMock(async () => ({
    routes: {},
    failedRoutes: [],
  }));
  mocks.groupUpdateRun = createRecordedMock(async () => undefined);
  mocks.createResource = createRecordedMock(async () => undefined);
  mocks.updateManagedResource = createRecordedMock(async () => undefined);
  const manifest: AppManifest & { storage: Record<string, unknown> } = {
    name: "demo-app",
    version: "1.0.0",
    compute: {
      api: {
        kind: "worker",
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

  mocks.groupGet = createRecordedMock(async () => ({
    id: "group-1",
    spaceId: "ws-1",
    name: "demo-app",
    backend: "cloudflare",
    env: "production",
    appVersion: "1.0.0",
    desiredSpecJson: JSON.stringify(manifest),
    backendStateJson: "{}",
    reconcileStatus: "ready",
    lastAppliedAt: "2026-03-29T00:00:00.000Z",
    createdAt: "2026-03-29T00:00:00.000Z",
    updatedAt: "2026-03-29T00:00:00.000Z",
  }));
  mocks.listResources = createRecordedMock(async () => []);
  mocks.listGroupManagedServices = createRecordedMock(async () => []);

  await assertRejects(
    () =>
      applyManifest(
        { DB: {} as never } as never,
        "group-1",
        manifest,
      ),
    Error,
    "storage is not supported by the app manifest contract",
  );
});
