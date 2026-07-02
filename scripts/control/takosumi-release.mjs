#!/usr/bin/env bun
import * as runtime from "../runtime.ts";

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, symlinkSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

import { parseTakosumiOutputsJson } from "./render-wrangler-from-tofu.mjs";

const ENVIRONMENTS = ["production", "staging"];
const WRANGLER_CONFIG = "deploy/cloudflare/wrangler.toml";
const DEFAULT_TAKOSUMI_REPO_URL = "https://github.com/tako0614/takosumi.git";
const DEFAULT_TAKOSUMI_REPO_REF = "main";
const MIN_WORKER_CONTENT_BYTES = 1024;
const RELEASE_HEALTH_ATTEMPTS = 12;
const RELEASE_HEALTH_INTERVAL_MS = 2500;
const RELEASE_WORKER_API_ATTEMPTS = 12;
const RELEASE_WORKER_API_INTERVAL_MS = 2500;
const RELEASE_COMMAND_OUTPUT_MAX_BYTES = 64 * 1024 * 1024;
const RELEASE_COMMAND_LOG_MAX_CHARS = 20_000;

function usage() {
  console.error(`
Usage: bun scripts/control/takosumi-release.mjs <environment> [--debug] [--destroy]

Runs the operator-side artifact activation after Takosumi/OpenTofu has
provisioned durable resources. The command reads non-secret OpenTofu outputs
from TAKOSUMI_OUTPUTS_JSON, renders wrangler bindings, runs Takos-owned
release setup steps, and uploads the Worker artifact.

Environment:
  production
  staging

Optional env:
  TAKOS_CLOUDFLARE_ZONE_ID or CF_ZONE_ID  Render CF_ZONE_ID placeholders.
  TAKOS_RELEASE_TAKOSUMI_REPO_DIR         Takosumi source checkout to symlink
                                          beside a restored Takos source
                                          archive before build/migration.
  TAKOS_RELEASE_TAKOSUMI_REPO_URL         Git URL to clone when the checkout
                                          above is not already present.
  TAKOS_RELEASE_TAKOSUMI_REF              Branch, tag, or commit to fetch from
                                          TAKOS_RELEASE_TAKOSUMI_REPO_URL.
  TAKOSUMI_REPO_DIR                       Sibling Takosumi checkout for the
                                          embedded accounts-plane migration
                                          command used by this distribution
                                          (legacy fallback).
  TAKOS_SKIP_D1_MIGRATIONS                Set to 1/true to skip D1 migration
                                          commands in constrained sandboxes.
  TAKOS_WRANGLER_CONTAINERS_ROLLOUT       Optional value for wrangler deploy
                                          --containers-rollout, for example
                                          "none" in operator sandboxes where
                                          Docker image builds are unavailable.
`);
  runtime.exit(1);
}

function fail(message) {
  console.error(`${message}\n`);
  usage();
}

function shellArg(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function commandLine(parts) {
  return parts.map(shellArg).join(" ");
}

function runFile(command, args) {
  console.log(`\n> ${commandLine([command, ...args])}\n`);
  execFileSync(command, args, { stdio: "inherit" });
}

function outputValue(entry) {
  if (entry == null) return undefined;
  if (
    typeof entry === "object" &&
    Object.hasOwn(entry, "value") &&
    Object.hasOwn(entry, "sensitive")
  ) {
    return entry.value;
  }
  return entry;
}

function requireStringOutput(outputs, name) {
  const value = outputValue(outputs[name]);
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `TAKOSUMI_OUTPUTS_JSON must include string output "${name}"`,
    );
  }
  return value;
}

function requireIntegerOutput(outputs, name) {
  const value = outputValue(outputs[name]);
  if (Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/u.test(value.trim())) {
    return Number(value.trim());
  }
  throw new Error(
    `TAKOSUMI_OUTPUTS_JSON must include positive integer output "${name}"`,
  );
}

function requireObjectOutput(outputs, name) {
  const value = outputValue(outputs[name]);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `TAKOSUMI_OUTPUTS_JSON must include object output "${name}"`,
    );
  }
  return value;
}

function requireNestedStringOutput(outputs, name, key) {
  const value = requireObjectOutput(outputs, name)[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `TAKOSUMI_OUTPUTS_JSON must include string output "${name}.${key}"`,
    );
  }
  return value;
}

export function ensureTakosumiSourceModule(
  takosumiRepoDir,
  {
    repoUrl = DEFAULT_TAKOSUMI_REPO_URL,
    ref = DEFAULT_TAKOSUMI_REPO_REF,
  } = {},
) {
  const expected = resolve("..", "takosumi");
  if (existsSync(expected)) return;
  const source = resolve(takosumiRepoDir);
  if (!existsSync(source)) {
    const trimmedRepoUrl = repoUrl?.trim();
    if (!trimmedRepoUrl) {
      throw new Error(
        `Takosumi source checkout was not found at ${source}; ` +
          "set TAKOS_RELEASE_TAKOSUMI_REPO_DIR or " +
          "TAKOS_RELEASE_TAKOSUMI_REPO_URL in the operator release environment",
      );
    }
    runFile("git", [
      "clone",
      "--filter=blob:none",
      "--no-checkout",
      trimmedRepoUrl,
      expected,
    ]);
    const trimmedRef = ref?.trim();
    if (trimmedRef) {
      runFile("git", [
        "-C",
        expected,
        "fetch",
        "--depth",
        "1",
        "origin",
        trimmedRef,
      ]);
      runFile("git", ["-C", expected, "checkout", "--detach", "FETCH_HEAD"]);
    } else {
      runFile("git", ["-C", expected, "checkout"]);
    }
    return;
  }
  symlinkSync(source, expected, "dir");
}

export function parseReleaseArgs(argv = process.argv.slice(2)) {
  const debug = argv.includes("--debug");
  const destroy = argv.includes("--destroy");
  const allowedFlags = new Set(["--debug", "--destroy"]);
  const unknown = argv.find(
    (arg) => arg.startsWith("--") && !allowedFlags.has(arg),
  );
  if (unknown) fail(`Error: unknown flag "${unknown}".`);
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  const [environment] = positional;
  if (!environment) fail("Error: environment is required.");
  if (!ENVIRONMENTS.includes(environment)) {
    fail(
      `Error: unknown environment "${environment}". Valid: ${ENVIRONMENTS.join(", ")}`,
    );
  }
  if (debug && environment !== "staging") {
    fail("Error: --debug is only supported for staging.");
  }
  if (debug && destroy) {
    fail("Error: --debug is not supported with --destroy.");
  }
  return { environment, debug, destroy };
}

export function readReleaseOutputs(env = process.env) {
  const raw = env.TAKOSUMI_OUTPUTS_JSON;
  if (!raw?.trim()) {
    throw new Error("TAKOSUMI_OUTPUTS_JSON is required for Takos release");
  }
  return parseTakosumiOutputsJson(raw);
}

export function releaseSecretsFilePath(environment) {
  return `.takos-release-secrets.${environment}.json`;
}

export function releaseWranglerConfigPath(environment) {
  return `deploy/cloudflare/.takos-release-wrangler.${environment}.toml`;
}

export function buildTakosumiReleaseCommands(
  outputs,
  environment,
  {
    debug = false,
    zoneId,
    takosumiRepoDir = "../takosumi",
    skipD1Migrations = false,
    containersRollout,
  } = {},
) {
  if (!ENVIRONMENTS.includes(environment)) {
    throw new Error(`Unknown environment "${environment}"`);
  }
  const accountId = requireStringOutput(outputs, "cloudflare_account_id");
  const workerName = requireStringOutput(outputs, "worker_name");
  requireStringOutput(outputs, "cloudflare_accounts_d1_database_id");
  const vectorizeIndexName = requireStringOutput(
    outputs,
    "cloudflare_vectorize_index_name",
  );
  const vectorizeDimensions = requireIntegerOutput(
    outputs,
    "cloudflare_vectorize_index_dimensions",
  );
  const vectorizeMetric = requireStringOutput(
    outputs,
    "cloudflare_vectorize_index_metric",
  );
  const wranglerEnvArgs =
    environment === "staging" ? ["--env", "staging"] : ["--env", ""];
  const releaseSecretsFile = releaseSecretsFilePath(environment);
  const releaseWranglerConfig = releaseWranglerConfigPath(environment);
  const releaseWranglerConfigPathResolved = resolve(releaseWranglerConfig);
  const renderArgs = [
    "bun",
    "scripts/control/render-wrangler-from-tofu.mjs",
    environment,
    "--out",
    releaseWranglerConfig,
    ...(zoneId ? ["--zone-id", zoneId] : []),
  ];
  const installArgs = ["bun", "install", "--frozen-lockfile"];
  const takosumiInstallArgs = [
    "bun",
    "install",
    "--cwd",
    takosumiRepoDir,
    "--frozen-lockfile",
  ];
  const takosumiDashboardInstallArgs = [
    "bun",
    "install",
    "--cwd",
    `${takosumiRepoDir}/dashboard`,
    "--frozen-lockfile",
  ];
  const buildArgs =
    debug && environment === "staging"
      ? ["bun", "run", "build", "--mode", "staging-debug"]
      : ["bun", "run", "build"];
  const containerBuildArgs = ["bun", "run", "containers:build"];
  const ensureSecretsArgs = [
    "bun",
    "scripts/control/ensure-release-secrets.mjs",
    environment,
    "--config",
    releaseWranglerConfig,
    "--secrets-file",
    releaseSecretsFile,
  ];
  const migrationCommands = skipD1Migrations
    ? []
    : [
        commandLine([
          "bunx",
          "wrangler",
          "d1",
          "migrations",
          "apply",
          "DB",
          "--remote",
          "--config",
          releaseWranglerConfig,
          ...wranglerEnvArgs,
        ]),
        commandLine([
          "bun",
          "run",
          "--cwd",
          takosumiRepoDir,
          "cli",
          "--",
          "accounts",
          "migrate-d1",
          "--database-id",
          "TAKOSUMI_ACCOUNTS_DB",
          "--wrangler-config",
          releaseWranglerConfigPathResolved,
          "--account-id",
          accountId,
          "--remote",
          ...wranglerEnvArgs,
        ]),
      ];

  return [
    commandLine(renderArgs),
    commandLine([
      "bun",
      "scripts/control/ensure-vectorize-index.mjs",
      vectorizeIndexName,
      "--dimensions",
      String(vectorizeDimensions),
      "--metric",
      vectorizeMetric,
      "--account-id",
      accountId,
    ]),
    commandLine(installArgs),
    commandLine(takosumiInstallArgs),
    commandLine(takosumiDashboardInstallArgs),
    commandLine(buildArgs),
    commandLine(containerBuildArgs),
    ...migrationCommands,
    commandLine(ensureSecretsArgs),
    commandLine([
      "bunx",
      "wrangler",
      "deploy",
      "--config",
      releaseWranglerConfig,
      "--name",
      workerName,
      "--secrets-file",
      releaseSecretsFile,
      ...wranglerEnvArgs,
      ...(containersRollout
        ? ["--containers-rollout", containersRollout]
        : []),
    ]),
  ];
}

export function buildTakosumiDestroyCommands(outputs) {
  const workerName = requireStringOutput(outputs, "worker_name");
  const vectorizeIndexName = requireStringOutput(
    outputs,
    "cloudflare_vectorize_index_name",
  );
  const queues = [
    requireNestedStringOutput(outputs, "queue_bindings", "runs"),
    requireNestedStringOutput(outputs, "queue_bindings", "runs_dlq"),
    requireNestedStringOutput(outputs, "queue_bindings", "index_jobs"),
    requireNestedStringOutput(outputs, "queue_bindings", "index_jobs_dlq"),
    requireNestedStringOutput(outputs, "queue_bindings", "workflow"),
    requireNestedStringOutput(outputs, "queue_bindings", "workflow_dlq"),
    requireNestedStringOutput(outputs, "queue_bindings", "deployment"),
    requireNestedStringOutput(outputs, "queue_bindings", "deployment_dlq"),
  ];
  return [
    ...queues.map((queueName) =>
      commandLine([
        "bunx",
        "wrangler",
        "queues",
        "consumer",
        "remove",
        queueName,
        workerName,
      ]),
    ),
    commandLine(["bunx", "wrangler", "delete", workerName, "--force"]),
    commandLine([
      "bunx",
      "wrangler",
      "vectorize",
      "delete",
      vectorizeIndexName,
      "--force",
    ]),
  ];
}

function run(command, env = process.env) {
  console.log(`\n> ${command}\n`);
  const result = runShellCommand(command, env);
  emitCommandOutput(result, env);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(`Command failed: ${command}`);
    error.status = result.status;
    error.signal = result.signal;
    throw error;
  }
}

function runDestroyCommand(command, env = process.env) {
  console.log(`\n> ${command}\n`);
  const result = runShellCommand(command, env);
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  emitCommandOutput(result, env);
  if (result.error || result.status !== 0) {
    if (isIgnorableDestroyFailure(command, `${stdout}\n${stderr}`)) {
      console.warn("Ignoring missing release resource during destroy.");
      return;
    }
    if (result.error) throw result.error;
    const error = new Error(`Command failed: ${command}`);
    error.status = result.status;
    error.signal = result.signal;
    throw error;
  }
}

function runShellCommand(command, env) {
  return spawnSync(command, {
    shell: true,
    env,
    encoding: "utf8",
    maxBuffer: RELEASE_COMMAND_OUTPUT_MAX_BYTES,
  });
}

function emitCommandOutput(result, env) {
  const stdout = boundedCommandLog(result.stdout ?? "", env);
  const stderr = boundedCommandLog(result.stderr ?? "", env);
  if (stdout) process.stdout.write(stdout.endsWith("\n") ? stdout : `${stdout}\n`);
  if (stderr) process.stderr.write(stderr.endsWith("\n") ? stderr : `${stderr}\n`);
}

function boundedCommandLog(text, env) {
  if (!text) return "";
  const max = integerEnv(
    env,
    "TAKOS_RELEASE_COMMAND_LOG_MAX_CHARS",
    RELEASE_COMMAND_LOG_MAX_CHARS,
  );
  if (max <= 0 || text.length <= max) return text;
  const head = text.slice(0, Math.floor(max / 4));
  const tail = text.slice(text.length - Math.ceil((max * 3) / 4));
  return `${head}\n... [takos release command log truncated: ${text.length} chars] ...\n${tail}`;
}

function isIgnorableDestroyFailure(command, output) {
  if (command.includes("'queues' 'consumer' 'remove'")) {
    return /No worker consumer .* exists for queue/u.test(output);
  }
  if (command.includes("'wrangler' 'delete'")) {
    return /not found|does not exist|No such Worker/i.test(output);
  }
  if (command.includes("'vectorize' 'delete'")) {
    return /not found|does not exist/i.test(output);
  }
  return false;
}

function releaseWorkerApiAttempts(env) {
  return Math.max(
    1,
    integerEnv(
      env,
      "TAKOS_RELEASE_WORKER_API_ATTEMPTS",
      RELEASE_WORKER_API_ATTEMPTS,
    ),
  );
}

function releaseWorkerApiIntervalMs(env) {
  return integerEnv(
    env,
    "TAKOS_RELEASE_WORKER_API_INTERVAL_MS",
    RELEASE_WORKER_API_INTERVAL_MS,
  );
}

function releaseChildEnv(outputs, env = process.env) {
  let accountId;
  try {
    accountId = requireStringOutput(outputs, "cloudflare_account_id");
  } catch {
    accountId = undefined;
  }
  return {
    ...env,
    CI: env.CI ?? "true",
    WRANGLER_SEND_METRICS: env.WRANGLER_SEND_METRICS ?? "false",
    ...(accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : {}),
  };
}

function shouldRetryCloudflareWorkerApi(response, payload) {
  if (response.status === 404 || response.status === 409) return true;
  if (response.status === 429 || response.status >= 500) return true;
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  return errors.some((error) => {
    const code = typeof error?.code === "number" ? error.code : undefined;
    const message = typeof error?.message === "string" ? error.message : "";
    return (
      code === 10007 ||
      code === 10090 ||
      code === 10092 ||
      /does not exist|not found/i.test(message)
    );
  });
}

function shouldEnableWorkersDev(outputs) {
  const launchUrl = outputValue(outputs.launch_url ?? outputs.url);
  if (typeof launchUrl !== "string" || !launchUrl.trim()) return false;
  try {
    return new URL(launchUrl).hostname.endsWith(".workers.dev");
  } catch {
    return false;
  }
}

export async function ensureWorkersDevSubdomain(
  outputs,
  env = process.env,
  fetchImpl = globalThis.fetch,
) {
  if (!shouldEnableWorkersDev(outputs)) {
    return { skipped: true, reason: "no_workers_dev_launch_url" };
  }
  const workerName = requireStringOutput(outputs, "worker_name");
  const accountId = requireStringOutput(outputs, "cloudflare_account_id");
  const apiToken = env.CF_API_TOKEN ?? env.CLOUDFLARE_API_TOKEN;
  if (typeof apiToken !== "string" || apiToken.trim() === "") {
    throw new Error(
      "CF_API_TOKEN or CLOUDFLARE_API_TOKEN is required to enable workers.dev launch URL",
    );
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
    accountId,
  )}/workers/scripts/${encodeURIComponent(workerName)}/subdomain`;
  const attempts = releaseWorkerApiAttempts(env);
  const intervalMs = releaseWorkerApiIntervalMs(env);
  let payload;
  let responseStatus = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiToken.trim()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ enabled: true }),
    });
    responseStatus = response.status;
    const text = await response.text();
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { success: false, errors: [{ message: text }] };
    }
    if (response.ok && payload?.success !== false) {
      console.log(`workers.dev subdomain enabled for ${workerName}.`);
      return { skipped: false, result: payload?.result };
    }
    if (
      attempt >= attempts ||
      !shouldRetryCloudflareWorkerApi(response, payload)
    ) {
      throw new Error(
        `Failed to enable workers.dev for ${workerName}: HTTP ${response.status} ${JSON.stringify(
          payload?.errors ?? payload,
        )}`,
      );
    }
    if (intervalMs > 0) await wait(intervalMs);
  }
  throw new Error(
    `Failed to enable workers.dev for ${workerName}: HTTP ${responseStatus} ${JSON.stringify(
      payload?.errors ?? payload,
    )}`,
  );
}

function releaseHealthUrl(outputs) {
  const launchUrl = outputValue(outputs.launch_url ?? outputs.url);
  if (typeof launchUrl !== "string" || launchUrl.trim() === "") return undefined;
  const url = new URL(launchUrl);
  url.pathname = "/health";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function releaseWorkerEnvironment(environment) {
  return environment === "staging" ? "staging" : "production";
}

function integerEnv(env, name, fallback) {
  const raw = env[name];
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function releaseApiToken(env) {
  const token = env.CF_API_TOKEN ?? env.CLOUDFLARE_API_TOKEN;
  if (typeof token !== "string" || token.trim() === "") {
    throw new Error(
      "CF_API_TOKEN or CLOUDFLARE_API_TOKEN is required for release artifact verification",
    );
  }
  return token.trim();
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyCloudflareWorkerContent(
  outputs,
  environment,
  env = process.env,
  fetchImpl = globalThis.fetch,
) {
  const workerName = requireStringOutput(outputs, "worker_name");
  const accountId = requireStringOutput(outputs, "cloudflare_account_id");
  const workerEnvironment = releaseWorkerEnvironment(environment);
  const apiToken = releaseApiToken(env);
  const url =
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
      accountId,
    )}/workers/services/${encodeURIComponent(
      workerName,
    )}/environments/${encodeURIComponent(workerEnvironment)}/content`;
  const attempts = releaseWorkerApiAttempts(env);
  const intervalMs = releaseWorkerApiIntervalMs(env);
  let bytes = new Uint8Array();
  let text = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetchImpl(url, {
      headers: { authorization: `Bearer ${apiToken}` },
    });
    bytes = new Uint8Array(await response.arrayBuffer());
    text = new TextDecoder("utf8", { fatal: false }).decode(bytes);
    if (response.ok) break;
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { errors: [{ message: text }] };
    }
    if (
      attempt >= attempts ||
      !shouldRetryCloudflareWorkerApi(response, payload)
    ) {
      throw new Error(
        `Cloudflare Worker content verification failed for ${workerName}: HTTP ${response.status} ${text.slice(
          0,
          240,
        )}`,
      );
    }
    if (intervalMs > 0) await wait(intervalMs);
  }
  if (text.includes("export default { fetch() {} }")) {
    throw new Error(
      `Cloudflare Worker ${workerName} uploaded content is still the secret-update stub`,
    );
  }
  const minBytes = integerEnv(
    env,
    "TAKOS_RELEASE_MIN_WORKER_CONTENT_BYTES",
    MIN_WORKER_CONTENT_BYTES,
  );
  if (bytes.byteLength < minBytes) {
    throw new Error(
      `Cloudflare Worker ${workerName} uploaded content is too small (${bytes.byteLength} bytes; expected at least ${minBytes})`,
    );
  }
  const sha256 = await sha256Hex(bytes);
  console.log(
    `Verified Cloudflare Worker artifact for ${workerName}: ${bytes.byteLength} bytes, sha256:${sha256}`,
  );
  return { workerName, bytes: bytes.byteLength, sha256 };
}

async function wait(ms) {
  await new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

async function verifyReleaseHealth(
  outputs,
  env = process.env,
  fetchImpl = globalThis.fetch,
) {
  const url = releaseHealthUrl(outputs);
  if (!url) {
    return { skipped: true, reason: "no_launch_url" };
  }
  const attempts = Math.max(
    1,
    integerEnv(env, "TAKOS_RELEASE_HEALTH_ATTEMPTS", RELEASE_HEALTH_ATTEMPTS),
  );
  const intervalMs = integerEnv(
    env,
    "TAKOS_RELEASE_HEALTH_INTERVAL_MS",
    RELEASE_HEALTH_INTERVAL_MS,
  );
  let lastStatus = 0;
  let lastBody = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { "cache-control": "no-cache" },
      });
      lastStatus = response.status;
      lastBody = await response.text();
      if (response.ok) {
        console.log(`Verified Takos release health at ${url}`);
        return { skipped: false, url, status: response.status };
      }
    } catch (error) {
      lastBody = error instanceof Error ? error.message : String(error);
    }
    if (attempt < attempts && intervalMs > 0) {
      await wait(intervalMs);
    }
  }
  throw new Error(
    `Takos release health check failed at ${url}: HTTP ${lastStatus || "network"} ${lastBody.slice(
      0,
      240,
    )}`,
  );
}

export async function verifyReleaseDeployment(
  outputs,
  environment,
  env = process.env,
  fetchImpl = globalThis.fetch,
) {
  const artifact = await verifyCloudflareWorkerContent(
    outputs,
    environment,
    env,
    fetchImpl,
  );
  const health = await verifyReleaseHealth(outputs, env, fetchImpl);
  return { artifact, health };
}

function cleanupReleaseSecretsFile(environment) {
  const path = resolve(releaseSecretsFilePath(environment));
  if (!existsSync(path)) return;
  unlinkSync(path);
}

function cleanupReleaseWranglerConfig(environment) {
  const path = resolve(releaseWranglerConfigPath(environment));
  if (!existsSync(path)) return;
  unlinkSync(path);
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const { environment, debug, destroy } = parseReleaseArgs(argv);
  const outputs = readReleaseOutputs(env);
  const takosumiRepoDir =
    env.TAKOS_RELEASE_TAKOSUMI_REPO_DIR ??
    env.TAKOSUMI_REPO_DIR ??
    "../takosumi";
  const takosumiRepoUrl =
    env.TAKOS_RELEASE_TAKOSUMI_REPO_URL ??
    env.TAKOSUMI_REPO_URL ??
    DEFAULT_TAKOSUMI_REPO_URL;
  const takosumiRef =
    env.TAKOS_RELEASE_TAKOSUMI_REF ??
    env.TAKOSUMI_REPO_REF ??
    DEFAULT_TAKOSUMI_REPO_REF;
  const commands = destroy
    ? buildTakosumiDestroyCommands(outputs)
    : (() => {
        ensureTakosumiSourceModule(takosumiRepoDir, {
          repoUrl: takosumiRepoUrl,
          ref: takosumiRef,
        });
        return buildTakosumiReleaseCommands(outputs, environment, {
          debug,
          zoneId: env.TAKOS_CLOUDFLARE_ZONE_ID ?? env.CF_ZONE_ID,
          takosumiRepoDir,
          skipD1Migrations:
            env.TAKOS_SKIP_D1_MIGRATIONS === "1" ||
            env.TAKOS_SKIP_D1_MIGRATIONS === "true",
          containersRollout: env.TAKOS_WRANGLER_CONTAINERS_ROLLOUT,
        });
      })();
  const childEnv = releaseChildEnv(outputs, env);
  try {
    for (const command of commands) {
      if (destroy) runDestroyCommand(command, childEnv);
      else run(command, childEnv);
    }
    if (!destroy) {
      await verifyCloudflareWorkerContent(outputs, environment, childEnv);
      await ensureWorkersDevSubdomain(outputs, childEnv);
      await verifyReleaseHealth(outputs, childEnv);
    }
  } finally {
    if (!destroy) {
      cleanupReleaseSecretsFile(environment);
      cleanupReleaseWranglerConfig(environment);
    }
  }
  console.log(
    `\nTakos ${destroy ? "release cleanup" : "release activation"} completed for ${environment}.`,
  );
}

if (import.meta.main) {
  await main();
}
