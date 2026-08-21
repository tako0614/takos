#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, posix, resolve, sep } from "node:path";

import {
  parseTakosumiCompositionSourceIdentity,
  readTakosumiCompositionSourceIdentity,
  type TakosumiCompositionSourceIdentity,
} from "./check-takosumi-composition-source.ts";

export const WRANGLER_VERSION = "4.107.0";
export const NODE_EXECUTABLE = "/usr/local/bin/node";
export const MINIMUM_NODE_MAJOR = 22;
export const LIFECYCLE_CAPABILITY = "capsule.lifecycle.command.v1";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const ACCOUNT_ID = /^[0-9a-f]{32}$/u;
const RESOURCE_ID = /^[0-9a-f-]{16,64}$/u;
const WORKER_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const RESOURCE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const OCI_DIGEST_REF =
  /^registry\.cloudflare\.com\/([0-9a-f]{32})\/[A-Za-z0-9._/-]+@(sha256:[0-9a-f]{64})$/u;
const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,127}$/u;
const SECRET_LIKE =
  /(?:SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE_?KEY|API_?KEY)/u;
const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const VERSION = /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const MATERIALIZER_PROVENANCE_MESSAGE =
  /^takos-product-materializer\/v1 source=[0-9a-f]{40} archive=sha256:[0-9a-f]{64} config=sha256:[0-9a-f]{64}$/u;
const LEGACY_MATERIALIZER_PROVENANCE_MESSAGE =
  /^takos [0-9a-f]{40} sha256:[0-9a-f]{64} sha256:[0-9a-f]{64}$/u;

const MAX_DESCRIPTOR_BYTES = 256 * 1024;
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_EXPANDED_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 25_000;
const MAX_COMMAND_OUTPUT_BYTES = 4 * 1024 * 1024;
const ARTIFACT_DOWNLOAD_ATTEMPTS = 3;
const ARTIFACT_DOWNLOAD_RETRY_DELAY_MS = 250;
const REQUIRED_SECRET_NAMES = [
  "ENCRYPTION_KEY",
  "OIDC_CLIENT_SECRET",
  "PLATFORM_PRIVATE_KEY",
  "PLATFORM_PUBLIC_KEY",
  "TAKOS_AGENT_START_TOKEN",
  "TAKOS_INTERNAL_API_SECRET",
] as const;
const ALLOWED_SECRET_NAMES = new Set([
  ...REQUIRED_SECRET_NAMES,
  "ANTHROPIC_API_KEY",
  "AUDIT_IP_HASH_KEY",
  "CF_API_TOKEN",
  "GOOGLE_API_KEY",
  "OCI_ORCHESTRATOR_TOKEN",
  "OPENAI_API_KEY",
  "TAKOSUMI_ACCOUNTS_TOKEN",
  "TAKOS_FEATURED_APP_INSTALL_TOKEN",
  "TAKOS_INTERNAL_SERVICE_SECRET",
  "TAKOS_NOTIFICATION_PUSH_GATEWAY_TOKEN",
  "TURNSTILE_SECRET_KEY",
]);

const RESERVED_BINDING_NAMES = new Set([
  "AI",
  "ASSETS",
  "DB",
  "EXECUTOR_CONTAINER",
  "EXECUTOR_CONTAINER_TIER2",
  "EXECUTOR_CONTAINER_TIER3",
  "GIT_OBJECTS",
  "HOSTNAME_ROUTING",
  "INDEX_QUEUE",
  "NOTIFICATION_NOTIFIER",
  "RATE_LIMITER_DO",
  "ROUTING_DO",
  "RUN_NOTIFIER",
  "RUN_QUEUE",
  "SESSION_DO",
  "TAKOS_EGRESS",
  "TAKOS_NOTIFICATION_PUSH_QUEUE",
  "TAKOS_OFFLOAD",
  "TENANT_BUILDS",
  "TENANT_SOURCE",
  "VECTORIZE",
  "WORKER_BUNDLES",
]);

type JsonRecord = Record<string, unknown>;
type Phase = "post_apply" | "pre_destroy";

export type ExecutorCapacity = {
  tier1_max_instances: number;
  tier1_max_concurrent_runs: number;
  tier2_max_instances: number;
  tier3_max_instances: number;
  tier3_max_concurrent_runs: number;
};

export type TakosOutputs = {
  target: "cloudflare";
  accountId: string;
  workerName: string;
  publicUrl: string;
  workerEnv: Record<string, string>;
  capacity: ExecutorCapacity;
  d1DatabaseId: string;
  kvNamespaceId: string;
  buckets: Record<BucketKey, string>;
  queues: Record<QueueKey, string>;
  vector: { name: string; dimensions: 768; metric: "cosine" };
};

type BucketKey =
  | "worker_bundles"
  | "tenant_builds"
  | "tenant_source"
  | "git_objects"
  | "offload";

type QueueKey =
  | "runs"
  | "runs_dlq"
  | "index_jobs"
  | "index_jobs_dlq"
  | "notification_push"
  | "notification_push_dlq";

export type ReleaseDescriptor = {
  kind: "takosumi.worker-artifact@v2";
  app: "takos";
  commit: string;
  ref: string;
  workflowRun: null;
  releaseTag: string;
  takosumiCompositionSource: TakosumiCompositionSourceIdentity;
  artifact: {
    filename: "takos-worker-release.tar.gz";
    url: string;
    sha256: string;
    sha256Prefixed: string;
    size: number;
    contentType: "application/gzip";
  };
  assetManifest: "asset-manifest.json";
  containerImages: {
    executor: string;
    publicAgent?: string;
  };
  manifestUrl: string;
};

type Invocation = {
  phase: Phase;
  sourceSnapshotId: string;
  sourceCommit: string;
  releaseRunId: string;
  outputs: TakosOutputs;
  apiToken: string;
  descriptorUrl?: string;
  descriptorDigest?: string;
  runtimeSecretsFile?: string;
};

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type MaterializerDependencies = {
  runWrangler(args: readonly string[], timeoutMs?: number): Promise<CommandResult>;
  readWorkerPresence(workerName: string): Promise<boolean>;
  deleteWorker(workerName: string): Promise<void>;
  readVector(indexName: string): Promise<unknown | undefined>;
  listR2Objects(bucketName: string): Promise<readonly string[]>;
  deleteR2Object(bucketName: string, objectKey: string): Promise<void>;
  fetchBytes(url: string, maxBytes: number): Promise<Uint8Array>;
  fetchHealth(url: string): Promise<{ status: number; bytes: Uint8Array }>;
  sleep(milliseconds: number): Promise<void>;
  now(): string;
};

export class MaterializerError extends Error {
  readonly code: string;
  readonly stage: string;
  readonly mutationStarted: boolean;
  readonly completedStages: readonly string[];
  readonly diagnosticDigest?: string;

  constructor(input: {
    code: string;
    stage: string;
    message: string;
    mutationStarted?: boolean;
    completedStages?: readonly string[];
    diagnosticDigest?: string;
  }) {
    super(input.message);
    this.name = "MaterializerError";
    this.code = input.code;
    this.stage = input.stage;
    this.mutationStarted = input.mutationStarted ?? false;
    this.completedStages = input.completedStages ?? [];
    this.diagnosticDigest = input.diagnosticDigest;
  }
}

function invariant(
  condition: unknown,
  message: string,
  code = "invalid_input",
): asserts condition {
  if (!condition) {
    const stage =
      code === "invalid_archive" ||
      code === "artifact_digest_mismatch" ||
      code === "artifact_download_failed" ||
      code === "invalid_artifact_descriptor"
        ? "artifact"
        : code === "invalid_readback" ||
            code === "readback_failed" ||
            code === "resource_conflict"
          ? "readback"
          : code === "health_check_failed"
            ? "post_conditions"
            : "preflight";
    throw new MaterializerError({ code, stage, message });
  }
}

function record(value: unknown, label: string): JsonRecord {
  invariant(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${label} must be a JSON object`,
  );
  return value as JsonRecord;
}

function requiredString(
  value: unknown,
  label: string,
  pattern?: RegExp,
): string {
  invariant(
    typeof value === "string" && value.trim() === value && value.length > 0,
    `${label} must be a non-empty trimmed string`,
  );
  invariant(!value.includes("\0"), `${label} must not contain NUL`);
  invariant(!pattern || pattern.test(value), `${label} has an invalid format`);
  return value;
}

function exactKeys(
  value: JsonRecord,
  allowed: readonly string[],
  label: string,
): void {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  invariant(extra.length === 0, `${label} contains unsupported keys: ${extra.join(", ")}`);
}

function jsonFromEnv(env: NodeJS.ProcessEnv, name: string): unknown {
  const source = requiredString(env[name], name);
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new MaterializerError({
      code: "invalid_json",
      stage: "preflight",
      message: `${name} must contain valid JSON`,
    });
  }
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  return requiredString(env[name], name);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const input = value as JsonRecord;
  return `{${Object.keys(input)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(input[key])}`)
    .join(",")}}`;
}

export function digest(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function digestJson(value: unknown): string {
  return digest(stableJson(value));
}

async function readStreamBounded(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  label: string,
  code: string,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        invariant(false, `${label} is too large`, code);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function parsePositiveInteger(value: unknown, label: string): number {
  invariant(
    typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= 500,
    `${label} must be an integer between 1 and 500`,
  );
  return value;
}

function parseStringMap(
  value: unknown,
  label: string,
): Record<string, string> {
  const input = record(value, label);
  const output: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input)) {
    invariant(ENV_NAME.test(key), `${label}.${key} is not a Worker variable name`);
    invariant(!SECRET_LIKE.test(key), `${label}.${key} is secret-like`);
    invariant(
      !RESERVED_BINDING_NAMES.has(key),
      `${label}.${key} conflicts with a Worker binding`,
    );
    const value = requiredString(raw, `${label}.${key}`);
    invariant(value.length <= 16_384, `${label}.${key} is too large`);
    output[key] = value;
  }
  return output;
}

function parseNamedMap<K extends string>(
  value: unknown,
  keys: readonly K[],
  label: string,
  pattern: RegExp,
): Record<K, string> {
  const input = record(value, label);
  exactKeys(input, keys, label);
  const output = {} as Record<K, string>;
  for (const key of keys) {
    output[key] = requiredString(input[key], `${label}.${key}`, pattern);
  }
  return output;
}

function parsePublicOrigin(value: unknown, label: string): URL {
  const input = requiredString(value, label);
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new MaterializerError({
      code: "invalid_input",
      stage: "preflight",
      message: `${label} must be an absolute URL`,
    });
  }
  invariant(url.protocol === "https:", `${label} must use https`);
  invariant(!url.username && !url.password, `${label} must not contain user info`);
  invariant(!url.search && !url.hash, `${label} must not contain query or fragment`);
  invariant(url.pathname === "/" || url.pathname === "", `${label} must be an origin URL`);
  invariant(url.port === "", `${label} must use the default https port`);
  return url;
}

export function parseTakosOutputs(value: unknown): TakosOutputs {
  const outputs = record(value, "TAKOSUMI_OUTPUTS_JSON");
  invariant(outputs.target === "cloudflare", "target must be cloudflare");
  const accountId = requiredString(
    outputs.cloudflare_account_id,
    "cloudflare_account_id",
    ACCOUNT_ID,
  );
  const workerName = requiredString(
    outputs.service_runtime_name,
    "service_runtime_name",
    WORKER_NAME,
  );
  const launch = parsePublicOrigin(
    outputs.public_url ?? outputs.launch_url ?? outputs.url,
    "public_url",
  );
  for (const alias of [outputs.public_url, outputs.launch_url, outputs.url]) {
    if (alias !== null && alias !== undefined) {
      invariant(
        parsePublicOrigin(alias, "public URL alias").origin === launch.origin,
        "public URL aliases must identify the same origin",
      );
    }
  }

  const capacityInput = record(outputs.executor_capacity, "executor_capacity");
  const capacityKeys = [
    "tier1_max_instances",
    "tier1_max_concurrent_runs",
    "tier2_max_instances",
    "tier3_max_instances",
    "tier3_max_concurrent_runs",
  ] as const;
  exactKeys(capacityInput, capacityKeys, "executor_capacity");
  const capacity = Object.fromEntries(
    capacityKeys.map((key) => [
      key,
      parsePositiveInteger(capacityInput[key], `executor_capacity.${key}`),
    ]),
  ) as ExecutorCapacity;
  invariant(
    capacity.tier1_max_instances * capacity.tier1_max_concurrent_runs +
      capacity.tier3_max_instances * capacity.tier3_max_concurrent_runs <=
      250,
    "executor_capacity exceeds the queue concurrency ceiling",
  );

  const workerEnv = parseStringMap(outputs.worker_env, "worker_env");
  const expectedCapacityEnv: Record<string, string> = {
    EXECUTOR_TIER1_WARM_POOL_SIZE: String(capacity.tier1_max_instances),
    EXECUTOR_TIER1_MAX_CONCURRENT_RUNS: String(
      capacity.tier1_max_concurrent_runs,
    ),
    EXECUTOR_TIER3_POOL_SIZE: String(capacity.tier3_max_instances),
    EXECUTOR_TIER3_MAX_CONCURRENT_RUNS: String(
      capacity.tier3_max_concurrent_runs,
    ),
  };
  for (const [key, expected] of Object.entries(expectedCapacityEnv)) {
    invariant(workerEnv[key] === expected, `worker_env.${key} drifted from executor_capacity`);
  }

  const derivedVars: Record<string, string> = {
    ADMIN_DOMAIN: launch.hostname,
    TENANT_BASE_DOMAIN: launch.hostname,
    AUTH_PUBLIC_BASE_URL: launch.origin,
    PROXY_BASE_URL: launch.origin,
    TAKOS_AGENT_CONTROL_RPC_BASE_URL: launch.origin,
    CF_ACCOUNT_ID: accountId,
  };
  for (const [key, expected] of Object.entries(derivedVars)) {
    if (workerEnv[key] !== undefined) {
      invariant(workerEnv[key] === expected, `worker_env.${key} conflicts with OpenTofu outputs`);
    }
  }

  const buckets = parseNamedMap(
    outputs.object_buckets,
    ["worker_bundles", "tenant_builds", "tenant_source", "git_objects", "offload"],
    "object_buckets",
    RESOURCE_NAME,
  );
  const queues = parseNamedMap(
    outputs.queues,
    [
      "runs",
      "runs_dlq",
      "index_jobs",
      "index_jobs_dlq",
      "notification_push",
      "notification_push_dlq",
    ],
    "queues",
    RESOURCE_NAME,
  );
  invariant(
    new Set(Object.values(buckets)).size === Object.keys(buckets).length,
    "object bucket names must be unique",
  );
  invariant(
    new Set(Object.values(queues)).size === Object.keys(queues).length,
    "queue names must be unique",
  );
  const sql = record(outputs.sql_databases, "sql_databases");
  exactKeys(sql, ["db"], "sql_databases");
  const stores = record(outputs.key_value_stores, "key_value_stores");
  exactKeys(stores, ["hostname_routing"], "key_value_stores");
  const vectors = record(outputs.vector_indexes, "vector_indexes");
  exactKeys(vectors, ["vector"], "vector_indexes");
  const vector = record(vectors.vector, "vector_indexes.vector");
  exactKeys(vector, ["name", "dimensions", "metric"], "vector_indexes.vector");
  invariant(vector.dimensions === 768, "vector index dimensions must be 768");
  invariant(vector.metric === "cosine", "vector index metric must be cosine");
  for (const requiredWorkerVar of [
    "OIDC_ISSUER_URL",
    "OIDC_CLIENT_ID",
    "OIDC_REDIRECT_URI",
    "TAKOSUMI_ACCOUNTS_URL",
  ]) {
    invariant(workerEnv[requiredWorkerVar], `worker_env.${requiredWorkerVar} is required`);
  }
  const redirect = parsePublicOriginLike(
    workerEnv.OIDC_REDIRECT_URI!,
    "worker_env.OIDC_REDIRECT_URI",
  );
  invariant(
    redirect.href === `${launch.origin}/auth/oidc/callback`,
    "worker_env.OIDC_REDIRECT_URI must match the public Takos callback",
  );
  parsePublicOriginLike(workerEnv.OIDC_ISSUER_URL!, "worker_env.OIDC_ISSUER_URL");
  parsePublicOriginLike(
    workerEnv.TAKOSUMI_ACCOUNTS_URL!,
    "worker_env.TAKOSUMI_ACCOUNTS_URL",
  );

  return {
    target: "cloudflare",
    accountId,
    workerName,
    publicUrl: launch.origin,
    workerEnv: { ...workerEnv, ...derivedVars },
    capacity,
    d1DatabaseId: requiredString(sql.db, "sql_databases.db", RESOURCE_ID),
    kvNamespaceId: requiredString(
      stores.hostname_routing,
      "key_value_stores.hostname_routing",
      RESOURCE_ID,
    ),
    buckets,
    queues,
    vector: {
      name: requiredString(vector.name, "vector_indexes.vector.name", RESOURCE_NAME),
      dimensions: 768,
      metric: "cosine",
    },
  };
}

function canonicalProvider(value: string): string {
  const trimmed = value.trim().replace(/^registry\.terraform\.io\//u, "");
  if (trimmed === "cloudflare/cloudflare") {
    return "registry.opentofu.org/cloudflare/cloudflare";
  }
  return trimmed;
}

export function validateProviderConfigurations(
  value: unknown,
  accountId: string,
): void {
  const envelope = record(value, "TAKOSUMI_PROVIDER_CONFIGS_JSON");
  exactKeys(envelope, ["format", "providers"], "provider configuration envelope");
  invariant(
    envelope.format === "takosumi.provider-configurations@v1",
    "provider configuration format is unsupported",
  );
  invariant(
    Array.isArray(envelope.providers) && envelope.providers.length === 1,
    "exactly one Cloudflare provider configuration is required",
  );
  const provider = record(envelope.providers[0], "provider configuration");
  exactKeys(provider, ["provider", "alias", "configuration"], "provider configuration");
  invariant(
    typeof provider.provider === "string" &&
      canonicalProvider(provider.provider) ===
        "registry.opentofu.org/cloudflare/cloudflare",
    "provider configuration must select the official Cloudflare provider",
  );
  invariant(provider.alias === null, "Cloudflare provider alias must be null");
  const configuration = record(provider.configuration, "provider configuration arguments");
  exactKeys(configuration, ["account_id", "base_url"], "provider configuration arguments");
  if (configuration.account_id !== undefined) {
    invariant(
      configuration.account_id === accountId,
      "provider account_id conflicts with OpenTofu outputs",
    );
  }
  if (configuration.base_url !== undefined) {
    const apiBase = requiredString(configuration.base_url, "provider base_url");
    invariant(
      apiBase === "https://api.cloudflare.com/client/v4" ||
        apiBase === "https://api.cloudflare.com/client/v4/",
      "custom Cloudflare provider endpoints are not allowed",
    );
  }
}

export function parseInvocation(
  phase: Phase,
  env: NodeJS.ProcessEnv = process.env,
): Invocation {
  const sourceSnapshotId = requiredEnv(env, "TAKOSUMI_SOURCE_SNAPSHOT_ID");
  invariant(IDENTITY.test(sourceSnapshotId), "TAKOSUMI_SOURCE_SNAPSHOT_ID is invalid");
  const sourceCommit = requiredEnv(env, "TAKOSUMI_SOURCE_COMMIT");
  invariant(COMMIT.test(sourceCommit), "TAKOSUMI_SOURCE_COMMIT must be a lowercase full commit");
  const releaseRunId = requiredEnv(env, "TAKOSUMI_RELEASE_RUN_ID");
  invariant(IDENTITY.test(releaseRunId), "TAKOSUMI_RELEASE_RUN_ID is invalid");
  const outputsValue = jsonFromEnv(env, "TAKOSUMI_OUTPUTS_JSON");
  const context = record(
    jsonFromEnv(env, "TAKOSUMI_RELEASE_CONTEXT_JSON"),
    "TAKOSUMI_RELEASE_CONTEXT_JSON",
  );
  invariant(context.kind === "takosumi.release-context@v1", "release context kind is invalid");
  invariant(context.releaseRunId === releaseRunId, "release context run id drifted");
  invariant(
    stableJson(context.outputs) === stableJson(outputsValue),
    "release context outputs drifted from TAKOSUMI_OUTPUTS_JSON",
  );
  const outputs = parseTakosOutputs(outputsValue);
  validateProviderConfigurations(
    jsonFromEnv(env, "TAKOSUMI_PROVIDER_CONFIGS_JSON"),
    outputs.accountId,
  );
  const apiToken = requiredEnv(env, "CLOUDFLARE_API_TOKEN");
  invariant(apiToken.length <= 16_384, "CLOUDFLARE_API_TOKEN is too large");
  for (const ambiguous of [
    "CF_API_TOKEN",
    "CLOUDFLARE_API_KEY",
    "CLOUDFLARE_EMAIL",
    "CLOUDFLARE_API_USER_SERVICE_KEY",
  ]) {
    invariant(!env[ambiguous], `${ambiguous} is not accepted as materializer authority`);
  }

  if (phase === "pre_destroy") {
    return {
      phase,
      sourceSnapshotId,
      sourceCommit,
      releaseRunId,
      outputs,
      apiToken,
    };
  }
  const descriptorUrl = requiredEnv(env, "TAKOS_RELEASE_ARTIFACT_DESCRIPTOR_URL");
  assertReleaseUrl(descriptorUrl, undefined, "takosumi-artifact.json");
  const descriptorDigest = requiredEnv(
    env,
    "TAKOS_RELEASE_ARTIFACT_DESCRIPTOR_SHA256",
  );
  invariant(SHA256.test(descriptorDigest), "artifact descriptor digest must be sha256:<hex>");
  const runtimeSecretsFile = requiredEnv(env, "TAKOS_RUNTIME_SECRETS_FILE");
  invariant(isAbsolute(runtimeSecretsFile), "TAKOS_RUNTIME_SECRETS_FILE must be absolute");
  return {
    phase,
    sourceSnapshotId,
    sourceCommit,
    releaseRunId,
    outputs,
    apiToken,
    descriptorUrl,
    descriptorDigest,
    runtimeSecretsFile,
  };
}

function assertReleaseUrl(value: string, tag?: string, filename?: string): URL {
  const url = parsePublicOriginLike(value, "release artifact URL");
  invariant(url.hostname === "github.com", "release artifact URL must use github.com");
  const expectedTag = tag ? escapeRegExp(tag) : "v[0-9A-Za-z.+-]+";
  const expectedFile = filename ? escapeRegExp(filename) : "[A-Za-z0-9._-]+";
  const expected = new RegExp(
    `^/tako0614/takos/releases/download/${expectedTag}/${expectedFile}$`,
    "u",
  );
  invariant(expected.test(url.pathname), "release artifact URL is outside the Takos release path");
  return url;
}

function parsePublicOriginLike(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MaterializerError({
      code: "invalid_input",
      stage: "preflight",
      message: `${label} must be an absolute URL`,
    });
  }
  invariant(url.protocol === "https:", `${label} must use https`);
  invariant(!url.username && !url.password, `${label} must not contain user info`);
  invariant(!url.search && !url.hash, `${label} must not contain query or fragment`);
  invariant(url.port === "", `${label} must use the default https port`);
  return url;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function validateReleaseDescriptor(
  value: unknown,
  input: {
    sourceCommit: string;
    packageVersion: string;
    accountId: string;
    descriptorUrl: string;
    takosumiCompositionSource: TakosumiCompositionSourceIdentity;
  },
): ReleaseDescriptor {
  const descriptor = record(value, "release artifact descriptor");
  exactKeys(
    descriptor,
    [
      "kind",
      "app",
      "commit",
      "ref",
      "workflowRun",
      "releaseTag",
      "takosumiCompositionSource",
      "artifact",
      "assetManifest",
      "containerImages",
      "manifestUrl",
    ],
    "release artifact descriptor",
  );
  invariant(descriptor.kind === "takosumi.worker-artifact@v2", "artifact descriptor kind is invalid");
  invariant(descriptor.app === "takos", "artifact descriptor app must be takos");
  invariant(descriptor.commit === input.sourceCommit, "artifact commit does not match the SourceSnapshot commit");
  const releaseTag = requiredString(descriptor.releaseTag, "artifact releaseTag", VERSION);
  invariant(releaseTag === `v${input.packageVersion}`, "artifact releaseTag does not match package.json");
  invariant(descriptor.ref === releaseTag, "artifact ref does not match releaseTag");
  invariant(descriptor.workflowRun === null, "artifact workflowRun must be null");
  const composition = record(
    descriptor.takosumiCompositionSource,
    "Takosumi composition source",
  );
  let parsedComposition: TakosumiCompositionSourceIdentity | undefined;
  try {
    parsedComposition = parseTakosumiCompositionSourceIdentity(composition);
  } catch {
    invariant(false, "Takosumi composition source identity is invalid");
  }
  invariant(
    parsedComposition.kind === input.takosumiCompositionSource.kind &&
      parsedComposition.repository === input.takosumiCompositionSource.repository &&
      parsedComposition.commit === input.takosumiCompositionSource.commit &&
      parsedComposition.pinDigest === input.takosumiCompositionSource.pinDigest,
    "Takosumi composition source does not match the SourceSnapshot pin",
  );
  assertReleaseUrl(input.descriptorUrl, releaseTag, "takosumi-artifact.json");
  invariant(descriptor.manifestUrl === input.descriptorUrl, "artifact manifestUrl drifted");
  invariant(descriptor.assetManifest === "asset-manifest.json", "asset manifest path is unsupported");
  const artifact = record(descriptor.artifact, "Worker artifact");
  exactKeys(
    artifact,
    [
      "filename",
      "url",
      "sha256",
      "sha256Prefixed",
      "size",
      "contentType",
    ],
    "Worker artifact",
  );
  invariant(artifact.filename === "takos-worker-release.tar.gz", "Worker artifact filename is invalid");
  const archiveUrl = requiredString(artifact.url, "Worker artifact URL");
  assertReleaseUrl(archiveUrl, releaseTag, "takos-worker-release.tar.gz");
  const archiveDigest = requiredString(artifact.sha256Prefixed, "Worker artifact digest", SHA256);
  invariant(artifact.sha256 === archiveDigest.slice("sha256:".length), "Worker artifact digest aliases drifted");
  invariant(
    typeof artifact.size === "number" &&
      Number.isSafeInteger(artifact.size) &&
      artifact.size > 0 &&
      artifact.size <= MAX_ARCHIVE_BYTES,
    "Worker artifact size is invalid",
  );
  invariant(artifact.contentType === "application/gzip", "Worker artifact content type is invalid");
  const images = record(descriptor.containerImages, "container image selection");
  invariant(
    Object.keys(images).every((key) =>
      ["executor", "publicAgent"].includes(key),
    ) && "executor" in images,
    "container image selection keys drifted",
  );
  const executor = requiredString(images.executor, "executor container image", OCI_DIGEST_REF);
  const publicAgent =
    images.publicAgent === undefined
      ? undefined
      : requiredString(
          images.publicAgent,
          "public agent container image",
          /^ghcr\.io\/tako0614\/takos-agent@sha256:[0-9a-f]{64}$/u,
        );
  invariant(executor.match(OCI_DIGEST_REF)?.[1] === input.accountId, "executor container image belongs to a different Cloudflare account");
  return {
    kind: "takosumi.worker-artifact@v2",
    app: "takos",
    commit: input.sourceCommit,
    ref: releaseTag,
    workflowRun: null,
    releaseTag,
    takosumiCompositionSource: input.takosumiCompositionSource,
    artifact: {
      filename: "takos-worker-release.tar.gz",
      url: archiveUrl,
      sha256: archiveDigest.slice("sha256:".length),
      sha256Prefixed: archiveDigest,
      size: artifact.size,
      contentType: "application/gzip",
    },
    assetManifest: "asset-manifest.json",
    containerImages: {
      executor,
      ...(publicAgent ? { publicAgent } : {}),
    },
    manifestUrl: input.descriptorUrl,
  };
}

export function validateRuntimeSecrets(value: unknown): Record<string, string> {
  const input = record(value, "runtime secret file");
  const output: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input)) {
    invariant(ALLOWED_SECRET_NAMES.has(key), `runtime secret ${key} is not in the Takos secret contract`);
    const secret = requiredString(raw, `runtime secret ${key}`);
    invariant(secret.length <= 64 * 1024, `runtime secret ${key} is too large`);
    output[key] = secret;
  }
  for (const key of REQUIRED_SECRET_NAMES) {
    invariant(output[key], `runtime secret ${key} is required`);
  }
  return Object.fromEntries(Object.entries(output).sort(([left], [right]) => left.localeCompare(right)));
}

export async function loadRuntimeSecretsFile(path: string): Promise<Record<string, string>> {
  const absolute = resolve(path);
  invariant(isAbsolute(path) && path === absolute, "runtime secret file path must be canonical absolute");
  invariant((await realpath(absolute)) === absolute, "runtime secret file path must not traverse symlinks");
  const handle = await open(
    absolute,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
  ).catch(() => undefined);
  invariant(handle, "runtime secret file is missing or unsafe");
  try {
    const info = await handle.stat();
    invariant(info.isFile(), "runtime secret file must be a regular non-symlink file");
    invariant((info.mode & 0o777) === 0o600, "runtime secret file mode must be exactly 0600");
    invariant(info.nlink === 1, "runtime secret file must have exactly one hard link");
    if (typeof process.getuid === "function") {
      invariant(info.uid === process.getuid(), "runtime secret file must be owned by the materializer user");
    }
    invariant(info.size > 0 && info.size <= 256 * 1024, "runtime secret file size is invalid");
    try {
      return validateRuntimeSecrets(
        JSON.parse(await handle.readFile("utf8")) as unknown,
      );
    } catch (error) {
      if (error instanceof MaterializerError) throw error;
      throw new MaterializerError({
        code: "invalid_secret_file",
        stage: "preflight",
        message: "runtime secret file must contain valid JSON",
      });
    }
  } finally {
    await handle.close();
  }
}

type TarEntry = { path: string; type: "file" | "directory"; bytes?: Uint8Array };

function tarString(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return new TextDecoder("utf-8", { fatal: true })
    .decode(end === -1 ? bytes : bytes.subarray(0, end))
    .trim();
}

function tarOctal(bytes: Uint8Array, label: string): number {
  const value = tarString(bytes).replace(/^0+/u, "") || "0";
  invariant(/^[0-7]+$/u.test(value), `${label} is not octal`, "invalid_archive");
  const parsed = Number.parseInt(value, 8);
  invariant(Number.isSafeInteger(parsed) && parsed >= 0, `${label} is invalid`, "invalid_archive");
  return parsed;
}

function safeArchivePath(raw: string): string | undefined {
  invariant(raw.length > 0 && !raw.includes("\0") && !raw.includes("\\"), "archive path is invalid", "invalid_archive");
  let value = raw;
  while (value.startsWith("./")) value = value.slice(2);
  if (value === "." || value === "") return undefined;
  invariant(!value.startsWith("/"), "archive path must be relative", "invalid_archive");
  invariant(posix.normalize(value) === value, "archive path is not canonical", "invalid_archive");
  invariant(!value.split("/").includes(".."), "archive path escapes the package", "invalid_archive");
  return value.replace(/\/$/u, "");
}

export async function parseWorkerArchive(compressed: Uint8Array): Promise<readonly TarEntry[]> {
  invariant(compressed.byteLength > 0 && compressed.byteLength <= MAX_ARCHIVE_BYTES, "Worker archive size is invalid", "invalid_archive");
  let expanded: Uint8Array;
  try {
    const stream = new Blob([Uint8Array.from(compressed).buffer])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    expanded = await readStreamBounded(
      stream,
      MAX_EXPANDED_ARCHIVE_BYTES,
      "expanded Worker archive",
      "invalid_archive",
    );
  } catch (error) {
    if (error instanceof MaterializerError) throw error;
    throw new MaterializerError({
      code: "invalid_archive",
      stage: "artifact",
      message: "Worker archive is not valid gzip",
    });
  }
  const entries: TarEntry[] = [];
  const names = new Set<string>();
  let offset = 0;
  let zeroBlocks = 0;
  while (offset + 512 <= expanded.byteLength) {
    const header = expanded.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) {
      zeroBlocks += 1;
      if (zeroBlocks >= 2) break;
      continue;
    }
    invariant(zeroBlocks === 0, "archive has data after its end marker", "invalid_archive");
    const storedChecksum = tarOctal(header.subarray(148, 156), "archive checksum");
    let computedChecksum = 0;
    for (let index = 0; index < header.length; index += 1) {
      computedChecksum += index >= 148 && index < 156 ? 32 : header[index]!;
    }
    invariant(storedChecksum === computedChecksum, "archive checksum mismatch", "invalid_archive");
    const name = tarString(header.subarray(0, 100));
    const prefix = tarString(header.subarray(345, 500));
    const path = safeArchivePath(prefix ? `${prefix}/${name}` : name);
    const size = tarOctal(header.subarray(124, 136), "archive entry size");
    const typeFlag = header[156];
    invariant(typeFlag === 0 || typeFlag === 48 || typeFlag === 53, "archive contains a link or unsupported entry", "invalid_archive");
    invariant(offset + size <= expanded.byteLength, "archive entry is truncated", "invalid_archive");
    if (path) {
      invariant(!names.has(path), `archive path is duplicated: ${path}`, "invalid_archive");
      names.add(path);
      entries.push(
        typeFlag === 53
          ? { path, type: "directory" }
          : { path, type: "file", bytes: expanded.slice(offset, offset + size) },
      );
      invariant(entries.length <= MAX_ARCHIVE_ENTRIES, "Worker archive has too many entries", "invalid_archive");
    }
    offset += Math.ceil(size / 512) * 512;
  }
  invariant(zeroBlocks >= 2, "archive end marker is missing", "invalid_archive");
  const files = new Map(entries.filter((entry) => entry.type === "file").map((entry) => [entry.path, entry.bytes!]));
  invariant(files.has("worker/index.js"), "Worker archive entrypoint is missing", "invalid_archive");
  invariant(files.has("asset-manifest.json"), "Worker archive asset manifest is missing", "invalid_archive");
  const assetFiles = [...files.keys()].filter((path) => path.startsWith("assets/"));
  invariant(assetFiles.length > 0, "Worker archive contains no static assets", "invalid_archive");
  let manifest: unknown;
  try {
    manifest = JSON.parse(new TextDecoder().decode(files.get("asset-manifest.json"))) as unknown;
  } catch {
    throw new MaterializerError({
      code: "invalid_archive",
      stage: "artifact",
      message: "asset-manifest.json is invalid",
    });
  }
  const assetManifest = record(manifest, "asset-manifest.json");
  invariant(Object.keys(assetManifest).length === assetFiles.length, "asset manifest does not cover the exact asset set", "invalid_archive");
  for (const path of assetFiles) {
    const key = `/${path.slice("assets/".length)}`;
    const entry = record(assetManifest[key], `asset manifest ${key}`);
    exactKeys(entry, ["hash", "size"], `asset manifest ${key}`);
    invariant(entry.size === files.get(path)!.byteLength, `asset manifest size drifted for ${key}`, "invalid_archive");
    invariant(typeof entry.hash === "string" && /^[0-9a-f]{32}$/u.test(entry.hash), `asset manifest hash is invalid for ${key}`, "invalid_archive");
  }
  return entries;
}

export async function extractWorkerArchive(
  entries: readonly TarEntry[],
  root: string,
): Promise<void> {
  for (const entry of entries.filter((item) => item.type === "directory")) {
    await mkdir(join(root, ...entry.path.split("/")), { recursive: true, mode: 0o700 });
  }
  for (const entry of entries.filter((item) => item.type === "file")) {
    const target = join(root, ...entry.path.split("/"));
    invariant(target.startsWith(`${root}${sep}`), "archive target escaped extraction root", "invalid_archive");
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, entry.bytes!, { flag: "wx", mode: 0o600 });
  }
}

function containerNames(workerName: string) {
  return {
    tier1: `${workerName}-executor-tier1`,
    tier2: `${workerName}-executor-tier2`,
    tier3: `${workerName}-executor-tier3`,
  } as const;
}

function queueConsumers(outputs: TakosOutputs) {
  return [
    { queue: outputs.queues.runs, max_batch_size: 1, max_batch_timeout: 1, max_retries: 5, max_concurrency: 5, retry_delay: 5, dead_letter_queue: outputs.queues.runs_dlq },
    { queue: outputs.queues.runs_dlq, max_batch_size: 10, max_batch_timeout: 60 },
    { queue: outputs.queues.index_jobs, max_batch_size: 5, max_batch_timeout: 60, max_retries: 2, dead_letter_queue: outputs.queues.index_jobs_dlq },
    { queue: outputs.queues.index_jobs_dlq, max_batch_size: 10, max_batch_timeout: 60 },
    { queue: outputs.queues.notification_push, max_batch_size: 5, max_batch_timeout: 5, max_retries: 5, max_concurrency: 5, retry_delay: 5, dead_letter_queue: outputs.queues.notification_push_dlq },
    { queue: outputs.queues.notification_push_dlq, max_batch_size: 10, max_batch_timeout: 60, max_retries: 100, retry_delay: 600 },
  ] as const;
}

export function renderWranglerConfig(input: {
  outputs: TakosOutputs;
  descriptor: ReleaseDescriptor;
  artifactRoot: string;
  sourceRoot: string;
}): JsonRecord {
  const { outputs, descriptor } = input;
  const names = containerNames(outputs.workerName);
  const publicUrl = new URL(outputs.publicUrl);
  const usesWorkersDev = publicUrl.hostname.endsWith(".workers.dev");
  return {
    name: outputs.workerName,
    account_id: outputs.accountId,
    main: join(input.artifactRoot, "worker", "index.js"),
    no_bundle: true,
    workers_dev: usesWorkersDev,
    preview_urls: false,
    compatibility_date: "2026-04-01",
    compatibility_flags: [
      "nodejs_compat",
      "no_handle_cross_request_promise_resolution",
      "global_fetch_strictly_public",
    ],
    ...(usesWorkersDev
      ? {}
      : { routes: [{ pattern: publicUrl.hostname, custom_domain: true }] }),
    observability: { enabled: true, logs: { head_sampling_rate: 0.1 } },
    vars: outputs.workerEnv,
    triggers: { crons: ["3,18,33,48 * * * *", "5 * * * *"] },
    assets: {
      directory: join(input.artifactRoot, "assets"),
      binding: "ASSETS",
      run_worker_first: true,
    },
    d1_databases: [
      {
        binding: "DB",
        database_id: outputs.d1DatabaseId,
        migrations_dir: join(input.sourceRoot, "db", "migrations-control", "migrations"),
      },
    ],
    kv_namespaces: [{ binding: "HOSTNAME_ROUTING", id: outputs.kvNamespaceId }],
    durable_objects: {
      bindings: [
        ["SESSION_DO", "SessionDO"],
        ["RUN_NOTIFIER", "RunNotifierDO"],
        ["NOTIFICATION_NOTIFIER", "NotificationNotifierDO"],
        ["RATE_LIMITER_DO", "RateLimiterDO"],
        ["ROUTING_DO", "RoutingDO"],
        ["EXECUTOR_CONTAINER", "ExecutorContainerTier1"],
        ["EXECUTOR_CONTAINER_TIER2", "ExecutorContainerTier2"],
        ["EXECUTOR_CONTAINER_TIER3", "ExecutorContainerTier3"],
      ].map(([name, class_name]) => ({ name, class_name })),
    },
    migrations: [
      { tag: "v1", new_classes: ["SessionDO"] },
      { tag: "v2", new_classes: ["RunNotifierDO"] },
      { tag: "v3", new_classes: ["RateLimiterDO"] },
      { tag: "v4", new_classes: ["NotificationNotifierDO"] },
      { tag: "v5", new_classes: ["RoutingDO"] },
      {
        tag: "v6",
        new_sqlite_classes: [
          "TakosRuntimeContainer",
          "ExecutorContainerTier1",
          "ExecutorContainerTier2",
          "ExecutorContainerTier3",
        ],
      },
      { tag: "v7", deleted_classes: ["TakosRuntimeContainer"] },
    ],
    containers: [
      {
        name: names.tier1,
        class_name: "ExecutorContainerTier1",
        image: descriptor.containerImages.executor,
        instance_type: "lite",
        max_instances: outputs.capacity.tier1_max_instances,
        rollout_active_grace_period: 900,
      },
      {
        name: names.tier2,
        class_name: "ExecutorContainerTier2",
        image: descriptor.containerImages.executor,
        instance_type: "basic",
        max_instances: outputs.capacity.tier2_max_instances,
        rollout_active_grace_period: 900,
      },
      {
        name: names.tier3,
        class_name: "ExecutorContainerTier3",
        image: descriptor.containerImages.executor,
        instance_type: { vcpu: 1, memory_mib: 12_288, disk_mb: 4_000 },
        max_instances: outputs.capacity.tier3_max_instances,
        rollout_active_grace_period: 900,
      },
    ],
    r2_buckets: [
      ["WORKER_BUNDLES", outputs.buckets.worker_bundles],
      ["TENANT_BUILDS", outputs.buckets.tenant_builds],
      ["TENANT_SOURCE", outputs.buckets.tenant_source],
      ["GIT_OBJECTS", outputs.buckets.git_objects],
      ["TAKOS_OFFLOAD", outputs.buckets.offload],
    ].map(([binding, bucket_name]) => ({ binding, bucket_name })),
    queues: {
      producers: [
        ["RUN_QUEUE", outputs.queues.runs],
        ["INDEX_QUEUE", outputs.queues.index_jobs],
        ["TAKOS_NOTIFICATION_PUSH_QUEUE", outputs.queues.notification_push],
      ].map(([binding, queue]) => ({ binding, queue })),
      consumers: queueConsumers(outputs),
    },
    vectorize: [{ binding: "VECTORIZE", index_name: outputs.vector.name }],
    ai: { binding: "AI" },
    services: [
      {
        binding: "TAKOS_EGRESS",
        service: outputs.workerName,
        entrypoint: "TakosEgressEntrypoint",
      },
    ],
  };
}

function parseJsonOutput(result: CommandResult, label: string): unknown {
  invariant(result.exitCode === 0, `${label} failed`, "readback_failed");
  try {
    return JSON.parse(result.stdout) as unknown;
  } catch {
    const lines = result.stdout.trim().split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      const candidate = lines.slice(index).join("\n").trim();
      if (!candidate.startsWith("[") && !candidate.startsWith("{")) continue;
      try {
        return JSON.parse(candidate) as unknown;
      } catch {
        // Try the next possible JSON boundary.
      }
    }
  }
  throw new MaterializerError({
    code: "invalid_readback",
    stage: "readback",
    message: `${label} returned invalid JSON`,
    diagnosticDigest: digest(`${label}\n${result.stdout}\n${result.stderr}`),
  });
}

function isNotFound(result: CommandResult): boolean {
  if (result.exitCode === 0) return false;
  const output = `${result.stdout}\n${result.stderr}`;
  // Wrangler's Vectorize API uses a structured, resource-specific identity
  // for an absent index. Keep this exact code narrow instead of treating every
  // underscore-delimited provider error as an absence.
  if (/\bvectorize\.index\.not_found\b/u.test(output)) return true;
  return /(?:\b404\b|not[ -]?found|does not exist|no deployments)/iu.test(output);
}

function commandFailure(
  stage: string,
  result: CommandResult,
  completedStages: readonly string[],
  mutationAttempted = false,
): MaterializerError {
  return new MaterializerError({
    code: "provider_command_failed",
    stage,
    message: `${stage} failed; provider diagnostics were withheld from lifecycle evidence`,
    mutationStarted: mutationAttempted || completedStages.length > 0,
    completedStages,
    diagnosticDigest: digest(`${result.exitCode}\n${result.stdout}\n${result.stderr}`),
  });
}

async function requireCommand(
  dependencies: MaterializerDependencies,
  args: readonly string[],
  stage: string,
  completedStages: readonly string[],
  timeoutMs?: number,
): Promise<CommandResult> {
  const result = await dependencies.runWrangler(args, timeoutMs);
  if (result.exitCode !== 0) throw commandFailure(stage, result, completedStages);
  return result;
}

function isAlreadyAbsent(result: CommandResult): boolean {
  return (
    isNotFound(result) ||
    /no worker consumer .* exists|no consumer .* exists/iu.test(
      `${result.stdout}\n${result.stderr}`,
    )
  );
}

async function requireMutationCommand(
  dependencies: MaterializerDependencies,
  args: readonly string[],
  stage: string,
  completedStages: readonly string[],
  options: { timeoutMs?: number; allowAlreadyAbsent?: boolean } = {},
): Promise<CommandResult> {
  const result = await dependencies.runWrangler(args, options.timeoutMs);
  if (
    result.exitCode !== 0 &&
    !(options.allowAlreadyAbsent && isAlreadyAbsent(result))
  ) {
    throw commandFailure(stage, result, completedStages, true);
  }
  return result;
}

type DeploymentReadback = { deploymentId: string; versionId: string };

function parseDeployment(value: unknown): DeploymentReadback {
  const deployment = record(value, "Wrangler deployment readback");
  const deploymentId = requiredString(deployment.id, "deployment id", IDENTITY);
  invariant(Array.isArray(deployment.versions) && deployment.versions.length === 1, "deployment must have exactly one active version", "invalid_readback");
  const version = record(deployment.versions[0], "active Worker version");
  invariant(version.percentage === 100, "active Worker version must receive 100 percent traffic", "invalid_readback");
  return {
    deploymentId,
    versionId: requiredString(version.version_id, "Worker version id", IDENTITY),
  };
}

async function confirmBlankDeploymentAbsent(
  dependencies: MaterializerDependencies,
  workerName: string,
): Promise<void> {
  const present = await dependencies.readWorkerPresence(workerName);
  if (!present) return;
  throw new MaterializerError({
    code: "resource_conflict",
    stage: "readback",
    message: "Worker exists while deployment status is blank",
    diagnosticDigest: digest("Worker presence readback\npresent"),
  });
}

async function deploymentReadback(
  dependencies: MaterializerDependencies,
  configPath: string,
  workerName: string,
): Promise<DeploymentReadback | undefined> {
  const result = await dependencies.runWrangler([
    "deployments",
    "status",
    "--name",
    workerName,
    "--json",
    "--config",
    configPath,
  ]);
  // Wrangler 4.107 (when invoked through Bun in CI) reports an absent Worker
  // with a successful, completely blank JSON readback. This is the locked CLI
  // contract. Confirm absence through the authoritative Worker settings
  // endpoint before accepting it; any other blank or malformed response
  // remains fail-closed.
  if (result.exitCode === 0 && result.stdout === "" && result.stderr === "") {
    await confirmBlankDeploymentAbsent(dependencies, workerName);
    return undefined;
  }
  if (isNotFound(result)) return undefined;
  if (result.exitCode !== 0) throw commandFailure("deployment_readback", result, []);
  return parseDeployment(parseJsonOutput(result, "deployment readback"));
}

async function waitForActivatedDeployment(
  dependencies: MaterializerDependencies,
  configPath: string,
  workerName: string,
  message: string,
  releaseTag: string,
): Promise<DeploymentReadback> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const deployment = await deploymentReadback(
        dependencies,
        configPath,
        workerName,
      );
      if (deployment) {
        await verifyVersion(
          dependencies,
          configPath,
          workerName,
          deployment.versionId,
          message,
          releaseTag,
        );
        return deployment;
      }
    } catch (error) {
      lastError = error;
    }
    if (attempt < 11) await dependencies.sleep(2_000);
  }
  throw new MaterializerError({
    code: "invalid_readback",
    stage: "readback",
    message: "the exact Worker deployment did not become readable",
    mutationStarted: true,
    diagnosticDigest:
      lastError instanceof MaterializerError
        ? lastError.diagnosticDigest
        : digest(lastError instanceof Error ? lastError.message : String(lastError)),
  });
}

function parseSecretNames(value: unknown): string[] {
  invariant(Array.isArray(value), "secret list readback must be an array", "invalid_readback");
  return value
    .map((entry, index) => {
      const item = record(entry, `secret list[${index}]`);
      return requiredString(item.name, `secret list[${index}].name`, ENV_NAME);
    })
    .sort();
}

async function secretNames(
  dependencies: MaterializerDependencies,
  configPath: string,
  workerName: string,
): Promise<string[]> {
  const result = await dependencies.runWrangler([
    "secret",
    "list",
    "--name",
    workerName,
    "--format",
    "json",
    "--config",
    configPath,
  ]);
  // Wrangler 4.107 can represent an absent Worker as a successful, completely
  // blank secret-list response in the runner. Accept that only after the
  // authoritative Worker settings endpoint independently proves absence.
  if (result.exitCode === 0 && result.stdout === "" && result.stderr === "") {
    const present = await dependencies.readWorkerPresence(workerName);
    if (!present) return [];
    throw new MaterializerError({
      code: "invalid_readback",
      stage: "readback",
      message: "Worker secret list is blank while the Worker exists",
      diagnosticDigest: digest("Worker secret presence readback\npresent"),
    });
  }
  if (isNotFound(result)) return [];
  if (result.exitCode !== 0) throw commandFailure("secret_readback", result, []);
  return parseSecretNames(parseJsonOutput(result, "secret list"));
}

async function waitForSecretNames(
  dependencies: MaterializerDependencies,
  configPath: string,
  workerName: string,
  expected: readonly string[],
): Promise<void> {
  const wanted = stableJson([...expected].sort());
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const observed = await secretNames(
      dependencies,
      configPath,
      workerName,
    );
    if (stableJson(observed) === wanted) return;
    await dependencies.sleep(2_000);
  }
  throw new MaterializerError({
    code: "invalid_readback",
    stage: "readback",
    message: "runtime secret names did not converge",
    mutationStarted: true,
  });
}

type VectorReadback = { name: string; dimensions: number; metric: string };

function parseVector(value: unknown): VectorReadback {
  const item = record(value, "Vectorize readback");
  const config = record(item.config, "Vectorize config readback");
  invariant(
    typeof config.dimensions === "number" &&
      Number.isInteger(config.dimensions) &&
      config.dimensions >= 1 &&
      config.dimensions <= 1536,
    "Vectorize dimensions are invalid",
    "invalid_readback",
  );
  return {
    name: requiredString(item.name, "Vectorize name", RESOURCE_NAME),
    dimensions: config.dimensions,
    metric: requiredString(config.metric, "Vectorize metric"),
  };
}

async function vectorReadback(
  dependencies: MaterializerDependencies,
  expected: TakosOutputs["vector"],
): Promise<VectorReadback | undefined> {
  // Wrangler 4.107 can return a successful blank body for both absent and
  // existing indexes in the runner. Read the authoritative provider API so
  // absence and the complete dimensions/metric shape are proved together.
  const value = await dependencies.readVector(expected.name);
  if (value === undefined) return undefined;
  const observed = parseVector(value);
  invariant(
    stableJson(observed) === stableJson(expected),
    "existing Vectorize index shape conflicts with the OpenTofu output",
    "resource_conflict",
  );
  return observed;
}

async function waitForVector(
  dependencies: MaterializerDependencies,
  expected: TakosOutputs["vector"],
): Promise<VectorReadback> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const observed = await vectorReadback(dependencies, expected);
    if (observed) return observed;
    await dependencies.sleep(2_000);
  }
  throw new MaterializerError({
    code: "invalid_readback",
    stage: "readback",
    message: "Vectorize index did not become readable",
    mutationStarted: true,
  });
}

type ContainerListEntry = {
  id: string;
  name: string;
  state: string;
  image: string;
};

function assertNoRetiredRuntimeContainer(
  containers: readonly ContainerListEntry[],
  workerName: string,
): void {
  const legacyName = `${workerName}-runtime`;
  invariant(
    !containers.some((container) => container.name === legacyName),
    `retired runtime container ${legacyName} still exists; remove it before materialization`,
    "resource_conflict",
  );
}

function parseContainerList(value: unknown): ContainerListEntry[] {
  invariant(Array.isArray(value), "container list readback must be an array", "invalid_readback");
  return value.map((raw, index) => {
    const item = record(raw, `container list[${index}]`);
    return {
      id: requiredString(item.id, `container list[${index}].id`, IDENTITY),
      name: requiredString(item.name, `container list[${index}].name`, RESOURCE_NAME),
      state: requiredString(item.state, `container list[${index}].state`),
      image: requiredString(item.image, `container list[${index}].image`),
    };
  });
}

async function containerList(
  dependencies: MaterializerDependencies,
  configPath: string,
): Promise<ContainerListEntry[]> {
  const result = await requireCommand(
    dependencies,
    ["containers", "list", "--json", "--per-page", "100", "--config", configPath],
    "container_list",
    [],
  );
  return parseContainerList(parseJsonOutput(result, "container list"));
}

function expectedContainerShape(
  outputs: TakosOutputs,
  descriptor: ReleaseDescriptor,
): Record<string, { image: string; instanceType: unknown; maxInstances: number }> {
  const names = containerNames(outputs.workerName);
  return {
    [names.tier1]: {
      image: descriptor.containerImages.executor,
      instanceType: "lite",
      maxInstances: outputs.capacity.tier1_max_instances,
    },
    [names.tier2]: {
      image: descriptor.containerImages.executor,
      instanceType: "basic",
      maxInstances: outputs.capacity.tier2_max_instances,
    },
    [names.tier3]: {
      image: descriptor.containerImages.executor,
      instanceType: { vcpu: 1, memory_mib: 12_288, disk_mb: 4_000 },
      maxInstances: outputs.capacity.tier3_max_instances,
    },
  };
}

type ContainerCapacity = {
  readonly vcpu: number;
  readonly memory_mib: number;
  readonly disk_mb: number;
};

const CONTAINER_PRESET_CAPACITIES: Readonly<Record<string, ContainerCapacity>> =
  Object.freeze({
    lite: { vcpu: 0.0625, memory_mib: 256, disk_mb: 2_000 },
    basic: { vcpu: 0.25, memory_mib: 1_024, disk_mb: 4_000 },
    "standard-2": { vcpu: 1, memory_mib: 6_144, disk_mb: 12_000 },
  });

function canonicalContainerCapacity(
  value: unknown,
  label: string,
  code: "invalid_input" | "invalid_readback",
): ContainerCapacity {
  if (typeof value === "string") {
    const preset = CONTAINER_PRESET_CAPACITIES[value];
    invariant(preset, `${label} preset is unsupported`, code);
    return preset;
  }
  invariant(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${label} must be a preset or capacity object`,
    code,
  );
  const item = value as JsonRecord;
  invariant(
    typeof item.vcpu === "number" && Number.isFinite(item.vcpu) && item.vcpu > 0,
    `${label}.vcpu is invalid`,
    code,
  );
  invariant(
    typeof item.memory_mib === "number" &&
      Number.isInteger(item.memory_mib) &&
      item.memory_mib > 0,
    `${label}.memory_mib is invalid`,
    code,
  );
  invariant(
    typeof item.disk_mb === "number" &&
      Number.isInteger(item.disk_mb) &&
      item.disk_mb > 0,
    `${label}.disk_mb is invalid`,
    code,
  );
  return {
    vcpu: item.vcpu,
    memory_mib: item.memory_mib,
    disk_mb: item.disk_mb,
  };
}

function containerCapacityReadback(configuration: JsonRecord): ContainerCapacity {
  if (configuration.instance_type !== undefined) {
    return canonicalContainerCapacity(
      configuration.instance_type,
      "container instance type readback",
      "invalid_readback",
    );
  }
  const disk = configuration.disk;
  invariant(
    disk !== null && typeof disk === "object" && !Array.isArray(disk),
    "container disk readback must be an object",
    "invalid_readback",
  );
  return canonicalContainerCapacity(
    {
      vcpu: configuration.vcpu,
      memory_mib: configuration.memory_mib,
      disk_mb: (disk as JsonRecord).size_mb,
    },
    "expanded container capacity readback",
    "invalid_readback",
  );
}

async function verifyContainers(
  dependencies: MaterializerDependencies,
  configPath: string,
  outputs: TakosOutputs,
  descriptor: ReleaseDescriptor,
): Promise<void> {
  const listed = await containerList(dependencies, configPath);
  assertNoRetiredRuntimeContainer(listed, outputs.workerName);
  const expected = expectedContainerShape(outputs, descriptor);
  const selected = listed.filter((item) => expected[item.name]);
  const expectedCount = Object.keys(expected).length;
  invariant(
    selected.length === expectedCount &&
      new Set(selected.map((item) => item.name)).size === expectedCount,
    "not all expected Takos agent container applications exist",
    "invalid_readback",
  );
  for (const item of selected) {
    const wanted = expected[item.name]!;
    invariant(item.image === wanted.image, `container ${item.name} image drifted`, "invalid_readback");
    invariant(item.state !== "degraded", `container ${item.name} is degraded`, "invalid_readback");
    const infoResult = await requireCommand(
      dependencies,
      ["containers", "info", item.id, "--config", configPath],
      "container_info",
      [],
    );
    const info = record(parseJsonOutput(infoResult, `container ${item.name} info`), `container ${item.name} info`);
    const configuration = record(info.configuration, `container ${item.name} configuration`);
    invariant(info.name === item.name, `container ${item.name} identity drifted`, "invalid_readback");
    invariant(configuration.image === wanted.image, `container ${item.name} configured image drifted`, "invalid_readback");
    invariant(info.max_instances === wanted.maxInstances, `container ${item.name} capacity drifted`, "invalid_readback");
    const expectedCapacity = canonicalContainerCapacity(
      wanted.instanceType,
      `container ${item.name} expected capacity`,
      "invalid_input",
    );
    invariant(
      stableJson(containerCapacityReadback(configuration)) ===
        stableJson(expectedCapacity),
      `container ${item.name} instance type drifted`,
      "invalid_readback",
    );
    invariant(info.rollout_active_grace_period === 900, `container ${item.name} grace period drifted`, "invalid_readback");
  }
}

async function verifyContainersEventually(
  dependencies: MaterializerDependencies,
  configPath: string,
  outputs: TakosOutputs,
  descriptor: ReleaseDescriptor,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      await verifyContainers(
        dependencies,
        configPath,
        outputs,
        descriptor,
      );
      return;
    } catch (error) {
      lastError = error;
      await dependencies.sleep(5_000);
    }
  }
  if (lastError instanceof MaterializerError) throw lastError;
  throw new MaterializerError({
    code: "invalid_readback",
    stage: "readback",
    message: "container applications did not converge",
    mutationStarted: true,
  });
}

function isWorkerConsumer(value: JsonRecord, workerName: string): boolean {
  const candidate = [
    value.script_name,
    value.scriptName,
    value.script,
    value.worker,
    value.service,
    value.name,
  ].find((entry) => typeof entry === "string" && entry.trim() !== "");
  return (value.type === undefined || value.type === "worker") && candidate === workerName;
}

async function queueReadbacks(
  dependencies: MaterializerDependencies,
  configPath: string,
  outputs: TakosOutputs,
  options: { readonly allowAbsent?: boolean } = {},
): Promise<Map<string, JsonRecord[]>> {
  const result = new Map<string, JsonRecord[]>();
  for (const queue of Object.values(outputs.queues)) {
    const command = await dependencies.runWrangler(
      ["queues", "consumer", "list", queue, "--json", "--config", configPath],
    );
    if (command.exitCode !== 0) {
      if (options.allowAbsent && isNotFound(command)) {
        result.set(queue, []);
        continue;
      }
      throw commandFailure("queue_consumer_readback", command, []);
    }
    const parsed =
      command.exitCode === 0 && command.stdout.trim() === ""
        ? []
        : parseJsonOutput(command, `queue ${queue} consumer list`);
    invariant(Array.isArray(parsed), `queue ${queue} consumer list must be an array`, "invalid_readback");
    result.set(
      queue,
      parsed.map((entry, index) => record(entry, `queue ${queue} consumer[${index}]`)),
    );
  }
  return result;
}

function validateQueueOwnership(
  readbacks: Map<string, JsonRecord[]>,
  outputs: TakosOutputs,
  requireTakosConsumer: boolean,
  verifySettings = true,
): void {
  for (const expected of queueConsumers(outputs)) {
    const consumers = readbacks.get(expected.queue) ?? [];
    const foreign = consumers.filter((consumer) => !isWorkerConsumer(consumer, outputs.workerName));
    invariant(foreign.length === 0, `queue ${expected.queue} has a foreign consumer`, "resource_conflict");
    const owned = consumers.filter((consumer) => isWorkerConsumer(consumer, outputs.workerName));
    invariant(owned.length <= 1, `queue ${expected.queue} has duplicate Takos consumers`, "resource_conflict");
    if (!requireTakosConsumer && owned.length === 0) continue;
    invariant(owned.length === 1, `queue ${expected.queue} is missing its Takos consumer`, "invalid_readback");
    if (!verifySettings) continue;
    const consumer = owned[0]!;
    const settings = record(consumer.settings, `queue ${expected.queue} settings`);
    const pairs: [string, unknown, unknown][] = [
      ["batch size", settings.batch_size, expected.max_batch_size],
      ["batch timeout", settings.max_wait_time_ms, expected.max_batch_timeout * 1000],
      ["max retries", settings.max_retries, "max_retries" in expected ? expected.max_retries : 3],
      ["max concurrency", settings.max_concurrency, "max_concurrency" in expected ? expected.max_concurrency : undefined],
      ["retry delay", settings.retry_delay, "retry_delay" in expected ? expected.retry_delay : 0],
      ["dead letter queue", consumer.dead_letter_queue, "dead_letter_queue" in expected ? expected.dead_letter_queue : undefined],
    ];
    for (const [label, actual, wanted] of pairs) {
      const normalizedActual =
        typeof wanted === "number" && typeof actual === "string" && actual.trim() !== ""
          ? Number(actual)
          : actual;
      invariant(normalizedActual === wanted || (wanted === undefined && actual == null), `queue ${expected.queue} ${label} drifted`, "invalid_readback");
    }
  }
}

function queueSettingsMatch(
  consumer: JsonRecord,
  expected: ReturnType<typeof queueConsumers>[number],
): boolean {
  try {
    const settings = record(consumer.settings, `queue ${expected.queue} settings`);
    const numeric = (value: unknown, fallback?: number): number | undefined => {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
      }
      return fallback;
    };
    return (
      numeric(settings.batch_size) === expected.max_batch_size &&
      numeric(settings.max_wait_time_ms) === expected.max_batch_timeout * 1000 &&
      numeric(settings.max_retries, 3) ===
        ("max_retries" in expected ? expected.max_retries : 3) &&
      numeric(settings.retry_delay, 0) ===
        ("retry_delay" in expected ? expected.retry_delay : 0) &&
      (numeric(settings.max_concurrency) ?? null) ===
        ("max_concurrency" in expected ? expected.max_concurrency : null) &&
      (typeof consumer.dead_letter_queue === "string"
        ? consumer.dead_letter_queue
        : "") ===
        ("dead_letter_queue" in expected ? expected.dead_letter_queue : "")
    );
  } catch {
    return false;
  }
}

async function reconcileQueueConsumers(
  dependencies: MaterializerDependencies,
  configPath: string,
  outputs: TakosOutputs,
  completedStages: readonly string[],
): Promise<void> {
  const current = await queueReadbacks(dependencies, configPath, outputs);
  validateQueueOwnership(current, outputs, false, false);
  for (const expected of queueConsumers(outputs)) {
    const existing = (current.get(expected.queue) ?? []).find((consumer) =>
      isWorkerConsumer(consumer, outputs.workerName),
    );
    if (existing && queueSettingsMatch(existing, expected)) continue;
    if (existing) {
      await requireMutationCommand(
        dependencies,
        [
          "queues",
          "consumer",
          "remove",
          expected.queue,
          outputs.workerName,
          "--config",
          configPath,
        ],
        "queue_consumer_remove",
        completedStages,
        { allowAlreadyAbsent: true },
      );
    }
    const args = [
      "queues",
      "consumer",
      "add",
      expected.queue,
      outputs.workerName,
      "--batch-size",
      String(expected.max_batch_size),
      "--batch-timeout",
      String(expected.max_batch_timeout),
    ];
    if ("max_retries" in expected) {
      args.push("--message-retries", String(expected.max_retries));
    }
    if ("dead_letter_queue" in expected) {
      args.push("--dead-letter-queue", expected.dead_letter_queue);
    }
    if ("max_concurrency" in expected) {
      args.push("--max-concurrency", String(expected.max_concurrency));
    }
    if ("retry_delay" in expected) {
      args.push("--retry-delay-secs", String(expected.retry_delay));
    }
    args.push("--config", configPath);
    await requireMutationCommand(
      dependencies,
      args,
      "queue_consumer_add",
      completedStages,
    );
  }
}

async function verifyQueueConsumersEventually(
  dependencies: MaterializerDependencies,
  configPath: string,
  outputs: TakosOutputs,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const readbacks = await queueReadbacks(dependencies, configPath, outputs);
      validateQueueOwnership(readbacks, outputs, true);
      return;
    } catch (error) {
      lastError = error;
      await dependencies.sleep(3_000);
    }
  }
  if (lastError instanceof MaterializerError) throw lastError;
  throw new MaterializerError({
    code: "invalid_readback",
    stage: "readback",
    message: "queue consumers did not converge",
    mutationStarted: true,
  });
}

async function verifyVersion(
  dependencies: MaterializerDependencies,
  configPath: string,
  workerName: string,
  versionId: string,
  message: string,
  releaseTag: string,
): Promise<void> {
  const version = await workerVersionReadback(
    dependencies,
    configPath,
    workerName,
    versionId,
  );
  const annotations = record(version.annotations, "Worker version annotations");
  invariant(annotations["workers/message"] === message, "Worker version provenance message drifted", "invalid_readback");
  invariant(annotations["workers/tag"] === releaseTag, "Worker version release tag drifted", "invalid_readback");
}

async function workerVersionReadback(
  dependencies: MaterializerDependencies,
  configPath: string,
  workerName: string,
  versionId: string,
): Promise<JsonRecord> {
  const result = await requireCommand(
    dependencies,
    ["versions", "view", versionId, "--name", workerName, "--json", "--config", configPath],
    "version_readback",
    [],
  );
  const version = record(parseJsonOutput(result, "Worker version readback"), "Worker version readback");
  invariant(version.id === versionId, "Worker version identity drifted", "invalid_readback");
  return version;
}

function legacyWorkerBindingsMatch(
  version: JsonRecord,
  outputs: TakosOutputs,
): boolean {
  try {
    const resources = record(version.resources, "existing Worker resources");
    invariant(Array.isArray(resources.bindings), "existing Worker bindings must be an array", "resource_conflict");
    const bindings = new Map<string, JsonRecord>();
    for (const raw of resources.bindings) {
      const binding = record(raw, "existing Worker binding");
      const name = requiredString(binding.name, "existing Worker binding name", ENV_NAME);
      if (bindings.has(name)) return false;
      bindings.set(name, binding);
    }
    const matches = (
      name: string,
      type: string,
      field: string,
      value: string,
    ): boolean => {
      const binding = bindings.get(name);
      return binding?.type === type && binding[field] === value;
    };
    if (!matches("DB", "d1", "id", outputs.d1DatabaseId)) return false;
    if (!matches("HOSTNAME_ROUTING", "kv_namespace", "namespace_id", outputs.kvNamespaceId)) return false;
    for (const [name, bucket] of [
      ["WORKER_BUNDLES", outputs.buckets.worker_bundles],
      ["TENANT_BUILDS", outputs.buckets.tenant_builds],
      ["TENANT_SOURCE", outputs.buckets.tenant_source],
      ["GIT_OBJECTS", outputs.buckets.git_objects],
      ["TAKOS_OFFLOAD", outputs.buckets.offload],
    ] as const) {
      if (!matches(name, "r2_bucket", "bucket_name", bucket)) return false;
    }
    for (const [name, queue] of [
      ["RUN_QUEUE", outputs.queues.runs],
      ["INDEX_QUEUE", outputs.queues.index_jobs],
      ["TAKOS_NOTIFICATION_PUSH_QUEUE", outputs.queues.notification_push],
    ] as const) {
      if (!matches(name, "queue", "queue_name", queue)) return false;
    }
    if (!matches("VECTORIZE", "vectorize", "index_name", outputs.vector.name)) return false;
    for (const [name, className] of [
      ["SESSION_DO", "SessionDO"],
      ["RUN_NOTIFIER", "RunNotifierDO"],
      ["NOTIFICATION_NOTIFIER", "NotificationNotifierDO"],
      ["RATE_LIMITER_DO", "RateLimiterDO"],
      ["ROUTING_DO", "RoutingDO"],
      ["EXECUTOR_CONTAINER", "ExecutorContainerTier1"],
      ["EXECUTOR_CONTAINER_TIER2", "ExecutorContainerTier2"],
      ["EXECUTOR_CONTAINER_TIER3", "ExecutorContainerTier3"],
    ] as const) {
      const binding = bindings.get(name);
      if (
        binding?.type !== "durable_object_namespace" ||
        binding.class_name !== className
      ) {
        return false;
      }
    }
    const service = bindings.get("TAKOS_EGRESS");
    return (
      service?.type === "service" &&
      service.service === outputs.workerName &&
      service.entrypoint === "TakosEgressEntrypoint"
    );
  } catch {
    return false;
  }
}

async function verifyExistingWorkerOwnership(
  dependencies: MaterializerDependencies,
  configPath: string,
  outputs: TakosOutputs,
  deployment: DeploymentReadback,
): Promise<JsonRecord> {
  const version = await workerVersionReadback(
    dependencies,
    configPath,
    outputs.workerName,
    deployment.versionId,
  );
  const annotations =
    version.annotations !== null &&
    typeof version.annotations === "object" &&
    !Array.isArray(version.annotations)
      ? (version.annotations as JsonRecord)
      : {};
  const message = annotations["workers/message"];
  const marked =
    typeof message === "string" &&
    (MATERIALIZER_PROVENANCE_MESSAGE.test(message) ||
      LEGACY_MATERIALIZER_PROVENANCE_MESSAGE.test(message));
  invariant(
    marked || legacyWorkerBindingsMatch(version, outputs),
    "existing Worker ownership cannot be proved from materializer provenance or exact Takos bindings",
    "resource_conflict",
  );
  return version;
}

function expectedContainerNamespaces(
  version: JsonRecord,
  outputs: TakosOutputs,
): Map<string, string> {
  const resources = record(version.resources, "existing Worker resources");
  invariant(
    Array.isArray(resources.bindings),
    "existing Worker bindings must be an array",
    "resource_conflict",
  );
  const expected = new Map<string, string>();
  const names = containerNames(outputs.workerName);
  for (const [name, className] of [
    [names.tier1, "ExecutorContainerTier1"],
    [names.tier2, "ExecutorContainerTier2"],
    [names.tier3, "ExecutorContainerTier3"],
  ] as const) {
    const matches = resources.bindings
      .map((raw, index) => record(raw, `existing Worker binding[${index}]`))
      .filter(
        (binding) =>
          binding.type === "durable_object_namespace" &&
          binding.class_name === className &&
          (binding.script_name === undefined ||
            binding.script_name === outputs.workerName),
      );
    invariant(
      matches.length === 1,
      `existing Worker must have exactly one ${className} namespace`,
      "resource_conflict",
    );
    expected.set(
      name,
      requiredString(
        matches[0]!.namespace_id,
        `${className} namespace id`,
        IDENTITY,
      ),
    );
  }
  return expected;
}

function verifyQueueAndVectorOwnership(
  version: JsonRecord,
  outputs: TakosOutputs,
): void {
  const resources = record(version.resources, "existing Worker resources");
  invariant(
    Array.isArray(resources.bindings),
    "existing Worker bindings must be an array",
    "resource_conflict",
  );
  const bindings = resources.bindings.map((raw, index) =>
    record(raw, `existing Worker binding[${index}]`),
  );
  for (const [name, type, field, value] of [
    ["VECTORIZE", "vectorize", "index_name", outputs.vector.name],
    ["RUN_QUEUE", "queue", "queue_name", outputs.queues.runs],
    ["INDEX_QUEUE", "queue", "queue_name", outputs.queues.index_jobs],
    [
      "TAKOS_NOTIFICATION_PUSH_QUEUE",
      "queue",
      "queue_name",
      outputs.queues.notification_push,
    ],
  ] as const) {
    const matches = bindings.filter((binding) => binding.name === name);
    invariant(
      matches.length === 1 &&
        matches[0]!.type === type &&
        matches[0]![field] === value,
      `existing Worker ${name} binding does not prove child-resource ownership`,
      "resource_conflict",
    );
  }
}

async function verifyContainerOwnership(input: {
  dependencies: MaterializerDependencies;
  configPath: string;
  outputs: TakosOutputs;
  containers: readonly ContainerListEntry[];
  workerVersion: JsonRecord;
}): Promise<void> {
  const { dependencies, configPath, outputs, containers, workerVersion } = input;
  const expectedNamespaces = expectedContainerNamespaces(workerVersion, outputs);
  invariant(
    new Set(containers.map((container) => container.name)).size ===
      containers.length,
    "duplicate Takos container application names exist",
    "resource_conflict",
  );
  for (const container of containers) {
    const expectedNamespace = expectedNamespaces.get(container.name);
    invariant(
      expectedNamespace,
      "container application name is outside the Takos ownership set",
      "resource_conflict",
    );
    const infoResult = await requireCommand(
      dependencies,
      ["containers", "info", container.id, "--config", configPath],
      "container_ownership_readback",
      [],
    );
    const info = record(
      parseJsonOutput(infoResult, "container ownership readback"),
      "container ownership readback",
    );
    const durableObjects = record(
      info.durable_objects,
      "container durable object ownership",
    );
    invariant(
      info.id === container.id &&
        info.name === container.name &&
        durableObjects.namespace_id === expectedNamespace,
      "container application is not attached to the owned Worker namespace",
      "resource_conflict",
    );
    const immutableImage = requiredString(
      record(info.configuration, "container configuration").image,
      "container image",
    ).match(OCI_DIGEST_REF);
    invariant(
      immutableImage?.[1] === outputs.accountId,
      "container application image is not an immutable image in the target account",
      "resource_conflict",
    );
  }
}

async function verifyHealth(
  dependencies: MaterializerDependencies,
  publicUrl: string,
): Promise<{ status: number; bodyDigest: string }> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const response = await dependencies.fetchHealth(`${publicUrl}/health`);
      lastStatus = response.status;
      if (response.status >= 200 && response.status < 300) {
        return { status: response.status, bodyDigest: digest(response.bytes) };
      }
    } catch {
      lastStatus = 0;
    }
    await dependencies.sleep(Math.min(5_000, 500 * 2 ** attempt));
  }
  throw new MaterializerError({
    code: "health_check_failed",
    stage: "post_conditions",
    message: `Takos health readback did not converge (last status ${lastStatus || "unreachable"})`,
    mutationStarted: true,
  });
}

function materializerEvidence(input: {
  invocation: Invocation;
  descriptor: ReleaseDescriptor;
  descriptorDigest: string;
  configDigest: string;
  deployment: DeploymentReadback;
  previous?: DeploymentReadback;
  health: { status: number; bodyDigest: string };
  verifiedAt: string;
}) {
  return {
    kind: "takos.product-materialization@v1",
    status: "succeeded",
    phase: "post_apply",
    sourceCommitDigest: digest(input.invocation.sourceCommit),
    sourceSnapshotDigest: digest(input.invocation.sourceSnapshotId),
    releaseRunDigest: digest(input.invocation.releaseRunId),
    releaseTag: input.descriptor.releaseTag,
    artifact: {
      descriptorDigest: input.descriptorDigest,
      workerArchiveDigest: input.descriptor.artifact.sha256Prefixed,
      executorImageDigest: input.descriptor.containerImages.executor.match(OCI_DIGEST_REF)![2],
      renderedConfigDigest: input.configDigest,
    },
    target: {
      workerNameDigest: digest(input.invocation.outputs.workerName),
      accountDigest: digest(input.invocation.outputs.accountId),
      outputsDigest: digestJson(input.invocation.outputs),
      deploymentIdDigest: digest(input.deployment.deploymentId),
      versionIdDigest: digest(input.deployment.versionId),
      previousDeploymentIdDigest: input.previous
        ? digest(input.previous.deploymentId)
        : null,
      previousVersionIdDigest: input.previous
        ? digest(input.previous.versionId)
        : null,
    },
    checks: {
      d1MigrationsApplied: true,
      vectorIndex: true,
      workerDeployment: true,
      containers: 3,
      queueConsumers: 6,
      runtimeSecrets: true,
      health: input.health,
    },
    recovery: {
      mode: "fresh_plan",
      note:
        "D1 migrations are forward-only. Prefer forward repair; restoring the previous exact descriptor requires a new reviewed plan and schema compatibility proof.",
    },
    verifiedAt: input.verifiedAt,
  } as const;
}

async function readPackageVersion(sourceRoot: string): Promise<string> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(join(sourceRoot, "package.json"), "utf8")) as unknown;
  } catch {
    throw new MaterializerError({
      code: "source_identity_invalid",
      stage: "preflight",
      message: "package.json is missing or invalid in the SourceSnapshot",
    });
  }
  const packageJson = record(value, "package.json");
  const version = requiredString(packageJson.version, "package.json version");
  invariant(VERSION.test(`v${version}`), "package.json version is not SemVer-like");
  const release = record(packageJson.takosRelease, "package.json takosRelease");
  invariant(release.name === "takos" && release.version === version, "package.json Takos release identity drifted");
  return version;
}

async function ensureLockedWrangler(sourceRoot: string): Promise<string> {
  const packagePath = join(sourceRoot, "node_modules", "wrangler", "package.json");
  const binPath = join(sourceRoot, "node_modules", "wrangler", "bin", "wrangler.js");
  let packageValue: unknown;
  try {
    packageValue = JSON.parse(await readFile(packagePath, "utf8")) as unknown;
  } catch {
    throw new MaterializerError({
      code: "wrangler_runtime_unavailable",
      stage: "preflight",
      message:
        "locked Wrangler is unavailable; InstallConfig.sourceBuild must run bun install --frozen-lockfile",
    });
  }
  invariant(record(packageValue, "Wrangler package").version === WRANGLER_VERSION, `locked Wrangler must be ${WRANGLER_VERSION}`, "wrangler_runtime_unavailable");
  const resolvedBin = await realpath(binPath).catch(() => "");
  invariant(resolvedBin === binPath, "Wrangler entrypoint must be a regular path inside node_modules", "wrangler_runtime_unavailable");
  invariant((await stat(binPath).catch(() => undefined))?.isFile(), "Wrangler entrypoint is missing", "wrangler_runtime_unavailable");
  return binPath;
}

export function validateNodeRuntimeVersion(output: string): string {
  const version = output.trim();
  const match = /^v(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  invariant(
    match !== null && Number(match[1]) >= MINIMUM_NODE_MAJOR,
    `Node runtime must be v${MINIMUM_NODE_MAJOR} or newer`,
    "wrangler_runtime_unavailable",
  );
  return version;
}

async function ensureCompatibleNodeRuntime(
  nodeExecutable = NODE_EXECUTABLE,
): Promise<void> {
  let processHandle: ReturnType<typeof Bun.spawn>;
  try {
    processHandle = Bun.spawn([nodeExecutable, "--version"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    throw new MaterializerError({
      code: "wrangler_runtime_unavailable",
      stage: "preflight",
      message: `Node runtime is unavailable at ${nodeExecutable}`,
    });
  }
  const timer = setTimeout(() => processHandle.kill(), 5_000);
  let exitCode: number;
  let stdoutBytes: Uint8Array;
  let stderrBytes: Uint8Array;
  try {
    [exitCode, stdoutBytes, stderrBytes] = await Promise.all([
      processHandle.exited,
      readStreamBounded(
        processHandle.stdout,
        4 * 1024,
        "Node version stdout",
        "wrangler_runtime_unavailable",
      ),
      readStreamBounded(
        processHandle.stderr,
        4 * 1024,
        "Node version stderr",
        "wrangler_runtime_unavailable",
      ),
    ]);
  } finally {
    clearTimeout(timer);
  }
  const stdout = new TextDecoder().decode(stdoutBytes);
  const stderr = new TextDecoder().decode(stderrBytes);
  invariant(
    exitCode === 0 && stderr.trim() === "",
    "Node runtime version probe failed",
    "wrangler_runtime_unavailable",
  );
  validateNodeRuntimeVersion(stdout);
}

async function listCloudflareContainers(input: {
  apiToken: string;
  accountId: string;
}): Promise<CommandResult> {
  const applications: unknown[] = [];
  const seenPageTokens = new Set<string>();
  let pageToken: string | undefined;
  try {
    for (let page = 0; page < 100; page += 1) {
      const url = new URL(
        `https://api.cloudflare.com/client/v4/accounts/${input.accountId}/containers/dash/applications`,
      );
      url.searchParams.set("per_page", "100");
      if (pageToken) url.searchParams.set("page_token", pageToken);
      const response = await fetch(url, {
        headers: {
          authorization: `Bearer ${input.apiToken}`,
          accept: "application/json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok || !response.body) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `container list API returned HTTP ${response.status}`,
        };
      }
      const bytes = await readStreamBounded(
        response.body,
        MAX_COMMAND_OUTPUT_BYTES,
        "container list response",
        "readback_failed",
      );
      const envelope = record(
        JSON.parse(new TextDecoder().decode(bytes)) as unknown,
        "container list response",
      );
      invariant(envelope.success !== false, "container list API rejected the request", "readback_failed");
      invariant(Array.isArray(envelope.result), "container list API result must be an array", "invalid_readback");
      for (const raw of envelope.result) {
        const item = record(raw, "container list application");
        const health =
          item.health !== null && typeof item.health === "object" && !Array.isArray(item.health)
            ? (item.health as JsonRecord)
            : {};
        const instances =
          health.instances !== null &&
          typeof health.instances === "object" &&
          !Array.isArray(health.instances)
            ? (health.instances as JsonRecord)
            : {};
        const state =
          typeof instances.failed === "number" && instances.failed > 0
            ? "degraded"
            : (typeof instances.starting === "number" && instances.starting > 0) ||
                (typeof instances.scheduling === "number" && instances.scheduling > 0)
              ? "provisioning"
              : typeof instances.active === "number" && instances.active > 0
                ? "active"
                : "ready";
        applications.push({
          id: item.id,
          name: item.name,
          image: item.image,
          state,
        });
      }
      const resultInfo =
        envelope.result_info !== null &&
        typeof envelope.result_info === "object" &&
        !Array.isArray(envelope.result_info)
          ? (envelope.result_info as JsonRecord)
          : {};
      const next = resultInfo.next_page_token;
      if (next === null || next === undefined || next === "") break;
      pageToken = requiredString(next, "container list next page token");
      invariant(pageToken.length <= 4_096, "container list next page token is too large", "invalid_readback");
      invariant(!seenPageTokens.has(pageToken), "container list pagination repeated a token", "invalid_readback");
      seenPageTokens.add(pageToken);
      invariant(page < 99, "container list pagination exceeded its bound", "invalid_readback");
    }
    const stdout = JSON.stringify(applications);
    invariant(Buffer.byteLength(stdout) <= MAX_COMMAND_OUTPUT_BYTES, "container list is too large", "invalid_readback");
    return { exitCode: 0, stdout, stderr: "" };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr:
        error instanceof MaterializerError
          ? `${error.code}:${error.stage}`
          : "container list API request failed",
    };
  }
}

type FetchImpl = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function artifactDownloadStatusIsRetryable(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function artifactDownloadFailure(reason: string): MaterializerError {
  return new MaterializerError({
    code: "artifact_download_failed",
    stage: "artifact",
    message: "immutable release artifact download failed",
    diagnosticDigest: digest(`artifact_download\n${reason}`),
  });
}

export function createDependencies(input: {
  nodeBin: string;
  wranglerBin: string;
  sourceRoot: string;
  apiToken: string;
  accountId: string;
  fetchImpl?: FetchImpl;
}): MaterializerDependencies {
  const providerFetch: FetchImpl = input.fetchImpl ?? fetch;
  const childEnv: Record<string, string> = {
    CI: "true",
    CLOUDFLARE_API_TOKEN: input.apiToken,
    CLOUDFLARE_ACCOUNT_ID: input.accountId,
    WRANGLER_SEND_METRICS: "false",
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
  };
  return {
    async runWrangler(args, timeoutMs = 10 * 60 * 1000) {
      // Wrangler 4.107.0 ignores --per-page in JSON mode and reads only the
      // first account page. Use the same fixed Cloudflare Containers endpoint
      // with explicit bounded pagination so absence checks are authoritative.
      if (args[0] === "containers" && args[1] === "list") {
        return listCloudflareContainers(input);
      }
      const processHandle = Bun.spawn([input.nodeBin, input.wranglerBin, ...args], {
        cwd: input.sourceRoot,
        env: childEnv,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const timer = setTimeout(() => processHandle.kill(), timeoutMs);
      try {
        const [exitCode, stdoutBytes, stderrBytes] = await Promise.all([
          processHandle.exited,
          readStreamBounded(
            processHandle.stdout,
            MAX_COMMAND_OUTPUT_BYTES,
            "provider command stdout",
            "provider_command_failed",
          ),
          readStreamBounded(
            processHandle.stderr,
            MAX_COMMAND_OUTPUT_BYTES,
            "provider command stderr",
            "provider_command_failed",
          ),
        ]);
        return {
          exitCode,
          stdout: new TextDecoder().decode(stdoutBytes),
          stderr: new TextDecoder().decode(stderrBytes),
        };
      } catch {
        processHandle.kill();
        await processHandle.exited.catch(() => undefined);
        return {
          exitCode: 1,
          stdout: "",
          stderr: "provider command execution or output bound failed",
        };
      } finally {
        clearTimeout(timer);
      }
    },
    async readWorkerPresence(workerName) {
      const label = "Worker presence readback";
      const url = new URL(
        `https://api.cloudflare.com/client/v4/accounts/${input.accountId}/workers/scripts/${encodeURIComponent(workerName)}/settings`,
      );
      let response: Response;
      try {
        response = await providerFetch(url, {
          headers: {
            authorization: `Bearer ${input.apiToken}`,
            accept: "application/json",
          },
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        throw new MaterializerError({
          code: "readback_failed",
          stage: "readback",
          message: "Worker presence readback failed",
          diagnosticDigest: digest(`${label}\ntransport`),
        });
      }
      if (response.status === 200) return true;
      if (response.status === 404) return false;
      throw new MaterializerError({
        code: "readback_failed",
        stage: "readback",
        message: "Worker presence readback was ambiguous",
        diagnosticDigest: digest(`${label}\nstatus=${response.status}`),
      });
    },
    async deleteWorker(workerName) {
      const label = "Worker delete";
      const url = new URL(
        `https://api.cloudflare.com/client/v4/accounts/${input.accountId}/workers/scripts/${encodeURIComponent(workerName)}`,
      );
      url.searchParams.set("force", "true");
      let response: Response;
      try {
        response = await providerFetch(url, {
          method: "DELETE",
          headers: {
            authorization: `Bearer ${input.apiToken}`,
            accept: "application/json",
          },
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        throw new MaterializerError({
          code: "provider_command_failed",
          stage: "worker_delete",
          message: "Worker delete failed; provider diagnostics were withheld from lifecycle evidence",
          mutationStarted: true,
          diagnosticDigest: digest(`${label}\ntransport`),
        });
      }
      if (response.ok || response.status === 404) return;
      throw new MaterializerError({
        code: "provider_command_failed",
        stage: "worker_delete",
        message: "Worker delete failed; provider diagnostics were withheld from lifecycle evidence",
        mutationStarted: true,
        diagnosticDigest: digest(`${label}\nstatus=${response.status}`),
      });
    },
    async readVector(indexName) {
      const label = "Vectorize readback";
      const url = new URL(
        `https://api.cloudflare.com/client/v4/accounts/${input.accountId}/vectorize/v2/indexes/${encodeURIComponent(indexName)}`,
      );
      let response: Response;
      try {
        response = await providerFetch(url, {
          headers: {
            authorization: `Bearer ${input.apiToken}`,
            accept: "application/json",
          },
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        throw new MaterializerError({
          code: "readback_failed",
          stage: "readback",
          message: "Vectorize presence readback failed",
          diagnosticDigest: digest(`${label}\ntransport`),
        });
      }
      // Vectorize returns 410 after an index deletion has completed. Treat the
      // provider's terminal Gone response like 404 so a fresh destroy plan can
      // safely resume after a prior lifecycle action removed the index but was
      // interrupted before OpenTofu destroyed the backing resources.
      if (response.status === 404 || response.status === 410) return undefined;
      if (response.status !== 200 || !response.body) {
        throw new MaterializerError({
          code: "readback_failed",
          stage: "readback",
          message: "Vectorize readback was ambiguous",
          diagnosticDigest: digest(`${label}\nstatus=${response.status}`),
        });
      }
      const bytes = await readStreamBounded(
        response.body,
        64 * 1024,
        "Vectorize readback response",
        "readback_failed",
      );
      let value: unknown;
      try {
        value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
      } catch {
        throw new MaterializerError({
          code: "invalid_readback",
          stage: "readback",
          message: "Vectorize readback returned invalid JSON",
          diagnosticDigest: digest(`${label}\ninvalid-json`),
        });
      }
      invariant(
        value !== null && typeof value === "object" && !Array.isArray(value),
        "Vectorize readback envelope must be an object",
        "invalid_readback",
      );
      const envelope = value as JsonRecord;
      invariant(
        envelope.success !== false,
        "Vectorize readback API rejected the request",
        "readback_failed",
      );
      return envelope.result;
    },
    async listR2Objects(bucketName) {
      const label = "R2 object list readback";
      const url = new URL(
        `https://api.cloudflare.com/client/v4/accounts/${input.accountId}/r2/buckets/${encodeURIComponent(bucketName)}/objects`,
      );
      url.searchParams.set("per_page", "1000");
      let response: Response;
      try {
        response = await providerFetch(url, {
          headers: {
            authorization: `Bearer ${input.apiToken}`,
            accept: "application/json",
          },
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        throw new MaterializerError({
          code: "readback_failed",
          stage: "r2_object_readback",
          message: "R2 object list readback failed",
          diagnosticDigest: digest(`${label}\ntransport`),
        });
      }
      if (response.status === 404) return [];
      if (response.status !== 200 || !response.body) {
        throw new MaterializerError({
          code: "readback_failed",
          stage: "r2_object_readback",
          message: "R2 object list readback was ambiguous",
          diagnosticDigest: digest(`${label}\nstatus=${response.status}`),
        });
      }
      const bytes = await readStreamBounded(
        response.body,
        4 * 1024 * 1024,
        label,
        "readback_failed",
      );
      let value: unknown;
      try {
        value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
      } catch {
        throw new MaterializerError({
          code: "invalid_readback",
          stage: "r2_object_readback",
          message: "R2 object list returned invalid JSON",
          diagnosticDigest: digest(`${label}\ninvalid-json`),
        });
      }
      const envelope = record(value, "R2 object list envelope");
      invariant(
        envelope.success !== false && Array.isArray(envelope.result),
        "R2 object list API rejected the request",
        "readback_failed",
      );
      invariant(
        envelope.result.length <= 1000,
        "R2 object list exceeded the requested page bound",
        "invalid_readback",
      );
      const keys = envelope.result.map((entry, index) =>
        requiredString(
          record(entry, `R2 object[${index}]`).key,
          `R2 object[${index}].key`,
        ),
      );
      invariant(
        new Set(keys).size === keys.length,
        "R2 object list contains duplicate keys",
        "invalid_readback",
      );
      return keys;
    },
    async deleteR2Object(bucketName, objectKey) {
      const label = "R2 object delete";
      const url = new URL(
        `https://api.cloudflare.com/client/v4/accounts/${input.accountId}/r2/buckets/${encodeURIComponent(bucketName)}/objects/${encodeURIComponent(objectKey)}`,
      );
      let response: Response;
      try {
        response = await providerFetch(url, {
          method: "DELETE",
          headers: {
            authorization: `Bearer ${input.apiToken}`,
            accept: "application/json",
          },
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        throw new MaterializerError({
          code: "provider_command_failed",
          stage: "r2_object_delete",
          message:
            "R2 object delete failed; provider diagnostics were withheld from lifecycle evidence",
          mutationStarted: true,
          diagnosticDigest: digest(`${label}\ntransport`),
        });
      }
      if (response.ok || response.status === 404) {
        await response.body?.cancel().catch(() => undefined);
        return;
      }
      await response.body?.cancel().catch(() => undefined);
      throw new MaterializerError({
        code: "provider_command_failed",
        stage: "r2_object_delete",
        message:
          "R2 object delete failed; provider diagnostics were withheld from lifecycle evidence",
        mutationStarted: true,
        diagnosticDigest: digest(`${label}\nstatus=${response.status}`),
      });
    },
    async fetchBytes(url, maxBytes) {
      let lastFailure = "transport";
      for (
        let attempt = 1;
        attempt <= ARTIFACT_DOWNLOAD_ATTEMPTS;
        attempt += 1
      ) {
        try {
          const response = await providerFetch(url, {
            redirect: "follow",
            headers: { accept: "application/octet-stream" },
            signal: AbortSignal.timeout(60_000),
          });
          if (!response.ok) {
            lastFailure = `status=${response.status}`;
            if (
              attempt === ARTIFACT_DOWNLOAD_ATTEMPTS ||
              !artifactDownloadStatusIsRetryable(response.status)
            ) {
              throw artifactDownloadFailure(lastFailure);
            }
            await response.body?.cancel().catch(() => undefined);
          } else {
            const declaredLength = Number(
              response.headers.get("content-length") ?? "0",
            );
            invariant(
              !declaredLength || declaredLength <= maxBytes,
              "artifact download is too large",
              "artifact_download_failed",
            );
            invariant(
              response.body,
              "artifact download returned no body",
              "artifact_download_failed",
            );
            try {
              const bytes = await readStreamBounded(
                response.body,
                maxBytes,
                "artifact download",
                "artifact_download_failed",
              );
              invariant(
                bytes.byteLength > 0 && bytes.byteLength <= maxBytes,
                "artifact download size is invalid",
                "artifact_download_failed",
              );
              return bytes;
            } catch (error) {
              if (error instanceof MaterializerError) throw error;
              lastFailure = "stream";
              if (attempt === ARTIFACT_DOWNLOAD_ATTEMPTS) {
                throw artifactDownloadFailure(lastFailure);
              }
            }
          }
        } catch (error) {
          if (error instanceof MaterializerError) throw error;
          lastFailure = "transport";
          if (attempt === ARTIFACT_DOWNLOAD_ATTEMPTS) {
            throw artifactDownloadFailure(lastFailure);
          }
        }
        await new Promise((resolveRetry) =>
          setTimeout(
            resolveRetry,
            ARTIFACT_DOWNLOAD_RETRY_DELAY_MS * attempt,
          )
        );
      }
      throw artifactDownloadFailure(lastFailure);
    },
    async fetchHealth(url) {
      const response = await providerFetch(url, {
        redirect: "error",
        headers: { "cache-control": "no-cache" },
        signal: AbortSignal.timeout(10_000),
      });
      invariant(response.body, "health response returned no body", "health_check_failed");
      const bytes = await readStreamBounded(
        response.body,
        64 * 1024,
        "health response",
        "health_check_failed",
      );
      return { status: response.status, bytes };
    },
    sleep: (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
    now: () => new Date().toISOString(),
  };
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  await chmod(path, 0o600);
}

export async function materializePostApply(input: {
  invocation: Invocation;
  sourceRoot: string;
  dependencies: MaterializerDependencies;
}): Promise<ReturnType<typeof materializerEvidence>> {
  const { invocation, sourceRoot, dependencies } = input;
  invariant(invocation.phase === "post_apply", "post_apply invocation is required");
  const takosumiCompositionSource =
    await readTakosumiCompositionSourceIdentity(sourceRoot);
  const descriptorBytes = await dependencies.fetchBytes(invocation.descriptorUrl!, MAX_DESCRIPTOR_BYTES);
  invariant(digest(descriptorBytes) === invocation.descriptorDigest, "release artifact descriptor digest mismatch", "artifact_digest_mismatch");
  let descriptorValue: unknown;
  try {
    descriptorValue = JSON.parse(new TextDecoder().decode(descriptorBytes)) as unknown;
  } catch {
    throw new MaterializerError({
      code: "invalid_artifact_descriptor",
      stage: "artifact",
      message: "release artifact descriptor is invalid JSON",
    });
  }
  const descriptor = validateReleaseDescriptor(descriptorValue, {
    sourceCommit: invocation.sourceCommit,
    packageVersion: await readPackageVersion(sourceRoot),
    accountId: invocation.outputs.accountId,
    descriptorUrl: invocation.descriptorUrl!,
    takosumiCompositionSource,
  });
  const archiveBytes = await dependencies.fetchBytes(descriptor.artifact.url, MAX_ARCHIVE_BYTES);
  invariant(archiveBytes.byteLength === descriptor.artifact.size, "Worker archive size mismatch", "artifact_digest_mismatch");
  invariant(digest(archiveBytes) === descriptor.artifact.sha256Prefixed, "Worker archive digest mismatch", "artifact_digest_mismatch");
  const archiveEntries = await parseWorkerArchive(archiveBytes);
  const secrets = await loadRuntimeSecretsFile(invocation.runtimeSecretsFile!);

  const tempRoot = await mkdtemp(join(tmpdir(), "takos-product-materializer-"));
  const artifactRoot = join(tempRoot, "artifact");
  const configPath = join(tempRoot, "wrangler.json");
  const deploySecretsPath = join(tempRoot, "deploy-secrets.json");
  const reconcileSecretsPath = join(tempRoot, "reconcile-secrets.json");
  const dryRunOut = join(tempRoot, "dry-run");
  const completedStages: string[] = [];
  try {
    await mkdir(artifactRoot, { mode: 0o700 });
    await extractWorkerArchive(archiveEntries, artifactRoot);
    const config = renderWranglerConfig({
      outputs: invocation.outputs,
      descriptor,
      artifactRoot,
      sourceRoot,
    });
    const configDigest = digestJson(config);
    await writePrivateJson(configPath, config);
    await writePrivateJson(deploySecretsPath, secrets);

    await requireCommand(
      dependencies,
      [
        "deploy",
        "--dry-run",
        "--no-bundle",
        "--containers-rollout",
        "none",
        "--outdir",
        dryRunOut,
        "--config",
        configPath,
      ],
      "wrangler_dry_run",
      completedStages,
    );
    const previous = await deploymentReadback(
      dependencies,
      configPath,
      invocation.outputs.workerName,
    );
    let previousVersion: JsonRecord | undefined;
    if (previous) {
      previousVersion = await verifyExistingWorkerOwnership(
        dependencies,
        configPath,
        invocation.outputs,
        previous,
      );
    }
    const existingSecrets = await secretNames(
      dependencies,
      configPath,
      invocation.outputs.workerName,
    );
    const existingContainers = await containerList(dependencies, configPath);
    assertNoRetiredRuntimeContainer(existingContainers, invocation.outputs.workerName);
    const expectedNames = new Set(Object.keys(expectedContainerShape(invocation.outputs, descriptor)));
    const existingOwnedContainers = existingContainers.filter((item) =>
      expectedNames.has(item.name),
    );
    if (existingOwnedContainers.length > 0) {
      invariant(
        previousVersion,
        "container application ownership cannot be proved without the owned Worker",
        "resource_conflict",
      );
      await verifyContainerOwnership({
        dependencies,
        configPath,
        outputs: invocation.outputs,
        containers: existingOwnedContainers,
        workerVersion: previousVersion,
      });
    }
    const queueBefore = await queueReadbacks(dependencies, configPath, invocation.outputs);
    validateQueueOwnership(queueBefore, invocation.outputs, false, false);
    const existingVector = await vectorReadback(
      dependencies,
      invocation.outputs.vector,
    );
    const existingQueueConsumerCount = [...queueBefore.values()].reduce(
      (count, consumers) =>
        count +
        consumers.filter((consumer) =>
          isWorkerConsumer(consumer, invocation.outputs.workerName),
        ).length,
      0,
    );
    if (existingVector || existingQueueConsumerCount > 0) {
      invariant(
        previousVersion,
        "queue or Vectorize ownership cannot be proved without the owned Worker",
        "resource_conflict",
      );
      verifyQueueAndVectorOwnership(previousVersion, invocation.outputs);
    }

    const desiredNames = new Set(Object.keys(secrets));
    const staleSecrets = existingSecrets.filter((name) => !desiredNames.has(name));
    if (staleSecrets.length > 0) {
      await writePrivateJson(
        reconcileSecretsPath,
        Object.fromEntries(staleSecrets.map((name) => [name, null])),
      );
    }

    if (!existingVector) {
      await requireMutationCommand(
        dependencies,
        [
          "vectorize",
          "create",
          invocation.outputs.vector.name,
          "--dimensions",
          String(invocation.outputs.vector.dimensions),
          "--metric",
          invocation.outputs.vector.metric,
          "--json",
          "--config",
          configPath,
        ],
        "vector_create",
        completedStages,
      );
      completedStages.push("vector_created");
      await waitForVector(dependencies, invocation.outputs.vector);
    }

    await requireMutationCommand(
      dependencies,
      ["d1", "migrations", "apply", "DB", "--remote", "--config", configPath],
      "d1_migrations",
      completedStages,
      { timeoutMs: 30 * 60 * 1000 },
    );
    completedStages.push("d1_migrations_applied");

    const activationMessage =
      `takos-product-materializer/v1 source=${invocation.sourceCommit} ` +
      `archive=${descriptor.artifact.sha256Prefixed} config=${configDigest}`;
    await requireMutationCommand(
      dependencies,
      [
        "deploy",
        "--no-bundle",
        "--strict",
        "--containers-rollout",
        "immediate",
        "--secrets-file",
        deploySecretsPath,
        "--tag",
        descriptor.releaseTag,
        "--message",
        activationMessage,
        "--config",
        configPath,
      ],
      "worker_deploy",
      completedStages,
      { timeoutMs: 30 * 60 * 1000 },
    );
    const deployment = await waitForActivatedDeployment(
      dependencies,
      configPath,
      invocation.outputs.workerName,
      activationMessage,
      descriptor.releaseTag,
    );
    completedStages.push("worker_deployed");

    // Keep secrets required by the currently serving version until the new
    // Worker version has been accepted. Pruning earlier can break the previous
    // healthy deployment if a migration or deploy fails.
    if (staleSecrets.length > 0) {
      await requireMutationCommand(
        dependencies,
        [
          "secret",
          "bulk",
          reconcileSecretsPath,
          "--name",
          invocation.outputs.workerName,
          "--config",
          configPath,
        ],
        "stale_secret_prune",
        completedStages,
      );
      completedStages.push("stale_runtime_secrets_pruned");
    }

    await reconcileQueueConsumers(
      dependencies,
      configPath,
      invocation.outputs,
      completedStages,
    );
    completedStages.push("queue_consumers_reconciled");

    await waitForSecretNames(
      dependencies,
      configPath,
      invocation.outputs.workerName,
      [...desiredNames],
    );
    await verifyContainersEventually(
      dependencies,
      configPath,
      invocation.outputs,
      descriptor,
    );
    await verifyQueueConsumersEventually(
      dependencies,
      configPath,
      invocation.outputs,
    );
    await vectorReadback(dependencies, invocation.outputs.vector);
    const health = await verifyHealth(dependencies, invocation.outputs.publicUrl);

    return materializerEvidence({
      invocation,
      descriptor,
      descriptorDigest: invocation.descriptorDigest!,
      configDigest,
      deployment,
      previous,
      health,
      verifiedAt: dependencies.now(),
    });
  } catch (error) {
    if (error instanceof MaterializerError) {
      throw new MaterializerError({
        code: error.code,
        stage: error.stage,
        message: error.message,
        mutationStarted: error.mutationStarted || completedStages.length > 0,
        completedStages: completedStages.length ? completedStages : error.completedStages,
        diagnosticDigest: error.diagnosticDigest,
      });
    }
    throw new MaterializerError({
      code: "unexpected_failure",
      stage: "materialization",
      message: "unexpected materializer failure; details remain runner-private",
      mutationStarted: completedStages.length > 0,
      completedStages,
      diagnosticDigest: digest(
        error instanceof Error ? error.message : String(error),
      ),
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function waitForChildCleanupAbsence(input: {
  dependencies: MaterializerDependencies;
  configPath: string;
  outputs: TakosOutputs;
  ownedContainerNames: ReadonlySet<string>;
  mutationStarted: boolean;
}): Promise<void> {
  const {
    dependencies,
    configPath,
    outputs,
    ownedContainerNames,
    mutationStarted,
  } = input;
  let lastError: unknown;
  const maxAttempts = 100;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const queues = await queueReadbacks(dependencies, configPath, outputs, {
        allowAbsent: true,
      });
      for (const consumers of queues.values()) {
        invariant(
          !consumers.some((consumer) =>
            isWorkerConsumer(consumer, outputs.workerName),
          ),
          "Takos queue consumer still exists after pre_destroy cleanup",
          "invalid_readback",
        );
      }
      const containers = await containerList(dependencies, configPath);
      assertNoRetiredRuntimeContainer(containers, outputs.workerName);
      invariant(
        !containers.some((item) => ownedContainerNames.has(item.name)),
        "Takos container application still exists after pre_destroy cleanup",
        "invalid_readback",
      );
      invariant(
        !(await vectorReadback(dependencies, outputs.vector)),
        "Vectorize index still exists after pre_destroy cleanup",
        "invalid_readback",
      );
      return;
    } catch (error) {
      lastError = error;
      if (attempt + 1 < maxAttempts) await dependencies.sleep(3_000);
    }
  }
  throw new MaterializerError({
    code: "invalid_readback",
    stage: "readback",
    message: "Takos-owned child resources did not converge to absent",
    mutationStarted,
    diagnosticDigest:
      lastError instanceof MaterializerError
        ? lastError.diagnosticDigest
        : digest(lastError instanceof Error ? lastError.message : String(lastError)),
  });
}

async function waitForWorkerAbsence(
  dependencies: MaterializerDependencies,
  workerName: string,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      if (!(await dependencies.readWorkerPresence(workerName))) {
        return;
      }
      lastError = new MaterializerError({
        code: "invalid_readback",
        stage: "readback",
        message: "Worker still exists after pre_destroy cleanup",
        mutationStarted: true,
      });
    } catch (error) {
      lastError = error;
    }
    if (attempt < 11) await dependencies.sleep(3_000);
  }
  throw new MaterializerError({
    code: "invalid_readback",
    stage: "readback",
    message: "Worker did not converge to absent",
    mutationStarted: true,
    diagnosticDigest:
      lastError instanceof MaterializerError
        ? lastError.diagnosticDigest
        : digest(lastError instanceof Error ? lastError.message : String(lastError)),
  });
}

const R2_OBJECT_DELETE_CONCURRENCY = 16;

async function purgeR2BackingObjects(input: {
  readonly dependencies: MaterializerDependencies;
  readonly outputs: TakosOutputs;
  readonly completedStages: string[];
}): Promise<number> {
  let removed = 0;
  for (const bucketName of Object.values(input.outputs.buckets)) {
    for (;;) {
      const keys = await input.dependencies.listR2Objects(bucketName);
      if (keys.length === 0) break;
      for (
        let offset = 0;
        offset < keys.length;
        offset += R2_OBJECT_DELETE_CONCURRENCY
      ) {
        await Promise.all(
          keys
            .slice(offset, offset + R2_OBJECT_DELETE_CONCURRENCY)
            .map((key) => input.dependencies.deleteR2Object(bucketName, key)),
        );
      }
      removed += keys.length;
    }
  }
  if (removed > 0) input.completedStages.push("r2_objects_deleted");
  return removed;
}

export async function materializePreDestroy(input: {
  invocation: Invocation;
  sourceRoot: string;
  dependencies: MaterializerDependencies;
}): Promise<JsonRecord> {
  const { invocation, sourceRoot, dependencies } = input;
  invariant(invocation.phase === "pre_destroy", "pre_destroy invocation is required");
  const tempRoot = await mkdtemp(join(tmpdir(), "takos-product-pre-destroy-"));
  const configPath = join(tempRoot, "wrangler.json");
  const completedStages: string[] = [];
  try {
    const minimalConfig = {
      name: invocation.outputs.workerName,
      account_id: invocation.outputs.accountId,
      d1_databases: [
        {
          binding: "DB",
          database_id: invocation.outputs.d1DatabaseId,
          migrations_dir: join(sourceRoot, "db", "migrations-control", "migrations"),
        },
      ],
    };
    await writePrivateJson(configPath, minimalConfig);
    const previous = await deploymentReadback(
      dependencies,
      configPath,
      invocation.outputs.workerName,
    );
    let previousVersion: JsonRecord | undefined;
    if (previous) {
      previousVersion = await verifyExistingWorkerOwnership(
        dependencies,
        configPath,
        invocation.outputs,
        previous,
      );
    }
    const queues = await queueReadbacks(
      dependencies,
      configPath,
      invocation.outputs,
      { allowAbsent: true },
    );
    validateQueueOwnership(queues, invocation.outputs, false, false);
    const containers = await containerList(dependencies, configPath);
    assertNoRetiredRuntimeContainer(containers, invocation.outputs.workerName);
    const ownedNames = new Set<string>(
      Object.values(containerNames(invocation.outputs.workerName)),
    );
    const ownedContainers = containers.filter((item) => ownedNames.has(item.name));
    const vector = await vectorReadback(
      dependencies,
      invocation.outputs.vector,
    );
    const ownedQueueConsumerCount = [...queues.values()].reduce(
      (count, consumers) =>
        count +
        consumers.filter((consumer) =>
          isWorkerConsumer(consumer, invocation.outputs.workerName),
        ).length,
      0,
    );
    const hasOwnedChildren =
      ownedQueueConsumerCount > 0 ||
      ownedContainers.length > 0 ||
      Boolean(vector);
    invariant(
      previous || !hasOwnedChildren,
      "child resource ownership cannot be proved without the owned Worker",
      "resource_conflict",
    );
    if (ownedContainers.length > 0) {
      invariant(
        previousVersion,
        "container application ownership cannot be proved without the owned Worker version",
        "resource_conflict",
      );
      await verifyContainerOwnership({
        dependencies,
        configPath,
        outputs: invocation.outputs,
        containers: ownedContainers,
        workerVersion: previousVersion,
      });
    }
    if (vector || ownedQueueConsumerCount > 0) {
      invariant(
        previousVersion,
        "queue or Vectorize ownership cannot be proved without the owned Worker version",
        "resource_conflict",
      );
      verifyQueueAndVectorOwnership(previousVersion, invocation.outputs);
    }

    for (const [queue, consumers] of queues) {
      if (!consumers.some((consumer) => isWorkerConsumer(consumer, invocation.outputs.workerName))) continue;
      await requireMutationCommand(
        dependencies,
        [
          "queues",
          "consumer",
          "remove",
          queue,
          invocation.outputs.workerName,
          "--config",
          configPath,
        ],
        "queue_consumer_delete",
        completedStages,
        { allowAlreadyAbsent: true },
      );
    }
    if (ownedQueueConsumerCount > 0) {
      completedStages.push("queue_consumers_deleted");
    }

    for (const container of ownedContainers) {
      await requireMutationCommand(
        dependencies,
        ["containers", "delete", container.id, "--config", configPath],
        "container_delete",
        completedStages,
        { allowAlreadyAbsent: true },
      );
    }
    if (ownedContainers.length > 0) completedStages.push("containers_deleted");

    // Keep the Worker provenance marker available as the ownership anchor until
    // every other materializer-owned child has been removed.
    if (vector) {
      await requireMutationCommand(
        dependencies,
        ["vectorize", "delete", invocation.outputs.vector.name, "-y", "--config", configPath],
        "vector_delete",
        completedStages,
        { allowAlreadyAbsent: true },
      );
      completedStages.push("vector_deleted");
    }

    await waitForChildCleanupAbsence({
      dependencies,
      configPath,
      outputs: invocation.outputs,
      ownedContainerNames: ownedNames,
      mutationStarted: hasOwnedChildren,
    });

    if (previous) {
      await dependencies.deleteWorker(invocation.outputs.workerName);
      completedStages.push("worker_deleted");
      await waitForWorkerAbsence(dependencies, invocation.outputs.workerName);
    }
    const r2ObjectsRemoved = await purgeR2BackingObjects({
      dependencies,
      outputs: invocation.outputs,
      completedStages,
    });
    return {
      kind: "takos.product-materialization@v1",
      status: "succeeded",
      phase: "pre_destroy",
      sourceCommitDigest: digest(invocation.sourceCommit),
      sourceSnapshotDigest: digest(invocation.sourceSnapshotId),
      releaseRunDigest: digest(invocation.releaseRunId),
      target: {
        workerNameDigest: digest(invocation.outputs.workerName),
        accountDigest: digest(invocation.outputs.accountId),
        previousDeploymentIdDigest: previous
          ? digest(previous.deploymentId)
          : null,
        previousVersionIdDigest: previous ? digest(previous.versionId) : null,
      },
      cleanup: {
        workerRemoved: previous ? 1 : 0,
        queueConsumersRemoved: ownedQueueConsumerCount,
        containersRemoved: ownedContainers.length,
        vectorIndexesRemoved: vector ? 1 : 0,
        r2ObjectsRemoved,
        backingResources: "left_for_opentofu_destroy",
      },
      verifiedAt: dependencies.now(),
    };
  } catch (error) {
    if (error instanceof MaterializerError) {
      throw new MaterializerError({
        code: error.code,
        stage: error.stage,
        message: error.message,
        mutationStarted: error.mutationStarted || completedStages.length > 0,
        completedStages: completedStages.length ? completedStages : error.completedStages,
        diagnosticDigest: error.diagnosticDigest,
      });
    }
    throw new MaterializerError({
      code: "unexpected_failure",
      stage: "materialization",
      message: "unexpected pre_destroy failure; details remain runner-private",
      mutationStarted: completedStages.length > 0,
      completedStages,
      diagnosticDigest: digest(
        error instanceof Error ? error.message : String(error),
      ),
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export function failureEvidence(error: unknown, phase: Phase): JsonRecord {
  if (error instanceof MaterializerError) {
    return {
      kind: "takos.product-materialization@v1",
      status: "failed",
      phase,
      code: error.code,
      stage: error.stage,
      mutationStarted: error.mutationStarted,
      completedStages: error.completedStages,
      ...(error.diagnosticDigest ? { diagnosticDigest: error.diagnosticDigest } : {}),
      recovery: error.mutationStarted
        ? "Do not retry from stale action input. Read authoritative Cloudflare state and create a fresh Takosumi plan; prefer forward repair after D1 migration."
        : "Correct the Plan-pinned inputs or credential manifest, then create a fresh Takosumi plan.",
    };
  }
  return {
    kind: "takos.product-materialization@v1",
    status: "failed",
    phase,
    code: "unexpected_failure",
    stage: "unknown",
    mutationStarted: false,
    recovery: "Inspect runner-private diagnostics and create a fresh Takosumi plan before retrying.",
  };
}

function parsePhase(args: readonly string[]): Phase {
  invariant(args.length === 1, "usage: takos-product-materializer.ts <post_apply|pre_destroy>");
  invariant(args[0] === "post_apply" || args[0] === "pre_destroy", "materializer phase is invalid");
  return args[0];
}

export async function main(args = Bun.argv.slice(2), env = process.env): Promise<number> {
  let phase: Phase = "post_apply";
  try {
    phase = parsePhase(args);
    const invocation = parseInvocation(phase, env);
    const sourceRoot = resolve(import.meta.dir, "..");
    await ensureCompatibleNodeRuntime();
    const wranglerBin = await ensureLockedWrangler(sourceRoot);
    const dependencies = createDependencies({
      nodeBin: NODE_EXECUTABLE,
      wranglerBin,
      sourceRoot,
      apiToken: invocation.apiToken,
      accountId: invocation.outputs.accountId,
    });
    const version = await dependencies.runWrangler(["--version"]);
    invariant(
      version.exitCode === 0 && version.stdout.trim().includes(WRANGLER_VERSION),
      `Wrangler runtime must report ${WRANGLER_VERSION}`,
      "wrangler_runtime_unavailable",
    );
    const evidence =
      phase === "post_apply"
        ? await materializePostApply({ invocation, sourceRoot, dependencies })
        : await materializePreDestroy({ invocation, sourceRoot, dependencies });
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${JSON.stringify(failureEvidence(error, phase))}\n`);
    return 1;
  }
}

if (import.meta.main) {
  process.exit(await main());
}
