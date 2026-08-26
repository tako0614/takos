// takos-secret-scan: synthetic — provider credential values in this file are inert parser and refusal fixtures.
import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import {
  createDependencies,
  digest,
  FAILURE_POINTS,
  failureEvidence,
  MaterializerError,
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
import { readTakosumiCompositionSourceIdentity } from "./check-takosumi-composition-source.ts";

const accountId = "a".repeat(32);
const sourceCommit = "b".repeat(40);
const sourceSnapshotId = "snapshot_takos_1";
const workspaceId = "workspace_takos_1";
// Wrangler starts a real Node subprocess for config validation. Give that
// boundary enough time on a loaded portable runner while retaining a bounded
// failure instead of Bun's unrelated five-second default.
const WRANGLER_DRY_RUN_TEST_TIMEOUT_MS = 30_000;
const packageManifest = (await Bun.file(
  join(import.meta.dir, "..", "package.json"),
).json()) as { version: string };
const packageVersion = packageManifest.version;
const releaseTag = `v${packageVersion}`;
const descriptorUrl = `https://github.com/tako0614/takos/releases/download/${releaseTag}/takosumi-artifact.json`;
const archiveUrl = `https://github.com/tako0614/takos/releases/download/${releaseTag}/takos-worker-release.tar.gz`;
const executorImage = `registry.cloudflare.com/${accountId}/takos-agent@sha256:${"d".repeat(64)}`;
const takosumiCompositionSource =
  await readTakosumiCompositionSourceIdentity(
    join(import.meta.dir, ".."),
  );

const rawOutputs = {
  target: "cloudflare",
  cloudflare_account_id: accountId,
  service_runtime_name: "takos-example",
  url: "https://takos.example.test",
  launch_url: "https://takos.example.test",
  public_url: "https://takos.example.test",
  executor_capacity: {
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

function descriptor(
  archiveDigest: string,
  archiveSize = 1,
): ReleaseDescriptor {
  return {
    kind: "takosumi.worker-artifact@v2",
    app: "takos",
    commit: sourceCommit,
    ref: releaseTag,
    workflowRun: null,
    releaseTag,
    takosumiCompositionSource,
    artifact: {
      filename: "takos-worker-release.tar.gz",
      url: archiveUrl,
      sha256: archiveDigest.slice("sha256:".length),
      sha256Prefixed: archiveDigest,
      size: archiveSize,
      contentType: "application/gzip",
    },
    assetManifest: "asset-manifest.json",
    containerImages: { executor: executorImage },
    manifestUrl: descriptorUrl,
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
    TAKOSUMI_WORKSPACE_ID: workspaceId,
    TAKOSUMI_OUTPUTS_JSON: JSON.stringify(rawOutputs),
    TAKOSUMI_PROVIDER_CONFIGS_JSON: JSON.stringify(providerConfigurations),
    TAKOSUMI_RELEASE_CONTEXT_JSON: JSON.stringify({
      kind: "takosumi.release-context@v1",
      releaseRunId: "release_run_1",
      workspaceId,
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
  test("reports finite granular invocation failure points without changing input classification", () => {
    expect(new Set(FAILURE_POINTS).size).toBe(FAILURE_POINTS.length);
    expect(FAILURE_POINTS).toEqual(
      expect.arrayContaining([
        "invocation",
        "node_runtime",
        "wrangler_runtime",
        "composition_source",
        "descriptor",
        "archive",
        "runtime_secret_file",
        "config_render",
        "wrangler_dry_run",
        "deployment_readback",
        "worker_version_readback",
        "secret_readback",
        "container_readback",
        "queue_readback",
        "vector_readback",
      ]),
    );
    const base = {
      ...invocationEnv("post_apply", `sha256:${"f".repeat(64)}`),
      TAKOS_RUNTIME_SECRETS_FILE: "/tmp/runtime-secrets.json",
    };
    const malformedOutputs = { ...rawOutputs, sql_databases: null };
    const cases: Array<{
      env: NodeJS.ProcessEnv;
      failurePoint: string;
    }> = [
      {
        env: { ...base, TAKOSUMI_SOURCE_COMMIT: "not-a-commit" },
        failurePoint: "invocation_source_identity",
      },
      {
        env: {
          ...base,
          TAKOSUMI_RELEASE_CONTEXT_JSON: JSON.stringify({
            kind: "takosumi.release-context@v1",
            releaseRunId: "different-release-run",
            workspaceId,
            outputs: rawOutputs,
          }),
        },
        failurePoint: "invocation_release_context",
      },
      {
        env: {
          ...base,
          TAKOSUMI_OUTPUTS_JSON: JSON.stringify(malformedOutputs),
          TAKOSUMI_RELEASE_CONTEXT_JSON: JSON.stringify({
            kind: "takosumi.release-context@v1",
            releaseRunId: "release_run_1",
            workspaceId,
            outputs: malformedOutputs,
          }),
        },
        failurePoint: "invocation_outputs",
      },
      {
        env: {
          ...base,
          TAKOSUMI_PROVIDER_CONFIGS_JSON: JSON.stringify({
            ...providerConfigurations,
            providers: [],
          }),
        },
        failurePoint: "invocation_provider",
      },
      {
        env: { ...base, CLOUDFLARE_API_TOKEN: "" },
        failurePoint: "invocation_credential",
      },
      {
        env: { ...base, CF_API_TOKEN: "rejected-ambient-provider-value" },
        failurePoint: "invocation_ambient_authority",
      },
      {
        env: {
          ...base,
          TAKOS_RELEASE_ARTIFACT_DESCRIPTOR_URL:
            "https://attacker.example.test/private-resource-name",
        },
        failurePoint: "invocation_descriptor_reference",
      },
      {
        env: { ...base, TAKOS_RUNTIME_SECRETS_FILE: "relative/credential.json" },
        failurePoint: "invocation_runtime_secret_path",
      },
    ];

    for (const item of cases) {
      let error: unknown;
      try {
        parseInvocation("post_apply", item.env);
      } catch (caught) {
        error = caught;
      }
      expect(failureEvidence(error, "post_apply")).toMatchObject({
        code: "invalid_input",
        stage: "preflight",
        failurePoint: item.failurePoint,
        mutationStarted: false,
      });
    }
  });

  test("binds every mutable Worker surface to nonsecret OpenTofu outputs", () => {
    const outputs = parseTakosOutputs(rawOutputs);
    const config = renderWranglerConfig({
      outputs,
      descriptor: descriptor(`sha256:${"f".repeat(64)}`),
      workspaceId,
      artifactRoot: "/tmp/artifact",
      sourceRoot: "/source",
    });
    expect(config.name).toBe("takos-example");
    expect(config.vars).toMatchObject({
      ADMIN_DOMAIN: "takos.example.test",
      CF_ACCOUNT_ID: accountId,
      TAKOSUMI_WORKSPACE_ID: workspaceId,
    });
    expect((config.containers as unknown[]).length).toBe(3);
    expect((config.queues as { consumers: unknown[] }).consumers.length).toBe(
      6,
    );
    expect((config.migrations as unknown[]).at(-1)).toEqual({
      tag: "v7",
      deleted_classes: ["TakosRuntimeContainer"],
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
          takosumiCompositionSource,
        },
      ),
    ).toThrow(/SourceSnapshot commit/u);
    expect(
      validateReleaseDescriptor(
        descriptor(`sha256:${"f".repeat(64)}`),
        {
          sourceCommit,
          packageVersion,
          accountId,
          descriptorUrl,
          takosumiCompositionSource,
        },
      ).takosumiCompositionSource,
    ).toEqual(takosumiCompositionSource);
    expect(() =>
      validateReleaseDescriptor(
        {
          ...descriptor(`sha256:${"f".repeat(64)}`),
          takosumiCompositionSource: {
            ...takosumiCompositionSource,
            commit: "95e7048b4d2a2277ed2024a4d41a37c5e482640f",
          },
        },
        {
          sourceCommit,
          packageVersion,
          accountId,
          descriptorUrl,
          takosumiCompositionSource,
        },
      ),
    ).toThrow(/Takosumi composition source/u);
    expect(() =>
      validateRuntimeSecrets({ ...secrets, UNKNOWN_SECRET: "x" }),
    ).toThrow(/not in the Takos secret contract/u);
    expect(() =>
      validateRuntimeSecrets({
        ...secrets,
        TAKOS_APP_INSTALL_TOKEN: "legacy-token",
      }),
    ).toThrow(/not in the Takos secret contract/u);
  });

  test("accepts a public OIDC runtime bundle without a client secret", () => {
    const publicSecrets = { ...secrets } as Record<string, string>;
    delete publicSecrets.OIDC_CLIENT_SECRET;

    expect(validateRuntimeSecrets(publicSecrets)).not.toHaveProperty(
      "OIDC_CLIENT_SECRET",
    );
    expect(validateRuntimeSecrets(secrets).OIDC_CLIENT_SECRET).toBe(
      "oidc-client-secret-value",
    );
  });

  test("requires canonical host source identity and rejects duplicate credentials", () => {
    const env = invocationEnv("pre_destroy");
    expect(parseInvocation("pre_destroy", env)).toMatchObject({
      sourceCommit,
      workspaceId,
    });
    expect(() =>
      parseInvocation("pre_destroy", {
        ...env,
        TAKOSUMI_SOURCE_COMMIT: "short",
      }),
    ).toThrow(/full commit/u);
    expect(() =>
      parseInvocation("pre_destroy", { ...env, CF_API_TOKEN: "ambiguous" }),
    ).toThrow(/not accepted/u);
    expect(() =>
      parseInvocation("pre_destroy", {
        ...env,
        TAKOSUMI_WORKSPACE_ID: undefined,
      }),
    ).toThrow(/TAKOSUMI_WORKSPACE_ID/u);
    expect(() =>
      parseInvocation("pre_destroy", {
        ...env,
        TAKOSUMI_RELEASE_CONTEXT_JSON: JSON.stringify({
          kind: "takosumi.release-context@v1",
          releaseRunId: "release_run_1",
          workspaceId: "workspace-other",
          outputs: rawOutputs,
        }),
      }),
    ).toThrow(/workspace id drifted/u);
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
          workspaceId,
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
  }, WRANGLER_DRY_RUN_TEST_TIMEOUT_MS);

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
  malformedDeploymentReadback?: boolean;
  malformedWorkerVersionReadback?: boolean;
  malformedSecretReadback?: boolean;
  malformedContainerReadback?: boolean;
  malformedContainerInfoReadback?: boolean;
  malformedQueueReadback?: boolean;
  malformedQueueSettingsReadback?: boolean;
  queueReadbackFailureAfterCalls?: number;
  queueReadbackCallCount?: number;
  malformedVectorReadback?: boolean;
  malformedWorkerOwnershipResources?: boolean;
  blankDeploymentReadback?: boolean;
  blankSecretReadback?: boolean;
  workerPresence?: boolean;
  invalidVectorShape?: boolean;
  blankQueueConsumerReadback?: boolean;
  missingQueues?: boolean;
  r2Objects?: Record<string, string[]>;
  r2ListFailureBucket?: string;
  foreignContainer?: boolean;
  legacyRuntimeContainer?: boolean;
  foreignVectorBinding?: boolean;
  stuckQueueCleanup?: boolean;
  stuckContainerCleanup?: boolean;
  stuckVectorCleanup?: boolean;
  staleSecret?: boolean;
  noopDeploy?: boolean;
  expandedContainerInfo?: boolean;
  containerDeletionReadbacksRemaining?: number;
  containerDeletionRequested?: boolean;
  workerPresenceReadbacksRemaining?: number;
  workerPresenceFailureAfterDelete?: boolean;
  workerDeletionRequested?: boolean;
  tempRootRemovalFailure?: boolean;
  privateJsonWriteFailure?: boolean;
  privateJsonWriteFailureAtCall?: number;
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
  let privateJsonWriteCallCount = 0;
  const consumers = expectedConsumers(outputs);
  const containerShapes = [
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
        state.workerPresenceFailureAfterDelete &&
        state.workerDeletionRequested
      ) {
        throw new MaterializerError({
          code: "readback_failed",
          stage: "readback",
          message: "runner-private Worker presence failure",
          diagnosticDigest: digest("worker-presence-readback-failure"),
          failurePoint: "worker_presence_readback",
        });
      }
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
      state.workerDeletionRequested = true;
      state.deployed = false;
    },
    async readVector(indexName) {
      calls.push(["vector-readback", indexName]);
      if (state.malformedVectorReadback) {
        return { name: outputs.vector.name };
      }
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
      if (state.r2ListFailureBucket === bucketName) {
        throw new MaterializerError({
          code: "readback_failed",
          stage: "r2_object_readback",
          message: "runner-private R2 list failure",
          diagnosticDigest: digest("r2-list-provider-failure"),
          failurePoint: "r2_cleanup",
        });
      }
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
        if (state.malformedDeploymentReadback) {
          return ok({
            versions: [{ version_id: "version-1", percentage: 100 }],
          });
        }
        if (!state.deployed && state.blankDeploymentReadback) return success();
        return state.deployed
          ? ok({
              id: "deployment-1",
              versions: [{ version_id: "version-1", percentage: 100 }],
            })
          : missing();
      }
      if (argv[0] === "secret" && argv[1] === "list") {
        if (state.malformedSecretReadback) return ok([{}]);
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
        if (state.malformedContainerReadback) return ok([{}]);
        if (
          state.containerDeletionRequested &&
          state.containers &&
          !state.stuckContainerCleanup
        ) {
          if ((state.containerDeletionReadbacksRemaining ?? 0) > 0) {
            state.containerDeletionReadbacksRemaining =
              (state.containerDeletionReadbacksRemaining ?? 0) - 1;
          } else {
            state.containers = false;
          }
        }
        return ok(
          state.containers
            ? [
                ...containerShapes.map(([suffix, , , image], index) => ({
                  id: `container-${index}`,
                  name: `${outputs.workerName}-${suffix}`,
                  state: "ready",
                  image,
                })),
                ...(state.legacyRuntimeContainer
                  ? [
                      {
                        id: "legacy-runtime-container",
                        name: `${outputs.workerName}-runtime`,
                        state: "ready",
                        image: release.containerImages.executor,
                      },
                    ]
                  : []),
              ]
            : [],
        );
      }
      if (argv[0] === "containers" && argv[1] === "info") {
        const index = Number(argv[2]!.split("-").at(-1));
        const [suffix, instanceType, maxInstances, image] =
          containerShapes[index]!;
        if (state.malformedContainerInfoReadback) {
          return ok({
            id: argv[2],
            name: `${outputs.workerName}-${suffix}`,
            max_instances: maxInstances,
            rollout_active_grace_period: 900,
            durable_objects: { namespace_id: `namespace-${index}` },
          });
        }
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
        if (argv[2]?.startsWith("container-")) {
          state.containerDeletionRequested = true;
          if (
            !state.stuckContainerCleanup &&
            (state.containerDeletionReadbacksRemaining ?? 0) === 0
          ) {
            state.containers = false;
          }
        }
        return success();
      }
      if (argv[0] === "queues" && argv[2] === "list") {
        state.queueReadbackCallCount = (state.queueReadbackCallCount ?? 0) + 1;
        if (
          state.queueReadbackFailureAfterCalls !== undefined &&
          state.queueReadbackCallCount > state.queueReadbackFailureAfterCalls
        ) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: "runner-private queue readback failure",
          };
        }
        if (state.malformedQueueReadback) return ok([null]);
        if (state.missingQueues) return missing();
        if (state.blankQueueConsumerReadback && !state.consumers) {
          return { exitCode: 0, stdout: "\n", stderr: "" };
        }
        if (state.consumers && state.malformedQueueSettingsReadback) {
          return ok([
            {
              ...(consumers[argv[3]!] as Record<string, unknown>),
              settings: { batch_size: 1 },
            },
          ]);
        }
        return ok(state.consumers ? [consumers[argv[3]!]] : []);
      }
      if (argv[0] === "queues" && argv[2] === "remove") {
        if (
          !state.malformedQueueSettingsReadback &&
          !state.stuckQueueCleanup &&
          argv[3] === outputs.queues.notification_push_dlq
        ) {
          state.consumers = false;
        }
        return success();
      }
      if (argv[0] === "vectorize" && argv[1] === "create") {
        state.vector = true;
        return ok({ name: outputs.vector.name });
      }
      if (argv[0] === "vectorize" && argv[1] === "delete") {
        if (!state.stuckVectorCleanup) state.vector = false;
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
        if (state.malformedWorkerVersionReadback) {
          return ok({ annotations: {}, resources: { bindings: [] } });
        }
        return ok({
          id: "version-1",
          annotations: {
            "workers/message": state.message,
            "workers/tag": state.tag,
          },
          resources: {
            bindings: state.malformedWorkerOwnershipResources
              ? undefined
              : [
              {
                type: "durable_object_namespace",
                class_name: "ExecutorContainerTier1",
                namespace_id: "namespace-0",
              },
              {
                type: "durable_object_namespace",
                class_name: "ExecutorContainerTier2",
                namespace_id: "namespace-1",
              },
              {
                type: "durable_object_namespace",
                class_name: "ExecutorContainerTier3",
                namespace_id: "namespace-2",
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
    async writePrivateJson(path, value) {
      calls.push(["private-json-write"]);
      privateJsonWriteCallCount += 1;
      if (
        state.privateJsonWriteFailure ||
        state.privateJsonWriteFailureAtCall === privateJsonWriteCallCount
      ) {
        throw new Error("runner-private config write failure");
      }
      await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
        flag: "wx",
        mode: 0o600,
      });
      await chmod(path, 0o600);
    },
    async removeTempRoot(path) {
      calls.push(["temp-root-remove", path]);
      if (state.tempRootRemovalFailure) {
        temporaryDirectories.push(path);
        throw new Error("runner-private temp cleanup failure");
      }
      await rm(path, { recursive: true, force: true });
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

function isMutationCall(call: readonly string[]): boolean {
  return (
    (call[0] === "deploy" && !call.includes("--dry-run")) ||
    call[0] === "d1" ||
    (call[0] === "vectorize" && ["create", "delete"].includes(call[1] ?? "")) ||
    (call[0] === "secret" && call[1] === "bulk") ||
    (call[0] === "queues" && ["add", "remove"].includes(call[2] ?? "")) ||
    (call[0] === "containers" && call[1] === "delete") ||
    call[0] === "worker-delete" ||
    call[0] === "r2-object-delete"
  );
}

async function postApplyFixture(state: FakeState) {
  const root = await mkdtemp(join(tmpdir(), "takos-materializer-diagnostic-"));
  temporaryDirectories.push(root);
  const secretPath = join(root, "runtime-secrets.json");
  await writeFile(secretPath, JSON.stringify(secrets), { mode: 0o600 });
  await chmod(secretPath, 0o600);
  const archiveBytes = workerArchive();
  const release = descriptor(digest(archiveBytes), archiveBytes.byteLength);
  const descriptorBytes = new TextEncoder().encode(JSON.stringify(release));
  const invocation = parseInvocation("post_apply", {
    ...invocationEnv("post_apply", digest(descriptorBytes)),
    TAKOS_RUNTIME_SECRETS_FILE: secretPath,
  });
  const dependencies = fakeDependencies(
    state,
    invocation.outputs,
    release,
    descriptorBytes,
    archiveBytes,
  );
  return { invocation, dependencies };
}

function preDestroyFixture(state: FakeState) {
  const archiveBytes = workerArchive();
  const release = descriptor(digest(archiveBytes), archiveBytes.byteLength);
  const descriptorBytes = new TextEncoder().encode(JSON.stringify(release));
  const invocation = parseInvocation(
    "pre_destroy",
    invocationEnv("pre_destroy"),
  );
  const dependencies = fakeDependencies(
    state,
    invocation.outputs,
    release,
    descriptorBytes,
    archiveBytes,
  );
  return { invocation, dependencies };
}

function providerAdapter(
  fetchImpl: NonNullable<Parameters<typeof createDependencies>[0]["fetchImpl"]>,
): MaterializerDependencies {
  return createDependencies({
    nodeBin: NODE_EXECUTABLE,
    wranglerBin: "/tmp/unused-wrangler.mjs",
    sourceRoot: join(import.meta.dir, ".."),
    apiToken: "test-token",
    accountId,
    fetchImpl,
  });
}

describe("materializer lifecycle", () => {
  test("classifies a malformed deployment shape as a pre-mutation deployment readback failure", async () => {
    const { invocation, dependencies } = await postApplyFixture({
      deployed: false,
      vector: false,
      containers: false,
      consumers: false,
      malformedDeploymentReadback: true,
    });

    let error: unknown;
    try {
      await materializePostApply({
        invocation,
        sourceRoot: join(import.meta.dir, ".."),
        dependencies,
      });
    } catch (caught) {
      error = caught;
    }

    expect(failureEvidence(error, "post_apply")).toMatchObject({
      code: "invalid_readback",
      stage: "readback",
      failurePoint: "deployment_readback",
      mutationStarted: false,
    });
    expect(dependencies.calls.some(isMutationCall)).toBe(false);
  });

  test("classifies a malformed Worker version shape before any mutation", async () => {
    const { invocation, dependencies } = await postApplyFixture({
      deployed: true,
      vector: false,
      containers: false,
      consumers: false,
      malformedWorkerVersionReadback: true,
      message: existingProvenanceMessage(),
      tag: releaseTag,
    });

    let error: unknown;
    try {
      await materializePostApply({
        invocation,
        sourceRoot: join(import.meta.dir, ".."),
        dependencies,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ failurePoint: "worker_version_readback" });
    expect(failureEvidence(error, "post_apply")).toMatchObject({
      code: "invalid_readback",
      stage: "readback",
      failurePoint: "worker_version_readback",
      mutationStarted: false,
    });
    expect(dependencies.calls.some(isMutationCall)).toBe(false);
  });

  test("classifies a missing secret-list field before any mutation", async () => {
    const { invocation, dependencies } = await postApplyFixture({
      deployed: false,
      vector: false,
      containers: false,
      consumers: false,
      malformedSecretReadback: true,
    });

    let error: unknown;
    try {
      await materializePostApply({
        invocation,
        sourceRoot: join(import.meta.dir, ".."),
        dependencies,
      });
    } catch (caught) {
      error = caught;
    }

    expect(failureEvidence(error, "post_apply")).toMatchObject({
      code: "invalid_readback",
      stage: "readback",
      failurePoint: "secret_readback",
      mutationStarted: false,
    });
    expect(dependencies.calls.some(isMutationCall)).toBe(false);
  });

  test("classifies missing container-list fields before any mutation", async () => {
    const { invocation, dependencies } = await postApplyFixture({
      deployed: false,
      vector: false,
      containers: false,
      consumers: false,
      malformedContainerReadback: true,
    });

    let error: unknown;
    try {
      await materializePostApply({
        invocation,
        sourceRoot: join(import.meta.dir, ".."),
        dependencies,
      });
    } catch (caught) {
      error = caught;
    }

    expect(failureEvidence(error, "post_apply")).toMatchObject({
      code: "invalid_readback",
      stage: "readback",
      failurePoint: "container_readback",
      mutationStarted: false,
    });
    expect(dependencies.calls.some(isMutationCall)).toBe(false);
  });

  test("classifies malformed Containers API shapes through the injected provider adapter", async () => {
    const cases = [
      {
        label: "invalid JSON",
        response: async () =>
          new Response("{", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      },
      {
        label: "malformed envelope",
        response: async () =>
          Response.json({ result: [], result_info: {} }),
      },
      {
        label: "malformed result",
        response: async () =>
          Response.json({ success: true, result: {}, result_info: {} }),
      },
      {
        label: "malformed pagination",
        response: async () =>
          Response.json({ success: true, result: [], result_info: "invalid" }),
      },
      {
        label: "repeated pagination token",
        response: async () =>
          Response.json({
            success: true,
            result: [],
            result_info: { next_page_token: "repeated" },
          }),
      },
    ];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("global fetch must not be used by createDependencies");
    }) as unknown as typeof fetch;
    try {
      for (const item of cases) {
        const { invocation, dependencies } = await postApplyFixture({
          deployed: false,
          vector: false,
          containers: false,
          consumers: false,
        });
        let injectedFetchCalls = 0;
        const adapter = providerAdapter(async () => {
          injectedFetchCalls += 1;
          return item.response();
        });
        const fakeRunWrangler = dependencies.runWrangler.bind(dependencies);
        dependencies.runWrangler = (args, timeoutMs) =>
          args[0] === "containers" && args[1] === "list"
            ? adapter.runWrangler(args, timeoutMs)
            : fakeRunWrangler(args, timeoutMs);

        let error: unknown;
        try {
          await materializePostApply({
            invocation,
            sourceRoot: join(import.meta.dir, ".."),
            dependencies,
          });
        } catch (caught) {
          error = caught;
        }

        expect(injectedFetchCalls).toBeGreaterThan(0);
        expect(failureEvidence(error, "post_apply")).toMatchObject({
          code: "invalid_readback",
          stage: "readback",
          failurePoint: "container_readback",
          mutationStarted: false,
          completedStages: [],
        });
        expect(dependencies.calls.some(isMutationCall)).toBe(false);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("rejects missing DashApplication health counters before mutation", async () => {
    const fullCounters = {
      active: 1,
      healthy: 1,
      failed: 0,
      starting: 0,
      scheduling: 0,
    };
    const baseApplication = {
      id: "container-app-0001",
      name: `${rawOutputs.service_runtime_name}-executor-tier1`,
      image: executorImage,
    };
    const applications = [
      baseApplication,
      { ...baseApplication, health: {} },
      ...Object.keys(fullCounters).map((missingCounter) => ({
        ...baseApplication,
        health: {
          instances: Object.fromEntries(
            Object.entries(fullCounters).filter(
              ([counter]) => counter !== missingCounter,
            ),
          ),
        },
      })),
    ];

    for (const application of applications) {
      const { invocation, dependencies } = await postApplyFixture({
        deployed: false,
        vector: false,
        containers: false,
        consumers: false,
      });
      const adapter = providerAdapter(async () =>
        Response.json({
          success: true,
          result: [application],
          result_info: {},
        })
      );
      const fakeRunWrangler = dependencies.runWrangler.bind(dependencies);
      dependencies.runWrangler = (args, timeoutMs) =>
        args[0] === "containers" && args[1] === "list"
          ? adapter.runWrangler(args, timeoutMs)
          : fakeRunWrangler(args, timeoutMs);

      let error: unknown;
      try {
        await materializePostApply({
          invocation,
          sourceRoot: join(import.meta.dir, ".."),
          dependencies,
        });
      } catch (caught) {
        error = caught;
      }

      expect(failureEvidence(error, "post_apply")).toMatchObject({
        code: "invalid_readback",
        stage: "readback",
        failurePoint: "container_readback",
        mutationStarted: false,
        completedStages: [],
      });
      expect(dependencies.calls.some(isMutationCall)).toBe(false);
    }
  });

  test("preserves Containers adapter transport and HTTP provider failures", async () => {
    for (const fetchImpl of [
      async () => {
        throw new TypeError("runner-private transport failure");
      },
      async () => new Response(null, { status: 503 }),
    ]) {
      const { invocation, dependencies } = await postApplyFixture({
        deployed: false,
        vector: false,
        containers: false,
        consumers: false,
      });
      const adapter = providerAdapter(fetchImpl);
      const fakeRunWrangler = dependencies.runWrangler.bind(dependencies);
      dependencies.runWrangler = (args, timeoutMs) =>
        args[0] === "containers" && args[1] === "list"
          ? adapter.runWrangler(args, timeoutMs)
          : fakeRunWrangler(args, timeoutMs);

      let error: unknown;
      try {
        await materializePostApply({
          invocation,
          sourceRoot: join(import.meta.dir, ".."),
          dependencies,
        });
      } catch (caught) {
        error = caught;
      }

      expect(failureEvidence(error, "post_apply")).toMatchObject({
        code: "provider_command_failed",
        stage: "container_list",
        failurePoint: "container_readback",
        mutationStarted: false,
        completedStages: [],
      });
      expect(dependencies.calls.some(isMutationCall)).toBe(false);
    }
  });

  test("classifies a malformed production-like containers info response before any mutation", async () => {
    const { invocation, dependencies } = await postApplyFixture({
      deployed: true,
      vector: false,
      containers: true,
      consumers: false,
      malformedContainerInfoReadback: true,
      message: existingProvenanceMessage(),
      tag: releaseTag,
    });

    let error: unknown;
    try {
      await materializePostApply({
        invocation,
        sourceRoot: join(import.meta.dir, ".."),
        dependencies,
      });
    } catch (caught) {
      error = caught;
    }

    expect(failureEvidence(error, "post_apply")).toMatchObject({
      code: "invalid_readback",
      stage: "readback",
      failurePoint: "container_readback",
      mutationStarted: false,
    });
    expect(
      dependencies.calls.some(
        (call) => call[0] === "containers" && call[1] === "info",
      ),
    ).toBe(true);
    expect(dependencies.calls.some(isMutationCall)).toBe(false);
  });

  test("classifies a malformed queue consumer entry before any mutation", async () => {
    const { invocation, dependencies } = await postApplyFixture({
      deployed: false,
      vector: false,
      containers: false,
      consumers: false,
      malformedQueueReadback: true,
    });

    let error: unknown;
    try {
      await materializePostApply({
        invocation,
        sourceRoot: join(import.meta.dir, ".."),
        dependencies,
      });
    } catch (caught) {
      error = caught;
    }

    expect(failureEvidence(error, "post_apply")).toMatchObject({
      code: "invalid_readback",
      stage: "readback",
      failurePoint: "queue_readback",
      mutationStarted: false,
    });
    expect(dependencies.calls.some(isMutationCall)).toBe(false);
  });

  test("classifies missing Vectorize fields before any mutation", async () => {
    const { invocation, dependencies } = await postApplyFixture({
      deployed: false,
      vector: false,
      containers: false,
      consumers: false,
      malformedVectorReadback: true,
    });

    let error: unknown;
    try {
      await materializePostApply({
        invocation,
        sourceRoot: join(import.meta.dir, ".."),
        dependencies,
      });
    } catch (caught) {
      error = caught;
    }

    expect(failureEvidence(error, "post_apply")).toMatchObject({
      code: "invalid_readback",
      stage: "readback",
      failurePoint: "vector_readback",
      mutationStarted: false,
    });
    expect(dependencies.calls.some(isMutationCall)).toBe(false);
  });

  test("rejects malformed Vectorize HTTP 200 envelopes through the provider adapter before mutation", async () => {
    const malformedEnvelopes = [
      { success: true },
      { success: true, result: null },
      {
        result: {
          name: rawOutputs.vector_indexes.vector.name,
          config: { dimensions: 768, metric: "cosine" },
        },
      },
    ];
    for (const phase of ["post_apply", "pre_destroy"] as const) {
      for (const envelope of malformedEnvelopes) {
        const fixture = phase === "post_apply"
          ? await postApplyFixture({
              deployed: false,
              vector: false,
              containers: false,
              consumers: false,
            })
          : preDestroyFixture({
              deployed: false,
              vector: false,
              containers: false,
              consumers: false,
            });
        const adapter = providerAdapter(async () => Response.json(envelope));
        fixture.dependencies.readVector = adapter.readVector;

        let error: unknown;
        try {
          if (phase === "post_apply") {
            await materializePostApply({
              invocation: fixture.invocation,
              sourceRoot: join(import.meta.dir, ".."),
              dependencies: fixture.dependencies,
            });
          } else {
            await materializePreDestroy({
              invocation: fixture.invocation,
              sourceRoot: join(import.meta.dir, ".."),
              dependencies: fixture.dependencies,
            });
          }
        } catch (caught) {
          error = caught;
        }

        expect(failureEvidence(error, phase)).toMatchObject({
          code: "invalid_readback",
          stage: "readback",
          failurePoint: "vector_readback",
          mutationStarted: false,
          completedStages: [],
        });
        expect(fixture.dependencies.calls.some(isMutationCall)).toBe(false);
      }
    }
  });

  test("classifies existing Worker provenance conflicts at the Worker version boundary", async () => {
    const { invocation, dependencies } = await postApplyFixture({
      deployed: true,
      vector: false,
      containers: false,
      consumers: false,
      message: "foreign Worker provenance",
      tag: releaseTag,
    });

    let error: unknown;
    try {
      await materializePostApply({
        invocation,
        sourceRoot: join(import.meta.dir, ".."),
        dependencies,
      });
    } catch (caught) {
      error = caught;
    }

    expect(failureEvidence(error, "post_apply")).toMatchObject({
      code: "resource_conflict",
      stage: "readback",
      failurePoint: "worker_version_readback",
      mutationStarted: false,
    });
    expect(dependencies.calls.some(isMutationCall)).toBe(false);
  });

  test("classifies orphaned queue and Vectorize ownership anchors at their provider boundaries", async () => {
    for (const item of [
      {
        state: {
          deployed: false,
          vector: true,
          containers: false,
          consumers: false,
        },
        failurePoint: "vector_readback",
      },
      {
        state: {
          deployed: false,
          vector: false,
          containers: false,
          consumers: true,
        },
        failurePoint: "queue_readback",
      },
    ] as const) {
      const { invocation, dependencies } = await postApplyFixture(item.state);
      let error: unknown;
      try {
        await materializePostApply({
          invocation,
          sourceRoot: join(import.meta.dir, ".."),
          dependencies,
        });
      } catch (caught) {
        error = caught;
      }

      expect(failureEvidence(error, "post_apply")).toMatchObject({
        code: "resource_conflict",
        stage: "readback",
        failurePoint: item.failurePoint,
        mutationStarted: false,
      });
      expect(dependencies.calls.some(isMutationCall)).toBe(false);
    }
  });

  test("classifies malformed Worker child bindings at the resource provider boundary", async () => {
    for (const item of [
      { vector: true, consumers: false, failurePoint: "vector_readback" },
      { vector: false, consumers: true, failurePoint: "queue_readback" },
    ] as const) {
      const { invocation, dependencies } = await postApplyFixture({
        deployed: true,
        vector: item.vector,
        containers: false,
        consumers: item.consumers,
        malformedWorkerOwnershipResources: true,
        message: existingProvenanceMessage(),
        tag: releaseTag,
      });
      let error: unknown;
      try {
        await materializePostApply({
          invocation,
          sourceRoot: join(import.meta.dir, ".."),
          dependencies,
        });
      } catch (caught) {
        error = caught;
      }

      expect(failureEvidence(error, "post_apply")).toMatchObject({
        code: "resource_conflict",
        stage: "readback",
        failurePoint: item.failurePoint,
        mutationStarted: false,
      });
      expect(dependencies.calls.some(isMutationCall)).toBe(false);
    }
  });

  test("fails closed when a retired runtime container remains", async () => {
    const root = await mkdtemp(join(tmpdir(), "takos-materializer-runtime-residue-"));
    temporaryDirectories.push(root);
    const secretPath = join(root, "runtime-secrets.json");
    await writeFile(secretPath, JSON.stringify(secrets), { mode: 0o600 });
    await chmod(secretPath, 0o600);
    const archiveBytes = workerArchive();
    const release = descriptor(digest(archiveBytes), archiveBytes.byteLength);
    const descriptorBytes = new TextEncoder().encode(JSON.stringify(release));
    const invocation = parseInvocation("post_apply", {
      ...invocationEnv("post_apply", digest(descriptorBytes)),
      TAKOS_RUNTIME_SECRETS_FILE: secretPath,
    });
    const fake = fakeDependencies(
      {
        deployed: true,
        vector: false,
        containers: true,
        consumers: false,
        legacyRuntimeContainer: true,
        message: existingProvenanceMessage(),
        tag: releaseTag,
      },
      invocation.outputs,
      release,
      descriptorBytes,
      archiveBytes,
    );

    await expect(
      materializePostApply({
        invocation,
        sourceRoot: join(import.meta.dir, ".."),
        dependencies: fake,
      }),
    ).rejects.toMatchObject({
      code: "resource_conflict",
      stage: "readback",
      failurePoint: "container_readback",
    });
    expect(
      fake.calls.some(
        (call) => call[0] === "deploy" && !call.includes("--dry-run"),
      ),
    ).toBe(false);
  });

  test("post_apply converges and proves artifact, migrations, Worker, containers, queues, secrets, and health", async () => {
    const root = await mkdtemp(join(tmpdir(), "takos-materializer-test-"));
    temporaryDirectories.push(root);
    const secretPath = join(root, "runtime-secrets.json");
    await writeFile(secretPath, JSON.stringify(secrets), { mode: 0o600 });
    await chmod(secretPath, 0o600);
    const archiveBytes = workerArchive();
    const release = descriptor(digest(archiveBytes), archiveBytes.byteLength);
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
      containers: 3,
      queueConsumers: 6,
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
    const release = descriptor(digest(archiveBytes), archiveBytes.byteLength);
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
    const release = descriptor(digest(archiveBytes), archiveBytes.byteLength);
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
    const release = descriptor(digest(archiveBytes), archiveBytes.byteLength);
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
    const release = descriptor(digest(archiveBytes), archiveBytes.byteLength);
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
      failurePoint: "worker_presence_readback",
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
    const release = descriptor(digest(archiveBytes), archiveBytes.byteLength);
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
      failurePoint: "secret_readback",
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
    const release = descriptor(digest(archiveBytes), archiveBytes.byteLength);
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

  test("classifies stale-secret reconcile file failure at the runtime secret boundary", async () => {
    const { invocation, dependencies } = await postApplyFixture({
      deployed: true,
      vector: true,
      containers: false,
      consumers: false,
      staleSecret: true,
      privateJsonWriteFailureAtCall: 3,
      message: existingProvenanceMessage(),
      tag: releaseTag,
    });

    let error: unknown;
    try {
      await materializePostApply({
        invocation,
        sourceRoot: join(import.meta.dir, ".."),
        dependencies,
      });
    } catch (caught) {
      error = caught;
    }

    expect(failureEvidence(error, "post_apply")).toMatchObject({
      code: "unexpected_failure",
      stage: "materialization",
      failurePoint: "runtime_secret_file",
      mutationStarted: false,
      completedStages: [],
    });
    expect(
      dependencies.calls.filter((call) => call[0] === "private-json-write"),
    ).toHaveLength(3);
    expect(dependencies.calls.some(isMutationCall)).toBe(false);
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
    const release = descriptor(digest(archiveBytes), archiveBytes.byteLength);
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
      failurePoint: "vector_mutation",
      mutationStarted: true,
    });
  });

  test("preserves a post_apply mutation failure when temp cleanup also fails", async () => {
    const { invocation, dependencies } = await postApplyFixture({
      deployed: false,
      vector: false,
      containers: false,
      consumers: false,
      tempRootRemovalFailure: true,
    });
    const runWrangler = dependencies.runWrangler.bind(dependencies);
    dependencies.runWrangler = async (args, timeoutMs) => {
      if (args[0] === "vectorize" && args[1] === "create") {
        return { exitCode: 1, stdout: "", stderr: "provider failure" };
      }
      return runWrangler(args, timeoutMs);
    };

    let error: unknown;
    try {
      await materializePostApply({
        invocation,
        sourceRoot: join(import.meta.dir, ".."),
        dependencies,
      });
    } catch (caught) {
      error = caught;
    }

    expect(failureEvidence(error, "post_apply")).toMatchObject({
      code: "provider_command_failed",
      stage: "vector_create",
      failurePoint: "vector_mutation",
      mutationStarted: true,
      completedStages: [],
      diagnosticDigest: digest("1\n\nprovider failure"),
    });
    expect((error as Error & { cause?: unknown }).cause).toMatchObject({
      code: "temp_cleanup_failed",
      stage: "materialization",
      failurePoint: "runtime_secret_file",
      mutationStarted: true,
      completedStages: [],
    });
  });

  test("reports post_apply temp cleanup failure with realized mutation evidence", async () => {
    const { invocation, dependencies } = await postApplyFixture({
      deployed: true,
      vector: true,
      containers: true,
      consumers: true,
      tempRootRemovalFailure: true,
      message: existingProvenanceMessage(),
      tag: releaseTag,
    });

    let error: unknown;
    try {
      await materializePostApply({
        invocation,
        sourceRoot: join(import.meta.dir, ".."),
        dependencies,
      });
    } catch (caught) {
      error = caught;
    }

    expect(failureEvidence(error, "post_apply")).toMatchObject({
      code: "temp_cleanup_failed",
      stage: "materialization",
      failurePoint: "runtime_secret_file",
      mutationStarted: true,
      completedStages: [
        "d1_migrations_applied",
        "worker_deployed",
        "queue_consumers_reconciled",
      ],
    });
  });

  test("classifies malformed queue settings at the queue readback boundary", async () => {
    const { invocation, dependencies } = await postApplyFixture({
      deployed: true,
      vector: true,
      containers: false,
      consumers: true,
      malformedQueueSettingsReadback: true,
      message: existingProvenanceMessage(),
      tag: releaseTag,
    });

    let error: unknown;
    try {
      await materializePostApply({
        invocation,
        sourceRoot: join(import.meta.dir, ".."),
        dependencies,
      });
    } catch (caught) {
      error = caught;
    }

    expect(failureEvidence(error, "post_apply")).toMatchObject({
      code: "invalid_readback",
      stage: "readback",
      failurePoint: "queue_readback",
      mutationStarted: false,
    });
    expect(dependencies.calls.some(isMutationCall)).toBe(false);
  });

  test("pre_destroy removes only Takos-owned follow-up resources and leaves backing resources to OpenTofu", async () => {
    const archiveBytes = workerArchive();
    const release = descriptor(digest(archiveBytes), archiveBytes.byteLength);
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
    const release = descriptor(digest(archiveBytes), archiveBytes.byteLength);
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
    const release = descriptor(digest(archiveBytes), archiveBytes.byteLength);
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
    const release = descriptor(digest(archiveBytes), archiveBytes.byteLength);
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

  test("keeps R2 cleanup marked mutated when a later bucket readback fails", async () => {
    const archiveBytes = workerArchive();
    const release = descriptor(digest(archiveBytes), archiveBytes.byteLength);
    const descriptorBytes = new TextEncoder().encode(JSON.stringify(release));
    const invocation = parseInvocation(
      "pre_destroy",
      invocationEnv("pre_destroy"),
    );
    const firstBucket = invocation.outputs.buckets.worker_bundles;
    const laterBucket = invocation.outputs.buckets.tenant_builds;
    const fake = fakeDependencies(
      {
        deployed: false,
        vector: false,
        containers: false,
        consumers: false,
        r2Objects: { [firstBucket]: ["already-deleted-before-failure"] },
        r2ListFailureBucket: laterBucket,
      },
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
      code: "readback_failed",
      stage: "r2_object_readback",
      failurePoint: "r2_cleanup",
      mutationStarted: true,
      completedStages: ["r2_objects_deleted"],
    });
    expect(
      fake.calls.some(
        (call) =>
          call[0] === "r2-object-delete" && call[1] === firstBucket,
      ),
    ).toBe(true);
  });

  test("classifies malformed R2 list shapes through the provider adapter before mutation", async () => {
    for (const envelope of [
      { success: true },
      { success: true, result: {} },
      { success: true, result: [{}] },
    ]) {
      const { invocation, dependencies } = preDestroyFixture({
        deployed: false,
        vector: false,
        containers: false,
        consumers: false,
      });
      const adapter = providerAdapter(async () => Response.json(envelope));
      dependencies.listR2Objects = adapter.listR2Objects;

      let error: unknown;
      try {
        await materializePreDestroy({
          invocation,
          sourceRoot: join(import.meta.dir, ".."),
          dependencies,
        });
      } catch (caught) {
        error = caught;
      }

      expect(failureEvidence(error, "pre_destroy")).toMatchObject({
        code: "invalid_readback",
        stage: "readback",
        failurePoint: "r2_cleanup",
        mutationStarted: false,
        completedStages: [],
      });
      expect(dependencies.calls.some(isMutationCall)).toBe(false);
    }
  });

  test("preserves R2 adapter transport and HTTP readback failures", async () => {
    for (const fetchImpl of [
      async () => {
        throw new TypeError("runner-private transport failure");
      },
      async () => new Response(null, { status: 503 }),
    ]) {
      const { invocation, dependencies } = preDestroyFixture({
        deployed: false,
        vector: false,
        containers: false,
        consumers: false,
      });
      const adapter = providerAdapter(fetchImpl);
      dependencies.listR2Objects = adapter.listR2Objects;

      let error: unknown;
      try {
        await materializePreDestroy({
          invocation,
          sourceRoot: join(import.meta.dir, ".."),
          dependencies,
        });
      } catch (caught) {
        error = caught;
      }

      expect(failureEvidence(error, "pre_destroy")).toMatchObject({
        code: "readback_failed",
        stage: "r2_object_readback",
        failurePoint: "r2_cleanup",
        mutationStarted: false,
        completedStages: [],
      });
      expect(dependencies.calls.some(isMutationCall)).toBe(false);
    }
  });

  test("keeps each child cleanup timeout at its concrete readback boundary", async () => {
    for (const item of [
      {
        state: {
          deployed: true,
          vector: false,
          containers: false,
          consumers: true,
          stuckQueueCleanup: true,
          message: existingProvenanceMessage(),
          tag: releaseTag,
        },
        failurePoint: "queue_readback",
      },
      {
        state: {
          deployed: true,
          vector: false,
          containers: true,
          consumers: false,
          stuckContainerCleanup: true,
          message: existingProvenanceMessage(),
          tag: releaseTag,
        },
        failurePoint: "container_readback",
      },
      {
        state: {
          deployed: true,
          vector: true,
          containers: false,
          consumers: false,
          stuckVectorCleanup: true,
          message: existingProvenanceMessage(),
          tag: releaseTag,
        },
        failurePoint: "vector_readback",
      },
    ] as const) {
      const { invocation, dependencies } = preDestroyFixture(item.state);
      let error: unknown;
      try {
        await materializePreDestroy({
          invocation,
          sourceRoot: join(import.meta.dir, ".."),
          dependencies,
        });
      } catch (caught) {
        error = caught;
      }

      expect(failureEvidence(error, "pre_destroy")).toMatchObject({
        code: "invalid_readback",
        stage: "readback",
        failurePoint: item.failurePoint,
        mutationStarted: true,
      });
      expect(dependencies.calls.some(isMutationCall)).toBe(true);
    }
  });

  test("does not claim cleanup mutation when absent resources are followed by readback failure", async () => {
    const { invocation, dependencies } = preDestroyFixture({
      deployed: false,
      vector: false,
      containers: false,
      consumers: false,
      queueReadbackFailureAfterCalls: Object.keys(rawOutputs.queues).length,
    });

    let error: unknown;
    try {
      await materializePreDestroy({
        invocation,
        sourceRoot: join(import.meta.dir, ".."),
        dependencies,
      });
    } catch (caught) {
      error = caught;
    }

    expect(failureEvidence(error, "pre_destroy")).toMatchObject({
      code: "provider_command_failed",
      stage: "queue_consumer_readback",
      failurePoint: "queue_readback",
      mutationStarted: false,
      completedStages: [],
    });
    expect(dependencies.calls.some(isMutationCall)).toBe(false);
  });

  test("reports pre_destroy temp cleanup failure without inventing mutation", async () => {
    const { invocation, dependencies } = preDestroyFixture({
      deployed: false,
      vector: false,
      containers: false,
      consumers: false,
      tempRootRemovalFailure: true,
    });

    let error: unknown;
    try {
      await materializePreDestroy({
        invocation,
        sourceRoot: join(import.meta.dir, ".."),
        dependencies,
      });
    } catch (caught) {
      error = caught;
    }

    expect(failureEvidence(error, "pre_destroy")).toMatchObject({
      code: "temp_cleanup_failed",
      stage: "materialization",
      failurePoint: "config_render",
      mutationStarted: false,
      completedStages: [],
    });
    expect(dependencies.calls.some(isMutationCall)).toBe(false);
  });

  test("classifies pre_destroy config write failure before mutation", async () => {
    const { invocation, dependencies } = preDestroyFixture({
      deployed: false,
      vector: false,
      containers: false,
      consumers: false,
      privateJsonWriteFailure: true,
    });

    let error: unknown;
    try {
      await materializePreDestroy({
        invocation,
        sourceRoot: join(import.meta.dir, ".."),
        dependencies,
      });
    } catch (caught) {
      error = caught;
    }

    expect(failureEvidence(error, "pre_destroy")).toMatchObject({
      code: "unexpected_failure",
      stage: "materialization",
      failurePoint: "config_render",
      mutationStarted: false,
      completedStages: [],
    });
    expect(dependencies.calls.some(isMutationCall)).toBe(false);
  });

  test("preserves the last Worker absence readback failure through temp cleanup failure", async () => {
    const { invocation, dependencies } = preDestroyFixture({
      deployed: true,
      vector: false,
      containers: false,
      consumers: false,
      workerPresenceFailureAfterDelete: true,
      tempRootRemovalFailure: true,
      message: existingProvenanceMessage(),
      tag: releaseTag,
    });

    let error: unknown;
    try {
      await materializePreDestroy({
        invocation,
        sourceRoot: join(import.meta.dir, ".."),
        dependencies,
      });
    } catch (caught) {
      error = caught;
    }

    expect(failureEvidence(error, "pre_destroy")).toMatchObject({
      code: "readback_failed",
      stage: "readback",
      failurePoint: "worker_presence_readback",
      mutationStarted: true,
      completedStages: ["worker_deleted"],
      diagnosticDigest: digest("worker-presence-readback-failure"),
    });
    expect((error as Error & { cause?: unknown }).cause).toMatchObject({
      code: "temp_cleanup_failed",
      stage: "materialization",
      failurePoint: "config_render",
      mutationStarted: true,
      completedStages: ["worker_deleted"],
    });
  });

  test("refuses a malformed Vectorize API readback before cleanup", async () => {
    const archiveBytes = workerArchive();
    const release = descriptor(digest(archiveBytes), archiveBytes.byteLength);
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
    const release = descriptor(digest(archiveBytes), archiveBytes.byteLength);
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
      failurePoint: "worker_presence_readback",
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
    const release = descriptor(digest(archiveBytes), archiveBytes.byteLength);
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
      stage: "readback",
      failurePoint: "container_readback",
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
    const release = descriptor(digest(archiveBytes), archiveBytes.byteLength);
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
      stage: "readback",
      failurePoint: "vector_readback",
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

  test("fallback diagnostics are stable per failure point and contain no raw values", () => {
    const first = failureEvidence(
      new MaterializerError({
        code: "invalid_readback",
        stage: "readback",
        failurePoint: "queue_readback",
        message:
          "raw-error-message resource-name credential-value provider-output /private/file/path",
      }),
      "post_apply",
    );
    const samePointDifferentMessage = failureEvidence(
      new MaterializerError({
        code: "invalid_readback",
        stage: "readback",
        failurePoint: "queue_readback",
        message: "completely-different-raw-message",
      }),
      "post_apply",
    );
    const differentPoint = failureEvidence(
      new MaterializerError({
        code: "invalid_readback",
        stage: "readback",
        failurePoint: "container_readback",
        message: "completely-different-raw-message",
      }),
      "post_apply",
    );

    expect(first.diagnosticDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(first.diagnosticDigest).toBe(samePointDifferentMessage.diagnosticDigest);
    expect(first.diagnosticDigest).not.toBe(differentPoint.diagnosticDigest);
    const terminalJson = JSON.stringify(first);
    for (const forbidden of [
      "raw-error-message",
      "resource-name",
      "credential-value",
      "provider-output",
      "/private/file/path",
    ]) {
      expect(terminalJson).not.toContain(forbidden);
    }
  });
});
