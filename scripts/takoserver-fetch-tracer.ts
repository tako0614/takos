#!/usr/bin/env bun

import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPORT_KIND = "takos.takoserver-fetch-tracer@v1" as const;
export const REPORT_LABEL = "experimental-source-build-dev-override" as const;
export const BUILD_IDENTITY =
  "takos-fetch-tracer@experimental-source-build-dev-override" as const;
export const FIXED_CONFIG_VALUE = "fetch-tracer-config-v1" as const;
export const PROVIDER_SOURCE = "registry.terraform.io/tako0614/takoform" as const;
export const V1_DISCOVERY_PATH = "/.well-known/takoform/v1" as const;
export const V1_API_VERSION = "forms.takoform.com/v1" as const;
export const FORM_API_VERSION = "edge.forms.takoform.com" as const;
export const FORM_DEFINITION_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
export const DIGEST = /^sha256:[0-9a-f]{64}$/u;
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

/**
 * The Provider 4 source-build surface is deliberately pinned to these five
 * candidate FormRefs. A syntactically valid FormRef from another line is not
 * evidence for this tracer and must fail closed.
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
    definitionVersion: "0.2.0",
    schemaDigest: "sha256:3d4eeed966867a1ef8d7ce629a77c4b9687c6d48d3e496d22314b29aff0a42ed",
  },
  worker_deployment: {
    apiVersion: FORM_API_VERSION,
    kind: "WorkerDeployment",
    definitionVersion: "0.1.0",
    schemaDigest: "sha256:0d2bca351b8ecade0a1ebbddf2463bba22910313ff916414112ec8762204e769",
  },
  worker_endpoint: {
    apiVersion: FORM_API_VERSION,
    kind: "WorkerEndpoint",
    definitionVersion: "0.1.0",
    schemaDigest: "sha256:732f60aba45ce360d5ebbc6ac2e55fe4d59b65d353f4628e93960d71fbc2870f",
  },
};

const DEFAULT_PROJECT_NAME = "takos-fetch-tracer";
const SOURCE_INVENTORY = [
  "scripts/takoserver-fetch-tracer.ts",
  "scripts/__tests__/takoserver-fetch-tracer.test.ts",
  "deploy/opentofu/takoserver-fetch-tracer/README.md",
  "deploy/opentofu/takoserver-fetch-tracer/main.tf",
  "deploy/opentofu/takoserver-fetch-tracer/variables.tf",
  "deploy/opentofu/takoserver-fetch-tracer/outputs.tf",
  "deploy/opentofu/takoserver-fetch-tracer/worker.mjs",
] as const;

export type CliConfig = {
  readonly host: string;
  readonly space: string;
  readonly providerBinary: string;
  readonly providerSha256: string;
  readonly tokenEnv: string;
  readonly token: string;
  readonly tofu: string;
  readonly timeoutMs: number;
  readonly killGraceMs: number;
  readonly configValue: string;
  readonly fixtureDir: string;
};

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

  constructor(message: string, options: { recoveryPath?: string; cause?: unknown } = {}) {
    super(message);
    this.name = "TracerError";
    this.recoveryPath = options.recoveryPath;
    this.causeError = options.cause;
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
    token?: string;
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
    token?: string;
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
  return value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, 512);
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

export function redactOutput(value: string, secret?: string): string {
  if (!secret) return value;
  return value.split(secret).join("<redacted>");
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

export function validateSpace(value: string): string {
  if (value.length < 1 || Array.from(value).length > 255 || value !== value.trim()) {
    throw new TracerError("space must be 1..255 Unicode code points without leading/trailing whitespace");
  }
  if (/[\/\p{Cc}]/u.test(value)) {
    throw new TracerError("space must not contain slash or control characters");
  }
  return value;
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
  let space: string | undefined;
  let providerBinary: string | undefined;
  let providerSha256: string | undefined;
  let tokenEnv = "TAKOFORM_TOKEN";
  let tofu = "tofu";
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let killGraceMs = DEFAULT_KILL_GRACE_MS;
  let configValue: string = FIXED_CONFIG_VALUE;

  const readValue = (index: number, flag: string): [string, number] => {
    const next = expandedArgv[index + 1];
    if (!next || next.startsWith("--")) throw new TracerError(`${flag} requires a value`);
    return [next, index + 1];
  };

  for (let index = 0; index < expandedArgv.length; index += 1) {
    const arg = expandedArgv[index];
    if (arg === "--run" || arg === "--confirm-experimental") {
      optedIn = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") throw new HelpRequestedError();
    if (arg === "--token" || arg.startsWith("--token=")) {
      throw new TracerError("token must be supplied through the named environment variable, never argv");
    }
    if (arg === "--host") {
      [host, index] = readValue(index, arg);
    } else if (arg === "--space") {
      [space, index] = readValue(index, arg);
    } else if (arg === "--provider-binary") {
      [providerBinary, index] = readValue(index, arg);
    } else if (arg === "--provider-sha256") {
      [providerSha256, index] = readValue(index, arg);
    } else if (arg === "--token-env") {
      [tokenEnv, index] = readValue(index, arg);
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
      throw new TracerError(`unknown option ${arg}`);
    } else {
      throw new TracerError(`unexpected argument ${arg}`);
    }
  }

  if (!optedIn) {
    throw new TracerError("refusing to mutate a Host: pass --run or --confirm-experimental");
  }
  if (!host || !space || !providerBinary || !providerSha256) {
    throw new TracerError("--host, --space, --provider-binary, and --provider-sha256 are required");
  }
  if (!isAbsolute(providerBinary)) {
    throw new TracerError("provider-binary must be an absolute path");
  }
  const checkedTokenEnv = tokenEnvName(tokenEnv);
  const token = environment[checkedTokenEnv];
  if (!token) throw new TracerError(`required token environment variable ${checkedTokenEnv} is empty`);
  if (token.includes("\n") || token.includes("\r")) throw new TracerError("token environment value is invalid");
  const checkedConfigValue = validateConfigValue(configValue);
  if (checkedConfigValue.includes(token)) {
    throw new TracerError("config value must not contain the Host token");
  }

  return {
    host: validateBareOrigin(host),
    space: validateSpace(space),
    providerBinary: resolve(providerBinary),
    providerSha256: canonicalDigest(providerSha256),
    tokenEnv: checkedTokenEnv,
    token,
    tofu: tofu.trim() || "tofu",
    timeoutMs,
    killGraceMs,
    configValue: checkedConfigValue,
    fixtureDir: resolve(options.fixtureDir ?? join(dirname(fileURLToPath(import.meta.url)), "..", "deploy/opentofu/takoserver-fetch-tracer")),
  };
}

export function usage(): string {
  return [
    "usage: bun scripts/takoserver-fetch-tracer.ts --run --host ORIGIN --space SPACE",
    "  --provider-binary ABSOLUTE_PATH --provider-sha256 SHA256",
    "  [--token-env ENV_NAME] [--tofu PATH] [--config-value VALUE]",
    "  [--timeout-ms N] [--kill-grace-ms N]",
    "",
    "This is an experimental-source-build-dev-override tracer, not publication/live release evidence.",
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
      const next = abortPromise
        ? await Promise.race([reader.read(), abortPromise])
        : await reader.read();
      if (next === "aborted") {
        truncated = true;
        await reader.cancel().catch(() => undefined);
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
    reader.releaseLock();
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
  readonly token?: string;
  readonly maxOutputBytes?: number;
  readonly redactSuccessfulOutput?: boolean;
  readonly spawn?: SpawnFunction;
}): Promise<CommandResult> {
  const args = [...(input.args ?? [])];
  if (input.token && [input.command, ...args].some((value) => value.includes(input.token!))) {
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
    throw new TracerError(`${basename(input.command)} could not be started`, { cause: error });
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
    throw new TracerError(`${basename(input.command)} output could not be drained`, { cause: error });
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

export function assertProviderVersion(output: string): "4.0.0-dev" | "4.0.0" {
  if (/(?:^|[^0-9A-Za-z])v?4\.0\.0-dev(?:$|[^0-9A-Za-z.+-])/u.test(output)) return "4.0.0-dev";
  if (/(?:^|[^0-9A-Za-z])v?4\.0\.0(?:$|[^0-9A-Za-z.+-])/u.test(output)) return "4.0.0";
  throw new TracerError("Provider --version must report exactly 4.0.0-dev or 4.0.0");
}

export async function verifyProviderBinary(input: {
  readonly path: string;
  readonly digest: string;
}): Promise<{ readonly path: string; readonly digest: string }> {
  if (!isAbsolute(input.path)) throw new TracerError("provider binary path must be absolute");
  const info = await lstat(input.path).catch(() => undefined);
  if (!info || !info.isFile() || info.isSymbolicLink() || (info.mode & 0o111) === 0) {
    throw new TracerError("provider binary must be one executable regular file");
  }
  const canonical = await realpath(input.path);
  const bytes = await readFile(canonical);
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (digest !== canonicalDigest(input.digest)) {
    throw new TracerError("provider binary sha256 does not match the explicit digest");
  }
  return { path: canonical, digest };
}

export async function installProviderOverride(input: {
  readonly root: string;
  readonly providerPath: string;
}): Promise<string> {
  const directory = join(input.root, ".provider-dev-override");
  await mkdir(directory, { recursive: true });
  const destination = join(directory, "terraform-provider-takoform");
  await copyFile(input.providerPath, destination);
  await chmod(destination, 0o755);
  return destination;
}

export function createProviderOverrideConfig(directory: string): string {
  if (!isAbsolute(directory)) throw new TracerError("provider override directory must be absolute");
  const escaped = JSON.stringify(directory);
  return [
    "provider_installation {",
    "  dev_overrides {",
    `    ${JSON.stringify(PROVIDER_SOURCE)} = ${escaped}`,
    "  }",
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
    if (typeof value === "string") environment[key] = value;
  }
  return environment;
}

export function buildTofuEnvironment(input: {
  readonly base?: NodeJS.ProcessEnv;
  readonly host: string;
  readonly space: string;
  readonly token: string;
  /** Validated by parseArgs for parent lookup only; never copied to child env. */
  readonly tokenEnv?: string;
  readonly configValue: string;
  readonly cliConfigFile: string;
  readonly tfDataDir: string;
  readonly projectName?: string;
}): Record<string, string | undefined> {
  const environment = allowlistedParentEnvironment(input.base ?? process.env);
  environment.TF_CLI_CONFIG_FILE = input.cliConfigFile;
  environment.TF_DATA_DIR = input.tfDataDir;
  environment.TAKOFORM_ENDPOINT = input.host;
  environment.TAKOFORM_SPACE = input.space;
  environment.TAKOFORM_TOKEN = input.token;
  environment.TF_VAR_host = input.host;
  environment.TF_VAR_space = input.space;
  environment.TF_VAR_config_value = input.configValue;
  if (input.projectName) environment.TF_VAR_project_name = input.projectName;
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

export function projectResourceName(key: ResourceKey, projectName = DEFAULT_PROJECT_NAME): string {
  if (!/^[a-z][a-z0-9-]{0,62}$/u.test(projectName)) {
    throw new TracerError("project_name must be a DNS-like lowercase resource name");
  }
  switch (key) {
    case "module_worker":
      return projectName;
    case "worker_bundle":
      return `${projectName}-bundle`;
    case "worker_version":
      return `${projectName}-version`;
    case "worker_deployment":
      return `${projectName}-deployment`;
    case "worker_endpoint":
      return `${projectName}-endpoint`;
  }
}

export function knownResourceAddresses(space: string, projectName = DEFAULT_PROJECT_NAME): ProjectResourceAddresses {
  validateSpace(space);
  const result = {} as ProjectResourceAddresses;
  for (const key of RESOURCE_KEYS) {
    const form = PROVIDER4_FORM_REFS[key];
    result[key] = {
      name: projectResourceName(key, projectName),
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
  if (name !== projectResourceName(key, expectedProjectName)) throw new TracerError(`${key} has an unexpected project resource name`);
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
): Record<ResourceKey, ResourceIdentity> {
  const identities = requireRecord(value, "resource_identities");
  if (ownKeys(identities).join(",") !== [...RESOURCE_KEYS].sort().join(",")) {
    throw new TracerError("resource_identities must contain exactly the five Worker resources");
  }
  const result = {} as Record<ResourceKey, ResourceIdentity>;
  const uids = new Set<string>();
  for (const key of RESOURCE_KEYS) {
    const identity = assertExactResourceIdentity(identities[key], key, expectedSpace, expectedProjectName, requireReady);
    if (uids.has(identity.uid)) throw new TracerError("resource identities must have distinct UIDs");
    uids.add(identity.uid);
    result[key] = identity;
  }
  return result;
}

export function assertExactProbeBody(value: unknown, expectedConfigValue: string): void {
  const body = requireRecord(value, "Worker probe response");
  if (ownKeys(body).join(",") !== "buildIdentity,configValue") {
    throw new TracerError("Worker probe response must contain exactly buildIdentity and configValue");
  }
  if (body.buildIdentity !== BUILD_IDENTITY || body.configValue !== expectedConfigValue) {
    throw new TracerError("Worker probe response does not carry the exact build identity and config value");
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

export function parseTofuOutputs(value: unknown, expectedSpace: string, expectedProjectName = DEFAULT_PROJECT_NAME): {
  readonly identities: Record<ResourceKey, ResourceIdentity>;
  readonly configValue: string;
  readonly endpointURL: string;
  readonly endpointHostname: string;
} {
  const outputs = requireRecord(value, "tofu output");
  assertClosedKeys(outputs, ["resource_identities", "config_value", "endpoint_url", "endpoint_hostname"], [], "tofu output");
  // Apply output is an exact identity snapshot, but status can still be
  // Reconciling. The Host readback below is the readiness authority.
  const identities = assertExactIdentitySet(unwrapTofuOutput(outputs.resource_identities, "resource_identities"), expectedSpace, expectedProjectName, false);
  const configValue = unwrapTofuOutput(outputs.config_value, "config_value");
  const endpointURL = unwrapTofuOutput(outputs.endpoint_url, "endpoint_url");
  const endpointHostname = unwrapTofuOutput(outputs.endpoint_hostname, "endpoint_hostname");
  if (typeof configValue !== "string") throw new TracerError("tofu output config_value must be a string");
  if (typeof endpointURL !== "string") throw new TracerError("tofu output endpoint_url must be a string");
  if (typeof endpointHostname !== "string") throw new TracerError("tofu output endpoint_hostname must be a string");
  if (endpointURL !== identities.worker_endpoint.url || endpointHostname !== identities.worker_endpoint.hostname) {
    throw new TracerError("tofu endpoint outputs do not match WorkerEndpoint identity");
  }
  return { identities, configValue, endpointURL, endpointHostname };
}

export async function readResponseBody(
  response: Response,
  options: { readonly maxBytes?: number; readonly token?: string; readonly timeoutMs?: number } = {},
): Promise<string> {
  const maxBytes = options.maxBytes ?? MAX_RESPONSE_BYTES;
  if (!response.body) return "";
  const abort = new AbortController();
  const timer = options.timeoutMs ? setTimeout(() => abort.abort(), options.timeoutMs) : undefined;
  try {
    const output = await drainBounded(response.body, maxBytes, abort.signal);
    return redactOutput(output.text, options.token);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchWithTimeout(
  fetchImpl: FetchFunction,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (error) {
    throw new TracerError("Host request failed before a response was received", { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

export async function discoverV1(input: {
  readonly host: string;
  readonly token: string;
  readonly timeoutMs: number;
  readonly fetchImpl?: FetchFunction;
}): Promise<Discovery> {
  const response = await fetchWithTimeout(
    input.fetchImpl ?? fetch,
    new URL(V1_DISCOVERY_PATH, input.host),
    {
      method: "GET",
      redirect: "manual",
      headers: { authorization: `Bearer ${input.token}`, accept: "application/json" },
    },
    input.timeoutMs,
  );
  const body = await readResponseBody(response, { token: input.token, timeoutMs: input.timeoutMs });
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
    ...(endpointOutputs ?? {}),
  };
  return authoritative;
}

/** @deprecated Use assertReadbackResource for the stable bare Resource shape. */
export const assertReadbackEnvelope = assertReadbackResource;

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
  const response = await fetchWithTimeout(
    input.fetchImpl ?? fetch,
    resourceURL(input.apiRoot, input.address),
    {
      method: "GET",
      redirect: "manual",
      headers: { authorization: `Bearer ${input.token}`, accept: "application/json" },
    },
    input.timeoutMs,
  );
  const rawBody = await readResponseBody(response, { token: input.token, timeoutMs: input.timeoutMs });
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
      failures.push(`${key}: ${error instanceof Error ? singleLine(error.message) : "absence check failed"}`);
    }
  }
  if (failures.length > 0) {
    throw new TracerError(`authoritative absence failed for ${failures.length} resource(s): ${failures.join("; ")}`);
  }
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
  readonly fetchImpl: FetchFunction;
  readonly timeoutMs: number;
}): Promise<void> {
  const workerModule = (await import(`${pathToFileURL(input.workerPath).href}?tracer=${Date.now()}`)) as {
    default?: { fetch?: (request: Request, env: Record<string, string>, ctx: unknown) => Promise<Response> | Response };
  };
  const fetchHandler = workerModule.default?.fetch;
  if (typeof fetchHandler !== "function") throw new TracerError("tracer Worker module does not export fetch");
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request: Request) => fetchHandler(request, { TAKOS_FETCH_TRACER_CONFIG: input.configValue }, {}),
  });
  try {
    const response = await fetchWithTimeout(input.fetchImpl, server.url, { method: "GET", redirect: "manual" }, input.timeoutMs);
    const rawBody = await readResponseBody(response, { timeoutMs: input.timeoutMs });
    if (response.status !== 200) throw new TracerError(`loopback Worker probe returned HTTP ${response.status}`);
    assertExactProbeBody(boundedJson(rawBody, "loopback Worker probe"), input.configValue);
  } finally {
    server.stop(true);
  }
}

export async function probeRuntime(input: {
  readonly endpoint: ResourceIdentity;
  readonly workerPath: string;
  readonly configValue: string;
  readonly timeoutMs: number;
  readonly fetchImpl?: FetchFunction;
}): Promise<{ readonly mode: "loopback-diagnostic" | "assigned-endpoint"; readonly assignedUrl: string; readonly evidence: string }> {
  const endpoint = endpointURL(input.endpoint);
  const fetchImpl = input.fetchImpl ?? fetch;
  if (endpoint.hostname.toLowerCase().replace(/\.$/u, "").endsWith(".invalid")) {
    await runLoopbackProbe({ workerPath: input.workerPath, configValue: input.configValue, fetchImpl, timeoutMs: input.timeoutMs });
    return {
      mode: "loopback-diagnostic",
      assignedUrl: endpoint.toString(),
      evidence: "diagnostic-only-not-host-runtime",
    };
  }
  const response = await fetchWithTimeout(fetchImpl, endpoint, { method: "GET", redirect: "manual", headers: { accept: "application/json" } }, input.timeoutMs);
  const rawBody = await readResponseBody(response, { timeoutMs: input.timeoutMs });
  if (response.status !== 200) throw new TracerError(`assigned Worker endpoint returned HTTP ${response.status}`);
  assertExactProbeBody(boundedJson(rawBody, "assigned Worker probe"), input.configValue);
  return { mode: "assigned-endpoint", assignedUrl: endpoint.toString(), evidence: "host-runtime-readback" };
}

async function runTofu(input: {
  readonly config: CliConfig;
  readonly workDir: string;
  readonly environment: Record<string, string | undefined>;
  readonly args: readonly string[];
  readonly spawn?: SpawnFunction;
}): Promise<CommandResult> {
  return runBoundedCommand({
    command: input.config.tofu,
    args: input.args,
    cwd: input.workDir,
    env: input.environment,
    timeoutMs: input.config.timeoutMs,
    killGraceMs: input.config.killGraceMs,
    token: input.config.token,
    spawn: input.spawn,
  });
}

async function prepareWorkspace(config: CliConfig, verifiedProvider: string): Promise<{
  readonly root: string;
  readonly workDir: string;
  readonly environment: Record<string, string | undefined>;
  readonly projectName: string;
  readonly addresses: ProjectResourceAddresses;
}> {
  const root = await mkdtemp(join(tmpdir(), "takoserver-fetch-tracer-"));
  try {
    // The temporary root is unique even for concurrent invocations. Derive a
    // DNS-safe project name from it so the Host Space never shares any of the
    // five fixed resources with another tracer run.
    const projectSuffix = createHash("sha256").update(root).digest("hex").slice(0, 12);
    const projectName = `${DEFAULT_PROJECT_NAME}-${projectSuffix}`;
    const workDir = join(root, "fixture");
    await cp(config.fixtureDir, workDir, { recursive: true });
    const providerOverride = await installProviderOverride({ root, providerPath: verifiedProvider });
    const cliConfigFile = join(root, "tofu.tfrc");
    await writeFile(cliConfigFile, createProviderOverrideConfig(providerOverride.replace(/\/terraform-provider-takoform$/u, "")), { mode: 0o600 });
    const tfDataDir = join(root, "tfdata");
    await mkdir(tfDataDir, { recursive: true });
    const environment = buildTofuEnvironment({
      host: config.host,
      space: config.space,
      token: config.token,
      tokenEnv: config.tokenEnv,
      configValue: config.configValue,
      cliConfigFile,
      tfDataDir,
      projectName,
    });
    return { root, workDir, environment, projectName, addresses: knownResourceAddresses(config.space, projectName) };
  } catch (error) {
    const cleaned = await cleanupRunRoot(root);
    if (!cleaned.removed) {
      throw new TracerError("tracer setup failed and its recovery workdir could not be removed", {
        recoveryPath: cleaned.recoveryPath,
        cause: error,
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
}): Promise<void> {
  let destroyError: unknown;
  try {
    await input.destroy();
  } catch (error) {
    destroyError = error;
  }

  let absenceError: unknown;
  try {
    await input.absence();
  } catch (error) {
    absenceError = error;
  }

  if (destroyError || absenceError) {
    const details = [destroyError, absenceError]
      .filter((error): error is Error => error instanceof Error)
      .map((error) => singleLine(error.message))
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
      cause: error,
    });
  }
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
  readonly token?: string;
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
  readonly token?: string;
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
  readonly providerPath: string;
  readonly timeoutMs: number;
  readonly killGraceMs: number;
  readonly token?: string;
}): Promise<TracerProvenance & {
  readonly provider: { readonly sourceRevision: string; readonly sourceModified: string };
}> {
  const workspace = await collectWorkspaceProvenance(input);
  const files: Record<string, string> = {};
  for (const relativePath of SOURCE_INVENTORY) {
    const bytes = await readFile(join(input.repoRoot, relativePath)).catch((error: unknown) => {
      throw new TracerError(`could not hash tracer source file ${relativePath}`, { cause: error });
    });
    files[relativePath] = hashFileBytes(bytes);
  }

  let sourceRevision = "unavailable";
  let sourceModified = "unavailable";
  try {
    const metadata = await readOnlyCommand({
      command: "go",
      args: ["version", "-m", input.providerPath],
      cwd: input.repoRoot,
      timeoutMs: input.timeoutMs,
      killGraceMs: input.killGraceMs,
      token: input.token,
    });
    const output = `${metadata.stdout}\n${metadata.stderr}`;
    sourceRevision = output.match(/(?:^|\s)vcs\.revision[=\s]+([0-9a-f]{7,64})(?:$|\s)/mu)?.[1] ?? "unavailable";
    sourceModified = output.match(/(?:^|\s)vcs\.modified[=\s]+(true|false)(?:$|\s)/mu)?.[1] ?? "unavailable";
  } catch {
    // A binary built with `-buildvcs=false` (or without a Go toolchain) has no
    // source revision metadata. Report the absence explicitly; never infer it
    // from the caller's checkout or the provider binary digest.
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
    provider: { sourceRevision, sourceModified },
  };
}

export type TracerReport = {
  readonly kind: typeof REPORT_KIND;
  readonly label: typeof REPORT_LABEL;
  readonly evidence: "not publication/live release evidence";
  readonly provider: {
    readonly version: "4.0.0-dev" | "4.0.0";
    readonly sha256: string;
    readonly sourceRevision: string;
    readonly sourceModified: string;
  };
  readonly host: { readonly origin: string; readonly discoveryPath: typeof V1_DISCOVERY_PATH; readonly apiRoot: string };
  readonly space: string;
  readonly buildIdentity: typeof BUILD_IDENTITY;
  readonly configValue: string;
  readonly resources: Record<ResourceKey, ResourceIdentity>;
  readonly runtimeProbe: { readonly mode: "loopback-diagnostic" | "assigned-endpoint"; readonly assignedUrl: string; readonly exact: true; readonly evidence: string };
  readonly lifecycle: { readonly apply: "passed"; readonly destroy: "passed"; readonly absence: "passed" };
  readonly provenance: TracerProvenance;
};

export async function runTracer(config: CliConfig, options: {
  readonly fetchImpl?: FetchFunction;
  readonly spawn?: SpawnFunction;
} = {}): Promise<TracerReport> {
  const verified = await verifyProviderBinary({ path: config.providerBinary, digest: config.providerSha256 });
  const rootState = await prepareWorkspace(config, verified.path);
  let applyStarted = false;
  let discovery: Discovery | undefined;
  let providerVersion: "4.0.0-dev" | "4.0.0" | undefined;

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
          spawn: options.spawn,
        });
        if (stateResult.stdout.trim() !== "") throw new TracerError("tofu state list is not empty after destroy");
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
          token: config.token,
          timeoutMs: config.timeoutMs,
          fetchImpl: options.fetchImpl,
        });
      } catch (error) {
        absenceError = error;
      }
    }
    if (stateError || absenceError) {
      const details = [stateError, absenceError]
        .filter((error): error is Error => error instanceof Error)
        .map((error) => singleLine(error.message))
        .join("; ");
      throw new TracerError(`post-destroy cleanup proof failed${details ? `: ${details}` : ""}`, {
        cause: stateError ?? absenceError,
      });
    }
  };

  const removeRoot = async (): Promise<void> => {
    const cleaned = await cleanupRunRoot(rootState.root);
    if (!cleaned.removed) throw cleaned.error;
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
          spawn: options.spawn,
        });
      },
      // Run the exact Host proof even when destroy exits non-zero: apply may
      // have partially mutated the Host before its child timed out.
      absence: async () => absenceAndStateCheck(checkState),
      remove: removeRoot,
    });
  };

  try {
    // Run the handshake against the copied, hash-verified provider in the
    // dev-override directory, never against the caller's source path.
    const copiedProvider = await verifyProviderBinary({
      path: join(rootState.root, ".provider-dev-override", "terraform-provider-takoform"),
      digest: verified.digest,
    });
    const versionResult = await runBoundedCommand({
      command: copiedProvider.path,
      args: ["--version"],
      cwd: rootState.workDir,
      env: rootState.environment,
      timeoutMs: config.timeoutMs,
      killGraceMs: config.killGraceMs,
      token: config.token,
      spawn: options.spawn,
    });
    providerVersion = assertProviderVersion(`${versionResult.stdout}\n${versionResult.stderr}`);

    discovery = await discoverV1({ host: config.host, token: config.token, timeoutMs: config.timeoutMs, fetchImpl: options.fetchImpl });
    // OpenTofu intentionally skips `init` with a dev override: init tries to
    // resolve a published package and would defeat the explicit source-build
    // boundary. `validate`/`apply` discover the copied binary directly.
    await runTofu({ config, workDir: rootState.workDir, environment: rootState.environment, args: ["validate", "-no-color"], spawn: options.spawn });
    applyStarted = true;
    await runTofu({ config, workDir: rootState.workDir, environment: rootState.environment, args: ["apply", "-auto-approve", "-input=false", "-no-color"], spawn: options.spawn });
    const outputsResult = await runTofu({ config, workDir: rootState.workDir, environment: rootState.environment, args: ["output", "-json", "-no-color"], spawn: options.spawn });
    const parsedOutputs = parseTofuOutputs(boundedJson(outputsResult.stdout, "tofu output"), config.space, rootState.projectName);
    if (parsedOutputs.configValue !== config.configValue) throw new TracerError("tofu output config_value does not match the requested non-secret value");
    const identities = {} as Record<ResourceKey, ResourceIdentity>;
    for (const key of RESOURCE_KEYS) {
      const identity = parsedOutputs.identities[key];
      const readback = await readHostResource({ apiRoot: discovery.apiRoot, identity, token: config.token, timeoutMs: config.timeoutMs, fetchImpl: options.fetchImpl });
      if (readback.status !== 200) throw new TracerError(`${key} readback returned HTTP ${readback.status}`);
      if (!readback.identity) throw new TracerError(`${key} readback did not return an authoritative identity`);
      identities[key] = readback.identity;
    }
    const runtime = await probeRuntime({ endpoint: identities.worker_endpoint, workerPath: join(rootState.workDir, "worker.mjs"), configValue: config.configValue, timeoutMs: config.timeoutMs, fetchImpl: options.fetchImpl });
    const provenance = await collectProvenance({
      repoRoot: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
      providerPath: copiedProvider.path,
      timeoutMs: config.timeoutMs,
      killGraceMs: config.killGraceMs,
      token: config.token,
    });
    if (!providerVersion) throw new TracerError("Provider version handshake did not produce a reportable version");
    const report: TracerReport = {
      kind: REPORT_KIND,
      label: REPORT_LABEL,
      evidence: "not publication/live release evidence",
      provider: { version: providerVersion, sha256: verified.digest, ...provenance.provider },
      host: { origin: config.host, discoveryPath: V1_DISCOVERY_PATH, apiRoot: discovery.apiRoot },
      space: config.space,
      buildIdentity: BUILD_IDENTITY,
      configValue: config.configValue,
      resources: identities,
      runtimeProbe: { ...runtime, exact: true },
      lifecycle: { apply: "passed", destroy: "passed", absence: "passed" },
      provenance: {
        takosHead: provenance.takosHead,
        workspace: provenance.workspace,
        files: provenance.files,
      },
    };
    await cleanupAppliedRun(true);
    return report;
  } catch (error) {
    if (error instanceof TracerError && error.recoveryPath === rootState.root) throw error;
    if (applyStarted) {
      // Output parsing, readback, probe, or a timed-out apply all count as an
      // apply attempt. Destroy and absence are both mandatory before removal.
      await cleanupAppliedRun(false);
    } else {
      const cleaned = await cleanupRunRoot(rootState.root);
      if (!cleaned.removed) {
        throw new TracerError("tracer failed before apply and cleanup could not remove the workdir", {
          recoveryPath: cleaned.recoveryPath,
          cause: cleaned.error,
        });
      }
    }
    throw error;
  }
}

async function main(): Promise<void> {
  try {
    const config = parseArgs(process.argv.slice(2));
    const report = await runTracer(config);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    if (error instanceof HelpRequestedError) {
      process.stdout.write(`${error.message}\n`);
      return;
    }
    const message = error instanceof Error ? error.message : "experimental tracer failed";
    const recoveryPath = error instanceof TracerError ? error.recoveryPath : undefined;
    process.stderr.write(`${message}${recoveryPath ? `; recovery workdir: ${recoveryPath}` : ""}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();
