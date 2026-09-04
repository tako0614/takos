import { expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

import { RUNTIME_SECRET_BINDING_NAMES } from "./cloudflare-production-config.ts";
import {
  TAKOS_FIRST_INSTALL_OWNER_CONTRACT,
  TAKOS_CLOUDFLARE_PRODUCTION_SURFACE,
  latestMigrationTag,
  mutatesTarget,
  parseCloudflareProductionArgs,
  pendingDurableObjectWork,
  runCloudflareProductionRecorded,
  type CloudflareApiRequest,
  type CloudflareApiResponse,
  type CommandRequest,
  type CommandResult,
  type SurfaceRuntime,
} from "./cloudflare-production-deploy.ts";
import { REQUIRED_RUNTIME_SECRET_NAMES } from "../src/worker/shared/config/runtime-secrets.ts";
import { TAKOS_RELEASE_ARTIFACT_SURFACE } from "./release-artifact-deploy.ts";

const repositoryRoot = resolve(import.meta.dir, "..");
const ACCOUNT = "00000000000000000000000000000001";
const IMAGE = `registry.cloudflare.com/${ACCOUNT}/takos-agent@sha256:${"a".repeat(64)}`;
const HEAD = "1".repeat(40);
const SERVED = "11111111-2222-3333-4444-555555555555";
const NEXT = "99999999-8888-7777-6666-555555555555";
const CONCURRENT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OWNER_CONTRACT_V2 = "takos.first-install-owner-contract@v2";
const RELEASE_EVIDENCE_V2 = {
  descriptor: {
    kind: "takos.worker-artifact@v3",
    digest: "sha256",
    maxBytes: 256 * 1024,
    releaseTagPattern: "^v\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?$",
    executorImagePattern:
      "^registry\\.cloudflare\\.com/[0-9a-f]{32}/takos-agent@sha256:[0-9a-f]{64}$",
    publicAgentImagePattern:
      "^ghcr\\.io/tako0614/takos-agent@sha256:[0-9a-f]{64}$",
  },
  archive: {
    digest: "sha256",
    maxCompressedBytes: 64 * 1024 * 1024,
    maxExpandedBytes: 256 * 1024 * 1024,
    maxEntries: 20_000,
    maxPathBytes: 4_096,
  },
  workerVersions: {
    method: "cloudflare-api-v4",
    pagination: "page/per_page",
    pageSize: 100,
    maxPages: 100,
    maxRows: 10_000,
    stableScans: 2,
  },
  containerApplications: {
    method: "cloudflare-api-v4",
    pagination: "per_page/page_token",
    pageSize: 100,
    maxPages: 100,
    maxRows: 10_000,
    stableScans: 2,
    detailMethod: "wrangler-containers-info",
  },
} as const;

const COMPLETE_CONTAINER_EVIDENCE = {
  ...RELEASE_EVIDENCE_V2.containerApplications,
  inventory: { status: "complete", scans: 2 },
  exactApplicationNames: 3,
  healthyApplicationDetails: 3,
  activeRollouts: 0,
} as const;

const COMPLETE_APPLY_EVIDENCE = {
  workerVersions: {
    ...RELEASE_EVIDENCE_V2.workerVersions,
    before: { status: "complete", scans: 2 },
    after: { status: "complete", scans: 2 },
    exactAttemptMatches: 1,
    exactInventoryAdditions: 1,
  },
  containerApplications: COMPLETE_CONTAINER_EVIDENCE,
} as const;

function responseBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

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
    deployment_environment: wrap("staging"),
    cloudflare_worker_version_id: wrap(SERVED),
    ...overrides,
  });
}

function versionJson(
  versionId: string,
  annotations: Readonly<{ tag?: string; message?: string }> = {},
): string {
  return JSON.stringify({
    id: versionId,
    annotations: {
      ...(annotations.tag === undefined ? {} : { "workers/tag": annotations.tag }),
      ...(annotations.message === undefined
        ? {}
        : { "workers/message": annotations.message }),
    },
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
        ...Object.entries(
          (JSON.parse(outputs()) as {
            worker_env: { value: Record<string, string> };
          }).worker_env.value,
        ).map(([name, text]) => ({ name, type: "plain_text", text })),
        { name: "OCI_ORCHESTRATOR_URL", type: "plain_text", text: "" },
        { name: "ASSETS", type: "assets" },
        { name: "AI", type: "ai" },
        {
          name: "TAKOS_EGRESS",
          type: "service",
          service: "takos-live",
          entrypoint: "TakosEgressEntrypoint",
        },
      ],
    },
  });
}

function versionListJson(
  rows: readonly Readonly<{ id: string; tag?: string; message?: string }>[],
): string {
  return JSON.stringify(
    rows.map((row) => ({
      id: row.id,
      metadata: { created_on: "2026-09-04T00:00:00.000Z" },
      annotations: {
        ...(row.tag === undefined ? {} : { "workers/tag": row.tag }),
        ...(row.message === undefined
          ? {}
          : { "workers/message": row.message }),
      },
    })),
  );
}

function cloudflareEnvelope(
  result: unknown,
  resultInfo: Readonly<Record<string, unknown>>,
): CloudflareApiResponse {
  return {
    status: 200,
    body: {
      success: true,
      errors: [],
      messages: [],
      result,
      result_info: resultInfo,
    },
  };
}

function versionApiPage(
  rows: readonly Readonly<{ id: string; tag?: string; message?: string }>[],
  page: number,
  perPage = 100,
): CloudflareApiResponse {
  const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
  const items = rows.slice((page - 1) * perPage, page * perPage).map((row) => ({
    id: row.id,
    metadata: { created_on: "2026-09-04T00:00:00.000Z" },
    annotations: {
      ...(row.tag === undefined ? {} : { "workers/tag": row.tag }),
      ...(row.message === undefined
        ? {}
        : { "workers/message": row.message }),
    },
  }));
  return cloudflareEnvelope(
    { items },
    {
      page,
      per_page: perPage,
      count: items.length,
      total_count: rows.length,
      total_pages: totalPages,
    },
  );
}

function unrelatedVersionRows(
  count: number,
): Array<Readonly<{ id: string; tag?: string; message?: string }>> {
  return Array.from({ length: count }, (_, index) => ({
    id: `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`,
  }));
}

function deploymentJson(versionId: string): string {
  return JSON.stringify({
    id: "deployment-1",
    versions: [{ version_id: versionId, percentage: 100 }],
  });
}

function secretListJson(names: readonly string[] = RUNTIME_SECRET_BINDING_NAMES): string {
  return JSON.stringify(names.map((name) => ({ name, type: "secret_text" })));
}

function containerListJson(image = IMAGE): string {
  return JSON.stringify(
    ["ExecutorContainerTier1", "ExecutorContainerTier2", "ExecutorContainerTier3"].map(
      (className, index) => ({
        id: `00000000-0000-4000-8000-00000000000${index}`,
        name: `takos-live-${className}`.toLowerCase(),
        state: "ready",
        instances: 0,
        image,
        version: index + 1,
      }),
    ),
  );
}

function containerApiRows(image = IMAGE): Array<Record<string, unknown>> {
  return (JSON.parse(containerListJson(image)) as Array<Record<string, unknown>>)
    .map(({ state: _state, ...row }) => ({
      ...row,
      health: {
        instances: { active: 0, failed: 0, starting: 0, scheduling: 0 },
      },
    }));
}

function unrelatedContainerRows(count: number): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, index) => ({
    id: `eeeeeeee-eeee-4eee-8eee-${(index + 1).toString(16).padStart(12, "0")}`,
    name: `foreign-container-${index + 1}`,
    image: IMAGE,
    version: 1,
    instances: 0,
    health: {
      instances: { active: 0, failed: 0, starting: 0, scheduling: 0 },
    },
  }));
}

function containerApiRowsFromCliJson(value: string): Array<Record<string, unknown>> {
  return (JSON.parse(value) as Array<Record<string, unknown>>).map(
    ({ state, ...row }) => ({
      ...row,
      health: {
        instances: state === "degraded"
          ? { active: 0, failed: 1, starting: 0, scheduling: 0 }
          : state === "provisioning"
            ? { active: 0, failed: 0, starting: 1, scheduling: 0 }
            : state === "active"
              ? { active: 1, failed: 0, starting: 0, scheduling: 0 }
              : { active: 0, failed: 0, starting: 0, scheduling: 0 },
      },
    }),
  );
}

function containerInfoJson(index: number, image = IMAGE): string {
  const className = CONTAINER_CLASSES[index];
  return JSON.stringify({
    id: `00000000-0000-4000-8000-00000000000${index}`,
    name: `takos-live-${className}`.toLowerCase(),
    image,
    version: index + 1,
    health: {
      instances: { active: 0, failed: 0, starting: 0, scheduling: 0 },
    },
  });
}

const CONTAINER_CLASSES = [
  "ExecutorContainerTier1",
  "ExecutorContainerTier2",
  "ExecutorContainerTier3",
] as const;

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
    releaseLeaseRoot: join(
      tmpdir(),
      `takos-first-install-release-lease-test-${randomUUID()}`,
    ),
    assertPhysicalGitTree: async () => {},
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
    async cloudflareApi(request) {
      if (
        request.path !== `/accounts/${ACCOUNT}/containers/dash/applications`
      ) {
        throw new Error(`unexpected Cloudflare API path ${request.path}`);
      }
      const line = "bunx wrangler containers list --json";
      const reply = replies.find(([pattern]) => pattern.test(line))?.[1];
      const stdout = reply?.stdout ?? containerListJson();
      return cloudflareEnvelope(containerApiRowsFromCliJson(stdout), {});
    },
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
  const firstInstall = argv.includes("--runtime-secrets-install") ||
    argv.includes("--absence-proof");
  return parseCloudflareProductionArgs(
    [
      ...argv,
      "--outputs",
      outputsPath,
      ...(firstInstall ? [] : ["--realized-config", realizedConfig]),
    ],
    repositoryRoot,
  );
}

test("the contract answers every obligation its triggers make it owe", () => {
  const surface = TAKOS_CLOUDFLARE_PRODUCTION_SURFACE;
  expect(surface.surface).toBe("takos-cloudflare-production");
  expect(surface.target).toBe("cloudflare-worker:takos");
  expect([...surface.triggers].sort()).toEqual([
    "authority",
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

test("the entrypoint contract probe lists every surface and is side-effect free", async () => {
  const probe = Bun.spawn(["bun", "scripts/deploy.mjs", "--contract"], {
    cwd: repositoryRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(probe.stdout).text(),
    new Response(probe.stderr).text(),
    probe.exited,
  ]);
  expect(`${exitCode} ${stderr}`).toBe("0 ");

  const contract = JSON.parse(stdout.slice(stdout.indexOf("{"))) as {
    kind: string;
    ownerContracts: unknown[];
    surfaces: {
      surface: string;
      target: string;
      triggers: string[];
      obligations: Record<string, string>;
      requiresEnv?: string[];
    }[];
  };
  expect(contract.kind).toBe("takos.deploy-contract@v2");
  expect(contract.ownerContracts).toEqual([TAKOS_FIRST_INSTALL_OWNER_CONTRACT]);
  expect(contract.surfaces.map((entry) => entry.surface)).toEqual([
    "takos-release-artifact",
    "takos-cloudflare-production",
    "takos-site",
    "takos-docs",
  ]);
  // The control gate reads exactly these fields off the live answer.
  for (const entry of contract.surfaces) {
    expect(entry.target.length).toBeGreaterThan(0);
    expect(Array.isArray(entry.triggers)).toBe(true);
    const answers = Object.values(entry.obligations).join("\n");
    for (const variable of entry.requiresEnv ?? []) {
      expect(answers).toContain(variable);
    }
  }
});

async function privateFirstInstallInputs(): Promise<{
  root: string;
  secretDirectory: string;
  tokenFile: string;
  values: Record<string, string>;
}> {
  const root = await mkdtemp(join(tmpdir(), "takos-first-install-private-"));
  await chmod(root, 0o700);
  const secretDirectory = join(root, "runtime-secrets");
  await mkdir(secretDirectory, { mode: 0o700 });
  const values: Record<string, string> = {};
  for (const name of REQUIRED_RUNTIME_SECRET_NAMES) {
    const value = `private-${name}-${crypto.randomUUID()}`;
    values[name] = value;
    await writeFile(join(secretDirectory, name), `${value}\n`, { mode: 0o600 });
  }
  const tokenFile = join(root, "cloudflare-api-token");
  await writeFile(tokenFile, "private-cloudflare-token\n", { mode: 0o600 });
  return { root, secretDirectory, tokenFile, values };
}

async function publishedReleaseFixture(commit: string = HEAD): Promise<{
  root: string;
  archive: Uint8Array;
  descriptorPath: string;
  descriptorDigest: string;
  archiveDigest: string;
  publicAgentImage: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "takos-owner-release-"));
  const packageRoot = join(root, "package");
  await mkdir(join(packageRoot, "worker"), { recursive: true });
  await mkdir(join(packageRoot, "assets"), { recursive: true });
  await writeFile(join(packageRoot, "worker/index.js"), "export default {};\n");
  await writeFile(join(packageRoot, "assets/index.html"), "<!doctype html>\n");
  await writeFile(join(packageRoot, "asset-manifest.json"), "{}\n");
  const archivePath = join(root, "takos-worker-release.tar.gz");
  const tar = Bun.spawn(
    ["tar", "-czf", archivePath, "-C", packageRoot, "."],
    { stdout: "ignore", stderr: "pipe" },
  );
  expect(await tar.exited).toBe(0);
  const archive = new Uint8Array(await readFile(archivePath));
  const digest = createHash("sha256").update(archive).digest("hex");
  const publicAgentImage =
    `ghcr.io/tako0614/takos-agent@sha256:${"b".repeat(64)}`;
  const descriptor = {
    kind: "takos.worker-artifact@v3",
    app: "takos",
    commit,
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
      publicAgent: publicAgentImage,
    },
    manifestUrl:
      "https://github.com/tako0614/takos/releases/download/v0.12.7/takos-artifact.json",
  };
  const descriptorPath = join(root, "takos-artifact.json");
  const descriptorBytes = `${JSON.stringify(descriptor, null, 2)}\n`;
  await writeFile(descriptorPath, descriptorBytes);
  return {
    root,
    archive,
    descriptorPath,
    descriptorDigest: `sha256:${createHash("sha256").update(descriptorBytes).digest("hex")}`,
    archiveDigest: `sha256:${digest}`,
    publicAgentImage,
  };
}

async function replacePublishedArchive(
  release: Awaited<ReturnType<typeof publishedReleaseFixture>>,
  archivePath: string,
): Promise<Awaited<ReturnType<typeof publishedReleaseFixture>>> {
  const archive = new Uint8Array(await readFile(archivePath));
  const digest = createHash("sha256").update(archive).digest("hex");
  const descriptor = JSON.parse(
    await readFile(release.descriptorPath, "utf8"),
  ) as {
    artifact: { sha256: string; sha256Prefixed: string; size: number };
  };
  descriptor.artifact.sha256 = digest;
  descriptor.artifact.sha256Prefixed = `sha256:${digest}`;
  descriptor.artifact.size = archive.byteLength;
  const descriptorBytes = `${JSON.stringify(descriptor, null, 2)}\n`;
  await writeFile(release.descriptorPath, descriptorBytes);
  return {
    ...release,
    archive,
    archiveDigest: `sha256:${digest}`,
    descriptorDigest:
      `sha256:${createHash("sha256").update(descriptorBytes).digest("hex")}`,
  };
}

function oversizedTarEntryArchive(): Uint8Array {
  const tar = Buffer.alloc(1024);
  tar.write("oversized", 0, "ascii");
  tar.write("0000600\0", 100, "ascii");
  tar.write("0000000\0", 108, "ascii");
  tar.write("0000000\0", 116, "ascii");
  tar.write(`${(256 * 1024 * 1024 + 1).toString(8).padStart(11, "0")}\0`, 124, "ascii");
  tar.write("00000000000\0", 136, "ascii");
  tar.fill(0x20, 148, 156);
  tar[156] = 0x30;
  const checksum = tar.subarray(0, 512).reduce((sum, byte) => sum + byte, 0);
  tar.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  return new Uint8Array(gzipSync(tar));
}

async function releaseCustodyPaths(request: CommandRequest): Promise<{
  config: string;
  entrypoint: string;
  assets: string;
}> {
  const configIndex = request.args.indexOf("--config");
  const config = request.args[configIndex + 1];
  if (!config) throw new Error("release command omitted --config");
  const text = await readFile(config, "utf8");
  const value = (name: "main" | "directory"): string => {
    const encoded = new RegExp(`^${name} = (".*")$`, "mu").exec(text)?.[1];
    if (!encoded) throw new Error(`realized config omitted ${name}`);
    return JSON.parse(encoded) as string;
  };
  return { config, entrypoint: value("main"), assets: value("directory") };
}

function releaseOwnerArgs(input: {
  phase: "--release-apply" | "--release-status";
  outputsPath: string;
  outputsJson: string;
  descriptorPath: string;
  tokenFile: string;
  expectedServedVersion?: string;
}): string[] {
  return [
    input.phase,
    "--environment",
    "integration",
    "--product-environment",
    "staging",
    "--outputs-file",
    input.outputsPath,
    "--output-digest",
    `sha256:${createHash("sha256").update(input.outputsJson).digest("hex")}`,
    "--source-commit",
    HEAD,
    "--operation-id",
    input.phase === "--release-apply"
      ? "first-install-release-apply-1"
      : "first-install-release-status-1",
    "--release-descriptor-file",
    input.descriptorPath,
    "--cloudflare-api-token-file",
    input.tokenFile,
    ...(input.phase === "--release-apply"
      ? ["--execute"]
      : ["--expected-served-version", input.expectedServedVersion ?? NEXT]),
  ];
}

async function releaseOwnerScratch(outputsJson: string = outputs()): Promise<{
  root: string;
  outputsPath: string;
  outputsJson: string;
}> {
  const { root, outputsPath } = await scratch();
  await writeFile(outputsPath, outputsJson);
  const deployDirectory = join(root, "deploy/cloudflare");
  await mkdir(deployDirectory, { recursive: true });
  await writeFile(
    join(deployDirectory, "wrangler.toml"),
    await readFile(join(repositoryRoot, "deploy/cloudflare/wrangler.toml"), "utf8"),
  );
  return { root, outputsPath, outputsJson };
}

function releaseStatusReplies(input: {
  served?: string;
  deployment?: string;
  detail?: string;
  secrets?: readonly string[];
  vectorDimensions?: number;
  vectorMetric?: string;
  containers?: string;
  containerInfo?: (index: number) => string;
} = {}): readonly (readonly [RegExp, Reply])[] {
  const served = input.served ?? NEXT;
  return [
    [/^git rev-parse HEAD/u, { stdout: `${HEAD}\n` }],
    [/^git rev-parse --abbrev-ref HEAD/u, { stdout: "detached\n" }],
    [/^git status --porcelain/u, { stdout: "" }],
    [
      /wrangler deployments status/u,
      { stdout: input.deployment ?? deploymentJson(served) },
    ],
    [
      /wrangler versions view/u,
      { stdout: input.detail ?? versionJson(served) },
    ],
    [
      /wrangler secret list/u,
      { stdout: secretListJson(input.secrets ?? RUNTIME_SECRET_BINDING_NAMES) },
    ],
    [
      /wrangler vectorize get/u,
      {
        stdout: JSON.stringify({
          name: "takos-live-embeddings",
          config: {
            dimensions: input.vectorDimensions ?? 768,
            metric: input.vectorMetric ?? "cosine",
          },
        }),
      },
    ],
    [
      /wrangler containers list/u,
      { stdout: input.containers ?? containerListJson() },
    ],
    ...CONTAINER_CLASSES.map((_, index) => [
      new RegExp(
        `wrangler containers info 00000000-0000-4000-8000-00000000000${index}`,
        "u",
      ),
      { stdout: input.containerInfo?.(index) ?? containerInfoJson(index) },
    ] as const),
  ];
}

function lostAcknowledgementReleaseRuntime(
  archive: Uint8Array,
  lands: boolean,
  uploadAcknowledged = false,
  readbackFails = false,
  scenario:
    | "ordinary"
    | "concurrent-current"
    | "duplicate-attempt"
    | "missing-tag"
    | "multiple-ack" =
    "ordinary",
  beforeReply?: (request: CommandRequest) => Promise<void>,
): SurfaceRuntime & {
  calls: CommandRequest[];
  apiCalls: CloudflareApiRequest[];
} {
  let uploaded = false;
  let attemptTag: string | undefined;
  let attemptMessage: string | undefined;
  const calls: CommandRequest[] = [];
  const apiCalls: CloudflareApiRequest[] = [];
  return {
    calls,
    apiCalls,
    releaseLeaseRoot: join(
      tmpdir(),
      `takos-first-install-release-lease-test-${randomUUID()}`,
    ),
    assertPhysicalGitTree: async () => {},
    async run(request) {
      calls.push(request);
      await beforeReply?.(request);
      const line = `${request.command} ${request.args.join(" ")}`;
      if (line === "git rev-parse HEAD") {
        return { exitCode: 0, stdout: `${HEAD}\n`, stderr: "" };
      }
      if (line === "git rev-parse --abbrev-ref HEAD") {
        return { exitCode: 0, stdout: "detached\n", stderr: "" };
      }
      if (line.startsWith("git status --porcelain")) {
        return { exitCode: 0, stdout: "", stderr: "" };
      }
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
      if (/wrangler secret list/u.test(line)) {
        return { exitCode: 0, stdout: secretListJson(), stderr: "" };
      }
      if (/wrangler vectorize get/u.test(line)) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            name: "takos-live-embeddings",
            config: { dimensions: 768, metric: "cosine" },
          }),
          stderr: "",
        };
      }
      if (/wrangler deployments status/u.test(line)) {
        if (uploaded && readbackFails) {
          return {
            exitCode: 1,
            stdout: "",
            stderr: "provider readback failed private-cloudflare-token",
          };
        }
        return {
          exitCode: 0,
          stdout: deploymentJson(
            uploaded && scenario === "concurrent-current"
              ? CONCURRENT
              : uploaded
                ? NEXT
                : SERVED,
          ),
          stderr: "",
        };
      }
      if (/wrangler versions list/u.test(line)) {
        const tagged = uploaded && attemptTag && attemptMessage
          ? [{ id: NEXT, tag: attemptTag, message: attemptMessage }]
          : [];
        return {
          exitCode: 0,
          stdout: versionListJson(
            scenario === "duplicate-attempt" && tagged.length === 1
              ? [...tagged, { ...tagged[0]!, id: CONCURRENT }]
              : tagged,
          ),
          stderr: "",
        };
      }
      if (/wrangler versions view/u.test(line)) {
        const version = line.includes(NEXT)
          ? NEXT
          : line.includes(CONCURRENT)
            ? CONCURRENT
            : SERVED;
        return {
          exitCode: 0,
          stdout: versionJson(
            version,
            version === NEXT && scenario !== "missing-tag"
              ? { tag: attemptTag, message: attemptMessage }
              : {},
          ),
          stderr: "",
        };
      }
      if (/wrangler containers list/u.test(line)) {
        return { exitCode: 0, stdout: containerListJson(), stderr: "" };
      }
      if (/wrangler containers info/u.test(line)) {
        const index = CONTAINER_CLASSES.findIndex((_, candidate) =>
          line.includes(`00000000-0000-4000-8000-00000000000${candidate}`)
        );
        return {
          exitCode: index < 0 ? 1 : 0,
          stdout: index < 0 ? "" : containerInfoJson(index),
          stderr: index < 0 ? "unknown container" : "",
        };
      }
      if (/wrangler deploy/u.test(line) && request.args.includes("--dry-run")) {
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (/wrangler deploy/u.test(line)) {
        const tagIndex = request.args.indexOf("--tag");
        const messageIndex = request.args.indexOf("--message");
        attemptTag = request.args[tagIndex + 1];
        attemptMessage = request.args[messageIndex + 1];
        uploaded = lands;
        if (uploadAcknowledged) {
          return {
            exitCode: 0,
            stdout: scenario === "multiple-ack"
              ? `Uploaded takos-live\nVersion ID: ${CONCURRENT}\nCurrent Version ID: ${NEXT}\n`
              : `Uploaded takos-live\nCurrent Version ID: ${NEXT}\n`,
            stderr: "",
          };
        }
        return {
          exitCode: 1,
          stdout: "",
          stderr: "provider lost acknowledgement private-cloudflare-token",
        };
      }
      return { exitCode: 127, stdout: "", stderr: `unexpected command ${line}` };
    },
    async fetch(url) {
      if (url.includes("takos-worker-release.tar.gz")) {
        return new Response(responseBytes(archive), { status: 200 });
      }
      return new Response("ok", { status: 200 });
    },
    async cloudflareApi(request) {
      apiCalls.push(request);
      if (
        request.path ===
          `/accounts/${ACCOUNT}/workers/scripts/takos-live/versions`
      ) {
        const tagged = uploaded && attemptTag && attemptMessage
          ? [{ id: NEXT, tag: attemptTag, message: attemptMessage }]
          : [];
        return versionApiPage(
          scenario === "duplicate-attempt" && tagged.length === 1
            ? [...tagged, { ...tagged[0]!, id: CONCURRENT }]
            : tagged,
          Number(request.query?.page ?? "0"),
        );
      }
      if (
        request.path === `/accounts/${ACCOUNT}/containers/dash/applications`
      ) {
        return cloudflareEnvelope(containerApiRows(), {});
      }
      throw new Error(`unexpected Cloudflare API path ${request.path}`);
    },
  };
}

function firstInstallArgs(
  phase: "--runtime-secrets-install" | "--absence-proof",
  privateInputs: { secretDirectory: string; tokenFile: string },
): string[] {
  return [
    phase,
    "--environment",
    "integration",
    "--source-commit",
    HEAD,
    "--output-digest",
    `sha256:${createHash("sha256").update(outputs()).digest("hex")}`,
    "--operation-id",
    "generation-1-runtime-secrets",
    ...(phase === "--runtime-secrets-install"
      ? ["--runtime-secret-directory", privateInputs.secretDirectory]
      : []),
    "--cloudflare-api-token-file",
    privateInputs.tokenFile,
  ];
}

test("first-install owner contract exports the exact five operations, result kinds, and fixed usage", () => {
  expect(TAKOS_FIRST_INSTALL_OWNER_CONTRACT).toEqual({
    kind: OWNER_CONTRACT_V2,
    deployContractKind: "takos.deploy-contract@v2",
    deploySurface: "takos-cloudflare-production",
    deployTarget: "cloudflare-worker:takos",
    productEnvironment: "staging",
    releaseEvidence: RELEASE_EVIDENCE_V2,
    operations: [
      "runtime-secrets-install",
      "release-apply",
      "release-status",
      "functional-proof",
      "absence-proof",
    ],
    resultKinds: {
      runtimeSecretsInstall: "takos.first-install-runtime-secrets@v1",
      releaseApply: "takos.first-install-release-apply@v2",
      releaseStatus: "takos.first-install-release-status@v2",
      functionalProof: "takos.first-install-functional-proof@v1",
      absenceProof: "takos.first-install-absence@v1",
    },
    usage: {
      runtimeSecretsInstall: expect.stringContaining("--runtime-secrets-install"),
      releaseApply: expect.stringContaining("--release-apply"),
      releaseStatus: expect.stringContaining("--expected-served-version"),
      functionalProof: expect.stringContaining("first-install:functional-proof"),
      absenceProof: expect.stringContaining("--absence-proof"),
    },
  });
});

test("release owner CLI accepts only the fixed integration to staging contract", () => {
  const common = [
    "--environment",
    "integration",
    "--product-environment",
    "staging",
    "--outputs-file",
    "/private/outputs.json",
    "--output-digest",
    `sha256:${"2".repeat(64)}`,
    "--source-commit",
    HEAD,
    "--operation-id",
    "first-install-release-1",
    "--release-descriptor-file",
    "/private/takos-artifact.json",
    "--cloudflare-api-token-file",
    "/private/cloudflare-token",
  ] as const;

  expect(
    parseCloudflareProductionArgs(
      ["--release-apply", ...common, "--execute"],
      repositoryRoot,
    ),
  ).toMatchObject({
    phase: "release-apply",
    environment: "integration",
    productEnvironment: "staging",
    outputs: "/private/outputs.json",
    release: "/private/takos-artifact.json",
    sourceCommit: HEAD,
    operationId: "first-install-release-1",
    cloudflareApiTokenFile: "/private/cloudflare-token",
    execute: true,
  });
  expect(
    parseCloudflareProductionArgs(
      [
        "--release-status",
        ...common,
        "--expected-served-version",
        NEXT,
      ],
      repositoryRoot,
    ),
  ).toMatchObject({
    phase: "release-status",
    expectedServedVersion: NEXT,
    execute: false,
  });

  for (const args of [
    ["--release-apply", ...common],
    ["--release-status", ...common, "--expected-served-version", NEXT, "--execute"],
    ["--release-status", ...common],
    ["--release-apply", ...common, "--expected-served-version", NEXT, "--execute"],
    [
      "--release-apply",
      ...common,
      "--outputs",
      "/private/other-outputs.json",
      "--execute",
    ],
    ["--release-apply", ...common, "--container-image", IMAGE, "--execute"],
    ["--release-apply", ...common, "--commit", HEAD, "--execute"],
    [
      "--release-apply",
      ...common.map((value) => value === "staging" ? "production" : value),
      "--execute",
    ],
    [
      "--release-apply",
      ...common.map((value) => value === "integration" ? "production" : value),
      "--execute",
    ],
  ]) {
    expect(() => parseCloudflareProductionArgs(args, repositoryRoot)).toThrow();
  }
});

test("release-apply deploys the verified release overlay and returns only bounded owner evidence", async () => {
  const custody = await privateFirstInstallInputs();
  const release = await publishedReleaseFixture();
  const scratch = await releaseOwnerScratch();
  let uploaded = false;
  let physicalProofs = 0;
  let attemptTag: string | undefined;
  let attemptMessage: string | undefined;
  let uploadedConfig: string | undefined;
  let uploadedConfigText: string | undefined;
  const calls: CommandRequest[] = [];
  const runtime: SurfaceRuntime = {
    releaseLeaseRoot: join(scratch.root, "release-leases"),
    assertPhysicalGitTree: async (input) => {
      physicalProofs += 1;
      expect(input).toEqual({
        root: scratch.root,
        commit: HEAD,
        subject: "first-install release checkout",
      });
    },
    async run(request) {
      calls.push(request);
      const line = `${request.command} ${request.args.join(" ")}`;
      if (line === "git rev-parse HEAD") {
        return { exitCode: 0, stdout: `${HEAD}\n`, stderr: "" };
      }
      if (line === "git rev-parse --abbrev-ref HEAD") {
        return { exitCode: 0, stdout: "detached\n", stderr: "" };
      }
      if (line === "git status --porcelain=v1 --untracked-files=all") {
        return { exitCode: 0, stdout: "", stderr: "" };
      }
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
      if (/wrangler secret list/u.test(line)) {
        return { exitCode: 0, stdout: secretListJson(), stderr: "" };
      }
      if (/wrangler vectorize get/u.test(line)) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            name: "takos-live-embeddings",
            config: { dimensions: 768, metric: "cosine" },
          }),
          stderr: "",
        };
      }
      if (/wrangler deployments status/u.test(line)) {
        return {
          exitCode: 0,
          stdout: deploymentJson(uploaded ? NEXT : SERVED),
          stderr: "",
        };
      }
      if (/wrangler versions list/u.test(line)) {
        return {
          exitCode: 0,
          stdout: versionListJson(
            uploaded && attemptTag && attemptMessage
              ? [{ id: NEXT, tag: attemptTag, message: attemptMessage }]
              : [],
          ),
          stderr: "",
        };
      }
      if (/wrangler versions view/u.test(line)) {
        const version = line.includes(NEXT) ? NEXT : SERVED;
        return {
          exitCode: 0,
          stdout: versionJson(
            version,
            version === NEXT
              ? { tag: attemptTag, message: attemptMessage }
              : {},
          ),
          stderr: "",
        };
      }
      if (/wrangler containers list/u.test(line)) {
        return { exitCode: 0, stdout: containerListJson(), stderr: "" };
      }
      if (/wrangler containers info/u.test(line)) {
        const index = CONTAINER_CLASSES.findIndex((_, candidate) =>
          line.includes(`00000000-0000-4000-8000-00000000000${candidate}`)
        );
        return {
          exitCode: index < 0 ? 1 : 0,
          stdout: index < 0 ? "" : containerInfoJson(index),
          stderr: index < 0 ? "unknown container" : "",
        };
      }
      if (/wrangler deploy/u.test(line) && request.args.includes("--dry-run")) {
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (/wrangler deploy/u.test(line)) {
        const custody = await releaseCustodyPaths(request);
        uploadedConfig = custody.config;
        uploadedConfigText = await readFile(custody.config, "utf8");
        const tagIndex = request.args.indexOf("--tag");
        const messageIndex = request.args.indexOf("--message");
        attemptTag = request.args[tagIndex + 1];
        attemptMessage = request.args[messageIndex + 1];
        uploaded = true;
        return {
          exitCode: 0,
          stdout: `Uploaded takos-live\nCurrent Version ID: ${NEXT}\n`,
          stderr: "",
        };
      }
      return { exitCode: 127, stdout: "", stderr: `unexpected command ${line}` };
    },
    async fetch(url) {
      if (url.includes("takos-worker-release.tar.gz")) {
        return new Response(responseBytes(release.archive), { status: 200 });
      }
      return new Response("ok", { status: 200 });
    },
    async cloudflareApi(request) {
      if (
        request.path ===
          `/accounts/${ACCOUNT}/workers/scripts/takos-live/versions`
      ) {
        return versionApiPage(
          uploaded && attemptTag && attemptMessage
            ? [{ id: NEXT, tag: attemptTag, message: attemptMessage }]
            : [],
          Number(request.query?.page ?? "0"),
        );
      }
      if (
        request.path === `/accounts/${ACCOUNT}/containers/dash/applications`
      ) {
        return cloudflareEnvelope(containerApiRows(), {});
      }
      throw new Error(`unexpected Cloudflare API path ${request.path}`);
    },
  };

  try {
    const { report, issued } = await runCloudflareProductionRecorded(
      parseCloudflareProductionArgs(
        releaseOwnerArgs({
          phase: "--release-apply",
          outputsPath: scratch.outputsPath,
          outputsJson: scratch.outputsJson,
          descriptorPath: release.descriptorPath,
          tokenFile: custody.tokenFile,
        }),
        scratch.root,
      ),
      runtime,
    );

    expect(report).toEqual({
      ownerContract: OWNER_CONTRACT_V2,
      kind: "takos.first-install-release-apply@v2",
      status: "applied",
      operationId: "first-install-release-apply-1",
      orchestrationLane: "integration",
      productEnvironment: "staging",
      sourceCommit: HEAD,
      outputDigest: `sha256:${createHash("sha256").update(scratch.outputsJson).digest("hex")}`,
      release: {
        tag: "v0.12.7",
        descriptor: {
          kind: "takos.worker-artifact@v3",
          digest: release.descriptorDigest,
        },
        archiveDigest: release.archiveDigest,
        executorImage: IMAGE,
        publicAgentImage: release.publicAgentImage,
      },
      target: {
        accountId: ACCOUNT,
        workerName: "takos-live",
        publicUrl: "https://app.example.test",
      },
      bootstrap: { moduleVersion: SERVED },
      activated: { servedVersion: NEXT },
      attempt: {
        tag: attemptTag,
        message: attemptMessage,
        versionId: NEXT,
      },
      completeness: COMPLETE_APPLY_EVIDENCE,
      health: { path: "/health", status: 200 },
      appliedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
    });
    const mutations = issued.filter(mutatesTarget);
    expect(mutations).toHaveLength(1);
    expect(physicalProofs).toBe(1);
    expect(mutations[0]?.args).toContain("--no-bundle");
    expect(mutations[0]?.args).toContain("--strict");
    expect(mutations[0]?.args).toContain("--containers-rollout");
    expect(mutations[0]?.args).toContain("immediate");
    const attemptDigest = createHash("sha256").update(JSON.stringify({
      kind: "takos.first-install-release-attempt@v2",
      accountId: ACCOUNT,
      workerName: "takos-live",
      sourceCommit: HEAD,
      outputDigest:
        `sha256:${createHash("sha256").update(scratch.outputsJson).digest("hex")}`,
      operationId: "first-install-release-apply-1",
      releaseDescriptorDigest: release.descriptorDigest,
    })).digest("hex");
    expect(attemptTag).toBe(`takos-first-install-${attemptDigest}`);
    expect(attemptMessage).toBe(
      `takos.first-install-release-apply@v2:${attemptDigest}`,
    );
    expect(uploadedConfig).toStartWith(join(tmpdir(), "takos-production-release-"));
    expect(uploadedConfig?.startsWith(scratch.root)).toBe(false);
    const uploadedEntrypoint = /^main = (".*")$/mu.exec(uploadedConfigText ?? "")?.[1];
    const uploadedAssets = /^directory = (".*")$/mu.exec(uploadedConfigText ?? "")?.[1];
    expect(uploadedEntrypoint && JSON.parse(uploadedEntrypoint)).toStartWith(
      dirname(uploadedConfig!),
    );
    expect(uploadedAssets && JSON.parse(uploadedAssets)).toStartWith(
      dirname(uploadedConfig!),
    );
    expect(calls.some((request) => request.command === "bun")).toBe(false);
    for (const request of calls.filter((request) => request.command === "bunx")) {
      expect(request.cloudflareApiTokenFile).toBe(custody.tokenFile);
      expect(request.cloudflareAccountId).toBe(ACCOUNT);
      expect(request.args).not.toContain("private-cloudflare-token");
    }
    expect(JSON.stringify(report)).not.toContain("private-cloudflare-token");
  } finally {
    await rm(custody.root, { recursive: true, force: true });
    await rm(release.root, { recursive: true, force: true });
    await rm(scratch.root, { recursive: true, force: true });
  }
});

test("release-status accepts only the expected release overlay through structured readback", async () => {
  const custody = await privateFirstInstallInputs();
  const release = await publishedReleaseFixture();
  const scratch = await releaseOwnerScratch();
  const runtime = stubRuntime(
    [
      [/^git rev-parse HEAD/u, { stdout: `${HEAD}\n` }],
      [/^git rev-parse --abbrev-ref HEAD/u, { stdout: "detached\n" }],
      [/^git status --porcelain/u, { stdout: "" }],
      [/wrangler deployments status/u, { stdout: deploymentJson(NEXT) }],
      [/wrangler versions view/u, { stdout: versionJson(NEXT) }],
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
      ...CONTAINER_CLASSES.map((_, index) => [
        new RegExp(
          `wrangler containers info 00000000-0000-4000-8000-00000000000${index}`,
          "u",
        ),
        { stdout: containerInfoJson(index) },
      ] as const),
    ],
    async () => new Response("ok", { status: 200 }),
  );

  try {
    const { report, issued } = await runCloudflareProductionRecorded(
      parseCloudflareProductionArgs(
        releaseOwnerArgs({
          phase: "--release-status",
          outputsPath: scratch.outputsPath,
          outputsJson: scratch.outputsJson,
          descriptorPath: release.descriptorPath,
          tokenFile: custody.tokenFile,
          expectedServedVersion: NEXT,
        }),
        scratch.root,
      ),
      runtime,
    );

    expect(report).toEqual({
      ownerContract: OWNER_CONTRACT_V2,
      kind: "takos.first-install-release-status@v2",
      status: "active",
      operationId: "first-install-release-status-1",
      orchestrationLane: "integration",
      productEnvironment: "staging",
      sourceCommit: HEAD,
      outputDigest: `sha256:${createHash("sha256").update(scratch.outputsJson).digest("hex")}`,
      release: {
        tag: "v0.12.7",
        descriptor: {
          kind: "takos.worker-artifact@v3",
          digest: release.descriptorDigest,
        },
        archiveDigest: release.archiveDigest,
        executorImage: IMAGE,
        publicAgentImage: release.publicAgentImage,
      },
      target: {
        accountId: ACCOUNT,
        workerName: "takos-live",
        publicUrl: "https://app.example.test",
      },
      bootstrap: { moduleVersion: SERVED },
      activated: { servedVersion: NEXT },
      runtimeSecrets: {
        provisioned: true,
        present: [...REQUIRED_RUNTIME_SECRET_NAMES],
        missing: [],
      },
      completeness: {
        containerApplications: COMPLETE_CONTAINER_EVIDENCE,
      },
      health: { path: "/health", status: 200 },
      unrelatedDrift: [],
      checkedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
    });
    expect(issued.length).toBeGreaterThan(0);
    for (const request of issued) expect(mutatesTarget(request)).toBe(false);
    for (const request of runtime.calls.filter((request) => request.command === "bunx")) {
      expect(request.cloudflareApiTokenFile).toBe(custody.tokenFile);
      expect(request.cloudflareAccountId).toBe(ACCOUNT);
    }
  } finally {
    await rm(custody.root, { recursive: true, force: true });
    await rm(release.root, { recursive: true, force: true });
    await rm(scratch.root, { recursive: true, force: true });
  }
});

test("release-apply resolves one lost acknowledgement by readback and never retries the upload", async () => {
  for (const lands of [true, false]) {
    const custody = await privateFirstInstallInputs();
    const release = await publishedReleaseFixture();
    const scratch = await releaseOwnerScratch();
    const runtime = lostAcknowledgementReleaseRuntime(release.archive, lands);
    try {
      const run = runCloudflareProductionRecorded(
        parseCloudflareProductionArgs(
          releaseOwnerArgs({
            phase: "--release-apply",
            outputsPath: scratch.outputsPath,
            outputsJson: scratch.outputsJson,
            descriptorPath: release.descriptorPath,
            tokenFile: custody.tokenFile,
          }),
          scratch.root,
        ),
        runtime,
      );
      if (lands) {
        const { report } = await run;
        expect(report).toMatchObject({
          kind: "takos.first-install-release-apply@v2",
          status: "applied",
          activated: { servedVersion: NEXT },
        });
        expect(JSON.stringify(report)).not.toContain("private-cloudflare-token");
      } else {
        let error: unknown;
        try {
          await run;
        } catch (caught) {
          error = caught;
        }
        expect(error).toMatchObject({
          stage: "indeterminate",
          exitCode: 3,
        });
        expect(error instanceof Error ? error.message : String(error)).not.toContain(
          "private-cloudflare-token",
        );
      }
      expect(runtime.calls.filter(mutatesTarget)).toHaveLength(1);
    } finally {
      await rm(custody.root, { recursive: true, force: true });
      await rm(release.root, { recursive: true, force: true });
      await rm(scratch.root, { recursive: true, force: true });
    }
  }
});

test("release-apply resolves a lost acknowledgement through every Worker-version page", async () => {
  const custody = await privateFirstInstallInputs();
  const release = await publishedReleaseFixture();
  const scratch = await releaseOwnerScratch();
  const base = lostAcknowledgementReleaseRuntime(release.archive, true);
  const originalRun = base.run.bind(base);
  const baseline = unrelatedVersionRows(1_050);
  let versionApiCalls = 0;
  const runtime: SurfaceRuntime = {
    ...base,
    async run(request) {
      const line = `${request.command} ${request.args.join(" ")}`;
      if (/wrangler versions list/u.test(line)) {
        base.calls.push(request);
        return { exitCode: 0, stdout: versionListJson([]), stderr: "" };
      }
      return await originalRun(request);
    },
    async cloudflareApi(request) {
      expect(request.cloudflareApiTokenFile).toBe(custody.tokenFile);
      if (
        request.path ===
          `/accounts/${ACCOUNT}/workers/scripts/takos-live/versions`
      ) {
        versionApiCalls += 1;
        const upload = base.calls.find(mutatesTarget);
        const tag = upload?.args[upload.args.indexOf("--tag") + 1];
        const message = upload?.args[upload.args.indexOf("--message") + 1];
        const rows = upload && tag && message
          ? [...baseline, { id: NEXT, tag, message }]
          : baseline;
        return versionApiPage(rows, Number(request.query?.page ?? "0"));
      }
      if (
        request.path === `/accounts/${ACCOUNT}/containers/dash/applications`
      ) {
        return cloudflareEnvelope(containerApiRows(), {});
      }
      throw new Error(`unexpected Cloudflare API path ${request.path}`);
    },
  };
  try {
    const { report } = await runCloudflareProductionRecorded(
      parseCloudflareProductionArgs(
        releaseOwnerArgs({
          phase: "--release-apply",
          outputsPath: scratch.outputsPath,
          outputsJson: scratch.outputsJson,
          descriptorPath: release.descriptorPath,
          tokenFile: custody.tokenFile,
        }),
        scratch.root,
      ),
      runtime,
    );
    expect(report).toMatchObject({
      status: "applied",
      activated: { servedVersion: NEXT },
    });
    expect(versionApiCalls).toBeGreaterThan(40);
    expect(base.calls.filter(mutatesTarget)).toHaveLength(1);
  } finally {
    await rm(custody.root, { recursive: true, force: true });
    await rm(release.root, { recursive: true, force: true });
    await rm(scratch.root, { recursive: true, force: true });
  }
});

test("release-apply holds one target-and-operation lease across absence, upload, and readback", async () => {
  const custody = await privateFirstInstallInputs();
  const release = await publishedReleaseFixture();
  const scratch = await releaseOwnerScratch();
  const leaseRoot = join(scratch.root, "shared-release-leases");
  const firstBase = lostAcknowledgementReleaseRuntime(
    release.archive,
    true,
    true,
  );
  const secondBase = lostAcknowledgementReleaseRuntime(
    release.archive,
    true,
    true,
  );
  const originalFirstApi = firstBase.cloudflareApi!;
  let enteredResolve: (() => void) | undefined;
  let unblockResolve: (() => void) | undefined;
  const entered = new Promise<void>((resolve) => {
    enteredResolve = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    unblockResolve = resolve;
  });
  let held = false;
  const first: SurfaceRuntime = {
    ...firstBase,
    releaseLeaseRoot: leaseRoot,
    async cloudflareApi(request) {
      if (
        !held &&
        request.path.endsWith("/workers/scripts/takos-live/versions")
      ) {
        held = true;
        enteredResolve?.();
        await blocked;
      }
      return await originalFirstApi(request);
    },
  };
  const second: SurfaceRuntime = {
    ...secondBase,
    releaseLeaseRoot: leaseRoot,
  };
  const parsed = parseCloudflareProductionArgs(
    releaseOwnerArgs({
      phase: "--release-apply",
      outputsPath: scratch.outputsPath,
      outputsJson: scratch.outputsJson,
      descriptorPath: release.descriptorPath,
      tokenFile: custody.tokenFile,
    }),
    scratch.root,
  );
  try {
    const firstRun = runCloudflareProductionRecorded(parsed, first);
    await entered;
    let secondError: unknown;
    try {
      await runCloudflareProductionRecorded(parsed, second);
    } catch (caught) {
      secondError = caught;
    }
    expect(secondError).toMatchObject({ stage: "refused", exitCode: 2 });
    expect(secondError instanceof Error ? secondError.message : String(secondError)).toMatch(
      /local first-install release lease/u,
    );
    expect(secondBase.calls.filter(mutatesTarget)).toHaveLength(0);
    expect(secondBase.apiCalls).toHaveLength(0);

    unblockResolve?.();
    const { report } = await firstRun;
    expect(report).toMatchObject({
      status: "applied",
      activated: { servedVersion: NEXT },
    });
    expect(firstBase.calls.filter(mutatesTarget)).toHaveLength(1);
  } finally {
    unblockResolve?.();
    await rm(custody.root, { recursive: true, force: true });
    await rm(release.root, { recursive: true, force: true });
    await rm(scratch.root, { recursive: true, force: true });
  }
});

test("release-apply never steals a stale or foreign target-and-operation lease", async () => {
  const custody = await privateFirstInstallInputs();
  const release = await publishedReleaseFixture();
  const scratch = await releaseOwnerScratch();
  const leaseRoot = join(scratch.root, "release-leases");
  const scopeDigest = createHash("sha256").update(JSON.stringify({
    kind: "takos.first-install-release-lease@v1",
    accountId: ACCOUNT,
    workerName: "takos-live",
    operationId: "first-install-release-apply-1",
  })).digest("hex");
  const leasePath = join(leaseRoot, scopeDigest);
  try {
    await mkdir(leaseRoot, { mode: 0o700 });
    for (const record of [
      {
        kind: "takos.first-install-release-lease@v1",
        scopeDigest,
        processId: 999_999,
        acquiredAt: "2000-01-01T00:00:00.000Z",
      },
      {
        kind: "foreign.release-lease@v9",
        scopeDigest: "0".repeat(64),
      },
    ]) {
      await mkdir(leasePath, { mode: 0o700 });
      await writeFile(
        join(leasePath, "lease.json"),
        `${JSON.stringify(record)}\n`,
        { mode: 0o600 },
      );
      const base = lostAcknowledgementReleaseRuntime(
        release.archive,
        true,
        true,
      );
      const runtime: SurfaceRuntime = { ...base, releaseLeaseRoot: leaseRoot };
      let error: unknown;
      try {
        await runCloudflareProductionRecorded(
          parseCloudflareProductionArgs(
            releaseOwnerArgs({
              phase: "--release-apply",
              outputsPath: scratch.outputsPath,
              outputsJson: scratch.outputsJson,
              descriptorPath: release.descriptorPath,
              tokenFile: custody.tokenFile,
            }),
            scratch.root,
          ),
          runtime,
        );
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ stage: "refused", exitCode: 2 });
      expect(base.calls.filter(mutatesTarget)).toHaveLength(0);
      expect(base.apiCalls).toHaveLength(0);
      expect(await readFile(join(leasePath, "lease.json"), "utf8")).toBe(
        `${JSON.stringify(record)}\n`,
      );
      await rm(leasePath, { recursive: true });
    }
  } finally {
    await rm(custody.root, { recursive: true, force: true });
    await rm(release.root, { recursive: true, force: true });
    await rm(scratch.root, { recursive: true, force: true });
  }
});

test("release-apply refuses duplicate or changing Worker-version pages before upload", async () => {
  const custody = await privateFirstInstallInputs();
  const release = await publishedReleaseFixture();
  const scratch = await releaseOwnerScratch();
  try {
    for (const scenario of ["duplicate-across-pages", "changing-pages"] as const) {
      const base = lostAcknowledgementReleaseRuntime(
        release.archive,
        true,
        true,
      );
      const originalApi = base.cloudflareApi!;
      let versionCalls = 0;
      const uniqueRows = unrelatedVersionRows(150);
      const duplicateRows = [...unrelatedVersionRows(101)];
      duplicateRows[100] = duplicateRows[0]!;
      const runtime: SurfaceRuntime = {
        ...base,
        async cloudflareApi(request) {
          if (!request.path.endsWith("/workers/scripts/takos-live/versions")) {
            return await originalApi(request);
          }
          versionCalls += 1;
          const page = Number(request.query?.page ?? "0");
          if (scenario === "duplicate-across-pages") {
            return versionApiPage(duplicateRows, page);
          }
          return versionApiPage(
            page === 1
              ? uniqueRows
              : [...uniqueRows, {
                  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                }],
            page,
          );
        },
      };
      let error: unknown;
      try {
        await runCloudflareProductionRecorded(
          parseCloudflareProductionArgs(
            releaseOwnerArgs({
              phase: "--release-apply",
              outputsPath: scratch.outputsPath,
              outputsJson: scratch.outputsJson,
              descriptorPath: release.descriptorPath,
              tokenFile: custody.tokenFile,
            }),
            scratch.root,
          ),
          runtime,
        );
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ stage: "refused", exitCode: 2 });
      expect(versionCalls).toBe(2);
      expect(base.calls.filter(mutatesTarget)).toHaveLength(0);
    }
  } finally {
    await rm(custody.root, { recursive: true, force: true });
    await rm(release.root, { recursive: true, force: true });
    await rm(scratch.root, { recursive: true, force: true });
  }
});

test("release-apply treats more than ten concurrent post-upload versions as indeterminate", async () => {
  const custody = await privateFirstInstallInputs();
  const release = await publishedReleaseFixture();
  const scratch = await releaseOwnerScratch();
  const base = lostAcknowledgementReleaseRuntime(release.archive, true);
  const originalApi = base.cloudflareApi!;
  const baseline = unrelatedVersionRows(1_050);
  const concurrent = Array.from({ length: 11 }, (_, index) => ({
    id: `cccccccc-cccc-4ccc-8ccc-${(index + 1).toString(16).padStart(12, "0")}`,
  }));
  let versionCalls = 0;
  const runtime: SurfaceRuntime = {
    ...base,
    async cloudflareApi(request) {
      if (!request.path.endsWith("/workers/scripts/takos-live/versions")) {
        return await originalApi(request);
      }
      versionCalls += 1;
      const upload = base.calls.find(mutatesTarget);
      const tag = upload?.args[upload.args.indexOf("--tag") + 1];
      const message = upload?.args[upload.args.indexOf("--message") + 1];
      const rows = upload && tag && message
        ? [...baseline, { id: NEXT, tag, message }, ...concurrent]
        : baseline;
      return versionApiPage(rows, Number(request.query?.page ?? "0"));
    },
  };
  try {
    let error: unknown;
    try {
      await runCloudflareProductionRecorded(
        parseCloudflareProductionArgs(
          releaseOwnerArgs({
            phase: "--release-apply",
            outputsPath: scratch.outputsPath,
            outputsJson: scratch.outputsJson,
            descriptorPath: release.descriptorPath,
            tokenFile: custody.tokenFile,
          }),
          scratch.root,
        ),
        runtime,
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ stage: "indeterminate", exitCode: 3 });
    expect(versionCalls).toBeGreaterThan(40);
    expect(base.calls.filter(mutatesTarget)).toHaveLength(1);
  } finally {
    await rm(custody.root, { recursive: true, force: true });
    await rm(release.root, { recursive: true, force: true });
    await rm(scratch.root, { recursive: true, force: true });
  }
});

test("release-apply rejects a duplicate attempt tag even after a normal acknowledgement", async () => {
  const custody = await privateFirstInstallInputs();
  const release = await publishedReleaseFixture();
  const scratch = await releaseOwnerScratch();
  const runtime = lostAcknowledgementReleaseRuntime(
    release.archive,
    true,
    true,
    false,
    "duplicate-attempt",
  );
  try {
    let error: unknown;
    try {
      await runCloudflareProductionRecorded(
        parseCloudflareProductionArgs(
          releaseOwnerArgs({
            phase: "--release-apply",
            outputsPath: scratch.outputsPath,
            outputsJson: scratch.outputsJson,
            descriptorPath: release.descriptorPath,
            tokenFile: custody.tokenFile,
          }),
          scratch.root,
        ),
        runtime,
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ stage: "indeterminate", exitCode: 3 });
    expect(runtime.calls.filter(mutatesTarget)).toHaveLength(1);
    expect(
      runtime.apiCalls.filter((request) =>
        request.path.endsWith("/workers/scripts/takos-live/versions")
      ),
    ).toHaveLength(4);
  } finally {
    await rm(custody.root, { recursive: true, force: true });
    await rm(release.root, { recursive: true, force: true });
    await rm(scratch.root, { recursive: true, force: true });
  }
});

test("release-apply deterministically refuses a pre-existing attempt tag before upload", async () => {
  const custody = await privateFirstInstallInputs();
  const release = await publishedReleaseFixture();
  const scratch = await releaseOwnerScratch();
  const first = lostAcknowledgementReleaseRuntime(
    release.archive,
    true,
    true,
  );
  try {
    await runCloudflareProductionRecorded(
      parseCloudflareProductionArgs(
        releaseOwnerArgs({
          phase: "--release-apply",
          outputsPath: scratch.outputsPath,
          outputsJson: scratch.outputsJson,
          descriptorPath: release.descriptorPath,
          tokenFile: custody.tokenFile,
        }),
        scratch.root,
      ),
      first,
    );
    const upload = first.calls.find(mutatesTarget);
    const tag = upload?.args[upload.args.indexOf("--tag") + 1];
    const message = upload?.args[upload.args.indexOf("--message") + 1];
    expect(tag).toMatch(/^takos-first-install-[0-9a-f]{64}$/u);
    expect(message).toMatch(/^takos\.first-install-release-apply@v2:[0-9a-f]{64}$/u);

    const secondBase = lostAcknowledgementReleaseRuntime(release.archive, false);
    const second: SurfaceRuntime = {
      ...secondBase,
      async cloudflareApi(request) {
        if (
          request.path.endsWith("/workers/scripts/takos-live/versions")
        ) {
          return versionApiPage(
            [{ id: NEXT, tag, message }],
            Number(request.query?.page ?? "0"),
          );
        }
        return await secondBase.cloudflareApi!(request);
      },
    };
    let error: unknown;
    try {
      await runCloudflareProductionRecorded(
        parseCloudflareProductionArgs(
          releaseOwnerArgs({
            phase: "--release-apply",
            outputsPath: scratch.outputsPath,
            outputsJson: scratch.outputsJson,
            descriptorPath: release.descriptorPath,
            tokenFile: custody.tokenFile,
          }),
          scratch.root,
        ),
        second,
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ stage: "refused", exitCode: 2 });
    expect(secondBase.calls.filter(mutatesTarget)).toHaveLength(0);
  } finally {
    await rm(custody.root, { recursive: true, force: true });
    await rm(release.root, { recursive: true, force: true });
    await rm(scratch.root, { recursive: true, force: true });
  }
});

test("release-apply never adopts a concurrent deployment or an ambiguous attempt tag after lost acknowledgement", async () => {
  for (const scenario of ["concurrent-current", "duplicate-attempt"] as const) {
    const custody = await privateFirstInstallInputs();
    const release = await publishedReleaseFixture();
    const scratch = await releaseOwnerScratch();
    const runtime = lostAcknowledgementReleaseRuntime(
      release.archive,
      true,
      false,
      false,
      scenario,
    );
    try {
      let error: unknown;
      try {
        await runCloudflareProductionRecorded(
          parseCloudflareProductionArgs(
            releaseOwnerArgs({
              phase: "--release-apply",
              outputsPath: scratch.outputsPath,
              outputsJson: scratch.outputsJson,
              descriptorPath: release.descriptorPath,
              tokenFile: custody.tokenFile,
            }),
            scratch.root,
          ),
          runtime,
        );
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ stage: "indeterminate", exitCode: 3 });
      expect(runtime.calls.filter(mutatesTarget)).toHaveLength(1);
      expect(
        runtime.apiCalls.filter((request) =>
          request.path.endsWith("/workers/scripts/takos-live/versions")
        ),
      ).toHaveLength(4);
      expect(
        runtime.calls.some((request) =>
          request.args[0] === "wrangler" &&
          request.args[1] === "versions" &&
          request.args[2] === "list"
        ),
      ).toBe(false);
    } finally {
      await rm(custody.root, { recursive: true, force: true });
      await rm(release.root, { recursive: true, force: true });
      await rm(scratch.root, { recursive: true, force: true });
    }
  }
});

test("release-apply requires the acknowledged version detail to carry its exact attempt identity", async () => {
  const custody = await privateFirstInstallInputs();
  const release = await publishedReleaseFixture();
  const scratch = await releaseOwnerScratch();
  const runtime = lostAcknowledgementReleaseRuntime(
    release.archive,
    true,
    true,
    false,
    "missing-tag",
  );
  try {
    let error: unknown;
    try {
      await runCloudflareProductionRecorded(
        parseCloudflareProductionArgs(
          releaseOwnerArgs({
            phase: "--release-apply",
            outputsPath: scratch.outputsPath,
            outputsJson: scratch.outputsJson,
            descriptorPath: release.descriptorPath,
            tokenFile: custody.tokenFile,
          }),
          scratch.root,
        ),
        runtime,
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ stage: "post-conditions", exitCode: 4 });
    expect(runtime.calls.filter(mutatesTarget)).toHaveLength(1);
  } finally {
    await rm(custody.root, { recursive: true, force: true });
    await rm(release.root, { recursive: true, force: true });
    await rm(scratch.root, { recursive: true, force: true });
  }
});

test("release-apply treats a multi-UUID upload acknowledgement as indeterminate", async () => {
  const custody = await privateFirstInstallInputs();
  const release = await publishedReleaseFixture();
  const scratch = await releaseOwnerScratch();
  const runtime = lostAcknowledgementReleaseRuntime(
    release.archive,
    true,
    true,
    false,
    "multiple-ack",
  );
  try {
    let error: unknown;
    try {
      await runCloudflareProductionRecorded(
        parseCloudflareProductionArgs(
          releaseOwnerArgs({
            phase: "--release-apply",
            outputsPath: scratch.outputsPath,
            outputsJson: scratch.outputsJson,
            descriptorPath: release.descriptorPath,
            tokenFile: custody.tokenFile,
          }),
          scratch.root,
        ),
        runtime,
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ stage: "indeterminate", exitCode: 3 });
    expect(runtime.calls.filter(mutatesTarget)).toHaveLength(1);
  } finally {
    await rm(custody.root, { recursive: true, force: true });
    await rm(release.root, { recursive: true, force: true });
    await rm(scratch.root, { recursive: true, force: true });
  }
});

test("release-apply classifies a failed attribution readback after acknowledged upload as indeterminate", async () => {
  const custody = await privateFirstInstallInputs();
  const release = await publishedReleaseFixture();
  const scratch = await releaseOwnerScratch();
  const runtime = lostAcknowledgementReleaseRuntime(
    release.archive,
    true,
    true,
    true,
  );
  try {
    let error: unknown;
    try {
      await runCloudflareProductionRecorded(
        parseCloudflareProductionArgs(
          releaseOwnerArgs({
            phase: "--release-apply",
            outputsPath: scratch.outputsPath,
            outputsJson: scratch.outputsJson,
            descriptorPath: release.descriptorPath,
            tokenFile: custody.tokenFile,
          }),
          scratch.root,
        ),
        runtime,
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ stage: "indeterminate", exitCode: 3 });
    expect(error instanceof Error ? error.message : String(error)).not.toContain(
      "private-cloudflare-token",
    );
    expect(runtime.calls.filter(mutatesTarget)).toHaveLength(1);
  } finally {
    await rm(custody.root, { recursive: true, force: true });
    await rm(release.root, { recursive: true, force: true });
    await rm(scratch.root, { recursive: true, force: true });
  }
});

test("release-apply rejects unsafe, duplicate, linked, and expanded archives before Cloudflare", async () => {
  for (const kind of ["unsafe", "duplicate", "symlink", "hardlink", "expanded"] as const) {
    const custody = await privateFirstInstallInputs();
    const original = await publishedReleaseFixture();
    const packageRoot = join(original.root, "package");
    const archivePath = join(original.root, `takos-worker-${kind}.tar.gz`);
    if (kind === "symlink") {
      await rm(join(packageRoot, "assets/index.html"));
      await symlink("../worker/index.js", join(packageRoot, "assets/index.html"));
    }
    if (kind === "hardlink") {
      await rm(join(packageRoot, "assets/index.html"));
      await link(
        join(packageRoot, "worker/index.js"),
        join(packageRoot, "assets/index.html"),
      );
    }
    const tarArgs = kind === "unsafe"
      ? [
          "tar",
          "-czf",
          archivePath,
          "--transform=s#^worker/index.js$#../escaped.js#",
          "-C",
          packageRoot,
          "worker/index.js",
          "assets",
          "asset-manifest.json",
        ]
      : kind === "duplicate"
        ? [
            "tar",
            "-czf",
            archivePath,
            "-C",
            packageRoot,
            ".",
            "./worker/index.js",
          ]
        : ["tar", "-czf", archivePath, "-C", packageRoot, "."];
    if (kind === "expanded") {
      await writeFile(archivePath, oversizedTarEntryArchive());
    } else {
      const tar = Bun.spawn(tarArgs, { stdout: "ignore", stderr: "pipe" });
      const tarError = await new Response(tar.stderr).text();
      expect(`${await tar.exited} ${tarError}`).toStartWith("0 ");
    }
    const release = await replacePublishedArchive(original, archivePath);
    const scratch = await releaseOwnerScratch();
    const runtime = lostAcknowledgementReleaseRuntime(release.archive, false);
    try {
      let error: unknown;
      try {
        await runCloudflareProductionRecorded(
          parseCloudflareProductionArgs(
            releaseOwnerArgs({
              phase: "--release-apply",
              outputsPath: scratch.outputsPath,
              outputsJson: scratch.outputsJson,
              descriptorPath: release.descriptorPath,
              tokenFile: custody.tokenFile,
            }),
            scratch.root,
          ),
          runtime,
        );
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ stage: "refused", exitCode: 2 });
      expect(error instanceof Error ? error.message : String(error)).toMatch(
        /archive.*(?:unsafe|duplicate|link|bound)/iu,
      );
      expect(
        runtime.calls.some((request) => request.command === "bunx"),
      ).toBe(false);
    } finally {
      await rm(custody.root, { recursive: true, force: true });
      await rm(release.root, { recursive: true, force: true });
      await rm(scratch.root, { recursive: true, force: true });
    }
  }
});

test("release-apply refuses pre-upload custody drift even when bytes are restored", async () => {
  for (const kind of ["content", "rename", "symlink", "config"] as const) {
    const custody = await privateFirstInstallInputs();
    const release = await publishedReleaseFixture();
    const scratch = await releaseOwnerScratch();
    let tampered = false;
    const runtime = lostAcknowledgementReleaseRuntime(
      release.archive,
      true,
      true,
      false,
      "ordinary",
      async (request) => {
        if (
          tampered ||
          request.command !== "bunx" ||
          !request.args.includes("--dry-run")
        ) return;
        tampered = true;
        const paths = await releaseCustodyPaths(request);
        if (kind === "content") {
          const bytes = await readFile(paths.entrypoint);
          await writeFile(paths.entrypoint, "mutated then restored\n");
          await writeFile(paths.entrypoint, bytes);
        } else if (kind === "rename") {
          const asset = join(paths.assets, "index.html");
          const moved = join(paths.assets, "index.moved");
          await rename(asset, moved);
          await rename(moved, asset);
        } else if (kind === "symlink") {
          const asset = join(paths.assets, "index.html");
          await rm(asset);
          await symlink(paths.entrypoint, asset);
        } else {
          const bytes = await readFile(paths.config);
          await writeFile(paths.config, `${bytes.toString()}\n# mutation\n`);
          await writeFile(paths.config, bytes);
        }
      },
    );
    try {
      let error: unknown;
      try {
        await runCloudflareProductionRecorded(
          parseCloudflareProductionArgs(
            releaseOwnerArgs({
              phase: "--release-apply",
              outputsPath: scratch.outputsPath,
              outputsJson: scratch.outputsJson,
              descriptorPath: release.descriptorPath,
              tokenFile: custody.tokenFile,
            }),
            scratch.root,
          ),
          runtime,
        );
      } catch (caught) {
        error = caught;
      }
      expect(tampered).toBe(true);
      expect(error).toMatchObject({ stage: "refused", exitCode: 2 });
      expect(error instanceof Error ? error.message : String(error)).toMatch(
        /release custody changed before upload/u,
      );
      expect(runtime.calls.filter(mutatesTarget)).toHaveLength(0);
    } finally {
      await rm(custody.root, { recursive: true, force: true });
      await rm(release.root, { recursive: true, force: true });
      await rm(scratch.root, { recursive: true, force: true });
    }
  }
});

test("release-apply reports post-upload custody drift as indeterminate", async () => {
  const custody = await privateFirstInstallInputs();
  const release = await publishedReleaseFixture();
  const scratch = await releaseOwnerScratch();
  let tampered = false;
  const runtime = lostAcknowledgementReleaseRuntime(
    release.archive,
    true,
    true,
    false,
    "ordinary",
    async (request) => {
      if (
        tampered ||
        request.command !== "bunx" ||
        !request.args.includes("deploy") ||
        request.args.includes("--dry-run")
      ) return;
      tampered = true;
      const paths = await releaseCustodyPaths(request);
      const bytes = await readFile(paths.config);
      await writeFile(paths.config, `${bytes.toString()}\n# changed during upload\n`);
      await writeFile(paths.config, bytes);
    },
  );
  try {
    let error: unknown;
    try {
      await runCloudflareProductionRecorded(
        parseCloudflareProductionArgs(
          releaseOwnerArgs({
            phase: "--release-apply",
            outputsPath: scratch.outputsPath,
            outputsJson: scratch.outputsJson,
            descriptorPath: release.descriptorPath,
            tokenFile: custody.tokenFile,
          }),
          scratch.root,
        ),
        runtime,
      );
    } catch (caught) {
      error = caught;
    }
    expect(tampered).toBe(true);
    expect(error).toMatchObject({ stage: "indeterminate", exitCode: 3 });
    expect(error instanceof Error ? error.message : String(error)).toMatch(
      /release custody changed during upload/u,
    );
    expect(runtime.calls.filter(mutatesTarget)).toHaveLength(1);
  } finally {
    await rm(custody.root, { recursive: true, force: true });
    await rm(release.root, { recursive: true, force: true });
    await rm(scratch.root, { recursive: true, force: true });
  }
});

test("release-status rejects every non-overlay structural drift without parsing drift prose", async () => {
  const custody = await privateFirstInstallInputs();
  const release = await publishedReleaseFixture();
  const scratch = await releaseOwnerScratch();
  const wrongBinding = JSON.parse(versionJson(NEXT)) as {
    resources: { bindings: Array<Record<string, unknown>> };
  };
  const db = wrongBinding.resources.bindings.find(
    (binding) => binding.name === "DB",
  );
  if (!db) throw new Error("test fixture omitted DB");
  db.id = "another-d1";
  const oldMigration = JSON.parse(versionJson(NEXT)) as Record<string, unknown>;
  oldMigration.metadata = { migration_tag: "v6" };
  const wrongContainers = JSON.parse(containerListJson()) as Array<{
    name: string;
    image: string;
    state: string;
  }>;
  wrongContainers[0]!.name = "unrelated-container";
  const provisioningContainers = JSON.parse(containerListJson()) as Array<{
    state: string;
  }>;
  provisioningContainers[0]!.state = "provisioning";
  const duplicateContainers = JSON.parse(containerListJson()) as Array<{
    name: string;
  }>;
  duplicateContainers.push({ ...duplicateContainers[0]! });
  const wrongPlain = JSON.parse(versionJson(NEXT)) as {
    resources: { bindings: Array<Record<string, unknown>> };
  };
  wrongPlain.resources.bindings.find(
    (binding) => binding.name === "ADMIN_DOMAIN",
  )!.text = "attacker.example.test";
  const extraPlain = JSON.parse(versionJson(NEXT)) as {
    resources: { bindings: Array<Record<string, unknown>> };
  };
  extraPlain.resources.bindings.push({
    name: "UNEXPECTED_PLAIN_TEXT",
    type: "plain_text",
    text: "must-not-be-blessed",
  });
  const duplicateService = JSON.parse(versionJson(NEXT)) as {
    resources: { bindings: Array<Record<string, unknown>> };
  };
  duplicateService.resources.bindings.push({
    name: "TAKOS_EGRESS",
    type: "service",
    service: "takos-live",
    entrypoint: "TakosEgressEntrypoint",
  });
  const cases = [
    releaseStatusReplies({ served: SERVED }),
    releaseStatusReplies({
      deployment: JSON.stringify({
        id: "split-deployment",
        versions: [
          { version_id: NEXT, percentage: 50 },
          { version_id: SERVED, percentage: 50 },
        ],
      }),
    }),
    releaseStatusReplies({ detail: JSON.stringify(wrongBinding) }),
    releaseStatusReplies({ detail: JSON.stringify(wrongPlain) }),
    releaseStatusReplies({ detail: JSON.stringify(extraPlain) }),
    releaseStatusReplies({ detail: JSON.stringify(duplicateService) }),
    releaseStatusReplies({
      secrets: REQUIRED_RUNTIME_SECRET_NAMES.filter(
        (name) => name !== "ENCRYPTION_KEY",
      ),
    }),
    releaseStatusReplies({ vectorDimensions: 1 }),
    releaseStatusReplies({ containers: JSON.stringify(wrongContainers) }),
    releaseStatusReplies({ containers: JSON.stringify(provisioningContainers) }),
    releaseStatusReplies({
      containerInfo: (index) => {
        const info = JSON.parse(containerInfoJson(index)) as {
          health: { instances: { failed: number } };
        };
        if (index === 0) info.health.instances.failed = 1;
        return JSON.stringify(info);
      },
    }),
    releaseStatusReplies({ detail: JSON.stringify(oldMigration) }),
    releaseStatusReplies({
      containerInfo: (index) => {
        const info = JSON.parse(containerInfoJson(index)) as Record<string, unknown>;
        if (index === 0) info.active_rollout_id = "rollout-still-progressing";
        return JSON.stringify(info);
      },
    }),
  ];
  try {
    for (const replies of cases) {
      const runtime = stubRuntime(replies, async () =>
        new Response("generic drift prose says everything is fine", { status: 200 })
      );
      let error: unknown;
      try {
        await runCloudflareProductionRecorded(
          parseCloudflareProductionArgs(
            releaseOwnerArgs({
              phase: "--release-status",
              outputsPath: scratch.outputsPath,
              outputsJson: scratch.outputsJson,
              descriptorPath: release.descriptorPath,
              tokenFile: custody.tokenFile,
              expectedServedVersion: NEXT,
            }),
            scratch.root,
          ),
          runtime,
        );
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({
        stage: "post-conditions",
        exitCode: 4,
      });
      expect(error instanceof Error ? error.message : String(error)).not.toContain(
        "generic drift prose",
      );
      for (const request of runtime.calls) expect(mutatesTarget(request)).toBe(false);
    }
    const duplicateRuntime = stubRuntime(
      releaseStatusReplies({ containers: JSON.stringify(duplicateContainers) }),
      async () => new Response("ok", { status: 200 }),
    );
    let duplicateError: unknown;
    try {
      await runCloudflareProductionRecorded(
        parseCloudflareProductionArgs(
          releaseOwnerArgs({
            phase: "--release-status",
            outputsPath: scratch.outputsPath,
            outputsJson: scratch.outputsJson,
            descriptorPath: release.descriptorPath,
            tokenFile: custody.tokenFile,
            expectedServedVersion: NEXT,
          }),
          scratch.root,
        ),
        duplicateRuntime,
      );
    } catch (caught) {
      duplicateError = caught;
    }
    expect(duplicateError).toMatchObject({ stage: "indeterminate", exitCode: 3 });
    for (const request of duplicateRuntime.calls) expect(mutatesTarget(request)).toBe(false);
  } finally {
    await rm(custody.root, { recursive: true, force: true });
    await rm(release.root, { recursive: true, force: true });
    await rm(scratch.root, { recursive: true, force: true });
  }
});

test("release-status rejects an unexpected Container application on a later API page", async () => {
  const custody = await privateFirstInstallInputs();
  const release = await publishedReleaseFixture();
  const scratch = await releaseOwnerScratch();
  const base = stubRuntime(releaseStatusReplies(), async () =>
    new Response("ok", { status: 200 })
  );
  let applicationApiCalls = 0;
  const expected = containerApiRows();
  const unexpected = unrelatedContainerRows(101);
  const firstPage = [
    expected[0]!,
    expected[1]!,
    ...unexpected.slice(0, 98),
  ];
  const laterPage = [expected[2]!, ...unexpected.slice(98)];
  const runtime: SurfaceRuntime = {
    ...base,
    async cloudflareApi(request) {
      expect(request.cloudflareApiTokenFile).toBe(custody.tokenFile);
      if (
        request.path !== `/accounts/${ACCOUNT}/containers/dash/applications`
      ) {
        throw new Error(`unexpected Cloudflare API path ${request.path}`);
      }
      applicationApiCalls += 1;
      if (request.query?.page_token === "later-page") {
        return cloudflareEnvelope(laterPage, {});
      }
      expect(request.query?.page_token).toBeUndefined();
      return cloudflareEnvelope(
        firstPage,
        { next_page_token: "later-page" },
      );
    },
  };
  try {
    let error: unknown;
    try {
      await runCloudflareProductionRecorded(
        parseCloudflareProductionArgs(
          releaseOwnerArgs({
            phase: "--release-status",
            outputsPath: scratch.outputsPath,
            outputsJson: scratch.outputsJson,
            descriptorPath: release.descriptorPath,
            tokenFile: custody.tokenFile,
            expectedServedVersion: NEXT,
          }),
          scratch.root,
        ),
        runtime,
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ stage: "post-conditions", exitCode: 4 });
    expect(applicationApiCalls).toBe(4);
    for (const request of base.calls) expect(mutatesTarget(request)).toBe(false);
  } finally {
    await rm(custody.root, { recursive: true, force: true });
    await rm(release.root, { recursive: true, force: true });
    await rm(scratch.root, { recursive: true, force: true });
  }
});

test("release-status treats Container page drift and non-adjacent token cycles as indeterminate", async () => {
  const custody = await privateFirstInstallInputs();
  const release = await publishedReleaseFixture();
  const scratch = await releaseOwnerScratch();
  try {
    for (const scenario of ["stable-scan-drift", "token-cycle"] as const) {
      const base = stubRuntime(releaseStatusReplies(), async () =>
        new Response("ok", { status: 200 })
      );
      let calls = 0;
      const runtime: SurfaceRuntime = {
        ...base,
        async cloudflareApi(request) {
          if (
            request.path !== `/accounts/${ACCOUNT}/containers/dash/applications`
          ) {
            throw new Error(`unexpected Cloudflare API path ${request.path}`);
          }
          calls += 1;
          if (scenario === "stable-scan-drift") {
            const rows = containerApiRows();
            if (calls === 2) rows[0] = { ...rows[0]!, version: 2 };
            return cloudflareEnvelope(rows, {});
          }
          const token = request.query?.page_token;
          if (token === undefined) {
            return cloudflareEnvelope([], { next_page_token: "cursor-a" });
          }
          if (token === "cursor-a") {
            return cloudflareEnvelope([], { next_page_token: "cursor-b" });
          }
          if (token === "cursor-b") {
            return cloudflareEnvelope([], { next_page_token: "cursor-a" });
          }
          throw new Error(`unexpected cursor ${token}`);
        },
      };
      let error: unknown;
      try {
        await runCloudflareProductionRecorded(
          parseCloudflareProductionArgs(
            releaseOwnerArgs({
              phase: "--release-status",
              outputsPath: scratch.outputsPath,
              outputsJson: scratch.outputsJson,
              descriptorPath: release.descriptorPath,
              tokenFile: custody.tokenFile,
              expectedServedVersion: NEXT,
            }),
            scratch.root,
          ),
          runtime,
        );
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ stage: "indeterminate", exitCode: 3 });
      expect(calls).toBe(scenario === "stable-scan-drift" ? 2 : 3);
      for (const request of base.calls) expect(mutatesTarget(request)).toBe(false);
    }
  } finally {
    await rm(custody.root, { recursive: true, force: true });
    await rm(release.root, { recursive: true, force: true });
    await rm(scratch.root, { recursive: true, force: true });
  }
});

test("release owner preflight rejects custody, source, descriptor, and product-environment drift before Cloudflare", async () => {
  const custody = await privateFirstInstallInputs();
  const release = await publishedReleaseFixture("2".repeat(40));
  const validRelease = await publishedReleaseFixture();
  const untrustedOriginRelease = await publishedReleaseFixture();
  const untrustedDescriptor = JSON.parse(
    await readFile(untrustedOriginRelease.descriptorPath, "utf8"),
  ) as { artifact: { url: string } };
  untrustedDescriptor.artifact.url =
    "https://untrusted.example.test/takos-worker-release.tar.gz";
  await writeFile(
    untrustedOriginRelease.descriptorPath,
    `${JSON.stringify(untrustedDescriptor, null, 2)}\n`,
  );
  const productionOutputs = outputs({
    deployment_environment: {
      sensitive: false,
      type: "string",
      value: "production",
    },
  });
  const scratch = await releaseOwnerScratch(productionOutputs);
  try {
    const environmentRuntime = stubRuntime([]);
    await expect(
      runCloudflareProductionRecorded(
        parseCloudflareProductionArgs(
          releaseOwnerArgs({
            phase: "--release-status",
            outputsPath: scratch.outputsPath,
            outputsJson: scratch.outputsJson,
            descriptorPath: release.descriptorPath,
            tokenFile: custody.tokenFile,
            expectedServedVersion: NEXT,
          }),
          scratch.root,
        ),
        environmentRuntime,
      ),
    ).rejects.toThrow(/fixed to orchestration lane integration/u);
    expect(environmentRuntime.calls).toEqual([]);

    const stagingScratch = await releaseOwnerScratch();
    try {
      const dirtySourceRuntime = stubRuntime([
        [/^git rev-parse HEAD/u, { stdout: `${HEAD}\n` }],
        [/^git rev-parse --abbrev-ref HEAD/u, { stdout: "detached\n" }],
        [/^git status --porcelain/u, { stdout: " M scripts/local-change.ts\n" }],
      ]);
      await expect(
        runCloudflareProductionRecorded(
          parseCloudflareProductionArgs(
            releaseOwnerArgs({
              phase: "--release-status",
              outputsPath: stagingScratch.outputsPath,
              outputsJson: stagingScratch.outputsJson,
              descriptorPath: validRelease.descriptorPath,
              tokenFile: custody.tokenFile,
              expectedServedVersion: NEXT,
            }),
            stagingScratch.root,
          ),
          dirtySourceRuntime,
        ),
      ).rejects.toThrow(/clean checkout whose HEAD equals/u);
      expect(dirtySourceRuntime.calls.some((request) => request.command === "bunx")).toBe(false);

      const indexedSourceBase = stubRuntime([
        [/^git rev-parse HEAD/u, { stdout: `${HEAD}\n` }],
        [/^git rev-parse --abbrev-ref HEAD/u, { stdout: "detached\n" }],
        [/^git status --porcelain/u, { stdout: "" }],
      ]);
      const indexedSourceRuntime = {
        ...indexedSourceBase,
        assertPhysicalGitTree: async () => {
          throw new Error("assume-unchanged hid physical byte drift");
        },
      };
      await expect(
        runCloudflareProductionRecorded(
          parseCloudflareProductionArgs(
            releaseOwnerArgs({
              phase: "--release-status",
              outputsPath: stagingScratch.outputsPath,
              outputsJson: stagingScratch.outputsJson,
              descriptorPath: validRelease.descriptorPath,
              tokenFile: custody.tokenFile,
              expectedServedVersion: NEXT,
            }),
            stagingScratch.root,
          ),
          indexedSourceRuntime,
        ),
      ).rejects.toThrow(/physical release owner checkout does not match/u);
      expect(indexedSourceRuntime.calls.some((request) => request.command === "bunx")).toBe(false);

      const descriptorRuntime = stubRuntime([
        [/^git rev-parse HEAD/u, { stdout: `${HEAD}\n` }],
        [/^git rev-parse --abbrev-ref HEAD/u, { stdout: "detached\n" }],
        [/^git status --porcelain/u, { stdout: "" }],
      ]);
      await expect(
        runCloudflareProductionRecorded(
          parseCloudflareProductionArgs(
            releaseOwnerArgs({
              phase: "--release-status",
              outputsPath: stagingScratch.outputsPath,
              outputsJson: stagingScratch.outputsJson,
              descriptorPath: release.descriptorPath,
              tokenFile: custody.tokenFile,
              expectedServedVersion: NEXT,
            }),
            stagingScratch.root,
          ),
          descriptorRuntime,
        ),
      ).rejects.toThrow(/canonical release descriptor does not match/u);
      expect(descriptorRuntime.calls.some((request) => request.command === "bunx")).toBe(false);

      let archiveFetches = 0;
      const originRuntime = stubRuntime(
        [
          [/^git rev-parse HEAD/u, { stdout: `${HEAD}\n` }],
          [/^git rev-parse --abbrev-ref HEAD/u, { stdout: "detached\n" }],
          [/^git status --porcelain/u, { stdout: "" }],
        ],
        async () => {
          archiveFetches += 1;
          return new Response(null, { status: 500 });
        },
      );
      await expect(
        runCloudflareProductionRecorded(
          parseCloudflareProductionArgs(
            releaseOwnerArgs({
              phase: "--release-apply",
              outputsPath: stagingScratch.outputsPath,
              outputsJson: stagingScratch.outputsJson,
              descriptorPath: untrustedOriginRelease.descriptorPath,
              tokenFile: custody.tokenFile,
            }),
            stagingScratch.root,
          ),
          originRuntime,
        ),
      ).rejects.toThrow(/canonical release descriptor does not match/u);
      expect(archiveFetches).toBe(0);
      expect(originRuntime.calls.some((request) => request.command === "bunx")).toBe(false);

      await chmod(custody.tokenFile, 0o644);
      const custodyRuntime = stubRuntime([]);
      await expect(
        runCloudflareProductionRecorded(
          parseCloudflareProductionArgs(
            releaseOwnerArgs({
              phase: "--release-status",
              outputsPath: stagingScratch.outputsPath,
              outputsJson: stagingScratch.outputsJson,
              descriptorPath: release.descriptorPath,
              tokenFile: custody.tokenFile,
              expectedServedVersion: NEXT,
            }),
            stagingScratch.root,
          ),
          custodyRuntime,
        ),
      ).rejects.toThrow(/mode 0600/u);
      expect(custodyRuntime.calls).toEqual([]);
    } finally {
      await rm(stagingScratch.root, { recursive: true, force: true });
    }
  } finally {
    await rm(custody.root, { recursive: true, force: true });
    await rm(release.root, { recursive: true, force: true });
    await rm(validRelease.root, { recursive: true, force: true });
    await rm(untrustedOriginRelease.root, { recursive: true, force: true });
    await rm(scratch.root, { recursive: true, force: true });
  }
});

test("release-status reports provider readback loss as value-free indeterminate evidence", async () => {
  const custody = await privateFirstInstallInputs();
  const release = await publishedReleaseFixture();
  const scratch = await releaseOwnerScratch();
  try {
    for (const replies of [
      [
        [/^git rev-parse HEAD/u, { stdout: `${HEAD}\n` }],
        [/^git rev-parse --abbrev-ref HEAD/u, { stdout: "detached\n" }],
        [/^git status --porcelain/u, { stdout: "" }],
        [
          /wrangler deployments status/u,
          {
            exitCode: 1,
            stderr: "provider leaked private-cloudflare-token in raw diagnostics",
          },
        ],
      ] as const,
      releaseStatusReplies({
        deployment: `generic drift prose\n${deploymentJson(NEXT)}`,
      }),
    ]) {
      const runtime = stubRuntime(replies);
      let error: unknown;
      try {
        await runCloudflareProductionRecorded(
          parseCloudflareProductionArgs(
            releaseOwnerArgs({
              phase: "--release-status",
              outputsPath: scratch.outputsPath,
              outputsJson: scratch.outputsJson,
              descriptorPath: release.descriptorPath,
              tokenFile: custody.tokenFile,
              expectedServedVersion: NEXT,
            }),
            scratch.root,
          ),
          runtime,
        );
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ stage: "indeterminate", exitCode: 3 });
      expect(error instanceof Error ? error.message : String(error)).not.toContain(
        "private-cloudflare-token",
      );
      expect(error instanceof Error ? error.message : String(error)).not.toContain(
        "generic drift prose",
      );
      for (const request of runtime.calls) expect(mutatesTarget(request)).toBe(false);
    }
  } finally {
    await rm(custody.root, { recursive: true, force: true });
    await rm(release.root, { recursive: true, force: true });
    await rm(scratch.root, { recursive: true, force: true });
  }
});

test("first-install CLI rejects free-form secret names and a drifted retained output digest", async () => {
  expect(() =>
    parseCloudflareProductionArgs(
      [
        "--runtime-secrets-install",
        "--environment",
        "integration",
        "--outputs",
        "/private/outputs.json",
        "--output-digest",
        `sha256:${"0".repeat(64)}`,
        "--source-commit",
        HEAD,
        "--operation-id",
        "operation-1",
        "--runtime-secret-directory",
        "/private/secrets",
        "--cloudflare-api-token-file",
        "/private/token",
        "--secret-name",
        "ATTACKER_CHOSEN",
      ],
      repositoryRoot,
    ),
  ).toThrow(/unknown argument --secret-name/u);
  expect(() =>
    parseCloudflareProductionArgs(
      [
        ...firstInstallArgs("--absence-proof", {
          secretDirectory: "/private/secrets",
          tokenFile: "/private/token",
        }),
        "--outputs",
        "/private/outputs.json",
        "--container-image",
        `docker.io/takos/agent@sha256:${"1".repeat(64)}`,
      ],
      repositoryRoot,
    ),
  ).toThrow(/first-install phases reject/u);
  expect(() =>
    parseCloudflareProductionArgs(
      [
        ...firstInstallArgs("--absence-proof", {
          secretDirectory: "/private/secrets",
          tokenFile: "/private/token",
        }),
        "--outputs",
        "/private/outputs.json",
        "--operation-id",
        "operation-2",
      ],
      repositoryRoot,
    ),
  ).toThrow(/may be specified only once/u);

  const custody = await privateFirstInstallInputs();
  try {
    const parsed = await options([
      "--runtime-secrets-install",
      "--environment",
      "integration",
      "--source-commit",
      HEAD,
      "--output-digest",
      `sha256:${"0".repeat(64)}`,
      "--operation-id",
      "operation-1",
      "--runtime-secret-directory",
      custody.secretDirectory,
      "--cloudflare-api-token-file",
      custody.tokenFile,
      "--execute",
    ]);
    const calls: CommandRequest[] = [];
    await expect(
      runCloudflareProductionRecorded(parsed, {
        run: async (request) => {
          calls.push(request);
          return { exitCode: 0, stdout: "[]", stderr: "" };
        },
        fetch: async () => new Response(null, { status: 500 }),
      }),
    ).rejects.toThrow(/digest .* does not match/u);
    expect(calls).toEqual([]);
  } finally {
    await rm(custody.root, { recursive: true, force: true });
  }
});

test("runtime-secret installation uses only the five fixed files via stdin and recovers one lost acknowledgement", async () => {
  const custody = await privateFirstInstallInputs();
  try {
    const present = new Set<string>();
    const calls: CommandRequest[] = [];
    const runtime: SurfaceRuntime = {
      async run(request) {
        calls.push(request);
        if (request.args.includes("list")) {
          return {
            exitCode: 0,
            stdout: secretListJson([...present]),
            stderr: "",
          };
        }
        const name = request.args[3];
        if (!name) throw new Error("secret put omitted its fixed name");
        expect((REQUIRED_RUNTIME_SECRET_NAMES as readonly string[]).includes(name)).toBe(true);
        expect(request.args).toEqual([
          "wrangler",
          "secret",
          "put",
          name,
          "--name",
          "takos-live",
          "--config",
          "deploy/cloudflare/wrangler.toml",
        ]);
        expect(request.cwd).toBe(repositoryRoot);
        expect(request.stdinFile).toBe(join(custody.secretDirectory, name));
        expect(request.cloudflareApiTokenFile).toBe(custody.tokenFile);
        expect(request.cloudflareAccountId).toBe(ACCOUNT);
        present.add(name);
        return {
          exitCode: name === "TAKOS_INTERNAL_API_SECRET" ? 1 : 0,
          stdout: "",
          stderr:
            name === "TAKOS_INTERNAL_API_SECRET"
              ? `connection lost after ${custody.values[name]}`
              : "",
        };
      },
      fetch: async () => new Response(null, { status: 500 }),
    };
    const parsed = await options([
      ...firstInstallArgs("--runtime-secrets-install", custody),
      "--execute",
    ]);
    const { report } = await runCloudflareProductionRecorded(parsed, runtime);

    expect(report).toMatchObject({
      kind: "takos.first-install-runtime-secrets@v1",
      status: "installed",
      sourceCommit: HEAD,
      operationId: "generation-1-runtime-secrets",
      bindings: [...REQUIRED_RUNTIME_SECRET_NAMES],
      target: { accountId: ACCOUNT, workerName: "takos-live" },
    });
    expect(report.outputDigest).toBe(
      `sha256:${createHash("sha256").update(outputs()).digest("hex")}`,
    );
    expect(Object.keys(report).sort()).toEqual([
      "attempts",
      "bindings",
      "environment",
      "installedAt",
      "kind",
      "operationId",
      "outputDigest",
      "sourceCommit",
      "status",
      "target",
    ]);
    expect(Object.keys(report.target as Record<string, unknown>).sort()).toEqual([
      "accountId",
      "workerName",
    ]);
    for (const attempt of report.attempts as Array<Record<string, unknown>>) {
      expect(Object.keys(attempt).sort()).toEqual([
        "acknowledgement",
        "name",
      ]);
    }
    expect((report.attempts as Array<{ acknowledgement: string }>)).toContainEqual(
      expect.objectContaining({
        name: "TAKOS_INTERNAL_API_SECRET",
        acknowledgement: "authoritative-readback-after-lost-ack",
      }),
    );
    expect(calls.filter((request) => request.args.includes("put"))).toHaveLength(5);
    for (const request of calls.filter((candidate) => candidate.args.includes("list"))) {
      expect(request).toMatchObject({
        command: "bunx",
        args: [
          "wrangler",
          "secret",
          "list",
          "--name",
          "takos-live",
          "--config",
          "deploy/cloudflare/wrangler.toml",
          "--format",
          "json",
        ],
        cwd: repositoryRoot,
        cloudflareApiTokenFile: custody.tokenFile,
        cloudflareAccountId: ACCOUNT,
      });
      expect(request.stdinFile).toBeUndefined();
    }
    expect(await readFile(join(repositoryRoot, "deploy/cloudflare/wrangler.toml"), "utf8"))
      .not.toMatch(/^\s*account_id\s*=/mu);
    expect(JSON.stringify(report)).not.toContain("private-");
    expect(JSON.stringify(calls)).not.toContain("private-cloudflare-token");
    expect(JSON.stringify(calls)).not.toContain(custody.values.ENCRYPTION_KEY);
  } finally {
    await rm(custody.root, { recursive: true, force: true });
  }
});

test("runtime-secret custody rejects permissive modes and symlinked files before any command", async () => {
  const custody = await privateFirstInstallInputs();
  try {
    const calls: CommandRequest[] = [];
    const runtime: SurfaceRuntime = {
      async run(request) {
        calls.push(request);
        return { exitCode: 0, stdout: "[]", stderr: "" };
      },
      fetch: async () => new Response(null, { status: 500 }),
    };
    await chmod(join(custody.secretDirectory, "ENCRYPTION_KEY"), 0o644);
    await expect(
      runCloudflareProductionRecorded(
        await options([
          ...firstInstallArgs("--runtime-secrets-install", custody),
          "--execute",
        ]),
        runtime,
      ),
    ).rejects.toMatchObject({
      stage: "refused",
      exitCode: 2,
      message: expect.stringMatching(/0600/u),
    });
    expect(calls).toEqual([]);

    await chmod(join(custody.secretDirectory, "ENCRYPTION_KEY"), 0o600);
    const target = join(custody.root, "real-encryption-key");
    await writeFile(target, "secret\n", { mode: 0o600 });
    await rm(join(custody.secretDirectory, "ENCRYPTION_KEY"));
    await symlink(target, join(custody.secretDirectory, "ENCRYPTION_KEY"));
    await expect(
      runCloudflareProductionRecorded(
        await options([
          ...firstInstallArgs("--runtime-secrets-install", custody),
          "--execute",
        ]),
        runtime,
      ),
    ).rejects.toThrow(/symbolic link|canonical/u);
    expect(calls).toEqual([]);
  } finally {
    await rm(custody.root, { recursive: true, force: true });
  }
});

test("runtime-secret partial and pre-existing lost acknowledgements stop without a blind retry", async () => {
  const custody = await privateFirstInstallInputs();
  try {
    for (const preexisting of [false, true]) {
      let listCount = 0;
      const puts: CommandRequest[] = [];
      const runtime: SurfaceRuntime = {
        async run(request) {
          if (request.args.includes("list")) {
            listCount += 1;
            return {
              exitCode: 0,
              stdout: secretListJson(
                preexisting ? ["ENCRYPTION_KEY"] : [],
              ),
              stderr: "",
            };
          }
          puts.push(request);
          return {
            exitCode: preexisting ? 1 : 0,
            stdout: "",
            stderr: custody.values.ENCRYPTION_KEY,
          };
        },
        fetch: async () => new Response(null, { status: 500 }),
      };
      let error: unknown;
      try {
        await runCloudflareProductionRecorded(
          await options([
            ...firstInstallArgs("--runtime-secrets-install", custody),
            "--execute",
          ]),
          runtime,
        );
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ stage: "indeterminate", exitCode: 3 });
      expect(String(error)).not.toContain(custody.values.ENCRYPTION_KEY);
      expect(puts).toHaveLength(1);
      expect(listCount).toBe(2);
    }
  } finally {
    await rm(custody.root, { recursive: true, force: true });
  }
});

test("runtime-secret readback distinguishes preflight refusal from a thrown lost acknowledgement", async () => {
  const custody = await privateFirstInstallInputs();
  try {
    const parsed = await options([
      ...firstInstallArgs("--runtime-secrets-install", custody),
      "--execute",
    ]);
    const preflightPuts: CommandRequest[] = [];
    await expect(
      runCloudflareProductionRecorded(parsed, {
        async run(request) {
          if (request.args.includes("put")) preflightPuts.push(request);
          return { exitCode: 1, stdout: "", stderr: custody.values.ENCRYPTION_KEY };
        },
        fetch: async () => new Response(null, { status: 500 }),
      }),
    ).rejects.toMatchObject({ stage: "refused", exitCode: 2 });
    expect(preflightPuts).toEqual([]);

    let reads = 0;
    const putNames: string[] = [];
    const present = new Set<string>();
    const { report } = await runCloudflareProductionRecorded(parsed, {
      async run(request) {
        if (request.args.includes("list")) {
          reads += 1;
          return { exitCode: 0, stdout: secretListJson([...present]), stderr: "" };
        }
        const name = request.args[3];
        if (!name) throw new Error("missing fixed secret name");
        putNames.push(name);
        present.add(name);
        if (name === "ENCRYPTION_KEY") {
          throw new Error(`lost acknowledgement ${custody.values[name]}`);
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      },
      fetch: async () => new Response(null, { status: 500 }),
    });
    expect(report.status).toBe("installed");
    expect(
      (report.attempts as Array<{ name: string; acknowledgement: string }>)[0],
    ).toEqual({
      name: "ENCRYPTION_KEY",
      acknowledgement: "authoritative-readback-after-lost-ack",
    });
    expect(putNames).toEqual([...REQUIRED_RUNTIME_SECRET_NAMES]);
    expect(reads).toBe(REQUIRED_RUNTIME_SECRET_NAMES.length + 2);
    expect(JSON.stringify(report)).not.toContain(custody.values.ENCRYPTION_KEY);
  } finally {
    await rm(custody.root, { recursive: true, force: true });
  }
});

test("runtime-secret readback fails closed on malformed or unbounded provider rows", async () => {
  const custody = await privateFirstInstallInputs();
  try {
    const parsed = await options([
      ...firstInstallArgs("--runtime-secrets-install", custody),
      "--execute",
    ]);
    for (const stdout of [
      JSON.stringify([{ unexpected: "ENCRYPTION_KEY" }]),
      JSON.stringify(Array.from({ length: 1025 }, () => ({ name: "EXTRA" }))),
    ]) {
      const puts: CommandRequest[] = [];
      await expect(
        runCloudflareProductionRecorded(parsed, {
          async run(request) {
            if (request.args.includes("put")) puts.push(request);
            return { exitCode: 0, stdout, stderr: "" };
          },
          fetch: async () => new Response(null, { status: 500 }),
        }),
      ).rejects.toMatchObject({ stage: "refused", exitCode: 2 });
      expect(puts).toEqual([]);
    }
  } finally {
    await rm(custody.root, { recursive: true, force: true });
  }
});

function absenceRuntime(
  override?: (request: CloudflareApiRequest) => CloudflareApiResponse | undefined,
): SurfaceRuntime {
  return {
    run: async () => ({ exitCode: 127, stdout: "", stderr: "unexpected command" }),
    fetch: async () => new Response(null, { status: 500 }),
    cloudflareApi: async (request) => {
      const changed = override?.(request);
      if (changed) return changed;
      if (
        request.path.endsWith("/workers/routes") ||
        request.path.endsWith("/workers/domains") ||
        request.path.endsWith("/queues") ||
        request.path.endsWith("/containers/dash/applications")
      ) {
        return {
          status: 200,
          body: { success: true, result: [], result_info: { total_pages: 1 } },
        };
      }
      return { status: 404, body: { success: false, errors: [] } };
    },
  };
}

test("absence proof inventories the complete retained Takos Cloudflare closure and never mutates", async () => {
  const custody = await privateFirstInstallInputs();
  try {
    const { report, issued } = await runCloudflareProductionRecorded(
      await options(firstInstallArgs("--absence-proof", custody)),
      absenceRuntime(),
    );
    expect(issued).toEqual([]);
    expect(report).toMatchObject({
      kind: "takos.first-install-absence@v1",
      status: "absent",
      sourceCommit: HEAD,
      target: { accountId: ACCOUNT, workerName: "takos-live" },
    });
    expect(Object.keys(report).sort()).toEqual([
      "checkedAt",
      "environment",
      "kind",
      "operationId",
      "outputDigest",
      "resources",
      "sourceCommit",
      "status",
      "summary",
      "target",
    ]);
    const resources = report.resources as Array<{
      resourceType: string;
      name: string;
      status: string;
    }>;
    expect(resources).toHaveLength(22);
    expect(Object.keys(report.target as Record<string, unknown>).sort()).toEqual([
      "accountId",
      "workerName",
    ]);
    expect(Object.keys(report.summary as Record<string, unknown>).sort()).toEqual([
      "absent",
      "indeterminate",
      "present",
    ]);
    for (const resource of resources) {
      expect(Object.keys(resource).sort()).toEqual([
        "evidence",
        "name",
        "resourceType",
        "status",
      ]);
    }
    expect(
      resources.reduce<Record<string, number>>((counts, resource) => {
        counts[resource.resourceType] = (counts[resource.resourceType] ?? 0) + 1;
        return counts;
      }, {}),
    ).toEqual({
      worker: 1,
      "worker-version": 1,
      "worker-route": 1,
      "worker-custom-domain": 1,
      "workers.dev": 1,
      d1: 1,
      kv: 1,
      r2: 5,
      queue: 6,
      vectorize: 1,
      "container-application": 3,
    });
    expect(resources.filter((resource) => resource.resourceType === "queue").map((resource) => resource.name).sort()).toEqual([
      "takos-live-index-jobs",
      "takos-live-index-jobs-dlq",
      "takos-live-notification-push",
      "takos-live-notification-push-dlq",
      "takos-live-runs",
      "takos-live-runs-dlq",
    ]);
    expect(
      resources.find((resource) => resource.resourceType === "worker-route"),
    ).toMatchObject({ name: "app.example.test" });
  } finally {
    await rm(custody.root, { recursive: true, force: true });
  }
});

test("absence proof distinguishes present from indeterminate and does not collapse either to absent", async () => {
  const custody = await privateFirstInstallInputs();
  try {
    const parsed = await options(firstInstallArgs("--absence-proof", custody));
    const present = await runCloudflareProductionRecorded(
      parsed,
      absenceRuntime((request) =>
        request.path.endsWith("/settings")
          ? { status: 200, body: { success: true, result: {} } }
          : undefined,
      ),
    );
    expect(present.report.status).toBe("present");

    const indeterminate = await runCloudflareProductionRecorded(
      parsed,
      absenceRuntime((request) =>
        request.path.includes("/vectorize/")
          ? { status: 503, body: { success: false, errors: [] } }
          : undefined,
      ),
    );
    expect(indeterminate.report.status).toBe("indeterminate");

    const route = await runCloudflareProductionRecorded(
      parsed,
      absenceRuntime((request) =>
        request.path.endsWith("/workers/routes")
          ? {
              status: 200,
              body: {
                success: true,
                result: [{ script: "takos-live", pattern: "app.example.test/*" }],
                result_info: { total_pages: 1 },
              },
            }
          : undefined,
      ),
    );
    expect(
      (route.report.resources as Array<{
        resourceType: string;
        name: string;
        status: string;
        evidence: string;
      }>).find((resource) => resource.resourceType === "worker-route"),
    ).toEqual({
      resourceType: "worker-route",
      name: "app.example.test",
      status: "present",
      evidence: "list-complete",
    });
  } finally {
    await rm(custody.root, { recursive: true, force: true });
  }
});

test("absence proof reads every list page before deciding a retained resource is absent", async () => {
  const custody = await privateFirstInstallInputs();
  const queueRequests: CloudflareApiRequest[] = [];
  try {
    const runtime = absenceRuntime((request) => {
      if (!request.path.endsWith("/queues")) return undefined;
      queueRequests.push(request);
      if (request.query?.page === "1") {
        return {
          status: 200,
          body: {
            success: true,
            result: [],
            result_info: { total_pages: 2 },
          },
        };
      }
      return {
        status: 200,
        body: {
          success: true,
          result: [{ queue_name: "takos-live-runs" }],
          result_info: { total_pages: 2 },
        },
      };
    });
    const { report } = await runCloudflareProductionRecorded(
      await options(firstInstallArgs("--absence-proof", custody)),
      runtime,
    );
    expect(report.status).toBe("present");
    expect(queueRequests.map((request) => request.query?.page)).toEqual(["1", "2"]);
    const queues = (report.resources as Array<{
      resourceType: string;
      name: string;
      status: string;
    }>).filter((resource) => resource.resourceType === "queue");
    expect(queues.find((resource) => resource.name === "takos-live-runs")?.status).toBe(
      "present",
    );
    expect(queues.filter((resource) => resource.status === "absent")).toHaveLength(5);
  } finally {
    await rm(custody.root, { recursive: true, force: true });
  }
});

test("absence proof treats malformed list and workers.dev readback as indeterminate", async () => {
  const custody = await privateFirstInstallInputs();
  try {
    const { report } = await runCloudflareProductionRecorded(
      await options(firstInstallArgs("--absence-proof", custody)),
      absenceRuntime((request) => {
        if (request.path.endsWith("/queues")) {
          return {
            status: 200,
            body: {
              success: true,
              result: [{ unexpected_queue_shape: "takos-live-runs" }],
              result_info: { total_pages: 1 },
            },
          };
        }
        if (request.path.endsWith("/subdomain")) {
          return { status: 200, body: { success: true, result: {} } };
        }
        return undefined;
      }),
    );

    expect(report.status).toBe("indeterminate");
    const resources = report.resources as Array<{
      resourceType: string;
      status: string;
      evidence: string;
    }>;
    expect(
      resources.filter((resource) => resource.resourceType === "queue"),
    ).toHaveLength(6);
    expect(
      resources
        .filter((resource) => resource.resourceType === "queue")
        .every(
          (resource) =>
            resource.status === "indeterminate" &&
            resource.evidence === "api-indeterminate",
        ),
    ).toBe(true);
    expect(
      resources.find((resource) => resource.resourceType === "workers.dev"),
    ).toMatchObject({
      status: "indeterminate",
      evidence: "api-indeterminate",
    });
  } finally {
    await rm(custody.root, { recursive: true, force: true });
  }
});
