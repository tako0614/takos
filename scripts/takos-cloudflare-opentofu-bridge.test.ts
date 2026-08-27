import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  containerRows,
  migrationFiles,
  runBridge,
} from "./takos-cloudflare-opentofu-bridge.ts";

const DOCKER_IMAGE =
  "docker.io/tako0614/takos-agent@sha256:d737076cdab331b3065410606d0754fbb58b9ec25a8f0c0108c8e63991d38e7b";

function envelope(result: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: status >= 200 && status < 300, result }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

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
    const artifactPath = join(absoluteDirectory, "worker.js");
    await (await import("node:fs/promises")).mkdir(migrationDirectory);
    await writeFile(join(migrationDirectory, "0043_ap_followers.sql"), "CREATE TABLE ap_followers (id TEXT);\n");
    await writeFile(join(migrationDirectory, "0043_store_network_inventory_metadata.sql"), "CREATE TABLE store_network (id TEXT);\n");
    await writeFile(artifactPath, "export default {};\n");
    const migrationSet = await migrationFiles(migrationDirectory);
    const env: Record<string, string> = {
      TAKOS_CLOUDFLARE_ACCOUNT_ID: "account-1",
      TAKOS_CLOUDFLARE_WORKER_NAME: "takos-staging",
      TAKOS_CLOUDFLARE_D1_DATABASE_ID: "d1-1",
      TAKOS_CLOUDFLARE_VECTOR_INDEX_NAME: "takos-staging-embeddings",
      TAKOS_CLOUDFLARE_VECTOR_INDEX_DIMENSIONS: "768",
      TAKOS_CLOUDFLARE_VECTOR_INDEX_METRIC: "cosine",
      TAKOS_CLOUDFLARE_MIGRATION_SET_PATH: migrationDirectory,
      TAKOS_CLOUDFLARE_WORKER_ARTIFACT_PATH: artifactPath,
      CLOUDFLARE_API_TOKEN: "do-not-print-this-token",
    };
    let vectorExists = false;
    const ledger = new Map<string, string>();
    let imports = 0;
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = String(init?.method ?? "GET");
      calls.push(`${method} ${url}`);
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
    expect(first.d1.applied).toEqual([
      "0043_ap_followers.sql",
      "0043_store_network_inventory_metadata.sql",
    ]);
    expect(first.digests.desiredDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(first.digests.helperDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(first.digests.migrationDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(first)).not.toContain(env.CLOUDFLARE_API_TOKEN);
    const second = await runBridge("pre-worker", { env, cwd: directory, fetchImpl });
    expect(second.vector.status).toBe("present");
    expect(second.changed).toBe(false);
    expect(imports).toBe(2);
    expect(calls.every((call) => !call.includes(env.CLOUDFLARE_API_TOKEN))).toBe(true);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("post-worker reconciliation uses the raw Containers applications endpoint, exact name filters, and PATCH", async () => {
  const directory = await mkdtemp("takos-cloudflare-bridge-test-");
  try {
    const absoluteDirectory = resolve(directory);
    const migrationDirectory = join(absoluteDirectory, "migrations");
    const artifactPath = join(absoluteDirectory, "worker.js");
    const configPath = join(absoluteDirectory, "containers.json");
    await (await import("node:fs/promises")).mkdir(migrationDirectory);
    await writeFile(join(migrationDirectory, "0001_schema.sql"), "CREATE TABLE users (id TEXT);\n");
    await writeFile(artifactPath, "export default {};\n");
    const migrationSet = await migrationFiles(migrationDirectory);
    await writeFile(
      configPath,
      JSON.stringify({
        applications: [
          {
            name: "takos-executor-tier1",
            durable_object_class: "ExecutorContainerTier1",
            image: DOCKER_IMAGE,
            instance_type: "lite",
            max_instances: 2,
            rollout_active_grace_period: 900,
          },
          {
            name: "takos-executor-tier2",
            durable_object_class: "ExecutorContainerTier2",
            image: DOCKER_IMAGE,
            instance_type: "basic",
            max_instances: 2,
            rollout_active_grace_period: 900,
          },
          {
            name: "takos-executor-tier3",
            durable_object_class: "ExecutorContainerTier3",
            image: DOCKER_IMAGE,
            instance_type: { vcpu: 1, memory_mib: 12288, disk_mb: 4000 },
            max_instances: 2,
            rollout_active_grace_period: 900,
          },
        ],
      }),
    );
    const accountId = "a".repeat(32);
    const env: Record<string, string> = {
      TAKOS_CLOUDFLARE_ACCOUNT_ID: accountId,
      TAKOS_CLOUDFLARE_WORKER_NAME: "takos",
      TAKOS_CLOUDFLARE_D1_DATABASE_ID: "d1-1",
      TAKOS_CLOUDFLARE_VECTOR_INDEX_NAME: "takos-embeddings",
      TAKOS_CLOUDFLARE_VECTOR_INDEX_DIMENSIONS: "768",
      TAKOS_CLOUDFLARE_VECTOR_INDEX_METRIC: "cosine",
      TAKOS_CLOUDFLARE_MIGRATION_SET_PATH: migrationDirectory,
      TAKOS_CLOUDFLARE_WORKER_ARTIFACT_PATH: artifactPath,
      TAKOS_CLOUDFLARE_CONTAINER_DESIRED_CONFIG_PATH: configPath,
      TAKOS_CONTAINER_IMAGE: DOCKER_IMAGE,
      CLOUDFLARE_API_TOKEN: "container-test-token",
    };
    const details = new Map<string, Record<string, unknown>>();
    const names = ["tier1", "tier2", "tier3"];
    names.forEach((tier, index) => {
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
            })),
          },
        });
      }
      if (url.endsWith("/vectorize/v2/indexes/takos-embeddings")) {
        return envelope({ name: "takos-embeddings", config: { dimensions: 768, metric: "cosine" } });
      }
      if (url.endsWith("/d1/database/d1-1/query")) {
        const sql = (body as { sql?: string } | undefined)?.sql ?? "";
        if (sql.startsWith("SELECT name")) {
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
          details.set(id, { ...current, ...update });
          return envelope(details.get(id));
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
    expect(calls.filter(({ method }) => method === "PATCH")).toHaveLength(3);
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
    expect(calls.filter(({ method }) => method === "PATCH")).toHaveLength(3);
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
