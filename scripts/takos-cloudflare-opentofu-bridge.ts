#!/usr/bin/env bun

/**
 * Product-owned reconciler for the Cloudflare provider gaps that cannot
 * be represented by the ordinary OpenTofu provider yet:
 *
 *   - Vectorize index creation/readback;
 *   - legacy Workers-script upload for container-enabled Durable Object
 *     migrations (the Versions endpoint does not currently enable them);
 *   - Container application image/capacity and Durable Object ownership;
 *   - D1 migrations.
 *
 * The bridge is opt-in and mode-gated.  A staging run may use the bridge for
 * smoke inputs only when the deployment environment is exactly `staging`; a
 * disposable production run requires the exact `production` environment and
 * reviewed acknowledgement exported below.  Ordinary production applies
 * keep this helper disabled.
 *
 * The file is intentionally standalone.  The source-build command copies it
 * into deploy/opentofu/cloudflare/.takos-build, where a generic runner can
 * execute it with Bun and without the repository's node_modules or Takosumi
 * code.
 */

import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
  readdir,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const MAXIMUM_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAXIMUM_MIGRATION_BYTES = 256 * 1024 * 1024;
const D1_LEDGER_TABLE = "_takos_opentofu_migrations";
const D1_IMPORT_POLL_LIMIT = 600;
const DEFAULT_D1_IMPORT_POLL_DELAY_MS = 250;
// Containers capability can become visible before its application inventory
// is ready. Seven exact GET attempts at five-second intervals give that
// control-plane transition a conservative 30-second readiness window without
// ever retrying a mutation or treating the transient response as absence.
const CONTAINERS_READINESS_RETRY_ATTEMPTS = 7;
const CONTAINERS_READINESS_RETRY_DELAY_MS = 5_000;

export const CLOUDFLARE_PROVIDER_GAP_BRIDGE_ACKNOWLEDGEMENT =
  "DISPOSABLE_PRODUCTION_ONE_SHOT";

export const CLOUDFLARE_PROVIDER_GAP_BRIDGE_MODES = [
  "off",
  "staging",
  "disposable-production",
] as const;

export type CloudflareProviderGapBridgeMode =
  (typeof CLOUDFLARE_PROVIDER_GAP_BRIDGE_MODES)[number];

export type CloudflareProviderGapBridgeEnvironment = "production" | "staging";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = { readonly [key: string]: JsonValue | undefined };

export type BridgePhase =
  | "capability-preflight"
  | "pre-worker"
  | "post-worker"
  | "verify"
  | "recovery-cleanup";

export interface BridgeFetchOptions {
  readonly env?: Record<string, string | undefined>;
  readonly cwd?: string;
  readonly fetchImpl?: typeof fetch;
  readonly importPollDelayMs?: number;
  readonly importPollLimit?: number;
  readonly containersReadinessRetryAttempts?: number;
  readonly containersReadinessRetryDelayMs?: number;
  readonly containersReadinessDelay?: (delayMs: number) => Promise<void>;
  readonly helperPath?: string;
}

export interface BridgeDigests {
  readonly desiredDigest: string;
  readonly bridgeActivationDigest: string;
  readonly durableObjectBootstrapDigest?: string;
  readonly helperDigest: string;
  readonly migrationDigest: string;
  readonly workerArtifactDigest: string;
}

export interface BridgeEvidence {
  readonly ok: true;
  readonly phase: BridgePhase;
  readonly bridgeMode: CloudflareProviderGapBridgeMode;
  readonly bridgeEnvironment: CloudflareProviderGapBridgeEnvironment;
  readonly digests: BridgeDigests;
  readonly changed: boolean;
  readonly durableObjects: {
    readonly status: "present" | "migrated" | "not-checked";
    readonly tag?: string;
  };
  readonly vector: { readonly status: "present" | "created" | "deleted" };
  readonly d1: { readonly applied: readonly string[]; readonly pending: readonly string[] };
  readonly containers: {
    readonly reconciled: readonly string[];
    readonly deleted: readonly string[];
  };
  readonly workerVersion?: string;
}

class BridgeFailure extends Error {
  readonly code: string;
  readonly detail?: string;

  constructor(
    code: string,
    detail?: string,
  ) {
    super(code);
    this.name = "BridgeFailure";
    this.code = code;
    this.detail = detail;
  }
}

function fail(code: string, detail?: string): never {
  throw new BridgeFailure(code, detail);
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label}_invalid`);
  }
  return value.trim();
}

function integerValue(value: unknown, label: string, minimum = 1): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) fail(`${label}_invalid`);
  return number;
}

function jsonValue(value: unknown, label: string): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => jsonValue(entry, label));
  if (plainObject(value)) {
    const output: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) output[key] = jsonValue(entry, label);
    }
    return output;
  }
  fail(`${label}_invalid`);
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => {
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) return nested;
    return Object.fromEntries(
      Object.entries(nested as Record<string, unknown>).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
    );
  });
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function digest(value: unknown): string {
  return `sha256:${sha256(new TextEncoder().encode(stableJson(value)))}`;
}

function md5(bytes: Uint8Array): string {
  return createHash("md5").update(bytes).digest("hex");
}

function envValue(
  env: Record<string, string | undefined>,
  names: readonly string[],
  required: boolean,
): string | undefined {
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(env, name)) continue;
    const value = env[name];
    if (value !== undefined && value.trim() !== "") return value.trim();
  }
  if (required) fail("bridge_input_missing", names[0]);
  return undefined;
}

function pathInput(
  cwd: string,
  value: string | undefined,
  label: string,
  required: boolean,
): string | undefined {
  if (value === undefined) {
    if (required) fail(`${label}_missing`);
    return undefined;
  }
  if (value.includes("\\") || value.includes("\0")) {
    fail(`${label}_invalid`);
  }
  const segments = value.split("/");
  const pathSegments = isAbsolute(value) ? segments.slice(1) : segments;
  if (pathSegments.some((segment) => segment === ".." || segment === "")) {
    fail(`${label}_invalid`);
  }
  if (!isAbsolute(value) && segments.length === 1 && segments[0] === ".") {
    fail(`${label}_invalid`);
  }
  const output = isAbsolute(value) ? resolve(value) : resolve(cwd, value);
  const prefix = `${resolve(cwd)}${sep}`;
  if (!output.startsWith(prefix)) fail(`${label}_invalid`);
  return output;
}

function phaseValue(value: string | undefined): BridgePhase {
  switch (value?.trim().toLowerCase()) {
    case "capability":
    case "capability-preflight":
    case "capability_preflight":
    case "preflight":
      return "capability-preflight";
    case "pre":
    case "pre-worker":
    case "pre_apply":
    case "pre-apply":
      return "pre-worker";
    case "post":
    case "post-worker":
    case "post_apply":
    case "post-apply":
      return "post-worker";
    case "verify":
    case "readback":
    case "authoritative-readback":
      return "verify";
    case "cleanup":
    case "recovery-cleanup":
    case "recovery_cleanup":
      return "recovery-cleanup";
    default:
      fail("bridge_phase_invalid");
  }
}

function bridgeModeValue(value: string | undefined): CloudflareProviderGapBridgeMode {
  switch (value) {
    case "off":
    case "staging":
    case "disposable-production":
      return value;
    case undefined:
    case "":
      fail("bridge_mode_missing");
    default:
      fail("bridge_mode_invalid");
  }
}

function bridgeEnvironmentValue(value: string | undefined): CloudflareProviderGapBridgeEnvironment {
  switch (value) {
    case "production":
    case "staging":
      return value;
    case undefined:
    case "":
      fail("bridge_environment_missing");
    default:
      fail("bridge_environment_invalid");
  }
}

function rawEnvironmentValue(
  env: Record<string, string | undefined>,
  name: string,
): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(env, name)) return undefined;
  return env[name];
}

export function validateCloudflareProviderGapBridgeActivation(
  modeValue: string | undefined,
  acknowledgementValue: string | undefined,
  environmentValue: string | undefined = undefined,
): {
  readonly mode: CloudflareProviderGapBridgeMode;
  readonly environment?: CloudflareProviderGapBridgeEnvironment;
  readonly acknowledgementDigest: string;
} {
  const mode = bridgeModeValue(modeValue);
  const acknowledgement = acknowledgementValue ?? "";
  if (mode === "off") {
    if (acknowledgement !== "") fail("bridge_acknowledgement_unexpected");
    return {
      mode,
      acknowledgementDigest: `sha256:${sha256(new TextEncoder().encode(acknowledgement))}`,
    };
  }
  const environment = bridgeEnvironmentValue(environmentValue);
  if (mode === "staging" && environment !== "staging") {
    fail("bridge_environment_mismatch");
  }
  if (mode === "disposable-production" && environment !== "production") {
    fail("bridge_environment_mismatch");
  }
  if (
    mode === "disposable-production" &&
    acknowledgement !== CLOUDFLARE_PROVIDER_GAP_BRIDGE_ACKNOWLEDGEMENT
  ) {
    fail(
      acknowledgement === ""
        ? "bridge_acknowledgement_required"
        : "bridge_acknowledgement_invalid",
    );
  }
  if (mode !== "disposable-production" && acknowledgement !== "") {
    fail("bridge_acknowledgement_unexpected");
  }
  return {
    mode,
    environment,
    acknowledgementDigest: `sha256:${sha256(new TextEncoder().encode(acknowledgement))}`,
  };
}

function imageReference(value: unknown, accountId?: string): string {
  const image = stringValue(value, "container_image");
  const repository = "[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?(?:\\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)*";
  const dockerHub = new RegExp(`^docker\\.io\\/${repository}@sha256:[a-f0-9]{64}$`, "u");
  const cloudflareRegistry = new RegExp(
    `^registry\\.cloudflare\\.com\\/([a-f0-9]{32})\\/${repository}@sha256:[a-f0-9]{64}$`,
    "u",
  );
  if (/^ghcr\.io\//u.test(image)) fail("container_image_ghcr_unsupported");
  if (dockerHub.test(image)) return image;
  const match = image.match(cloudflareRegistry);
  if (match) {
    if (accountId === undefined || match[1] !== accountId) {
      fail("container_image_account_mismatch");
    }
    return image;
  }
  fail("container_image_must_be_supported_immutable_digest");
}

type ContainerCapacity =
  | "lite"
  | "basic"
  | {
    readonly vcpu: number;
    readonly memory_mib: number;
    readonly disk_mb: number;
  };

const NAMED_CONTAINER_CAPACITIES = {
  lite: { vcpu: 0.0625, memory_mib: 256, disk_mb: 2000 },
  basic: { vcpu: 0.25, memory_mib: 1024, disk_mb: 4000 },
} as const satisfies Record<Extract<ContainerCapacity, string>, {
  readonly vcpu: number;
  readonly memory_mib: number;
  readonly disk_mb: number;
}>;

function instanceType(value: unknown, label: string): ContainerCapacity {
  if (value === "lite" || value === "basic") return value;
  if (!plainObject(value)) fail(`${label}_invalid`);
  const vcpu = integerValue(value.vcpu, `${label}_vcpu`);
  const memory = integerValue(value.memory_mib, `${label}_memory_mib`);
  const disk = integerValue(value.disk_mb, `${label}_disk_mb`);
  return { vcpu, memory_mib: memory, disk_mb: disk };
}

interface DesiredContainer {
  readonly name: string;
  readonly durableObjectClass: string;
  readonly image: string;
  readonly instanceType: ContainerCapacity;
  readonly maxInstances: number;
  readonly rolloutActiveGracePeriod: number;
  readonly schedulingPolicy?: string;
  readonly constraints?: JsonValue;
  readonly affinities?: JsonValue;
  readonly observability?: JsonValue;
  readonly wranglerSsh?: JsonValue;
  readonly authorizedKeys?: JsonValue;
  readonly trustedUserCaKeys?: JsonValue;
}

interface BridgeConfig {
  readonly cwd: string;
  readonly bridgeMode: CloudflareProviderGapBridgeMode;
  readonly bridgeEnvironment: CloudflareProviderGapBridgeEnvironment;
  readonly bridgeAcknowledgementDigest: string;
  readonly accountId: string;
  readonly workerName: string;
  readonly d1DatabaseId: string;
  readonly vectorIndexName: string;
  readonly vectorDimensions: number;
  readonly vectorMetric: "cosine" | "euclidean" | "dot-product";
  readonly migrationSetPath: string;
  readonly workerAssetsPath?: string;
  readonly durableObjectBootstrapPath?: string;
  readonly durableObjectLifecycle?: DurableObjectLifecycle;
  readonly containerDesiredConfigPath?: string;
  readonly containerDesiredConfigContent?: string;
  readonly workerArtifactPath: string;
  readonly containerImage?: string;
  readonly importPollDelayMs: number;
  readonly importPollLimit: number;
}

interface CapabilityPreflightConfig {
  readonly cwd: string;
  readonly bridgeMode: CloudflareProviderGapBridgeMode;
  readonly bridgeEnvironment: CloudflareProviderGapBridgeEnvironment;
  readonly bridgeAcknowledgementDigest: string;
  readonly accountId: string;
}

interface DurableObjectMigrationStep {
  readonly new_classes?: readonly string[];
  readonly new_sqlite_classes?: readonly string[];
  readonly deleted_classes?: readonly string[];
}

interface DurableObjectContainerBinding {
  readonly name: string;
  readonly className: string;
}

interface DurableObjectLifecycle {
  readonly tags: readonly string[];
  readonly steps: readonly DurableObjectMigrationStep[];
  readonly containerBindings: readonly DurableObjectContainerBinding[];
}

function stringArray(
  value: unknown,
  label: string,
  pattern: RegExp,
): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 128) {
    fail(`${label}_invalid`);
  }
  const output = value.map((entry) => {
    const text = stringValue(entry, label);
    if (!pattern.test(text)) fail(`${label}_invalid`);
    return text;
  });
  if (new Set(output).size !== output.length) fail(`${label}_duplicates`);
  return output;
}

function durableObjectLifecycle(value: string): DurableObjectLifecycle {
  if (new TextEncoder().encode(value).byteLength > MAXIMUM_RESPONSE_BYTES) {
    fail("durable_object_lifecycle_too_large");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail("durable_object_lifecycle_invalid");
  }
  if (!plainObject(parsed)) fail("durable_object_lifecycle_invalid");
  const allowedRootKeys = new Set(["tags", "steps", "container_bindings"]);
  if (Object.keys(parsed).some((key) => !allowedRootKeys.has(key))) {
    fail("durable_object_lifecycle_invalid");
  }
  const tags = stringArray(
    parsed.tags,
    "durable_object_migration_tags",
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u,
  );
  if (!Array.isArray(parsed.steps) || parsed.steps.length !== tags.length) {
    fail("durable_object_migration_steps_invalid");
  }
  const classPattern = /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/u;
  const stepKeys = new Set([
    "new_classes",
    "new_sqlite_classes",
    "deleted_classes",
  ]);
  const steps = parsed.steps.map((entry, index): DurableObjectMigrationStep => {
    if (!plainObject(entry)) fail(`durable_object_migration_step_${index}_invalid`);
    const keys = Object.keys(entry);
    if (
      keys.length === 0 ||
      keys.some((key) => !stepKeys.has(key))
    ) {
      fail(`durable_object_migration_step_${index}_invalid`);
    }
    return {
      ...(entry.new_classes === undefined
        ? {}
        : {
            new_classes: stringArray(
              entry.new_classes,
              `durable_object_migration_step_${index}_new_classes`,
              classPattern,
            ),
          }),
      ...(entry.new_sqlite_classes === undefined
        ? {}
        : {
            new_sqlite_classes: stringArray(
              entry.new_sqlite_classes,
              `durable_object_migration_step_${index}_new_sqlite_classes`,
              classPattern,
            ),
          }),
      ...(entry.deleted_classes === undefined
        ? {}
        : {
            deleted_classes: stringArray(
              entry.deleted_classes,
              `durable_object_migration_step_${index}_deleted_classes`,
              classPattern,
            ),
          }),
    };
  });
  if (
    !Array.isArray(parsed.container_bindings) ||
    parsed.container_bindings.length === 0 ||
    parsed.container_bindings.length > 32
  ) {
    fail("durable_object_container_bindings_invalid");
  }
  const containerBindings = parsed.container_bindings.map(
    (entry, index): DurableObjectContainerBinding => {
      if (
        !plainObject(entry) ||
        Object.keys(entry).some((key) => key !== "name" && key !== "class_name")
      ) {
        fail(`durable_object_container_binding_${index}_invalid`);
      }
      const name = stringValue(
        entry.name,
        `durable_object_container_binding_${index}_name`,
      );
      const className = stringValue(
        entry.class_name,
        `durable_object_container_binding_${index}_class_name`,
      );
      if (!/^[A-Z][A-Z0-9_]{0,127}$/u.test(name) || !classPattern.test(className)) {
        fail(`durable_object_container_binding_${index}_invalid`);
      }
      return { name, className };
    },
  );
  if (
    new Set(containerBindings.map(({ name }) => name)).size !== containerBindings.length ||
    new Set(containerBindings.map(({ className }) => className)).size !== containerBindings.length
  ) {
    fail("durable_object_container_bindings_duplicates");
  }
  const sqliteClasses = new Set(
    steps.flatMap(({ new_sqlite_classes: classes = [] }) => classes),
  );
  if (containerBindings.some(({ className }) => !sqliteClasses.has(className))) {
    fail("durable_object_container_binding_not_sqlite_class");
  }
  return { tags, steps, containerBindings };
}

async function readBounded(path: string, maximum: number): Promise<Uint8Array> {
  const metadata = await lstat(path).catch(() => fail("bridge_file_missing"));
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail("bridge_file_invalid");
  if (metadata.size > maximum) fail("bridge_file_too_large");
  return new Uint8Array(await readFile(path));
}

async function readJson(path: string): Promise<unknown> {
  const bytes = await readBounded(path, MAXIMUM_RESPONSE_BYTES);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("bridge_json_invalid");
  }
}

function expandTemplate(value: unknown, env: Record<string, string | undefined>): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Z][A-Z0-9_]*)(?::-([^}]*))?\}/gu, (_full, name: string, fallback?: string) => {
      const resolved = env[name];
      if (resolved !== undefined && resolved.trim() !== "") return resolved.trim();
      if (fallback !== undefined) return fallback;
      fail("container_template_env_missing", name);
    });
  }
  if (Array.isArray(value)) return value.map((entry) => expandTemplate(entry, env));
  if (plainObject(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) output[key] = expandTemplate(entry, env);
    return output;
  }
  return value;
}

function parseCapabilityPreflightConfig(
  options: BridgeFetchOptions = {},
): CapabilityPreflightConfig {
  const env = options.env ?? process.env;
  const activation = validateCloudflareProviderGapBridgeActivation(
    rawEnvironmentValue(env, "TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_MODE"),
    rawEnvironmentValue(env, "TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_ACKNOWLEDGEMENT"),
    rawEnvironmentValue(env, "TAKOS_CLOUDFLARE_ENVIRONMENT"),
  );
  if (activation.mode === "off") fail("bridge_disabled");
  const accountId = stringValue(
    envValue(
      env,
      ["TAKOS_CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID", "account_id"],
      true,
    ),
    "account_id",
  );
  return {
    cwd: resolve(options.cwd ?? process.cwd()),
    bridgeMode: activation.mode,
    bridgeEnvironment: activation.environment!,
    bridgeAcknowledgementDigest: activation.acknowledgementDigest,
    accountId,
  };
}

export async function parseBridgeConfig(
  options: BridgeFetchOptions = {},
  phase?: BridgePhase,
): Promise<BridgeConfig> {
  const env = options.env ?? process.env;
  const cwd = resolve(options.cwd ?? process.cwd());
  const activation = validateCloudflareProviderGapBridgeActivation(
    rawEnvironmentValue(
      env,
      "TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_MODE",
    ),
    rawEnvironmentValue(
      env,
      "TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_ACKNOWLEDGEMENT",
    ),
    rawEnvironmentValue(env, "TAKOS_CLOUDFLARE_ENVIRONMENT"),
  );
  if (activation.mode === "off") fail("bridge_disabled");
  const accountId = stringValue(
    envValue(
      env,
      ["TAKOS_CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID", "account_id"],
      true,
    ),
    "account_id",
  );
  const workerName = stringValue(
    envValue(
      env,
      ["TAKOS_CLOUDFLARE_WORKER_NAME", "TAKOS_WORKER_NAME", "worker_name"],
      true,
    ),
    "worker_name",
  );
  const d1DatabaseId = stringValue(
    envValue(
      env,
      ["TAKOS_CLOUDFLARE_D1_DATABASE_ID", "TAKOS_D1_DATABASE_ID", "d1_database_id"],
      true,
    ),
    "d1_database_id",
  );
  const vectorIndexName = stringValue(
    envValue(
      env,
      [
        "TAKOS_CLOUDFLARE_VECTOR_INDEX_NAME",
        "TAKOS_VECTOR_INDEX_NAME",
        "vector_index_name",
      ],
      true,
    ),
    "vector_index_name",
  );
  const vectorDimensions = integerValue(
    envValue(
      env,
      [
        "TAKOS_CLOUDFLARE_VECTOR_INDEX_DIMENSIONS",
        "TAKOS_VECTOR_INDEX_DIMENSIONS",
        "vector_index_dimensions",
      ],
      true,
    ),
    "vector_index_dimensions",
  );
  const metric = stringValue(
    envValue(
      env,
      [
        "TAKOS_CLOUDFLARE_VECTOR_INDEX_METRIC",
        "TAKOS_VECTOR_INDEX_METRIC",
        "vector_index_metric",
      ],
      true,
    ),
    "vector_index_metric",
  );
  if (metric !== "cosine" && metric !== "euclidean" && metric !== "dot-product") {
    fail("vector_index_metric_invalid");
  }
  const migrationSetPath = pathInput(
    cwd,
    envValue(
      env,
      [
        "TAKOS_CLOUDFLARE_MIGRATION_SET_PATH",
        "TAKOS_MIGRATION_SET_PATH",
        "migration_set_path",
      ],
      true,
    ),
    "migration_set_path",
    true,
  )!;
  const workerArtifactPath = pathInput(
    cwd,
    envValue(
      env,
      [
        "TAKOS_CLOUDFLARE_WORKER_ARTIFACT_PATH",
        "TAKOS_WORKER_ARTIFACT_PATH",
        "worker_artifact_path",
      ],
      true,
    ),
    "worker_artifact_path",
    true,
  )!;
  const workerAssetsPath = pathInput(
    cwd,
    envValue(env, ["TAKOS_CLOUDFLARE_WORKER_ASSETS_PATH"], phase !== "recovery-cleanup"),
    "worker_assets_path",
    phase !== "recovery-cleanup",
  );
  const needsDurableObjectBootstrap = phase === "pre-worker";
  const durableObjectBootstrapPath = pathInput(
    cwd,
    envValue(
      env,
      ["TAKOS_CLOUDFLARE_DURABLE_OBJECT_BOOTSTRAP_PATH"],
      needsDurableObjectBootstrap,
    ),
    "durable_object_bootstrap_path",
    needsDurableObjectBootstrap,
  );
  const durableObjectLifecycleValue = envValue(
    env,
    ["TAKOS_CLOUDFLARE_DURABLE_OBJECT_LIFECYCLE"],
    needsDurableObjectBootstrap,
  );
  const parsedDurableObjectLifecycle =
    durableObjectLifecycleValue === undefined
      ? undefined
      : durableObjectLifecycle(durableObjectLifecycleValue);
  const needsContainers =
    phase === "post-worker" || phase === "verify" || phase === "recovery-cleanup";
  const containerDesiredConfigContent = envValue(
    env,
    ["TAKOS_CLOUDFLARE_CONTAINER_DESIRED_CONFIG_CONTENT"],
    false,
  );
  const containerDesiredConfigPath = pathInput(
    cwd,
    envValue(
      env,
      [
        "TAKOS_CLOUDFLARE_CONTAINER_DESIRED_CONFIG_PATH",
        "TAKOS_CONTAINER_DESIRED_CONFIG_PATH",
        "container_desired_config_path",
      ],
      needsContainers && containerDesiredConfigContent === undefined,
    ),
    "container_desired_config_path",
    needsContainers && containerDesiredConfigContent === undefined,
  );
  const delay = Number(
    envValue(env, ["TAKOS_D1_IMPORT_POLL_DELAY_MS", "d1_import_poll_delay_ms"], false) ??
      options.importPollDelayMs ??
      DEFAULT_D1_IMPORT_POLL_DELAY_MS,
  );
  const limit = Number(
    envValue(env, ["TAKOS_D1_IMPORT_POLL_LIMIT", "d1_import_poll_limit"], false) ??
      options.importPollLimit ??
      D1_IMPORT_POLL_LIMIT,
  );
  if (!Number.isSafeInteger(delay) || delay < 0 || delay > 60_000) {
    fail("d1_import_poll_delay_invalid");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > D1_IMPORT_POLL_LIMIT) {
    fail("d1_import_poll_limit_invalid");
  }
  const containerImage = envValue(
    env,
    ["TAKOS_CONTAINER_IMAGE", "container_image"],
    false,
  );
  if (containerImage !== undefined) imageReference(containerImage, accountId);
  return {
    cwd,
    bridgeMode: activation.mode,
    bridgeEnvironment: activation.environment!,
    bridgeAcknowledgementDigest: activation.acknowledgementDigest,
    accountId,
    workerName,
    d1DatabaseId,
    vectorIndexName,
    vectorDimensions,
    vectorMetric: metric,
    migrationSetPath,
    ...(workerAssetsPath === undefined ? {} : { workerAssetsPath }),
    ...(durableObjectBootstrapPath === undefined
      ? {}
      : { durableObjectBootstrapPath }),
    ...(parsedDurableObjectLifecycle === undefined
      ? {}
      : { durableObjectLifecycle: parsedDurableObjectLifecycle }),
    containerDesiredConfigPath,
    ...(containerDesiredConfigContent === undefined
      ? {}
      : { containerDesiredConfigContent }),
    workerArtifactPath,
    ...(containerImage === undefined ? {} : { containerImage }),
    importPollDelayMs: delay,
    importPollLimit: limit,
  };
}

export async function migrationFiles(path: string): Promise<readonly {
  readonly name: string;
  readonly sql: string;
  readonly sha256: string;
}[]> {
  const metadata = await lstat(path).catch(() => fail("migration_set_missing"));
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail("migration_set_invalid");
  const files: { name: string; sql: string; sha256: string }[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      const entryPath = join(directory, entry.name);
      const entryStat = await lstat(entryPath);
      if (entryStat.isSymbolicLink()) fail("migration_set_symlink");
      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }
      if (!entry.isFile()) fail("migration_file_invalid");
      if (!entry.name.endsWith(".sql")) continue;
      if (!/^\d{4}_[^/]+\.sql$/u.test(relative(path, entryPath).split(sep).join("/"))) {
        fail("migration_file_name_invalid");
      }
      if (entryStat.size === 0 || entryStat.size > MAXIMUM_MIGRATION_BYTES) {
        fail("migration_file_size_invalid");
      }
      const bytes = await readFile(entryPath);
      files.push({
        name: relative(path, entryPath).split(sep).join("/"),
        sql: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        sha256: sha256(bytes),
      });
    }
  }
  await visit(path);
  files.sort((a, b) => a.name.localeCompare(b.name));
  if (files.length === 0) fail("migration_set_empty");
  return files;
}

function containerRowsFromValue(
  rawValue: unknown,
  env: Record<string, string | undefined>,
): readonly DesiredContainer[] {
  // Template expansion is deliberately allow-listed.  In particular, do not
  // hand the inherited API token (or an arbitrary process.env object) to a
  // user-controlled desired-config file where it could be persisted in an
  // application body.
  const templateEnv: Record<string, string | undefined> = {};
  for (const name of [
    "TAKOS_CLOUDFLARE_WORKER_NAME",
    "TAKOS_WORKER_NAME",
    "worker_name",
    "TAKOS_CONTAINER_IMAGE",
    "container_image",
    "TAKOS_EXECUTOR_TIER1_MAX_INSTANCES",
    "TAKOS_EXECUTOR_TIER2_MAX_INSTANCES",
    "TAKOS_EXECUTOR_TIER3_MAX_INSTANCES",
  ]) {
    templateEnv[name] = envValue(env, [name], false);
  }
  const raw = expandTemplate(rawValue, templateEnv);
  const targetAccount = envValue(
    env,
    ["TAKOS_CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID", "account_id"],
    false,
  );
  const rows = Array.isArray(raw)
    ? raw
    : plainObject(raw) && Array.isArray(raw.applications)
      ? raw.applications
      : undefined;
  if (!rows || rows.length !== 3) fail("container_desired_config_must_have_three_applications");
  const output: DesiredContainer[] = rows.map((value, index) => {
    if (!plainObject(value)) fail(`container_${index}_invalid`);
    const name = stringValue(value.name, `container_${index}_name`);
    const durableObjectClass = stringValue(
      value.durable_object_class ?? value.class_name,
      `container_${index}_durable_object_class`,
    );
    const image = imageReference(value.image, targetAccount);
    const type = instanceType(value.instance_type, `container_${index}_instance_type`);
    const maxInstances = integerValue(value.max_instances, `container_${index}_max_instances`);
    const grace = integerValue(
      value.rollout_active_grace_period ?? value.grace_period_seconds ?? 900,
      `container_${index}_rollout_active_grace_period`,
      0,
    );
    const optionalJson = (key: string): JsonValue | undefined =>
      value[key] === undefined ? undefined : jsonValue(value[key], `container_${index}_${key}`);
    const scheduling = value.scheduling_policy;
    if (scheduling !== undefined && typeof scheduling !== "string") {
      fail(`container_${index}_scheduling_policy_invalid`);
    }
    return {
      name,
      durableObjectClass,
      image,
      instanceType: type,
      maxInstances,
      rolloutActiveGracePeriod: grace,
      ...(scheduling === undefined ? {} : { schedulingPolicy: scheduling }),
      ...(optionalJson("constraints") === undefined ? {} : { constraints: optionalJson("constraints") }),
      ...(optionalJson("affinities") === undefined ? {} : { affinities: optionalJson("affinities") }),
      ...(optionalJson("observability") === undefined ? {} : { observability: optionalJson("observability") }),
      ...(optionalJson("wrangler_ssh") === undefined ? {} : { wranglerSsh: optionalJson("wrangler_ssh") }),
      ...(optionalJson("authorized_keys") === undefined ? {} : { authorizedKeys: optionalJson("authorized_keys") }),
      ...(optionalJson("trusted_user_ca_keys") === undefined ? {} : { trustedUserCaKeys: optionalJson("trusted_user_ca_keys") }),
    };
  });
  if (
    new Set(output.map((row) => row.name)).size !== output.length ||
    new Set(output.map((row) => row.durableObjectClass)).size !== output.length
  ) {
    fail("container_desired_config_duplicates");
  }
  return output;
}

export async function containerRows(
  path: string,
  env: Record<string, string | undefined>,
): Promise<readonly DesiredContainer[]> {
  return containerRowsFromValue(await readJson(path), env);
}

function containerRowsFromContent(
  content: string,
  env: Record<string, string | undefined>,
): readonly DesiredContainer[] {
  if (new TextEncoder().encode(content).byteLength > MAXIMUM_RESPONSE_BYTES) {
    fail("container_desired_config_too_large");
  }
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    fail("bridge_json_invalid");
  }
  return containerRowsFromValue(value, env);
}

async function jsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAXIMUM_RESPONSE_BYTES) {
    fail("cloudflare_response_too_large");
  }
  try {
    return JSON.parse(text);
  } catch {
    fail("cloudflare_response_invalid");
  }
}

function pathSegment(value: string, label: string): string {
  if (!value || value.length > 512 || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(`${label}_invalid`);
  }
  return encodeURIComponent(value);
}

type CloudflareMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

type ContainersRequestContext = "default" | "delete-readback";

function cloudflareApiSurface(path: string): string {
  if (path.includes("/containers/applications")) return "containers.applications";
  if (path.includes("/vectorize/")) return "vectorize.indexes";
  if (path.includes("/d1/database")) return "d1.database";
  if (path.includes("/workers/scripts/")) return "workers.scripts";
  return "cloudflare.api";
}

const CONTAINER_APPLICATION_ERROR_CODES = [
  "IMAGE_REGISTRY_RETURNED_ERROR",
  "IMAGE_REGISTRY_DOESNT_CONTAIN_IMAGE",
  "VALIDATE_INPUT",
  "SURPASSED_BASE_LIMITS",
  "SURPASSED_TOTAL_LIMITS",
  "LOCATION_NOT_ALLOWED",
  "LOCATION_SURPASSED_BASE_LIMITS",
  "IMAGE_REGISTRY_NOT_CONFIGURED",
  "JOB_CREATE_NOT_ALLOWED",
  "DURABLE_OBJECT_NOT_FOUND",
  "DURABLE_OBJECT_NOT_CONTAINER_ENABLED",
  "DURABLE_OBJECT_ALREADY_HAS_APPLICATION",
] as const;

function boundedCloudflareErrorCode(
  value: unknown,
  depth = 0,
): string | undefined {
  if (depth > 4) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return `CF${value}`;
  }
  if (typeof value === "string") {
    const containerCode = CONTAINER_APPLICATION_ERROR_CODES.find((code) =>
      value.includes(code)
    );
    if (containerCode) return containerCode;
  }
  if (
    typeof value === "string" &&
    /^[A-Z][A-Z0-9_]{1,127}$/u.test(value)
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = boundedCloudflareErrorCode(entry, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (!plainObject(value)) return undefined;
  for (const key of ["error", "message", "details", "errors", "error_code", "result", "code"]) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const found = boundedCloudflareErrorCode(value[key], depth + 1);
    if (found) return found;
  }
  return undefined;
}

export function cloudflareApiFailureDetail(
  method: CloudflareMethod,
  path: string,
  status: number,
  parsed?: unknown,
): string {
  const code = boundedCloudflareErrorCode(parsed);
  return [method, cloudflareApiSurface(path), String(status), code]
    .filter((value): value is string => value !== undefined)
    .join(":");
}

export function bridgeFailurePayload(
  code: string,
  detail?: string,
): { readonly ok: false; readonly error: string; readonly detail?: string } {
  const safeCode = /^[a-z][a-z0-9_]{0,127}$/u.test(code)
    ? code
    : "bridge_failed";
  const safeDetail =
    safeCode === "cloudflare_api_error" &&
    /^(?:GET|POST|PATCH|PUT|DELETE):(?:containers\.applications|vectorize\.indexes|d1\.database|workers\.scripts|cloudflare\.api):[1-5][0-9]{2}(?::(?:CF[0-9]{1,12}|[A-Z][A-Z0-9_]{1,127}))?$/u.test(
      detail ?? "",
    )
      ? detail
      : undefined;
  return {
    ok: false,
    error: safeCode,
    ...(safeDetail === undefined ? {} : { detail: safeDetail }),
  };
}

class CloudflareApi {
  readonly #accountId: string;
  readonly #token: string;
  readonly #fetch: typeof fetch;
  readonly #containersReadinessRetryAttempts: number;
  readonly #containersReadinessRetryDelayMs: number;
  readonly #containersReadinessDelay: (delayMs: number) => Promise<void>;

  constructor(
    accountId: string,
    token: string,
    fetchImpl: typeof fetch,
    options: Pick<
      BridgeFetchOptions,
      | "containersReadinessRetryAttempts"
      | "containersReadinessRetryDelayMs"
      | "containersReadinessDelay"
    > = {},
  ) {
    this.#accountId = accountId;
    this.#token = token;
    this.#fetch = fetchImpl;
    const attempts =
      options.containersReadinessRetryAttempts ?? CONTAINERS_READINESS_RETRY_ATTEMPTS;
    const delayMs =
      options.containersReadinessRetryDelayMs ?? CONTAINERS_READINESS_RETRY_DELAY_MS;
    if (
      !Number.isSafeInteger(attempts) ||
      attempts < 1 ||
      attempts > CONTAINERS_READINESS_RETRY_ATTEMPTS
    ) {
      fail("containers_readiness_retry_attempts_invalid");
    }
    if (
      !Number.isSafeInteger(delayMs) ||
      delayMs < 0 ||
      delayMs > CONTAINERS_READINESS_RETRY_DELAY_MS
    ) {
      fail("containers_readiness_retry_delay_invalid");
    }
    this.#containersReadinessRetryAttempts = attempts;
    this.#containersReadinessRetryDelayMs = delayMs;
    this.#containersReadinessDelay =
      options.containersReadinessDelay ??
      (async (milliseconds) => {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
      });
  }

  async request(
    method: CloudflareMethod,
    path: string,
    body?: JsonValue,
    allowStatuses: readonly number[] = [],
  ): Promise<unknown | null> {
    let response: Response;
    try {
      response = await this.#fetch(`${CLOUDFLARE_API}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.#token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      fail("cloudflare_request_failed");
    }
    if (allowStatuses.includes(response.status)) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    let parsed: unknown;
    try {
      parsed = await jsonResponse(response);
    } catch (error) {
      if (error instanceof BridgeFailure) throw error;
      fail("cloudflare_response_invalid");
    }
    if (!response.ok || !plainObject(parsed) || parsed.success !== true) {
      fail(
        "cloudflare_api_error",
        cloudflareApiFailureDetail(method, path, response.status, parsed),
      );
    }
    return parsed.result ?? null;
  }

  async requestMultipart(path: string, body: FormData): Promise<unknown | null> {
    let response: Response;
    try {
      response = await this.#fetch(`${CLOUDFLARE_API}${path}`, {
        method: "PUT",
        headers: { authorization: `Bearer ${this.#token}` },
        body,
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      fail("cloudflare_request_failed");
    }
    let parsed: unknown;
    try {
      parsed = await jsonResponse(response);
    } catch (error) {
      if (error instanceof BridgeFailure) throw error;
      fail("cloudflare_response_invalid");
    }
    if (!response.ok || !plainObject(parsed) || parsed.success !== true) {
      fail(
        "cloudflare_api_error",
        cloudflareApiFailureDetail("PUT", path, response.status, parsed),
      );
    }
    return parsed.result ?? null;
  }

  /**
   * Call the Containers OpenAPI surface without assuming the ordinary
   * Cloudflare v4 response envelope.  Wrangler's generated client accepts
   * the v4 `{success,result}` envelope, while the Containers service has also
   * returned the result body directly in older deployments.  We accept only
   * those two documented shapes and reject every other response rather than
   * turning an unknown body into an empty application list.
   */
  async requestContainers(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: JsonValue,
    allowStatuses: readonly number[] = [],
    context: ContainersRequestContext = "default",
  ): Promise<unknown | null> {
    const isContainerApplicationDetailPath =
      /^\/accounts\/[^/]+\/containers\/applications\/[^/?]+$/u.test(path);
    if (
      context === "delete-readback" &&
      (method !== "GET" || !isContainerApplicationDetailPath)
    ) {
      fail("container_request_context_invalid");
    }
    for (let attempt = 1; attempt <= this.#containersReadinessRetryAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await this.#fetch(`${CLOUDFLARE_API}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${this.#token}`,
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        fail("cloudflare_request_failed");
      }
      const allowedStatus = allowStatuses.includes(response.status);
      const inspectAllowedNotFound = response.status === 404;
      if (allowedStatus && !inspectAllowedNotFound) {
        await response.body?.cancel().catch(() => {});
        return null;
      }
      if (response.status === 204) {
        await response.body?.cancel().catch(() => {});
        if (!response.ok) {
          fail(
            "cloudflare_api_error",
            cloudflareApiFailureDetail(method, path, response.status),
          );
        }
        if (context === "delete-readback") {
          fail(
            "cloudflare_api_error",
            cloudflareApiFailureDetail(method, path, response.status),
          );
        }
        return null;
      }
      let parsed: unknown;
      try {
        parsed = await jsonResponse(response);
      } catch (error) {
        if (allowedStatus && !inspectAllowedNotFound) return null;
        if (error instanceof BridgeFailure) throw error;
        fail("cloudflare_response_invalid");
      }
      const exactContainersNotReady =
        method === "GET" &&
        response.status === 404 &&
        boundedCloudflareErrorCode(parsed) === "CF1609";
      if (context === "delete-readback" && response.status === 404) {
        // Only the exact-ID read immediately after a successful DELETE may
        // interpret the provider's CF1609 response as authoritative absence.
        // Arbitrary 404s remain errors so ownership/readback cannot fail open.
        if (exactContainersNotReady) return null;
        fail(
          "cloudflare_api_error",
          cloudflareApiFailureDetail(method, path, response.status, parsed),
        );
      }
      if (exactContainersNotReady && attempt < this.#containersReadinessRetryAttempts) {
        await this.#containersReadinessDelay(this.#containersReadinessRetryDelayMs);
        continue;
      }
      if (allowedStatus && !inspectAllowedNotFound) return null;
      if (!response.ok) {
        fail(
          "cloudflare_api_error",
          cloudflareApiFailureDetail(method, path, response.status, parsed),
        );
      }
      if (plainObject(parsed) && Object.prototype.hasOwnProperty.call(parsed, "success")) {
        if (parsed.success !== true || !Object.prototype.hasOwnProperty.call(parsed, "result")) {
          fail(
            "cloudflare_api_error",
            cloudflareApiFailureDetail(method, path, response.status, parsed),
          );
        }
        return parsed.result ?? null;
      }
      // A direct array/object is the raw Containers OpenAPI response shape.
      if (Array.isArray(parsed) || plainObject(parsed)) return parsed;
      fail("cloudflare_response_invalid");
    }
    fail("cloudflare_request_failed");
  }

  async d1Query(
    databaseId: string,
    sql: string,
    params: readonly (string | number | null)[] = [],
  ): Promise<readonly Record<string, unknown>[]> {
    const body: JsonObject = { sql, ...(params.length === 0 ? {} : { params: [...params] }) };
    const result = await this.request(
      "POST",
      `/accounts/${pathSegment(this.#accountId, "account_id")}/d1/database/${pathSegment(databaseId, "database_id")}/query`,
      body,
    );
    const rows = Array.isArray(result) ? result[0] : result;
    if (!plainObject(rows)) return [];
    if (rows.success === false) fail("cloudflare_d1_query_failed");
    if (!Array.isArray(rows.results)) return [];
    return rows.results.filter((row): row is Record<string, unknown> => plainObject(row));
  }

  async d1Import(
    databaseId: string,
    bytes: Uint8Array,
    delayMs: number,
    pollLimit: number,
  ): Promise<void> {
    const path = `/accounts/${pathSegment(this.#accountId, "account_id")}/d1/database/${pathSegment(databaseId, "database_id")}/import`;
    let result = await this.request("POST", path, { action: "init", etag: md5(bytes) });
    if (!plainObject(result)) fail("cloudflare_d1_import_response_invalid");
    const etag = md5(bytes);
    if (result.upload_url !== undefined || result.filename !== undefined) {
      if (typeof result.upload_url !== "string" || typeof result.filename !== "string") {
        fail("cloudflare_d1_import_response_invalid");
      }
      let uploadUrl: URL;
      try {
        uploadUrl = new URL(result.upload_url);
      } catch {
        fail("cloudflare_d1_import_response_invalid");
      }
      if (
        uploadUrl.protocol !== "https:" ||
        !uploadUrl.hostname.endsWith(".r2.cloudflarestorage.com")
      ) {
        fail("cloudflare_d1_import_response_invalid");
      }
      let uploadResponse: Response;
      try {
        uploadResponse = await this.#fetch(uploadUrl, {
          method: "PUT",
          headers: { "content-length": String(bytes.byteLength) },
          body: bytes,
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        fail("cloudflare_d1_import_upload_failed");
      }
      const uploadedEtag = (uploadResponse.headers.get("etag") ?? "")
        .replace(/^W\//u, "")
        .replace(/^"|"$/gu, "");
      if (!uploadResponse.ok || uploadedEtag !== etag) fail("cloudflare_d1_import_upload_failed");
      result = await this.request("POST", path, {
        action: "ingest",
        filename: result.filename,
        etag,
      });
      if (!plainObject(result)) fail("cloudflare_d1_import_response_invalid");
    }
    for (let attempt = 0; attempt < pollLimit; attempt += 1) {
      if (result.status === "complete") return;
      if (result.status === "error") fail("cloudflare_d1_import_failed");
      if (typeof result.at_bookmark !== "string" || result.at_bookmark === "") {
        fail("cloudflare_d1_import_response_invalid");
      }
      if (delayMs > 0) await new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
      result = await this.request("POST", path, {
        action: "poll",
        current_bookmark: result.at_bookmark,
      });
      if (!plainObject(result)) fail("cloudflare_d1_import_response_invalid");
    }
    fail("cloudflare_d1_import_timeout");
  }
}

interface WorkerEvidence {
  readonly versionId: string;
  readonly namespaces: ReadonlyMap<string, string>;
  readonly vectorIndexes: ReadonlySet<string>;
}

function activeVersionId(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = activeVersionId(entry);
      if (found) return found;
    }
    return undefined;
  }
  if (!plainObject(value)) return undefined;
  if (Array.isArray(value.versions)) {
    for (const version of value.versions) {
      if (!plainObject(version)) continue;
      const percentage = Number(version.percentage);
      if (percentage >= 99.99 && typeof version.version_id === "string") {
        return version.version_id;
      }
    }
  }
  if (typeof value.version_id === "string") return value.version_id;
  for (const nested of Object.values(value)) {
    const found = activeVersionId(nested);
    if (found) return found;
  }
  return undefined;
}

async function workerEvidence(api: CloudflareApi, config: BridgeConfig): Promise<WorkerEvidence> {
  const deployments = await api.request(
    "GET",
    `/accounts/${pathSegment(config.accountId, "account_id")}/workers/scripts/${pathSegment(config.workerName, "worker_name")}/deployments`,
  );
  const versionId = activeVersionId(deployments);
  if (!versionId) fail("worker_active_version_readback_missing");
  const detail = await api.request(
    "GET",
    `/accounts/${pathSegment(config.accountId, "account_id")}/workers/scripts/${pathSegment(config.workerName, "worker_name")}/versions/${pathSegment(versionId, "worker_version")}`,
  );
  if (!plainObject(detail) || !plainObject(detail.resources) || !Array.isArray(detail.resources.bindings)) {
    fail("worker_version_bindings_invalid");
  }
  const namespaces = new Map<string, string>();
  const vectors = new Set<string>();
  for (const binding of detail.resources.bindings) {
    if (!plainObject(binding)) continue;
    if (
      binding.type === "durable_object_namespace" &&
      typeof binding.class_name === "string" &&
      typeof binding.namespace_id === "string"
    ) {
      if (namespaces.has(binding.class_name)) fail("worker_namespace_binding_ambiguous");
      namespaces.set(binding.class_name, binding.namespace_id);
    }
    if (
      (binding.type === "vectorize" || binding.type === "vectorize_index") &&
      typeof (binding.index_name ?? binding.indexName) === "string"
    ) {
      vectors.add(String(binding.index_name ?? binding.indexName));
    }
  }
  return { versionId, namespaces, vectorIndexes: vectors };
}

function vectorPath(config: BridgeConfig): string {
  return `/accounts/${pathSegment(config.accountId, "account_id")}/vectorize/v2/indexes/${pathSegment(config.vectorIndexName, "vector_index_name")}`;
}

async function readVector(api: CloudflareApi, config: BridgeConfig): Promise<JsonObject | null> {
  const result = await api.request("GET", vectorPath(config), undefined, [404, 410]);
  return plainObject(result) ? (result as JsonObject) : null;
}

function vectorMatches(value: JsonObject, config: BridgeConfig): boolean {
  const nested = plainObject(value.config) ? value.config : value;
  return (
    value.name === config.vectorIndexName &&
    Number(nested.dimensions) === config.vectorDimensions &&
    nested.metric === config.vectorMetric
  );
}

async function reconcileVector(api: CloudflareApi, config: BridgeConfig): Promise<"present" | "created"> {
  let current = await readVector(api, config);
  if (current && !vectorMatches(current, config)) fail("vector_index_readback_drifted");
  if (!current) {
    const result = await api.request(
      "POST",
      `/accounts/${pathSegment(config.accountId, "account_id")}/vectorize/v2/indexes`,
      {
        name: config.vectorIndexName,
        config: { dimensions: config.vectorDimensions, metric: config.vectorMetric },
      },
    );
    if (result !== null && !plainObject(result)) fail("vector_index_create_response_invalid");
    current = await readVector(api, config);
    if (!current || !vectorMatches(current, config)) fail("vector_index_create_readback_failed");
    return "created";
  }
  return "present";
}

interface ContainerApplication {
  readonly id: string;
  readonly name: string;
}

function containersApplicationsPath(config: Pick<BridgeConfig, "accountId">): string {
  return `/accounts/${pathSegment(config.accountId, "account_id")}/containers/applications`;
}

function containerApplicationRows(result: unknown): readonly unknown[] {
  if (Array.isArray(result)) return result;
  if (plainObject(result)) {
    if (Array.isArray(result.applications)) return result.applications;
    if (Array.isArray(result.data)) return result.data;
    // Some deployments expose the v4 result field without the outer
    // `success` boolean. Keep this narrow: only an array result is accepted.
    if (Array.isArray(result.result)) return result.result;
  }
  fail("container_list_response_invalid");
}

async function probeContainersCapability(
  api: CloudflareApi,
  config: Pick<BridgeConfig, "accountId">,
): Promise<void> {
  // Probe the account-level list surface before any pre-worker mutation.  The
  // Containers endpoint has returned both a raw array and a v4 envelope, so
  // requestContainers unwraps the latter and this validates either shape,
  // including an empty account.  No desired application name is supplied:
  // absence of a named application is a normal create case in post-worker.
  const result = await api.requestContainers(
    "GET",
    containersApplicationsPath(config),
  );
  containerApplicationRows(result);
}

async function listContainers(
  api: CloudflareApi,
  config: BridgeConfig,
  name: string,
): Promise<readonly ContainerApplication[]> {
  // The non-Dash Containers OpenAPI endpoint supports an exact name filter.
  // Querying by name avoids pagination races and makes duplicate ownership
  // evidence explicit for each desired application.
  const result = await api.requestContainers(
    "GET",
    `/accounts/${pathSegment(config.accountId, "account_id")}/containers/applications?name=${pathSegment(name, "container_name")}`,
  );
  const rows = containerApplicationRows(result);
  return rows.map((value, index) => {
    if (!plainObject(value)) fail(`container_list_row_${index}_invalid`);
    return {
      id: stringValue(value.id, `container_list_row_${index}_id`),
      name: stringValue(value.name, `container_list_row_${index}_name`),
    };
  });
}

function containerConfiguration(desired: DesiredContainer): JsonObject {
  const capacity: Record<string, JsonValue> = typeof desired.instanceType === "string"
    ? { instance_type: desired.instanceType }
    : {
      vcpu: desired.instanceType.vcpu,
      memory_mib: desired.instanceType.memory_mib,
      disk: { size_mb: desired.instanceType.disk_mb },
    };
  return {
    image: desired.image,
    ...capacity,
    ...(desired.observability === undefined ? {} : { observability: desired.observability }),
    ...(desired.wranglerSsh === undefined ? {} : { wrangler_ssh: desired.wranglerSsh }),
    ...(desired.authorizedKeys === undefined ? {} : { authorized_keys: desired.authorizedKeys }),
    ...(desired.trustedUserCaKeys === undefined ? {} : { trusted_user_ca_keys: desired.trustedUserCaKeys }),
  };
}

function containerBody(
  desired: DesiredContainer,
  namespaceId: string,
): JsonObject {
  return {
    name: desired.name,
    scheduling_policy: desired.schedulingPolicy ?? "default",
    configuration: containerConfiguration(desired),
    instances: 0,
    max_instances: desired.maxInstances,
    ...(desired.constraints === undefined ? {} : { constraints: desired.constraints }),
    ...(desired.affinities === undefined ? {} : { affinities: desired.affinities }),
    durable_objects: { namespace_id: namespaceId },
    rollout_active_grace_period: desired.rolloutActiveGracePeriod,
  };
}

function containerPatchBody(desired: DesiredContainer): JsonObject {
  return {
    configuration: containerConfiguration(desired),
    max_instances: desired.maxInstances,
    ...(desired.constraints === undefined ? {} : { constraints: desired.constraints }),
    ...(desired.affinities === undefined ? {} : { affinities: desired.affinities }),
    scheduling_policy: desired.schedulingPolicy ?? "default",
    rollout_active_grace_period: desired.rolloutActiveGracePeriod,
  };
}

function containerMatches(value: JsonObject, desired: DesiredContainer, namespaceId: string): boolean {
  const configuration = plainObject(value.configuration) ? value.configuration : {};
  const durableObjects = plainObject(value.durable_objects) ? value.durable_objects : {};
  const disk = plainObject(configuration.disk) ? configuration.disk : {};
  const namedCapacity = typeof desired.instanceType === "string"
    ? NAMED_CONTAINER_CAPACITIES[desired.instanceType]
    : null;
  const capacityMatches = namedCapacity !== null
    ? configuration.instance_type === desired.instanceType ||
      configuration.instance_type === undefined &&
        Number(configuration.vcpu) === namedCapacity.vcpu &&
        Number(configuration.memory_mib) === namedCapacity.memory_mib &&
        Number(disk.size_mb) === namedCapacity.disk_mb
    : configuration.instance_type === undefined &&
      Number(configuration.vcpu) === desired.instanceType.vcpu &&
      Number(configuration.memory_mib) === desired.instanceType.memory_mib &&
      Number(disk.size_mb) === desired.instanceType.disk_mb;
  return (
    value.name === desired.name &&
    configuration.image === desired.image &&
    capacityMatches &&
    value.scheduling_policy === (desired.schedulingPolicy ?? "default") &&
    Number(value.max_instances) === desired.maxInstances &&
    Number(value.rollout_active_grace_period) === desired.rolloutActiveGracePeriod &&
    durableObjects.namespace_id === namespaceId
  );
}

async function reconcileContainers(
  api: CloudflareApi,
  config: BridgeConfig,
  worker: WorkerEvidence,
  desired: readonly DesiredContainer[],
): Promise<{ readonly names: readonly string[]; readonly changed: boolean }> {
  const reconciled: string[] = [];
  let changed = false;
  for (const row of desired) {
    const namespaceId = worker.namespaces.get(row.durableObjectClass);
    if (!namespaceId) fail("worker_namespace_for_container_missing", row.durableObjectClass);
    const matches = await listContainers(api, config, row.name);
    if (matches.length > 1) fail("container_name_ambiguous", row.name);
    let application = matches[0];
    let detail: JsonObject | null = null;
    if (application) {
      const value = await api.requestContainers(
        "GET",
        `/accounts/${pathSegment(config.accountId, "account_id")}/containers/applications/${pathSegment(application.id, "container_id")}`,
      );
      if (!plainObject(value)) fail("container_readback_invalid");
      detail = value as JsonObject;
      if (!containerMatches(detail, row, namespaceId)) {
        await api.requestContainers(
          "PATCH",
          `/accounts/${pathSegment(config.accountId, "account_id")}/containers/applications/${pathSegment(application.id, "container_id")}`,
          containerPatchBody(row),
        );
        changed = true;
      }
    } else {
      const value = await api.requestContainers(
        "POST",
        `/accounts/${pathSegment(config.accountId, "account_id")}/containers/applications`,
        containerBody(row, namespaceId),
      );
      if (!plainObject(value)) fail("container_create_readback_invalid");
      application = {
        id: stringValue(value.id, "container_id"),
        name: stringValue(value.name ?? row.name, "container_name"),
      };
      changed = true;
    }
    const readback = await api.requestContainers(
      "GET",
      `/accounts/${pathSegment(config.accountId, "account_id")}/containers/applications/${pathSegment(application.id, "container_id")}`,
    );
    if (!plainObject(readback) || !containerMatches(readback, row, namespaceId)) {
      fail("container_reconcile_readback_failed", row.name);
    }
    reconciled.push(row.name);
  }
  return { names: reconciled, changed };
}

async function readLedger(
  api: CloudflareApi,
  config: BridgeConfig,
  ensureTable = true,
): Promise<readonly Record<string, unknown>[]> {
  if (ensureTable) {
    await api.d1Query(
      config.d1DatabaseId,
      `CREATE TABLE IF NOT EXISTS "${D1_LEDGER_TABLE}" (name TEXT PRIMARY KEY NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)`,
    );
  }
  return api.d1Query(
    config.d1DatabaseId,
    `SELECT name, checksum FROM "${D1_LEDGER_TABLE}" ORDER BY name`,
  );
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`;
}

async function reconcileMigrations(
  api: CloudflareApi,
  config: BridgeConfig,
  files: readonly { readonly name: string; readonly sql: string; readonly sha256: string }[],
): Promise<{
  readonly applied: readonly string[];
  readonly pending: readonly string[];
  readonly newlyApplied: readonly string[];
}> {
  const rows = await readLedger(api, config, true);
  const byName = new Map<string, string>();
  for (const row of rows) {
    const name = stringValue(row.name, "migration_ledger_name");
    const checksum = stringValue(row.checksum, "migration_ledger_checksum");
    if (byName.has(name)) fail("migration_ledger_duplicate");
    byName.set(name, checksum);
  }
  const knownNames = new Set(files.map((file) => file.name));
  for (const name of byName.keys()) {
    if (!knownNames.has(name)) fail("migration_ledger_unknown", name);
  }
  const applied: string[] = [];
  const pending: string[] = [];
  const newlyApplied: string[] = [];
  let encounteredPending = false;
  // Validate the complete ledger/order before importing any SQL.  Discovering
  // a later already-applied migration after the first import would otherwise
  // leave a partially reconciled database when we fail closed.
  for (const file of files) {
    const expected = `sha256:${file.sha256}`;
    const actual = byName.get(file.name);
    if (actual !== undefined) {
      if (actual !== expected && actual !== file.sha256) fail("migration_checksum_drift", file.name);
      if (encounteredPending) fail("migration_ledger_out_of_order", file.name);
      applied.push(file.name);
      continue;
    }
    encounteredPending = true;
    pending.push(file.name);
  }
  for (const file of files) {
    if (byName.has(file.name)) continue;
    const expected = `sha256:${file.sha256}`;
    const sql = `${file.sql.trimEnd()}\nINSERT INTO "${D1_LEDGER_TABLE}" (name, checksum, applied_at) VALUES (${sqlLiteral(file.name)}, ${sqlLiteral(expected)}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));\n`;
    await api.d1Import(
      config.d1DatabaseId,
      new TextEncoder().encode(sql),
      config.importPollDelayMs,
      config.importPollLimit,
    );
    applied.push(file.name);
    newlyApplied.push(file.name);
  }
  return { applied, pending: [], newlyApplied };
}

async function verifyMigrations(
  api: CloudflareApi,
  config: BridgeConfig,
  files: readonly { readonly name: string; readonly sha256: string }[],
): Promise<{ readonly applied: readonly string[]; readonly pending: readonly string[] }> {
  const rows = await readLedger(api, config, false);
  const byName = new Map<string, string>();
  for (const row of rows) {
    const name = stringValue(row.name, "migration_ledger_name");
    if (byName.has(name)) fail("migration_ledger_duplicate");
    byName.set(name, stringValue(row.checksum, "migration_ledger_checksum"));
  }
  const knownNames = new Set(files.map((file) => file.name));
  for (const name of byName.keys()) {
    if (!knownNames.has(name)) fail("migration_ledger_unknown", name);
  }
  const applied: string[] = [];
  const pending: string[] = [];
  for (const file of files) {
    const checksum = byName.get(file.name);
    if (checksum === undefined) pending.push(file.name);
    else if (checksum !== file.sha256 && checksum !== `sha256:${file.sha256}`) fail("migration_checksum_drift", file.name);
    else applied.push(file.name);
  }
  return { applied, pending };
}

async function cleanup(
  api: CloudflareApi,
  config: BridgeConfig,
  worker: WorkerEvidence,
  desired: readonly DesiredContainer[],
): Promise<{ readonly deletedContainers: readonly string[]; readonly vectorDeleted: boolean }> {
  const deletedContainers: string[] = [];
  for (const row of desired) {
    const namespaceId = worker.namespaces.get(row.durableObjectClass);
    if (!namespaceId) fail("worker_namespace_for_container_missing", row.durableObjectClass);
    const matches = await listContainers(api, config, row.name);
    if (matches.length > 1) fail("container_name_ambiguous", row.name);
    if (!matches[0]) continue;
    const detail = await api.requestContainers(
      "GET",
      `/accounts/${pathSegment(config.accountId, "account_id")}/containers/applications/${pathSegment(matches[0].id, "container_id")}`,
    );
    if (!plainObject(detail) || !containerMatches(detail, row, namespaceId)) {
      fail("container_cleanup_ownership_unproven", row.name);
    }
    await api.requestContainers(
      "DELETE",
      `/accounts/${pathSegment(config.accountId, "account_id")}/containers/applications/${pathSegment(matches[0].id, "container_id")}`,
    );
    const remaining = await api.requestContainers(
      "GET",
      `/accounts/${pathSegment(config.accountId, "account_id")}/containers/applications/${pathSegment(matches[0].id, "container_id")}`,
      undefined,
      [],
      "delete-readback",
    );
    if (remaining !== null) fail("container_cleanup_readback_failed", row.name);
    deletedContainers.push(row.name);
  }
  let vectorDeleted = false;
  if (worker.vectorIndexes.has(config.vectorIndexName)) {
    const current = await readVector(api, config);
    if (current && !vectorMatches(current, config)) fail("vector_index_cleanup_ownership_unproven");
    if (current) {
      await api.request("DELETE", vectorPath(config));
      if ((await readVector(api, config)) !== null) fail("vector_index_cleanup_readback_failed");
      vectorDeleted = true;
    }
  }
  return { deletedContainers, vectorDeleted };
}

async function helperDigest(path: string): Promise<string> {
  return `sha256:${sha256(await readBounded(path, MAXIMUM_RESPONSE_BYTES))}`;
}

function compareTerraformStrings(left: string, right: string): number {
  // OpenTofu's sort() compares the UTF-8 string values lexicographically.
  // Compare encoded bytes rather than localeCompare so nested and non-ASCII
  // asset names have the same order on every runner.
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

async function workerArtifactDigest(
  workerArtifactPath: string,
  workerAssetsPath: string | undefined,
): Promise<string> {
  const workerDigest = sha256(
    await readBounded(workerArtifactPath, MAXIMUM_MIGRATION_BYTES),
  );
  if (workerAssetsPath === undefined) {
    // A pre-mode bridge state created before the asset boundary was added may
    // still be destroyed. Preserve its entry-only evidence while all new
    // Terraform-created bridge state passes the assets path below.
    return `sha256:${workerDigest}`;
  }

  const metadata = await lstat(workerAssetsPath).catch(() =>
    fail("worker_assets_path_missing"),
  );
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    fail("worker_assets_path_invalid");
  }
  const entries: Array<{ readonly path: string; readonly digest: string }> = [];
  async function visit(directory: string): Promise<void> {
    const children = await readdir(directory, { withFileTypes: true });
    for (const child of children) {
      const childPath = join(directory, child.name);
      const childMetadata = await lstat(childPath);
      if (childMetadata.isSymbolicLink()) fail("worker_asset_symlink");
      if (child.isDirectory()) {
        await visit(childPath);
        continue;
      }
      if (!child.isFile()) fail("worker_asset_file_invalid");
      if (childMetadata.size > MAXIMUM_MIGRATION_BYTES) {
        fail("worker_asset_file_too_large");
      }
      const digest = sha256(await readFile(childPath));
      const path = relative(workerAssetsPath, childPath).split(sep).join("/");
      entries.push({ path, digest });
    }
  }
  await visit(workerAssetsPath);
  entries.sort((left, right) => compareTerraformStrings(left.path, right.path));
  return `sha256:${sha256(new TextEncoder().encode([
    `worker/index.js:${workerDigest}`,
    ...entries.map(({ path, digest }) => `assets/${path}:${digest}`),
  ].join("|")))}`;
}

export function pendingDurableObjectMigration(
  currentTag: string | undefined,
  lifecycle: DurableObjectLifecycle,
): JsonObject | null {
  const targetTag = lifecycle.tags.at(-1)!;
  if (currentTag === targetTag) return null;
  let firstStep = 0;
  if (currentTag !== undefined) {
    const currentIndex = lifecycle.tags.indexOf(currentTag);
    if (currentIndex < 0) fail("durable_object_migration_tag_unknown");
    firstStep = currentIndex + 1;
  }
  const steps = lifecycle.steps.slice(firstStep);
  if (steps.length === 0) return null;
  return {
    ...(currentTag === undefined ? {} : { old_tag: currentTag }),
    new_tag: targetTag,
    steps: steps.map((step) => jsonValue(step, "durable_object_migration_step")),
  };
}

async function reconcileDurableObjectMigration(
  api: CloudflareApi,
  config: BridgeConfig,
): Promise<{ readonly changed: boolean; readonly tag: string }> {
  const lifecycle = config.durableObjectLifecycle;
  const bootstrapPath = config.durableObjectBootstrapPath;
  if (lifecycle === undefined || bootstrapPath === undefined) {
    fail("durable_object_bootstrap_config_missing");
  }
  const scriptsPath =
    `/accounts/${pathSegment(config.accountId, "account_id")}/workers/scripts`;
  const scripts = await api.request("GET", scriptsPath);
  if (!Array.isArray(scripts)) fail("worker_script_inventory_invalid");
  const matches = scripts.filter(
    (entry) => plainObject(entry) && entry.id === config.workerName,
  );
  if (matches.length > 1) fail("worker_script_inventory_ambiguous");
  const migrationTagValue = plainObject(matches[0])
    ? matches[0].migration_tag
    : undefined;
  if (
    migrationTagValue !== undefined &&
    migrationTagValue !== null &&
    typeof migrationTagValue !== "string"
  ) {
    fail("durable_object_migration_tag_invalid");
  }
  const currentTag =
    typeof migrationTagValue === "string" && migrationTagValue.trim() !== ""
      ? migrationTagValue.trim()
      : undefined;
  const migrations = pendingDurableObjectMigration(currentTag, lifecycle);
  const targetTag = lifecycle.tags.at(-1)!;
  if (migrations === null) return { changed: false, tag: targetTag };

  await uploadDurableObjectBootstrap(api, config, migrations, false);
  return { changed: true, tag: targetTag };
}

function bootstrapMetadata(
  config: BridgeConfig,
  migrations: JsonObject | null,
  includeVectorBinding: boolean,
): JsonObject {
  const lifecycle = config.durableObjectLifecycle;
  if (lifecycle === undefined) fail("durable_object_bootstrap_config_missing");
  const bindings: JsonObject[] = lifecycle.containerBindings.map(({ name, className }) => ({
    name,
    type: "durable_object_namespace",
    class_name: className,
  }));
  if (includeVectorBinding) {
    bindings.push({
      name: "VECTORIZE",
      type: "vectorize",
      index_name: config.vectorIndexName,
    });
  }
  return {
    main_module: "durable-object-migration-bootstrap.js",
    compatibility_date: "2026-04-01",
    bindings,
    containers: lifecycle.containerBindings.map(({ className }) => ({
      class_name: className,
    })),
    ...(migrations === null ? {} : { migrations }),
  };
}

async function uploadDurableObjectBootstrap(
  api: CloudflareApi,
  config: BridgeConfig,
  migrations: JsonObject | null,
  includeVectorBinding: boolean,
): Promise<void> {
  const bootstrapPath = config.durableObjectBootstrapPath;
  if (bootstrapPath === undefined || config.durableObjectLifecycle === undefined) {
    fail("durable_object_bootstrap_config_missing");
  }

  const bootstrap = await readBounded(bootstrapPath, MAXIMUM_MIGRATION_BYTES);
  const moduleName = "durable-object-migration-bootstrap.js";
  const metadata = bootstrapMetadata(config, migrations, includeVectorBinding);
  const form = new FormData();
  form.set("metadata", JSON.stringify(metadata));
  form.set(
    moduleName,
    new Blob([bootstrap], { type: "application/javascript+module" }),
    moduleName,
  );
  const uploadPath =
    `/accounts/${pathSegment(config.accountId, "account_id")}/workers/scripts/${pathSegment(config.workerName, "worker_name")}` +
    "?excludeScript=true&bindings_inherit=strict";
  await api.requestMultipart(uploadPath, form);
}

async function establishVectorOwnershipProof(
  api: CloudflareApi,
  config: BridgeConfig,
): Promise<void> {
  // The first migration upload intentionally has only Durable Object
  // bindings: Cloudflare requires the namespace migration before a
  // Container-enabled namespace can be attached.  Once Vectorize exists,
  // publish a second bootstrap Version with the exact Vectorize binding and
  // read that active Version back.  Cleanup may delete the index only from
  // this provider-authoritative binding evidence; a local boolean is not an
  // ownership proof.
  const current = await workerEvidence(api, config);
  if (current.vectorIndexes.has(config.vectorIndexName)) return;
  await uploadDurableObjectBootstrap(api, config, null, true);
  const attested = await workerEvidence(api, config);
  if (!attested.vectorIndexes.has(config.vectorIndexName)) {
    fail("worker_vector_binding_readback_missing");
  }
}

function capabilityPreflightEvidence(
  config: CapabilityPreflightConfig,
): BridgeEvidence {
  const bridgeActivationDigest = digest({
    mode: config.bridgeMode,
    environment: config.bridgeEnvironment,
    acknowledgementDigest: config.bridgeAcknowledgementDigest,
  });
  const preflightDigest = digest({
    phase: "capability-preflight",
    accountId: config.accountId,
    bridgeActivationDigest,
  });
  const notCheckedDigest = digest({
    phase: "capability-preflight",
    state: "not-checked",
  });
  return {
    ok: true,
    phase: "capability-preflight",
    bridgeMode: config.bridgeMode,
    bridgeEnvironment: config.bridgeEnvironment,
    digests: {
      desiredDigest: preflightDigest,
      bridgeActivationDigest,
      helperDigest: notCheckedDigest,
      migrationDigest: notCheckedDigest,
      workerArtifactDigest: notCheckedDigest,
    },
    changed: false,
    durableObjects: { status: "not-checked" },
    vector: { status: "present" },
    d1: { applied: [], pending: [] },
    containers: { reconciled: [], deleted: [] },
  };
}

export async function runBridge(
  phase: BridgePhase | string,
  options: BridgeFetchOptions = {},
): Promise<BridgeEvidence> {
  const selectedPhase = typeof phase === "string" ? phaseValue(phase) : phase;
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  if (selectedPhase === "capability-preflight") {
    const config = parseCapabilityPreflightConfig(options);
    const token = envValue(env, ["CLOUDFLARE_API_TOKEN"], true)!;
    const api = new CloudflareApi(config.accountId, token, fetchImpl, options);
    await probeContainersCapability(api, config);
    return capabilityPreflightEvidence(config);
  }
  const config = await parseBridgeConfig(options, selectedPhase);
  const token = envValue(env, ["CLOUDFLARE_API_TOKEN"], true)!;
  const [migrationSet, workerArtifactEvidence, bridgeDigest, bootstrapDigest] = await Promise.all([
    migrationFiles(config.migrationSetPath),
    workerArtifactDigest(config.workerArtifactPath, config.workerAssetsPath),
    helperDigest(options.helperPath ?? fileURLToPath(import.meta.url)),
    config.durableObjectBootstrapPath === undefined
      ? Promise.resolve(undefined)
      : readBounded(config.durableObjectBootstrapPath, MAXIMUM_MIGRATION_BYTES)
          .then((bytes) => `sha256:${sha256(bytes)}`),
  ]);
  const containerDesired =
    selectedPhase === "pre-worker"
      ? []
      : config.containerDesiredConfigContent !== undefined
        ? containerRowsFromContent(config.containerDesiredConfigContent, env)
        : config.containerDesiredConfigPath === undefined
          ? []
          : await containerRows(config.containerDesiredConfigPath, env);
  const migrationDigest = digest(migrationSet.map(({ name, sha256: checksum }) => ({ name, sha256: checksum })));
  const bridgeActivationDigest = digest({
    mode: config.bridgeMode,
    environment: config.bridgeEnvironment,
    acknowledgementDigest: config.bridgeAcknowledgementDigest,
  });
  const desiredDigest = digest({
    accountId: config.accountId,
    workerName: config.workerName,
    d1DatabaseId: config.d1DatabaseId,
    vector: {
      name: config.vectorIndexName,
      dimensions: config.vectorDimensions,
      metric: config.vectorMetric,
    },
    containers: containerDesired,
    durableObjects: config.durableObjectLifecycle,
    bridge: {
      mode: config.bridgeMode,
      environment: config.bridgeEnvironment,
      acknowledgementDigest: config.bridgeAcknowledgementDigest,
    },
  });
  const digests: BridgeDigests = {
    desiredDigest,
    bridgeActivationDigest,
    ...(bootstrapDigest === undefined
      ? {}
      : { durableObjectBootstrapDigest: bootstrapDigest }),
    helperDigest: bridgeDigest,
    migrationDigest,
    workerArtifactDigest: workerArtifactEvidence,
  };
  const api = new CloudflareApi(config.accountId, token, fetchImpl, options);
  let vector: "present" | "created" | "deleted" = "present";
  let durableObjects: {
    status: "present" | "migrated" | "not-checked";
    tag?: string;
  } = { status: "not-checked" };
  let d1: { applied: readonly string[]; pending: readonly string[] } = {
    applied: [],
    pending: [],
  };
  let reconciled: readonly string[] = [];
  let deleted: readonly string[] = [];
  let workerVersion: string | undefined;
  let changed = false;
  if (selectedPhase === "pre-worker") {
    await probeContainersCapability(api, config);
    const durableObjectResult = await reconcileDurableObjectMigration(api, config);
    durableObjects = {
      status: durableObjectResult.changed ? "migrated" : "present",
      tag: durableObjectResult.tag,
    };
    vector = await reconcileVector(api, config);
    await establishVectorOwnershipProof(api, config);
    const migrationResult = await reconcileMigrations(api, config, migrationSet);
    d1 = { applied: migrationResult.applied, pending: migrationResult.pending };
    changed =
      durableObjectResult.changed ||
      vector === "created" ||
      migrationResult.newlyApplied.length > 0;
  } else {
    const worker = await workerEvidence(api, config);
    workerVersion = worker.versionId;
    if (selectedPhase === "post-worker") {
      // Container reconciliation is deliberately after the authoritative
      // Worker-version readback.  A guessed Durable Object namespace would
      // orphan an application and is therefore never accepted.
      const result = await reconcileContainers(api, config, worker, containerDesired);
      reconciled = result.names;
      d1 = await verifyMigrations(api, config, migrationSet);
      const current = await readVector(api, config);
      if (!current || !vectorMatches(current, config)) fail("vector_index_verification_failed");
      changed = result.changed;
    } else if (selectedPhase === "verify") {
      const current = await readVector(api, config);
      if (!current || !vectorMatches(current, config)) fail("vector_index_verification_failed");
      d1 = await verifyMigrations(api, config, migrationSet);
      for (const row of containerDesired) {
        const namespaceId = worker.namespaces.get(row.durableObjectClass);
        if (!namespaceId) fail("worker_namespace_for_container_missing", row.durableObjectClass);
        const matches = await listContainers(api, config, row.name);
        if (matches.length !== 1) fail("container_verification_missing_or_ambiguous", row.name);
        const detail = await api.requestContainers(
          "GET",
          `/accounts/${pathSegment(config.accountId, "account_id")}/containers/applications/${pathSegment(matches[0]!.id, "container_id")}`,
        );
        if (!plainObject(detail) || !containerMatches(detail, row, namespaceId)) fail("container_verification_drifted", row.name);
        reconciled = [...reconciled, row.name];
      }
    } else {
      // Recovery cleanup is deliberately independent of the D1 migration
      // ledger.  A failed pre-worker phase may have created Vectorize or
      // Container resources before the ledger table existed, and a bare
      // SELECT would prevent ownership-proven cleanup from reaching them.
      // D1 is never rolled back here; leave its evidence empty rather than
      // claiming a ledger read that was intentionally skipped.
      const result = await cleanup(api, config, worker, containerDesired);
      deleted = result.deletedContainers;
      vector = result.vectorDeleted ? "deleted" : "present";
      changed = deleted.length > 0 || result.vectorDeleted;
    }
  }
  return {
    ok: true,
    phase: selectedPhase,
    bridgeMode: config.bridgeMode,
    bridgeEnvironment: config.bridgeEnvironment,
    digests,
    changed,
    durableObjects,
    vector: { status: vector },
    d1,
    containers: { reconciled, deleted },
    ...(workerVersion === undefined ? {} : { workerVersion }),
  };
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  return pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
  const phase = process.argv[2];
  if (!phase) {
    process.stderr.write("bridge phase is required\n");
    process.exitCode = 2;
  } else {
    try {
      const evidence = await runBridge(phase);
      process.stdout.write(`${JSON.stringify(evidence)}\n`);
    } catch (error) {
      const code = error instanceof BridgeFailure ? error.code : "bridge_failed";
      const detail = error instanceof BridgeFailure ? error.detail : undefined;
      // Never include Error.message here: API failures may contain provider
      // response text, and a malformed operator environment must not echo a
      // token accidentally supplied through a shell wrapper.
      process.stderr.write(`${JSON.stringify(bridgeFailurePayload(code, detail))}\n`);
      process.exitCode = 1;
    }
  }
}
