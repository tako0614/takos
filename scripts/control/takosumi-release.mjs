#!/usr/bin/env bun
import * as runtime from "../runtime.ts";

import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

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
const DESTROY_COMMAND_RETRY_ATTEMPTS = 3;
const DESTROY_COMMAND_RETRY_INTERVAL_MS = 2000;
const CLOUDFLARE_API_PROXY_READY_PREFIX =
  "TAKOS_CLOUDFLARE_API_PROXY_READY=";

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
  TAKOS_RELEASE_CONTAINER_IMAGES_JSON     Optional JSON object of prebuilt
                                          container image refs from Git CI.
                                          Use Cloudflare Containers-supported
                                          registries. Keys may be Wrangler
                                          class names or "runtime" /
                                          "executor" aliases.
  TAKOS_CLOUDFLARE_API_BASE_URL           Optional Cloudflare-compatible API
                                          base URL used by managed compat
                                          release helper steps.
  TAKOS_REQUIRE_PREBUILT_CONTAINER_IMAGES Set to 1/true for hosted/operator
                                          materializers that must consume Git
                                          CI images and must not build
                                          containers inside the activation run.
  TAKOS_RELEASE_TIMINGS_FILE              Optional path for a sanitized JSON
                                          timing summary. The same summary is
                                          always emitted to stdout.
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

function envShellAssignment(name, value) {
  return `${name}=${shellArg(value)}`;
}

function runFile(command, args, env = process.env) {
  console.log(`\n> ${commandLine([command, ...args])}\n`);
  execFileSync(command, args, { stdio: "inherit", env });
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

function optionalStringOutput(outputs, name) {
  const value = outputValue(outputs[name]);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function releaseLaunchUrl(outputs) {
  const explicitLaunchUrl =
    optionalStringOutput(outputs, "launch_url") ??
    optionalStringOutput(outputs, "url");
  if (explicitLaunchUrl) return explicitLaunchUrl;

  const workerName = optionalStringOutput(outputs, "worker_name");
  const workersSubdomain =
    optionalStringOutput(outputs, "cloudflare_workers_subdomain") ??
    optionalStringOutput(outputs, "workers_subdomain");
  if (!workerName || !workersSubdomain) return undefined;
  return `https://${workerName}.${workersSubdomain}.workers.dev`;
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
  { repoUrl = DEFAULT_TAKOSUMI_REPO_URL, ref = DEFAULT_TAKOSUMI_REPO_REF } = {},
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
    skipD1Migrations = false,
    containersRollout,
    containerImages,
    requirePrebuiltContainerImages = false,
  } = {},
) {
  if (!ENVIRONMENTS.includes(environment)) {
    throw new Error(`Unknown environment "${environment}"`);
  }
  const accountId = requireStringOutput(outputs, "cloudflare_account_id");
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
  const wranglerEnvArgs = wranglerEnvironmentArgs(environment);
  const releaseSecretsFile = releaseSecretsFilePath(environment);
  const releaseWranglerConfig = releaseWranglerConfigPath(environment);
  const renderArgs = [
    "bun",
    "scripts/control/render-wrangler-from-tofu.mjs",
    environment,
    "--out",
    releaseWranglerConfig,
    ...(zoneId ? ["--zone-id", zoneId] : []),
  ];
  const installArgs = ["bun", "install", "--frozen-lockfile"];
  const buildArgs =
    debug && environment === "staging"
      ? ["bun", "run", "build", "--mode", "staging-debug"]
      : ["bun", "run", "build"];
  const containerBuildArgs = ["bun", "run", "containers:build"];
  const prebuiltContainerImages =
    normalizeReleaseContainerImages(containerImages);
  if (
    requirePrebuiltContainerImages &&
    Object.keys(prebuiltContainerImages).length === 0
  ) {
    throw new Error(
      "TAKOS_REQUIRE_PREBUILT_CONTAINER_IMAGES is set, but TAKOS_RELEASE_CONTAINER_IMAGES_JSON is empty. Generate release_container_images from the Git CI release manifest and pass it through OpenTofu.",
    );
  }
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
      ];

  return [
    commandLine(renderArgs),
    ...(Object.keys(prebuiltContainerImages).length === 0
      ? []
      : [
          `${envShellAssignment(
            "TAKOS_RELEASE_CONTAINER_IMAGES_JSON",
            JSON.stringify(prebuiltContainerImages),
          )} ${commandLine([
            "bun",
            "scripts/control/apply-release-container-images.mjs",
            releaseWranglerConfig,
          ])}`,
        ]),
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
    commandLine(buildArgs),
    ...(Object.keys(prebuiltContainerImages).length === 0
      ? [commandLine(containerBuildArgs)]
      : []),
    ...migrationCommands,
    commandLine(ensureSecretsArgs),
    commandLine([
      "bunx",
      ...wranglerDeployArgs(outputs, environment, {
        containersRollout,
      }),
    ]),
  ];
}

const CONTAINER_IMAGE_ALIASES = {
  TakosRuntimeContainer: [
    "TakosRuntimeContainer",
    "runtime",
    "takos-worker-runtime",
  ],
  ExecutorContainerTier1: [
    "ExecutorContainerTier1",
    "executor",
    "takos-agent-executor",
    "executor-tier1",
  ],
  ExecutorContainerTier2: [
    "ExecutorContainerTier2",
    "executor",
    "takos-agent-executor",
    "executor-tier2",
  ],
  ExecutorContainerTier3: [
    "ExecutorContainerTier3",
    "executor",
    "takos-agent-executor",
    "executor-tier3",
  ],
};

export function normalizeReleaseContainerImages(value) {
  if (value == null || value === "") return {};
  let parsed = value;
  if (typeof value === "string") {
    parsed = JSON.parse(value);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "TAKOS_RELEASE_CONTAINER_IMAGES_JSON must be a JSON object",
    );
  }

  const entries = Object.entries(parsed)
    .map(([key, image]) => [
      key.trim(),
      typeof image === "string" ? image.trim() : "",
    ])
    .filter(([key, image]) => key && image);
  if (entries.length === 0) return {};

  for (const [key, image] of entries) {
    if (!isSupportedCloudflareContainerImageRef(image)) {
      throw new Error(
        `release container image "${key}" must use a Cloudflare Containers-supported registry ref`,
      );
    }
  }

  const lookup = new Map(entries);
  const resolved = {};
  for (const [className, aliases] of Object.entries(CONTAINER_IMAGE_ALIASES)) {
    const image = aliases.map((alias) => lookup.get(alias)).find(Boolean);
    if (image) resolved[className] = image;
  }
  return resolved;
}

export function inferCloudflareContainerRegistryAccountId(containerImages) {
  const normalized = normalizeReleaseContainerImages(containerImages);
  const accountIds = new Set(
    Object.values(normalized)
      .map(cloudflareContainerRegistryAccountId)
      .filter(Boolean),
  );
  return accountIds.size === 1 ? [...accountIds][0] : undefined;
}

function cloudflareContainerRegistryAccountId(image) {
  if (typeof image !== "string") return undefined;
  return image
    .trim()
    .match(/^registry\.cloudflare\.com\/([^/]+)\//u)?.[1];
}

export function releaseWranglerAccountId(outputs, env = process.env) {
  let outputAccountId;
  try {
    outputAccountId = requireStringOutput(outputs, "cloudflare_account_id");
  } catch {
    outputAccountId = env.CLOUDFLARE_ACCOUNT_ID ?? env.CF_ACCOUNT_ID;
  }
  const explicit =
    stringValue(env.TAKOS_CLOUDFLARE_WRANGLER_ACCOUNT_ID) ??
    stringValue(env.TAKOS_CLOUDFLARE_BACKEND_ACCOUNT_ID) ??
    stringValue(env.TAKOS_CLOUDFLARE_REAL_ACCOUNT_ID);
  if (explicit) return explicit;
  if (!cloudflareApiBaseProxyTarget(env)) return outputAccountId;
  const inferred = inferCloudflareContainerRegistryAccountId(
    env.TAKOS_RELEASE_CONTAINER_IMAGES_JSON,
  );
  return inferred ?? outputAccountId;
}

export function isSupportedCloudflareContainerImageRef(image) {
  if (typeof image !== "string") return false;
  const trimmed = image.trim();
  if (trimmed !== image || trimmed.length === 0 || /\s/u.test(trimmed)) {
    return false;
  }
  const digest = "@sha256:[0-9a-f]{64}";
  const tag = ":[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}";
  const suffix = `(?:${digest}|${tag})`;
  const patterns = [
    new RegExp(
      `^registry\\.cloudflare\\.com/[A-Za-z0-9_-]+/[A-Za-z0-9._/-]+${suffix}$`,
      "u",
    ),
    new RegExp(`^docker\\.io/[A-Za-z0-9._/-]+${suffix}$`, "u"),
    new RegExp(
      `^[0-9]{12}\\.dkr\\.ecr\\.[A-Za-z0-9-]+\\.amazonaws\\.com/[A-Za-z0-9._/-]+${suffix}$`,
      "u",
    ),
    new RegExp(
      `^[A-Za-z0-9-]+-docker\\.pkg\\.dev/[A-Za-z0-9._/-]+${suffix}$`,
      "u",
    ),
  ];
  return patterns.some((pattern) => pattern.test(trimmed));
}

function wranglerEnvironmentArgs(environment) {
  // The release config contains [env.staging]. Wrangler warns, and can route
  // follow-up API checks ambiguously, when production deploys omit --env.
  // An empty env explicitly targets the top-level production environment.
  return environment === "staging" ? ["--env", "staging"] : ["--env", ""];
}

function wranglerDeployArgs(outputs, environment, { containersRollout } = {}) {
  const workerName = requireStringOutput(outputs, "worker_name");
  return [
    "wrangler",
    "deploy",
    "--config",
    releaseWranglerConfigPath(environment),
    "--name",
    workerName,
    "--secrets-file",
    releaseSecretsFilePath(environment),
    ...wranglerEnvironmentArgs(environment),
    ...(containersRollout ? ["--containers-rollout", containersRollout] : []),
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

async function timeReleaseStep(timings, step, action) {
  const startedAt = Date.now();
  try {
    const result = await action();
    const durationMs = Date.now() - startedAt;
    timings.push({ step, status: "succeeded", durationMs });
    console.log(`Takos release step "${step}" completed in ${durationMs}ms.`);
    return result;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    timings.push({ step, status: "failed", durationMs });
    console.warn(`Takos release step "${step}" failed after ${durationMs}ms.`);
    throw error;
  }
}

async function runDestroyCommand(command, env = process.env) {
  const attempts = destroyCommandRetryAttempts(env);
  const intervalMs = destroyCommandRetryIntervalMs(env);
  let lastResult;
  let lastOutput = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) {
      console.warn(
        `Retrying release destroy command (${attempt}/${attempts}): ${command}`,
      );
    }
    console.log(`\n> ${command}\n`);
    const result = runShellCommand(command, env);
    lastResult = result;
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    const errorText = result.error instanceof Error ? result.error.message : "";
    lastOutput = `${stdout}\n${stderr}\n${errorText}`;
    emitCommandOutput(result, env);
    if (!result.error && result.status === 0) return;
    if (isIgnorableDestroyFailure(command, lastOutput)) {
      console.warn("Ignoring missing release resource during destroy.");
      return;
    }
    if (attempt < attempts && isRetryableDestroyFailure(command, lastOutput)) {
      if (intervalMs > 0) await wait(intervalMs);
      continue;
    }
    break;
  }
  if (
    isQueueConsumerRemoveCommand(command) &&
    isRetryableDestroyFailure(command, lastOutput)
  ) {
    console.warn(
      "Continuing release cleanup after transient queue consumer removal failure; worker deletion will remove remaining bindings.",
    );
    return;
  }
  if (lastResult?.error) throw lastResult.error;
  const error = new Error(`Command failed: ${command}`);
  error.status = lastResult?.status;
  error.signal = lastResult?.signal;
  throw error;
}

export function releaseCommandStepName(command) {
  if (command.includes("render-wrangler-from-tofu.mjs")) {
    return "render-wrangler-config";
  }
  if (command.includes("apply-release-container-images.mjs")) {
    return "apply-prebuilt-container-images";
  }
  if (command.includes("ensure-vectorize-index.mjs")) {
    return "ensure-vectorize-index";
  }
  if (command.includes("'bun' 'install'")) return "bun-install";
  if (command.includes("'bun' 'run' 'build'")) return "build-worker";
  if (command.includes("containers:build")) return "build-containers";
  if (command.includes("'d1' 'migrations' 'apply'")) {
    return "d1-migrations-apply";
  }
  if (command.includes("ensure-release-secrets.mjs")) {
    return "ensure-release-secrets";
  }
  if (command.includes("'queues' 'consumer' 'remove'")) {
    return "destroy-queue-consumer";
  }
  if (command.includes("'wrangler' 'delete'")) return "destroy-worker";
  if (command.includes("'vectorize' 'delete'"))
    return "destroy-vectorize-index";
  return "operator-command";
}

function releaseTimingSummary({
  environment,
  destroy,
  status,
  startedAt,
  finishedAt,
  timings,
}) {
  return {
    kind: "takos.release-activation-timings@v1",
    environment,
    operation: destroy ? "destroy" : "activate",
    status,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    totalDurationMs: finishedAt - startedAt,
    steps: timings,
  };
}

function emitReleaseTimingSummary(summary, env = process.env) {
  const json = JSON.stringify(summary);
  const file = env.TAKOS_RELEASE_TIMINGS_FILE?.trim();
  if (file) {
    const path = resolve(file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(summary, null, 2)}\n`);
  }
  console.log(`\nTAKOS_RELEASE_TIMINGS_JSON=${json}\n`);
}

function runShellCommand(command, env) {
  return spawnSync(command, {
    shell: true,
    env,
    encoding: "utf8",
    maxBuffer: RELEASE_COMMAND_OUTPUT_MAX_BYTES,
  });
}

export async function waitForWranglerDeployment(
  outputs,
  environment,
  env = process.env,
) {
  const workerName = requireStringOutput(outputs, "worker_name");
  const command = commandLine([
    "bunx",
    "wrangler",
    "deployments",
    "status",
    "--config",
    releaseWranglerConfigPath(environment),
    "--name",
    workerName,
    ...wranglerEnvironmentArgs(environment),
    "--json",
  ]);
  const attempts = releaseWorkerApiAttempts(env);
  const intervalMs = releaseWorkerApiIntervalMs(env);
  let lastOutput = "";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = runShellCommand(command, env);
    lastOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (!result.error && result.status === 0) {
      const parseResult = parseWranglerJsonOutput(result.stdout ?? "");
      if (parseResult.ok) {
        const status = parseResult.value;
        if (wranglerDeploymentReady(status)) {
          console.log(
            `Verified Wrangler deployment for ${workerName}: ${wranglerDeploymentSummary(
              status,
            )}`,
          );
          return status;
        }
        lastOutput = `${lastOutput}\nWrangler deployment status did not include an active version.`;
      } else {
        lastOutput = `${lastOutput}\n${parseResult.error}`;
      }
    }

    if (
      attempt >= attempts ||
      !isRetryableWranglerDeploymentStatusFailure(lastOutput)
    ) {
      throw new Error(
        `Wrangler deployment for ${workerName} was not visible after ${attempt} attempt(s): ${boundedCommandLog(
          lastOutput.trim(),
          env,
        )}`,
      );
    }

    if (intervalMs > 0) await wait(intervalMs);
  }

  throw new Error(
    `Wrangler deployment for ${workerName} was not visible: ${boundedCommandLog(
      lastOutput.trim(),
      env,
    )}`,
  );
}

export async function waitForWranglerDeploymentBestEffort(
  outputs,
  environment,
  env = process.env,
) {
  try {
    return {
      skipped: false,
      status: await waitForWranglerDeployment(outputs, environment, env),
    };
  } catch (error) {
    if (
      env.TAKOS_RELEASE_REQUIRE_WRANGLER_DEPLOYMENT_STATUS === "1" ||
      env.TAKOS_RELEASE_REQUIRE_WRANGLER_DEPLOYMENT_STATUS === "true"
    ) {
      throw error;
    }
    const workerName = requireStringOutput(outputs, "worker_name");
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `Skipping Wrangler deployment status verification for ${workerName}: ${boundedCommandLog(
        message,
        env,
      )}`,
    );
    return {
      skipped: true,
      reason: "wrangler_deployment_status_unavailable",
      message,
    };
  }
}

function parseWranglerJsonOutput(output) {
  const trimmed = output.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: "wrangler deployments status returned no JSON output",
    };
  }
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch (error) {
    return {
      ok: false,
      error: `wrangler deployments status returned invalid JSON output: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function wranglerDeploymentReady(status) {
  if (!status || typeof status !== "object") return false;
  return (
    typeof status.id === "string" &&
    Array.isArray(status.versions) &&
    status.versions.some(
      (version) =>
        typeof version?.version_id === "string" &&
        Number(version?.percentage) > 0,
    )
  );
}

function wranglerDeploymentSummary(status) {
  const versions = Array.isArray(status?.versions) ? status.versions : [];
  const versionSummary = versions
    .map(
      (version) =>
        `${version.version_id ?? "unknown"}:${version.percentage ?? 0}%`,
    )
    .join(", ");
  return `${status?.id ?? "unknown"}${versionSummary ? ` (${versionSummary})` : ""}`;
}

function isRetryableWranglerDeploymentStatusFailure(output) {
  return /does not exist|not found|no JSON output|invalid JSON output|fetch failed|fetch request failed|connect ETIMEDOUT|ECONNRESET|EAI_AGAIN|socket hang up|HTTP 429|HTTP 5\d\d|Internal error|temporarily unavailable/i.test(
    output,
  );
}

function emitCommandOutput(result, env) {
  const stdout = boundedCommandLog(result.stdout ?? "", env);
  const stderr = boundedCommandLog(result.stderr ?? "", env);
  if (stdout)
    process.stdout.write(stdout.endsWith("\n") ? stdout : `${stdout}\n`);
  if (stderr)
    process.stderr.write(stderr.endsWith("\n") ? stderr : `${stderr}\n`);
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
  if (isQueueConsumerRemoveCommand(command)) {
    return (
      /No worker consumer .* exists for queue/u.test(output) ||
      /Queue ["']?.+["']? does not exist/i.test(output)
    );
  }
  if (command.includes("'wrangler' 'delete'")) {
    return /not found|does not exist|No such Worker/i.test(output);
  }
  if (command.includes("'vectorize' 'delete'")) {
    return /not found|does not exist|vectorize\.index\.deleted/i.test(output);
  }
  return false;
}

function isQueueConsumerRemoveCommand(command) {
  return command.includes("'queues' 'consumer' 'remove'");
}

export function isRetryableDestroyFailure(_command, output) {
  return /fetch failed|fetch request failed|connect ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|network connectivity|HTTP 429|HTTP 5\d\d|Internal error|temporarily unavailable/i.test(
    output,
  );
}

function destroyCommandRetryAttempts(env) {
  return Math.max(
    1,
    integerEnv(
      env,
      "TAKOS_RELEASE_DESTROY_RETRY_ATTEMPTS",
      DESTROY_COMMAND_RETRY_ATTEMPTS,
    ),
  );
}

function destroyCommandRetryIntervalMs(env) {
  return integerEnv(
    env,
    "TAKOS_RELEASE_DESTROY_RETRY_INTERVAL_MS",
    DESTROY_COMMAND_RETRY_INTERVAL_MS,
  );
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

export function releaseChildEnv(outputs, env = process.env) {
  let virtualAccountId;
  try {
    virtualAccountId = requireStringOutput(outputs, "cloudflare_account_id");
  } catch {
    virtualAccountId = env.CLOUDFLARE_ACCOUNT_ID ?? env.CF_ACCOUNT_ID;
  }
  const wranglerAccountId = releaseWranglerAccountId(outputs, env);
  const apiToken = env.CLOUDFLARE_API_TOKEN ?? env.CF_API_TOKEN;
  const apiBase =
    env.TAKOS_CLOUDFLARE_API_BASE_URL ?? env.CLOUDFLARE_API_BASE_URL;
  const managedCompatApiBase =
    typeof apiBase === "string" &&
    apiBase.trim() &&
    isTakosumiCloudflareCompatBase(apiBase.trim());
  return {
    ...env,
    CI: env.CI ?? "true",
    WRANGLER_SEND_METRICS: env.WRANGLER_SEND_METRICS ?? "false",
    ...(apiBase
      ? {
          TAKOS_CLOUDFLARE_API_BASE_URL: apiBase,
          CLOUDFLARE_API_BASE_URL: apiBase,
          CF_API_BASE_URL: apiBase,
        }
      : {}),
    ...(apiToken
      ? {
          CLOUDFLARE_API_TOKEN: apiToken,
          CF_API_TOKEN: env.CF_API_TOKEN ?? apiToken,
        }
      : {}),
    ...(wranglerAccountId
      ? {
          CLOUDFLARE_ACCOUNT_ID: wranglerAccountId,
          CF_ACCOUNT_ID: wranglerAccountId,
        }
      : {}),
    ...(managedCompatApiBase && wranglerAccountId
      ? {
          TAKOS_CLOUDFLARE_WRANGLER_ACCOUNT_ID: wranglerAccountId,
        }
      : {}),
    ...(managedCompatApiBase && virtualAccountId
      ? {
          TAKOS_CLOUDFLARE_VIRTUAL_ACCOUNT_ID: virtualAccountId,
        }
      : {}),
  };
}

export function releaseContextHeaders(env = process.env) {
  const context = parseReleaseContext(env.TAKOSUMI_RELEASE_CONTEXT_JSON);
  const installation =
    context && typeof context.installation === "object"
      ? context.installation
      : undefined;
  const workspaceId =
    stringValue(context?.workspaceId) ??
    stringValue(context?.spaceId) ??
    stringValue(env.TAKOSUMI_WORKSPACE_ID) ??
    stringValue(env.TAKOSUMI_SPACE_ID);
  const installationId =
    stringValue(installation?.id) ??
    stringValue(context?.installationId) ??
    stringValue(env.TAKOSUMI_CAPSULE_ID) ??
    stringValue(env.TAKOSUMI_INSTALLATION_ID);
  return {
    ...(workspaceId
      ? {
          "x-takosumi-cloud-billing-workspace-id": workspaceId,
          "x-takosumi-cloud-space-id": workspaceId,
        }
      : {}),
    ...(installationId
      ? {
          "x-takosumi-cloud-billing-installation-id": installationId,
          "x-takosumi-cloud-installation-id": installationId,
        }
      : {}),
  };
}

function parseReleaseContext(raw) {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function withCloudflareApiBaseProxy(env, action) {
  const targetBase = cloudflareApiBaseProxyTarget(env);
  if (!targetBase) return action(env);
  const apiToken = releaseApiToken(env);
  if (!apiToken) {
    throw new Error(
      "Takosumi Cloud compat API release requires CLOUDFLARE_API_TOKEN or CF_API_TOKEN",
    );
  }
  const proxyScript = fileURLToPath(
    new URL("./cloudflare-api-base-proxy.mjs", import.meta.url),
  );
  const child = spawn("bun", [proxyScript], {
    env: {
      ...process.env,
      TAKOS_CLOUDFLARE_API_PROXY_TARGET_BASE: targetBase,
      TAKOS_CLOUDFLARE_API_PROXY_TOKEN: apiToken,
      TAKOS_CLOUDFLARE_API_PROXY_CONTEXT_HEADERS: JSON.stringify(
        releaseContextHeaders(env),
      ),
      TAKOS_CLOUDFLARE_API_PROXY_ACCOUNT_REWRITE:
        releaseAccountRewriteJson(env) ?? "",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  let closePromise;
  try {
    closePromise = new Promise((resolveClose) => {
      child.once("close", (code, signal) => resolveClose({ code, signal }));
    });
    const ready = await waitForCloudflareApiProxyReady(child);
    const proxyBase = `http://${ready.hostname}:${ready.port}`;
    return await action({
      ...env,
      TAKOS_CLOUDFLARE_API_BASE_URL: proxyBase,
      CLOUDFLARE_API_BASE_URL: proxyBase,
      CF_API_BASE_URL: proxyBase,
    });
  } finally {
    child.kill("SIGTERM");
    if (closePromise) await closePromise;
  }
}

function releaseAccountRewriteJson(env) {
  const from = stringValue(env.TAKOS_CLOUDFLARE_WRANGLER_ACCOUNT_ID);
  const to = stringValue(env.TAKOS_CLOUDFLARE_VIRTUAL_ACCOUNT_ID);
  if (!from || !to || from === to) return undefined;
  return JSON.stringify({ from, to });
}

function cloudflareApiBaseProxyTarget(env) {
  const configured =
    env.TAKOS_CLOUDFLARE_API_BASE_URL ??
    env.CLOUDFLARE_API_BASE_URL ??
    env.CF_API_BASE_URL;
  if (typeof configured !== "string" || !configured.trim()) return undefined;
  const base = configured.trim().replace(/\/+$/u, "");
  if (!isTakosumiCloudflareCompatBase(base)) return undefined;
  return base;
}

function isTakosumiCloudflareCompatBase(base) {
  try {
    const url = new URL(base);
    return url.pathname.includes("/compat/cloudflare/");
  } catch {
    return false;
  }
}

async function waitForCloudflareApiProxyReady(child) {
  if (!child.stdout) {
    throw new Error("Cloudflare API proxy stdout is unavailable");
  }
  let buffered = "";
  return await new Promise((resolveReady, rejectReady) => {
    const timeout = setTimeout(() => {
      cleanup();
      rejectReady(new Error("Timed out waiting for Cloudflare API proxy"));
    }, 10_000);
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout?.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const onError = (error) => {
      cleanup();
      rejectReady(error);
    };
    const onExit = (code, signal) => {
      cleanup();
      rejectReady(
        new Error(
          `Cloudflare API proxy exited before ready (code=${code}, signal=${signal})`,
        ),
      );
    };
    const onData = (chunk) => {
      buffered += chunk.toString("utf8");
      let newline = buffered.indexOf("\n");
      while (newline !== -1) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (line.startsWith(CLOUDFLARE_API_PROXY_READY_PREFIX)) {
          cleanup();
          try {
            resolveReady(
              JSON.parse(line.slice(CLOUDFLARE_API_PROXY_READY_PREFIX.length)),
            );
          } catch (error) {
            rejectReady(error);
          }
          return;
        }
        newline = buffered.indexOf("\n");
      }
    };
    child.stdout.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function cloudflareApiBaseUrl(env = process.env) {
  const configured =
    env.TAKOS_CLOUDFLARE_API_BASE_URL ?? env.CLOUDFLARE_API_BASE_URL;
  const base =
    typeof configured === "string" && configured.trim()
      ? configured.trim()
      : "https://api.cloudflare.com/client/v4";
  return base.replace(/\/+$/u, "");
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
  const launchUrl = releaseLaunchUrl(outputs);
  if (!launchUrl) return false;
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
    console.warn(
      `Skipped workers.dev API enablement for ${workerName}: CF_API_TOKEN or CLOUDFLARE_API_TOKEN is not available.`,
    );
    return { skipped: true, reason: "api_token_unavailable" };
  }

  const url = `${cloudflareApiBaseUrl(env)}/accounts/${encodeURIComponent(
    accountId,
  )}/workers/scripts/${encodeURIComponent(workerName)}/subdomain`;
  const attempts = releaseWorkerApiAttempts(env);
  const intervalMs = releaseWorkerApiIntervalMs(env);
  let payload;
  let responseStatus = 0;
  let lastMissingWorker = false;
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
    lastMissingWorker = cloudflareWorkerApiMissingResource(payload);
    if (
      attempt >= attempts ||
      !shouldRetryCloudflareWorkerApi(response, payload)
    ) {
      if (lastMissingWorker) {
        console.warn(
          `Skipped workers.dev API enablement for ${workerName}: Worker was not visible to the API after ${attempt} attempt(s).`,
        );
        return { skipped: true, reason: "workers_dev_api_unavailable" };
      }
      throw new Error(
        `Failed to enable workers.dev for ${workerName}: HTTP ${response.status} ${JSON.stringify(
          payload?.errors ?? payload,
        )}`,
      );
    }
    if (intervalMs > 0) await wait(intervalMs);
  }
  if (lastMissingWorker) {
    console.warn(
      `Skipped workers.dev API enablement for ${workerName}: Worker was not visible to the API.`,
    );
    return { skipped: true, reason: "workers_dev_api_unavailable" };
  }
  throw new Error(
    `Failed to enable workers.dev for ${workerName}: HTTP ${responseStatus} ${JSON.stringify(
      payload?.errors ?? payload,
    )}`,
  );
}

function cloudflareWorkerApiMissingResource(payload) {
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

function releaseHealthUrl(outputs) {
  const launchUrl = releaseLaunchUrl(outputs);
  if (!launchUrl) return undefined;
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
    return undefined;
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
  if (!apiToken) {
    console.warn(
      `Skipped Cloudflare Worker content API verification for ${workerName}: CF_API_TOKEN or CLOUDFLARE_API_TOKEN is not available.`,
    );
    return {
      workerName,
      skipped: true,
      reason: "api_token_unavailable",
    };
  }
  const urls = workerContentVerificationUrls({
    accountId,
    workerName,
    workerEnvironment,
    environment,
    apiBase: cloudflareApiBaseUrl(env),
  });
  const attempts = releaseWorkerApiAttempts(env);
  const intervalMs = releaseWorkerApiIntervalMs(env);
  const unavailable = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let shouldRetry = false;
    for (const url of urls) {
      const response = await fetchImpl(url, {
        headers: { authorization: `Bearer ${apiToken}` },
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      const text = new TextDecoder("utf8", { fatal: false }).decode(bytes);
      if (response.ok) {
        return await verifyCloudflareWorkerContentBytes({
          workerName,
          bytes,
          text,
          env,
        });
      }
      let payload;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = { errors: [{ message: text }] };
      }
      const unavailableReason = cloudflareWorkerContentUnavailableReason(
        response,
        payload,
      );
      if (unavailableReason) {
        unavailable.push(`${response.status}:${unavailableReason}`);
        shouldRetry =
          shouldRetry || shouldRetryCloudflareWorkerApi(response, payload);
        continue;
      }
      if (!shouldRetryCloudflareWorkerApi(response, payload)) {
        throw new Error(
          `Cloudflare Worker content verification failed for ${workerName}: HTTP ${response.status} ${text.slice(
            0,
            240,
          )}`,
        );
      }
      shouldRetry = true;
    }
    if (attempt >= attempts) {
      const reason =
        unavailable.length === 0
          ? "content_api_unavailable"
          : unavailable.slice(-3).join(", ");
      console.warn(
        `Skipped Cloudflare Worker content API verification for ${workerName}: ${reason}`,
      );
      return {
        workerName,
        skipped: true,
        reason: "content_api_unavailable",
      };
    }
    if (shouldRetry && intervalMs > 0) await wait(intervalMs);
  }
  return {
    workerName,
    skipped: true,
    reason: "content_api_unavailable",
  };
}

async function verifyCloudflareWorkerContentBytes({
  workerName,
  bytes,
  text,
  env,
}) {
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

function cloudflareWorkerContentUnavailableReason(response, payload) {
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  for (const error of errors) {
    const code = Number(error?.code);
    const message =
      typeof error?.message === "string" ? error.message : "unavailable";
    if (code === 10405) return message;
    if (response.status === 404 && (code === 10007 || code === 10092)) {
      return message;
    }
  }
  return undefined;
}

function workerContentVerificationUrls({
  accountId,
  workerName,
  workerEnvironment,
  environment,
  apiBase = "https://api.cloudflare.com/client/v4",
}) {
  const base = apiBase.replace(/\/+$/u, "");
  const account = encodeURIComponent(accountId);
  const worker = encodeURIComponent(workerName);
  const serviceEnvironmentUrl =
    `${base}/accounts/${account}` +
    `/workers/services/${worker}/environments/${encodeURIComponent(workerEnvironment)}/content`;
  const scriptUrl = `${base}/accounts/${account}/workers/scripts/${worker}/content`;
  return environment === "staging"
    ? [serviceEnvironmentUrl, scriptUrl]
    : [scriptUrl, serviceEnvironmentUrl];
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
  const timings = [];
  const releaseStartedAt = Date.now();
  let releaseStatus = "succeeded";
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
          containerImages: env.TAKOS_RELEASE_CONTAINER_IMAGES_JSON,
          requirePrebuiltContainerImages:
            env.TAKOS_REQUIRE_PREBUILT_CONTAINER_IMAGES === "1" ||
            env.TAKOS_REQUIRE_PREBUILT_CONTAINER_IMAGES === "true",
        });
      })();
  const childEnv = releaseChildEnv(outputs, env);
  try {
    await withCloudflareApiBaseProxy(childEnv, async (releaseEnv) => {
      const commandsToRun = destroy ? commands : commands.slice(0, -1);
      for (const command of commandsToRun) {
        await timeReleaseStep(timings, releaseCommandStepName(command), () =>
          destroy
            ? runDestroyCommand(command, releaseEnv)
            : run(command, releaseEnv),
        );
      }
      if (!destroy) {
        await timeReleaseStep(timings, "wrangler-deploy", () =>
          runFile(
            "bunx",
            wranglerDeployArgs(outputs, environment, {
              containersRollout: env.TAKOS_WRANGLER_CONTAINERS_ROLLOUT,
            }),
            releaseEnv,
          ),
        );
        await timeReleaseStep(timings, "wrangler-deployment-status", () =>
          waitForWranglerDeploymentBestEffort(outputs, environment, releaseEnv),
        );
        await timeReleaseStep(timings, "worker-content-verification", () =>
          verifyCloudflareWorkerContent(outputs, environment, releaseEnv),
        );
        await timeReleaseStep(timings, "workers-dev-enable", () =>
          ensureWorkersDevSubdomain(outputs, releaseEnv),
        );
        await timeReleaseStep(timings, "public-health-check", () =>
          verifyReleaseHealth(outputs, releaseEnv),
        );
      }
    });
  } catch (error) {
    releaseStatus = "failed";
    throw error;
  } finally {
    if (!destroy) {
      cleanupReleaseSecretsFile(environment);
      cleanupReleaseWranglerConfig(environment);
    }
    emitReleaseTimingSummary(
      releaseTimingSummary({
        environment,
        destroy,
        status: releaseStatus,
        startedAt: releaseStartedAt,
        finishedAt: Date.now(),
        timings,
      }),
      env,
    );
  }
  console.log(
    `\nTakos ${destroy ? "release cleanup" : "release activation"} completed for ${environment}.`,
  );
}

if (import.meta.main) {
  await main();
}
