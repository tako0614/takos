#!/usr/bin/env bun

import { createHash, createPublicKey, createVerify, randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPORT_KIND = "takos.takoserver-fetch-tracer@v1" as const;
export const REPORT_LABEL = "public-registry-provider-4.0.0" as const;
export const BUILD_IDENTITY =
  "takos-fetch-tracer@public-registry-provider-4.0.0" as const;
export const FIXED_CONFIG_VALUE = "fetch-tracer-config-v1" as const;
export const PROVIDER_SOURCE = "registry.terraform.io/tako0614/takoform" as const;
export const PROVIDER_VERSION = "4.0.0" as const;
export const PROVIDER_CONSTRAINT = "= 4.0.0" as const;
export const V1_DISCOVERY_PATH = "/.well-known/takoform/v1" as const;
export const V1_API_VERSION = "forms.takoform.com/v1" as const;
export const FORM_API_VERSION = "edge.forms.takoform.com" as const;
export const FORM_DEFINITION_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
export const DIGEST = /^sha256:[0-9a-f]{64}$/u;
export const MUTATION_TOKEN_ENV = "TAKOFORM_TOKEN" as const;
export const EVIDENCE_TOKEN_ENV = "TAKOFORM_EVIDENCE_TOKEN" as const;
export const NONCE_BYTES = 32;
export const NONCE_PATTERN = /^[0-9a-f]{64}$/u;
export const DEFAULT_ENDPOINT_ORIGIN_TEMPLATE = "https://{project}.invalid/";
export const NATIVE_ABSENCE_KIND =
  "takos.takoserver-native-absence@v1" as const;
export const PUBLIC_PROVIDER_H1_HASHES = [
  "h1:RYNZ0RDeAKvA8Ty+EZqSOA5nv+xpkgMyJux6XcHnNns=",
] as const;
export const PUBLIC_PROVIDER_ZH_HASHES = [
  "zh:1a70d45661665b3ad799196637e93dd7765323b32fbc7eba7bd30496e225e3bd",
  "zh:23fc2f43deec7e9bf20a4fe8253169fdbaa163840a8fdf8dfe1f4293f2346044",
  "zh:3a7d9e2f0edf19713a1df989b32541efe1ac5cf0926ca7a0c3b421e8acd3a633",
  "zh:a2b1f6c0bda3065c1e181db3b97eef52d9c823a74dc25e19339a4881ff501b17",
  "zh:ecd934d19ff177229afd0a9248ea2b37ef2a8bba8182f03acf21b36b4b9e2298",
  "zh:f809ab383cca0a5f83072981c64208cbd7fa67e986a86ee02dd2c82333221e32",
] as const;
export const PUBLIC_PROVIDER_CHECKSUM_SOURCE =
  "https://github.com/tako0614/terraform-provider-takoform/releases/download/v4.0.0/terraform-provider-takoform_4.0.0_SHA256SUMS" as const;
export const PUBLIC_PROVIDER_SIGNATURE_SOURCE =
  "https://github.com/tako0614/terraform-provider-takoform/releases/download/v4.0.0/terraform-provider-takoform_4.0.0_SHA256SUMS.sig" as const;
export const PUBLIC_PROVIDER_SIGNING_KEY_ID = "34FC18AC897FB709" as const;
export const PUBLIC_PROVIDER_SIGNING_KEY_FINGERPRINT =
  "3510E75E05BBCC303B92D77934FC18AC897FB709" as const;
export const PUBLIC_PROVIDER_SIGNING_KEY_ARMOR = `-----BEGIN PGP PUBLIC KEY BLOCK-----

mQINBGpY850BEADWlLOv6ejKaRbz07ncTkfgVanb/QGRdeuQqy0vGuNw+59diQ0s
NbMOHhKe+16i8/+f6XOtrP2jt1WuhyTxwdi7dzm26aT2k19y2P4qwJoLkE4lGjXg
GMCXEDjWM3YY4gBCILJ6vGoiIj9SBudriiYxziCBuidW38TcRw734gQz7/6Dmeg4
WLBFdceRKD+iKUNWj6pyGPufdjA5yi6wpyaaesAnrS4EaTpCFCZ7YmUkA9SU4J65
3ypCYTobwwmp5dGBuzC60FqpVUr42e7EkGXekwKdpZp3+JPbqVtayBRkgbLK4e1H
+rl9xZXCD1mziQxF+Xp4RBuIZ4dojsqS5IahC98dg1NmYIrc0cYmhCy1SqkaPa5c
sB0GH/HDg3LV5k9nYIJ3PfWAH9OgYptVlif3nadqHufgGTHaK5ucoCYZi+NZdCFd
n2tZBUcSApTobVfEsz5Er/V2S4lHteyFyCTlQj7eGlZXVY128EhX8Qs7pwv3AYmB
qTGEKCjBLwvEbd7UwHloTSN/QgfzXwSQVEBHl3UkB3SAauSNnoG10uU5ecVXrojo
qbbjPZcezU8JcAPXxlqYN+C4KhZXvxrq7G9kju/14kaPNxMApeVc/VXKcMDBpmSw
YOQ+wtDgnnNHeFKc/A5G3GWsi8mNe0ZFEudzwEoppDqO+A6arjROD/gO4wARAQAB
tCFUYWtvZm9ybSBQcm92aWRlciBSZWxlYXNlIFNpZ25pbmeJAlQEEwEKAD4WIQQ1
EOdeBbvMMDuS13k0/BisiX+3CQUCaljznQIbAwUJA8JnAAULCQgHAgYVCgkICwIE
FgIDAQIeAQIXgAAKCRA0/BisiX+3CbQFD/9vyoLv5KOTP/UHOdWicOPdmUV9OH1z
SDAHspFUWqxLaQQnvWVZ1xRpTpNe6PppXtW2+Z4/3DJRdcEJ7bUmlIvvDVwyLD7a
9PbmTYcBbr1LLVU/I+yJ0whoRqkC4mmkU5jSp4WdZatkzERjmWxtNqKxzLHMH/5k
O5LIRUW71udqQt9fCZp7zUz6Fnlq87Dtp7dUSvlRr9gdoqy/FaQrihJTDbl7fCfX
oQR4nY/XJlnHTpxVQqWW/Bz8dYIXT+T6OOF4FMfEbZc/ASTIVTlGpW3WS7G6YHtK
iqglFURcFzVZEoxr6S6R4Lv85rS9JULZWYsiI1sw7E/NVZfyEs3YlRqRs6pCERHV
mRnaMK83UhN7U8tLveOSeQiJOZNKTMKfMrPki+cJ2Yfowa66BQ7gPl0TZoanp4GQ
fI3wEVE41jgsWxu/QZj1Q2kOcluZKvvaAxxt2CNXF+9JkdUrT7dFPCGsIJGX72bD
HYQCsuc9Ul0Cm+MprVfm+UWVpk2a4k9sFWRZnlzFtVZ8fQthjMZZ6RTqNzUstqz3
2uhf+YpnDx7xOUk9OE256E/A123vA6gotM2HFEDc2xGv1O5uzdye9XljmB/tuBo+
2mVqdBeL8zUPbMop7TRYRL34ptosDfEhSaZ83GWXUOlL6X7zvXs6RYk4F1JVxP9i
6PyCT9KNR4QTxA==
=epJt
-----END PGP PUBLIC KEY BLOCK-----
` as const;
export const PUBLIC_PROVIDER_REGISTRY_DOWNLOAD_BASE =
  "https://registry.terraform.io/v1/providers/tako0614/takoform/4.0.0/download" as const;
export const PUBLIC_PROVIDER_PLATFORMS = [
  ["darwin", "amd64"],
  ["darwin", "arm64"],
  ["linux", "amd64"],
  ["linux", "arm64"],
  ["windows", "amd64"],
] as const;
const PUBLIC_PROVIDER_PLATFORM_SHASUMS: Readonly<Record<string, string>> = {
  "darwin/amd64": "a2b1f6c0bda3065c1e181db3b97eef52d9c823a74dc25e19339a4881ff501b17",
  "darwin/arm64": "1a70d45661665b3ad799196637e93dd7765323b32fbc7eba7bd30496e225e3bd",
  "linux/amd64": "23fc2f43deec7e9bf20a4fe8253169fdbaa163840a8fdf8dfe1f4293f2346044",
  "linux/arm64": "3a7d9e2f0edf19713a1df989b32541efe1ac5cf0926ca7a0c3b421e8acd3a633",
  "windows/amd64": "ecd934d19ff177229afd0a9248ea2b37ef2a8bba8182f03acf21b36b4b9e2298",
};
const MAX_PROVIDER_RELEASE_BYTES = 4 * 1024 * 1024;
export const RESOURCE_KEYS = [
  "module_worker",
  "worker_bundle",
  "worker_version",
  "worker_deployment",
  "worker_endpoint",
] as const;

const RESOURCE_KINDS: Record<ResourceKey, string> = {
  module_worker: "ModuleWorker",
  worker_bundle: "WorkerBundle",
  worker_version: "WorkerVersion",
  worker_deployment: "WorkerDeployment",
  worker_endpoint: "WorkerEndpoint",
};

const MAX_OUTPUT_BYTES = 128 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_NATIVE_RESIDUAL_COUNT = 1_000_000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_KILL_GRACE_MS = 5_000;
const FIXED_FEATURES = [
  "service_forms",
  "exact_form_ref",
  "optimistic_concurrency",
  "idempotent_lifecycle",
  "operations",
  "artifact_upload",
  "support_profiles",
] as const;

export type ResourceKey = (typeof RESOURCE_KEYS)[number];
export type JsonRecord = Record<string, unknown>;
export type SecretInput = string | readonly string[];

export const TRACER_MILESTONES = [
  "workspace_prepared",
  "provider_release_verified",
  "init_completed",
  "toolchain_verified",
  "provider_verified",
  "discovery_completed",
  "validate_completed",
  "plan_completed",
  "plan_verified",
  "apply_attempted",
  "apply_completed",
  "outputs_completed",
  "resource_readback_completed",
  "runtime_probe_completed",
  "provenance_completed",
  "destroy_completed",
  "state_empty",
  "absence_completed",
  "endpoint_absence_completed",
  "endpoint_absence_not_applicable",
  "native_absence_completed",
  "native_absence_not_applicable",
  "workdir_removed",
] as const;
export type TracerMilestone = (typeof TRACER_MILESTONES)[number];

/**
 * The public Provider 4.0.0 surface is deliberately pinned to these five
 * current Edge FormRefs. A syntactically valid FormRef from another line is
 * not evidence for this tracer and must fail closed.
 */
export const PROVIDER4_FORM_REFS: Readonly<Record<ResourceKey, {
  readonly apiVersion: typeof FORM_API_VERSION;
  readonly kind: string;
  readonly definitionVersion: string;
  readonly schemaDigest: string;
}>> = {
  module_worker: {
    apiVersion: FORM_API_VERSION,
    kind: "ModuleWorker",
    definitionVersion: "0.1.0",
    schemaDigest: "sha256:049df2fb1eda53e4ccb0d646022a3ded8bc17c44eb433fa2e5ac0861efe42ac7",
  },
  worker_bundle: {
    apiVersion: FORM_API_VERSION,
    kind: "WorkerBundle",
    definitionVersion: "0.1.0",
    schemaDigest: "sha256:cb21984a579ae2706bddada8b44a22c0f8390994550c10d7c65df82edfa1141b",
  },
  worker_version: {
    apiVersion: FORM_API_VERSION,
    kind: "WorkerVersion",
    definitionVersion: "0.3.0",
    schemaDigest: "sha256:65870343bfab512fe5e7ae6faea8b3dbc48f9c9de0d4d9349dcbfd819f06d365",
  },
  worker_deployment: {
    apiVersion: FORM_API_VERSION,
    kind: "WorkerDeployment",
    definitionVersion: "0.2.0",
    schemaDigest: "sha256:3d5174bf2c3f351cf1468607689019e9eaa503a353eceb3095cf3d31bad62081",
  },
  worker_endpoint: {
    apiVersion: FORM_API_VERSION,
    kind: "WorkerEndpoint",
    definitionVersion: "0.1.0",
    schemaDigest: "sha256:732f60aba45ce360d5ebbc6ac2e55fe4d59b65d353f4628e93960d71fbc2870f",
  },
};
export const PROVIDER_FORM_REFS = PROVIDER4_FORM_REFS;

const DEFAULT_PROJECT_NAME = "takos-fetch-tracer";
const SOURCE_INVENTORY = [
  "package.json",
  "scripts/takoserver-fetch-tracer.ts",
  "scripts/__tests__/takoserver-fetch-tracer.test.ts",
  "scripts/__tests__/takoserver-fetch-tracer.online.test.ts",
  "deploy/opentofu/takoserver-fetch-tracer/README.md",
  "deploy/opentofu/takoserver-fetch-tracer/main.tf",
  "deploy/opentofu/takoserver-fetch-tracer/variables.tf",
  "deploy/opentofu/takoserver-fetch-tracer/outputs.tf",
  "deploy/opentofu/takoserver-fetch-tracer/worker.mjs",
  "deploy/opentofu/takoserver-fetch-tracer/.terraform.lock.hcl",
] as const;

export type CliConfig = {
  readonly host: string;
  readonly organizationId: string;
  readonly space: string;
  /** Exact endpoint origin template; `{project}` is the only placeholder. */
  readonly endpointOriginTemplate: string;
  readonly tokenEnv: string;
  readonly token: string;
  readonly evidenceTokenEnv: string;
  readonly evidenceToken: string;
  readonly tofu: string;
  readonly timeoutMs: number;
  readonly killGraceMs: number;
  readonly configValue: string;
  readonly fixtureDir: string;
};

export type RunIdentity = {
  readonly nonce: string;
  readonly projectUid: string;
  readonly projectName: string;
};

export function createRunIdentity(): RunIdentity {
  const nonce = randomBytes(NONCE_BYTES).toString("hex");
  if (!NONCE_PATTERN.test(nonce)) throw new TracerError("generated run nonce was not canonical");
  const projectUid = `puid-${nonce}`;
  const projectName = `${DEFAULT_PROJECT_NAME}-${nonce.slice(0, 12)}`;
  return { nonce, projectUid, projectName };
}

export type ResourceAddress = {
  readonly name: string;
  readonly space: string;
  readonly form_api_version: string;
  readonly form_kind: string;
  readonly form_definition_version: string;
  readonly form_schema_digest: string;
};

export type ResourceIdentity = {
  readonly name: string;
  readonly space: string;
  readonly uid: string;
  readonly generation: string;
  readonly revision: string;
  readonly ready: boolean;
  readonly form_api_version: string;
  readonly form_kind: string;
  readonly form_definition_version: string;
  readonly form_schema_digest: string;
  readonly hostname?: string | null;
  readonly url?: string | null;
};

export type Discovery = {
  readonly apiRoot: string;
  readonly document: JsonRecord;
};

export type BoundedOutput = {
  readonly text: string;
  readonly truncated: boolean;
};

export type CommandResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type SpawnedChild = {
  readonly pid?: number;
  readonly exited: Promise<number>;
  readonly stdout?: ReadableStream<Uint8Array> | null;
  readonly stderr?: ReadableStream<Uint8Array> | null;
  kill?: (signal?: string | number) => void;
};

export type ProjectResourceAddresses = Record<ResourceKey, ResourceAddress>;

/**
 * Provider 4 derives immutable revision names from both the content digest
 * and the declared revision owner.  Keep the name inputs together so plan,
 * output, readback, and post-destroy absence all address the same immutable
 * Host resources.
 */
export type RevisionNameContext = {
  readonly bundleManifestDigest: string;
  readonly bundleName: string;
  readonly workerVersionName: string;
};

export type SpawnFunction = (
  argv: readonly string[],
  options: Record<string, unknown>,
) => SpawnedChild;

export type FetchFunction = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class TracerError extends Error {
  readonly recoveryPath?: string;
  readonly causeError?: unknown;
  readonly cleanupError?: unknown;
  readonly completedMilestones?: readonly TracerMilestone[];

  constructor(message: string, options: {
    recoveryPath?: string;
    cause?: unknown;
    cleanupError?: unknown;
    completedMilestones?: readonly TracerMilestone[];
  } = {}) {
    super(message);
    this.name = "TracerError";
    this.recoveryPath = options.recoveryPath;
    this.causeError = options.cause;
    this.cleanupError = options.cleanupError;
    this.completedMilestones = options.completedMilestones;
  }
}

export class HelpRequestedError extends TracerError {
  constructor() {
    super(usage());
    this.name = "HelpRequestedError";
  }
}

export class CommandError extends TracerError {
  readonly command: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;

  constructor(input: {
    command: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    token?: SecretInput;
  }) {
    const stdout = redactOutput(input.stdout, input.token);
    const stderr = redactOutput(input.stderr, input.token);
    super(
      `${basename(input.command)} exited with status ${input.exitCode}` +
        (stderr.trim() ? `: ${singleLine(stderr)}` : ""),
    );
    this.name = "CommandError";
    this.command = input.command;
    this.exitCode = input.exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

export class CommandTimeoutError extends TracerError {
  readonly command: string;
  readonly stdout: string;
  readonly stderr: string;

  constructor(input: {
    command: string;
    stdout: string;
    stderr: string;
    token?: SecretInput;
    timeoutMs: number;
  }) {
    const stdout = redactOutput(input.stdout, input.token);
    const stderr = redactOutput(input.stderr, input.token);
    super(`${basename(input.command)} exceeded the ${input.timeoutMs}ms deadline`);
    this.name = "CommandTimeoutError";
    this.command = input.command;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

function singleLine(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? " " : character;
  }).join("").trim().slice(0, 512);
}

function ownKeys(value: object): string[] {
  return Object.keys(value).sort();
}

function assertClosedKeys(
  value: JsonRecord,
  required: readonly string[],
  optional: readonly string[],
  subject: string,
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!(key in value)) throw new TracerError(`${subject} is missing ${key}`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TracerError(`${subject} contains unexpected ${key}`);
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, subject: string): JsonRecord {
  if (!isRecord(value)) throw new TracerError(`${subject} must be an object`);
  return value;
}

function requireString(value: unknown, subject: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TracerError(`${subject} must be a non-empty string`);
  }
  return value;
}

function secretValues(secret?: SecretInput): readonly string[] {
  const values = Array.isArray(secret) ? secret : secret ? [secret] : [];
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))].sort((a, b) => b.length - a.length);
}

export function redactOutput(value: string, secret?: SecretInput): string {
  let output = value;
  for (const valueToRedact of secretValues(secret)) {
    output = output.split(valueToRedact).join("<redacted>");
  }
  return output;
}

function containsSecret(value: string, secret?: SecretInput): boolean {
  return secretValues(secret).some((valueToRedact) => value.includes(valueToRedact));
}

const PROXY_CREDENTIAL_PATTERN = /[a-z][a-z0-9+.-]*:\/\/[^/\s@]*@/iu;
const PATH_TRAVERSAL_PATTERN = /(?:^|[\\/])\.\.(?:[\\/]|$)/u;
const SENSITIVE_FIELD_PATTERN = /(?:^|_)(?:TOKEN|PASSWORD|PASSWD|SECRET|PRIVATE_KEY|CLIENT_KEY|AUTHORIZATION|AUTH_TOKEN|ACCESS_KEY|CREDENTIALS?)(?:$|_)/iu;
const PATH_FIELD_PATTERN = /(?:^|_)(?:PATH|HOME|TMP|TMPDIR|TEMP|DIR|FILE|ROOT|CWD|WORKDIR|RECOVERYPATH|CONFIG_GLOBAL|CONFIG_NOSYSTEM)(?:$|_)/iu;
const PROXY_FIELD_PATTERN = /^(?:HTTP|HTTPS|ALL|NO)_PROXY$/iu;

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

/**
 * Fail closed before diagnostics or reports are serialized. This walks the
 * complete enumerable JSON-shaped value, rather than checking only the
 * top-level report fields, so a provider/command error cannot smuggle a
 * credential through a nested cause, proxy URL, or unsafe path. Paths in
 * error messages are intentionally not included in the thrown message: an
 * offending key or value may itself contain the secret we are protecting.
 */
export function assertNoKnownSecrets(value: unknown, secret?: SecretInput): void {
  const secrets = secretValues(secret);
  const seen = new WeakSet<object>();
  const visit = (current: unknown, key?: string): void => {
    if (typeof current === "string") {
      if (containsSecret(current, secrets)) {
        throw new TracerError("serialized output contained a known secret");
      }
      if (containsControlCharacter(current)) {
        throw new TracerError("serialized output contained an unsafe control character");
      }
      if (PROXY_CREDENTIAL_PATTERN.test(current)) {
        throw new TracerError("serialized output contained proxy credentials");
      }
      if (key && PATH_FIELD_PATTERN.test(key) && PATH_TRAVERSAL_PATTERN.test(current)) {
        throw new TracerError("serialized output contained an unsafe path");
      }
      if (key && SENSITIVE_FIELD_PATTERN.test(key) && current.length > 0) {
        throw new TracerError("serialized output contained a sensitive credential field");
      }
      return;
    }
    if (current === null || typeof current === "boolean" || typeof current === "number" || current === undefined) return;
    if (typeof current === "bigint" || typeof current === "function" || typeof current === "symbol") {
      throw new TracerError("serialized output contained a non-JSON value");
    }
    if (typeof current !== "object") return;
    if (seen.has(current)) return;
    seen.add(current);
    let keys: string[];
    try {
      keys = Object.keys(current);
    } catch {
      throw new TracerError("serialized output could not be inspected safely");
    }
    for (const childKey of keys) {
      if (containsSecret(childKey, secrets) || containsControlCharacter(childKey)) {
        throw new TracerError("serialized output contained an unsafe field name");
      }
      let child: unknown;
      try {
        child = (current as Record<string, unknown>)[childKey];
      } catch {
        throw new TracerError("serialized output could not be inspected safely");
      }
      visit(child, childKey);
    }
  };
  visit(value);
}

function safeErrorMessage(error: unknown, secrets?: SecretInput): string {
  const message = error instanceof Error ? error.message : String(error);
  return singleLine(redactOutput(message, secrets));
}

function normalizedHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/gu, "").replace(/\.$/u, "");
}

function isForbiddenEndpointHostname(hostname: string): boolean {
  const normalized = normalizedHostname(hostname);
  if (!normalized || isIP(normalized) !== 0) return true;
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  // A project-derived hostname must not point at a private/link-local/ULA
  // literal. DNS resolution is deliberately not performed here: accepting an
  // arbitrary suffix would make the GET susceptible to DNS rebinding.
  if (
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".localtest.me") ||
    normalized.endsWith(".localhost.localdomain") ||
    normalized.endsWith(".nip.io") ||
    normalized.endsWith(".sslip.io") ||
    normalized.endsWith(".xip.io") ||
    normalized.endsWith(".lvh.me")
  ) return true;
  if (/^(?:0|10|127|169\.254|172\.(?:1[6-9]|2[0-9]|3[0-1])|192\.168|198\.(?:18|19))(?:\.|$)/u.test(normalized)) return true;
  return false;
}

/**
 * Validate the operator's endpoint descriptor before any endpoint GET. The
 * project placeholder is required so an assigned Host URL cannot be smuggled
 * in as an arbitrary suffix or path.
 */
export function validateEndpointOriginTemplate(value: string): string {
  if (typeof value !== "string") {
    throw new TracerError("endpoint-origin-template is required");
  }
  const template = value.trim();
  if (!template || template !== value) {
    throw new TracerError("endpoint-origin-template must be a non-empty URL without surrounding whitespace");
  }
  const matches = template.match(/\{project\}/gu) ?? [];
  if (matches.length !== 1 || /\{[^}]+\}/u.test(template.replace("{project}", ""))) {
    throw new TracerError("endpoint-origin-template must contain exactly one {project} placeholder and no other placeholders");
  }
  const materialized = template.replace("{project}", "takos-fetch-tracer-project");
  let parsed: URL;
  try {
    parsed = new URL(materialized);
  } catch {
    throw new TracerError("endpoint-origin-template must be an absolute URL");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/" ||
    isForbiddenEndpointHostname(parsed.hostname)
  ) {
    throw new TracerError("endpoint-origin-template must be an HTTPS origin-root hostname derived from project");
  }
  const hostnameTemplate = template.slice("https://".length).replace(/\/$/u, "");
  if (!hostnameTemplate.includes("{project}")) {
    throw new TracerError("endpoint-origin-template must derive its hostname from {project}");
  }
  return template;
}

export function materializeEndpointOrigin(template: string, projectName: string): string {
  const checked = validateEndpointOriginTemplate(template);
  if (!/^[a-z][a-z0-9-]{0,62}$/u.test(projectName)) {
    throw new TracerError("project_name must be canonical before endpoint materialization");
  }
  const origin = checked.replace("{project}", projectName);
  const parsed = new URL(origin);
  if (parsed.toString() !== origin || parsed.pathname !== "/") {
    throw new TracerError("materialized endpoint origin is not canonical");
  }
  return parsed.toString();
}

function assertEndpointTarget(input: {
  readonly assignedUrl: string;
  readonly hostname?: string | null;
  readonly expectedOrigin: string;
  readonly targetHost: string;
}): URL {
  let url: URL;
  try {
    url = new URL(input.assignedUrl);
  } catch {
    throw new TracerError("WorkerEndpoint URL is not an absolute URL");
  }
  if (url.toString() !== input.assignedUrl || url.origin + url.pathname !== input.expectedOrigin) {
    throw new TracerError("WorkerEndpoint URL does not match the exact project-derived endpoint origin");
  }
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new TracerError("WorkerEndpoint URL must be an HTTPS path-root URL");
  }
  if (input.hostname && normalizedHostname(input.hostname) !== normalizedHostname(url.hostname)) {
    throw new TracerError("WorkerEndpoint hostname and URL do not match");
  }
  if (isForbiddenEndpointHostname(url.hostname)) {
    throw new TracerError("WorkerEndpoint URL hostname is an IP, loopback, private, or local address");
  }
  let hostUrl: URL;
  try {
    hostUrl = new URL(input.targetHost);
  } catch {
    throw new TracerError("target Host origin is not an absolute URL");
  }
  const loopbackDiagnostic = hostUrl.protocol === "http:" && isLoopback(hostUrl.hostname);
  if (loopbackDiagnostic) {
    if (!normalizedHostname(url.hostname).endsWith(".invalid")) {
      throw new TracerError("loopback diagnostic Host must use a .invalid endpoint hostname");
    }
  } else if (normalizedHostname(url.hostname).endsWith(".invalid")) {
    throw new TracerError("HTTPS live Host may not use an .invalid endpoint hostname");
  }
  return url;
}

function redactErrorInPlace(error: unknown, secrets?: SecretInput, seen = new Set<Error>()): unknown {
  if (!(error instanceof Error)) return error;
  if (seen.has(error)) return error;
  seen.add(error);
  const safeMessage = safeErrorMessage(error, secrets);
  if (error.message !== safeMessage) error.message = safeMessage;
  for (const key of ["stdout", "stderr"] as const) {
    const value = (error as unknown as Record<string, unknown>)[key];
    if (typeof value === "string") {
      const safeValue = redactOutput(value, secrets);
      if (safeValue !== value) {
        Object.defineProperty(error, key, {
          configurable: true,
          value: safeValue,
          writable: true,
        });
      }
    }
  }
  for (const key of Object.keys(error)) {
    if (key === "message" || key === "stack" || key === "stdout" || key === "stderr") continue;
    const value = (error as unknown as Record<string, unknown>)[key];
    if (typeof value !== "string") continue;
    const safeValue = redactOutput(value, secrets);
    if (safeValue !== value) {
      Object.defineProperty(error, key, {
        configurable: true,
        value: safeValue,
        writable: true,
      });
    }
  }
  if (typeof error.stack === "string") {
    const safeStack = redactOutput(error.stack, secrets);
    if (safeStack !== error.stack) {
      Object.defineProperty(error, "stack", {
        configurable: true,
        value: safeStack,
        writable: true,
      });
    }
  }
  for (const key of ["cause", "causeError", "cleanupError"] as const) {
    redactErrorInPlace((error as unknown as Record<string, unknown>)[key], secrets, seen);
  }
  if (error instanceof AggregateError) {
    for (const nested of error.errors) redactErrorInPlace(nested, secrets, seen);
  }
  return error;
}

export function validateBareOrigin(value: string): string {
  const input = value.trim();
  if (!input || input !== value) {
    throw new TracerError("host must be a bare origin without surrounding whitespace");
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new TracerError("host must be a valid bare origin");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new TracerError("host must not contain credentials, a path, a query, or a fragment");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
    throw new TracerError("host must use HTTPS (HTTP is allowed only for loopback diagnostics)");
  }
  return url.origin;
}

function isLoopback(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]" || normalized === "::1";
}

function isLoopbackDiagnosticHost(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && isLoopback(url.hostname);
  } catch {
    return false;
  }
}

export function validateSpace(value: string): string {
  if (value.length < 1 || Array.from(value).length > 255 || value !== value.trim()) {
    throw new TracerError("space must be 1..255 Unicode code points without leading/trailing whitespace");
  }
  if (value.includes("/") || /\p{Cc}/u.test(value)) {
    throw new TracerError("space must not contain slash or control characters");
  }
  return value;
}

export function validateOrganizationId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    throw new TracerError("organization ID must be one canonical path segment");
  }
  return value;
}

/** RFC 8785's object-key ordering is the only canonicalization needed by the
 * tracer's closed integer/string/array/object revision specs.  Provider 4
 * derives revision names from this canonical JSON digest, so insertion order
 * must never become part of the identity. */
function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TracerError("revision identity JSON contained a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new TracerError("revision identity JSON contained an unsupported value");
}

function canonicalJsonDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function derivedRevisionName(prefix: "bundle" | "version", owner: string, digest: string): string {
  if (!DIGEST.test(digest)) throw new TracerError("revision content digest was not canonical");
  if (!/^[a-z][a-z0-9-]{0,62}$/u.test(owner)) throw new TracerError("revision owner was not a DNS-like resource name");
  const ownerDigest = createHash("sha256").update(owner, "utf8").digest("hex").slice(0, 12);
  return `${prefix}-${digest.slice("sha256:".length, "sha256:".length + 12)}-${ownerDigest}`;
}

/** Build the exact Provider 4 revision identities for this tracer fixture. */
export function createRevisionNameContext(input: {
  readonly projectName: string;
  readonly configValue: string;
  readonly nonce: string;
  readonly projectUid: string;
  readonly workerModuleBytes?: Uint8Array;
  readonly workerModuleSha256?: string;
  readonly workerModuleSize?: number;
  readonly bundleManifestDigest?: string;
}): RevisionNameContext {
  const moduleDigest = input.workerModuleBytes
    ? hashFileBytes(input.workerModuleBytes)
    : input.workerModuleSha256;
  const moduleSize = input.workerModuleBytes?.byteLength ?? input.workerModuleSize;
  if (!moduleDigest || !DIGEST.test(moduleDigest) || moduleSize === undefined || !Number.isSafeInteger(moduleSize) || moduleSize < 0) {
    throw new TracerError("worker module bytes or exact digest/size are required for revision identity");
  }
  const manifest = {
    apiVersion: "artifacts.takoform.com/v1alpha1",
    kind: "WorkerBundle",
    mainModule: "worker.mjs",
    modules: [{ digest: moduleDigest, mediaType: "application/javascript+module", name: "worker.mjs", size: moduleSize }],
  };
  const bundleManifestDigest = input.bundleManifestDigest ?? canonicalJsonDigest(manifest);
  if (!DIGEST.test(bundleManifestDigest)) throw new TracerError("bundle manifest digest was not canonical");
  const bundleName = derivedRevisionName("bundle", input.projectName, bundleManifestDigest);
  const workerVersionSpec = {
    actorBindings: [],
    bucketBindings: [],
    bundle: { apiVersion: FORM_API_VERSION, kind: "WorkerBundle", name: bundleName },
    externalServices: [],
    handlers: ["fetch"],
    kvBindings: [],
    queueProducerBindings: [],
    requiredSensitiveVars: [],
    serviceBindings: [],
    sqliteBindings: [],
    vars: {
      TAKOS_FETCH_TRACER_CONFIG: input.configValue,
      TAKOS_FETCH_TRACER_NONCE: input.nonce,
      TAKOS_FETCH_TRACER_PROJECT_UID: input.projectUid,
    },
    worker: { apiVersion: FORM_API_VERSION, kind: "ModuleWorker", name: input.projectName },
    workflowBindings: [],
  };
  return {
    bundleManifestDigest,
    bundleName,
    workerVersionName: derivedRevisionName("version", input.projectName, canonicalJsonDigest(workerVersionSpec)),
  };
}

export function validateConfigValue(value: string): string {
  if (!value || value.length > 256 || /[\p{Cc}]/u.test(value)) {
    throw new TracerError("config value must be a short non-secret string");
  }
  return value;
}

export function canonicalDigest(value: string): string {
  const digest = value.trim().toLowerCase();
  const normalized = digest.startsWith("sha256:") ? digest : `sha256:${digest}`;
  if (!DIGEST.test(normalized)) throw new TracerError("provider sha256 must be 64 lowercase hexadecimal bytes");
  return normalized;
}

function parsePositiveInteger(value: string, subject: string): number {
  if (!/^[1-9][0-9]*$/u.test(value)) throw new TracerError(`${subject} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 86_400_000) {
    throw new TracerError(`${subject} is outside the supported timeout range`);
  }
  return parsed;
}

function tokenEnvName(value: string): string {
  if (!/^[A-Z_][A-Z0-9_]{0,127}$/u.test(value)) {
    throw new TracerError("token-env must be an uppercase environment variable name");
  }
  return value;
}

export function parseArgs(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
  options: { readonly fixtureDir?: string } = {},
): CliConfig {
  const expandedArgv: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith("--") && arg.includes("=")) {
      const separator = arg.indexOf("=");
      expandedArgv.push(arg.slice(0, separator), arg.slice(separator + 1));
    } else {
      expandedArgv.push(arg);
    }
  }

  let optedIn = false;
  let host: string | undefined;
  let organizationId: string | undefined;
  let space: string | undefined;
  let endpointOriginTemplate = DEFAULT_ENDPOINT_ORIGIN_TEMPLATE;
  let tokenEnv: string = MUTATION_TOKEN_ENV;
  let evidenceTokenEnv: string = EVIDENCE_TOKEN_ENV;
  let tofu = "tofu";
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let killGraceMs = DEFAULT_KILL_GRACE_MS;
  let configValue: string = FIXED_CONFIG_VALUE;

  const readValue = (index: number, flag: string): [string, number] => {
    const next = expandedArgv[index + 1];
    if (!next || next.startsWith("--")) throw new TracerError(flag + " requires a value");
    return [next, index + 1];
  };

  for (let index = 0; index < expandedArgv.length; index += 1) {
    const arg = expandedArgv[index];
    if (arg === "--run") {
      optedIn = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") throw new HelpRequestedError();
    if (arg === "--token" || arg.startsWith("--token=")) {
      throw new TracerError("token must be supplied through the named environment variable, never argv");
    }
    if (arg === "--evidence-token" || arg.startsWith("--evidence-token=")) {
      throw new TracerError("evidence token must be supplied through the named environment variable, never argv");
    }
    if (arg === "--provider-binary" || arg.startsWith("--provider-binary=") ||
      arg === "--provider-sha256" || arg.startsWith("--provider-sha256=")) {
      throw new TracerError("local provider binaries and non-registry installations are forbidden; use the public Provider 4.0.0 package");
    }
    if (arg === "--host") {
      [host, index] = readValue(index, arg);
    } else if (arg === "--organization-id") {
      [organizationId, index] = readValue(index, arg);
    } else if (arg === "--space") {
      [space, index] = readValue(index, arg);
    } else if (arg === "--endpoint-origin-template") {
      [endpointOriginTemplate, index] = readValue(index, arg);
    } else if (arg === "--token-env") {
      [tokenEnv, index] = readValue(index, arg);
    } else if (arg === "--evidence-token-env") {
      [evidenceTokenEnv, index] = readValue(index, arg);
    } else if (arg === "--tofu") {
      [tofu, index] = readValue(index, arg);
    } else if (arg === "--timeout-ms") {
      const [value, next] = readValue(index, arg);
      timeoutMs = parsePositiveInteger(value, arg);
      index = next;
    } else if (arg === "--kill-grace-ms") {
      const [value, next] = readValue(index, arg);
      killGraceMs = parsePositiveInteger(value, arg);
      index = next;
    } else if (arg === "--config-value") {
      [configValue, index] = readValue(index, arg);
    } else if (arg.startsWith("--")) {
      throw new TracerError("unknown option");
    } else {
      throw new TracerError("unexpected argument; credentials must never be supplied in argv");
    }
  }

  if (!optedIn) {
    throw new TracerError("refusing to mutate a Host: pass --run");
  }
  if (!host || !space || !organizationId) {
    throw new TracerError("--host, --organization-id, and --space are required");
  }

  const checkedTokenEnv = tokenEnvName(tokenEnv);
  const checkedEvidenceTokenEnv = tokenEnvName(evidenceTokenEnv);
  if (checkedTokenEnv === checkedEvidenceTokenEnv) {
    throw new TracerError("mutation and evidence token environment variables must be different");
  }
  const inheritedEnvironmentKeys = new Set<string>(SAFE_PARENT_ENV_KEYS);
  if (inheritedEnvironmentKeys.has(checkedTokenEnv) || inheritedEnvironmentKeys.has(checkedEvidenceTokenEnv)) {
    throw new TracerError("credential environment variables must not use inherited process environment keys");
  }
  const token = environment[checkedTokenEnv];
  if (!token) throw new TracerError("required token environment variable " + checkedTokenEnv + " is empty");
  if (token.includes("\n") || token.includes("\r")) throw new TracerError("token environment value is invalid");
  const evidenceToken = environment[checkedEvidenceTokenEnv];
  if (!evidenceToken) throw new TracerError("required evidence token environment variable " + checkedEvidenceTokenEnv + " is empty");
  if (evidenceToken.includes("\n") || evidenceToken.includes("\r")) throw new TracerError("evidence token environment value is invalid");
  if (token === evidenceToken) throw new TracerError("mutation and evidence tokens must be distinct");

  const checkedHost = validateBareOrigin(host);
  const checkedOrganizationId = validateOrganizationId(organizationId);
  const checkedSpace = validateSpace(space);
  const checkedEndpointOriginTemplate = validateEndpointOriginTemplate(endpointOriginTemplate);
  const secrets = [token, evidenceToken] as const;
  if (
    containsSecret(checkedHost, secrets) ||
    containsSecret(checkedOrganizationId, secrets) ||
    containsSecret(checkedSpace, secrets) ||
    containsSecret(tofu, secrets)
  ) {
    throw new TracerError("host, organization ID, and space must not contain a token");
  }
  const checkedConfigValue = validateConfigValue(configValue);
  if (containsSecret(checkedConfigValue, secrets)) {
    throw new TracerError("config value must not contain a token");
  }

  return {
    host: checkedHost,
    organizationId: checkedOrganizationId,
    space: checkedSpace,
    endpointOriginTemplate: checkedEndpointOriginTemplate,
    tokenEnv: checkedTokenEnv,
    token,
    evidenceTokenEnv: checkedEvidenceTokenEnv,
    evidenceToken,
    tofu: tofu.trim() || "tofu",
    timeoutMs,
    killGraceMs,
    configValue: checkedConfigValue,
    fixtureDir: resolve(options.fixtureDir ?? join(dirname(fileURLToPath(import.meta.url)), "..", "deploy/opentofu/takoserver-fetch-tracer")),
  };
}

export function usage(): string {
  return [
    "usage: bun scripts/takoserver-fetch-tracer.ts --run --host ORIGIN --organization-id ORG --space SPACE --endpoint-origin-template https://{project}.example/",
    "  [--token-env ENV_NAME] [--evidence-token-env ENV_NAME] [--tofu PATH] [--config-value VALUE]",
    "  [--timeout-ms N] [--kill-grace-ms N]",
    "",
    "This uses only the public Registry Provider 4.0.0 and is not publication/live release evidence.",
  ].join("\n");
}

function defaultSpawn(argv: readonly string[], options: Record<string, unknown>): SpawnedChild {
  return (Bun.spawn as unknown as (args: readonly string[], opts: Record<string, unknown>) => SpawnedChild)(argv, options);
}

async function waitFor<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  if (timeoutMs <= 0) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolveTimeout) => {
    timer = setTimeout(() => resolveTimeout(undefined), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function signalGroup(child: SpawnedChild, signal: "SIGTERM" | "SIGKILL"): void {
  const pid = child.pid;
  if (process.platform !== "win32" && typeof pid === "number" && pid > 1) {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // The process may have exited between the timeout and the signal.
    }
  }
  try {
    child.kill?.(signal);
  } catch {
    // A second signal is best effort; the caller still reports the deadline.
  }
}

export async function terminateChild(
  child: SpawnedChild,
  killGraceMs: number,
  exitedPromise: Promise<number> = Promise.resolve(child.exited),
): Promise<void> {
  signalGroup(child, "SIGTERM");
  // Always follow TERM with KILL after the grace interval. A detached leader
  // can exit while a descendant still owns stdout/stderr; checking only the
  // leader's `exited` promise would leave that descendant holding a pipe.
  await waitFor(exitedPromise, killGraceMs);
  signalGroup(child, "SIGKILL");
  await waitFor(exitedPromise, killGraceMs);
}

export async function drainBounded(
  stream: ReadableStream<Uint8Array> | null | undefined,
  maxBytes = MAX_OUTPUT_BYTES,
  signal?: AbortSignal,
  deadline = Number.POSITIVE_INFINITY,
): Promise<BoundedOutput> {
  if (!stream) return { text: "", truncated: false };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let retained = 0;
  let truncated = false;
  const decoder = new TextDecoder();
  const abortPromise = signal
    ? new Promise<"aborted">((resolveAbort) => {
        if (signal.aborted) {
          resolveAbort("aborted");
        } else {
          signal.addEventListener("abort", () => resolveAbort("aborted"), { once: true });
        }
      })
    : undefined;

  try {
    while (true) {
      // Check the wall clock as well as AbortSignal. A hostile stream can
      // resolve an unbounded sequence of already-complete reads and starve
      // timer delivery; this keeps every bounded drain fail-closed.
      if (signal?.aborted || Date.now() >= deadline) {
        truncated = true;
        try {
          void reader.cancel().catch(() => undefined);
        } catch {
          // Cancellation is best effort after a timeout.
        }
        break;
      }
      const next = abortPromise
        ? await Promise.race([reader.read(), abortPromise])
        : await reader.read();
      if (next === "aborted") {
        truncated = true;
        try {
          void reader.cancel().catch(() => undefined);
        } catch {
          // Cancellation is best effort after a timeout.
        }
        break;
      }
      if (Date.now() >= deadline) {
        truncated = true;
        try {
          void reader.cancel().catch(() => undefined);
        } catch {
          // Cancellation is best effort after a timeout.
        }
        break;
      }
      if (next.done) break;
      const value = next.value;
      if (retained < maxBytes) {
        const take = Math.min(value.byteLength, maxBytes - retained);
        if (take > 0) {
          chunks.push(value.slice(0, take));
          retained += take;
        }
        if (take < value.byteLength) truncated = true;
      } else {
        truncated = true;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A stream with an unresolved read may reject releaseLock after the
      // timeout race; the reader was already asked to cancel above.
    }
  }

  let text = "";
  for (const chunk of chunks) text += decoder.decode(chunk, { stream: true });
  text += decoder.decode();
  return { text: text + (truncated ? "\n[output truncated]" : ""), truncated };
}

export async function runBoundedCommand(input: {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd: string;
  readonly env: Record<string, string | undefined>;
  readonly timeoutMs: number;
  readonly killGraceMs: number;
  readonly token?: SecretInput;
  readonly maxOutputBytes?: number;
  readonly redactSuccessfulOutput?: boolean;
  readonly spawn?: SpawnFunction;
}): Promise<CommandResult> {
  const args = [...(input.args ?? [])];
  if (containsSecret(input.command, input.token) || args.some((value) => containsSecret(value, input.token))) {
    throw new TracerError("secret token may not occur in a child command argv");
  }
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1) {
    throw new TracerError("child timeout must be a positive integer");
  }
  const spawn = input.spawn ?? defaultSpawn;
  let child: SpawnedChild;
  try {
    child = spawn([input.command, ...args], {
      cwd: input.cwd,
      env: input.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      detached: true,
    });
  } catch (error) {
    throw new TracerError(`${basename(input.command)} could not be started`, { cause: redactErrorInPlace(error, input.token) });
  }

  const abortOutput = new AbortController();
  const stdoutPromise = drainBounded(child.stdout, input.maxOutputBytes ?? MAX_OUTPUT_BYTES, abortOutput.signal);
  const stderrPromise = drainBounded(child.stderr, input.maxOutputBytes ?? MAX_OUTPUT_BYTES, abortOutput.signal);
  const exitedPromise = Promise.resolve(child.exited).catch(() => 1);
  const completion = Promise.all([exitedPromise, stdoutPromise, stderrPromise]);
  let completed: [number, BoundedOutput, BoundedOutput] | undefined;
  try {
    completed = await waitFor(completion, input.timeoutMs);
  } catch (error) {
    await terminateChild(child, input.killGraceMs, exitedPromise);
    abortOutput.abort();
    await waitFor(Promise.all([stdoutPromise, stderrPromise]), input.killGraceMs);
    throw new TracerError(`${basename(input.command)} output could not be drained`, { cause: redactErrorInPlace(error, input.token) });
  }

  if (!completed) {
    await terminateChild(child, input.killGraceMs, exitedPromise);
    abortOutput.abort();
    const drained = await waitFor(Promise.all([stdoutPromise, stderrPromise]), input.killGraceMs);
    const outputs = drained ?? [
      { text: "[output drain timed out]", truncated: true },
      { text: "[output drain timed out]", truncated: true },
    ];
    throw new CommandTimeoutError({
      command: input.command,
      stdout: outputs[0].text,
      stderr: outputs[1].text,
      token: input.token,
      timeoutMs: input.timeoutMs,
    });
  }

  const [exitCode, stdout, stderr] = completed;
  if (exitCode !== 0) {
    throw new CommandError({
      command: input.command,
      exitCode,
      stdout: stdout.text,
      stderr: stderr.text,
      token: input.token,
    });
  }
  if (input.redactSuccessfulOutput === false) {
    return { exitCode, stdout: stdout.text, stderr: stderr.text };
  }
  return {
    exitCode,
    stdout: redactOutput(stdout.text, input.token),
    stderr: redactOutput(stderr.text, input.token),
  };
}

export type ProviderLock = {
  readonly address: string;
  readonly version: typeof PROVIDER_VERSION;
  readonly constraints: string;
  readonly hashes: readonly string[];
};

export type ProviderRegistryMetadataEvidence = {
  readonly platformChecksums: readonly string[];
  readonly canonicalChecksums: readonly string[];
  readonly archiveChecksums: readonly {
    readonly platform: string;
    readonly filename: string;
    readonly downloadUrl: string;
    readonly sha256: string;
  }[];
  readonly registryMetadataSources: readonly string[];
  readonly checksumSource: typeof PUBLIC_PROVIDER_CHECKSUM_SOURCE;
  readonly signatureSource: typeof PUBLIC_PROVIDER_SIGNATURE_SOURCE;
  readonly signingKeyId: typeof PUBLIC_PROVIDER_SIGNING_KEY_ID;
  readonly signingKeyFingerprint: typeof PUBLIC_PROVIDER_SIGNING_KEY_FINGERPRINT;
};

export type ProviderReleaseEvidence = ProviderRegistryMetadataEvidence & {
  readonly checksumsSha256: string;
  readonly signatureSha256: string;
  readonly signatureVerified: true;
};

function expectedPlatformKey(os: string, arch: string): string {
  return `${os}/${arch}`;
}

const PUBLIC_PROVIDER_SIGNING_UID = "Takoform Provider Release Signing";

type OpenPgpPacket = {
  readonly tag: number;
  readonly body: Uint8Array;
  readonly nextOffset: number;
};

type ParsedPublicKey = {
  readonly packetBody: Uint8Array;
  readonly fingerprint: string;
  readonly keyId: string;
  readonly publicKey: ReturnType<typeof createPublicKey>;
  readonly binary: Uint8Array;
};

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let result = 0;
  for (let index = 0; index < left.byteLength; index += 1) result |= left[index] ^ right[index];
  return result === 0;
}

function crc24(bytes: Uint8Array): Uint8Array {
  let crc = 0xb704ce;
  for (const byte of bytes) {
    crc ^= byte << 16;
    for (let bit = 0; bit < 8; bit += 1) {
      crc <<= 1;
      if (crc & 0x1000000) crc ^= 0x1864cfb;
    }
  }
  return Uint8Array.of((crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff);
}

function decodeAsciiArmor(value: string): Uint8Array {
  const lines = value.trimEnd().replace(/\r\n?/gu, "\n").split("\n");
  if (lines[0] !== "-----BEGIN PGP PUBLIC KEY BLOCK-----" || lines.at(-1) !== "-----END PGP PUBLIC KEY BLOCK-----") {
    throw new TracerError("Provider signing key must be an ASCII-armored public key");
  }
  const crcIndex = lines.findIndex((line, index) => index > 0 && line.startsWith("="));
  if (crcIndex < 0 || crcIndex !== lines.length - 2 || lines[crcIndex].length !== 5) {
    throw new TracerError("Provider signing key armor must carry an exact CRC24 line");
  }
  const bodyText = lines
    .slice(1, crcIndex)
    .filter((line) => line.length > 0 && !line.startsWith("Version:"))
    .join("");
  if (!bodyText || !/^[A-Za-z0-9+/=]+$/u.test(bodyText)) {
    throw new TracerError("Provider signing key armor contains invalid base64");
  }
  const binary = Buffer.from(bodyText, "base64");
  const encodedCrc = Buffer.from(lines[crcIndex].slice(1), "base64");
  if (encodedCrc.length !== 3 || !bytesEqual(encodedCrc, crc24(binary))) {
    throw new TracerError("Provider signing key armor CRC24 did not match");
  }
  return binary;
}

function readUInt16(bytes: Uint8Array, offset: number, subject: string): number {
  if (offset < 0 || offset + 2 > bytes.byteLength) throw new TracerError(`${subject} is truncated`);
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUInt32(bytes: Uint8Array, offset: number, subject: string): number {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new TracerError(`${subject} is truncated`);
  const value = (bytes[offset] * 0x1000000) + ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]);
  if (!Number.isSafeInteger(value)) throw new TracerError(`${subject} length is outside the safe range`);
  return value;
}

function readOpenPgpPacket(bytes: Uint8Array, offset = 0): OpenPgpPacket {
  if (offset < 0 || offset >= bytes.byteLength) throw new TracerError("OpenPGP packet header is missing");
  const header = bytes[offset++];
  if ((header & 0x80) === 0) throw new TracerError("OpenPGP packet header is invalid");
  let tag: number;
  let length: number;
  if ((header & 0x40) !== 0) {
    tag = header & 0x3f;
    const first = bytes[offset++];
    if (first === undefined) throw new TracerError("OpenPGP new-format length is missing");
    if (first < 192) length = first;
    else if (first < 224) {
      const second = bytes[offset++];
      if (second === undefined) throw new TracerError("OpenPGP new-format length is truncated");
      length = ((first - 192) << 8) + second + 192;
    } else if (first === 255) {
      length = readUInt32(bytes, offset, "OpenPGP new-format length");
      offset += 4;
    } else {
      throw new TracerError("OpenPGP partial-body packets are not accepted");
    }
  } else {
    tag = (header >> 2) & 0x0f;
    switch (header & 0x03) {
      case 0:
        length = bytes[offset++];
        if (length === undefined) throw new TracerError("OpenPGP old-format length is missing");
        break;
      case 1:
        length = readUInt16(bytes, offset, "OpenPGP old-format length");
        offset += 2;
        break;
      case 2:
        length = readUInt32(bytes, offset, "OpenPGP old-format length");
        offset += 4;
        break;
      default:
        throw new TracerError("OpenPGP indeterminate-length packets are not accepted");
    }
  }
  if (!Number.isSafeInteger(length) || length < 0 || offset + length > bytes.byteLength) {
    throw new TracerError("OpenPGP packet body is truncated");
  }
  return { tag, body: bytes.slice(offset, offset + length), nextOffset: offset + length };
}

function derLength(length: number): Uint8Array {
  if (!Number.isSafeInteger(length) || length < 0) throw new TracerError("DER length is invalid");
  if (length < 0x80) return Uint8Array.of(length);
  const bytes: number[] = [];
  let value = length;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value = Math.floor(value / 256);
  }
  return Uint8Array.from([0x80 | bytes.length, ...bytes]);
}

function derElement(tag: number, value: Uint8Array): Uint8Array {
  return Buffer.concat([Uint8Array.of(tag), derLength(value.byteLength), value]);
}

function derInteger(value: Uint8Array): Uint8Array {
  let start = 0;
  while (start + 1 < value.byteLength && value[start] === 0) start += 1;
  let body = value.slice(start);
  if ((body[0] ?? 0) & 0x80) body = Buffer.concat([Uint8Array.of(0), body]);
  return derElement(0x02, body);
}

function derSequence(...values: Uint8Array[]): Uint8Array {
  return derElement(0x30, Buffer.concat(values));
}

function derBitString(value: Uint8Array): Uint8Array {
  return derElement(0x03, Buffer.concat([Uint8Array.of(0), value]));
}

function parseMpi(bytes: Uint8Array, offset: number, subject: string): { readonly value: Uint8Array; readonly nextOffset: number; readonly bits: number } {
  const bits = readUInt16(bytes, offset, `${subject} bit length`);
  if (bits < 1 || bits > 16_384) throw new TracerError(`${subject} bit length is outside the supported range`);
  const start = offset + 2;
  const length = Math.ceil(bits / 8);
  if (start + length > bytes.byteLength) throw new TracerError(`${subject} MPI is truncated`);
  return { bits, value: bytes.slice(start, start + length), nextOffset: start + length };
}

function parsePublicKeyArmor(value: string): ParsedPublicKey {
  const binary = decodeAsciiArmor(value);
  const packet = readOpenPgpPacket(binary);
  if (packet.tag !== 6) throw new TracerError("Provider signing key must begin with a public-key packet");
  const body = packet.body;
  if (body[0] !== 4 || body[5] !== 1) throw new TracerError("Provider signing key must be a version-4 RSA key");
  const modulus = parseMpi(body, 6, "Provider signing key modulus");
  const exponent = parseMpi(body, modulus.nextOffset, "Provider signing key exponent");
  if (exponent.nextOffset !== body.byteLength) throw new TracerError("Provider signing key packet contained unexpected fields");
  const fingerprintBytes = createHash("sha1")
    .update(Buffer.from([0x99, (body.byteLength >> 8) & 0xff, body.byteLength & 0xff]))
    .update(body)
    .digest();
  const fingerprint = fingerprintBytes.toString("hex").toUpperCase();
  const keyId = fingerprint.slice(-16);
  const rsaPublicKey = derSequence(derInteger(modulus.value), derInteger(exponent.value));
  const algorithm = derSequence(
    Uint8Array.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]),
    Uint8Array.from([0x05, 0x00]),
  );
  const publicKey = createPublicKey({
    key: Buffer.from(derSequence(algorithm, derBitString(rsaPublicKey))),
    format: "der",
    type: "spki",
  });
  return { packetBody: body, fingerprint, keyId, publicKey, binary };
}

let cachedPinnedPublicKey: ParsedPublicKey | undefined;

function pinnedPublicKey(): ParsedPublicKey {
  if (!cachedPinnedPublicKey) cachedPinnedPublicKey = parsePublicKeyArmor(PUBLIC_PROVIDER_SIGNING_KEY_ARMOR);
  if (cachedPinnedPublicKey.fingerprint !== PUBLIC_PROVIDER_SIGNING_KEY_FINGERPRINT || cachedPinnedPublicKey.keyId !== PUBLIC_PROVIDER_SIGNING_KEY_ID) {
    throw new TracerError("pinned Provider signing key fingerprint did not match the release identity");
  }
  return cachedPinnedPublicKey;
}

function signingArmorCarriesReleaseUid(value: unknown): ParsedPublicKey {
  if (typeof value !== "string") throw new TracerError("Provider registry metadata signing key armor is missing");
  // The registry payload is bound to this exact pinned armor, including the
  // release UID packet and CRC24. Re-encoding or appending a synthetic UID is
  // not accepted as equivalent key material.
  if (value !== PUBLIC_PROVIDER_SIGNING_KEY_ARMOR) {
    throw new TracerError("Provider registry metadata signing key armor did not match the pinned release key");
  }
  const parsed = parsePublicKeyArmor(value);
  if (parsed.fingerprint !== PUBLIC_PROVIDER_SIGNING_KEY_FINGERPRINT || parsed.keyId !== PUBLIC_PROVIDER_SIGNING_KEY_ID) {
    throw new TracerError("Provider registry metadata signing key fingerprint did not match the pinned release key");
  }
  const pinned = pinnedPublicKey();
  if (!bytesEqual(parsed.packetBody, pinned.packetBody)) {
    throw new TracerError("Provider registry metadata signing key did not match the pinned public key");
  }
  if (!Buffer.from(parsed.binary).toString("latin1").includes(PUBLIC_PROVIDER_SIGNING_UID)) {
    throw new TracerError("Provider registry metadata signing key armor did not carry the expected release UID");
  }
  return parsed;
}

type OpenPgpSubpacket = { readonly type: number; readonly body: Uint8Array };

function parseSubpacketLength(bytes: Uint8Array, offset: number): { readonly length: number; readonly nextOffset: number } {
  const first = bytes[offset++];
  if (first === undefined) throw new TracerError("OpenPGP signature subpacket length is missing");
  if (first < 192) return { length: first, nextOffset: offset };
  if (first < 255) {
    const second = bytes[offset++];
    if (second === undefined) throw new TracerError("OpenPGP signature subpacket length is truncated");
    return { length: ((first - 192) << 8) + second + 192, nextOffset: offset };
  }
  const length = readUInt32(bytes, offset, "OpenPGP signature subpacket length");
  return { length, nextOffset: offset + 4 };
}

function parseSubpackets(bytes: Uint8Array): readonly OpenPgpSubpacket[] {
  const result: OpenPgpSubpacket[] = [];
  let offset = 0;
  while (offset < bytes.byteLength) {
    const parsedLength = parseSubpacketLength(bytes, offset);
    offset = parsedLength.nextOffset;
    if (parsedLength.length < 1 || offset + parsedLength.length > bytes.byteLength) throw new TracerError("OpenPGP signature subpacket body is truncated");
    const type = bytes[offset] & 0x7f;
    result.push({ type, body: bytes.slice(offset + 1, offset + parsedLength.length) });
    offset += parsedLength.length;
  }
  return result;
}

function verifyDetachedProviderSignature(checksums: Uint8Array, signature: Uint8Array): void {
  const key = pinnedPublicKey();
  const packet = readOpenPgpPacket(signature);
  if (packet.tag !== 2 || packet.nextOffset !== signature.byteLength) throw new TracerError("Provider SHA256SUMS signature must be one detached OpenPGP signature packet");
  const body = packet.body;
  if (body.length < 10 || body[0] !== 4 || body[1] !== 0 || body[2] !== 1 || body[3] !== 10) {
    throw new TracerError("Provider SHA256SUMS signature must be v4 RSA/SHA-512 binary-document signature");
  }
  const hashedLength = readUInt16(body, 4, "Provider signature hashed-subpacket length");
  const hashedStart = 6;
  const hashedEnd = hashedStart + hashedLength;
  if (hashedEnd + 2 > body.length) throw new TracerError("Provider signature hashed subpackets are truncated");
  const hashed = body.slice(hashedStart, hashedEnd);
  const unhashedLength = readUInt16(body, hashedEnd, "Provider signature unhashed-subpacket length");
  const unhashedStart = hashedEnd + 2;
  const unhashedEnd = unhashedStart + unhashedLength;
  if (unhashedEnd + 2 > body.length) throw new TracerError("Provider signature unhashed subpackets are truncated");
  const unhashed = body.slice(unhashedStart, unhashedEnd);
  const leftDigest = body.slice(unhashedEnd, unhashedEnd + 2);
  const mpi = parseMpi(body, unhashedEnd + 2, "Provider signature RSA MPI");
  if (mpi.nextOffset !== body.length) throw new TracerError("Provider signature contained trailing bytes");
  const expectedFingerprint = Buffer.from(PUBLIC_PROVIDER_SIGNING_KEY_FINGERPRINT, "hex");
  const issuerFingerprints = parseSubpackets(hashed).filter((subpacket) => subpacket.type === 33);
  if (issuerFingerprints.length !== 1 || issuerFingerprints[0].body[0] !== 4 || !bytesEqual(issuerFingerprints[0].body.slice(1), expectedFingerprint)) {
    throw new TracerError("Provider signature did not carry the pinned issuer fingerprint");
  }
  const issuerIds = parseSubpackets(unhashed).filter((subpacket) => subpacket.type === 16);
  if (issuerIds.length !== 1 || !bytesEqual(issuerIds[0].body, Buffer.from(PUBLIC_PROVIDER_SIGNING_KEY_ID, "hex"))) {
    throw new TracerError("Provider signature did not carry the pinned issuer key ID");
  }
  const hashedHeader = body.slice(0, hashedEnd);
  const trailer = Buffer.alloc(6);
  trailer[0] = 4;
  trailer[1] = 0xff;
  trailer.writeUInt32BE(hashedHeader.byteLength, 2);
  const signed = Buffer.concat([checksums, hashedHeader, trailer]);
  const digest = createHash("sha512").update(signed).digest();
  if (!bytesEqual(leftDigest, digest.slice(0, 2))) throw new TracerError("Provider SHA256SUMS signature digest prefix did not match");
  const verifier = createVerify("sha512");
  verifier.update(signed);
  if (!verifier.verify(key.publicKey, Buffer.from(mpi.value))) throw new TracerError("Provider SHA256SUMS detached signature did not verify against the pinned release key");
}

/**
 * Validate the public Registry download response against the immutable v4.0.0
 * GitHub release assets. This is intentionally a pure contract check so a
 * hermetic run cannot silently follow a mutable mirror or generic registry
 * URL. `checksumsText` is the exact SHA256SUMS release asset body.
 */
export function assertProviderRegistryMetadata(
  metadata: readonly unknown[],
  checksumsText: string,
): ProviderRegistryMetadataEvidence {
  const expectedPlatforms = PUBLIC_PROVIDER_PLATFORMS.map(([os, arch]) => `${os}/${arch}`).sort();
  if (metadata.length !== expectedPlatforms.length) {
    throw new TracerError("public Provider 4.0.0 registry metadata must cover exactly five published platforms");
  }
  const seen = new Set<string>();
  const platformChecksums: string[] = [];
  const archiveChecksums: ProviderRegistryMetadataEvidence["archiveChecksums"][number][] = [];
  for (const value of metadata) {
    const entry = requireRecord(value, "Provider registry platform metadata");
    assertClosedKeys(
      entry,
      ["protocols", "os", "arch", "filename", "download_url", "shasums_url", "shasums_signature_url", "shasum", "signing_keys"],
      [],
      "Provider registry platform metadata",
    );
    const os = requireString(entry.os, "Provider registry metadata os");
    const arch = requireString(entry.arch, "Provider registry metadata arch");
    const platform = expectedPlatformKey(os, arch);
    const expectedShasum = PUBLIC_PROVIDER_PLATFORM_SHASUMS[platform];
    if (!expectedShasum || seen.has(platform)) throw new TracerError("Provider registry metadata contained an unexpected platform");
    if (JSON.stringify(entry.protocols) !== JSON.stringify(["6.0"])) {
      throw new TracerError("Provider registry metadata protocols must be exactly [6.0]");
    }
    const filename = `terraform-provider-takoform_4.0.0_${os}_${arch}.zip`;
    if (entry.filename !== filename) throw new TracerError("Provider registry metadata filename did not match the public release asset");
    const expectedDownload = `https://github.com/tako0614/terraform-provider-takoform/releases/download/v4.0.0/${filename}`;
    if (entry.download_url !== expectedDownload) throw new TracerError("Provider registry metadata resolved an unexpected archive URL");
    if (entry.shasums_url !== PUBLIC_PROVIDER_CHECKSUM_SOURCE) throw new TracerError("Provider registry metadata resolved an unexpected SHA256SUMS URL");
    if (entry.shasums_signature_url !== PUBLIC_PROVIDER_SIGNATURE_SOURCE) throw new TracerError("Provider registry metadata resolved an unexpected SHA256SUMS signature URL");
    if (entry.shasum !== expectedShasum) throw new TracerError("Provider registry metadata checksum did not match the canonical release checksum");
    const signingKeys = requireRecord(entry.signing_keys, "Provider registry metadata signing keys");
    assertClosedKeys(signingKeys, ["gpg_public_keys"], [], "Provider registry metadata signing keys");
    if (!Array.isArray(signingKeys.gpg_public_keys) || signingKeys.gpg_public_keys.length !== 1) {
      throw new TracerError("Provider registry metadata must carry exactly one release signing key");
    }
    const signingKey = requireRecord(signingKeys.gpg_public_keys[0], "Provider registry metadata signing key");
    assertClosedKeys(signingKey, ["key_id", "ascii_armor", "trust_signature", "source", "source_url"], [], "Provider registry metadata signing key");
    if (signingKey.key_id !== PUBLIC_PROVIDER_SIGNING_KEY_ID) throw new TracerError("Provider registry metadata signing key ID did not match the public release key");
    if (signingKey.trust_signature !== "" || signingKey.source !== "" || signingKey.source_url !== null) {
      throw new TracerError("Provider registry metadata signing key provenance fields did not match the public release");
    }
    signingArmorCarriesReleaseUid(signingKey.ascii_armor);
    seen.add(platform);
    platformChecksums.push(`zh:${expectedShasum}`);
    archiveChecksums.push({
      platform,
      filename,
      downloadUrl: expectedDownload,
      sha256: `sha256:${expectedShasum}`,
    });
  }
  if (!expectedPlatforms.every((platform) => seen.has(platform))) throw new TracerError("Provider registry metadata omitted a published platform");
  const checksumEntries = parsePublicProviderChecksumEntries(checksumsText);
  const checksums = checksumEntries.map((entry) => `zh:${entry.sha256}`);
  if (checksums.length !== PUBLIC_PROVIDER_ZH_HASHES.length || !PUBLIC_PROVIDER_ZH_HASHES.every((hash) => checksums.includes(hash))) {
    throw new TracerError("public Provider 4.0.0 SHA256SUMS did not carry the canonical six zh checksums");
  }
  const checksumsByFilename = new Map(checksumEntries.map((entry) => [entry.filename, entry.sha256]));
  for (const archive of archiveChecksums) {
    const expectedChecksum = archive.sha256.slice("sha256:".length);
    if (checksumsByFilename.get(archive.filename) !== expectedChecksum) {
      throw new TracerError("registry platform checksum was not bound to its signed release filename");
    }
  }
  return {
    platformChecksums: [...platformChecksums].sort(),
    canonicalChecksums: [...checksums].sort(),
    archiveChecksums: archiveChecksums.sort((left, right) => left.platform.localeCompare(right.platform)),
    registryMetadataSources: expectedPlatforms.map((platform) => `${PUBLIC_PROVIDER_REGISTRY_DOWNLOAD_BASE}/${platform}`),
    checksumSource: PUBLIC_PROVIDER_CHECKSUM_SOURCE,
    signatureSource: PUBLIC_PROVIDER_SIGNATURE_SOURCE,
    signingKeyId: PUBLIC_PROVIDER_SIGNING_KEY_ID,
    signingKeyFingerprint: PUBLIC_PROVIDER_SIGNING_KEY_FINGERPRINT,
  };
}

export type PublicProviderChecksumEntry = {
  readonly filename: string;
  readonly sha256: string;
};

export function parsePublicProviderChecksumEntries(value: string): readonly PublicProviderChecksumEntry[] {
  const lines = value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== PUBLIC_PROVIDER_ZH_HASHES.length) throw new TracerError("public Provider SHA256SUMS must contain exactly six entries");
  const expectedNames = new Set([
    "terraform-provider-takoform_4.0.0_darwin_amd64.zip",
    "terraform-provider-takoform_4.0.0_darwin_arm64.zip",
    "terraform-provider-takoform_4.0.0_linux_amd64.zip",
    "terraform-provider-takoform_4.0.0_linux_arm64.zip",
    "terraform-provider-takoform_4.0.0_manifest.json",
    "terraform-provider-takoform_4.0.0_windows_amd64.zip",
  ]);
  const seen = new Set<string>();
  const result: PublicProviderChecksumEntry[] = [];
  for (const line of lines) {
    const match = line.match(/^([0-9a-f]{64})\s{2}([^\s]+)$/u);
    if (!match || !expectedNames.has(match[2]) || seen.has(match[2])) throw new TracerError("public Provider SHA256SUMS contained an unexpected entry");
    seen.add(match[2]);
    result.push({ filename: match[2], sha256: match[1] });
  }
  if (seen.size !== expectedNames.size) throw new TracerError("public Provider SHA256SUMS omitted a canonical release entry");
  return result;
}

export function parsePublicProviderChecksums(value: string): readonly string[] {
  return parsePublicProviderChecksumEntries(value).map((entry) => `zh:${entry.sha256}`);
}

export function verifyPublicProviderRelease(input: {
  readonly metadata: readonly unknown[];
  readonly checksums: Uint8Array;
  readonly signature: Uint8Array;
}): ProviderReleaseEvidence {
  let checksumsText: string;
  try {
    checksumsText = new TextDecoder("utf-8", { fatal: true }).decode(input.checksums);
  } catch {
    throw new TracerError("public Provider SHA256SUMS was not valid UTF-8");
  }
  const metadataEvidence = assertProviderRegistryMetadata(input.metadata, checksumsText);
  verifyDetachedProviderSignature(input.checksums, input.signature);
  return {
    ...metadataEvidence,
    checksumsSha256: hashFileBytes(input.checksums),
    signatureSha256: hashFileBytes(input.signature),
    signatureVerified: true,
  };
}

type PublicProviderResponse = {
  readonly response: Response;
  readonly body: Uint8Array;
};

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    // Do not let a broken/custom stream's cancellation promise extend the
    // provenance deadline. Calling cancel is the important part; a provider
    // response is already being discarded and there is no useful value in
    // waiting for an untrusted body source to acknowledge it.
    const cancellation = response.body?.cancel();
    if (cancellation) void cancellation.catch(() => undefined);
  } catch {
    // The response is being discarded; cancellation is best effort.
  }
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    // As above, cancellation must be initiated without allowing a hostile
    // stream to hold the deadline open while resolving its cancel promise.
    void reader.cancel().catch(() => undefined);
  } catch {
    // Cancellation is best effort after a timeout/size violation.
  }
}

async function readPublicProviderBytes(
  response: Response,
  subject: string,
  signal: AbortSignal,
  deadline = Number.POSITIVE_INFINITY,
): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > MAX_PROVIDER_RELEASE_BYTES) {
      await cancelResponseBody(response);
      throw new TracerError(`${subject} exceeded the bounded release asset size`);
    }
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let retained = 0;
  let aborted = false;
  const abortPromise = new Promise<"aborted">((resolveAbort) => {
    if (signal.aborted) {
      resolveAbort("aborted");
      return;
    }
    signal.addEventListener("abort", () => resolveAbort("aborted"), { once: true });
  });
  try {
    while (true) {
      // Check the wall clock as well as AbortSignal. A hostile stream can
      // resolve an unbounded sequence of already-complete reads and starve
      // timer delivery; this keeps the body deadline fail-closed even then.
      if (signal.aborted || Date.now() >= deadline) {
        aborted = true;
        cancelReader(reader);
        throw new TracerError(`${subject} timed out while reading the release body`);
      }
      const next = await Promise.race([reader.read(), abortPromise]);
      if (next === "aborted") {
        aborted = true;
        cancelReader(reader);
        throw new TracerError(`${subject} timed out while reading the release body`);
      }
      if (signal.aborted || Date.now() >= deadline) {
        aborted = true;
        cancelReader(reader);
        throw new TracerError(`${subject} timed out while reading the release body`);
      }
      if (next.done) break;
      const value = next.value;
      if (retained + value.byteLength > MAX_PROVIDER_RELEASE_BYTES) {
        cancelReader(reader);
        throw new TracerError(`${subject} exceeded the bounded release asset size`);
      }
      // Copy only bounded chunks. The final concatenation below is therefore
      // guaranteed to allocate at most MAX_PROVIDER_RELEASE_BYTES.
      chunks.push(value.slice());
      retained += value.byteLength;
    }
  } catch (error) {
    if (!aborted) cancelReader(reader);
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A stream with an unresolved read may reject releaseLock after the
      // timeout race; the reader was already asked to cancel above.
    }
  }
  return Buffer.concat(chunks, retained);
}

const GITHUB_RELEASE_REDIRECT_QUERY_KEYS = [
  "sp",
  "sv",
  "sr",
  "spr",
  "se",
  "rscd",
  "rsct",
  "skoid",
  "sktid",
  "skt",
  "ske",
  "sks",
  "skv",
  "sig",
  "jwt",
  "response-content-disposition",
  "response-content-type",
] as const;

export function assertGithubReleaseRedirect(value: URL, expectedFilename: string): void {
  if (
    value.protocol !== "https:" ||
    value.hostname !== "release-assets.githubusercontent.com" ||
    value.port !== "" ||
    value.username ||
    value.password ||
    value.hash ||
    !/^\/github-production-release-asset\/\d+\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value.pathname)
  ) {
    throw new TracerError("public Provider release asset redirect did not match the exact GitHub release-assets origin");
  }
  const keys = [...value.searchParams.keys()].sort();
  const expectedKeys = [...GITHUB_RELEASE_REDIRECT_QUERY_KEYS].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new TracerError("public Provider release asset redirect carried unexpected query parameters");
  }
  for (const key of GITHUB_RELEASE_REDIRECT_QUERY_KEYS) {
    if (!value.searchParams.get(key)) throw new TracerError("public Provider release asset redirect carried an empty query parameter");
  }
  const expectedDisposition = `attachment; filename=${expectedFilename}`;
  if (
    value.searchParams.get("sp") !== "r" ||
    value.searchParams.get("sv") !== "2018-11-09" ||
    value.searchParams.get("sr") !== "b" ||
    value.searchParams.get("spr") !== "https" ||
    value.searchParams.get("sks") !== "b" ||
    value.searchParams.get("skv") !== "2018-11-09" ||
    value.searchParams.get("rscd") !== expectedDisposition ||
    value.searchParams.get("rsct") !== "application/octet-stream" ||
    value.searchParams.get("response-content-disposition") !== expectedDisposition ||
    value.searchParams.get("response-content-type") !== "application/octet-stream"
  ) {
    throw new TracerError("public Provider release asset redirect did not match the exact GitHub asset query");
  }
}

async function fetchPublicProviderResponse(input: {
  readonly url: string;
  readonly timeoutMs: number;
  readonly fetchImpl: FetchFunction;
  readonly allowGithubRedirect: boolean;
}): Promise<PublicProviderResponse> {
  const deadline = Date.now() + input.timeoutMs;
  const expectedFilename = input.url.endsWith(".sig")
    ? "terraform-provider-takoform_4.0.0_SHA256SUMS.sig"
    : "terraform-provider-takoform_4.0.0_SHA256SUMS";
  let url = input.url;
  for (let redirects = 0; redirects < 2; redirects += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new TracerError("public Provider release request exceeded its deadline");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    let response: Response;
    try {
      const timeoutPromise = new Promise<Response>((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(new TracerError("public Provider release request exceeded its deadline")), { once: true });
      });
      const fetchPromise = Promise.resolve().then(() => input.fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        headers: { accept: "application/json, application/octet-stream" },
        signal: controller.signal,
      }));
      // A custom fetch implementation may ignore AbortSignal and resolve with
      // a response after the header deadline. Make sure that late body is
      // still cancelled instead of leaking a stream outside this run.
      void fetchPromise.then((lateResponse) => {
        if (controller.signal.aborted) void cancelResponseBody(lateResponse);
      }, () => undefined);
      response = await Promise.race([fetchPromise, timeoutPromise]);
      if (response.status >= 300 && response.status < 400) {
        if (!input.allowGithubRedirect || redirects > 0) {
          await cancelResponseBody(response);
          throw new TracerError("public Provider release asset returned an unexpected redirect");
        }
        const location = response.headers.get("location");
        await cancelResponseBody(response);
        if (!location) throw new TracerError("public Provider release asset redirect did not carry a location");
        const redirected = new URL(location, url);
        assertGithubReleaseRedirect(redirected, expectedFilename);
        url = redirected.toString();
        continue;
      }
      if (response.status !== 200) {
        await cancelResponseBody(response);
        throw new TracerError(`public Provider release request returned HTTP ${response.status}`);
      }
      const body = await readPublicProviderBytes(response, `Provider ${expectedFilename}`, controller.signal, deadline);
      return { response, body };
    } catch (error) {
      if (controller.signal.aborted && !(error instanceof TracerError && /exceeded its deadline|timed out while reading/u.test(error.message))) {
        throw new TracerError("public Provider release request exceeded its deadline");
      }
      throw error instanceof TracerError ? error : new TracerError("public Provider release request failed", { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }
  throw new TracerError("public Provider release followed too many redirects");
}

export async function fetchPublicProviderRelease(input: {
  readonly timeoutMs: number;
  readonly fetchImpl?: FetchFunction;
}): Promise<ProviderReleaseEvidence> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const metadata: unknown[] = [];
  for (const [os, arch] of PUBLIC_PROVIDER_PLATFORMS) {
    const url = `${PUBLIC_PROVIDER_REGISTRY_DOWNLOAD_BASE}/${os}/${arch}`;
    const { body } = await fetchPublicProviderResponse({ url, timeoutMs: input.timeoutMs, fetchImpl, allowGithubRedirect: false });
    try {
      metadata.push(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown);
    } catch {
      throw new TracerError(`Provider ${os}/${arch} registry metadata was not valid UTF-8 JSON`);
    }
  }
  const { body: checksums } = await fetchPublicProviderResponse({ url: PUBLIC_PROVIDER_CHECKSUM_SOURCE, timeoutMs: input.timeoutMs, fetchImpl, allowGithubRedirect: true });
  const { body: signature } = await fetchPublicProviderResponse({ url: PUBLIC_PROVIDER_SIGNATURE_SOURCE, timeoutMs: input.timeoutMs, fetchImpl, allowGithubRedirect: true });
  return verifyPublicProviderRelease({ metadata, checksums, signature });
}

export function assertProviderLockfile(value: string): ProviderLock {
  const blocks = [...value.matchAll(/provider\s+"([^"]+)"\s*\{([\s\S]*?)\n\}/gu)];
  if (blocks.length !== 1) {
    throw new TracerError("Provider lockfile must contain exactly one provider block");
  }
  const address = blocks[0][1];
  const block = blocks[0][2];
  if (address !== PROVIDER_SOURCE) {
    throw new TracerError("Provider lockfile selected an unexpected provider address");
  }
  const version = block.match(/^\s*version\s*=\s*"([^"]+)"/mu)?.[1];
  if (version !== PROVIDER_VERSION) {
    throw new TracerError("Provider lockfile must pin exactly public Provider 4.0.0");
  }
  const constraints = block.match(/^\s*constraints\s*=\s*"([^"]+)"/mu)?.[1] ?? "";
  if (constraints !== "4.0.0") {
    throw new TracerError("Provider lockfile constraint must pin exactly 4.0.0");
  }
  const hashes = [...block.matchAll(/^\s+"((?:h1|zh):[^"]+)"/gmu)].map((match) => match[1]);
  const h1 = hashes.filter((hash): hash is (typeof PUBLIC_PROVIDER_H1_HASHES)[number] => hash.startsWith("h1:"));
  const zh = hashes.filter((hash): hash is (typeof PUBLIC_PROVIDER_ZH_HASHES)[number] => hash.startsWith("zh:"));
  const exactSet = (actual: readonly string[], expected: readonly string[]): boolean =>
    actual.length === expected.length && new Set(actual).size === expected.length && expected.every((hash) => actual.includes(hash));
  if (!exactSet(h1, PUBLIC_PROVIDER_H1_HASHES) || !exactSet(zh, PUBLIC_PROVIDER_ZH_HASHES)) {
    throw new TracerError("Provider lockfile must carry the canonical signed public Provider 4.0.0 checksum sets");
  }
  if (/\b(?:dev_overrides|filesystem_mirror)\b/u.test(value)) {
    throw new TracerError("Provider lockfile/config must not contain a local provider override");
  }
  return { address, version: PROVIDER_VERSION, constraints, hashes };
}

export const validateProviderLockfile = assertProviderLockfile;

export function createProviderInstallConfig(): string {
  return [
    "provider_installation {",
    "  direct {}",
    "}",
    "",
  ].join("\n");
}

// This is an allowlist, not a scrubber. In particular, Terraform/OpenTofu
// plugin reattach/cache, workspace, log, registry TLS-authority, and cloud
// credential variables never cross into a tracer child, even if the caller
// has set them. Tracer-owned values below are written after this copy so they
// cannot be shadowed by the parent process.
const SAFE_PARENT_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "CURL_CA_BUNDLE",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_CONFIG_GLOBAL",
  "GIT_TERMINAL_PROMPT",
  "GOPROXY",
  "GOSUMDB",
  "GOTOOLCHAIN",
  "CGO_ENABLED",
  "NO_COLOR",
] as const;

function allowlistedParentEnvironment(base: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const environment: Record<string, string | undefined> = {};
  for (const key of SAFE_PARENT_ENV_KEYS) {
    const value = base[key];
    if (typeof value !== "string") continue;
    if (containsControlCharacter(value)) {
      throw new TracerError("inherited environment contained an unsafe control character");
    }
    if (PROXY_FIELD_PATTERN.test(key) && PROXY_CREDENTIAL_PATTERN.test(value)) {
      throw new TracerError("inherited proxy environment may not contain credentials");
    }
    if (PATH_FIELD_PATTERN.test(key) && PATH_TRAVERSAL_PATTERN.test(value)) {
      throw new TracerError("inherited environment contained an unsafe path");
    }
    environment[key] = value;
  }
  return environment;
}

export function buildTofuEnvironment(input: {
  readonly base?: NodeJS.ProcessEnv;
  readonly host: string;
  readonly space: string;
  readonly token: string;
  readonly includeToken?: boolean;
  /** Validated by parseArgs for parent lookup only; never copied to child env. */
  readonly tokenEnv?: string;
  readonly configValue: string;
  readonly cliConfigFile: string;
  readonly tfDataDir: string;
  readonly projectName?: string;
  readonly projectNonce?: string;
  readonly projectUid?: string;
}): Record<string, string | undefined> {
  const environment = allowlistedParentEnvironment(input.base ?? process.env);
  environment.TF_CLI_CONFIG_FILE = input.cliConfigFile;
  environment.TF_DATA_DIR = input.tfDataDir;
  environment.TAKOFORM_ENDPOINT = input.host;
  environment.TAKOFORM_SPACE = input.space;
  if (input.includeToken !== false) environment.TAKOFORM_TOKEN = input.token;
  environment.TF_VAR_host = input.host;
  environment.TF_VAR_space = input.space;
  environment.TF_VAR_config_value = input.configValue;
  if (input.projectName) environment.TF_VAR_project_name = input.projectName;
  if (input.projectNonce) environment.TF_VAR_project_nonce = input.projectNonce;
  if (input.projectUid) environment.TF_VAR_project_uid = input.projectUid;
  environment.TF_IN_AUTOMATION = "1";
  return environment;
}

export function validateV1Discovery(value: unknown, expectedOrigin: string): Discovery {
  const document = requireRecord(value, "Host discovery document");
  const topKeys = ownKeys(document);
  if (topKeys.join(",") !== ["api_versions", "endpoints", "features"].join(",")) {
    throw new TracerError("Host discovery document has an unexpected closed-envelope shape");
  }
  if (JSON.stringify(document.api_versions) !== JSON.stringify([V1_API_VERSION])) {
    throw new TracerError("Host discovery must advertise exactly forms.takoform.com/v1");
  }
  const features = requireRecord(document.features, "Host discovery features");
  for (const feature of FIXED_FEATURES) {
    if (features[feature] !== true) throw new TracerError(`Host discovery feature ${feature} must be true`);
  }
  for (const [name, enabled] of Object.entries(features)) {
    if (typeof enabled !== "boolean") throw new TracerError(`Host discovery feature ${name} must be boolean`);
  }
  const endpoints = requireRecord(document.endpoints, "Host discovery endpoints");
  if (ownKeys(endpoints).join(",") !== "api") throw new TracerError("Host discovery must advertise only the api endpoint");
  const apiValue = requireString(endpoints.api, "Host discovery api endpoint");
  let api: URL;
  try {
    api = new URL(apiValue);
  } catch {
    throw new TracerError("Host discovery api endpoint must be an absolute URL");
  }
  if (
    api.origin !== expectedOrigin ||
    api.username ||
    api.password ||
    api.search ||
    api.hash ||
    api.pathname !== "/apis/forms.takoform.com/v1" ||
    api.pathname.includes("%")
  ) {
    throw new TracerError("Host discovery api endpoint must be the exact same-origin v1 API root");
  }
  return { apiRoot: api.toString().replace(/\/$/u, ""), document };
}

function assertCanonicalNumber(value: unknown, subject: string): asserts value is string {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,18}$/u.test(value) || BigInt(value) > 9_223_372_036_854_775_807n) {
    throw new TracerError(`${subject} must be a canonical positive decimal`);
  }
}

export function projectResourceName(
  key: ResourceKey,
  projectName = DEFAULT_PROJECT_NAME,
  revisions?: RevisionNameContext,
): string {
  if (!/^[a-z][a-z0-9-]{0,62}$/u.test(projectName)) {
    throw new TracerError("project_name must be a DNS-like lowercase resource name");
  }
  switch (key) {
    case "module_worker":
      return projectName;
    case "worker_bundle":
      return revisions?.bundleName ?? `${projectName}-bundle`;
    case "worker_version":
      return revisions?.workerVersionName ?? `${projectName}-version`;
    case "worker_deployment":
      return `${projectName}-deployment`;
    case "worker_endpoint":
      return `${projectName}-endpoint`;
  }
}

export function knownResourceAddresses(
  space: string,
  projectName = DEFAULT_PROJECT_NAME,
  revisions?: RevisionNameContext,
): ProjectResourceAddresses {
  validateSpace(space);
  const result = {} as ProjectResourceAddresses;
  for (const key of RESOURCE_KEYS) {
    const form = PROVIDER4_FORM_REFS[key];
    result[key] = {
      name: projectResourceName(key, projectName, revisions),
      space,
      form_api_version: form.apiVersion,
      form_kind: form.kind,
      form_definition_version: form.definitionVersion,
      form_schema_digest: form.schemaDigest,
    };
  }
  return result;
}

export function assertExactResourceIdentity(
  value: unknown,
  key: ResourceKey,
  expectedSpace: string,
  expectedProjectName = DEFAULT_PROJECT_NAME,
  // OpenTofu may expose the resource identity before the Host observes the
  // deployment. The authoritative readback path keeps the strict default.
  requireReady = true,
  revisions?: RevisionNameContext,
): ResourceIdentity {
  const identity = requireRecord(value, `${key} identity`);
  const expectedKeys = [
    "form_api_version",
    "form_definition_version",
    "form_kind",
    "form_schema_digest",
    "generation",
    "name",
    "ready",
    "revision",
    "space",
    "uid",
  ];
  for (const field of expectedKeys) {
    if (!(field in identity)) throw new TracerError(`${key} identity is missing ${field}`);
  }
  const kind = requireString(identity.form_kind, `${key}.form_kind`);
  const expectedForm = PROVIDER4_FORM_REFS[key];
  if (kind !== RESOURCE_KINDS[key] || kind !== expectedForm.kind) throw new TracerError(`${key} has unexpected Form kind`);
  if (identity.form_api_version !== expectedForm.apiVersion) throw new TracerError(`${key} has unexpected Form API version`);
  if (typeof identity.form_definition_version !== "string" || !FORM_DEFINITION_VERSION.test(identity.form_definition_version) || identity.form_definition_version !== expectedForm.definitionVersion) {
    throw new TracerError(`${key} has an unexpected Form definition version`);
  }
  if (typeof identity.form_schema_digest !== "string" || !DIGEST.test(identity.form_schema_digest) || identity.form_schema_digest !== expectedForm.schemaDigest) {
    throw new TracerError(`${key} has an unexpected Form schema digest`);
  }
  if (identity.space !== expectedSpace) throw new TracerError(`${key} is in the wrong SpaceID`);
  const name = requireString(identity.name, `${key}.name`);
  if (!/^[a-z][a-z0-9-]{0,62}$/u.test(name)) throw new TracerError(`${key} has an invalid resource name`);
  if (name !== projectResourceName(key, expectedProjectName, revisions)) throw new TracerError(`${key} has an unexpected project resource name`);
  const uid = requireString(identity.uid, `${key}.uid`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(uid)) throw new TracerError(`${key} has an invalid uid`);
  assertCanonicalNumber(identity.generation, `${key}.generation`);
  assertCanonicalNumber(identity.revision, `${key}.revision`);
  if (typeof identity.ready !== "boolean") throw new TracerError(`${key}.ready must be boolean`);
  if (requireReady && identity.ready !== true) throw new TracerError(`${key} is not Ready`);
  if (key === "worker_endpoint") {
    if (typeof identity.hostname !== "string" || identity.hostname.length === 0) {
      throw new TracerError("WorkerEndpoint identity is missing hostname");
    }
    if (typeof identity.url !== "string" || identity.url.length === 0) {
      throw new TracerError("WorkerEndpoint identity is missing url");
    }
  }
  return identity as ResourceIdentity;
}

export function assertExactIdentitySet(
  value: unknown,
  expectedSpace: string,
  expectedProjectName = DEFAULT_PROJECT_NAME,
  requireReady = true,
  revisions?: RevisionNameContext,
): Record<ResourceKey, ResourceIdentity> {
  const identities = requireRecord(value, "resource_identities");
  if (ownKeys(identities).join(",") !== [...RESOURCE_KEYS].sort().join(",")) {
    throw new TracerError("resource_identities must contain exactly the five Worker resources");
  }
  const result = {} as Record<ResourceKey, ResourceIdentity>;
  const uids = new Set<string>();
  for (const key of RESOURCE_KEYS) {
    const identity = assertExactResourceIdentity(identities[key], key, expectedSpace, expectedProjectName, requireReady, revisions);
    if (uids.has(identity.uid)) throw new TracerError("resource identities must have distinct UIDs");
    uids.add(identity.uid);
    result[key] = identity;
  }
  return result;
}

export function assertExactProbeBody(
  value: unknown,
  expectedConfigValue: string,
  expectedNonce: string,
  expectedProjectUid: string,
): void {
  const body = requireRecord(value, "Worker probe response");
  if (ownKeys(body).join(",") !== "buildIdentity,configValue,nonce,projectUid") {
    throw new TracerError("Worker probe response must contain exactly buildIdentity, configValue, nonce, and projectUid");
  }
  if (
    body.buildIdentity !== BUILD_IDENTITY ||
    body.configValue !== expectedConfigValue ||
    body.nonce !== expectedNonce ||
    body.projectUid !== expectedProjectUid
  ) {
    throw new TracerError("Worker probe response does not carry the exact build identity, config value, nonce, and project UID");
  }
}

export function assertExactHealthBody(value: unknown): void {
  const body = requireRecord(value, "Worker health response");
  assertClosedKeys(
    body,
    ["component", "product", "scope", "status"],
    [],
    "Worker health response",
  );
  if (
    body.component !== "takoserver-fetch-tracer" ||
    body.product !== "takos" ||
    body.scope !== "integration-only" ||
    body.status !== "ok"
  ) {
    throw new TracerError("Worker health response does not identify the integration-only Takos fetch tracer");
  }
}

export function assertExactDiscoveryBody(value: unknown): void {
  const body = requireRecord(value, "Worker Takos discovery response");
  assertClosedKeys(
    body,
    ["artifact", "capabilities", "fullRuntime", "name", "product", "runtime", "scope"],
    [],
    "Worker Takos discovery response",
  );
  if (
    body.artifact !== "takoserver-fetch-tracer" ||
    !Array.isArray(body.capabilities) ||
    body.capabilities.length !== 1 ||
    body.capabilities[0] !== "fetch" ||
    body.fullRuntime !== false ||
    body.name !== "Takos" ||
    body.product !== "takos" ||
    body.runtime !== "neutral-javascript-fetch" ||
    body.scope !== "integration-only"
  ) {
    throw new TracerError("Worker discovery response overstated or changed the fetch-tracer scope");
  }
}

function boundedJson(value: string, subject: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new TracerError(`${subject} was not valid JSON`);
  }
}

/** OpenTofu's `output -json` wraps every output in a sensitive/type/value envelope. */
export function unwrapTofuOutput(value: unknown, name: string): unknown {
  const wrapper = requireRecord(value, `tofu output ${name}`);
  assertClosedKeys(wrapper, ["sensitive", "type", "value"], [], `tofu output ${name}`);
  if (wrapper.sensitive !== false) throw new TracerError(`tofu output ${name} must not be sensitive`);
  if (
    wrapper.type === null ||
    wrapper.type === undefined ||
    (typeof wrapper.type === "string" && wrapper.type.length === 0) ||
    (Array.isArray(wrapper.type) && wrapper.type.length === 0)
  ) {
    throw new TracerError(`tofu output ${name} has an invalid type descriptor`);
  }
  return wrapper.value;
}

const PLAN_RESOURCE_TYPES: Readonly<Record<ResourceKey, string>> = {
  module_worker: "takoform_module_worker",
  worker_bundle: "takoform_worker_bundle",
  worker_version: "takoform_worker_version",
  worker_deployment: "takoform_worker_deployment",
  worker_endpoint: "takoform_worker_endpoint",
};
export type PlanEvidence = {
  readonly creates: readonly string[];
  readonly planSha256: string;
};

export type PlanExpectation = {
  readonly projectName: string;
  readonly space: string;
  readonly configValue: string;
  readonly nonce: string;
  readonly projectUid: string;
  readonly workerModuleSha256: string;
  readonly workerModuleSize: number;
  readonly revisions: RevisionNameContext;
};

const PLAN_COMMON_UNKNOWN_KEYS = [
  "conditions",
  "form_api_version",
  "form_definition_version",
  "form_kind",
  "form_package_digest",
  "form_schema_digest",
  "generation",
  "outputs_json",
  "pending_operation_id",
  "ready",
  "relation_drift_reason",
  "revision",
  "uid",
] as const;

const PLAN_VERSION_UNKNOWN_KEYS = [
  "actor_bindings",
  "bucket_bindings",
  "conditions",
  "external_services",
  "form_api_version",
  "form_definition_version",
  "form_kind",
  "form_package_digest",
  "form_schema_digest",
  "generation",
  "handlers",
  "kv_bindings",
  "outputs_json",
  "pending_operation_id",
  "queue_producer_bindings",
  "ready",
  "relation_drift_reason",
  "required_sensitive_vars",
  "revision",
  "service_bindings",
  "sqlite_bindings",
  "uid",
  "workflow_bindings",
] as const;

function assertExactJson(value: unknown, expected: unknown, subject: string): void {
  if (Array.isArray(expected)) {
    if (!Array.isArray(value) || value.length !== expected.length) throw new TracerError(`${subject} had an unexpected array shape`);
    for (let index = 0; index < expected.length; index += 1) assertExactJson(value[index], expected[index], `${subject}[${index}]`);
    return;
  }
  if (isRecord(expected)) {
    const actual = requireRecord(value, subject);
    const expectedKeys = Object.keys(expected).sort();
    if (ownKeys(actual).join(",") !== expectedKeys.join(",")) throw new TracerError(`${subject} had an unexpected object shape`);
    for (const key of expectedKeys) assertExactJson(actual[key], expected[key], `${subject}.${key}`);
    return;
  }
  if (value !== expected) throw new TracerError(`${subject} did not match the exact planned value`);
}

function expectedPlanUnknown(key: ResourceKey): JsonRecord {
  const common = Object.fromEntries(PLAN_COMMON_UNKNOWN_KEYS.map((name) => [name, true]));
  switch (key) {
    case "module_worker":
      return common;
    case "worker_bundle":
      return { ...common, modules: [{}] };
    case "worker_version":
      return {
        ...Object.fromEntries(PLAN_VERSION_UNKNOWN_KEYS.map((name) => [name, true])),
        actor_bindings: [],
        external_services: [],
        handlers: [false],
        kv_bindings: [],
        queue_producer_bindings: [],
        required_sensitive_vars: [],
        service_bindings: [],
        sqlite_bindings: [],
        workflow_bindings: [],
      };
    case "worker_deployment":
      return { ...common, versions: [{}] };
    case "worker_endpoint":
      return { ...common, hostname: true, url: true };
  }
}

function expectedPlanSensitive(key: ResourceKey): JsonRecord {
  switch (key) {
    case "module_worker":
      return { conditions: [] };
    case "worker_bundle":
      return { conditions: [], modules: [{}] };
    case "worker_version":
      return {
        actor_bindings: [],
        bucket_bindings: [],
        conditions: [],
        external_services: [],
        handlers: [false],
        kv_bindings: [],
        queue_producer_bindings: [],
        required_sensitive_vars: [],
        service_bindings: [],
        sqlite_bindings: [],
        workflow_bindings: [],
      };
    case "worker_deployment":
      return { conditions: [], versions: [{}] };
    case "worker_endpoint":
      return { conditions: [] };
  }
}

function assertStrictPlanResource(change: JsonRecord, key: ResourceKey, expected: PlanExpectation): void {
  const type = PLAN_RESOURCE_TYPES[key];
  assertClosedKeys(change, ["address", "mode", "type", "name", "provider_name", "change"], [], "tofu show resource change");
  assertExactJson(change.address, `${type}.app`, `${type} address`);
  assertExactJson(change.mode, "managed", `${type} mode`);
  assertExactJson(change.type, type, `${type} type`);
  assertExactJson(change.name, "app", `${type} name`);
  assertExactJson(change.provider_name, PROVIDER_SOURCE, `${type} provider identity`);
  const detail = requireRecord(change.change, `${type} change`);
  assertClosedKeys(detail, ["actions", "before", "after", "after_unknown", "before_sensitive", "after_sensitive"], [], `${type} change detail`);
  assertExactJson(detail.actions, ["create"], `${type} actions`);
  assertExactJson(detail.before, null, `${type} before`);
  assertExactJson(detail.before_sensitive, false, `${type} before_sensitive`);
  assertExactJson(detail.after_unknown, expectedPlanUnknown(key), `${type} after_unknown`);
  assertExactJson(detail.after_sensitive, expectedPlanSensitive(key), `${type} after_sensitive`);
  const after = requireRecord(detail.after, `${type} after`);
  const name = expected.projectName;
  const space = expected.space;
  switch (key) {
    case "module_worker":
      assertExactJson(after, { create_timeout: null, delete_timeout: null, name, space }, `${type} after`);
      break;
    case "worker_bundle": {
      assertClosedKeys(after, ["create_timeout", "delete_timeout", "main_module", "manifest_digest", "modules", "name", "revision_owner", "space"], [], `${type} after`);
      assertExactJson(after.create_timeout, null, `${type}.create_timeout`);
      assertExactJson(after.delete_timeout, null, `${type}.delete_timeout`);
      assertExactJson(after.main_module, "worker.mjs", `${type}.main_module`);
      assertExactJson(after.manifest_digest, expected.revisions.bundleManifestDigest, `${type}.manifest_digest`);
      assertExactJson(after.name, expected.revisions.bundleName, `${type}.name`);
      assertExactJson(after.revision_owner, name, `${type}.revision_owner`);
      assertExactJson(after.space, space, `${type}.space`);
      if (!Array.isArray(after.modules) || after.modules.length !== 1) throw new TracerError(`${type}.modules must contain exactly one module`);
      assertExactJson(after.modules[0], {
        content_file: "./worker.mjs",
        content_type: "application/javascript+module",
        digest: expected.workerModuleSha256,
        name: "worker.mjs",
        size: expected.workerModuleSize,
      }, `${type}.modules[0]`);
      break;
    }
    case "worker_version": {
      assertClosedKeys(after, ["actor_bindings", "apply_idempotency_key", "assets", "bucket_bindings", "bundle", "create_timeout", "delete_timeout", "external_services", "handlers", "kv_bindings", "name", "queue_producer_bindings", "required_sensitive_vars", "revision_owner", "service_bindings", "space", "sqlite_bindings", "vars_json", "worker", "workflow_bindings"], [], `${type} after`);
      assertExactJson(after.actor_bindings, [], `${type}.actor_bindings`);
      assertExactJson(after.apply_idempotency_key, null, `${type}.apply_idempotency_key`);
      assertExactJson(after.assets, null, `${type}.assets`);
      assertExactJson(after.bucket_bindings, [], `${type}.bucket_bindings`);
      assertExactJson(after.bundle, expected.revisions.bundleName, `${type}.bundle`);
      assertExactJson(after.create_timeout, null, `${type}.create_timeout`);
      assertExactJson(after.delete_timeout, null, `${type}.delete_timeout`);
      assertExactJson(after.external_services, [], `${type}.external_services`);
      assertExactJson(after.handlers, ["fetch"], `${type}.handlers`);
      assertExactJson(after.kv_bindings, [], `${type}.kv_bindings`);
      assertExactJson(after.name, expected.revisions.workerVersionName, `${type}.name`);
      assertExactJson(after.queue_producer_bindings, [], `${type}.queue_producer_bindings`);
      assertExactJson(after.required_sensitive_vars, [], `${type}.required_sensitive_vars`);
      assertExactJson(after.revision_owner, name, `${type}.revision_owner`);
      assertExactJson(after.service_bindings, [], `${type}.service_bindings`);
      assertExactJson(after.space, space, `${type}.space`);
      assertExactJson(after.sqlite_bindings, [], `${type}.sqlite_bindings`);
      assertExactJson(after.worker, name, `${type}.worker`);
      assertExactJson(after.workflow_bindings, [], `${type}.workflow_bindings`);
      if (typeof after.vars_json !== "string") throw new TracerError(`${type}.vars_json must be a JSON string`);
      let vars: unknown;
      try {
        vars = JSON.parse(after.vars_json) as unknown;
      } catch {
        throw new TracerError(`${type}.vars_json was not valid JSON`);
      }
      assertExactJson(vars, {
        TAKOS_FETCH_TRACER_CONFIG: expected.configValue,
        TAKOS_FETCH_TRACER_NONCE: expected.nonce,
        TAKOS_FETCH_TRACER_PROJECT_UID: expected.projectUid,
      }, `${type}.vars_json`);
      break;
    }
    case "worker_deployment":
      assertExactJson(after, {
        create_timeout: null,
        delete_timeout: null,
        name: `${name}-deployment`,
        space,
        update_timeout: null,
        versions: [{ weight: 10000, worker_version: expected.revisions.workerVersionName }],
        worker: name,
      }, `${type} after`);
      break;
    case "worker_endpoint":
      assertExactJson(after, {
        create_timeout: null,
        delete_timeout: null,
        name: `${name}-endpoint`,
        space,
        worker: name,
      }, `${type} after`);
      break;
  }
}

function assertStrictPlanOutputs(value: unknown, expected: PlanExpectation): void {
  const plan = requireRecord(value, "tofu show plan");
  const outputChanges = requireRecord(plan.output_changes, "tofu show plan output_changes");
  const outputNames = [
    "config_value",
    "endpoint_hostname",
    "endpoint_url",
    "project_nonce",
    "project_uid",
    "resource_identities",
  ];
  if (ownKeys(outputChanges).join(",") !== outputNames.join(",")) throw new TracerError("tofu show plan output_changes must contain exactly the tracer outputs");
  const assertOutput = (name: string, after: unknown, afterUnknown: unknown, hasAfter = true): void => {
    const output = requireRecord(outputChanges[name], `tofu show output ${name}`);
    assertClosedKeys(output, ["actions", "before", ...(hasAfter ? ["after"] : []), "after_unknown", "before_sensitive", "after_sensitive"], [], `tofu show output ${name}`);
    assertExactJson(output.actions, ["create"], `tofu show output ${name}.actions`);
    assertExactJson(output.before, null, `tofu show output ${name}.before`);
    if (hasAfter) assertExactJson(output.after, after, `tofu show output ${name}.after`);
    assertExactJson(output.after_unknown, afterUnknown, `tofu show output ${name}.after_unknown`);
    assertExactJson(output.before_sensitive, false, `tofu show output ${name}.before_sensitive`);
    assertExactJson(output.after_sensitive, false, `tofu show output ${name}.after_sensitive`);
  };
  assertOutput("config_value", expected.configValue, false);
  assertOutput("endpoint_hostname", undefined, true, false);
  assertOutput("endpoint_url", undefined, true, false);
  assertOutput("project_nonce", expected.nonce, false);
  assertOutput("project_uid", expected.projectUid, false);
  const output = requireRecord(outputChanges.resource_identities, "tofu show output resource_identities");
  assertClosedKeys(output, ["actions", "before", "after", "after_unknown", "before_sensitive", "after_sensitive"], [], "tofu show output resource_identities");
  assertExactJson(output.actions, ["create"], "resource_identities.actions");
  assertExactJson(output.before, null, "resource_identities.before");
  assertExactJson(output.after, {
    module_worker: { hostname: null, name: expected.projectName, space: expected.space, url: null },
    worker_bundle: { hostname: null, name: expected.revisions.bundleName, space: expected.space, url: null },
    worker_deployment: { hostname: null, name: `${expected.projectName}-deployment`, space: expected.space, url: null },
    worker_endpoint: { name: `${expected.projectName}-endpoint`, space: expected.space },
    worker_version: { hostname: null, name: expected.revisions.workerVersionName, space: expected.space, url: null },
  }, "resource_identities.after");
  const common = Object.fromEntries(["form_api_version", "form_definition_version", "form_kind", "form_schema_digest", "generation", "ready", "revision", "uid"].map((name) => [name, true]));
  assertExactJson(output.after_unknown, {
    module_worker: common,
    worker_bundle: common,
    worker_deployment: common,
    worker_endpoint: { ...common, hostname: true, url: true },
    worker_version: common,
  }, "resource_identities.after_unknown");
  assertExactJson(output.before_sensitive, false, "resource_identities.before_sensitive");
  assertExactJson(output.after_sensitive, false, "resource_identities.after_sensitive");
}

export function assertExactPlan(value: unknown, expected?: PlanExpectation): readonly string[] {
  const plan = requireRecord(value, "tofu show plan");
  const changes = plan.resource_changes;
  if (!Array.isArray(changes) || changes.length !== RESOURCE_KEYS.length) {
    throw new TracerError("tofu show plan must contain exactly five managed resource changes");
  }
  const expectedAddresses = new Set(RESOURCE_KEYS.map((key) => `${PLAN_RESOURCE_TYPES[key]}.app`));
  const seen = new Set<string>();
  for (const changeValue of changes) {
    const change = requireRecord(changeValue, "tofu show resource change");
    const address = requireString(change.address, "tofu show resource address");
    if (!expectedAddresses.has(address) || seen.has(address)) throw new TracerError("tofu show plan contained an unexpected resource address");
    if (change.mode !== "managed") throw new TracerError("tofu show plan contained a non-managed resource change");
    const type = requireString(change.type, "tofu show resource type");
    if (type !== address.slice(0, address.lastIndexOf("."))) throw new TracerError("tofu show resource type did not match address");
    const name = requireString(change.name, "tofu show resource name");
    if (name !== "app") throw new TracerError("tofu show plan resource name must be app");
    const detail = requireRecord(change.change, "tofu show resource change detail");
    if (!Array.isArray(detail.actions) || detail.actions.length !== 1 || detail.actions[0] !== "create") {
      throw new TracerError("tofu show plan must contain create-only actions for every tracer resource");
    }
    seen.add(address);
  }
  if (seen.size !== expectedAddresses.size) throw new TracerError("tofu show plan did not contain every tracer resource");
  if (expected) {
    for (const key of RESOURCE_KEYS) {
      const resource = changes.find((entry) => isRecord(entry) && entry.address === `${PLAN_RESOURCE_TYPES[key]}.app`);
      if (!resource) throw new TracerError(`tofu show plan omitted ${key}`);
      assertStrictPlanResource(requireRecord(resource, `${key} plan resource`), key, expected);
    }
    assertStrictPlanOutputs(value, expected);
  }
  return [...seen].sort();
}

export async function inspectSavedPlan(planPath: string, showJson: string, expected?: PlanExpectation): Promise<PlanEvidence> {
  const creates = assertExactPlan(boundedJson(showJson, "tofu show plan"), expected);
  const planBytes = await readFile(planPath).catch((error: unknown) => {
    throw new TracerError("saved tofu plan could not be read for hashing", { cause: error });
  });
  return { creates, planSha256: hashFileBytes(planBytes) };
}

export function parseTofuOutputs(
  value: unknown,
  expectedSpace: string,
  expectedProjectName = DEFAULT_PROJECT_NAME,
  revisions?: RevisionNameContext,
): {
  readonly identities: Record<ResourceKey, ResourceIdentity>;
  readonly configValue: string;
  readonly endpointURL: string;
  readonly endpointHostname: string;
  readonly nonce: string;
  readonly projectUid: string;
} {
  const outputs = requireRecord(value, "tofu output");
  assertClosedKeys(
    outputs,
    [
      "resource_identities",
      "config_value",
      "endpoint_url",
      "endpoint_hostname",
      "project_nonce",
      "project_uid",
    ],
    [],
    "tofu output",
  );
  // Apply output is an exact identity snapshot, but status can still be
  // Reconciling. The Host readback below is the readiness authority.
  const identities = assertExactIdentitySet(unwrapTofuOutput(outputs.resource_identities, "resource_identities"), expectedSpace, expectedProjectName, false, revisions);
  const configValue = unwrapTofuOutput(outputs.config_value, "config_value");
  const endpointURL = unwrapTofuOutput(outputs.endpoint_url, "endpoint_url");
  const endpointHostname = unwrapTofuOutput(outputs.endpoint_hostname, "endpoint_hostname");
  const nonce = unwrapTofuOutput(outputs.project_nonce, "project_nonce");
  const projectUid = unwrapTofuOutput(outputs.project_uid, "project_uid");
  if (typeof configValue !== "string") throw new TracerError("tofu output config_value must be a string");
  if (typeof endpointURL !== "string") throw new TracerError("tofu output endpoint_url must be a string");
  if (typeof endpointHostname !== "string") throw new TracerError("tofu output endpoint_hostname must be a string");
  if (typeof nonce !== "string" || !NONCE_PATTERN.test(nonce)) throw new TracerError("tofu output project_nonce must be a canonical run nonce");
  if (typeof projectUid !== "string" || !/^puid-[0-9a-f]{64}$/u.test(projectUid)) throw new TracerError("tofu output project_uid must be a canonical run UID");
  if (endpointURL !== identities.worker_endpoint.url || endpointHostname !== identities.worker_endpoint.hostname) {
    throw new TracerError("tofu endpoint outputs do not match WorkerEndpoint identity");
  }
  return { identities, configValue, endpointURL, endpointHostname, nonce, projectUid };
}

export async function readResponseBody(
  response: Response,
  options: {
    readonly maxBytes?: number;
    readonly token?: SecretInput;
    /** A caller-owned signal/deadline pair keeps headers and body one budget. */
    readonly signal?: AbortSignal;
    readonly deadline?: number;
    /** Convenience timeout for standalone body reads without a parent request. */
    readonly timeoutMs?: number;
  } = {},
): Promise<string> {
  const maxBytes = options.maxBytes ?? MAX_RESPONSE_BYTES;
  const parentSignal = options.signal;
  const deadline = options.deadline ?? (options.timeoutMs ? Date.now() + options.timeoutMs : Number.POSITIVE_INFINITY);
  const abort = new AbortController();
  const parentAbort = (): void => abort.abort();
  if (parentSignal) {
    if (parentSignal.aborted) abort.abort();
    else parentSignal.addEventListener("abort", parentAbort, { once: true });
  }
  const remaining = deadline - Date.now();
  const timer = Number.isFinite(remaining) && remaining > 0 ? setTimeout(() => abort.abort(), remaining) : undefined;
  try {
    if (!response.body) {
      if (abort.signal.aborted || Date.now() >= deadline) throw new TracerError("Host response body exceeded its deadline");
      return "";
    }
    const output = await drainBounded(response.body, maxBytes, abort.signal, deadline);
    if (abort.signal.aborted || Date.now() >= deadline) throw new TracerError("Host response body exceeded its deadline");
    return redactOutput(output.text, options.token);
  } finally {
    if (timer) clearTimeout(timer);
    parentSignal?.removeEventListener("abort", parentAbort);
  }
}

type TimedResponse = {
  readonly response: Response;
  readonly signal: AbortSignal;
  readonly deadline: number;
  readonly dispose: () => void;
};

async function fetchWithTimeout(
  fetchImpl: FetchFunction,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  secrets?: SecretInput,
): Promise<TimedResponse> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new TracerError("Host request timeout must be a positive integer");
  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
  };
  try {
    const timeoutPromise = new Promise<Response>((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(new TracerError("Host request exceeded its deadline")), { once: true });
    });
    const fetchPromise = Promise.resolve().then(() => fetchImpl(input, { ...init, signal: controller.signal }));
    // A custom fetch implementation may ignore AbortSignal and resolve with a
    // response after the header deadline. Cancel that late body so no stream
    // survives the failed request.
    void fetchPromise.then((lateResponse) => {
      if (controller.signal.aborted) void cancelResponseBody(lateResponse);
    }, () => undefined);
    const response = await Promise.race([fetchPromise, timeoutPromise]);
    return { response, signal: controller.signal, deadline, dispose };
  } catch (error) {
    dispose();
    if (controller.signal.aborted) {
      throw new TracerError("Host request exceeded its deadline", { cause: redactErrorInPlace(error, secrets) });
    }
    throw new TracerError("Host request failed before a response was received", { cause: redactErrorInPlace(error, secrets) });
  }
}

async function readTimedResponse(
  timed: TimedResponse,
  options: { readonly token?: SecretInput; readonly maxBytes?: number } = {},
): Promise<string> {
  try {
    return await readResponseBody(timed.response, {
      ...options,
      signal: timed.signal,
      deadline: timed.deadline,
    });
  } finally {
    timed.dispose();
  }
}

export async function discoverV1(input: {
  readonly host: string;
  readonly token: string;
  readonly timeoutMs: number;
  readonly fetchImpl?: FetchFunction;
}): Promise<Discovery> {
  const timed = await fetchWithTimeout(
    input.fetchImpl ?? fetch,
    new URL(V1_DISCOVERY_PATH, input.host),
    {
      method: "GET",
      redirect: "manual",
      headers: { authorization: `Bearer ${input.token}`, accept: "application/json" },
    },
    input.timeoutMs,
    input.token,
  );
  const response = timed.response;
  const body = await readTimedResponse(timed, { token: input.token });
  if (response.status !== 200) throw new TracerError(`Host v1 discovery returned HTTP ${response.status}`);
  return validateV1Discovery(boundedJson(body, "Host discovery"), input.host);
}

export function resourceURL(apiRoot: string, identity: ResourceAddress): URL {
  if (identity.form_api_version.includes("/")) throw new TracerError("Form API version must be one path segment");
  const url = new URL(
    `${apiRoot}/resources/${encodeURIComponent(identity.form_api_version)}/${encodeURIComponent(identity.form_kind)}/${encodeURIComponent(identity.name)}`,
  );
  url.searchParams.set("space", identity.space);
  url.searchParams.set("definitionVersion", identity.form_definition_version);
  url.searchParams.set("schemaDigest", identity.form_schema_digest);
  return url;
}

export function assertReadbackResource(value: unknown, identity: ResourceIdentity): ResourceIdentity {
  const resource = requireRecord(value, "resource readback");
  assertClosedKeys(resource, ["apiVersion", "kind", "form", "metadata", "spec", "status"], [], "resource readback resource");
  if (resource.apiVersion !== identity.form_api_version || resource.kind !== identity.form_kind) {
    throw new TracerError("resource readback Form identity does not match state");
  }
  const form = requireRecord(resource.form, "resource readback form");
  assertClosedKeys(form, ["formRef"], ["packageDigest"], "resource readback form");
  const formRef = requireRecord(form.formRef, "resource readback formRef");
  assertClosedKeys(formRef, ["apiVersion", "kind", "definitionVersion", "schemaDigest"], [], "resource readback formRef");
  if (
    formRef.apiVersion !== identity.form_api_version ||
    formRef.kind !== identity.form_kind ||
    formRef.definitionVersion !== identity.form_definition_version ||
    formRef.schemaDigest !== identity.form_schema_digest
  ) {
    throw new TracerError("resource readback exact FormRef does not match state");
  }
  requireRecord(resource.spec, "resource readback spec");
  const metadata = requireRecord(resource.metadata, "resource readback metadata");
  assertClosedKeys(metadata, ["name", "space", "uid", "generation", "revision"], [], "resource readback metadata");
  if (metadata.name !== identity.name || metadata.space !== identity.space || metadata.uid !== identity.uid) {
    throw new TracerError("resource readback metadata does not match state");
  }
  if (metadata.generation !== identity.generation) {
    throw new TracerError("resource readback generation does not match state");
  }
  assertCanonicalNumber(metadata.revision, "resource readback metadata.revision");
  if (BigInt(metadata.revision) < BigInt(identity.revision)) {
    throw new TracerError("resource readback revision regressed from state");
  }
  const status = requireRecord(resource.status, "resource readback status");
  assertClosedKeys(status, ["observedGeneration", "conditions"], ["outputs"], "resource readback status");
  if (status.observedGeneration !== identity.generation) {
    throw new TracerError("resource readback observedGeneration does not match state");
  }
  const conditions = status.conditions;
  if (!Array.isArray(conditions)) {
    throw new TracerError("resource readback conditions must be an array");
  }
  for (const condition of conditions) {
    const conditionRecord = requireRecord(condition, "resource readback condition");
    assertClosedKeys(
      conditionRecord,
      ["type", "status", "reason", "lastTransitionTime"],
      ["hostReason", "message"],
      "resource readback condition",
    );
  }
  if (!conditions.some((condition) => isRecord(condition) && condition.type === "Ready" && condition.status === "True")) {
    throw new TracerError("resource readback does not carry Ready=True");
  }
  let endpointOutputs: { readonly hostname: string; readonly url: string } | undefined;
  if (identity.form_kind === "WorkerEndpoint") {
    const outputs = requireRecord(status.outputs, "WorkerEndpoint readback outputs");
    assertClosedKeys(outputs, ["hostname", "url"], [], "WorkerEndpoint readback outputs");
    const hostname = requireString(outputs.hostname, "WorkerEndpoint readback hostname");
    const url = requireString(outputs.url, "WorkerEndpoint readback url");
    if (hostname !== identity.hostname || url !== identity.url) {
      throw new TracerError("WorkerEndpoint readback outputs do not match state");
    }
    endpointOutputs = { hostname, url };
  } else if ("outputs" in status) {
    requireRecord(status.outputs, "resource readback outputs");
  }
  const authoritative: ResourceIdentity = {
    ...identity,
    revision: metadata.revision,
    ready: true,
    ...(endpointOutputs ? endpointOutputs : {}),
  };
  return authoritative;
}

export async function readHostResource(input: {
  readonly apiRoot: string;
  readonly identity: ResourceIdentity;
  readonly token: string;
  readonly timeoutMs: number;
  readonly fetchImpl?: FetchFunction;
}): Promise<{ readonly status: number; readonly body: unknown; readonly rawBody: string; readonly identity?: ResourceIdentity }> {
  const result = await readHostAddress({
    apiRoot: input.apiRoot,
    address: input.identity,
    token: input.token,
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
  });
  if (result.status !== 200) return result;
  return { ...result, identity: assertReadbackResource(result.body, input.identity) };
}

export async function readHostAddress(input: {
  readonly apiRoot: string;
  readonly address: ResourceAddress;
  readonly token: string;
  readonly timeoutMs: number;
  readonly fetchImpl?: FetchFunction;
}): Promise<{ readonly status: number; readonly body: unknown; readonly rawBody: string }> {
  const timed = await fetchWithTimeout(
    input.fetchImpl ?? fetch,
    resourceURL(input.apiRoot, input.address),
    {
      method: "GET",
      redirect: "manual",
      headers: { authorization: `Bearer ${input.token}`, accept: "application/json" },
    },
    input.timeoutMs,
    input.token,
  );
  const response = timed.response;
  const rawBody = await readTimedResponse(timed, { token: input.token });
  const body = rawBody ? boundedJson(rawBody, "Host resource response") : null;
  return { status: response.status, body, rawBody };
}

export function assertExactAbsence(status: number, body: unknown): void {
  if (status !== 404) throw new TracerError(`expected exact absence HTTP 404, received ${status}`);
  const envelope = requireRecord(body, "absence response");
  if (ownKeys(envelope).join(",") !== "error") throw new TracerError("absence response has an unexpected envelope");
  const error = requireRecord(envelope.error, "absence response error");
  assertClosedKeys(error, ["code", "message", "requestId", "retryable"], ["hostCode", "details"], "absence response error");
  if (error.code !== "resource_not_found") throw new TracerError("absence response is not resource_not_found");
  if (typeof error.message !== "string" || !error.message || typeof error.requestId !== "string" || !error.requestId || error.retryable !== false) {
    throw new TracerError("resource_not_found response has invalid error metadata");
  }
}

export async function assertAuthoritativeAbsence(input: {
  readonly apiRoot: string;
  readonly addresses: ProjectResourceAddresses;
  readonly token: string;
  readonly timeoutMs: number;
  readonly fetchImpl?: FetchFunction;
}): Promise<void> {
  const failures: string[] = [];
  // Do not stop at the first failure. The recovery decision is authoritative
  // only after every known FormRef+project name has been queried.
  for (const key of RESOURCE_KEYS) {
    try {
      const response = await readHostAddress({
        apiRoot: input.apiRoot,
        address: input.addresses[key],
        token: input.token,
        timeoutMs: input.timeoutMs,
        fetchImpl: input.fetchImpl,
      });
      assertExactAbsence(response.status, response.body);
    } catch (error) {
      failures.push(`${key}: ${error instanceof Error ? safeErrorMessage(error, input.token) : "absence check failed"}`);
    }
  }
  if (failures.length > 0) {
    throw new TracerError(`authoritative absence failed for ${failures.length} resource(s): ${failures.join("; ")}`);
  }
}

export type EndpointAbsenceEvidence = {
  readonly assignedUrl: string;
  readonly nonce: string;
  readonly status: 404 | 410;
  readonly applicability: "applicable";
  readonly bodySha256: string;
} | {
  readonly assignedUrl: string;
  readonly nonce: string;
  readonly status: "not-applicable";
  readonly applicability: "not-applicable";
  readonly reason: "loopback-diagnostic-endpoint-has-no-host-runtime";
};

/**
 * Check the assigned endpoint itself after destroy. This is intentionally
 * separate from the five Host resource GETs: a Host may delete its resource
 * records while an edge route remains reachable.
 */
export async function assertEndpointAbsence(input: {
  readonly assignedUrl: string;
  readonly expectedOrigin: string;
  readonly targetHost: string;
  readonly nonce: string;
  readonly timeoutMs: number;
  readonly fetchImpl?: FetchFunction;
}): Promise<EndpointAbsenceEvidence> {
  if (!NONCE_PATTERN.test(input.nonce)) throw new TracerError("endpoint absence nonce is not canonical");
  const endpoint = assertEndpointTarget({
    assignedUrl: input.assignedUrl,
    expectedOrigin: input.expectedOrigin,
    targetHost: input.targetHost,
  });
  const timed = await fetchWithTimeout(
    input.fetchImpl ?? fetch,
    endpoint,
    { method: "GET", redirect: "manual", headers: { accept: "application/json" } },
    input.timeoutMs,
  );
  const response = timed.response;
  const body = await readTimedResponse(timed);
  if (response.status !== 404 && response.status !== 410) {
    throw new TracerError(`assigned Worker endpoint did not become absent (HTTP ${response.status})`);
  }
  return {
    assignedUrl: endpoint.toString(),
    nonce: input.nonce,
    status: response.status,
    applicability: "applicable",
    bodySha256: hashFileBytes(new TextEncoder().encode(body)),
  };
}

const NATIVE_RESIDUAL_REASONS = new Set([
  "closure_pending",
  "effect_unresolved",
  "deployment_active",
  "deployment_unmarked",
  "provider_unavailable",
  "provider_readback_failed",
  "provider_identity_missing",
  "legacy_unattested",
]);

export type NativeResidualObservation = {
  readonly status: "absent";
  readonly source: "intrinsic" | "provider";
  readonly effectCount: number;
  readonly deploymentCount: number;
  readonly checkedAt: string;
  readonly evidenceRef?: string;
  readonly reason?: string;
};

export type NativeAbsenceResourceEvidence = NativeResidualObservation & {
  readonly name: string;
  readonly uid: string;
};

export type NativeAbsenceEvidence = {
  readonly kind: typeof NATIVE_ABSENCE_KIND;
  readonly status: "passed";
  readonly organizationId: string;
  readonly space: string;
  readonly resourceCount: 5;
  readonly checkedCount: 5;
  readonly resources: Record<ResourceKey, NativeAbsenceResourceEvidence>;
};

export type NativeAbsenceFailure = {
  readonly key: ResourceKey;
  readonly code:
    | "request_failed"
    | "http_status"
    | "malformed_response"
    | "unexpected_status";
  readonly status?: number;
};

export class NativeAbsenceError extends TracerError {
  readonly failures: readonly NativeAbsenceFailure[];

  constructor(failures: readonly NativeAbsenceFailure[]) {
    super(`native absence verification failed for ${failures.length} of 5 resource checks`);
    this.name = "NativeAbsenceError";
    this.failures = failures;
  }
}

function boundedNativeCount(value: unknown, subject: string): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > MAX_NATIVE_RESIDUAL_COUNT
  ) {
    throw new TracerError(`${subject} must be a bounded non-negative integer`);
  }
  return value as number;
}

function canonicalCheckedAt(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new TracerError("native residual checkedAt is not a canonical UTC timestamp");
  }
  return value;
}

/** Require the closed, authoritative Takoserver native residual absence envelope. */
export function assertNativeResidualResponse(value: unknown): NativeResidualObservation {
  const envelope = requireRecord(value, "native residual response");
  assertClosedKeys(envelope, ["residual"], [], "native residual response");
  const residual = requireRecord(envelope.residual, "native residual response residual");
  assertClosedKeys(
    residual,
    ["checkedAt", "deploymentCount", "effectCount", "source", "status"],
    ["evidenceRef", "reason"],
    "native residual response residual",
  );
  if (residual.status !== "absent") {
    throw new TracerError("native residual response must carry the exact absent status");
  }
  if (residual.source !== "intrinsic" && residual.source !== "provider") {
    throw new TracerError("native residual response source is invalid");
  }
  const effectCount = boundedNativeCount(residual.effectCount, "native residual effectCount");
  const deploymentCount = boundedNativeCount(
    residual.deploymentCount,
    "native residual deploymentCount",
  );
  const checkedAt = canonicalCheckedAt(residual.checkedAt);
  let evidenceRef: string | undefined;
  if (residual.evidenceRef !== undefined) {
    if (typeof residual.evidenceRef !== "string" || !DIGEST.test(residual.evidenceRef)) {
      throw new TracerError("native residual evidenceRef is not a canonical digest");
    }
    evidenceRef = residual.evidenceRef;
  }
  let reason: string | undefined;
  if (residual.reason !== undefined) {
    if (
      typeof residual.reason !== "string" ||
      !NATIVE_RESIDUAL_REASONS.has(residual.reason)
    ) {
      throw new TracerError("native residual reason is invalid");
    }
    reason = residual.reason;
  }
  return {
    status: "absent",
    source: residual.source,
    effectCount,
    deploymentCount,
    checkedAt,
    ...(evidenceRef === undefined ? {} : { evidenceRef }),
    ...(reason === undefined ? {} : { reason }),
  };
}

export function buildNativeResidualURL(input: {
  readonly host: string;
  readonly organizationId: string;
  readonly identity: Pick<ResourceIdentity, "name" | "space" | "uid">;
}): URL {
  const host = validateBareOrigin(input.host);
  const organizationId = validateOrganizationId(input.organizationId);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(input.identity.uid)) {
    throw new TracerError("native residual resource UID is not canonical");
  }
  if (!/^[a-z][a-z0-9-]{0,62}$/u.test(input.identity.name)) {
    throw new TracerError("native residual resource name is not canonical");
  }
  validateSpace(input.identity.space);
  const url = new URL(host);
  url.pathname = `/v1/organizations/${encodeURIComponent(organizationId)}/resources/${encodeURIComponent(input.identity.uid)}/native-residual`;
  url.search = new URLSearchParams({
    space: input.identity.space,
    name: input.identity.name,
  }).toString();
  return url;
}

/**
 * Read every pre-destroy Host UID from Takoserver's organization-scoped
 * residual authority. One failed read never suppresses the other four.
 */
export async function verifyNativeAbsence(input: {
  readonly host: string;
  readonly organizationId: string;
  readonly identities: Record<ResourceKey, ResourceIdentity>;
  readonly token: string;
  readonly timeoutMs: number;
  readonly projectName?: string;
  readonly revisions?: RevisionNameContext;
  readonly fetchImpl?: FetchFunction;
}): Promise<NativeAbsenceEvidence> {
  const organizationId = validateOrganizationId(input.organizationId);
  if (!input.token || /[\r\n]/u.test(input.token)) {
    throw new TracerError("native residual evidence token is invalid");
  }
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1) {
    throw new TracerError("native residual timeout is invalid");
  }
  const identitySet = assertExactIdentitySet(
    input.identities,
    input.identities.module_worker.space,
    input.projectName ?? input.identities.module_worker.name,
    true,
    input.revisions,
  );
  const space = identitySet.module_worker.space;
  const fetchImpl = input.fetchImpl ?? fetch;
  const observations = await Promise.all(
    RESOURCE_KEYS.map(async (key): Promise<
      | { readonly key: ResourceKey; readonly evidence: NativeAbsenceResourceEvidence }
      | { readonly key: ResourceKey; readonly failure: NativeAbsenceFailure }
    > => {
      const identity = identitySet[key];
      const url = buildNativeResidualURL({
        host: input.host,
        organizationId,
        identity,
      });
      let timed: TimedResponse;
      try {
        timed = await fetchWithTimeout(
          fetchImpl,
          url,
          {
            method: "GET",
            redirect: "manual",
            headers: {
              accept: "application/json",
              authorization: `Bearer ${input.token}`,
              "cache-control": "no-store",
            },
          },
          input.timeoutMs,
        );
      } catch {
        return { key, failure: { key, code: "request_failed" } };
      }
      const response = timed.response;
      let rawBody: string;
      try {
        rawBody = await readTimedResponse(timed);
      } catch {
        return { key, failure: { key, code: "malformed_response" } };
      }
      if (response.status !== 200) {
        return {
          key,
          failure: { key, code: "http_status", status: response.status },
        };
      }
      const cacheControl = response.headers.get("cache-control") ?? "";
      if (
        !cacheControl
          .split(",")
          .map((value) => value.trim().toLowerCase())
          .includes("no-store")
      ) {
        return { key, failure: { key, code: "malformed_response" } };
      }
      try {
        const observation = assertNativeResidualResponse(
          boundedJson(rawBody, "native residual response"),
        );
        return {
          key,
          evidence: {
            ...observation,
            name: identity.name,
            uid: identity.uid,
          },
        };
      } catch (error) {
        return {
          key,
          failure: {
            key,
            code:
              error instanceof TracerError && error.message.includes("exact absent")
                ? "unexpected_status"
                : "malformed_response",
          },
        };
      }
    }),
  );
  const failures = observations.flatMap((entry) =>
    "failure" in entry ? [entry.failure] : [],
  );
  if (failures.length > 0) throw new NativeAbsenceError(failures);
  const resources = {} as Record<ResourceKey, NativeAbsenceResourceEvidence>;
  for (const entry of observations) {
    if ("evidence" in entry) resources[entry.key] = entry.evidence;
  }
  const evidence: NativeAbsenceEvidence = {
    kind: NATIVE_ABSENCE_KIND,
    status: "passed",
    organizationId,
    space,
    resourceCount: 5,
    checkedCount: 5,
    resources,
  };
  assertNoKnownSecrets(evidence, input.token);
  return evidence;
}

function endpointURL(identity: ResourceIdentity): URL {
  const value = identity.url;
  if (typeof value !== "string" || !value) throw new TracerError("WorkerEndpoint did not return an assigned URL");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TracerError("WorkerEndpoint URL is not absolute");
  }
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new TracerError("WorkerEndpoint URL must be an HTTPS path-root URL");
  }
  if (typeof identity.hostname === "string" && identity.hostname !== url.hostname) {
    throw new TracerError("WorkerEndpoint hostname and URL do not match");
  }
  return url;
}

async function runLoopbackProbe(input: {
  readonly workerPath: string;
  readonly configValue: string;
  readonly nonce: string;
  readonly projectUid: string;
  readonly fetchImpl: FetchFunction;
  readonly timeoutMs: number;
}): Promise<readonly RuntimeProbeCheck[]> {
  const workerModule = (await import(`${pathToFileURL(input.workerPath).href}?tracer=${Date.now()}`)) as {
    default?: { fetch?: (request: Request, env: Record<string, string>, ctx: unknown) => Promise<Response> | Response };
  };
  const fetchHandler = workerModule.default?.fetch;
  if (typeof fetchHandler !== "function") throw new TracerError("tracer Worker module does not export fetch");
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request: Request) => fetchHandler(request, {
      TAKOS_FETCH_TRACER_CONFIG: input.configValue,
      TAKOS_FETCH_TRACER_NONCE: input.nonce,
      TAKOS_FETCH_TRACER_PROJECT_UID: input.projectUid,
    }, {}),
  });
  try {
    return await probeRuntimeRoutes({
      endpoint: server.url,
      configValue: input.configValue,
      nonce: input.nonce,
      projectUid: input.projectUid,
      timeoutMs: input.timeoutMs,
      fetchImpl: input.fetchImpl,
      subject: "loopback Worker probe",
    });
  } finally {
    server.stop(true);
  }
}

export type RuntimeProbeCheck = {
  readonly name: "root-correlation" | "health" | "takos-discovery";
  readonly path: "/" | "/health" | "/.well-known/takos";
  readonly status: 200;
  readonly anonymous: true;
};

async function probeRuntimeRoutes(input: {
  readonly endpoint: URL;
  readonly configValue: string;
  readonly nonce: string;
  readonly projectUid: string;
  readonly timeoutMs: number;
  readonly fetchImpl: FetchFunction;
  readonly subject: string;
}): Promise<readonly RuntimeProbeCheck[]> {
  const checks = [
    {
      name: "root-correlation",
      path: "/",
      assertBody: (value: unknown): void =>
        assertExactProbeBody(value, input.configValue, input.nonce, input.projectUid),
    },
    { name: "health", path: "/health", assertBody: assertExactHealthBody },
    {
      name: "takos-discovery",
      path: "/.well-known/takos",
      assertBody: assertExactDiscoveryBody,
    },
  ] as const;
  const evidence: RuntimeProbeCheck[] = [];
  for (const check of checks) {
    const url = new URL(check.path, input.endpoint);
    const timed = await fetchWithTimeout(
      input.fetchImpl,
      url,
      {
        method: "GET",
        redirect: "manual",
        headers: { accept: "application/json" },
      },
      input.timeoutMs,
    );
    const response = timed.response;
    const rawBody = await readTimedResponse(timed);
    if (response.status !== 200) {
      throw new TracerError(`${input.subject} ${check.path} returned HTTP ${response.status}`);
    }
    if (
      response.headers.has("location") ||
      response.headers.has("set-cookie") ||
      response.headers.has("www-authenticate")
    ) {
      throw new TracerError(`${input.subject} ${check.path} did not preserve the anonymous no-redirect boundary`);
    }
    check.assertBody(boundedJson(rawBody, `${input.subject} ${check.path}`));
    evidence.push({
      name: check.name,
      path: check.path,
      status: 200,
      anonymous: true,
    });
  }
  return evidence;
}

export async function probeRuntime(input: {
  readonly endpoint: ResourceIdentity;
  readonly workerPath: string;
  readonly configValue: string;
  readonly nonce: string;
  readonly projectUid: string;
  readonly expectedEndpointOrigin: string;
  readonly targetHost: string;
  readonly timeoutMs: number;
  readonly fetchImpl?: FetchFunction;
}): Promise<{
  readonly mode: "loopback-diagnostic" | "assigned-endpoint";
  readonly assignedUrl: string;
  readonly evidence: string;
  readonly checks: readonly RuntimeProbeCheck[];
}> {
  const endpoint = assertEndpointTarget({
    assignedUrl: endpointURL(input.endpoint).toString(),
    hostname: input.endpoint.hostname,
    expectedOrigin: input.expectedEndpointOrigin,
    targetHost: input.targetHost,
  });
  const fetchImpl = input.fetchImpl ?? fetch;
  if (isLoopbackDiagnosticHost(input.targetHost) && normalizedHostname(endpoint.hostname).endsWith(".invalid")) {
    const checks = await runLoopbackProbe({
      workerPath: input.workerPath,
      configValue: input.configValue,
      nonce: input.nonce,
      projectUid: input.projectUid,
      fetchImpl,
      timeoutMs: input.timeoutMs,
    });
    return {
      mode: "loopback-diagnostic",
      assignedUrl: endpoint.toString(),
      evidence: "diagnostic-only-not-host-runtime",
      checks,
    };
  }
  const checks = await probeRuntimeRoutes({
    endpoint,
    configValue: input.configValue,
    nonce: input.nonce,
    projectUid: input.projectUid,
    timeoutMs: input.timeoutMs,
    fetchImpl,
    subject: "assigned Worker probe",
  });
  return {
    mode: "assigned-endpoint",
    assignedUrl: endpoint.toString(),
    evidence: "host-runtime-readback",
    checks,
  };
}

export type TofuPhase = "init" | "validate" | "show" | "output" | "state" | "plan" | "apply" | "destroy" | "version";

async function runTofu(input: {
  readonly config: CliConfig;
  readonly workDir: string;
  readonly environment: Record<string, string | undefined>;
  readonly args: readonly string[];
  readonly phase: TofuPhase;
  readonly command?: string;
  readonly spawn?: SpawnFunction;
}): Promise<CommandResult> {
  const environment = { ...input.environment };
  if (input.phase !== "plan" && input.phase !== "apply" && input.phase !== "destroy") {
    delete environment.TAKOFORM_TOKEN;
  }
  return runBoundedCommand({
    command: input.command ?? input.config.tofu,
    args: input.args,
    cwd: input.workDir,
    env: environment,
    timeoutMs: input.config.timeoutMs,
    killGraceMs: input.config.killGraceMs,
    token: [input.config.token, input.config.evidenceToken],
    spawn: input.spawn,
  });
}

export type ToolchainEvidence = {
  readonly path: string;
  readonly version: string;
  readonly sha256: string;
};

export type ProviderBinaryEvidence = {
  readonly path: string;
  readonly platform: string;
  readonly archiveSha256?: string;
  readonly sha256: string;
};

function resolveExecutable(command: string): string {
  const candidate = command.includes("/")
    ? resolve(command)
    : (Bun as unknown as { which?: (name: string) => string | undefined }).which?.(command);
  if (!candidate) throw new TracerError(`executable ${command} could not be resolved`);
  return candidate;
}

export async function verifyTofuToolchain(input: {
  readonly config: CliConfig;
  readonly workDir: string;
  readonly environment: Record<string, string | undefined>;
  readonly spawn?: SpawnFunction;
}): Promise<ToolchainEvidence> {
  const path = await realpath(resolveExecutable(input.config.tofu)).catch((error: unknown) => {
    throw new TracerError("tofu executable could not be resolved", { cause: error });
  });
  const info = await lstat(path).catch((error: unknown) => {
    throw new TracerError("tofu executable could not be inspected", { cause: error });
  });
  if (!info.isFile() || (info.mode & 0o111) === 0) throw new TracerError("tofu executable must be a regular executable file");
  const bytes = await readFile(path);
  const result = await runTofu({
    config: input.config,
    workDir: input.workDir,
    environment: input.environment,
    args: ["version"],
    phase: "version",
    command: path,
    spawn: input.spawn,
  });
  const combined = `${result.stdout}\n${result.stderr}`;
  const version = combined.match(/\bOpenTofu\s+v([0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?)/u)?.[1];
  if (!version) throw new TracerError("tofu version output was not canonical");
  return { path, version, sha256: hashFileBytes(bytes) };
}

async function findProviderBinaries(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile() && /^terraform-provider-takoform_v4\.0\.0(?:\.exe)?$/u.test(entry.name)) {
        found.push(path);
      }
    }
  };
  await walk(root);
  return found;
}

export async function verifyInstalledProviderBinary(workDir: string, tfDataDir?: string): Promise<ProviderBinaryEvidence> {
  const providerRoots = [
    join(workDir, ".terraform", "providers", "registry.terraform.io", "tako0614", "takoform", PROVIDER_VERSION),
    ...(tfDataDir ? [join(tfDataDir, "providers", "registry.terraform.io", "tako0614", "takoform", PROVIDER_VERSION)] : []),
  ];
  const candidates: string[] = [];
  for (const providerRoot of providerRoots) {
    const found = await findProviderBinaries(providerRoot).catch(() => []);
    candidates.push(...found);
  }
  if (candidates.length !== 1) throw new TracerError("public Provider 4.0.0 installation must contain exactly one provider binary");
  const path = await realpath(candidates[0]);
  const allowedRoots = await Promise.all([workDir, ...(tfDataDir ? [tfDataDir] : [])].map((root) => realpath(root)));
  if (!allowedRoots.some((rootPath) => path === rootPath || path.startsWith(rootPath.endsWith("/") ? rootPath : `${rootPath}/`))) {
    throw new TracerError("provider binary escaped the isolated tracer workdir");
  }
  const info = await lstat(path);
  if (!info.isFile() || (info.mode & 0o111) === 0) throw new TracerError("installed provider binary must be a regular executable file");
  const platform = path.match(/(?:^|[/\\])(darwin|linux|windows)_(amd64|arm64)(?:[/\\])/u);
  if (!platform) throw new TracerError("installed provider binary path did not carry a canonical platform");
  return { path, platform: `${platform[1]}/${platform[2]}`, sha256: hashFileBytes(await readFile(path)) };
}

async function prepareWorkspaceForIdentity(config: CliConfig, identity: RunIdentity): Promise<{
  readonly root: string;
  readonly workDir: string;
  readonly environment: Record<string, string | undefined>;
  readonly projectName: string;
  readonly nonce: string;
  readonly projectUid: string;
  readonly addresses: ProjectResourceAddresses;
  readonly revisions: RevisionNameContext;
}> {
  const root = await mkdtemp(join(tmpdir(), "takoserver-fetch-tracer-"));
  try {
    const projectName = identity.projectName;
    const workDir = join(root, "fixture");
    await cp(config.fixtureDir, workDir, { recursive: true });
    const workerModuleBytes = await readFile(join(workDir, "worker.mjs"));
    const revisions = createRevisionNameContext({
      projectName,
      configValue: config.configValue,
      nonce: identity.nonce,
      projectUid: identity.projectUid,
      workerModuleBytes,
    });
    const cliConfigFile = join(root, "tofu.tfrc");
    await writeFile(cliConfigFile, createProviderInstallConfig(), { mode: 0o600 });
    const tfDataDir = join(root, "tfdata");
    await mkdir(tfDataDir, { recursive: true });
    const homeDir = join(root, "home");
    await mkdir(homeDir, { recursive: true });
    const environment = buildTofuEnvironment({
      host: config.host,
      space: config.space,
      token: config.token,
      tokenEnv: config.tokenEnv,
      configValue: config.configValue,
      cliConfigFile,
      tfDataDir,
      projectName,
      projectNonce: identity.nonce,
      projectUid: identity.projectUid,
    });
    // Keep implicit home-directory plugin directories and registry credentials
    // outside the caller's environment. The lockfile plus direct installation
    // must be the only Provider source considered by this run.
    environment.HOME = homeDir;
    return {
      root,
      workDir,
      environment,
      projectName,
      nonce: identity.nonce,
      projectUid: identity.projectUid,
      addresses: knownResourceAddresses(config.space, projectName, revisions),
      revisions,
    };
  } catch (error) {
    const cleaned = await cleanupRunRoot(root);
    if (!cleaned.removed) {
      const cleanupFailure = new TracerError("tracer setup cleanup could not remove the workdir", {
        recoveryPath: cleaned.recoveryPath,
        cause: redactErrorInPlace(cleaned.error, [config.token, config.evidenceToken]),
      });
      throw combineTracerFailures({
        primary: error,
        cleanup: cleanupFailure,
        recoveryPath: cleaned.recoveryPath,
        secrets: [config.token, config.evidenceToken],
      });
    }
    throw error;
  }
}

export async function cleanupRunRoot(
  root: string,
  options: { readonly remove?: (path: string) => Promise<void> } = {},
): Promise<{ readonly removed: true; readonly recoveryPath?: never } | { readonly removed: false; readonly recoveryPath: string; readonly error: unknown }> {
  try {
    if (options.remove) await options.remove(root);
    else await rm(root, { recursive: true, force: true });
    return { removed: true };
  } catch (error) {
    return { removed: false, recoveryPath: root, error };
  }
}

/**
 * Complete the post-apply recovery proof. A successful destroy command is not
 * enough: the Host must answer the exact absence envelope for every known
 * resource before state is removed. The absence callback is always attempted,
 * including when destroy fails or apply was indeterminate.
 */
export async function cleanupAfterApply(input: {
  readonly recoveryPath: string;
  readonly destroy: () => Promise<void>;
  readonly absence: () => Promise<void>;
  readonly remove: () => Promise<void>;
  readonly secrets?: SecretInput;
}): Promise<void> {
  let destroyError: unknown;
  try {
    await input.destroy();
  } catch (error) {
    destroyError = redactErrorInPlace(error, input.secrets);
  }

  let absenceError: unknown;
  try {
    await input.absence();
  } catch (error) {
    absenceError = redactErrorInPlace(error, input.secrets);
  }

  if (destroyError || absenceError) {
    const details = [destroyError, absenceError]
      .filter((error): error is Error => error instanceof Error)
      .map((error) => safeErrorMessage(error, input.secrets))
      .join("; ");
    throw new TracerError(
      `tracer cleanup is not authoritative; recovery workdir preserved${details ? `: ${details}` : ""}`,
      { recoveryPath: input.recoveryPath, cause: destroyError ?? absenceError },
    );
  }

  try {
    await input.remove();
  } catch (error) {
    throw new TracerError("tracer cleanup proof passed but recovery workdir could not be removed", {
      recoveryPath: input.recoveryPath,
      cause: redactErrorInPlace(error, input.secrets),
    });
  }
}

/**
 * Keep the phase that first failed as the thrown error while making cleanup
 * failure independently visible. Cleanup is recovery evidence, never the
 * authority for replacing an Apply/readback/validation failure.
 */
export function combineTracerFailures(input: {
  readonly primary: unknown;
  readonly cleanup: unknown;
  readonly recoveryPath?: string;
  readonly completedMilestones?: readonly TracerMilestone[];
  readonly secrets?: SecretInput;
}): Error {
  const primary = redactErrorInPlace(input.primary, input.secrets);
  const cleanup = redactErrorInPlace(input.cleanup, input.secrets);
  const primaryMessage = safeErrorMessage(primary, input.secrets);
  const cleanupMessage = safeErrorMessage(cleanup, input.secrets);
  const recoveryPath = input.recoveryPath ?? (cleanup instanceof TracerError ? cleanup.recoveryPath : undefined);
  if (primary instanceof Error) {
    primary.message = `${primaryMessage}; cleanup also failed: ${cleanupMessage}`;
    const existingCause =
      (primary as Error & { cause?: unknown }).cause ??
      (primary instanceof TracerError ? primary.causeError : undefined);
    const causes = [existingCause, cleanup].filter((cause): cause is unknown => cause !== undefined);
    if (causes.length > 0) {
      Object.defineProperty(primary, "cause", {
        configurable: true,
        enumerable: false,
        value: causes.length === 1
          ? causes[0]
          : new AggregateError(causes, "tracer phase and cleanup both failed"),
        writable: true,
      });
    }
    Object.defineProperty(primary, "cleanupError", {
      configurable: true,
      enumerable: false,
      value: cleanup,
      writable: true,
    });
    if (recoveryPath) {
      Object.defineProperty(primary, "recoveryPath", {
        configurable: true,
        enumerable: false,
        value: recoveryPath,
        writable: true,
      });
    }
    if (input.completedMilestones) {
      Object.defineProperty(primary, "completedMilestones", {
        configurable: true,
        enumerable: false,
        value: [...input.completedMilestones],
        writable: false,
      });
    }
    return primary;
  }
  return new TracerError(
    `tracer phase failed: ${primaryMessage}; cleanup also failed: ${cleanupMessage}`,
    {
      recoveryPath,
      cause: new AggregateError(
        [primary, cleanup],
        "tracer phase and cleanup both failed",
      ),
      cleanupError: cleanup,
      completedMilestones: input.completedMilestones,
    },
  );
}

export type TracerProvenance = {
  readonly takosHead: string;
  readonly workspace: {
    readonly dirty: boolean;
    readonly staged: boolean;
    readonly untracked: boolean;
    readonly digest: string;
  };
  readonly files: Readonly<Record<string, string>>;
};

export function parseWorkspaceStatus(status: string): {
  readonly dirty: boolean;
  readonly staged: boolean;
  readonly untracked: boolean;
} {
  let dirty = false;
  let staged = false;
  let untracked = false;
  const records = status.split("\0");
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const code = record.slice(0, 2);
    if (code === "??") {
      untracked = true;
      continue;
    }
    if (code[0] && code[0] !== " ") staged = true;
    if (code[1] && code[1] !== " ") dirty = true;
    // Porcelain -z emits the old path as a second NUL-delimited record for
    // renames/copies. It is a filename, not another XY status record.
    if (code[0] === "R" || code[0] === "C" || code[1] === "R" || code[1] === "C") {
      index += 1;
    }
  }
  return { dirty, staged, untracked };
}

async function readOnlyCommand(input: {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly killGraceMs: number;
  readonly token?: SecretInput;
}): Promise<CommandResult> {
  return runBoundedCommand({
    command: input.command,
    args: input.args,
    cwd: input.cwd,
    env: allowlistedParentEnvironment(process.env),
    timeoutMs: input.timeoutMs,
    killGraceMs: input.killGraceMs,
    token: input.token,
    maxOutputBytes: 256 * 1024,
    // These bytes are never surfaced. Provenance must hash the exact Git/Go
    // output; token-dependent redaction would make an unchanged workspace
    // produce a different digest and collapse distinct byte streams.
    redactSuccessfulOutput: false,
  });
}

function hashFileBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function collectWorkspaceProvenance(input: {
  readonly repoRoot: string;
  readonly timeoutMs: number;
  readonly killGraceMs: number;
  readonly token?: SecretInput;
}): Promise<TracerProvenance["workspace"] & { readonly takosHead: string }> {
  const headResult = await readOnlyCommand({
    command: "git",
    args: ["rev-parse", "HEAD"],
    cwd: input.repoRoot,
    timeoutMs: input.timeoutMs,
    killGraceMs: input.killGraceMs,
    token: input.token,
  });
  const takosHead = headResult.stdout.trim();
  if (!/^[0-9a-f]{40}$/u.test(takosHead)) throw new TracerError("git HEAD provenance was not a canonical commit id");

  const statusResult = await readOnlyCommand({
    command: "git",
    args: ["status", "--porcelain=v1", "--untracked-files=all", "-z"],
    cwd: input.repoRoot,
    timeoutMs: input.timeoutMs,
    killGraceMs: input.killGraceMs,
    token: input.token,
  });
  const status = parseWorkspaceStatus(statusResult.stdout);
  const diffResult = await readOnlyCommand({
    command: "git",
    args: ["diff", "--binary", "--no-ext-diff", "--"],
    cwd: input.repoRoot,
    timeoutMs: input.timeoutMs,
    killGraceMs: input.killGraceMs,
    token: input.token,
  });
  const cachedDiffResult = await readOnlyCommand({
    command: "git",
    args: ["diff", "--cached", "--binary", "--no-ext-diff", "--"],
    cwd: input.repoRoot,
    timeoutMs: input.timeoutMs,
    killGraceMs: input.killGraceMs,
    token: input.token,
  });
  const untrackedResult = await readOnlyCommand({
    command: "git",
    args: ["ls-files", "--others", "--exclude-standard", "-z"],
    cwd: input.repoRoot,
    timeoutMs: input.timeoutMs,
    killGraceMs: input.killGraceMs,
    token: input.token,
  });
  const untrackedPaths = untrackedResult.stdout.split("\0").filter((path) => path && !path.startsWith(".git/"));
  const digest = createHash("sha256");
  digest.update(statusResult.stdout, "utf8");
  digest.update("\0worktree-diff\0", "utf8");
  digest.update(diffResult.stdout, "utf8");
  digest.update("\0cached-diff\0", "utf8");
  digest.update(cachedDiffResult.stdout, "utf8");
  digest.update("\0untracked-inventory\0", "utf8");
  for (const path of [...new Set(untrackedPaths)].sort()) {
    const info = await lstat(join(input.repoRoot, path)).catch(() => undefined);
    if (!info || !info.isFile() || info.isSymbolicLink()) continue;
    digest.update(path, "utf8");
    digest.update("\0bytes\0", "utf8");
    const bytes = await readFile(join(input.repoRoot, path)).catch((error: unknown) => {
      throw new TracerError(`could not read ${path} for workspace provenance`, { cause: error });
    });
    digest.update(bytes);
  }
  return {
    takosHead,
    dirty: status.dirty || status.staged || status.untracked,
    staged: status.staged,
    untracked: status.untracked,
    digest: `sha256:${digest.digest("hex")}`,
  };
}

export async function collectProvenance(input: {
  readonly repoRoot: string;
  readonly timeoutMs: number;
  readonly killGraceMs: number;
  readonly token?: SecretInput;
}): Promise<TracerProvenance> {
  const workspace = await collectWorkspaceProvenance(input);
  const files: Record<string, string> = {};
  for (const relativePath of SOURCE_INVENTORY) {
    const bytes = await readFile(join(input.repoRoot, relativePath)).catch((error: unknown) => {
      throw new TracerError("could not hash tracer source file " + relativePath, { cause: error });
    });
    files[relativePath] = hashFileBytes(bytes);
  }
  return {
    takosHead: workspace.takosHead,
    workspace: {
      dirty: workspace.dirty,
      staged: workspace.staged,
      untracked: workspace.untracked,
      digest: workspace.digest,
    },
    files,
  };
}

export type TracerReport = {
  readonly kind: typeof REPORT_KIND;
  readonly label: typeof REPORT_LABEL;
  readonly evidence: "not publication/live release evidence";
  readonly provider: {
    readonly source: typeof PROVIDER_SOURCE;
    readonly version: typeof PROVIDER_VERSION;
    readonly constraint: typeof PROVIDER_CONSTRAINT;
    readonly lockfileSha256: string;
    readonly lockfileH1Checksums: readonly string[];
    readonly lockfileZhChecksums: readonly string[];
    readonly registryMetadataSources: readonly string[];
    readonly archiveChecksums: ProviderReleaseEvidence["archiveChecksums"];
    readonly canonicalChecksums: readonly string[];
    readonly checksumSource: typeof PUBLIC_PROVIDER_CHECKSUM_SOURCE;
    readonly signatureSource: typeof PUBLIC_PROVIDER_SIGNATURE_SOURCE;
    readonly signingKeyId: typeof PUBLIC_PROVIDER_SIGNING_KEY_ID;
    readonly signingKeyFingerprint: typeof PUBLIC_PROVIDER_SIGNING_KEY_FINGERPRINT;
    readonly checksumsSha256: string;
    readonly signatureSha256: string;
    readonly signatureVerified: true;
    readonly installedBinary: ProviderBinaryEvidence;
  };
  readonly toolchain: ToolchainEvidence;
  readonly host: { readonly origin: string; readonly discoveryPath: typeof V1_DISCOVERY_PATH; readonly apiRoot: string };
  readonly space: string;
  readonly buildIdentity: typeof BUILD_IDENTITY;
  readonly configValue: string;
  readonly run: {
    readonly projectName: string;
    readonly projectUid: string;
    readonly nonce: string;
    readonly endpointOriginTemplate: string;
    readonly expectedEndpointOrigin: string;
  };
  readonly resources: Record<ResourceKey, ResourceIdentity>;
  readonly runtimeProbe: {
    readonly mode: "loopback-diagnostic" | "assigned-endpoint";
    readonly assignedUrl: string;
    readonly exact: true;
    readonly evidence: string;
    readonly checks: readonly RuntimeProbeCheck[];
  };
  readonly runtime: {
    readonly assignedUrl: string;
    readonly nonce: string;
    readonly projectUid: string;
    readonly mode: "loopback-diagnostic" | "assigned-endpoint";
    readonly hostRuntimeEligible: boolean;
    readonly e2eEligible: boolean;
    readonly gaEligible: boolean;
  };
  readonly ledger: {
    readonly plan: PlanEvidence;
    readonly hostResources: { readonly absence: "passed" };
    readonly endpoint: EndpointAbsenceEvidence & { readonly expectedOrigin: string };
  };
  readonly native:
    | (NativeAbsenceEvidence & {
      readonly zeroResidual: true;
      readonly gaEligible: false;
    })
    | {
      readonly status: "not-applicable";
      readonly zeroResidual: false;
      readonly gaEligible: false;
      readonly reason: "loopback-diagnostic-is-not-takoserver-runtime-evidence";
    };
  readonly lifecycle: {
    readonly init: "passed";
    readonly validate: "passed";
    readonly plan: "passed";
    readonly apply: "passed";
    readonly destroy: "passed";
    readonly absence: "passed" | "not-applicable";
  };
  readonly provenance: TracerProvenance;
};

export async function runTracer(config: CliConfig, options: {
  readonly fetchImpl?: FetchFunction;
  readonly providerFetchImpl?: FetchFunction;
  readonly spawn?: SpawnFunction;
} = {}): Promise<TracerReport> {
  validateEndpointOriginTemplate(config.endpointOriginTemplate);
  const templateHost = new URL(config.endpointOriginTemplate.replace("{project}", "takos-fetch-tracer-project")).hostname;
  if (config.host.startsWith("https:") && normalizedHostname(templateHost).endsWith(".invalid")) {
    throw new TracerError("HTTPS live Host requires a non-.invalid project-derived endpoint origin template");
  }
  const completedMilestones = new Set<TracerMilestone>();
  const markMilestone = (milestone: TracerMilestone): void => {
    completedMilestones.add(milestone);
  };
  const runIdentity = createRunIdentity();
  const rootState = await prepareWorkspaceForIdentity(config, runIdentity);
  const expectedEndpointOrigin = materializeEndpointOrigin(config.endpointOriginTemplate, rootState.projectName);
  const assignedEndpoint = { url: undefined as string | undefined, hostname: undefined as string | undefined };
  let endpointAbsence: EndpointAbsenceEvidence | undefined;
  let appliedIdentities: Record<ResourceKey, ResourceIdentity> | undefined;
  let nativeAbsence:
    | NativeAbsenceEvidence
    | {
      readonly status: "not-applicable";
      readonly reason: "loopback-diagnostic-is-not-takoserver-runtime-evidence";
    }
    | undefined;
  let planEvidence: PlanEvidence | undefined;
  let lockEvidence: ProviderLock | undefined;
  let toolchainEvidence: ToolchainEvidence | undefined;
  let providerBinaryEvidence: ProviderBinaryEvidence | undefined;
  let providerReleaseEvidence: ProviderReleaseEvidence | undefined;
  let tofuCommand: string | undefined;
  markMilestone("workspace_prepared");
  let discovery: Discovery | undefined;

  const destroyArgs = ["destroy", "-auto-approve", "-input=false", "-no-color"] as const;
  const absenceAndStateCheck = async (checkState: boolean): Promise<void> => {
    let stateError: unknown;
    if (checkState) {
      try {
        const stateResult = await runTofu({
          config,
          workDir: rootState.workDir,
          environment: rootState.environment,
          args: ["state", "list", "-no-color"],
          phase: "state",
          command: tofuCommand,
          spawn: options.spawn,
        });
        if (stateResult.stdout.trim() !== "") {
          throw new TracerError("tofu state list is not empty after destroy");
        }
        markMilestone("state_empty");
      } catch (error) {
        stateError = error;
      }
    }

    let absenceError: unknown;
    if (!discovery) {
      absenceError = new TracerError("Host discovery was unavailable for authoritative absence");
    } else {
      try {
        await assertAuthoritativeAbsence({
          apiRoot: discovery.apiRoot,
          addresses: rootState.addresses,
          token: config.evidenceToken,
          timeoutMs: config.timeoutMs,
          fetchImpl: options.fetchImpl,
        });
        markMilestone("absence_completed");
      } catch (error) {
        absenceError = error;
      }
    }

    let endpointError: unknown;
    if (!assignedEndpoint.url) {
      endpointError = new TracerError("assigned endpoint URL was unavailable for bounded endpoint absence proof");
    } else if (isLoopbackDiagnosticHost(config.host)) {
      endpointAbsence = {
        assignedUrl: assignedEndpoint.url,
        nonce: rootState.nonce,
        status: "not-applicable",
        applicability: "not-applicable",
        reason: "loopback-diagnostic-endpoint-has-no-host-runtime",
      };
      markMilestone("endpoint_absence_not_applicable");
    } else {
      try {
        endpointAbsence = await assertEndpointAbsence({
          assignedUrl: assignedEndpoint.url,
          expectedOrigin: materializeEndpointOrigin(config.endpointOriginTemplate, rootState.projectName),
          targetHost: config.host,
          nonce: rootState.nonce,
          timeoutMs: config.timeoutMs,
          fetchImpl: options.fetchImpl,
        });
        markMilestone("endpoint_absence_completed");
      } catch (error) {
        endpointError = error;
      }
    }

    let nativeError: unknown;
    if (isLoopbackDiagnosticHost(config.host)) {
      nativeAbsence = {
        status: "not-applicable",
        reason: "loopback-diagnostic-is-not-takoserver-runtime-evidence",
      };
      markMilestone("native_absence_not_applicable");
    } else if (!appliedIdentities) {
      nativeError = new TracerError(
        "pre-destroy Host identities were unavailable for native absence verification",
      );
    } else {
      try {
        nativeAbsence = await verifyNativeAbsence({
          host: config.host,
          organizationId: config.organizationId,
          identities: appliedIdentities,
          token: config.evidenceToken,
          timeoutMs: config.timeoutMs,
          projectName: rootState.projectName,
          revisions: rootState.revisions,
          fetchImpl: options.fetchImpl,
        });
        markMilestone("native_absence_completed");
      } catch (error) {
        nativeError = error;
      }
    }

    if (stateError || absenceError || endpointError || nativeError) {
      const details = [stateError, absenceError, endpointError, nativeError]
        .filter((error): error is Error => error instanceof Error)
        .map((error) => safeErrorMessage(error, [config.token, config.evidenceToken]))
        .join("; ");
      throw new TracerError(
        "post-destroy cleanup proof failed" + (details ? ": " + details : ""),
        { cause: redactErrorInPlace(stateError ?? absenceError ?? endpointError, [config.token, config.evidenceToken]) },
      );
    }
  };

  const removeRoot = async (): Promise<void> => {
    const cleaned = await cleanupRunRoot(rootState.root);
    if (!cleaned.removed) throw cleaned.error;
    markMilestone("workdir_removed");
  };

  const cleanupAppliedRun = async (checkState: boolean): Promise<void> => {
    await cleanupAfterApply({
      recoveryPath: rootState.root,
      destroy: async () => {
        await runTofu({
          config,
          workDir: rootState.workDir,
          environment: rootState.environment,
          args: destroyArgs,
          phase: "destroy",
          command: tofuCommand,
          spawn: options.spawn,
        });
        markMilestone("destroy_completed");
      },
      absence: async () => absenceAndStateCheck(checkState),
      remove: removeRoot,
      secrets: [config.token, config.evidenceToken],
    });
  };

  try {
    providerReleaseEvidence = await fetchPublicProviderRelease({
      timeoutMs: config.timeoutMs,
      fetchImpl: options.providerFetchImpl,
    });
    markMilestone("provider_release_verified");

    toolchainEvidence = await verifyTofuToolchain({
      config,
      workDir: rootState.workDir,
      environment: rootState.environment,
      spawn: options.spawn,
    });
    tofuCommand = toolchainEvidence.path;
    markMilestone("toolchain_verified");

    const initResult = await runTofu({
      config,
      workDir: rootState.workDir,
      environment: rootState.environment,
      args: ["init", "-backend=false", "-input=false", "-lockfile=readonly", "-no-color"],
      phase: "init",
      command: tofuCommand,
      spawn: options.spawn,
    });
    if (!initResult) throw new TracerError("tofu init did not return a result");
    markMilestone("init_completed");

    const lockfilePath = join(rootState.workDir, ".terraform.lock.hcl");
    const lockfile = await readFile(lockfilePath, "utf8").catch((error: unknown) => {
      throw new TracerError("public Provider lockfile is missing from the fixture", { cause: error });
    });
    lockEvidence = assertProviderLockfile(lockfile);
    providerBinaryEvidence = await verifyInstalledProviderBinary(rootState.workDir, rootState.environment.TF_DATA_DIR);
    if (!providerReleaseEvidence) throw new TracerError("public Provider release provenance was missing before provider installation");
    const archive = providerReleaseEvidence.archiveChecksums.find((entry) => entry.platform === providerBinaryEvidence?.platform);
    if (!archive) throw new TracerError("installed Provider binary platform was absent from the signed public release checksums");
    providerBinaryEvidence = { ...providerBinaryEvidence, archiveSha256: archive.sha256 };
    markMilestone("provider_verified");

    discovery = await discoverV1({
      host: config.host,
      token: config.evidenceToken,
      timeoutMs: config.timeoutMs,
      fetchImpl: options.fetchImpl,
    });
    markMilestone("discovery_completed");

    await runTofu({
      config,
      workDir: rootState.workDir,
      environment: rootState.environment,
      args: ["validate", "-no-color"],
      phase: "validate",
      command: tofuCommand,
      spawn: options.spawn,
    });
    markMilestone("validate_completed");

    const workerModuleBytes = await readFile(join(rootState.workDir, "worker.mjs"));
    const planExpectation: PlanExpectation = {
      projectName: rootState.projectName,
      space: config.space,
      configValue: config.configValue,
      nonce: rootState.nonce,
      projectUid: rootState.projectUid,
      workerModuleSha256: hashFileBytes(workerModuleBytes),
      workerModuleSize: workerModuleBytes.byteLength,
      revisions: rootState.revisions,
    };
    const planPath = join(rootState.workDir, "tracer.tfplan");
    await runTofu({
      config,
      workDir: rootState.workDir,
      environment: rootState.environment,
      args: ["plan", "-input=false", "-no-color", "-out", planPath],
      phase: "plan",
      command: tofuCommand,
      spawn: options.spawn,
    });
    markMilestone("plan_completed");

    const showResult = await runTofu({
      config,
      workDir: rootState.workDir,
      environment: rootState.environment,
      args: ["show", "-json", "-no-color", planPath],
      phase: "show",
      command: tofuCommand,
      spawn: options.spawn,
    });
    planEvidence = await inspectSavedPlan(planPath, showResult.stdout, planExpectation);
    markMilestone("plan_verified");

    markMilestone("apply_attempted");
    await runTofu({
      config,
      workDir: rootState.workDir,
      environment: rootState.environment,
      args: ["apply", "-auto-approve", "-input=false", "-no-color", planPath],
      phase: "apply",
      command: tofuCommand,
      spawn: options.spawn,
    });
    markMilestone("apply_completed");

    const outputsResult = await runTofu({
      config,
      workDir: rootState.workDir,
      environment: rootState.environment,
      args: ["output", "-json", "-no-color"],
      phase: "output",
      command: tofuCommand,
      spawn: options.spawn,
    });
    const parsedOutputs = parseTofuOutputs(
      boundedJson(outputsResult.stdout, "tofu output"),
      config.space,
      rootState.projectName,
      rootState.revisions,
    );
    if (parsedOutputs.nonce !== rootState.nonce || parsedOutputs.projectUid !== rootState.projectUid) {
      throw new TracerError("tofu outputs did not carry the exact per-run nonce and project UID");
    }
    assignedEndpoint.url = parsedOutputs.endpointURL;
    assignedEndpoint.hostname = parsedOutputs.endpointHostname;
    assertEndpointTarget({
      assignedUrl: parsedOutputs.endpointURL,
      hostname: parsedOutputs.endpointHostname,
      expectedOrigin: expectedEndpointOrigin,
      targetHost: config.host,
    });
    if (parsedOutputs.configValue !== config.configValue) {
      throw new TracerError("tofu output config_value does not match the requested non-secret value");
    }
    markMilestone("outputs_completed");

    const identities = {} as Record<ResourceKey, ResourceIdentity>;
    for (const key of RESOURCE_KEYS) {
      const identity = parsedOutputs.identities[key];
      const readback = await readHostResource({
        apiRoot: discovery.apiRoot,
        identity,
        token: config.evidenceToken,
        timeoutMs: config.timeoutMs,
        fetchImpl: options.fetchImpl,
      });
      if (readback.status !== 200) throw new TracerError(key + " readback returned HTTP " + readback.status);
      if (!readback.identity) throw new TracerError(key + " readback did not return an authoritative identity");
      identities[key] = readback.identity;
    }
    appliedIdentities = identities;
    markMilestone("resource_readback_completed");

    for (const resource of Object.values(identities)) {
      for (const value of Object.values(resource)) {
        if (typeof value === "string" && containsSecret(value, [config.token, config.evidenceToken])) {
          throw new TracerError("Host resource identity contained a token");
        }
      }
    }

    const runtime = await probeRuntime({
      endpoint: identities.worker_endpoint,
      workerPath: join(rootState.workDir, "worker.mjs"),
      configValue: config.configValue,
      nonce: rootState.nonce,
      projectUid: rootState.projectUid,
      expectedEndpointOrigin: expectedEndpointOrigin,
      targetHost: config.host,
      timeoutMs: config.timeoutMs,
      fetchImpl: options.fetchImpl,
    });
    markMilestone("runtime_probe_completed");

    const provenance = await collectProvenance({
      repoRoot: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
      timeoutMs: config.timeoutMs,
      killGraceMs: config.killGraceMs,
      token: [config.token, config.evidenceToken],
    });
    markMilestone("provenance_completed");

    if (!planEvidence || !lockEvidence || !toolchainEvidence || !providerBinaryEvidence || !providerReleaseEvidence || !providerBinaryEvidence.archiveSha256) {
      throw new TracerError("tracer evidence was incomplete before report construction");
    }

    await cleanupAppliedRun(true);

    if (!endpointAbsence || !nativeAbsence) {
      throw new TracerError("post-destroy absence evidence was incomplete before report construction");
    }

    const report: TracerReport = {
      kind: REPORT_KIND,
      label: REPORT_LABEL,
      evidence: "not publication/live release evidence",
      provider: {
        source: PROVIDER_SOURCE,
        version: PROVIDER_VERSION,
        constraint: PROVIDER_CONSTRAINT,
        lockfileSha256: provenance.files["deploy/opentofu/takoserver-fetch-tracer/.terraform.lock.hcl"],
        lockfileH1Checksums: lockEvidence.hashes.filter((hash) => hash.startsWith("h1:")),
        lockfileZhChecksums: lockEvidence.hashes.filter((hash) => hash.startsWith("zh:")),
        registryMetadataSources: providerReleaseEvidence.registryMetadataSources,
        archiveChecksums: providerReleaseEvidence.archiveChecksums,
        canonicalChecksums: providerReleaseEvidence.canonicalChecksums,
        checksumSource: providerReleaseEvidence.checksumSource,
        signatureSource: providerReleaseEvidence.signatureSource,
        signingKeyId: providerReleaseEvidence.signingKeyId,
        signingKeyFingerprint: providerReleaseEvidence.signingKeyFingerprint,
        checksumsSha256: providerReleaseEvidence.checksumsSha256,
        signatureSha256: providerReleaseEvidence.signatureSha256,
        signatureVerified: providerReleaseEvidence.signatureVerified,
        installedBinary: providerBinaryEvidence,
      },
      toolchain: toolchainEvidence,
      host: {
        origin: config.host,
        discoveryPath: V1_DISCOVERY_PATH,
        apiRoot: discovery.apiRoot,
      },
      space: config.space,
      buildIdentity: BUILD_IDENTITY,
      configValue: config.configValue,
      run: {
        projectName: rootState.projectName,
        projectUid: rootState.projectUid,
        nonce: rootState.nonce,
        endpointOriginTemplate: config.endpointOriginTemplate,
        expectedEndpointOrigin,
      },
      resources: identities,
      runtimeProbe: { ...runtime, exact: true },
      runtime: {
        assignedUrl: runtime.assignedUrl,
        nonce: rootState.nonce,
        projectUid: rootState.projectUid,
        mode: runtime.mode,
        hostRuntimeEligible: runtime.mode === "assigned-endpoint",
        e2eEligible: runtime.mode === "assigned-endpoint",
        gaEligible: false,
      },
      ledger: {
        plan: planEvidence,
        hostResources: { absence: "passed" },
        endpoint: { ...endpointAbsence, expectedOrigin: expectedEndpointOrigin },
      },
      native: nativeAbsence.status === "passed"
        ? {
          ...nativeAbsence,
          zeroResidual: true,
          gaEligible: false,
        }
        : {
          ...nativeAbsence,
          zeroResidual: false,
          gaEligible: false,
        },
      lifecycle: {
        init: "passed",
        validate: "passed",
        plan: "passed",
        apply: "passed",
        destroy: "passed",
        absence: runtime.mode === "loopback-diagnostic" ? "not-applicable" : "passed",
      },
      provenance,
    };

    return report;
  } catch (error) {
    const secrets = [config.token, config.evidenceToken] as const;
    if (error instanceof TracerError && error.recoveryPath === rootState.root) {
      redactErrorInPlace(error, secrets);
      Object.defineProperty(error, "completedMilestones", {
        configurable: true,
        enumerable: false,
        value: [...completedMilestones],
        writable: false,
      });
      throw error;
    }

    const primary = redactErrorInPlace(error, secrets);
    let cleanupFailure: unknown;
    try {
      if (completedMilestones.has("apply_attempted")) {
        await cleanupAppliedRun(completedMilestones.has("apply_completed"));
      } else {
        const cleaned = await cleanupRunRoot(rootState.root);
        if (!cleaned.removed) {
          throw new TracerError(
            "tracer failed before apply and cleanup could not remove the workdir",
            { recoveryPath: cleaned.recoveryPath, cause: cleaned.error },
          );
        }
        markMilestone("workdir_removed");
      }
    } catch (errorDuringCleanup) {
      cleanupFailure = errorDuringCleanup;
    }

    if (cleanupFailure) {
      throw combineTracerFailures({
        primary,
        cleanup: cleanupFailure,
        recoveryPath: rootState.root,
        completedMilestones: [...completedMilestones],
        secrets,
      });
    }

    if (primary instanceof Error) {
      Object.defineProperty(primary, "completedMilestones", {
        configurable: true,
        enumerable: false,
        value: [...completedMilestones],
        writable: false,
      });
    }
    throw primary;
  }
}

async function main(): Promise<void> {
  let config: CliConfig | undefined;
  try {
    config = parseArgs(process.argv.slice(2));
    const report = await runTracer(config);
    const secrets = [config.token, config.evidenceToken] as const;
    // Keep this assertion immediately adjacent to the final serialization.
    // Parse the serialized form again so a custom toJSON implementation cannot
    // introduce a secret after the in-memory walk has passed.
    assertNoKnownSecrets(report, secrets);
    const serializedReport = JSON.stringify(report, null, 2);
    assertNoKnownSecrets(JSON.parse(serializedReport) as unknown, secrets);
    process.stdout.write(`${serializedReport}\n`);
  } catch (error) {
    if (error instanceof HelpRequestedError) {
      assertNoKnownSecrets({ lines: error.message.split(/\r?\n/u) });
      process.stdout.write(`${error.message}\n`);
      return;
    }
    const secrets = [
      config?.token,
      config?.evidenceToken,
      process.env[MUTATION_TOKEN_ENV],
      process.env[EVIDENCE_TOKEN_ENV],
    ].filter((value): value is string => typeof value === "string" && value.length > 0);
    const message = error instanceof Error ? safeErrorMessage(error, secrets) : "tracer failed";
    const recoveryPath = error instanceof TracerError ? error.recoveryPath : undefined;
    const diagnostic = `${message}${recoveryPath ? `; recovery workdir: ${recoveryPath}` : ""}`;
    try {
      assertNoKnownSecrets({ message: diagnostic, recoveryPath }, secrets);
      process.stderr.write(`${diagnostic}\n`);
    } catch {
      // Do not serialize an unsafe diagnostic, even if an unexpected error
      // object bypassed the normal redaction path.
      process.stderr.write("tracer refused unsafe diagnostic output\n");
    }
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();
