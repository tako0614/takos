import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

import {
  CLOUDFLARE_PROVIDER_GAP_BRIDGE_ACKNOWLEDGEMENT,
  bridgeFailurePayload,
  cloudflareApiFailureDetail,
  containerRows,
  migrationFiles,
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

function envelope(result: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: status >= 200 && status < 300, result }), {
    status,
    headers: { "content-type": "application/json" },
  });
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
    const migrationDirectory = join(absoluteDirectory, "migrations");
    const assetsDirectory = join(absoluteDirectory, "assets");
    const artifactPath = join(absoluteDirectory, "worker.js");
    const bootstrapPath = join(absoluteDirectory, "durable-object-migration-bootstrap.js");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(migrationDirectory);
    await mkdir(assetsDirectory);
    await mkdir(join(assetsDirectory, "a"));
    await writeFile(join(migrationDirectory, "0043_ap_followers.sql"), "CREATE TABLE ap_followers (id TEXT);\n");
    await writeFile(join(migrationDirectory, "0043_store_network_inventory_metadata.sql"), "CREATE TABLE store_network (id TEXT);\n");
    await writeFile(artifactPath, "export default {};\n");
    await writeFile(join(assetsDirectory, "a", "child.js"), "export const nested = true;\n");
    await writeFile(join(assetsDirectory, "a.txt"), "root asset\n");
    await writeFile(join(assetsDirectory, "index.js"), "export const asset = true;\n");
    await writeFile(
      bootstrapPath,
      "export class ExecutorContainerTier1 {}; export default {};\n",
    );
    const migrationSet = await migrationFiles(migrationDirectory);
    const env: Record<string, string> = {
      TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_MODE: "staging",
      TAKOS_CLOUDFLARE_ENVIRONMENT: "staging",
      TAKOS_CLOUDFLARE_ACCOUNT_ID: "account-1",
      TAKOS_CLOUDFLARE_WORKER_NAME: "takos-staging",
      TAKOS_CLOUDFLARE_D1_DATABASE_ID: "d1-1",
      TAKOS_CLOUDFLARE_VECTOR_INDEX_NAME: "takos-staging-embeddings",
      TAKOS_CLOUDFLARE_VECTOR_INDEX_DIMENSIONS: "768",
      TAKOS_CLOUDFLARE_VECTOR_INDEX_METRIC: "cosine",
      TAKOS_CLOUDFLARE_MIGRATION_SET_PATH: migrationDirectory,
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
    const ledger = new Map<string, string>();
    let imports = 0;
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
      if (url.endsWith("/d1/database/d1-1/query")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { sql?: string };
        if (body.sql?.startsWith("SELECT name")) {
          return envelope([{ success: true, results: [...ledger].map(([name, checksum]) => ({ name, checksum })) }]);
        }
        return envelope([{ success: true, results: [] }]);
      }
      if (url.endsWith("/d1/database/d1-1/import")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { action?: string };
        if (body.action === "init") {
          imports += 1;
          const migration = migrationSet[imports - 1];
          if (!migration) throw new Error("unexpected migration import");
          ledger.set(migration.name, `sha256:${migration.sha256}`);
          return envelope({ status: "complete" });
        }
      }
      return envelope({ error: "unexpected" }, 500);
    };
    const first = await runBridge("pre-worker", { env, cwd: directory, fetchImpl });
    expect(first.ok).toBe(true);
    expect(first.vector.status).toBe("created");
    expect(first.durableObjects.status).toBe("migrated");
    expect(first.d1.applied).toEqual([
      "0043_ap_followers.sql",
      "0043_store_network_inventory_metadata.sql",
    ]);
    expect(first.digests.desiredDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(first.digests.helperDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(first.digests.migrationDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
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
    expect(imports).toBe(2);
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
    const migrationDirectory = join(absoluteDirectory, "migrations");
    const assetsDirectory = join(absoluteDirectory, "assets");
    const artifactPath = join(absoluteDirectory, "worker.js");
    const configPath = join(absoluteDirectory, "containers.json");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(migrationDirectory);
    await mkdir(assetsDirectory);
    await writeFile(join(migrationDirectory, "0001_schema.sql"), "CREATE TABLE users (id TEXT);\n");
    await writeFile(artifactPath, "export default {};\n");
    await writeFile(join(assetsDirectory, "index.js"), "export const asset = true;\n");
    const migrationSet = await migrationFiles(migrationDirectory);
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
      TAKOS_CLOUDFLARE_D1_DATABASE_ID: "d1-1",
      TAKOS_CLOUDFLARE_VECTOR_INDEX_NAME: "takos-embeddings",
      TAKOS_CLOUDFLARE_VECTOR_INDEX_DIMENSIONS: "768",
      TAKOS_CLOUDFLARE_VECTOR_INDEX_METRIC: "cosine",
      TAKOS_CLOUDFLARE_MIGRATION_SET_PATH: migrationDirectory,
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
    let d1LedgerExists = true;
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
      if (url.endsWith("/d1/database/d1-1/query")) {
        const sql = (body as { sql?: string } | undefined)?.sql ?? "";
        if (sql.startsWith("SELECT name")) {
          if (!d1LedgerExists) {
            return envelope({ success: false, errors: [{ code: 9000, message: "no such table" }] });
          }
          return envelope([{ success: true, results: [{ name: "0001_schema.sql", checksum: `sha256:${migrationSet[0]!.sha256}` }] }]);
        }
        return envelope([{ success: true, results: [] }]);
      }
      const listMatch = url.match(/\/containers\/applications\?name=([^&]+)/u);
      if (method === "GET" && listMatch) {
        const name = decodeURIComponent(listMatch[1]!);
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
        if (!body || typeof body !== "object") return envelope({ error: "invalid" }, 400);
        const created = normalizeNamedCapacity({ id: "app-tier1", ...(body as Record<string, unknown>) });
        details.set("app-tier1", created);
        return envelope(created);
      }
      if (detailMatch) {
        const id = decodeURIComponent(detailMatch[1]!);
        if (method === "GET") {
          const detail = details.get(id);
          return detail === undefined ? envelope({ error: "missing" }, 404) : envelope(detail);
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
          return envelope(null);
        }
      }
      return envelope({ error: `unexpected ${method} ${url}` }, 500);
    };
    const evidence = await runBridge("post-worker", { env, cwd: directory, fetchImpl });
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
      "takos-executor-tier2",
      "takos-executor-tier3",
    ]);
    expect(listCalls.every(({ url }) => url.includes(`/accounts/${accountId}/containers/applications?name=`))).toBe(true);

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

    // A partial pre-worker run may have created provider-gap resources before
    // the D1 ledger table existed. Recovery must still reach ownership-proven
    // cleanup and must not issue the bare ledger SELECT first.
    d1LedgerExists = false;
    const d1QueryCallsBeforeCleanup = calls.filter(({ url }) =>
      url.includes("/d1/database/d1-1/query"),
    ).length;
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
    expect(
      calls.filter(({ url }) => url.includes("/d1/database/d1-1/query")),
    ).toHaveLength(d1QueryCallsBeforeCleanup);
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

test("pre-worker proves Vectorize ownership on the bootstrap version before a D1 ledger failure", async () => {
  const directory = await mkdtemp("takos-cloudflare-bridge-test-");
  try {
    const absoluteDirectory = resolve(directory);
    const migrationDirectory = join(absoluteDirectory, "migrations");
    const assetsDirectory = join(absoluteDirectory, "assets");
    const artifactPath = join(absoluteDirectory, "worker.js");
    const bootstrapPath = join(absoluteDirectory, "durable-object-migration-bootstrap.js");
    const containerPath = join(absoluteDirectory, "containers.json");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(migrationDirectory);
    await mkdir(assetsDirectory);
    await writeFile(join(migrationDirectory, "0001_schema.sql"), "CREATE TABLE users (id TEXT);\n");
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
      TAKOS_CLOUDFLARE_D1_DATABASE_ID: "d1-1",
      TAKOS_CLOUDFLARE_VECTOR_INDEX_NAME: "takos-staging-embeddings",
      TAKOS_CLOUDFLARE_VECTOR_INDEX_DIMENSIONS: "768",
      TAKOS_CLOUDFLARE_VECTOR_INDEX_METRIC: "cosine",
      TAKOS_CLOUDFLARE_MIGRATION_SET_PATH: migrationDirectory,
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
      if (url.endsWith("/d1/database/d1-1/query")) {
        const sql = ((calls.at(-1)?.body ?? {}) as { sql?: string }).sql ?? "";
        if (sql.startsWith("CREATE TABLE")) {
          return envelope({ success: false, errors: [{ code: 9000, message: "ledger create failed" }] });
        }
        throw new Error(`unexpected D1 query: ${sql}`);
      }
      if (url.includes("/containers/applications?name=") && method === "GET") {
        return envelope([]);
      }
      return envelope({ error: `unexpected ${method} ${url}` }, 500);
    };

    await expect(runBridge("pre-worker", { env, cwd: directory, fetchImpl })).rejects.toThrow(
      "cloudflare_d1_query_failed",
    );
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
    const d1Create = calls.findIndex(({ method, url, body }) => method === "POST" && url.endsWith("/d1/database/d1-1/query") && typeof body === "object" && body !== null && "sql" in body && String((body as { sql: string }).sql).startsWith("CREATE TABLE"));
    expect(firstUpload).toBeGreaterThanOrEqual(0);
    expect(vectorCreate).toBeGreaterThan(firstUpload);
    expect(proofUpload).toBeGreaterThan(vectorCreate);
    expect(d1Create).toBeGreaterThan(proofUpload);

    const d1CallsBeforeCleanup = calls.filter(({ url }) => url.includes("/d1/database/d1-1/query")).length;
    const cleanup = await runBridge("recovery-cleanup", { env, cwd: directory, fetchImpl });
    expect(cleanup.vector.status).toBe("deleted");
    expect(cleanup.containers.deleted).toEqual([]);
    expect(calls.filter(({ url }) => url.includes("/d1/database/d1-1/query"))).toHaveLength(d1CallsBeforeCleanup);
    expect(calls.some(({ method, url }) => method === "DELETE" && url.endsWith("/vectorize/v2/indexes/takos-staging-embeddings"))).toBe(true);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("migration collection ignores policy Markdown and preserves duplicate version names", async () => {
  const directory = await mkdtemp("takos-cloudflare-bridge-test-");
  try {
    await (await import("node:fs/promises")).mkdir(join(directory, "nested"));
    await writeFile(join(directory, "MIGRATION_SAFETY.md"), "policy\n");
    await writeFile(join(directory, "0043_a.sql"), "select 1;\n");
    await writeFile(join(directory, "0043_b.sql"), "select 2;\n");
    const files = await migrationFiles(directory);
    expect(files.map((file) => file.name)).toEqual(["0043_a.sql", "0043_b.sql"]);
    expect(files[0]?.sha256).not.toBe(files[1]?.sha256);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
