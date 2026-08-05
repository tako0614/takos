import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import {
  createDependencies,
  digest,
  failureEvidence,
  MINIMUM_NODE_MAJOR,
  materializePostApply,
  materializePreDestroy,
  NODE_EXECUTABLE,
  parseInvocation,
  parseTakosOutputs,
  parseWorkerArchive,
  renderWranglerConfig,
  validateProviderConfigurations,
  validateNodeRuntimeVersion,
  validateReleaseDescriptor,
  validateRuntimeSecrets,
  type MaterializerDependencies,
  type ReleaseDescriptor,
  type TakosOutputs,
} from "./takos-product-materializer.ts";

const accountId = "a".repeat(32);
const sourceCommit = "b".repeat(40);
const sourceSnapshotId = "snapshot_takos_1";
const packageManifest = (await Bun.file(
  join(import.meta.dir, "..", "package.json"),
).json()) as { version: string };
const packageVersion = packageManifest.version;
const releaseTag = `v${packageVersion}`;
const descriptorUrl = `https://github.com/tako0614/takos/releases/download/${releaseTag}/takosumi-artifact.json`;
const archiveUrl = `https://github.com/tako0614/takos/releases/download/${releaseTag}/takos-worker-release.tar.gz`;
const runtimeImage = `registry.cloudflare.com/${accountId}/takos-worker-runtime@sha256:${"c".repeat(64)}`;
const executorImage = `registry.cloudflare.com/${accountId}/takos-agent@sha256:${"d".repeat(64)}`;

const rawOutputs = {
  target: "cloudflare",
  cloudflare_account_id: accountId,
  service_runtime_name: "takos-example",
  url: "https://takos.example.test",
  launch_url: "https://takos.example.test",
  public_url: "https://takos.example.test",
  executor_capacity: {
    runtime_max_instances: 2,
    tier1_max_instances: 3,
    tier1_max_concurrent_runs: 4,
    tier2_max_instances: 5,
    tier3_max_instances: 6,
    tier3_max_concurrent_runs: 7,
  },
  worker_env: {
    TAKOSUMI_ACCOUNTS_URL: "https://accounts.example.test",
    OIDC_ISSUER_URL: "https://accounts.example.test",
    OIDC_CLIENT_ID: "takos-client",
    OIDC_REDIRECT_URI: "https://takos.example.test/auth/oidc/callback",
    EXECUTOR_TIER1_WARM_POOL_SIZE: "3",
    EXECUTOR_TIER1_MAX_CONCURRENT_RUNS: "4",
    EXECUTOR_TIER3_POOL_SIZE: "6",
    EXECUTOR_TIER3_MAX_CONCURRENT_RUNS: "7",
  },
  sql_databases: { db: "1".repeat(32) },
  key_value_stores: { hostname_routing: "2".repeat(32) },
  object_buckets: {
    worker_bundles: "takos-worker-bundles",
    tenant_builds: "takos-tenant-builds",
    tenant_source: "takos-tenant-source",
    git_objects: "takos-git-objects",
    offload: "takos-offload",
  },
  queues: {
    runs: "takos-runs",
    runs_dlq: "takos-runs-dlq",
    index_jobs: "takos-index-jobs",
    index_jobs_dlq: "takos-index-jobs-dlq",
    workflow: "takos-workflow-jobs",
    workflow_dlq: "takos-workflow-jobs-dlq",
    notification_push: "takos-notification-push",
    notification_push_dlq: "takos-notification-push-dlq",
  },
  vector_indexes: {
    vector: { name: "takos-embeddings", dimensions: 768, metric: "cosine" },
  },
};

const providerConfigurations = {
  format: "takosumi.provider-configurations@v1",
  providers: [
    {
      provider: "registry.opentofu.org/cloudflare/cloudflare",
      alias: null,
      configuration: {
        account_id: accountId,
        base_url: "https://api.cloudflare.com/client/v4",
      },
    },
  ],
};

const secrets = {
  ENCRYPTION_KEY: "encryption-key-value",
  OIDC_CLIENT_SECRET: "oidc-client-secret-value",
  PLATFORM_PRIVATE_KEY: "private-key-value",
  PLATFORM_PUBLIC_KEY: "public-key-value",
  TAKOS_AGENT_START_TOKEN: "agent-start-token-value",
  TAKOS_INTERNAL_API_SECRET: "internal-api-secret-value",
};

let temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
  temporaryDirectories = [];
});

function descriptor(archiveDigest: string): ReleaseDescriptor {
  return {
    kind: "takosumi.worker-artifact@v1",
    app: "takos",
    commit: sourceCommit,
    releaseTag,
    artifact: {
      filename: "takos-worker-release.tar.gz",
      url: archiveUrl,
      sha256: archiveDigest.slice("sha256:".length),
      sha256Prefixed: archiveDigest,
    },
    assetManifest: "asset-manifest.json",
    containerImages: { runtime: runtimeImage, executor: executorImage },
  };
}

function invocationEnv(
  phase: "post_apply" | "pre_destroy",
  descriptorDigest?: string,
): NodeJS.ProcessEnv {
  return {
    TAKOSUMI_SOURCE_SNAPSHOT_ID: sourceSnapshotId,
    TAKOSUMI_SOURCE_COMMIT: sourceCommit,
    TAKOSUMI_RELEASE_RUN_ID: "release_run_1",
    TAKOSUMI_OUTPUTS_JSON: JSON.stringify(rawOutputs),
    TAKOSUMI_PROVIDER_CONFIGS_JSON: JSON.stringify(providerConfigurations),
    TAKOSUMI_RELEASE_CONTEXT_JSON: JSON.stringify({
      kind: "takosumi.release-context@v1",
      releaseRunId: "release_run_1",
      outputs: rawOutputs,
    }),
    CLOUDFLARE_API_TOKEN: "cloudflare-provider-token",
    ...(phase === "post_apply"
      ? {
          TAKOS_RELEASE_ARTIFACT_DESCRIPTOR_URL: descriptorUrl,
          TAKOS_RELEASE_ARTIFACT_DESCRIPTOR_SHA256: descriptorDigest,
        }
      : {}),
  };
}

function writeTarString(
  target: Uint8Array,
  offset: number,
  length: number,
  value: string,
): void {
  target.set(new TextEncoder().encode(value).subarray(0, length), offset);
}

function tarHeader(path: string, size: number, type = "0"): Uint8Array {
  const header = new Uint8Array(512);
  writeTarString(header, 0, 100, path);
  writeTarString(header, 100, 8, "0000600\0");
  writeTarString(header, 108, 8, "0000000\0");
  writeTarString(header, 116, 8, "0000000\0");
  writeTarString(header, 124, 12, `${size.toString(8).padStart(11, "0")}\0`);
  writeTarString(header, 136, 12, "00000000000\0");
  writeTarString(header, 148, 8, "        ");
  writeTarString(header, 156, 1, type);
  writeTarString(header, 257, 6, "ustar\0");
  writeTarString(header, 263, 2, "00");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeTarString(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

function workerArchive(extra?: { path: string; type: string }): Uint8Array {
  const files = new Map<string, Uint8Array>([
    [
      "worker/index.js",
      new TextEncoder().encode("export default { fetch() {} };"),
    ],
    [
      "assets/index.html",
      new TextEncoder().encode("<!doctype html><title>Takos</title>"),
    ],
    [
      "asset-manifest.json",
      new TextEncoder().encode(
        JSON.stringify({
          "/index.html": { hash: "e".repeat(32), size: 35 },
        }),
      ),
    ],
  ]);
  const chunks: Uint8Array[] = [];
  for (const [path, bytes] of files) {
    chunks.push(tarHeader(path, bytes.byteLength), bytes);
    const padding = (512 - (bytes.byteLength % 512)) % 512;
    if (padding) chunks.push(new Uint8Array(padding));
  }
  if (extra) chunks.push(tarHeader(extra.path, 0, extra.type));
  chunks.push(new Uint8Array(1024));
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const tar = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    tar.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Uint8Array(gzipSync(tar));
}

describe("materializer input and topology", () => {
  test("binds every mutable Worker surface to nonsecret OpenTofu outputs", () => {
    const outputs = parseTakosOutputs(rawOutputs);
    const config = renderWranglerConfig({
      outputs,
      descriptor: descriptor(`sha256:${"f".repeat(64)}`),
      artifactRoot: "/tmp/artifact",
      sourceRoot: "/source",
    });
    expect(config.name).toBe("takos-example");
    expect(config.vars).toMatchObject({
      ADMIN_DOMAIN: "takos.example.test",
      CF_ACCOUNT_ID: accountId,
    });
    expect((config.containers as unknown[]).length).toBe(4);
    expect((config.queues as { consumers: unknown[] }).consumers.length).toBe(
      8,
    );
    expect((config.migrations as unknown[]).at(-1)).toEqual({
      tag: "v6",
      new_sqlite_classes: [
        "TakosRuntimeContainer",
        "ExecutorContainerTier1",
        "ExecutorContainerTier2",
        "ExecutorContainerTier3",
      ],
    });
    expect(config.routes).toEqual([
      { pattern: "takos.example.test", custom_domain: true },
    ]);
  });

  test("rejects output, provider, artifact, and runtime-secret authority drift", () => {
    expect(() =>
      parseTakosOutputs({
        ...rawOutputs,
        worker_env: { ...rawOutputs.worker_env, API_TOKEN: "not-allowed" },
      }),
    ).toThrow(/secret-like/u);
    expect(() =>
      validateProviderConfigurations(
        {
          ...providerConfigurations,
          providers: [
            {
              ...providerConfigurations.providers[0],
              configuration: { base_url: "https://compat.example.test" },
            },
          ],
        },
        accountId,
      ),
    ).toThrow(/custom Cloudflare/u);
    expect(() =>
      validateReleaseDescriptor(
        { ...descriptor(`sha256:${"f".repeat(64)}`), commit: "0".repeat(40) },
        {
          sourceCommit,
          packageVersion,
          accountId,
          descriptorUrl,
        },
      ),
    ).toThrow(/SourceSnapshot commit/u);
    expect(() =>
      validateRuntimeSecrets({ ...secrets, UNKNOWN_SECRET: "x" }),
    ).toThrow(/not in the Takos secret contract/u);
  });

  test("requires canonical host source identity and rejects duplicate credentials", () => {
    const env = invocationEnv("pre_destroy");
    expect(parseInvocation("pre_destroy", env).sourceCommit).toBe(sourceCommit);
    expect(() =>
      parseInvocation("pre_destroy", {
        ...env,
        TAKOSUMI_SOURCE_COMMIT: "short",
      }),
    ).toThrow(/full commit/u);
    expect(() =>
      parseInvocation("pre_destroy", { ...env, CF_API_TOKEN: "ambiguous" }),
    ).toThrow(/not accepted/u);
  });

  test("accepts the release archive and rejects link entries before extraction", async () => {
    await expect(parseWorkerArchive(workerArchive())).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "worker/index.js", type: "file" }),
      ]),
    );
    await expect(
      parseWorkerArchive(workerArchive({ path: "assets/link", type: "2" })),
    ).rejects.toThrow(/link or unsupported/u);
  });

  test("renders a config accepted by the SourceSnapshot-locked Wrangler", async () => {
    const root = await mkdtemp(join(tmpdir(), "takos-materializer-wrangler-"));
    temporaryDirectories.push(root);
    const artifactRoot = join(root, "artifact");
    const sourceRoot = join(import.meta.dir, "..");
    const configPath = join(root, "wrangler.json");
    const outdir = join(root, "dry-run");
    await mkdir(join(artifactRoot, "worker"), { recursive: true });
    await mkdir(join(artifactRoot, "assets"), { recursive: true });
    await writeFile(
      join(artifactRoot, "worker", "index.js"),
      [
        'export default { fetch() { return new Response("ok"); } };',
        "export class SessionDO {}",
        "export class RunNotifierDO {}",
        "export class NotificationNotifierDO {}",
        "export class RateLimiterDO {}",
        "export class RoutingDO {}",
        "export class TakosRuntimeContainer {}",
        "export class ExecutorContainerTier1 {}",
        "export class ExecutorContainerTier2 {}",
        "export class ExecutorContainerTier3 {}",
        "export class TakosEgressEntrypoint {}",
      ].join("\n"),
    );
    await writeFile(join(artifactRoot, "assets", "index.html"), "ok");
    await writeFile(
      configPath,
      JSON.stringify(
        renderWranglerConfig({
          outputs: parseTakosOutputs(rawOutputs),
          descriptor: descriptor(`sha256:${"f".repeat(64)}`),
          artifactRoot,
          sourceRoot,
        }),
      ),
    );

    const child = Bun.spawn(
      [
        NODE_EXECUTABLE,
        join(sourceRoot, "node_modules", "wrangler", "bin", "wrangler.js"),
        "deploy",
        "--dry-run",
        "--no-bundle",
        "--containers-rollout",
        "none",
        "--outdir",
        outdir,
        "--config",
        configPath,
      ],
      {
        cwd: sourceRoot,
        env: {
          CI: "true",
          PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
          WRANGLER_SEND_METRICS: "false",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (exitCode !== 0) {
      throw new Error(`Wrangler dry-run failed:\n${stdout}\n${stderr}`);
    }
  });

  test("runs the locked Wrangler entrypoint with the supported Node runtime", async () => {
    const root = await mkdtemp(join(tmpdir(), "takos-materializer-node-"));
    temporaryDirectories.push(root);
    const wranglerBin = join(root, "fake-wrangler.mjs");
    await writeFile(
      wranglerBin,
      [
        "process.stdout.write(JSON.stringify({",
        "  executable: process.execPath,",
        "  args: process.argv.slice(2),",
        "}));",
      ].join("\n"),
    );
    const dependencies = createDependencies({
      nodeBin: NODE_EXECUTABLE,
      wranglerBin,
      sourceRoot: root,
      apiToken: "test-token",
      accountId,
    });

    const result = await dependencies.runWrangler(["--version"]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      executable: NODE_EXECUTABLE,
      args: ["--version"],
    });
  });

  test("retries transient immutable artifact transport failures before mutation", async () => {
    let attempts = 0;
    const dependencies = createDependencies({
      nodeBin: NODE_EXECUTABLE,
      wranglerBin: "/tmp/unused-wrangler.mjs",
      sourceRoot: "/tmp",
      apiToken: "test-token",
      accountId,
      fetchImpl: async () => {
        attempts += 1;
        if (attempts < 3) throw new TypeError("transient transport failure");
        return new Response("immutable-bytes", { status: 200 });
      },
    });

    const bytes = await dependencies.fetchBytes(
      "https://github.com/tako0614/takos/releases/download/v0.0.0/example",
      1024,
    );

    expect(new TextDecoder().decode(bytes)).toBe("immutable-bytes");
    expect(attempts).toBe(3);
  });

  test("does not retry a permanent immutable artifact response", async () => {
    let attempts = 0;
    const dependencies = createDependencies({
      nodeBin: NODE_EXECUTABLE,
      wranglerBin: "/tmp/unused-wrangler.mjs",
      sourceRoot: "/tmp",
      apiToken: "test-token",
      accountId,
      fetchImpl: async () => {
        attempts += 1;
        return new Response("not found", { status: 404 });
      },
    });
    let observed: unknown;
    try {
      await dependencies.fetchBytes(
        "https://github.com/tako0614/takos/releases/download/v0.0.0/missing",
        1024,
      );
    } catch (error) {
      observed = error;
    }

    expect(attempts).toBe(1);
    expect(failureEvidence(observed, "post_apply")).toMatchObject({
      status: "failed",
      code: "artifact_download_failed",
      stage: "artifact",
      mutationStarted: false,
    });
  });

  test("deletes a proved Worker through the bounded Cloudflare API", async () => {
    const root = await mkdtemp(join(tmpdir(), "takos-materializer-delete-"));
    temporaryDirectories.push(root);
    let observedRequest: Request | undefined;
    const dependencies = createDependencies({
      nodeBin: NODE_EXECUTABLE,
      wranglerBin: join(root, "unused-wrangler.mjs"),
      sourceRoot: root,
      apiToken: "test-token",
      accountId,
      fetchImpl: async (input, init) => {
        observedRequest = new Request(input, init);
        return new Response(null, { status: 204 });
      },
    });

    await dependencies.deleteWorker("takos-example");

    expect(observedRequest?.method).toBe("DELETE");
    expect(observedRequest?.url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/takos-example?force=true`,
    );
  });

  test("lists and deletes only objects in the exact OpenTofu-owned R2 bucket", async () => {
    const root = await mkdtemp(join(tmpdir(), "takos-materializer-r2-"));
    temporaryDirectories.push(root);
    const observedRequests: Request[] = [];
    const dependencies = createDependencies({
      nodeBin: NODE_EXECUTABLE,
      wranglerBin: join(root, "unused-wrangler.mjs"),
      sourceRoot: root,
      apiToken: "test-token",
      accountId,
      fetchImpl: async (input, init) => {
        const request = new Request(input, init);
        observedRequests.push(request);
        if (request.method === "GET") {
          return Response.json({
            success: true,
            result: [{ key: "nested/object.json" }, { key: "root.txt" }],
          });
        }
        return new Response(null, { status: 204 });
      },
    });

    expect(await dependencies.listR2Objects("takos-offload")).toEqual([
      "nested/object.json",
      "root.txt",
    ]);
    await dependencies.deleteR2Object("takos-offload", "nested/object.json");

    expect(observedRequests).toHaveLength(2);
    expect(observedRequests[0]?.method).toBe("GET");
    expect(observedRequests[0]?.url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/takos-offload/objects?per_page=1000`,
    );
    expect(observedRequests[1]?.method).toBe("DELETE");
    expect(observedRequests[1]?.url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/takos-offload/objects/nested%2Fobject.json`,
    );
    expect(observedRequests[0]?.headers.get("authorization")).toBe(
      "Bearer test-token",
    );
    expect(observedRequests[1]?.headers.get("authorization")).toBe(
      "Bearer test-token",
    );
  });

  test("treats an absent R2 bucket or object as already clean during recovery", async () => {
    const root = await mkdtemp(join(tmpdir(), "takos-materializer-r2-absent-"));
    temporaryDirectories.push(root);
    const dependencies = createDependencies({
      nodeBin: NODE_EXECUTABLE,
      wranglerBin: join(root, "unused-wrangler.mjs"),
      sourceRoot: root,
      apiToken: "test-token",
      accountId,
      fetchImpl: async () => new Response(null, { status: 404 }),
    });

    expect(await dependencies.listR2Objects("already-absent")).toEqual([]);
    await expect(
      dependencies.deleteR2Object("already-absent", "already-absent"),
    ).resolves.toBeUndefined();
  });

  test("accepts Vectorize Gone as authoritative absence during recovery", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "takos-materializer-vector-gone-"),
    );
    temporaryDirectories.push(root);
    let observedRequest: Request | undefined;
    const dependencies = createDependencies({
      nodeBin: NODE_EXECUTABLE,
      wranglerBin: join(root, "unused-wrangler.mjs"),
      sourceRoot: root,
      apiToken: "test-token",
      accountId,
      fetchImpl: async (input, init) => {
        observedRequest = new Request(input, init);
        return new Response(null, { status: 410 });
      },
    });

    expect(await dependencies.readVector("takos-embeddings")).toBeUndefined();
    expect(observedRequest?.method).toBe("GET");
    expect(observedRequest?.url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/vectorize/v2/indexes/takos-embeddings`,
    );
  });

  test("requires the Node major supported by the locked Wrangler", () => {
    expect(validateNodeRuntimeVersion("v24.19.0\n")).toBe("v24.19.0");
    expect(() =>
      validateNodeRuntimeVersion(`v${MINIMUM_NODE_MAJOR - 1}.99.0`),
    ).toThrow(/Node runtime must be/u);
    expect(() => validateNodeRuntimeVersion("1.3.14")).toThrow(
      /Node runtime must be/u,
    );
  });
});

type FakeState = {
  deployed: boolean;
  vector: boolean;
  containers: boolean;
  consumers: boolean;
  blankDeploymentReadback?: boolean;
  blankSecretReadback?: boolean;
  workerPresence?: boolean;
  invalidVectorShape?: boolean;
  blankQueueConsumerReadback?: boolean;
  missingQueues?: boolean;
  r2Objects?: Record<string, string[]>;
  foreignContainer?: boolean;
  foreignVectorBinding?: boolean;
  staleSecret?: boolean;
  noopDeploy?: boolean;
  expandedContainerInfo?: boolean;
  containerDeletionReadbacksRemaining?: number;
  containerDeletionRequested?: boolean;
  workerPresenceReadbacksRemaining?: number;
  message?: string;
  tag?: string;
};

function existingProvenanceMessage(): string {
  return (
    `takos-product-materializer/v1 source=${sourceCommit} ` +
    `archive=sha256:${"f".repeat(64)} config=sha256:${"e".repeat(64)}`
  );
}

function expectedConsumers(outputs: TakosOutputs): Record<string, unknown> {
  const q = outputs.queues;
  return {
    [q.runs]: consumer(1, 1, 5, 5, 5, q.runs_dlq),
    [q.runs_dlq]: consumer(10, 60, 3, null, 0),
    [q.index_jobs]: consumer(5, 60, 2, null, 0, q.index_jobs_dlq),
    [q.index_jobs_dlq]: consumer(10, 60, 3, null, 0),
    [q.workflow]: consumer(1, 1, 3, null, 0, q.workflow_dlq),
    [q.workflow_dlq]: consumer(10, 60, 3, null, 0),
    [q.notification_push]: consumer(5, 5, 5, 5, 5, q.notification_push_dlq),
    [q.notification_push_dlq]: consumer(10, 60, 100, null, 600),
  };
}

function consumer(
  batchSize: number,
  timeoutSeconds: number,
  retries: number,
  concurrency: number | null,
  retryDelay: number,
  deadLetterQueue?: string,
) {
  return {
    type: "worker",
    script: "takos-example",
    settings: {
      batch_size: batchSize,
      max_wait_time_ms: timeoutSeconds * 1000,
      max_retries: retries,
      max_concurrency: concurrency,
      retry_delay: retryDelay,
    },
    dead_letter_queue: deadLetterQueue ?? null,
  };
}

function expandedContainerConfiguration(instanceType: unknown) {
  if (instanceType === "lite") {
    return { vcpu: 0.0625, memory_mib: 256, disk: { size_mb: 2_000 } };
  }
  if (instanceType === "basic") {
    return { vcpu: 0.25, memory_mib: 1_024, disk: { size_mb: 4_000 } };
  }
  if (instanceType === "standard-2") {
    return { vcpu: 1, memory_mib: 6_144, disk: { size_mb: 12_000 } };
  }
  const custom = instanceType as {
    readonly vcpu: number;
    readonly memory_mib: number;
    readonly disk_mb: number;
  };
  return {
    vcpu: custom.vcpu,
    memory_mib: custom.memory_mib,
    disk: { size_mb: custom.disk_mb },
  };
}

function fakeDependencies(
  state: FakeState,
  outputs: TakosOutputs,
  release: ReleaseDescriptor,
  descriptorBytes: Uint8Array,
  archiveBytes: Uint8Array,
): MaterializerDependencies & { calls: string[][] } {
  const calls: string[][] = [];
  const consumers = expectedConsumers(outputs);
  const containerShapes = [
    [
      "runtime",
      "standard-2",
      outputs.capacity.runtime_max_instances,
      release.containerImages.runtime,
    ],
    [
      "executor-tier1",
      "lite",
      outputs.capacity.tier1_max_instances,
      release.containerImages.executor,
    ],
    [
      "executor-tier2",
      "basic",
      outputs.capacity.tier2_max_instances,
      release.containerImages.executor,
    ],
    [
      "executor-tier3",
      { vcpu: 1, memory_mib: 12_288, disk_mb: 4_000 },
      outputs.capacity.tier3_max_instances,
      release.containerImages.executor,
    ],
  ] as const;
  return {
    calls,
    async readWorkerPresence(workerName) {
      calls.push(["worker-presence", workerName]);
      if (
        !state.deployed &&
        (state.workerPresenceReadbacksRemaining ?? 0) > 0
      ) {
        state.workerPresenceReadbacksRemaining =
          (state.workerPresenceReadbacksRemaining ?? 0) - 1;
        return true;
      }
      return state.workerPresence ?? state.deployed;
    },
    async deleteWorker(workerName) {
      calls.push(["worker-delete", workerName]);
      state.deployed = false;
    },
    async readVector(indexName) {
      calls.push(["vector-readback", indexName]);
      return state.vector
        ? {
            name: outputs.vector.name,
            config: {
              dimensions: state.invalidVectorShape ? 2048 : 768,
              metric: "cosine",
            },
          }
        : undefined;
    },
    async listR2Objects(bucketName) {
      calls.push(["r2-object-list", bucketName]);
      return [...(state.r2Objects?.[bucketName] ?? [])];
    },
    async deleteR2Object(bucketName, objectKey) {
      calls.push(["r2-object-delete", bucketName, objectKey]);
      if (state.r2Objects?.[bucketName]) {
        state.r2Objects[bucketName] = state.r2Objects[bucketName]!.filter(
          (key) => key !== objectKey,
        );
      }
    },
    async runWrangler(args) {
      const argv = [...args];
      calls.push(argv);
      if (argv[0] === "deployments") {
        if (!state.deployed && state.blankDeploymentReadback) return success();
        return state.deployed
          ? ok({
              id: "deployment-1",
              versions: [{ version_id: "version-1", percentage: 100 }],
            })
          : missing();
      }
      if (argv[0] === "secret" && argv[1] === "list") {
        if (!state.deployed && state.blankSecretReadback) return success();
        return state.deployed
          ? ok(
              [
                ...Object.keys(secrets),
                ...(state.staleSecret ? ["OPENAI_API_KEY"] : []),
              ].map((name) => ({ name, type: "secret_text" })),
            )
          : missing();
      }
      if (argv[0] === "secret" && argv[1] === "bulk") {
        state.staleSecret = false;
        return success();
      }
      if (argv[0] === "containers" && argv[1] === "list") {
        if (state.containerDeletionRequested && state.containers) {
          if ((state.containerDeletionReadbacksRemaining ?? 0) > 0) {
            state.containerDeletionReadbacksRemaining =
              (state.containerDeletionReadbacksRemaining ?? 0) - 1;
          } else {
            state.containers = false;
          }
        }
        return ok(
          state.containers
            ? containerShapes.map(([suffix, , , image], index) => ({
                id: `container-${index}`,
                name: `${outputs.workerName}-${suffix}`,
                state: "ready",
                image,
              }))
            : [],
        );
      }
      if (argv[0] === "containers" && argv[1] === "info") {
        const index = Number(argv[2]!.split("-").at(-1));
        const [suffix, instanceType, maxInstances, image] =
          containerShapes[index]!;
        return ok({
          id: argv[2],
          name: `${outputs.workerName}-${suffix}`,
          max_instances: maxInstances,
          rollout_active_grace_period: 900,
          configuration: {
            image,
            ...(state.expandedContainerInfo
              ? expandedContainerConfiguration(instanceType)
              : { instance_type: instanceType }),
          },
          durable_objects: {
            namespace_id: state.foreignContainer
              ? `foreign-namespace-${index}`
              : `namespace-${index}`,
          },
        });
      }
      if (argv[0] === "containers" && argv[1] === "delete") {
        if (argv[2] === "container-3") {
          state.containerDeletionRequested = true;
          if ((state.containerDeletionReadbacksRemaining ?? 0) === 0) {
            state.containers = false;
          }
        }
        return success();
      }
      if (argv[0] === "queues" && argv[2] === "list") {
        if (state.missingQueues) return missing();
        if (state.blankQueueConsumerReadback && !state.consumers) {
          return { exitCode: 0, stdout: "\n", stderr: "" };
        }
        return ok(state.consumers ? [consumers[argv[3]!]] : []);
      }
      if (argv[0] === "queues" && argv[2] === "remove") {
        if (argv[3] === outputs.queues.notification_push_dlq) {
          state.consumers = false;
        }
        return success();
      }
      if (argv[0] === "vectorize" && argv[1] === "create") {
        state.vector = true;
        return ok({ name: outputs.vector.name });
      }
      if (argv[0] === "vectorize" && argv[1] === "delete") {
        state.vector = false;
        return success();
      }
      if (argv[0] === "deploy") {
        if (!argv.includes("--dry-run") && !state.noopDeploy) {
          state.deployed = true;
          state.containers = true;
          state.consumers = true;
          state.message = argv[argv.indexOf("--message") + 1];
          state.tag = argv[argv.indexOf("--tag") + 1];
        }
        return success();
      }
      if (argv[0] === "versions") {
        return ok({
          id: "version-1",
          annotations: {
            "workers/message": state.message,
            "workers/tag": state.tag,
          },
          resources: {
            bindings: [
              {
                type: "durable_object_namespace",
                class_name: "TakosRuntimeContainer",
                namespace_id: "namespace-0",
              },
              {
                type: "durable_object_namespace",
                class_name: "ExecutorContainerTier1",
                namespace_id: "namespace-1",
              },
              {
                type: "durable_object_namespace",
                class_name: "ExecutorContainerTier2",
                namespace_id: "namespace-2",
              },
              {
                type: "durable_object_namespace",
                class_name: "ExecutorContainerTier3",
                namespace_id: "namespace-3",
              },
              {
                name: "VECTORIZE",
                type: "vectorize",
                index_name: state.foreignVectorBinding
                  ? "foreign-vector-index"
                  : outputs.vector.name,
              },
              {
                name: "RUN_QUEUE",
                type: "queue",
                queue_name: outputs.queues.runs,
              },
              {
                name: "INDEX_QUEUE",
                type: "queue",
                queue_name: outputs.queues.index_jobs,
              },
              {
                name: "WORKFLOW_QUEUE",
                type: "queue",
                queue_name: outputs.queues.workflow,
              },
              {
                name: "TAKOS_NOTIFICATION_PUSH_QUEUE",
                type: "queue",
                queue_name: outputs.queues.notification_push,
              },
            ],
          },
        });
      }
      return success();
    },
    async fetchBytes(url) {
      return url === descriptorUrl ? descriptorBytes : archiveBytes;
    },
    async fetchHealth() {
      return { status: 200, bytes: new TextEncoder().encode("ok") };
    },
    async sleep() {},
    now: () => "2026-08-02T00:00:00.000Z",
  };
}

function ok(value: unknown) {
  return { exitCode: 0, stdout: JSON.stringify(value), stderr: "" };
}

function success() {
  return { exitCode: 0, stdout: "", stderr: "" };
}

function missing() {
  return { exitCode: 1, stdout: "", stderr: "404 not found" };
}

describe("materializer lifecycle", () => {
  test("post_apply converges and proves artifact, migrations, Worker, containers, queues, secrets, and health", async () => {
    const root = await mkdtemp(join(tmpdir(), "takos-materializer-test-"));
    temporaryDirectories.push(root);
    const secretPath = join(root, "runtime-secrets.json");
    await writeFile(secretPath, JSON.stringify(secrets), { mode: 0o600 });
    await chmod(secretPath, 0o600);
    const archiveBytes = workerArchive();
    const release = descriptor(digest(archiveBytes));
    const descriptorBytes = new TextEncoder().encode(JSON.stringify(release));
    const invocation = parseInvocation("post_apply", {
      ...invocationEnv("post_apply", digest(descriptorBytes)),
      TAKOS_RUNTIME_SECRETS_FILE: secretPath,
    });
    const state: FakeState = {
      deployed: false,
      vector: false,
      containers: false,
      consumers: false,
      blankDeploymentReadback: true,
      blankSecretReadback: true,
      workerPresence: false,
    };
    const fake = fakeDependencies(
      state,
      invocation.outputs,
      release,
      descriptorBytes,
      archiveBytes,
    );
    const evidence = await materializePostApply({
      invocation,
      sourceRoot: join(import.meta.dir, ".."),
      dependencies: fake,
    });
    expect(evidence.status).toBe("succeeded");
    expect(evidence.checks).toMatchObject({
      d1MigrationsApplied: true,
      containers: 4,
      queueConsumers: 8,
      health: { status: 200 },
    });
    expect(
      fake.calls.some(
        (call) => call.slice(0, 4).join(" ") === "d1 migrations apply DB",
      ),
    ).toBe(true);
    expect(
      fake.calls.some(
        (call) =>
          call[0] === "vector-readback" &&
          call[1] === invocation.outputs.vector.name,
      ),
    ).toBe(true);
    expect(
      fake.calls.some(
        (call) =>
          call[0] === "worker-presence" &&
          call[1] === invocation.outputs.workerName,
      ),
    ).toBe(true);
    const deploy = fake.calls.find(
      (call) => call[0] === "deploy" && !call.includes("--dry-run"),
    );
    expect(deploy).toEqual(
      expect.arrayContaining([
        "--strict",
        "--containers-rollout",
        "immediate",
        "--secrets-file",
      ]),
    );
    expect(JSON.stringify(evidence)).not.toContain(secrets.ENCRYPTION_KEY);
    expect(JSON.stringify(evidence)).not.toContain(accountId);
    expect(JSON.stringify(evidence)).not.toContain(sourceCommit);
    expect(JSON.stringify(evidence)).not.toContain(
      rawOutputs.service_runtime_name,
    );
    expect(JSON.stringify(evidence)).not.toContain("deployment-1");
    expect(JSON.stringify(evidence)).not.toContain("version-1");
  });

  test("pre_destroy confirms Worker deletion through the bounded API presence readback", async () => {
    const archiveBytes = workerArchive();
    const release = descriptor(digest(archiveBytes));
    const descriptorBytes = new TextEncoder().encode(JSON.stringify(release));
    const invocation = parseInvocation(
      "pre_destroy",
      invocationEnv("pre_destroy"),
    );
    const state: FakeState = {
      deployed: true,
      vector: false,
      containers: false,
      consumers: false,
      workerPresenceReadbacksRemaining: 2,
      message: existingProvenanceMessage(),
      tag: releaseTag,
    };
    const fake = fakeDependencies(
      state,
      invocation.outputs,
      release,
      descriptorBytes,
      archiveBytes,
    );

    const evidence = await materializePreDestroy({
      invocation,
      sourceRoot: join(import.meta.dir, ".."),
      dependencies: fake,
    });

    expect(evidence.status).toBe("succeeded");
    expect(
      fake.calls.filter((call) => call[0] === "worker-presence"),
    ).toHaveLength(3);
    expect(fake.calls.filter((call) => call[0] === "deployments")).toHaveLength(
      1,
    );
  });

  test("accepts the current Wrangler expanded container capacity readback", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "takos-materializer-expanded-container-"),
    );
    temporaryDirectories.push(root);
    const secretPath = join(root, "runtime-secrets.json");
    await writeFile(secretPath, JSON.stringify(secrets), { mode: 0o600 });
    await chmod(secretPath, 0o600);
    const archiveBytes = workerArchive();
    const release = descriptor(digest(archiveBytes));
    const descriptorBytes = new TextEncoder().encode(JSON.stringify(release));
    const invocation = parseInvocation("post_apply", {
      ...invocationEnv("post_apply", digest(descriptorBytes)),
      TAKOS_RUNTIME_SECRETS_FILE: secretPath,
    });
    const fake = fakeDependencies(
      {
        deployed: false,
        vector: false,
        containers: false,
        consumers: false,
        workerPresence: false,
        expandedContainerInfo: true,
      },
      invocation.outputs,
      release,
      descriptorBytes,
      archiveBytes,
    );

    const evidence = await materializePostApply({
      invocation,
      sourceRoot: join(import.meta.dir, ".."),
      dependencies: fake,
    });

    expect(evidence.status).toBe("succeeded");
  });

  test("does not claim worker_deployed when Wrangler exits zero without creating a Worker", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "takos-materializer-noop-deploy-"),
    );
    temporaryDirectories.push(root);
    const secretPath = join(root, "runtime-secrets.json");
    await writeFile(secretPath, JSON.stringify(secrets), { mode: 0o600 });
    await chmod(secretPath, 0o600);
    const archiveBytes = workerArchive();
    const release = descriptor(digest(archiveBytes));
    const descriptorBytes = new TextEncoder().encode(JSON.stringify(release));
    const invocation = parseInvocation("post_apply", {
      ...invocationEnv("post_apply", digest(descriptorBytes)),
      TAKOS_RUNTIME_SECRETS_FILE: secretPath,
    });
    const state: FakeState = {
      deployed: false,
      vector: false,
      containers: false,
      consumers: false,
      blankDeploymentReadback: true,
      blankSecretReadback: true,
      workerPresence: false,
      noopDeploy: true,
    };
    const fake = fakeDependencies(
      state,
      invocation.outputs,
      release,
      descriptorBytes,
      archiveBytes,
    );

    let error: unknown;
    try {
      await materializePostApply({
        invocation,
        sourceRoot: join(import.meta.dir, ".."),
        dependencies: fake,
      });
    } catch (caught) {
      error = caught;
    }

    const evidence = failureEvidence(error, "post_apply");
    expect(evidence).toMatchObject({
      code: "invalid_readback",
      stage: "readback",
      mutationStarted: true,
      completedStages: ["vector_created", "d1_migrations_applied"],
    });
    expect(evidence.completedStages).not.toContain("worker_deployed");
  });

  test("refuses to adopt a Worker when blank deployment status confirms presence", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "takos-materializer-ambiguous-deployment-"),
    );
    temporaryDirectories.push(root);
    const secretPath = join(root, "runtime-secrets.json");
    await writeFile(secretPath, JSON.stringify(secrets), { mode: 0o600 });
    await chmod(secretPath, 0o600);
    const archiveBytes = workerArchive();
    const release = descriptor(digest(archiveBytes));
    const descriptorBytes = new TextEncoder().encode(JSON.stringify(release));
    const invocation = parseInvocation("post_apply", {
      ...invocationEnv("post_apply", digest(descriptorBytes)),
      TAKOS_RUNTIME_SECRETS_FILE: secretPath,
    });
    const state: FakeState = {
      deployed: false,
      vector: false,
      containers: false,
      consumers: false,
      blankDeploymentReadback: true,
      workerPresence: true,
    };
    const fake = fakeDependencies(
      state,
      invocation.outputs,
      release,
      descriptorBytes,
      archiveBytes,
    );
    let error: unknown;
    try {
      await materializePostApply({
        invocation,
        sourceRoot: join(import.meta.dir, ".."),
        dependencies: fake,
      });
    } catch (caught) {
      error = caught;
    }
    expect(failureEvidence(error, "post_apply")).toMatchObject({
      code: "resource_conflict",
      stage: "readback",
      mutationStarted: false,
    });
    expect(fake.calls.some((call) => call[0] === "d1")).toBe(false);
    expect(fake.calls.some((call) => call[0] === "worker-presence")).toBe(true);
    expect(
      fake.calls.some(
        (call) => call[0] === "deploy" && !call.includes("--dry-run"),
      ),
    ).toBe(false);
  });

  test("refuses a blank secret readback when the Worker presence API says it exists", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "takos-materializer-ambiguous-secrets-"),
    );
    temporaryDirectories.push(root);
    const secretPath = join(root, "runtime-secrets.json");
    await writeFile(secretPath, JSON.stringify(secrets), { mode: 0o600 });
    await chmod(secretPath, 0o600);
    const archiveBytes = workerArchive();
    const release = descriptor(digest(archiveBytes));
    const descriptorBytes = new TextEncoder().encode(JSON.stringify(release));
    const invocation = parseInvocation("post_apply", {
      ...invocationEnv("post_apply", digest(descriptorBytes)),
      TAKOS_RUNTIME_SECRETS_FILE: secretPath,
    });
    const state: FakeState = {
      deployed: false,
      vector: false,
      containers: false,
      consumers: false,
      blankSecretReadback: true,
      workerPresence: true,
    };
    const fake = fakeDependencies(
      state,
      invocation.outputs,
      release,
      descriptorBytes,
      archiveBytes,
    );

    let error: unknown;
    try {
      await materializePostApply({
        invocation,
        sourceRoot: join(import.meta.dir, ".."),
        dependencies: fake,
      });
    } catch (caught) {
      error = caught;
    }
    expect(failureEvidence(error, "post_apply")).toMatchObject({
      code: "invalid_readback",
      stage: "readback",
      mutationStarted: false,
    });
    expect(fake.calls.some((call) => call[0] === "worker-presence")).toBe(true);
    expect(fake.calls.some((call) => call[0] === "d1")).toBe(false);
  });

  test("keeps stale secrets until the replacement Worker deploy succeeds", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "takos-materializer-secret-order-"),
    );
    temporaryDirectories.push(root);
    const secretPath = join(root, "runtime-secrets.json");
    await writeFile(secretPath, JSON.stringify(secrets), { mode: 0o600 });
    await chmod(secretPath, 0o600);
    const archiveBytes = workerArchive();
    const release = descriptor(digest(archiveBytes));
    const descriptorBytes = new TextEncoder().encode(JSON.stringify(release));
    const invocation = parseInvocation("post_apply", {
      ...invocationEnv("post_apply", digest(descriptorBytes)),
      TAKOS_RUNTIME_SECRETS_FILE: secretPath,
    });
    const state: FakeState = {
      deployed: true,
      vector: true,
      containers: false,
      consumers: false,
      staleSecret: true,
      message: existingProvenanceMessage(),
      tag: releaseTag,
    };
    const fake = fakeDependencies(
      state,
      invocation.outputs,
      release,
      descriptorBytes,
      archiveBytes,
    );

    await materializePostApply({
      invocation,
      sourceRoot: join(import.meta.dir, ".."),
      dependencies: fake,
    });

    const deployIndex = fake.calls.findIndex(
      (call) => call[0] === "deploy" && !call.includes("--dry-run"),
    );
    const pruneIndex = fake.calls.findIndex(
      (call) => call[0] === "secret" && call[1] === "bulk",
    );
    expect(deployIndex).toBeGreaterThan(-1);
    expect(pruneIndex).toBeGreaterThan(deployIndex);
  });

  test("marks the first failed writer as a partial mutation", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "takos-materializer-writer-failure-"),
    );
    temporaryDirectories.push(root);
    const secretPath = join(root, "runtime-secrets.json");
    await writeFile(secretPath, JSON.stringify(secrets), { mode: 0o600 });
    await chmod(secretPath, 0o600);
    const archiveBytes = workerArchive();
    const release = descriptor(digest(archiveBytes));
    const descriptorBytes = new TextEncoder().encode(JSON.stringify(release));
    const invocation = parseInvocation("post_apply", {
      ...invocationEnv("post_apply", digest(descriptorBytes)),
      TAKOS_RUNTIME_SECRETS_FILE: secretPath,
    });
    const state: FakeState = {
      deployed: false,
      vector: false,
      containers: false,
      consumers: false,
    };
    const fake = fakeDependencies(
      state,
      invocation.outputs,
      release,
      descriptorBytes,
      archiveBytes,
    );
    const runWrangler = fake.runWrangler.bind(fake);
    fake.runWrangler = async (args, timeoutMs) => {
      if (args[0] === "vectorize" && args[1] === "create") {
        state.vector = true;
        return { exitCode: 1, stdout: "", stderr: "provider failure" };
      }
      return runWrangler(args, timeoutMs);
    };

    let error: unknown;
    try {
      await materializePostApply({
        invocation,
        sourceRoot: join(import.meta.dir, ".."),
        dependencies: fake,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeDefined();
    expect(failureEvidence(error, "post_apply")).toMatchObject({
      status: "failed",
      stage: "vector_create",
      mutationStarted: true,
    });
  });

  test("pre_destroy removes only Takos-owned follow-up resources and leaves backing resources to OpenTofu", async () => {
    const archiveBytes = workerArchive();
    const release = descriptor(digest(archiveBytes));
    const descriptorBytes = new TextEncoder().encode(JSON.stringify(release));
    const invocation = parseInvocation(
      "pre_destroy",
      invocationEnv("pre_destroy"),
    );
    const state: FakeState = {
      deployed: true,
      vector: true,
      containers: true,
      consumers: true,
      r2Objects: {
        [invocation.outputs.buckets.offload]: [
          "agent-runs/run-1/request.json",
          "agent-runs/run-1/result.json",
        ],
        [invocation.outputs.buckets.git_objects]: ["objects/aa/bb"],
      },
      message: existingProvenanceMessage(),
      tag: releaseTag,
    };
    const fake = fakeDependencies(
      state,
      invocation.outputs,
      release,
      descriptorBytes,
      archiveBytes,
    );
    const evidence = await materializePreDestroy({
      invocation,
      sourceRoot: join(import.meta.dir, ".."),
      dependencies: fake,
    });
    expect(evidence).toMatchObject({
      status: "succeeded",
      phase: "pre_destroy",
      cleanup: {
        r2ObjectsRemoved: 3,
        backingResources: "left_for_opentofu_destroy",
      },
    });
    expect(state).toMatchObject({
      deployed: false,
      vector: false,
      containers: false,
      consumers: false,
    });
    expect(
      Object.values(state.r2Objects ?? {}).every((keys) => keys.length === 0),
    ).toBe(true);
    expect(
      fake.calls.findIndex((call) => call[0] === "worker-delete"),
    ).toBeLessThan(
      fake.calls.findIndex((call) => call[0] === "r2-object-delete"),
    );
    expect(fake.calls.some((call) => call[0] === "d1")).toBe(false);
    expect(
      fake.calls.some(
        (call) =>
          call[0] === "worker-delete" &&
          call[1] === invocation.outputs.workerName,
      ),
    ).toBe(true);
    expect(JSON.stringify(evidence)).not.toContain(sourceCommit);
    expect(JSON.stringify(evidence)).not.toContain(
      rawOutputs.service_runtime_name,
    );
    expect(JSON.stringify(evidence)).not.toContain("deployment-1");
    expect(JSON.stringify(evidence)).not.toContain("version-1");
  });

  test("pre_destroy waits for asynchronously deleted containers to disappear", async () => {
    const archiveBytes = workerArchive();
    const release = descriptor(digest(archiveBytes));
    const descriptorBytes = new TextEncoder().encode(JSON.stringify(release));
    const invocation = parseInvocation(
      "pre_destroy",
      invocationEnv("pre_destroy"),
    );
    const state: FakeState = {
      deployed: true,
      vector: true,
      containers: true,
      consumers: true,
      containerDeletionReadbacksRemaining: 12,
      message: existingProvenanceMessage(),
      tag: releaseTag,
    };
    const fake = fakeDependencies(
      state,
      invocation.outputs,
      release,
      descriptorBytes,
      archiveBytes,
    );

    const evidence = await materializePreDestroy({
      invocation,
      sourceRoot: join(import.meta.dir, ".."),
      dependencies: fake,
    });

    expect(evidence.status).toBe("succeeded");
    expect(state.containers).toBe(false);
  });

  test("reports zero removals for an already absent installation with blank queue readbacks", async () => {
    const archiveBytes = workerArchive();
    const release = descriptor(digest(archiveBytes));
    const descriptorBytes = new TextEncoder().encode(JSON.stringify(release));
    const invocation = parseInvocation(
      "pre_destroy",
      invocationEnv("pre_destroy"),
    );
    const state: FakeState = {
      deployed: false,
      vector: false,
      containers: false,
      consumers: false,
      blankDeploymentReadback: true,
      workerPresence: false,
      blankQueueConsumerReadback: true,
    };
    const fake = fakeDependencies(
      state,
      invocation.outputs,
      release,
      descriptorBytes,
      archiveBytes,
    );

    const evidence = await materializePreDestroy({
      invocation,
      sourceRoot: join(import.meta.dir, ".."),
      dependencies: fake,
    });
    expect(fake.calls.some((call) => call[0] === "worker-presence")).toBe(true);
    expect(evidence.cleanup).toEqual({
      workerRemoved: 0,
      queueConsumersRemoved: 0,
      containersRemoved: 0,
      vectorIndexesRemoved: 0,
      r2ObjectsRemoved: 0,
      backingResources: "left_for_opentofu_destroy",
    });
  });

  test("pre_destroy resumes after OpenTofu already removed queues in a partial destroy", async () => {
    const archiveBytes = workerArchive();
    const release = descriptor(digest(archiveBytes));
    const descriptorBytes = new TextEncoder().encode(JSON.stringify(release));
    const invocation = parseInvocation(
      "pre_destroy",
      invocationEnv("pre_destroy"),
    );
    const state: FakeState = {
      deployed: false,
      vector: false,
      containers: false,
      consumers: false,
      missingQueues: true,
      r2Objects: {},
    };
    const fake = fakeDependencies(
      state,
      invocation.outputs,
      release,
      descriptorBytes,
      archiveBytes,
    );

    const evidence = await materializePreDestroy({
      invocation,
      sourceRoot: join(import.meta.dir, ".."),
      dependencies: fake,
    });

    expect(evidence).toMatchObject({
      status: "succeeded",
      cleanup: {
        workerRemoved: 0,
        queueConsumersRemoved: 0,
        containersRemoved: 0,
        vectorIndexesRemoved: 0,
        r2ObjectsRemoved: 0,
      },
    });
    expect(
      fake.calls.some((call) => call[0] === "queues" && call[2] === "list"),
    ).toBe(true);
  });

  test("refuses a malformed Vectorize API readback before cleanup", async () => {
    const archiveBytes = workerArchive();
    const release = descriptor(digest(archiveBytes));
    const descriptorBytes = new TextEncoder().encode(JSON.stringify(release));
    const invocation = parseInvocation(
      "pre_destroy",
      invocationEnv("pre_destroy"),
    );
    const state: FakeState = {
      deployed: false,
      vector: true,
      containers: false,
      consumers: false,
      invalidVectorShape: true,
    };
    const fake = fakeDependencies(
      state,
      invocation.outputs,
      release,
      descriptorBytes,
      archiveBytes,
    );

    let error: unknown;
    try {
      await materializePreDestroy({
        invocation,
        sourceRoot: join(import.meta.dir, ".."),
        dependencies: fake,
      });
    } catch (caught) {
      error = caught;
    }
    expect(failureEvidence(error, "pre_destroy")).toMatchObject({
      code: "invalid_readback",
      stage: "readback",
      mutationStarted: false,
    });
    expect(fake.calls.some((call) => call[0] === "vector-readback")).toBe(true);
    expect(
      fake.calls.some(
        (call) => call[0] === "vectorize" && call[1] === "delete",
      ),
    ).toBe(false);
  });

  test("refuses pre_destroy when blank deployment status confirms Worker presence", async () => {
    const archiveBytes = workerArchive();
    const release = descriptor(digest(archiveBytes));
    const descriptorBytes = new TextEncoder().encode(JSON.stringify(release));
    const invocation = parseInvocation(
      "pre_destroy",
      invocationEnv("pre_destroy"),
    );
    const state: FakeState = {
      deployed: false,
      vector: false,
      containers: false,
      consumers: false,
      blankDeploymentReadback: true,
      workerPresence: true,
      blankQueueConsumerReadback: true,
    };
    const fake = fakeDependencies(
      state,
      invocation.outputs,
      release,
      descriptorBytes,
      archiveBytes,
    );

    let error: unknown;
    try {
      await materializePreDestroy({
        invocation,
        sourceRoot: join(import.meta.dir, ".."),
        dependencies: fake,
      });
    } catch (caught) {
      error = caught;
    }
    expect(failureEvidence(error, "pre_destroy")).toMatchObject({
      code: "resource_conflict",
      stage: "readback",
      mutationStarted: false,
    });
    expect(fake.calls.some((call) => call[0] === "worker-presence")).toBe(true);
    expect(
      fake.calls.some(
        (call) =>
          call[0] === "worker-delete" ||
          (call[0] === "queues" && call[2] === "remove") ||
          (call[0] === "containers" && call[1] === "delete") ||
          (call[0] === "vectorize" && call[1] === "delete"),
      ),
    ).toBe(false);
  });

  test("refuses to delete a same-name container attached to a foreign namespace", async () => {
    const archiveBytes = workerArchive();
    const release = descriptor(digest(archiveBytes));
    const descriptorBytes = new TextEncoder().encode(JSON.stringify(release));
    const invocation = parseInvocation(
      "pre_destroy",
      invocationEnv("pre_destroy"),
    );
    const state: FakeState = {
      deployed: true,
      vector: true,
      containers: true,
      consumers: true,
      foreignContainer: true,
      message: existingProvenanceMessage(),
      tag: releaseTag,
    };
    const fake = fakeDependencies(
      state,
      invocation.outputs,
      release,
      descriptorBytes,
      archiveBytes,
    );

    let error: unknown;
    try {
      await materializePreDestroy({
        invocation,
        sourceRoot: join(import.meta.dir, ".."),
        dependencies: fake,
      });
    } catch (caught) {
      error = caught;
    }
    expect(failureEvidence(error, "pre_destroy")).toMatchObject({
      code: "resource_conflict",
      mutationStarted: false,
    });
    expect(
      fake.calls.some(
        (call) =>
          (call[0] === "containers" && call[1] === "delete") ||
          (call[0] === "queues" && call[2] === "remove") ||
          (call[0] === "vectorize" && call[1] === "delete") ||
          call[0] === "worker-delete",
      ),
    ).toBe(false);
  });

  test("refuses to delete a Vectorize index not bound by the owned Worker", async () => {
    const archiveBytes = workerArchive();
    const release = descriptor(digest(archiveBytes));
    const descriptorBytes = new TextEncoder().encode(JSON.stringify(release));
    const invocation = parseInvocation(
      "pre_destroy",
      invocationEnv("pre_destroy"),
    );
    const state: FakeState = {
      deployed: true,
      vector: true,
      containers: false,
      consumers: false,
      foreignVectorBinding: true,
      message: existingProvenanceMessage(),
      tag: releaseTag,
    };
    const fake = fakeDependencies(
      state,
      invocation.outputs,
      release,
      descriptorBytes,
      archiveBytes,
    );

    let error: unknown;
    try {
      await materializePreDestroy({
        invocation,
        sourceRoot: join(import.meta.dir, ".."),
        dependencies: fake,
      });
    } catch (caught) {
      error = caught;
    }
    expect(failureEvidence(error, "pre_destroy")).toMatchObject({
      code: "resource_conflict",
      mutationStarted: false,
    });
    expect(
      fake.calls.some(
        (call) =>
          (call[0] === "vectorize" && call[1] === "delete") ||
          call[0] === "worker-delete",
      ),
    ).toBe(false);
  });

  test("failure evidence contains only bounded codes and digests", () => {
    const evidence = failureEvidence(new Error("secret-value"), "post_apply");
    expect(evidence).not.toHaveProperty("message");
    expect(JSON.stringify(evidence)).not.toContain("secret-value");
  });
});
