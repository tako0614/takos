import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { RUNTIME_SECRET_BINDING_NAMES } from "./cloudflare-production-config.ts";
import {
  TAKOS_CLOUDFLARE_PRODUCTION_SURFACE,
  latestMigrationTag,
  mutatesTarget,
  parseCloudflareProductionArgs,
  pendingDurableObjectWork,
  runCloudflareProductionRecorded,
  type CommandRequest,
  type CommandResult,
  type SurfaceRuntime,
} from "./cloudflare-production-deploy.ts";
import { TAKOS_RELEASE_ARTIFACT_SURFACE } from "./release-artifact-deploy.ts";

const repositoryRoot = resolve(import.meta.dir, "..");
const ACCOUNT = "00000000000000000000000000000001";
const IMAGE = `registry.cloudflare.com/${ACCOUNT}/takos-agent@sha256:${"a".repeat(64)}`;
const HEAD = "1".repeat(40);
const SERVED = "11111111-2222-3333-4444-555555555555";
const NEXT = "99999999-8888-7777-6666-555555555555";

function outputs(overrides: Record<string, unknown> = {}): string {
  const wrap = (value: unknown) => ({ sensitive: false, type: "string", value });
  return JSON.stringify({
    cloudflare_account_id: wrap(ACCOUNT),
    service_runtime_name: wrap("takos-live"),
    public_url: wrap("https://app.example.test"),
    worker_env: wrap({
      ADMIN_DOMAIN: "app.example.test",
      TENANT_BASE_DOMAIN: "app.example.test",
      AUTH_PUBLIC_BASE_URL: "https://app.example.test",
      PROXY_BASE_URL: "https://app.example.test",
      TAKOS_AGENT_CONTROL_RPC_BASE_URL: "https://app.example.test",
      CF_ACCOUNT_ID: ACCOUNT,
      CF_ZONE_ID: "zone-1234",
      TAKOSUMI_ACCOUNTS_URL: "https://accounts.example.test",
      OIDC_ISSUER_URL: "https://accounts.example.test",
      OIDC_CLIENT_ID: "takos-live-client",
      OIDC_REDIRECT_URI: "https://app.example.test/auth/oidc/callback",
      EXECUTOR_TIER1_WARM_POOL_SIZE: "1",
      EXECUTOR_TIER1_MAX_CONCURRENT_RUNS: "4",
      EXECUTOR_TIER3_POOL_SIZE: "1",
      EXECUTOR_TIER3_MAX_CONCURRENT_RUNS: "1",
    }),
    cloudflare_d1_database_id: wrap("d1-0000"),
    cloudflare_d1_database_name: wrap("takos-live-db"),
    cloudflare_kv_namespace_ids: wrap({ hostname_routing: "kv-0000" }),
    object_buckets: wrap({
      worker_bundles: "takos-live-worker-bundles",
      tenant_builds: "takos-live-tenant-builds",
      tenant_source: "takos-live-tenant-source",
      git_objects: "takos-live-git-objects",
      offload: "takos-live-offload",
    }),
    queues: wrap({
      runs: "takos-live-runs",
      runs_dlq: "takos-live-runs-dlq",
      index_jobs: "takos-live-index-jobs",
      index_jobs_dlq: "takos-live-index-jobs-dlq",
      notification_push: "takos-live-notification-push",
      notification_push_dlq: "takos-live-notification-push-dlq",
    }),
    cloudflare_vectorize_index_name: wrap("takos-live-embeddings"),
    cloudflare_vectorize_index_dimensions: wrap(768),
    cloudflare_vectorize_index_metric: wrap("cosine"),
    runtime_secret_binding_names: wrap([...RUNTIME_SECRET_BINDING_NAMES]),
    runtime_secrets_provisioned: wrap(true),
    cloudflare_worker_version_id: wrap(SERVED),
    ...overrides,
  });
}

function versionJson(versionId: string): string {
  return JSON.stringify({
    id: versionId,
    metadata: { migration_tag: "v7" },
    resources: {
      bindings: [
        { name: "DB", type: "d1", id: "d1-0000" },
        { name: "HOSTNAME_ROUTING", type: "kv_namespace", namespace_id: "kv-0000" },
        { name: "WORKER_BUNDLES", type: "r2_bucket", bucket_name: "takos-live-worker-bundles" },
        { name: "TENANT_BUILDS", type: "r2_bucket", bucket_name: "takos-live-tenant-builds" },
        { name: "TENANT_SOURCE", type: "r2_bucket", bucket_name: "takos-live-tenant-source" },
        { name: "GIT_OBJECTS", type: "r2_bucket", bucket_name: "takos-live-git-objects" },
        { name: "TAKOS_OFFLOAD", type: "r2_bucket", bucket_name: "takos-live-offload" },
        { name: "RUN_QUEUE", type: "queue", queue_name: "takos-live-runs" },
        { name: "INDEX_QUEUE", type: "queue", queue_name: "takos-live-index-jobs" },
        {
          name: "TAKOS_NOTIFICATION_PUSH_QUEUE",
          type: "queue",
          queue_name: "takos-live-notification-push",
        },
        { name: "VECTORIZE", type: "vectorize", index_name: "takos-live-embeddings" },
        { name: "SESSION_DO", type: "durable_object_namespace", class_name: "SessionDO" },
        { name: "RUN_NOTIFIER", type: "durable_object_namespace", class_name: "RunNotifierDO" },
        {
          name: "NOTIFICATION_NOTIFIER",
          type: "durable_object_namespace",
          class_name: "NotificationNotifierDO",
        },
        { name: "RATE_LIMITER_DO", type: "durable_object_namespace", class_name: "RateLimiterDO" },
        { name: "ROUTING_DO", type: "durable_object_namespace", class_name: "RoutingDO" },
        {
          name: "EXECUTOR_CONTAINER",
          type: "durable_object_namespace",
          class_name: "ExecutorContainerTier1",
        },
        {
          name: "EXECUTOR_CONTAINER_TIER2",
          type: "durable_object_namespace",
          class_name: "ExecutorContainerTier2",
        },
        {
          name: "EXECUTOR_CONTAINER_TIER3",
          type: "durable_object_namespace",
          class_name: "ExecutorContainerTier3",
        },
      ],
    },
  });
}

function secretListJson(names: readonly string[] = RUNTIME_SECRET_BINDING_NAMES): string {
  return JSON.stringify(names.map((name) => ({ name, type: "secret_text" })));
}

function containerListJson(image = IMAGE): string {
  return JSON.stringify(
    ["ExecutorContainerTier1", "ExecutorContainerTier2", "ExecutorContainerTier3"].map(
      (className, index) => ({
        id: `app-${index}`,
        name: `takos-live-${className}`,
        configuration: { image },
      }),
    ),
  );
}

type Reply = Partial<CommandResult> | undefined;

/**
 * A recording fake. Every command a phase issues lands in `issued`, and a
 * command with no canned reply fails loudly rather than silently succeeding —
 * a phase that reaches an unexpected part of the account should not pass.
 */
function stubRuntime(
  replies: readonly (readonly [RegExp, Reply])[],
  fetchReply: (url: string) => Promise<Response> = async () =>
    new Response("{}", { status: 200 }),
): SurfaceRuntime & { calls: CommandRequest[] } {
  const calls: CommandRequest[] = [];
  return {
    calls,
    async run(request: CommandRequest): Promise<CommandResult> {
      calls.push(request);
      const line = `${request.command} ${request.args.join(" ")}`;
      for (const [pattern, reply] of replies) {
        if (pattern.test(line)) {
          return { exitCode: 0, stdout: "", stderr: "", ...(reply ?? {}) };
        }
      }
      return { exitCode: 127, stdout: "", stderr: `unexpected command: ${line}` };
    },
    fetch: (url) => fetchReply(url),
  };
}

const HEALTHY_ACCOUNT: readonly (readonly [RegExp, Reply])[] = [
  [/wrangler deployments status/u, { stdout: `Version ID: ${SERVED}\n` }],
  [/wrangler versions view/u, { stdout: versionJson(SERVED) }],
  [/wrangler secret list/u, { stdout: secretListJson() }],
  [
    /wrangler vectorize get/u,
    {
      stdout: JSON.stringify({
        name: "takos-live-embeddings",
        config: { dimensions: 768, metric: "cosine" },
      }),
    },
  ],
  [/wrangler containers list/u, { stdout: containerListJson() }],
  [/wrangler deploy .*--dry-run/u, {}],
  [/^git rev-parse HEAD/u, { stdout: `${HEAD}\n` }],
  [/^git rev-parse --abbrev-ref HEAD/u, { stdout: "main\n" }],
  [/^git status --porcelain/u, { stdout: "" }],
];

async function scratch(): Promise<{ outputsPath: string; realizedConfig: string; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "takos-production-test-"));
  const outputsPath = join(root, "outputs.json");
  return { outputsPath, realizedConfig: join(root, "wrangler.toml"), root };
}

async function options(
  argv: readonly string[],
  outputsJson = outputs(),
): Promise<ReturnType<typeof parseCloudflareProductionArgs>> {
  const { outputsPath, realizedConfig } = await scratch();
  await writeFile(outputsPath, outputsJson);
  return parseCloudflareProductionArgs(
    [...argv, "--outputs", outputsPath, "--realized-config", realizedConfig],
    repositoryRoot,
  );
}

test("the contract answers every obligation its triggers make it owe", () => {
  const surface = TAKOS_CLOUDFLARE_PRODUCTION_SURFACE;
  expect(surface.surface).toBe("takos-cloudflare-production");
  expect(surface.target).toBe("cloudflare-worker:takos");
  expect([...surface.triggers].sort()).toEqual([
    "irreversible",
    "published-identity",
  ]);
  // baseline four plus what irreversible and published-identity add
  for (const obligation of [
    "provenance",
    "post-conditions",
    "reversal",
    "failure-handling",
    "pre-mutation-proof",
    "independent-review",
    "no-overwrite",
  ] as const) {
    expect(surface.obligations[obligation].trim().length).toBeGreaterThan(0);
  }
  // The control gate requires every declared variable to be discoverable from
  // this surface's own answers.
  const answers = Object.values(surface.obligations).join("\n");
  for (const variable of surface.requiresEnv) {
    expect(answers).toContain(variable);
  }
});

test("the release artifact surface is unchanged", () => {
  expect(TAKOS_RELEASE_ARTIFACT_SURFACE.surface).toBe("takos-release-artifact");
  expect(TAKOS_RELEASE_ARTIFACT_SURFACE.target).toBe(
    "github-release-cloudflare-registry-and-public-oci:takos",
  );
  expect([...TAKOS_RELEASE_ARTIFACT_SURFACE.triggers]).toEqual([
    "published-identity",
    "authority",
    "irreversible",
  ]);
  expect([...TAKOS_RELEASE_ARTIFACT_SURFACE.requiresTools]).toEqual([
    "bun",
    "docker",
    "git",
    "gh",
    "tar",
    "wrangler",
  ]);
  expect([...TAKOS_RELEASE_ARTIFACT_SURFACE.requiresEnv]).toEqual([]);
  expect(Object.keys(TAKOS_RELEASE_ARTIFACT_SURFACE.obligations).sort()).toEqual([
    "failure-handling",
    "independent-review",
    "no-overwrite",
    "post-conditions",
    "pre-mutation-proof",
    "provenance",
    "reversal",
  ]);
});

test("command classification is an allowlist and defaults to mutating", () => {
  const wrangler = (...args: string[]): CommandRequest => ({
    command: "bunx",
    args: ["wrangler", ...args],
  });
  expect(mutatesTarget(wrangler("deployments", "status"))).toBe(false);
  expect(mutatesTarget(wrangler("versions", "view", SERVED, "--json"))).toBe(false);
  expect(mutatesTarget(wrangler("secret", "list"))).toBe(false);
  expect(mutatesTarget(wrangler("vectorize", "get", "x", "--json"))).toBe(false);
  expect(mutatesTarget(wrangler("containers", "list", "--json"))).toBe(false);
  expect(mutatesTarget(wrangler("deploy", "--config", "x", "--dry-run"))).toBe(false);

  expect(mutatesTarget(wrangler("deploy", "--config", "x"))).toBe(true);
  expect(mutatesTarget(wrangler("vectorize", "create", "x"))).toBe(true);
  expect(mutatesTarget(wrangler("secret", "put", "ENCRYPTION_KEY"))).toBe(true);
  expect(mutatesTarget(wrangler("versions", "deploy", SERVED))).toBe(true);
  expect(mutatesTarget({ command: "git", args: ["push"] })).toBe(true);
  expect(mutatesTarget({ command: "git", args: ["rev-parse", "HEAD"] })).toBe(false);
  expect(mutatesTarget({ command: "curl", args: ["-XPOST", "https://api"] })).toBe(true);
});

test("--status reads the account and issues no mutating command", async () => {
  const runtime = stubRuntime(HEALTHY_ACCOUNT, async () => new Response("ok"));
  const { report, issued } = await runCloudflareProductionRecorded(
    await options([
      "--status",
      "--environment",
      "production",
      "--container-image",
      IMAGE,
    ]),
    runtime,
  );

  expect(issued.length).toBeGreaterThan(0);
  for (const request of issued) expect(mutatesTarget(request)).toBe(false);
  for (const request of runtime.calls) expect(mutatesTarget(request)).toBe(false);
  expect(report.kind).toBe("takos.cloudflare-production-status@v1");
  expect(report.drift).toEqual([]);
  expect((report.worker as { servedVersion: string }).servedVersion).toBe(SERVED);
  expect((report.durableObjects as { pending: string[] }).pending).toEqual([]);
});

test("--status names every drift an operator has to close before deploying", async () => {
  const runtime = stubRuntime(
    [
      [/wrangler deployments status/u, { exitCode: 1, stderr: "script_not_found" }],
      [/wrangler secret list/u, { exitCode: 1, stderr: "script_not_found" }],
      [/wrangler vectorize get/u, { exitCode: 1, stderr: "index not found" }],
      [/wrangler containers list/u, { stdout: "[]" }],
    ],
    async () => {
      throw new Error("connection refused");
    },
    );
  const { report, issued } = await runCloudflareProductionRecorded(
    await options(
      ["--status", "--environment", "production", "--container-image", IMAGE],
      outputs({
        runtime_secrets_provisioned: {
          sensitive: false,
          type: "bool",
          value: false,
        },
      }),
    ),
    runtime,
  );

  for (const request of issued) expect(mutatesTarget(request)).toBe(false);
  const drift = report.drift as string[];
  expect(drift.join("\n")).toContain("runtime_secrets_provisioned is false");
  expect(drift.join("\n")).toContain("does not exist; run --vectorize");
  expect(drift.join("\n")).toContain("0 of 3 Container applications");
  expect(drift.join("\n")).toContain("worker-absent");
  expect((report.runtimeSecrets as { missing: string[] }).missing).toEqual([
    ...RUNTIME_SECRET_BINDING_NAMES,
  ]);
});

test("--vectorize is idempotent when the index already has the product shape", async () => {
  const runtime = stubRuntime(HEALTHY_ACCOUNT);
  const { report, issued } = await runCloudflareProductionRecorded(
    await options(["--vectorize", "--environment", "production", "--execute"]),
    runtime,
  );
  expect(report.outcome).toBe("present");
  expect(issued.some((request) => request.args.includes("create"))).toBe(false);
});

test("--vectorize without --execute reports the creation it would make", async () => {
  const runtime = stubRuntime([
    [/wrangler vectorize get/u, { exitCode: 1, stderr: "index not found" }],
  ]);
  const { report, issued } = await runCloudflareProductionRecorded(
    await options(["--vectorize", "--environment", "integration"]),
    runtime,
  );
  expect(report.outcome).toBe("would-create");
  for (const request of issued) expect(mutatesTarget(request)).toBe(false);
});

test("--vectorize --execute creates the product-shaped index and reads it back", async () => {
  let created = false;
  const runtime = stubRuntime([
    [
      /wrangler vectorize create/u,
      { stdout: JSON.stringify({ name: "takos-live-embeddings" }) },
    ],
    [
      /wrangler vectorize get/u,
      {
        get stdout() {
          return created
            ? JSON.stringify({
                name: "takos-live-embeddings",
                config: { dimensions: 768, metric: "cosine" },
              })
            : "";
        },
        get exitCode() {
          return created ? 0 : 1;
        },
        get stderr() {
          return created ? "" : "index not found";
        },
      },
    ],
  ]);
  const original = runtime.run.bind(runtime);
  const recording: SurfaceRuntime & { calls: CommandRequest[] } = {
    calls: runtime.calls,
    async run(request) {
      const result = await original(request);
      if (request.args.includes("create")) created = true;
      return result;
    },
    fetch: runtime.fetch,
  };

  const { report, issued } = await runCloudflareProductionRecorded(
    await options(["--vectorize", "--environment", "production", "--execute"]),
    recording,
  );
  expect(report.outcome).toBe("created");
  const create = issued.find((request) => request.args.includes("create"));
  expect(create?.args).toContain("--dimensions=768");
  expect(create?.args).toContain("--metric=cosine");
});

test("--vectorize refuses an index whose shape the product cannot use", async () => {
  const runtime = stubRuntime([
    [
      /wrangler vectorize get/u,
      {
        stdout: JSON.stringify({
          name: "takos-live-embeddings",
          config: { dimensions: 1536, metric: "euclidean" },
        }),
      },
    ],
  ]);
  await expect(
    runCloudflareProductionRecorded(
      await options(["--vectorize", "--environment", "production", "--execute"]),
      runtime,
    ),
  ).rejects.toThrow(/cannot be reshaped/u);
});

test("--apply refuses while the runtime secrets are not provisioned", async () => {
  const runtime = stubRuntime(HEALTHY_ACCOUNT);
  await expect(
    runCloudflareProductionRecorded(
      await options(
        [
          "--apply",
          "--environment",
          "integration",
          "--container-image",
          IMAGE,
          "--execute",
        ],
        outputs({
          runtime_secrets_provisioned: {
            sensitive: false,
            type: "bool",
            value: false,
          },
        }),
      ),
      runtime,
    ),
  ).rejects.toThrow(/runtime_secrets_provisioned is false/u);
  expect(runtime.calls.some((request) => mutatesTarget(request))).toBe(false);
});

test("--apply refuses when a runtime secret is absent from the Worker", async () => {
  // The first matching reply wins, so the override goes ahead of the healthy set.
  const runtime = stubRuntime([
    [
      /wrangler secret list/u,
      { stdout: secretListJson(["ENCRYPTION_KEY", "PLATFORM_PUBLIC_KEY"]) },
    ],
    ...HEALTHY_ACCOUNT,
  ]);
  await expect(
    runCloudflareProductionRecorded(
      await options([
        "--apply",
        "--environment",
        "integration",
        "--container-image",
        IMAGE,
        "--execute",
      ]),
      runtime,
    ),
  ).rejects.toThrow(/missing runtime secrets/u);
  expect(runtime.calls.some((request) => mutatesTarget(request))).toBe(false);
});

test("--apply refuses a pending Durable Object migration in the routine lane", async () => {
  const runtime = stubRuntime([
    [
      /wrangler versions view/u,
      { stdout: JSON.stringify({ id: SERVED, metadata: { migration_tag: "v5" } }) },
    ],
    ...HEALTHY_ACCOUNT,
  ]);
  await expect(
    runCloudflareProductionRecorded(
      await options([
        "--apply",
        "--environment",
        "integration",
        "--container-image",
        IMAGE,
        "--execute",
      ]),
      runtime,
    ),
  ).rejects.toThrow(/irreversible topology change/u);
  expect(runtime.calls.some((request) => mutatesTarget(request))).toBe(false);
});

test("--apply without --execute plans, proves the config compiles, and mutates nothing", async () => {
  // Wrangler bundles from the worktree for integration, so the built assets
  // have to be there; the gate builds them, and a plan says so if they are not.
  const distIndex = join(repositoryRoot, "dist/index.html");
  const built = await readFile(distIndex).then(
    () => true,
    () => false,
  );
  const runtime = stubRuntime(HEALTHY_ACCOUNT);
  const run = runCloudflareProductionRecorded(
    await options([
      "--apply",
      "--environment",
      "integration",
      "--container-image",
      IMAGE,
    ]),
    runtime,
  );
  if (!built) {
    await expect(run).rejects.toThrow(/dist\/index\.html is missing/u);
    return;
  }
  const { report, issued } = await run;
  expect(report.outcome).toBe("planned");
  expect(report.mutation).toBe("none");
  expect((report.durableObjects as { pending: string[] }).pending).toEqual([]);
  expect(report.rollback).toContain(`wrangler versions deploy ${SERVED}@100%`);
  expect(
    issued.some(
      (request) =>
        request.args.includes("deploy") && request.args.includes("--dry-run"),
    ),
  ).toBe(true);
  for (const request of issued) expect(mutatesTarget(request)).toBe(false);
});

test("production deploys the published archive and refuses a drifted digest", async () => {
  const release = await mkdtemp(join(tmpdir(), "takos-production-archive-"));
  const packageRoot = join(release, "package");
  await mkdir(join(packageRoot, "worker"), { recursive: true });
  await mkdir(join(packageRoot, "assets"), { recursive: true });
  await writeFile(join(packageRoot, "worker/index.js"), "export default {};\n");
  await writeFile(join(packageRoot, "assets/index.html"), "<!doctype html>\n");
  await writeFile(join(packageRoot, "asset-manifest.json"), "{}\n");
  const archivePath = join(release, "takos-worker-release.tar.gz");
  const tar = Bun.spawn(
    ["tar", "-czf", archivePath, "-C", packageRoot, "."],
    { stdout: "ignore", stderr: "pipe" },
  );
  expect(await tar.exited).toBe(0);
  const archive = new Uint8Array(await readFile(archivePath));
  const sha256 = createHash("sha256").update(archive).digest("hex");

  const descriptor = (digest: string) => ({
    kind: "takos.worker-artifact@v3",
    app: "takos",
    commit: HEAD,
    ref: "v0.12.7",
    workflowRun: null,
    releaseTag: "v0.12.7",
    artifact: {
      filename: "takos-worker-release.tar.gz",
      url: "https://github.com/tako0614/takos/releases/download/v0.12.7/takos-worker-release.tar.gz",
      sha256: digest,
      sha256Prefixed: `sha256:${digest}`,
      size: archive.byteLength,
      contentType: "application/gzip",
    },
    assetManifest: "asset-manifest.json",
    containerImages: {
      executor: IMAGE,
      publicAgent: `ghcr.io/tako0614/takos-agent@sha256:${"b".repeat(64)}`,
    },
    manifestUrl:
      "https://github.com/tako0614/takos/releases/download/v0.12.7/takos-artifact.json",
  });

  const write = async (digest: string) => {
    const path = join(release, `descriptor-${digest.slice(0, 8)}.json`);
    await writeFile(path, `${JSON.stringify(descriptor(digest), null, 2)}\n`);
    return path;
  };

  const fetchArchive = async () =>
    new Response(archive, { status: 200 }) as Response;
  const runtime = stubRuntime(
    [...HEALTHY_ACCOUNT, [/^tar --extract/u, {}]],
    fetchArchive,
  );
  const realRun = runtime.run.bind(runtime);
  const extracting: SurfaceRuntime & { calls: CommandRequest[] } = {
    calls: runtime.calls,
    async run(request) {
      if (request.command === "tar") {
        const child = Bun.spawn([request.command, ...request.args], {
          stdout: "ignore",
          stderr: "pipe",
        });
        return {
          exitCode: await child.exited,
          stdout: "",
          stderr: await new Response(child.stderr).text(),
        };
      }
      return await realRun(request);
    },
    fetch: runtime.fetch,
  };

  const { report, issued } = await runCloudflareProductionRecorded(
    await options([
      "--apply",
      "--environment",
      "production",
      "--release",
      await write(sha256),
    ]),
    extracting,
  );
  expect(report.outcome).toBe("planned");
  expect((report.release as { tag: string }).tag).toBe("v0.12.7");
  expect((report.release as { archiveDigest: string }).archiveDigest).toBe(
    `sha256:${sha256}`,
  );
  expect(report.containerImage).toBe(IMAGE);
  for (const request of issued) expect(mutatesTarget(request)).toBe(false);

  await expect(
    runCloudflareProductionRecorded(
      await options([
        "--apply",
        "--environment",
        "production",
        "--release",
        await write("c".repeat(64)),
      ]),
      extracting,
    ),
  ).rejects.toThrow(/digest .* does not match the release record/u);
});

test("the container image digest is a required input of every deploying phase", async () => {
  expect(() =>
    parseCloudflareProductionArgs(
      ["--status", "--environment", "production", "--outputs", "/tmp/outputs.json"],
      repositoryRoot,
    ),
  ).toThrow(/container image digest is a required input/u);
  expect(() =>
    parseCloudflareProductionArgs(
      [
        "--apply",
        "--environment",
        "production",
        "--outputs",
        "/tmp/outputs.json",
        "--container-image",
        IMAGE,
      ],
      repositoryRoot,
    ),
  ).toThrow(/--release <descriptor\.json> is required/u);
  expect(() =>
    parseCloudflareProductionArgs(
      ["--status", "--environment", "production", "--outputs", "outputs.json"],
      repositoryRoot,
    ),
  ).toThrow(/absolute path/u);
  expect(() =>
    parseCloudflareProductionArgs(
      ["--environment", "production", "--outputs", "/tmp/outputs.json"],
      repositoryRoot,
    ),
  ).toThrow(/a phase is required/u);
});

test("the desired Durable Object tag comes from the checked-in template", async () => {
  const template = await readFile(
    resolve(repositoryRoot, "deploy/cloudflare/wrangler.toml"),
    "utf8",
  );
  expect(latestMigrationTag(template)).toBe("v7");
  expect(pendingDurableObjectWork(null, "v7")).toEqual([
    "worker-absent: the whole Durable Object migration chain",
  ]);
  expect(pendingDurableObjectWork(JSON.parse(versionJson(SERVED)), "v7")).toEqual(
    [],
  );
  expect(
    pendingDurableObjectWork(
      { ...JSON.parse(versionJson(NEXT)), metadata: { migration_tag: "v6" } },
      "v7",
    ),
  ).toEqual(["migration tag v6 -> v7"]);
});
