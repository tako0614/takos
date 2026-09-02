import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

import {
  CLOUDFLARE_PROVIDER_GAP_BRIDGE_ACKNOWLEDGEMENT,
  bridgeFailurePayload,
  cloudflareApiFailureDetail,
  containerRows,
  pendingDurableObjectMigration,
  runBridge,
  validateCloudflareProviderGapBridgeActivation,
} from "./takos-cloudflare-opentofu-bridge.ts";

const DOCKER_IMAGE =
  "docker.io/tako0614/takos-agent@sha256:d737076cdab331b3065410606d0754fbb58b9ec25a8f0c0108c8e63991d38e7b";

const DURABLE_OBJECT_LIFECYCLE = {
  tags: ["v1", "v2", "v3", "v4", "v5", "v6", "v7"],
  steps: [
    { new_classes: ["SessionDO"] },
    { new_classes: ["RunNotifierDO"] },
    { new_classes: ["RateLimiterDO"] },
    { new_classes: ["NotificationNotifierDO"] },
    { new_classes: ["RoutingDO"] },
    {
      new_sqlite_classes: [
        "TakosRuntimeContainer",
        "ExecutorContainerTier1",
        "ExecutorContainerTier2",
        "ExecutorContainerTier3",
      ],
    },
    { deleted_classes: ["TakosRuntimeContainer"] },
  ],
  container_bindings: [
    { name: "EXECUTOR_CONTAINER", class_name: "ExecutorContainerTier1" },
    { name: "EXECUTOR_CONTAINER_TIER2", class_name: "ExecutorContainerTier2" },
    { name: "EXECUTOR_CONTAINER_TIER3", class_name: "ExecutorContainerTier3" },
  ],
};

test("provider-gap bridge activation is default-off and fail-closed for production", () => {
  expect(() =>
    validateCloudflareProviderGapBridgeActivation(undefined, undefined)
  ).toThrow("bridge_mode_missing");
  expect(() =>
    validateCloudflareProviderGapBridgeActivation(" staging ", undefined, "staging")
  ).toThrow("bridge_mode_invalid");
  expect(() =>
    validateCloudflareProviderGapBridgeActivation("off", CLOUDFLARE_PROVIDER_GAP_BRIDGE_ACKNOWLEDGEMENT)
  ).toThrow("bridge_acknowledgement_unexpected");
  expect(
    validateCloudflareProviderGapBridgeActivation("off", undefined, "production"),
  ).toMatchObject({ mode: "off" });
  expect(() =>
    validateCloudflareProviderGapBridgeActivation("staging", undefined, "production")
  ).toThrow("bridge_environment_mismatch");
  expect(() =>
    validateCloudflareProviderGapBridgeActivation("staging", undefined)
  ).toThrow("bridge_environment_missing");
  expect(() =>
    validateCloudflareProviderGapBridgeActivation("disposable-production", undefined, "production")
  ).toThrow("bridge_acknowledgement_required");
  expect(() =>
    validateCloudflareProviderGapBridgeActivation("disposable-production", "reviewed", "production")
  ).toThrow("bridge_acknowledgement_invalid");
  expect(() =>
    validateCloudflareProviderGapBridgeActivation(
      "disposable-production",
      CLOUDFLARE_PROVIDER_GAP_BRIDGE_ACKNOWLEDGEMENT,
      "staging",
    )
  ).toThrow("bridge_environment_mismatch");
  expect(() =>
    validateCloudflareProviderGapBridgeActivation("staging", CLOUDFLARE_PROVIDER_GAP_BRIDGE_ACKNOWLEDGEMENT, "staging")
  ).toThrow("bridge_acknowledgement_unexpected");
  expect(
    validateCloudflareProviderGapBridgeActivation(
      "disposable-production",
      CLOUDFLARE_PROVIDER_GAP_BRIDGE_ACKNOWLEDGEMENT,
      "production",
    ),
  ).toMatchObject({ mode: "disposable-production" });
});

test("disabled bridge mode refuses helper execution before reading Cloudflare inputs", async () => {
  await expect(
    runBridge("verify", {
      env: {
        TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_MODE: "off",
      },
    }),
  ).rejects.toThrow("bridge_disabled");
});

test("pre-worker Containers capability 404 fails before any mutation", async () => {
  const directory = await mkdtemp("takos-cloudflare-bridge-capability-test-");
  try {
    const absoluteDirectory = resolve(directory);
    const assetsDirectory = join(absoluteDirectory, "assets");
    const artifactPath = join(absoluteDirectory, "worker.js");
    const bootstrapPath = join(absoluteDirectory, "durable-object-migration-bootstrap.js");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(assetsDirectory);
    await writeFile(join(assetsDirectory, "index.js"), "export const asset = true;\n");
    await writeFile(artifactPath, "export default {};\n");
    await writeFile(bootstrapPath, "export class ExecutorContainerTier1 {}; export default {};\n");
    const env: Record<string, string> = {
      TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_MODE: "staging",
      TAKOS_CLOUDFLARE_ENVIRONMENT: "staging",
      TAKOS_CLOUDFLARE_ACCOUNT_ID: "account-1",
      TAKOS_CLOUDFLARE_WORKER_NAME: "takos-staging",
      TAKOS_CLOUDFLARE_VECTOR_INDEX_NAME: "takos-staging-embeddings",
      TAKOS_CLOUDFLARE_VECTOR_INDEX_DIMENSIONS: "768",
      TAKOS_CLOUDFLARE_VECTOR_INDEX_METRIC: "cosine",
      TAKOS_CLOUDFLARE_WORKER_ARTIFACT_PATH: artifactPath,
      TAKOS_CLOUDFLARE_WORKER_ASSETS_PATH: assetsDirectory,
      TAKOS_CLOUDFLARE_DURABLE_OBJECT_BOOTSTRAP_PATH: bootstrapPath,
      TAKOS_CLOUDFLARE_DURABLE_OBJECT_LIFECYCLE: JSON.stringify(DURABLE_OBJECT_LIFECYCLE),
      CLOUDFLARE_API_TOKEN: "capability-404-token",
    };
    const calls: Array<{ method: string; url: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = String(init?.method ?? "GET");
      calls.push({ method, url });
      if (method === "GET" && url.endsWith("/accounts/account-1/containers/applications")) {
        return new Response(
          JSON.stringify({
            success: false,
            errors: [{ code: 1609, message: "Containers are unavailable" }],
          }),
          { status: 404, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected request ${method} ${url}`);
    };

    await expect(
      runBridge("pre-worker", {
        env,
        cwd: directory,
        fetchImpl,
        containersReadinessRetryAttempts: 2,
        containersReadinessRetryDelayMs: 0,
      }),
    ).rejects.toMatchObject({
      code: "cloudflare_api_error",
      detail: "GET:containers.applications:404:CF1609",
    });
    expect(calls).toEqual([
      {
        method: "GET",
        url: "https://api.cloudflare.com/client/v4/accounts/account-1/containers/applications",
      },
      {
        method: "GET",
        url: "https://api.cloudflare.com/client/v4/accounts/account-1/containers/applications",
      },
    ]);
    expect(calls.some(({ method }) => ["POST", "PUT", "PATCH", "DELETE"].includes(method))).toBe(false);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("capability-preflight accepts an empty envelope without Worker inputs", async () => {
  const calls: Array<{ method: string; url: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = String(init?.method ?? "GET");
    calls.push({ method, url });
    return new Response(JSON.stringify({ success: true, result: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const evidence = await runBridge("capability-preflight", {
    env: {
      TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_MODE: "staging",
      TAKOS_CLOUDFLARE_ENVIRONMENT: "staging",
      TAKOS_CLOUDFLARE_ACCOUNT_ID: "account-1",
      CLOUDFLARE_API_TOKEN: "capability-preflight-token",
    },
    fetchImpl,
  });
  expect(evidence.phase).toBe("capability-preflight");
  expect(evidence.changed).toBe(false);
  expect(calls).toEqual([{
    method: "GET",
    url: "https://api.cloudflare.com/client/v4/accounts/account-1/containers/applications",
  }]);
});

test("capability-preflight 404 creates zero Cloudflare resources", async () => {
  const calls: Array<{ method: string; url: string }> = [];
  const delays: number[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = String(init?.method ?? "GET");
    calls.push({ method, url });
    return new Response(JSON.stringify({ success: false, errors: [{ code: 1609 }] }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };

  await expect(
    runBridge("capability-preflight", {
      env: {
        TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_MODE: "staging",
        TAKOS_CLOUDFLARE_ENVIRONMENT: "staging",
        TAKOS_CLOUDFLARE_ACCOUNT_ID: "account-1",
        CLOUDFLARE_API_TOKEN: "capability-404-token",
      },
      fetchImpl,
      containersReadinessRetryAttempts: 3,
      containersReadinessRetryDelayMs: 41,
      containersReadinessDelay: async (delayMs) => {
        delays.push(delayMs);
      },
    }),
  ).rejects.toMatchObject({
    code: "cloudflare_api_error",
    detail: "GET:containers.applications:404:CF1609",
  });
  expect(calls).toHaveLength(3);
  expect(calls.every(({ method }) => method === "GET")).toBe(true);
  expect(delays).toEqual([41, 41]);
});

test("Containers GET does not retry an arbitrary 404 error", async () => {
  const calls: Array<{ method: string; url: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = String(init?.method ?? "GET");
    calls.push({ method, url });
    return new Response(JSON.stringify({ success: false, errors: [{ code: 1610 }] }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };

  await expect(
    runBridge("capability-preflight", {
      env: {
        TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_MODE: "staging",
        TAKOS_CLOUDFLARE_ENVIRONMENT: "staging",
        TAKOS_CLOUDFLARE_ACCOUNT_ID: "account-1",
        CLOUDFLARE_API_TOKEN: "capability-404-token",
      },
      fetchImpl,
      containersReadinessRetryAttempts: 3,
      containersReadinessRetryDelayMs: 0,
    }),
  ).rejects.toMatchObject({
    code: "cloudflare_api_error",
    detail: "GET:containers.applications:404:CF1610",
  });
  expect(calls).toHaveLength(1);
});

test("cleanup accepts CF1609 exact-ID absence after a successful DELETE", async () => {
  const directory = await mkdtemp("takos-cloudflare-bridge-cleanup-delete-test-");
  try {
    const absoluteDirectory = resolve(directory);
    const moduleDirectory = join(absoluteDirectory, "module");
    const artifactPath = join(moduleDirectory, "worker.js");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(moduleDirectory);
    await writeFile(artifactPath, "export default {};\n");
    // The live Worker remains the normal authority even if the bounded
    // fallback receipt is malformed. The receipt must not be read eagerly.
    await writeFile(join(absoluteDirectory, "terraform.tfstate"), "{");
    const desiredConfig = JSON.stringify({
      applications: [
        {
          name: "takos-executor-tier1",
          durable_object_class: "ExecutorContainerTier1",
          image: DOCKER_IMAGE,
          instance_type: "lite",
          max_instances: 1,
          rollout_active_grace_period: 900,
        },
        {
          name: "takos-executor-tier2",
          durable_object_class: "ExecutorContainerTier2",
          image: DOCKER_IMAGE,
          instance_type: "basic",
          max_instances: 1,
          rollout_active_grace_period: 900,
        },
        {
          name: "takos-executor-tier3",
          durable_object_class: "ExecutorContainerTier3",
          image: DOCKER_IMAGE,
          instance_type: { vcpu: 1, memory_mib: 12288, disk_mb: 4000 },
          max_instances: 1,
          rollout_active_grace_period: 900,
        },
      ],
    });
    const env: Record<string, string> = {
      TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_MODE: "staging",
      TAKOS_CLOUDFLARE_ENVIRONMENT: "staging",
      TAKOS_CLOUDFLARE_ACCOUNT_ID: "account-1",
      TAKOS_CLOUDFLARE_WORKER_NAME: "takos-cleanup",
      TAKOS_CLOUDFLARE_VECTOR_INDEX_NAME: "takos-embeddings",
      TAKOS_CLOUDFLARE_VECTOR_INDEX_DIMENSIONS: "768",
      TAKOS_CLOUDFLARE_VECTOR_INDEX_METRIC: "cosine",
      TAKOS_CLOUDFLARE_WORKER_ARTIFACT_PATH: artifactPath,
      TAKOS_CLOUDFLARE_CONTAINER_DESIRED_CONFIG_CONTENT: desiredConfig,
      TAKOS_CLOUDFLARE_RECOVERY_STATE_PATH: "../terraform.tfstate",
      CLOUDFLARE_API_TOKEN: "cleanup-delete-token",
    };
    const calls: Array<{ method: string; url: string }> = [];
    let deleted = false;
    let deleteFails = false;
    let deletionReadbackCode = 1609;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = String(init?.method ?? "GET");
      calls.push({ method, url });
      if (url.endsWith("/workers/scripts/takos-cleanup/deployments")) {
        return envelope({ versions: [{ version_id: "v1", percentage: 100 }] });
      }
      if (url.endsWith("/workers/scripts/takos-cleanup/versions/v1")) {
        return envelope({
          resources: {
            bindings: [
              { type: "durable_object_namespace", class_name: "ExecutorContainerTier1", namespace_id: "ns-1" },
              { type: "durable_object_namespace", class_name: "ExecutorContainerTier2", namespace_id: "ns-2" },
              { type: "durable_object_namespace", class_name: "ExecutorContainerTier3", namespace_id: "ns-3" },
            ],
          },
        });
      }
      const listMatch = url.match(/\/containers\/applications\?name=([^&]+)/u);
      if (method === "GET" && listMatch) {
        const name = decodeURIComponent(listMatch[1]!);
        return envelope(
          name === "takos-executor-tier1"
            ? [{ id: "app-tier1", name }]
            : [],
        );
      }
      const detailMatch = url.match(/\/containers\/applications\/([^/]+)$/u);
      if (detailMatch) {
        const id = decodeURIComponent(detailMatch[1]!);
        if (method === "GET" && id === "app-tier1" && !deleted) {
          return envelope({
            id,
            name: "takos-executor-tier1",
            configuration: { image: DOCKER_IMAGE, instance_type: "lite" },
            max_instances: 1,
            scheduling_policy: "default",
            rollout_active_grace_period: 900,
            durable_objects: { namespace_id: "ns-1" },
          });
        }
        if (method === "DELETE" && id === "app-tier1") {
          if (deleteFails) return envelope({ error: "DELETE_FAILED" }, 500);
          deleted = true;
          return envelope(null);
        }
        if (method === "GET" && id === "app-tier1" && deleted) {
          return new Response(
            JSON.stringify({
              success: false,
              errors: [{ code: deletionReadbackCode, message: "Container application is not ready" }],
            }),
            { status: 404, headers: { "content-type": "application/json" } },
          );
        }
      }
      return envelope({ error: `unexpected ${method} ${url}` }, 500);
    };

    const cleanup = await runBridge("recovery-cleanup", {
      env,
      cwd: moduleDirectory,
      fetchImpl,
      containersReadinessRetryAttempts: 2,
      containersReadinessRetryDelayMs: 0,
    });
    expect(cleanup.containers.deleted).toEqual(["takos-executor-tier1"]);
    expect(cleanup.changed).toBe(true);
    expect(calls.filter(({ method }) => method === "DELETE")).toHaveLength(1);
    expect(calls.filter(({ method, url }) => method === "GET" && url.endsWith("/containers/applications/app-tier1"))).toHaveLength(2);

    // A failed mutation must not trigger a deletion readback.  This keeps a
    // provider error fail-closed instead of treating it as an absent resource.
    deleted = false;
    deleteFails = true;
    calls.length = 0;
    await expect(
      runBridge("recovery-cleanup", {
        env,
        cwd: moduleDirectory,
        fetchImpl,
        containersReadinessRetryAttempts: 2,
        containersReadinessRetryDelayMs: 0,
      }),
    ).rejects.toMatchObject({
      code: "cloudflare_api_error",
      detail: "DELETE:containers.applications:500:DELETE_FAILED",
    });
    const failedDeleteIndex = calls.findIndex(({ method }) => method === "DELETE");
    expect(failedDeleteIndex).toBeGreaterThanOrEqual(0);
    expect(
      calls.slice(failedDeleteIndex + 1).some(
        ({ method, url }) => method === "GET" && url.endsWith("/containers/applications/app-tier1"),
      ),
    ).toBe(false);

    // Even after a successful DELETE, an arbitrary not-found code is not an
    // absence proof; only CF1609 is accepted by the scoped readback seam.
    deleteFails = false;
    deletionReadbackCode = 1610;
    calls.length = 0;
    await expect(
      runBridge("recovery-cleanup", {
        env,
        cwd: moduleDirectory,
        fetchImpl,
        containersReadinessRetryAttempts: 2,
        containersReadinessRetryDelayMs: 0,
      }),
    ).rejects.toMatchObject({
      code: "cloudflare_api_error",
      detail: "GET:containers.applications:404:CF1610",
    });
    expect(calls.filter(({ method }) => method === "DELETE")).toHaveLength(1);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("recovery cleanup uses an exact restored state receipt when the Worker is absent", async () => {
  const fixture = await createStateRecoveryFixture();
  try {
    const cleanup = await fixture.run();
    expect(cleanup.workerVersion).toBeUndefined();
    expect(cleanup.containers.deleted).toEqual(["takos-recovery-executor-tier3"]);
    expect(cleanup.vector.status).toBe("deleted");
    expect(fixture.calls.filter(({ method }) => method === "DELETE")).toHaveLength(2);
    expect(await readFile(join(fixture.directory, "terraform.tfstate"), "utf8"))
      .not.toContain("state-recovery-token");
    expect(
      await readFile(join(fixture.directory, "module", "terraform.tfstate"), "utf8"),
    ).toBe("{");
  } finally {
    await fixture.cleanup();
  }
});

test("recovery cleanup validates every provider-gap target before the first DELETE", async () => {
  const fixture = await createStateRecoveryFixture({
    containerRowsByName: {
      "takos-recovery-executor-tier1": [{
        id: "app-tier1",
        name: "takos-recovery-executor-tier1",
      }],
      "takos-recovery-executor-tier2": [{
        id: "app-tier2",
        name: "takos-recovery-executor-tier2",
      }],
      "takos-recovery-executor-tier3": [],
    },
    containerDetailsById: {
      "app-tier1": recoveryContainerDetail(
        "app-tier1",
        "takos-recovery-executor-tier1",
        "ns-tier1",
        "lite",
      ),
      "app-tier2": {
        ...recoveryContainerDetail(
          "app-tier2",
          "takos-recovery-executor-tier2",
          "ns-tier2",
          "basic",
        ),
        configuration: {
          image: "docker.io/library/alpine@sha256:" + "b".repeat(64),
          instance_type: "basic",
        },
      },
    },
  });
  try {
    await expect(fixture.run()).rejects.toThrow("container_cleanup_ownership_unproven");
    expect(fixture.calls.some(({ method }) => method === "DELETE")).toBe(false);
  } finally {
    await fixture.cleanup();
  }
});

test("recovery cleanup refuses missing, malformed, symlinked, or non-10007 receipts before DELETE", async () => {
  const cases: readonly StateRecoveryFixtureOptions[] = [
    { receipt: "missing" },
    { receipt: "malformed" },
    { receipt: "symlink" },
    { recoveryStatePath: "terraform.tfstate" },
    { recoveryStatePath: "../../terraform.tfstate" },
    { workerCode: 10008 },
    { workerStatus: 500, workerCode: 10007 },
  ];
  for (const options of cases) {
    const fixture = await createStateRecoveryFixture(options);
    try {
      await expect(fixture.run()).rejects.toBeInstanceOf(Error);
      expect(fixture.calls.some(({ method }) => method === "DELETE")).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  }
});

test("recovery cleanup rejects a symlinked or misnamed generated-root module topology before DELETE", async () => {
  const cases: readonly StateRecoveryFixtureOptions[] = [
    { cwdShape: "module-symlink" },
    { cwdShape: "generated-root-symlink" },
    { cwdShape: "wrong-module-leaf" },
  ];
  for (const options of cases) {
    const fixture = await createStateRecoveryFixture(options);
    try {
      await expect(fixture.run()).rejects.toThrow("recovery_state_path_invalid");
      expect(fixture.calls.some(({ method }) => method === "DELETE")).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  }
});

test("recovery cleanup does not reread a mutable desired-config path as state authority", async () => {
  const fixture = await createStateRecoveryFixture({
    omitDesiredContentFromEnvironment: true,
  });
  try {
    await expect(fixture.run()).rejects.toThrow("cloudflare_api_error");
    expect(fixture.calls.some(({ url }) => url.includes("/containers/applications")))
      .toBe(false);
    expect(fixture.calls.some(({ method }) => method === "DELETE")).toBe(false);
  } finally {
    await fixture.cleanup();
  }
});

test("recovery cleanup rejects ambiguous exact-name Container discovery before DELETE", async () => {
  const fixture = await createStateRecoveryFixture({
    containerRowsByName: {
      "takos-recovery-executor-tier1": [],
      "takos-recovery-executor-tier2": [],
      "takos-recovery-executor-tier3": [
        { id: "app-tier3-a", name: "takos-recovery-executor-tier3" },
        { id: "app-tier3-b", name: "takos-recovery-executor-tier3" },
      ],
    },
  });
  try {
    await expect(fixture.run()).rejects.toThrow("container_name_ambiguous");
    expect(fixture.calls.some(({ method }) => method === "DELETE")).toBe(false);
  } finally {
    await fixture.cleanup();
  }
});

test("recovery cleanup rejects state address, provider, schema, sensitivity, and input drift before DELETE", async () => {
  const cases: readonly ((state: Record<string, unknown>) => void)[] = [
    (state) => {
      state.resources = recoveryFixtureResources(state).filter((resource) =>
        !(resource.type === "terraform_data" && resource.name === "provider_gap_post")
      );
    },
    (state) => {
      const resources = recoveryFixtureResources(state);
      state.resources = [
        ...resources,
        structuredClone(
          recoveryFixtureResource(state, "terraform_data", "provider_gap_post"),
        ),
      ];
    },
    (state) => {
      recoveryFixtureResource(state, "cloudflare_worker_version", "app").provider =
        'provider["registry.opentofu.org/cloudflare/cloudflare-unknown"]';
    },
    (state) => {
      recoveryFixtureInstance(
        recoveryFixtureResource(state, "cloudflare_worker_version", "app"),
      ).schema_version = 501;
    },
    (state) => {
      recoveryFixtureInstance(
        recoveryFixtureResource(state, "terraform_data", "provider_gap_cleanup"),
      ).sensitive_attributes = [[{ type: "get_attr", value: "input" }]];
    },
    (state) => {
      recoveryFixtureInstance(
        recoveryFixtureResource(state, "cloudflare_worker_version", "app"),
      ).sensitive_attributes = [[
        { type: "get_attr", value: "bindings" },
        { type: "index", value: 0 },
        { type: "get_attr", value: "namespace_id" },
      ]];
    },
    (state) => {
      recoveryFixtureBindings(state)[0]!.unknown_provider_field = "unexpected";
    },
    (state) => {
      const attributes = recoveryFixtureAttributes(
        recoveryFixtureResource(state, "terraform_data", "provider_gap_post"),
      );
      const input = attributes.input as Record<string, unknown>;
      input.TAKOS_CLOUDFLARE_WORKER_NAME = "other-worker";
    },
  ];
  for (const mutateState of cases) {
    const fixture = await createStateRecoveryFixture({ mutateState });
    try {
      await expect(fixture.run()).rejects.toBeInstanceOf(Error);
      expect(fixture.calls.some(({ method }) => method === "DELETE")).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  }
});

test("recovery cleanup rejects missing or ambiguous namespace and Vectorize state evidence before DELETE", async () => {
  const cases: readonly ((state: Record<string, unknown>) => void)[] = [
    (state) => {
      const attributes = recoveryFixtureAttributes(
        recoveryFixtureResource(state, "cloudflare_worker_version", "app"),
      );
      attributes.bindings = recoveryFixtureBindings(state).filter((binding) =>
        binding.class_name !== "ExecutorContainerTier3"
      );
    },
    (state) => {
      const bindings = recoveryFixtureBindings(state);
      const tier2 = bindings.find((binding) =>
        binding.class_name === "ExecutorContainerTier2"
      );
      if (!tier2) throw new Error("tier2 fixture binding missing");
      tier2.namespace_id = "ns-tier1";
    },
    (state) => {
      const vector = recoveryFixtureBindings(state).find((binding) =>
        binding.type === "vectorize"
      );
      if (!vector) throw new Error("vector fixture binding missing");
      vector.index_name = "other-index";
    },
    (state) => {
      const attributes = recoveryFixtureAttributes(
        recoveryFixtureResource(state, "cloudflare_worker_version", "app"),
      );
      const bindings = recoveryFixtureBindings(state);
      const vector = bindings.find((binding) => binding.type === "vectorize");
      if (!vector) throw new Error("vector fixture binding missing");
      attributes.bindings = [...bindings, { ...vector }];
    },
  ];
  for (const mutateState of cases) {
    const fixture = await createStateRecoveryFixture({ mutateState });
    try {
      await expect(fixture.run()).rejects.toBeInstanceOf(Error);
      expect(fixture.calls.some(({ method }) => method === "DELETE")).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  }
});

test("recovery cleanup rejects Container capacity, namespace, and Vectorize detail drift before DELETE", async () => {
  const cases: readonly StateRecoveryFixtureOptions[] = [
    {
      containerDetailsById: {
        "app-tier3": {
          ...recoveryContainerDetail(
            "app-tier3",
            "takos-recovery-executor-tier3",
            "ns-tier3",
            "tier3",
          ),
          configuration: {
            image: DOCKER_IMAGE,
            vcpu: 2,
            memory_mib: 12288,
            disk: { size_mb: 4000 },
          },
        },
      },
    },
    {
      containerDetailsById: {
        "app-tier3": recoveryContainerDetail(
          "app-tier3",
          "takos-recovery-executor-tier3",
          "other-namespace",
          "tier3",
        ),
      },
    },
    {
      vectorDetail: {
        name: "takos-recovery-embeddings",
        config: { dimensions: 1536, metric: "cosine" },
      },
    },
  ];
  for (const options of cases) {
    const fixture = await createStateRecoveryFixture(options);
    try {
      await expect(fixture.run()).rejects.toBeInstanceOf(Error);
      expect(fixture.calls.some(({ method }) => method === "DELETE")).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  }
});

test("destroy provisioners pass only the fixed runner-local recovery state path", async () => {
  const moduleSource = await readFile(
    resolve(
      import.meta.dir,
      "../deploy/opentofu/cloudflare/modules/platform/main.tf",
    ),
    "utf8",
  );
  expect(
    moduleSource.match(
      /TAKOS_CLOUDFLARE_RECOVERY_STATE_PATH\s*=\s*"\.\.\/terraform\.tfstate"/gu,
    ),
  ).toHaveLength(2);
  expect(moduleSource).not.toContain("file(\"terraform.tfstate\")");
  expect(moduleSource).not.toContain("filebase64(\"terraform.tfstate\")");
  expect(moduleSource).not.toContain("file(\"../terraform.tfstate\")");
  expect(moduleSource).not.toContain("filebase64(\"../terraform.tfstate\")");
});

function envelope(result: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: status >= 200 && status < 300, result }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function recoveryTerraformState(input: Record<string, string>): Record<string, unknown> {
  const terraformData = (name: "provider_gap_cleanup" | "provider_gap_post") => ({
    module: "module.child.module.platform",
    mode: "managed",
    type: "terraform_data",
    name,
    provider: "provider[\"terraform.io/builtin/terraform\"]",
    instances: [{
      index_key: 0,
      schema_version: 0,
      attributes: {
        id: `${name}-id`,
        input: { ...input },
        output: { ...input },
        triggers_replace: null,
      },
      sensitive_attributes: [],
    }],
  });
  return {
    version: 4,
    terraform_version: "1.12.3",
    serial: 3,
    lineage: "00000000-0000-0000-0000-000000000042",
    outputs: {},
    resources: [
      terraformData("provider_gap_cleanup"),
      terraformData("provider_gap_post"),
      {
        module: "module.child.module.platform",
        mode: "managed",
        type: "cloudflare_worker_version",
        name: "app",
        provider: "provider[\"registry.opentofu.org/cloudflare/cloudflare\"]",
        instances: [{
          schema_version: 500,
          attributes: {
            account_id: input.TAKOS_CLOUDFLARE_ACCOUNT_ID,
            worker_id: input.TAKOS_CLOUDFLARE_WORKER_NAME,
            bindings: [
              {
                name: "EXECUTOR_CONTAINER",
                type: "durable_object_namespace",
                class_name: "ExecutorContainerTier1",
                namespace_id: "ns-tier1",
              },
              {
                name: "EXECUTOR_CONTAINER_TIER2",
                type: "durable_object_namespace",
                class_name: "ExecutorContainerTier2",
                namespace_id: "ns-tier2",
              },
              {
                name: "EXECUTOR_CONTAINER_TIER3",
                type: "durable_object_namespace",
                class_name: "ExecutorContainerTier3",
                namespace_id: "ns-tier3",
              },
              {
                name: "VECTORIZE",
                type: "vectorize",
                index_name: input.TAKOS_CLOUDFLARE_VECTOR_INDEX_NAME,
              },
            ],
          },
          sensitive_attributes: [],
        }],
      },
    ],
  };
}

function recoveryFixtureResources(state: Record<string, unknown>): Array<Record<string, unknown>> {
  if (!Array.isArray(state.resources)) throw new Error("fixture resources missing");
  return state.resources.map((resource) => {
    if (typeof resource !== "object" || resource === null || Array.isArray(resource)) {
      throw new Error("fixture resource invalid");
    }
    return resource as Record<string, unknown>;
  });
}

function recoveryFixtureResource(
  state: Record<string, unknown>,
  type: string,
  name: string,
): Record<string, unknown> {
  const resource = recoveryFixtureResources(state).find((candidate) =>
    candidate.type === type && candidate.name === name
  );
  if (!resource) throw new Error(`fixture resource missing: ${type}.${name}`);
  return resource;
}

function recoveryFixtureInstance(resource: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(resource.instances) || resource.instances.length !== 1) {
    throw new Error("fixture instance missing");
  }
  const instance = resource.instances[0];
  if (typeof instance !== "object" || instance === null || Array.isArray(instance)) {
    throw new Error("fixture instance invalid");
  }
  return instance as Record<string, unknown>;
}

function recoveryFixtureAttributes(resource: Record<string, unknown>): Record<string, unknown> {
  const attributes = recoveryFixtureInstance(resource).attributes;
  if (typeof attributes !== "object" || attributes === null || Array.isArray(attributes)) {
    throw new Error("fixture attributes invalid");
  }
  return attributes as Record<string, unknown>;
}

function recoveryFixtureBindings(state: Record<string, unknown>): Array<Record<string, unknown>> {
  const attributes = recoveryFixtureAttributes(
    recoveryFixtureResource(state, "cloudflare_worker_version", "app"),
  );
  if (!Array.isArray(attributes.bindings)) throw new Error("fixture bindings missing");
  return attributes.bindings.map((binding) => {
    if (typeof binding !== "object" || binding === null || Array.isArray(binding)) {
      throw new Error("fixture binding invalid");
    }
    return binding as Record<string, unknown>;
  });
}

function recoveryDesiredConfig(): string {
  return JSON.stringify({
    applications: [
      {
        name: "takos-recovery-executor-tier1",
        durable_object_class: "ExecutorContainerTier1",
        image: DOCKER_IMAGE,
        instance_type: "lite",
        max_instances: 1,
        rollout_active_grace_period: 900,
      },
      {
        name: "takos-recovery-executor-tier2",
        durable_object_class: "ExecutorContainerTier2",
        image: DOCKER_IMAGE,
        instance_type: "basic",
        max_instances: 1,
        rollout_active_grace_period: 900,
      },
      {
        name: "takos-recovery-executor-tier3",
        durable_object_class: "ExecutorContainerTier3",
        image: DOCKER_IMAGE,
        instance_type: { vcpu: 1, memory_mib: 12288, disk_mb: 4000 },
        max_instances: 1,
        rollout_active_grace_period: 900,
      },
    ],
  });
}

function recoveryContainerDetail(
  id: string,
  name: string,
  namespaceId: string,
  instanceType: "lite" | "basic" | "tier3",
): Record<string, unknown> {
  const configuration = instanceType === "tier3"
    ? {
      image: DOCKER_IMAGE,
      vcpu: 1,
      memory_mib: 12288,
      disk: { size_mb: 4000 },
    }
    : { image: DOCKER_IMAGE, instance_type: instanceType };
  return {
    id,
    name,
    configuration,
    max_instances: 1,
    scheduling_policy: "default",
    rollout_active_grace_period: 900,
    durable_objects: { namespace_id: namespaceId },
  };
}

interface StateRecoveryFixtureOptions {
  readonly workerStatus?: number;
  readonly workerCode?: number;
  readonly containerRowsByName?: Readonly<Record<string, readonly Record<string, unknown>[]>>;
  readonly containerDetailsById?: Readonly<Record<string, Record<string, unknown>>>;
  readonly vectorDetail?: Record<string, unknown> | null;
  readonly receipt?: "exact" | "missing" | "malformed" | "symlink";
  readonly recoveryStatePath?: string;
  readonly mutateState?: (state: Record<string, unknown>) => void;
  readonly omitDesiredContentFromEnvironment?: boolean;
  readonly cwdShape?:
    | "exact"
    | "module-symlink"
    | "generated-root-symlink"
    | "wrong-module-leaf";
}

async function createStateRecoveryFixture(
  options: StateRecoveryFixtureOptions = {},
): Promise<{
  readonly directory: string;
  readonly calls: Array<{ method: string; url: string }>;
  readonly run: () => ReturnType<typeof runBridge>;
  readonly cleanup: () => Promise<void>;
}> {
  const directory = await mkdtemp("takos-cloudflare-bridge-state-recovery-test-");
  const absoluteDirectory = resolve(directory);
  const storedModuleDirectory = options.cwdShape === "module-symlink"
    ? join(absoluteDirectory, "module-target")
    : options.cwdShape === "wrong-module-leaf"
      ? join(absoluteDirectory, "app")
      : join(absoluteDirectory, "module");
  const moduleDirectory = options.cwdShape === "generated-root-symlink"
    ? join(absoluteDirectory, "generated-root-link", "module")
    : options.cwdShape === "module-symlink"
      ? join(absoluteDirectory, "module")
      : storedModuleDirectory;
  const artifactPath = join(moduleDirectory, "worker.js");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(storedModuleDirectory);
  await mkdir(join(storedModuleDirectory, ".takos-build", "assets"), { recursive: true });
  await mkdir(join(storedModuleDirectory, "modules", "platform"), { recursive: true });
  await writeFile(join(storedModuleDirectory, "worker.js"), "export default {};\n");
  await writeFile(join(storedModuleDirectory, ".takos-build", "assets", "index.html"), "ok\n");
  await writeFile(
    join(storedModuleDirectory, "modules", "platform", "durable-object-migration-bootstrap.js"),
    "export default {};\n",
  );
  if (options.cwdShape === "module-symlink") {
    await symlink("module-target", moduleDirectory, "dir");
  } else if (options.cwdShape === "generated-root-symlink") {
    await symlink(".", join(absoluteDirectory, "generated-root-link"), "dir");
  }
  // A malformed same-directory decoy makes the real generated-root topology
  // load-bearing: recovery must read the parent receipt, never module state.
  await writeFile(join(moduleDirectory, "terraform.tfstate"), "{");
  const receiptInput = {
    TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_MODE: "staging",
    TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_ACKNOWLEDGEMENT: "",
    TAKOS_CLOUDFLARE_ENVIRONMENT: "staging",
    TAKOS_CLOUDFLARE_APP_MODULE_WORKING_DIR: "module",
    TAKOS_CLOUDFLARE_BRIDGE_HELPER_PATH: ".takos-build/bridge/takos-cloudflare-opentofu-bridge.ts",
    TAKOS_CLOUDFLARE_ACCOUNT_ID: "account-1",
    TAKOS_CLOUDFLARE_WORKER_NAME: "takos-recovery",
    TAKOS_CLOUDFLARE_VECTOR_INDEX_NAME: "takos-recovery-embeddings",
    TAKOS_CLOUDFLARE_VECTOR_INDEX_DIMENSIONS: "768",
    TAKOS_CLOUDFLARE_VECTOR_INDEX_METRIC: "cosine",
    TAKOS_CLOUDFLARE_WORKER_ASSETS_PATH: ".takos-build/assets",
    TAKOS_CLOUDFLARE_CONTAINER_DESIRED_CONFIG_PATH: ".takos-build/container-desired.json",
    TAKOS_CLOUDFLARE_WORKER_ARTIFACT_PATH: artifactPath,
    TAKOS_CLOUDFLARE_DURABLE_OBJECT_BOOTSTRAP_PATH: "modules/platform/durable-object-migration-bootstrap.js",
    TAKOS_CLOUDFLARE_DURABLE_OBJECT_LIFECYCLE: JSON.stringify(DURABLE_OBJECT_LIFECYCLE),
    TAKOS_CONTAINER_IMAGE: DOCKER_IMAGE,
    TAKOS_EXECUTOR_TIER1_MAX_INSTANCES: "1",
    TAKOS_EXECUTOR_TIER2_MAX_INSTANCES: "1",
    TAKOS_EXECUTOR_TIER3_MAX_INSTANCES: "1",
    TAKOS_CLOUDFLARE_CONTAINER_DESIRED_CONFIG_CONTENT: recoveryDesiredConfig(),
  };
  const state = recoveryTerraformState(receiptInput);
  options.mutateState?.(state);
  if (options.receipt === "symlink") {
    await writeFile(join(absoluteDirectory, "state-receipt.json"), JSON.stringify(state));
    await symlink("state-receipt.json", join(absoluteDirectory, "terraform.tfstate"));
  } else if (options.receipt !== "missing") {
    await writeFile(
      join(absoluteDirectory, "terraform.tfstate"),
      options.receipt === "malformed" ? "{" : JSON.stringify(state),
    );
  }
  const env: Record<string, string> = {
    ...receiptInput,
    CLOUDFLARE_API_TOKEN: "state-recovery-token",
  };
  if (options.omitDesiredContentFromEnvironment) {
    delete env.TAKOS_CLOUDFLARE_CONTAINER_DESIRED_CONFIG_CONTENT;
    // If recovery ever reads this mutable path before proving a live Worker,
    // it will fail with bridge_json_invalid instead of the exact Worker error.
    await writeFile(
      join(moduleDirectory, ".takos-build", "container-desired.json"),
      "{",
    );
  }
  if (options.receipt !== "missing") {
    env.TAKOS_CLOUDFLARE_RECOVERY_STATE_PATH =
      options.recoveryStatePath ?? "../terraform.tfstate";
  }
  const defaultRows: Readonly<Record<string, readonly Record<string, unknown>[]>> = {
    "takos-recovery-executor-tier1": [],
    "takos-recovery-executor-tier2": [],
    "takos-recovery-executor-tier3": [{
      id: "app-tier3",
      name: "takos-recovery-executor-tier3",
    }],
  };
  const defaultDetails: Readonly<Record<string, Record<string, unknown>>> = {
    "app-tier3": recoveryContainerDetail(
      "app-tier3",
      "takos-recovery-executor-tier3",
      "ns-tier3",
      "tier3",
    ),
  };
  const calls: Array<{ method: string; url: string }> = [];
  const deletedContainers = new Set<string>();
  let vectorDeleted = false;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = String(init?.method ?? "GET");
    calls.push({ method, url });
    if (url.endsWith("/workers/scripts/takos-recovery/deployments")) {
      return new Response(
        JSON.stringify({
          success: false,
          errors: [{ code: options.workerCode ?? 10007, message: "not found" }],
        }),
        {
          status: options.workerStatus ?? 404,
          headers: { "content-type": "application/json" },
        },
      );
    }
    const listMatch = url.match(/\/containers\/applications\?name=([^&]+)/u);
    if (method === "GET" && listMatch) {
      const name = decodeURIComponent(listMatch[1]!);
      return envelope((options.containerRowsByName ?? defaultRows)[name] ?? []);
    }
    const detailMatch = url.match(/\/containers\/applications\/([^/]+)$/u);
    if (detailMatch) {
      const id = decodeURIComponent(detailMatch[1]!);
      if (method === "DELETE") {
        deletedContainers.add(id);
        return envelope(null);
      }
      if (deletedContainers.has(id)) {
        return new Response(
          JSON.stringify({ success: false, errors: [{ code: 1609 }] }),
          { status: 404, headers: { "content-type": "application/json" } },
        );
      }
      const detail = (options.containerDetailsById ?? defaultDetails)[id];
      return detail === undefined
        ? envelope({ error: "unexpected container" }, 500)
        : envelope(detail);
    }
    if (url.endsWith("/vectorize/v2/indexes/takos-recovery-embeddings")) {
      if (method === "DELETE") {
        vectorDeleted = true;
        return envelope(null);
      }
      if (vectorDeleted || options.vectorDetail === null) {
        return new Response("", { status: 404 });
      }
      return envelope(
        options.vectorDetail ?? {
          name: "takos-recovery-embeddings",
          config: { dimensions: 768, metric: "cosine" },
        },
      );
    }
    return envelope({ error: `unexpected ${method} ${url}` }, 500);
  };
  return {
    directory: absoluteDirectory,
    calls,
    run: () =>
      runBridge("recovery-cleanup", {
        env,
        cwd: moduleDirectory,
        fetchImpl,
        containersReadinessRetryAttempts: 1,
        containersReadinessRetryDelayMs: 0,
      }),
    cleanup: () => rm(absoluteDirectory, { force: true, recursive: true }),
  };
}

test("Durable Object migration resumes only after the current known tag", () => {
  expect(
    pendingDurableObjectMigration("v6", DURABLE_OBJECT_LIFECYCLE),
  ).toEqual({
    old_tag: "v6",
    new_tag: "v7",
    steps: [{ deleted_classes: ["TakosRuntimeContainer"] }],
  });
  expect(
    pendingDurableObjectMigration("v7", DURABLE_OBJECT_LIFECYCLE),
  ).toBeNull();
  expect(() =>
    pendingDurableObjectMigration("foreign-tag", DURABLE_OBJECT_LIFECYCLE)
  ).toThrow("durable_object_migration_tag_unknown");
});

test("CLI failures expose only bounded Cloudflare surface diagnostics", () => {
  expect(
    cloudflareApiFailureDetail(
      "POST",
      "/accounts/sensitive-account/containers/applications",
      400,
      { success: false, errors: [{ code: 1602, message: "unsafe detail" }] },
    ),
  ).toBe("POST:containers.applications:400:CF1602");
  expect(
    cloudflareApiFailureDetail(
      "POST",
      "/accounts/sensitive-account/containers/applications",
      400,
      { error: "DURABLE_OBJECT_NOT_CONTAINER_ENABLED" },
    ),
  ).toBe(
    "POST:containers.applications:400:DURABLE_OBJECT_NOT_CONTAINER_ENABLED",
  );
  expect(
    cloudflareApiFailureDetail(
      "POST",
      "/accounts/sensitive-account/containers/applications",
      400,
      {
        success: false,
        errors: [{
          code: 1607,
          message: "Container validation: DURABLE_OBJECT_NOT_CONTAINER_ENABLED",
        }],
      },
    ),
  ).toBe(
    "POST:containers.applications:400:DURABLE_OBJECT_NOT_CONTAINER_ENABLED",
  );
  expect(
    bridgeFailurePayload(
      "cloudflare_api_error",
      "POST:containers.applications:400:CF1602",
    ),
  ).toEqual({
    ok: false,
    error: "cloudflare_api_error",
    detail: "POST:containers.applications:400:CF1602",
  });
  expect(
    bridgeFailurePayload(
      "cloudflare_api_error",
      "POST:/accounts/secret-token/containers/applications:400",
    ),
  ).toEqual({ ok: false, error: "cloudflare_api_error" });
  expect(
    bridgeFailurePayload("bridge_input_missing", "CLOUDFLARE_API_TOKEN"),
  ).toEqual({ ok: false, error: "bridge_input_missing" });
});

test("container desired template expands explicit worker/image/capacity values", async () => {
  const directory = await mkdtemp("takos-cloudflare-bridge-test-");
  try {
    const path = join(directory, "containers.json");
    await writeFile(
      path,
      JSON.stringify({
        applications: [
          {
            name: "${TAKOS_CLOUDFLARE_WORKER_NAME}-executor-tier1",
            durable_object_class: "ExecutorContainerTier1",
            image: "${TAKOS_CONTAINER_IMAGE}",
            instance_type: "lite",
            max_instances: "${TAKOS_EXECUTOR_TIER1_MAX_INSTANCES:-1}",
            rollout_active_grace_period: 900,
          },
          {
            name: "${TAKOS_CLOUDFLARE_WORKER_NAME}-executor-tier2",
            durable_object_class: "ExecutorContainerTier2",
            image: "${TAKOS_CONTAINER_IMAGE}",
            instance_type: "basic",
            max_instances: "${TAKOS_EXECUTOR_TIER2_MAX_INSTANCES:-2}",
            rollout_active_grace_period: 900,
          },
          {
            name: "${TAKOS_CLOUDFLARE_WORKER_NAME}-executor-tier3",
            durable_object_class: "ExecutorContainerTier3",
            image: "${TAKOS_CONTAINER_IMAGE}",
            instance_type: { vcpu: 1, memory_mib: 12288, disk_mb: 4000 },
            max_instances: "${TAKOS_EXECUTOR_TIER3_MAX_INSTANCES:-1}",
            rollout_active_grace_period: 900,
          },
        ],
      }),
    );
    const rows = await containerRows(path, {
      TAKOS_CLOUDFLARE_WORKER_NAME: "takos-staging",
      TAKOS_CONTAINER_IMAGE: DOCKER_IMAGE,
      TAKOS_EXECUTOR_TIER1_MAX_INSTANCES: "3",
    });
    expect(rows.map((row) => row.name)).toEqual([
      "takos-staging-executor-tier1",
      "takos-staging-executor-tier2",
      "takos-staging-executor-tier3",
    ]);
    expect(rows.map((row) => row.maxInstances)).toEqual([3, 2, 1]);
    expect(rows.every((row) => row.image === DOCKER_IMAGE)).toBe(true);

    const sameAccountImage =
      "registry.cloudflare.com/" + "a".repeat(32) + "/takos-agent@sha256:" + "a".repeat(64);
    const accountRows = await containerRows(path, {
      TAKOS_CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
      TAKOS_CLOUDFLARE_WORKER_NAME: "takos-staging",
      TAKOS_CONTAINER_IMAGE: sameAccountImage,
    });
    expect(accountRows.every((row) => row.image === sameAccountImage)).toBe(true);
    await expect(
      containerRows(path, {
        TAKOS_CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
        TAKOS_CLOUDFLARE_WORKER_NAME: "takos-staging",
        TAKOS_CONTAINER_IMAGE: sameAccountImage,
      }),
    ).rejects.toThrow("container_image_account_mismatch");

    await writeFile(
      path,
      JSON.stringify({
        applications: [0, 1, 2].map((index) => ({
          name: `worker-${index}`,
          durable_object_class: `ExecutorContainerTier${index + 1}`,
          image: index === 0 ? "${CLOUDFLARE_API_TOKEN}" : DOCKER_IMAGE,
          instance_type: "lite",
          max_instances: 1,
          rollout_active_grace_period: 900,
        })),
      }),
    );
    await expect(
      containerRows(path, { CLOUDFLARE_API_TOKEN: "do-not-persist-this" }),
    ).rejects.toThrow("container_template_env_missing");

    await writeFile(
      path,
      JSON.stringify({
        applications: [
          {
            name: "worker-executor-tier1",
            durable_object_class: "ExecutorContainerTier1",
            image: "ghcr.io/tako0614/takos-agent@sha256:" + "a".repeat(64),
            instance_type: "lite",
            max_instances: 1,
            rollout_active_grace_period: 900,
          },
          {
            name: "worker-executor-tier2",
            durable_object_class: "ExecutorContainerTier2",
            image: DOCKER_IMAGE,
            instance_type: "basic",
            max_instances: 1,
            rollout_active_grace_period: 900,
          },
          {
            name: "worker-executor-tier3",
            durable_object_class: "ExecutorContainerTier3",
            image: DOCKER_IMAGE,
            instance_type: { vcpu: 1, memory_mib: 12288, disk_mb: 4000 },
            max_instances: 1,
            rollout_active_grace_period: 900,
          },
        ],
      }),
    );
    await expect(
      containerRows(path, { TAKOS_CLOUDFLARE_ACCOUNT_ID: "a".repeat(32) }),
    ).rejects.toThrow("container_image_ghcr_unsupported");

    await writeFile(path, JSON.stringify({ applications: [{ image: "registry.cloudflare.com/acct/agent@sha256:" + "a".repeat(64) }] }));
    await expect(containerRows(path, {})).rejects.toThrow("three_applications");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("pre-worker reconciliation is idempotent and exposes stable digests without echoing the token", async () => {
  const directory = await mkdtemp("takos-cloudflare-bridge-test-");
  try {
    const absoluteDirectory = resolve(directory);
    const assetsDirectory = join(absoluteDirectory, "assets");
    const artifactPath = join(absoluteDirectory, "worker.js");
    const bootstrapPath = join(absoluteDirectory, "durable-object-migration-bootstrap.js");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(assetsDirectory);
    await mkdir(join(assetsDirectory, "a"));
    await writeFile(artifactPath, "export default {};\n");
    await writeFile(join(assetsDirectory, "a", "child.js"), "export const nested = true;\n");
    await writeFile(join(assetsDirectory, "a.txt"), "root asset\n");
    await writeFile(join(assetsDirectory, "index.js"), "export const asset = true;\n");
    await writeFile(
      bootstrapPath,
      "export class ExecutorContainerTier1 {}; export default {};\n",
    );
    const env: Record<string, string> = {
      TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_MODE: "staging",
      TAKOS_CLOUDFLARE_ENVIRONMENT: "staging",
      TAKOS_CLOUDFLARE_ACCOUNT_ID: "account-1",
      TAKOS_CLOUDFLARE_WORKER_NAME: "takos-staging",
      TAKOS_CLOUDFLARE_VECTOR_INDEX_NAME: "takos-staging-embeddings",
      TAKOS_CLOUDFLARE_VECTOR_INDEX_DIMENSIONS: "768",
      TAKOS_CLOUDFLARE_VECTOR_INDEX_METRIC: "cosine",
      TAKOS_CLOUDFLARE_WORKER_ARTIFACT_PATH: artifactPath,
      TAKOS_CLOUDFLARE_WORKER_ASSETS_PATH: assetsDirectory,
      TAKOS_CLOUDFLARE_DURABLE_OBJECT_BOOTSTRAP_PATH: bootstrapPath,
      TAKOS_CLOUDFLARE_DURABLE_OBJECT_LIFECYCLE: JSON.stringify(
        DURABLE_OBJECT_LIFECYCLE,
      ),
      CLOUDFLARE_API_TOKEN: "do-not-print-this-token",
    };
    let vectorExists = false;
    let durableObjectMigrationTag: string | undefined;
    let workerVersionBindings: readonly Record<string, unknown>[] = [];
    const calls: string[] = [];
    const durableObjectUploads: Array<{
      metadata: Record<string, unknown>;
      bootstrap: string;
      url: string;
    }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = String(init?.method ?? "GET");
      calls.push(`${method} ${url}`);
      if (url.endsWith("/containers/applications") && method === "GET") {
        return new Response("[]", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/workers/scripts") && method === "GET") {
        return envelope(
          durableObjectMigrationTag === undefined
            ? []
            : [
                {
                  id: "takos-staging",
                  migration_tag: durableObjectMigrationTag,
                },
          ],
        );
      }
      if (url.endsWith("/workers/scripts/takos-staging/deployments")) {
        return envelope({
          versions: [{ version_id: "bootstrap-version", percentage: 100 }],
        });
      }
      if (url.endsWith("/workers/scripts/takos-staging/versions/bootstrap-version")) {
        return envelope({ resources: { bindings: workerVersionBindings } });
      }
      if (
        url.includes("/workers/scripts/takos-staging?") &&
        method === "PUT"
      ) {
        const form = await new Request(url, init).formData();
        const metadataValue = form.get("metadata");
        const bootstrapValue = form.get("durable-object-migration-bootstrap.js");
        if (
          typeof metadataValue !== "string" ||
          !(bootstrapValue instanceof Blob)
        ) {
          throw new Error("invalid worker bootstrap multipart body");
        }
        const metadata = JSON.parse(metadataValue) as Record<string, unknown>;
        const migrations = metadata.migrations;
        if (migrations && typeof migrations === "object" && !Array.isArray(migrations)) {
          const newTag = (migrations as { new_tag?: unknown }).new_tag;
          if (typeof newTag === "string") durableObjectMigrationTag = newTag;
        }
        workerVersionBindings = Array.isArray(metadata.bindings)
          ? metadata.bindings.filter(
              (binding): binding is Record<string, unknown> =>
                typeof binding === "object" && binding !== null && !Array.isArray(binding),
            )
          : [];
        durableObjectUploads.push({
          metadata,
          bootstrap: await bootstrapValue.text(),
          url,
        });
        return envelope({ deployment_id: "bootstrap-version" });
      }
      if (url.endsWith("/vectorize/v2/indexes/takos-staging-embeddings")) {
        if (!vectorExists) return envelope({ error: "missing" }, 404);
        return envelope({
          name: "takos-staging-embeddings",
          config: { dimensions: 768, metric: "cosine" },
        });
      }
      if (url.endsWith("/vectorize/v2/indexes") && method === "POST") {
        vectorExists = true;
        return envelope({});
      }
      return envelope({ error: "unexpected" }, 500);
    };
    const first = await runBridge("pre-worker", { env, cwd: directory, fetchImpl });
    expect(first.ok).toBe(true);
    expect(calls[0]).toBe(
      "GET https://api.cloudflare.com/client/v4/accounts/account-1/containers/applications",
    );
    expect(
      calls.findIndex((call) => call.startsWith("PUT https://api.cloudflare.com/client/v4/accounts/account-1/workers/scripts/")),
    ).toBeGreaterThan(0);
    expect(first.vector.status).toBe("created");
    expect(first.durableObjects.status).toBe("migrated");
    expect(first).not.toHaveProperty("d1");
    expect(first.digests).not.toHaveProperty("migrationDigest");
    expect(calls.every((call) => !call.includes("/d1/database/"))).toBe(true);
    expect(first.digests.desiredDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(first.digests.helperDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    const hash = (value: string) => createHash("sha256").update(value).digest("hex");
    const expectedWorkerArtifactDigest = hash([
      `worker/index.js:${hash("export default {};\n")}`,
      `assets/a.txt:${hash("root asset\n")}`,
      `assets/a/child.js:${hash("export const nested = true;\n")}`,
      `assets/index.js:${hash("export const asset = true;\n")}`,
    ].join("|"));
    expect(first.digests.workerArtifactDigest).toBe(
      `sha256:${expectedWorkerArtifactDigest}`,
    );
    expect(durableObjectUploads).toHaveLength(2);
    expect(durableObjectUploads[0]?.url).toEndWith(
      "/workers/scripts/takos-staging?excludeScript=true&bindings_inherit=strict",
    );
    expect(durableObjectUploads[0]?.metadata).toEqual({
      main_module: "durable-object-migration-bootstrap.js",
      compatibility_date: "2026-04-01",
      bindings: DURABLE_OBJECT_LIFECYCLE.container_bindings.map((binding) => ({
        ...binding,
        type: "durable_object_namespace",
      })),
      containers: DURABLE_OBJECT_LIFECYCLE.container_bindings.map(
        ({ class_name }) => ({ class_name }),
      ),
      migrations: {
        new_tag: "v7",
        steps: DURABLE_OBJECT_LIFECYCLE.steps,
      },
    });
    expect(durableObjectUploads[1]?.metadata).toEqual({
      main_module: "durable-object-migration-bootstrap.js",
      compatibility_date: "2026-04-01",
      bindings: [
        ...DURABLE_OBJECT_LIFECYCLE.container_bindings.map((binding) => ({
          ...binding,
          type: "durable_object_namespace",
        })),
        {
          name: "VECTORIZE",
          type: "vectorize",
          index_name: "takos-staging-embeddings",
        },
      ],
      containers: DURABLE_OBJECT_LIFECYCLE.container_bindings.map(
        ({ class_name }) => ({ class_name }),
      ),
    });
    expect(durableObjectUploads[0]?.bootstrap).toContain(
      "ExecutorContainerTier1",
    );
    expect(JSON.stringify(first)).not.toContain(env.CLOUDFLARE_API_TOKEN);
    const second = await runBridge("pre-worker", { env, cwd: directory, fetchImpl });
    expect(second.vector.status).toBe("present");
    expect(second.durableObjects.status).toBe("present");
    expect(second.changed).toBe(false);
    expect(durableObjectUploads).toHaveLength(2);
    expect(calls.every((call) => !call.includes(env.CLOUDFLARE_API_TOKEN))).toBe(true);
    await writeFile(join(assetsDirectory, "asset-only.js"), "export const changed = true;\n");
    const assetChanged = await runBridge("pre-worker", { env, cwd: directory, fetchImpl });
    expect(assetChanged.digests.workerArtifactDigest).not.toBe(
      first.digests.workerArtifactDigest,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("post-worker reconciliation uses the raw Containers applications endpoint, exact name filters, and PATCH", async () => {
  const directory = await mkdtemp("takos-cloudflare-bridge-test-");
  try {
    const absoluteDirectory = resolve(directory);
    const assetsDirectory = join(absoluteDirectory, "assets");
    const artifactPath = join(absoluteDirectory, "worker.js");
    const configPath = join(absoluteDirectory, "containers.json");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(assetsDirectory);
    await writeFile(artifactPath, "export default {};\n");
    await writeFile(join(assetsDirectory, "index.js"), "export const asset = true;\n");
    await writeFile(
      configPath,
      JSON.stringify({
        applications: [
          {
            name: "takos-executor-tier1",
            durable_object_class: "ExecutorContainerTier1",
            image: "${TAKOS_CONTAINER_IMAGE}",
            instance_type: "lite",
            max_instances: "${TAKOS_EXECUTOR_TIER1_MAX_INSTANCES:-1}",
            rollout_active_grace_period: 900,
          },
          {
            name: "takos-executor-tier2",
            durable_object_class: "ExecutorContainerTier2",
            image: "${TAKOS_CONTAINER_IMAGE}",
            instance_type: "basic",
            max_instances: "${TAKOS_EXECUTOR_TIER2_MAX_INSTANCES:-1}",
            rollout_active_grace_period: 900,
          },
          {
            name: "takos-executor-tier3",
            durable_object_class: "ExecutorContainerTier3",
            image: "${TAKOS_CONTAINER_IMAGE}",
            instance_type: { vcpu: 1, memory_mib: 12288, disk_mb: 4000 },
            max_instances: "${TAKOS_EXECUTOR_TIER3_MAX_INSTANCES:-1}",
            rollout_active_grace_period: 900,
          },
        ],
      }),
    );
    const originalConfigContent = await readFile(configPath, "utf8");
    const accountId = "a".repeat(32);
    const env: Record<string, string> = {
      TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_MODE: "staging",
      TAKOS_CLOUDFLARE_ENVIRONMENT: "staging",
      TAKOS_CLOUDFLARE_ACCOUNT_ID: accountId,
      TAKOS_CLOUDFLARE_WORKER_NAME: "takos",
      TAKOS_CLOUDFLARE_VECTOR_INDEX_NAME: "takos-embeddings",
      TAKOS_CLOUDFLARE_VECTOR_INDEX_DIMENSIONS: "768",
      TAKOS_CLOUDFLARE_VECTOR_INDEX_METRIC: "cosine",
      TAKOS_CLOUDFLARE_WORKER_ARTIFACT_PATH: artifactPath,
      TAKOS_CLOUDFLARE_WORKER_ASSETS_PATH: assetsDirectory,
      TAKOS_CLOUDFLARE_CONTAINER_DESIRED_CONFIG_PATH: configPath,
      TAKOS_CONTAINER_IMAGE: DOCKER_IMAGE,
      TAKOS_EXECUTOR_TIER1_MAX_INSTANCES: "2",
      TAKOS_EXECUTOR_TIER2_MAX_INSTANCES: "2",
      TAKOS_EXECUTOR_TIER3_MAX_INSTANCES: "2",
      CLOUDFLARE_API_TOKEN: "container-test-token",
    };
    const details = new Map<string, Record<string, unknown>>();
    const names = ["tier1", "tier2", "tier3"];
    const normalizeNamedCapacity = (
      value: Record<string, unknown>,
    ): Record<string, unknown> => {
      const configuration = value.configuration;
      if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) {
        return value;
      }
      const row = configuration as Record<string, unknown>;
      const normalized = row.instance_type === "lite"
        ? { vcpu: 0.0625, memory_mib: 256, disk: { size: "2GB", size_mb: 2000 } }
        : row.instance_type === "basic"
          ? { vcpu: 0.25, memory_mib: 1024, disk: { size: "4GB", size_mb: 4000 } }
          : null;
      if (normalized === null) return value;
      const { instance_type: _instanceType, ...rest } = row;
      return { ...value, configuration: { ...rest, ...normalized } };
    };
    names.slice(1).forEach((tier, offset) => {
      const index = offset + 1;
      details.set(`app-${tier}`, {
        id: `app-${tier}`,
        name: `takos-executor-${tier}`,
        configuration: {
          image: "docker.io/example/old@sha256:" + "b".repeat(64),
          instance_type: index === 0 ? "lite" : index === 1 ? "basic" : { vcpu: 1, memory_mib: 1024, disk_mb: 100 },
        },
        max_instances: 1,
        durable_objects: { namespace_id: `ns-${index + 1}` },
        rollout_active_grace_period: 600,
      });
    });
    let vectorExists = true;
    let firstTier1ListIsNotReady = true;
    let containerCreateIsNotReady = false;
    const deletedContainerIds = new Set<string>();
    const readinessDelays: number[] = [];
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = String(init?.method ?? "GET");
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
      calls.push({ method, url, body });
      if (url.endsWith("/workers/scripts/takos/deployments")) {
        return envelope({ versions: [{ version_id: "v1", percentage: 100 }] });
      }
      if (url.endsWith("/workers/scripts/takos/versions/v1")) {
        return envelope({
          resources: {
            bindings: names.map((tier, index) => ({
              type: "durable_object_namespace",
              class_name: `ExecutorContainerTier${index + 1}`,
              namespace_id: `ns-${index + 1}`,
            })).concat([
              { type: "vectorize", index_name: "takos-embeddings" },
            ]),
          },
        });
      }
      if (url.endsWith("/vectorize/v2/indexes/takos-embeddings")) {
        if (method === "DELETE") {
          vectorExists = false;
          return envelope(null);
        }
        return vectorExists
          ? envelope({ name: "takos-embeddings", config: { dimensions: 768, metric: "cosine" } })
          : envelope({ error: "missing" }, 404);
      }
      if (method === "GET" && url.endsWith("/containers/applications")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      const listMatch = url.match(/\/containers\/applications\?name=([^&]+)/u);
      if (method === "GET" && listMatch) {
        const name = decodeURIComponent(listMatch[1]!);
        if (name === "takos-executor-tier1" && firstTier1ListIsNotReady) {
          firstTier1ListIsNotReady = false;
          return new Response(
            JSON.stringify({
              success: false,
              errors: [{ code: 1609, message: "Containers application state is not ready" }],
            }),
            { status: 404, headers: { "content-type": "application/json" } },
          );
        }
        const existing = [...details.values()].find((detail) => detail.name === name);
        // Wrangler's v4 client receives `result` plus pagination metadata and
        // exposes the result array as `data` to its callers.
        return new Response(
          JSON.stringify({
            success: true,
            result: existing === undefined ? [] : [{ id: existing.id, name: existing.name }],
            result_info: { page: 1, per_page: 1, total_count: existing === undefined ? 0 : 1 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      const detailMatch = url.match(/\/containers\/applications\/([^/]+)$/u);
      if (method === "POST" && url.endsWith("/containers/applications")) {
        if (containerCreateIsNotReady) {
          return new Response(
            JSON.stringify({ success: false, errors: [{ code: 1609 }] }),
            { status: 404, headers: { "content-type": "application/json" } },
          );
        }
        if (!body || typeof body !== "object") return envelope({ error: "invalid" }, 400);
        const created = normalizeNamedCapacity({ id: "app-tier1", ...(body as Record<string, unknown>) });
        details.set("app-tier1", created);
        return envelope(created);
      }
      if (detailMatch) {
        const id = decodeURIComponent(detailMatch[1]!);
        if (method === "GET") {
          const detail = details.get(id);
          if (detail !== undefined) return envelope(detail);
          if (deletedContainerIds.has(id)) {
            return new Response(
              JSON.stringify({
                success: false,
                errors: [{ code: 1609, message: "Container application is not ready" }],
              }),
              { status: 404, headers: { "content-type": "application/json" } },
            );
          }
          return envelope({ error: "missing" }, 404);
        }
        if (method === "PATCH") {
          const current = details.get(id);
          if (current === undefined || !body || typeof body !== "object") return envelope({ error: "missing" }, 404);
          const update = body as Record<string, unknown>;
          details.set(id, normalizeNamedCapacity({ ...current, ...update }));
          return envelope(details.get(id));
        }
        if (method === "DELETE") {
          details.delete(id);
          deletedContainerIds.add(id);
          return envelope(null);
        }
      }
      return envelope({ error: `unexpected ${method} ${url}` }, 500);
    };
    const capability = await runBridge("capability-preflight", { env, fetchImpl });
    expect(capability.changed).toBe(false);
    const evidence = await runBridge("post-worker", {
      env,
      cwd: directory,
      fetchImpl,
      containersReadinessRetryAttempts: 2,
      containersReadinessRetryDelayMs: 137,
      containersReadinessDelay: async (delayMs) => {
        readinessDelays.push(delayMs);
      },
    });
    expect(evidence.containers.reconciled).toEqual([
      "takos-executor-tier1",
      "takos-executor-tier2",
      "takos-executor-tier3",
    ]);
    expect(evidence.changed).toBe(true);
    expect(calls.filter(({ method }) => method === "PATCH")).toHaveLength(2);
    const createCall = calls.find(
      ({ method, url }) => method === "POST" && url.endsWith("/containers/applications"),
    );
    expect(createCall?.body).toMatchObject({
      name: "takos-executor-tier1",
      scheduling_policy: "default",
      configuration: {
        image: DOCKER_IMAGE,
        instance_type: "lite",
      },
      instances: 0,
      max_instances: 2,
      durable_objects: { namespace_id: "ns-1" },
    });
    const tier1ListUrl =
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/containers/applications?name=takos-executor-tier1`;
    const containerReadinessSequence = calls.filter(({ method, url }) =>
      method === "POST" && url.endsWith("/containers/applications") ||
      method === "GET" &&
        (url.endsWith("/containers/applications") || url === tier1ListUrl)
    );
    expect(containerReadinessSequence.map(({ method, url }) => ({ method, url }))).toEqual([
      {
        method: "GET",
        url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/containers/applications`,
      },
      { method: "GET", url: tier1ListUrl },
      { method: "GET", url: tier1ListUrl },
      {
        method: "POST",
        url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/containers/applications`,
      },
    ]);
    expect(readinessDelays).toEqual([137]);
    const customTierPatch = calls.find(
      ({ method, url }) => method === "PATCH" && url.endsWith("/app-tier3"),
    );
    expect(customTierPatch?.body).toMatchObject({
      scheduling_policy: "default",
      configuration: {
        image: DOCKER_IMAGE,
        vcpu: 1,
        memory_mib: 12288,
        disk: { size_mb: 4000 },
      },
    });
    expect(customTierPatch?.body).not.toMatchObject({
      configuration: { instance_type: expect.anything() },
    });
    expect(customTierPatch?.body).not.toHaveProperty("name");
    expect(customTierPatch?.body).not.toHaveProperty("instances");
    expect(customTierPatch?.body).not.toHaveProperty("durable_objects");
    expect(calls.some(({ method }) => method === "PUT")).toBe(false);
    const listCalls = calls.filter(({ url }) => url.includes("/containers/applications?name="));
    expect(listCalls.map(({ url }) => new URL(url).searchParams.get("name"))).toEqual([
      "takos-executor-tier1",
      "takos-executor-tier1",
      "takos-executor-tier2",
      "takos-executor-tier3",
    ]);
    expect(listCalls.every(({ url }) => url.includes(`/accounts/${accountId}/containers/applications?name=`))).toBe(true);

    const tier1Detail = details.get("app-tier1");
    expect(tier1Detail).toBeDefined();
    details.delete("app-tier1");
    containerCreateIsNotReady = true;
    const createCallsBeforeFailure = calls.filter(
      ({ method, url }) => method === "POST" && url.endsWith("/containers/applications"),
    ).length;
    await expect(
      runBridge("post-worker", {
        env,
        cwd: directory,
        fetchImpl,
        containersReadinessRetryAttempts: 3,
        containersReadinessRetryDelayMs: 0,
      }),
    ).rejects.toMatchObject({
      code: "cloudflare_api_error",
      detail: "POST:containers.applications:404:CF1609",
    });
    expect(
      calls.filter(
        ({ method, url }) => method === "POST" && url.endsWith("/containers/applications"),
      ),
    ).toHaveLength(createCallsBeforeFailure + 1);
    containerCreateIsNotReady = false;
    if (tier1Detail === undefined) throw new Error("missing tier1 detail");
    details.set("app-tier1", tier1Detail);

    const second = await runBridge("post-worker", { env, cwd: directory, fetchImpl });
    expect(second.changed).toBe(false);
    expect(calls.filter(({ method }) => method === "PATCH")).toHaveLength(2);

    const productionEnv = {
      ...env,
      TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_MODE: "disposable-production",
      TAKOS_CLOUDFLARE_ENVIRONMENT: "production",
      TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_ACKNOWLEDGEMENT:
        CLOUDFLARE_PROVIDER_GAP_BRIDGE_ACKNOWLEDGEMENT,
    };
    const production = await runBridge("post-worker", {
      env: productionEnv,
      cwd: directory,
      fetchImpl,
    });
    expect(production.bridgeMode).toBe("disposable-production");
    expect(production.digests.bridgeActivationDigest).not.toBe(
      second.digests.bridgeActivationDigest,
    );

    const changedInputEnv = {
      ...productionEnv,
      TAKOS_CONTAINER_IMAGE:
        "docker.io/library/alpine@sha256:" + "c".repeat(64),
      TAKOS_EXECUTOR_TIER1_MAX_INSTANCES: "3",
    };
    const changedInputs = await runBridge("post-worker", {
      env: changedInputEnv,
      cwd: directory,
      fetchImpl,
    });
    expect(changedInputs.digests.desiredDigest).not.toBe(
      production.digests.desiredDigest,
    );

    // Simulate a trigger replacement where the working-tree template has
    // already been replaced by a new image. Destroy must use the old
    // content captured in state, not reread this mutable path.
    const replacementImage =
      "docker.io/library/alpine@sha256:" + "b".repeat(64);
    const replacementConfig = JSON.parse(originalConfigContent) as {
      applications: Array<Record<string, unknown>>;
    };
    for (const row of replacementConfig.applications) row.image = replacementImage;
    await writeFile(configPath, JSON.stringify(replacementConfig));

    const cleanup = await runBridge("recovery-cleanup", {
      env: {
        ...changedInputEnv,
        // The old state points at a template path that was renamed away; the
        // immutable content snapshot is the only valid cleanup input.
        TAKOS_CLOUDFLARE_CONTAINER_DESIRED_CONFIG_PATH:
          "renamed-container-desired.json",
        TAKOS_CLOUDFLARE_CONTAINER_DESIRED_CONFIG_CONTENT: originalConfigContent,
      },
      cwd: directory,
      fetchImpl,
    });
    expect(cleanup.vector.status).toBe("deleted");
    expect(cleanup.containers.deleted).toEqual([
      "takos-executor-tier1",
      "takos-executor-tier2",
      "takos-executor-tier3",
    ]);
    expect(cleanup.changed).toBe(true);
    expect(calls.every(({ url }) => !url.includes("/d1/database/"))).toBe(true);
    const cleanupAgain = await runBridge("recovery-cleanup", {
      env: changedInputEnv,
      cwd: directory,
      fetchImpl,
    });
    expect(cleanupAgain.vector.status).toBe("present");
    expect(cleanupAgain.containers.deleted).toEqual([]);
    expect(cleanupAgain.changed).toBe(false);

    const legacyInput = Object.fromEntries(
      Object.entries(changedInputEnv).filter(
        ([name]) =>
          ![
            "TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_MODE",
            "TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_ACKNOWLEDGEMENT",
            "TAKOS_CLOUDFLARE_ENVIRONMENT",
            "TAKOS_CLOUDFLARE_WORKER_ASSETS_PATH",
          ].includes(name),
      ),
    );
    const normalizedLegacyInput = {
      ...legacyInput,
      TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_MODE: "staging",
      TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_ACKNOWLEDGEMENT: "",
      TAKOS_CLOUDFLARE_ENVIRONMENT: "staging",
    };
    const legacyCleanup = await runBridge("recovery-cleanup", {
      env: normalizedLegacyInput,
      cwd: directory,
      fetchImpl,
    });
    expect(legacyCleanup.changed).toBe(false);
    expect(legacyCleanup.digests.workerArtifactDigest).toBe(
      `sha256:${createHash("sha256").update(await readFile(artifactPath)).digest("hex")}`,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("pre-worker proves Vectorize ownership on the bootstrap version", async () => {
  const directory = await mkdtemp("takos-cloudflare-bridge-test-");
  try {
    const absoluteDirectory = resolve(directory);
    const assetsDirectory = join(absoluteDirectory, "assets");
    const artifactPath = join(absoluteDirectory, "worker.js");
    const bootstrapPath = join(absoluteDirectory, "durable-object-migration-bootstrap.js");
    const containerPath = join(absoluteDirectory, "containers.json");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(assetsDirectory);
    await writeFile(join(assetsDirectory, "index.js"), "export const asset = true;\n");
    await writeFile(artifactPath, "export default {};\n");
    await writeFile(bootstrapPath, "export class ExecutorContainerTier1 {}; export default {};\n");
    await writeFile(
      containerPath,
      JSON.stringify({
        applications: [
          {
            name: "takos-executor-tier1",
            durable_object_class: "ExecutorContainerTier1",
            image: DOCKER_IMAGE,
            instance_type: "lite",
            max_instances: 1,
            rollout_active_grace_period: 900,
          },
          {
            name: "takos-executor-tier2",
            durable_object_class: "ExecutorContainerTier2",
            image: DOCKER_IMAGE,
            instance_type: "basic",
            max_instances: 1,
            rollout_active_grace_period: 900,
          },
          {
            name: "takos-executor-tier3",
            durable_object_class: "ExecutorContainerTier3",
            image: DOCKER_IMAGE,
            instance_type: { vcpu: 1, memory_mib: 12288, disk_mb: 4000 },
            max_instances: 1,
            rollout_active_grace_period: 900,
          },
        ],
      }),
    );
    const env: Record<string, string> = {
      TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_MODE: "staging",
      TAKOS_CLOUDFLARE_ENVIRONMENT: "staging",
      TAKOS_CLOUDFLARE_ACCOUNT_ID: "account-1",
      TAKOS_CLOUDFLARE_WORKER_NAME: "takos-staging",
      TAKOS_CLOUDFLARE_VECTOR_INDEX_NAME: "takos-staging-embeddings",
      TAKOS_CLOUDFLARE_VECTOR_INDEX_DIMENSIONS: "768",
      TAKOS_CLOUDFLARE_VECTOR_INDEX_METRIC: "cosine",
      TAKOS_CLOUDFLARE_WORKER_ARTIFACT_PATH: artifactPath,
      TAKOS_CLOUDFLARE_WORKER_ASSETS_PATH: assetsDirectory,
      TAKOS_CLOUDFLARE_CONTAINER_DESIRED_CONFIG_PATH: containerPath,
      TAKOS_CLOUDFLARE_DURABLE_OBJECT_BOOTSTRAP_PATH: bootstrapPath,
      TAKOS_CLOUDFLARE_DURABLE_OBJECT_LIFECYCLE: JSON.stringify(DURABLE_OBJECT_LIFECYCLE),
      CLOUDFLARE_API_TOKEN: "bootstrap-proof-token",
    };
    const namespaceIds = new Map([
      ["ExecutorContainerTier1", "ns-1"],
      ["ExecutorContainerTier2", "ns-2"],
      ["ExecutorContainerTier3", "ns-3"],
    ]);
    let vectorExists = false;
    let migrationTag: string | undefined;
    let activeVersion = "bootstrap-do-only";
    let activeBindings: readonly Record<string, unknown>[] = [];
    const uploads: Array<Record<string, unknown>> = [];
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    const uploadCallIndexes: number[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = String(init?.method ?? "GET");
      const body = init?.body === undefined ? undefined : String(init.body);
      calls.push({
        method,
        url,
        ...(body === undefined ? {} : { body: body.startsWith("{") ? JSON.parse(body) : body }),
      });
      if (url.endsWith("/workers/scripts") && method === "GET") {
        return envelope(
          migrationTag === undefined
            ? []
            : [{ id: "takos-staging", migration_tag: migrationTag }],
        );
      }
      if (url.endsWith("/containers/applications") && method === "GET") {
        return envelope([]);
      }
      if (url.endsWith("/workers/scripts/takos-staging/deployments")) {
        return envelope({ versions: [{ version_id: activeVersion, percentage: 100 }] });
      }
      if (url.endsWith(`/workers/scripts/takos-staging/versions/${activeVersion}`)) {
        return envelope({ resources: { bindings: activeBindings } });
      }
      if (url.includes("/workers/scripts/takos-staging?") && method === "PUT") {
        uploadCallIndexes.push(calls.length - 1);
        const form = await new Request(url, init).formData();
        const metadataValue = form.get("metadata");
        if (typeof metadataValue !== "string") throw new Error("missing bootstrap metadata");
        const metadata = JSON.parse(metadataValue) as Record<string, unknown>;
        uploads.push(metadata);
        const migrations = metadata.migrations;
        if (migrations && typeof migrations === "object" && !Array.isArray(migrations)) {
          const newTag = (migrations as { new_tag?: unknown }).new_tag;
          if (typeof newTag === "string") migrationTag = newTag;
        }
        activeVersion = uploads.length === 1 ? "bootstrap-do-only" : "bootstrap-vector-proof";
        activeBindings = Array.isArray(metadata.bindings)
          ? metadata.bindings.flatMap((binding) => {
              if (typeof binding !== "object" || binding === null || Array.isArray(binding)) return [];
              const row = binding as Record<string, unknown>;
              const namespaceId = typeof row.class_name === "string"
                ? namespaceIds.get(row.class_name)
                : undefined;
              return namespaceId === undefined ? [row] : [{ ...row, namespace_id: namespaceId }];
            })
          : [];
        return envelope({ deployment_id: activeVersion });
      }
      if (url.endsWith("/vectorize/v2/indexes/takos-staging-embeddings")) {
        if (method === "DELETE") {
          vectorExists = false;
          return envelope(null);
        }
        return vectorExists
          ? envelope({ name: "takos-staging-embeddings", config: { dimensions: 768, metric: "cosine" } })
          : envelope({ error: "missing" }, 404);
      }
      if (url.endsWith("/vectorize/v2/indexes") && method === "POST") {
        vectorExists = true;
        return envelope({});
      }
      if (url.includes("/containers/applications?name=") && method === "GET") {
        return envelope([]);
      }
      return envelope({ error: `unexpected ${method} ${url}` }, 500);
    };

    const preWorker = await runBridge("pre-worker", { env, cwd: directory, fetchImpl });
    expect(preWorker.vector.status).toBe("created");
    expect(vectorExists).toBe(true);
    expect(uploads).toHaveLength(2);
    expect(
      (uploads[0]?.bindings as Array<Record<string, unknown>>).some(
        (binding) => binding.name === "VECTORIZE",
      ),
    ).toBe(false);
    expect(
      (uploads[1]?.bindings as Array<Record<string, unknown>>).find(
        (binding) => binding.name === "VECTORIZE",
      ),
    ).toEqual({ name: "VECTORIZE", type: "vectorize", index_name: "takos-staging-embeddings" });
    const firstUpload = uploadCallIndexes[0] ?? -1;
    const vectorCreate = calls.findIndex(({ method, url }) => method === "POST" && url.endsWith("/vectorize/v2/indexes"));
    const proofUpload = uploadCallIndexes[1] ?? -1;
    expect(firstUpload).toBeGreaterThanOrEqual(0);
    expect(vectorCreate).toBeGreaterThan(firstUpload);
    expect(proofUpload).toBeGreaterThan(vectorCreate);

    const cleanup = await runBridge("recovery-cleanup", { env, cwd: directory, fetchImpl });
    expect(cleanup.vector.status).toBe("deleted");
    expect(cleanup.containers.deleted).toEqual([]);
    expect(calls.every(({ url }) => !url.includes("/d1/database/"))).toBe(true);
    expect(calls.some(({ method, url }) => method === "DELETE" && url.endsWith("/vectorize/v2/indexes/takos-staging-embeddings"))).toBe(true);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("the bridge helper carries no D1 migration surface", async () => {
  const helper = await readFile(
    new URL("./takos-cloudflare-opentofu-bridge.ts", import.meta.url),
    "utf8",
  );
  for (const token of [
    "_takos_opentofu_migrations",
    "d1Import",
    "d1Query",
    "migrationSetPath",
    "TAKOS_CLOUDFLARE_MIGRATION_SET_PATH",
    "TAKOS_CLOUDFLARE_D1_DATABASE_ID",
  ]) {
    expect(helper).not.toContain(token);
  }
});
