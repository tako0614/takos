#!/usr/bin/env bun
import * as runtime from "../runtime.ts";

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  readFileSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import process from "node:process";

import { parseTakosumiOutputsJson } from "./render-wrangler-from-tofu.mjs";
import {
  cleanupWorkerReleaseArtifact,
  prepareWorkerReleaseArtifact,
  workerReleaseArtifactConfig,
} from "./worker-release-artifact.mjs";

const ENVIRONMENTS = ["production", "staging"];
const WRANGLER_CONFIG = "deploy/cloudflare/wrangler.toml";
const DEFAULT_TAKOSUMI_REPO_URL = "https://github.com/tako0614/takosumi.git";
const DEFAULT_TAKOSUMI_REPO_REF = "";
const MIN_WORKER_CONTENT_BYTES = 1024;
const RELEASE_HEALTH_ATTEMPTS = 12;
const RELEASE_HEALTH_INTERVAL_MS = 2500;
const RELEASE_WORKER_API_ATTEMPTS = 12;
const RELEASE_WORKER_API_INTERVAL_MS = 2500;
const RELEASE_CONTAINER_API_ATTEMPTS = 80;
const RELEASE_CONTAINER_API_INTERVAL_MS = 3000;
const RELEASE_COMMAND_OUTPUT_MAX_BYTES = 64 * 1024 * 1024;
const RELEASE_COMMAND_LOG_MAX_CHARS = 20_000;
const DESTROY_COMMAND_RETRY_ATTEMPTS = 3;
const DESTROY_COMMAND_RETRY_INTERVAL_MS = 2000;
const BUN_INSTALL_RETRY_ATTEMPTS = 3;
const BUN_INSTALL_RETRY_INTERVAL_MS = 2000;
const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";
const GENERATED_PUBLIC_ROUTE_BEGIN = "# BEGIN TAKOSUMI GENERATED PUBLIC ROUTE";
const GENERATED_PUBLIC_ROUTE_END = "# END TAKOSUMI GENERATED PUBLIC ROUTE";
const ASSET_UPLOAD_AUTHORIZATION_HEADER =
  "x-takosumi-cloudflare-assets-authorization";

const require = createRequire(import.meta.url);
let blake3Module;

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
  TAKOS_CLOUDFLARE_WRANGLER_DEPLOY_API_TOKEN
                                          Optional native Wrangler token used
                                          for release-time Cloudflare API
                                          operations. Use this or
                                          CLOUDFLARE_CONTAINERS_API_TOKEN when
                                          the Provider Connection token points
                                          at a compatibility endpoint or has a
                                          narrower scope.
  TAKOS_REQUIRE_PREBUILT_CONTAINER_IMAGES Set to 1/true for hosted/operator
                                          materializers that must consume Git
                                          CI images and must not build
                                          containers inside the activation run.
  TAKOS_RELEASE_WORKER_ARTIFACT_URL        Optional CI-built Worker/assets
                                          archive selected by OpenTofu.
  TAKOS_RELEASE_WORKER_ARTIFACT_SHA256     Required SHA-256 for the archive.
                                          When both are absent, activation
                                          builds the pinned Git source.
  TAKOS_RELEASE_BUN_INSTALL_CACHE_DIR     Cache root used by bun install during
                                          activation. Each retry gets its own
                                          subdirectory to avoid corrupt cache
                                          reuse.
  TAKOS_RELEASE_BUN_INSTALL_ATTEMPTS      bun install attempts. Default: 3.
  TAKOS_RELEASE_BUN_INSTALL_RETRY_INTERVAL_MS
                                          Delay between retryable bun install
                                          failures. Default: 2000.
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
    optionalStringOutput(outputs, "url") ??
    optionalStringOutput(outputs, "public_url") ??
    optionalStringOutput(outputs, "app_url") ??
    optionalStringOutput(outputs, "api_url");
  if (explicitLaunchUrl) return explicitLaunchUrl;

  const workerName = optionalStringOutput(outputs, "service_runtime_name");
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

function optionalObjectOutput(outputs, name) {
  const value = outputValue(outputs[name]);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
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

function optionalVectorIndex(outputs) {
  const indexes = optionalObjectOutput(outputs, "vector_indexes");
  if (!indexes) return undefined;
  for (const key of ["vector", "embeddings", "default"]) {
    const value = indexes[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value;
    }
  }
  return undefined;
}

function requireVectorIndexName(outputs) {
  const value = optionalVectorIndex(outputs)?.name;
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  return requireStringOutput(outputs, "cloudflare_vectorize_index_name");
}

function requireVectorIndexDimensions(outputs) {
  const value = optionalVectorIndex(outputs)?.dimensions;
  if (Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/u.test(value.trim())) {
    return Number(value.trim());
  }
  return requireIntegerOutput(outputs, "cloudflare_vectorize_index_dimensions");
}

function requireVectorIndexMetric(outputs) {
  const value = optionalVectorIndex(outputs)?.metric;
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  return requireStringOutput(outputs, "cloudflare_vectorize_index_metric");
}

export function ensureTakosumiSourceModule(
  takosumiRepoDir,
  { repoUrl = DEFAULT_TAKOSUMI_REPO_URL, ref = DEFAULT_TAKOSUMI_REPO_REF } = {},
) {
  const expected = resolve("..", "takosumi");
  if (existsSync(expected)) {
    assertCleanGitCheckout(expected, ref);
    return;
  }
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
    const trimmedRef = ref?.trim();
    if (!trimmedRef) {
      throw new Error(
        "TAKOS_RELEASE_TAKOSUMI_REF is required when the Takosumi source module must be cloned.",
      );
    }
    runFile("git", [
      "clone",
      "--filter=blob:none",
      "--no-checkout",
      trimmedRepoUrl,
      expected,
    ]);
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
    assertCleanGitCheckout(expected, trimmedRef);
    return;
  }
  assertCleanGitCheckout(source, ref);
  symlinkSync(source, expected, "dir");
}

function assertCleanGitCheckout(directory, ref) {
  const gitDirectory = resolve(directory, ".git");
  const trimmedRef = ref?.trim();
  if (!existsSync(gitDirectory)) {
    if (trimmedRef) {
      throw new Error(
        `Takosumi source at ${directory} is not a Git checkout and cannot be verified against ${trimmedRef}.`,
      );
    }
    return;
  }
  const dirty = execFileSync(
    "git",
    ["-C", directory, "status", "--porcelain", "--untracked-files=all"],
    { encoding: "utf8" },
  ).trim();
  if (dirty) {
    throw new Error(
      `Takosumi source checkout at ${directory} contains uncommitted files. Use a clean checkout for a reproducible source build.`,
    );
  }
  if (!trimmedRef) return;
  const head = execFileSync("git", ["-C", directory, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const expected = execFileSync(
    "git",
    ["-C", directory, "rev-parse", "--verify", `${trimmedRef}^{commit}`],
    { encoding: "utf8" },
  ).trim();
  if (head !== expected) {
    throw new Error(
      `Takosumi source checkout at ${directory} is ${head}, but the reviewed source build requires ${expected}.`,
    );
  }
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

export function releaseD1MigrationsWranglerConfigPath(environment) {
  return `deploy/cloudflare/.takos-release-wrangler.${environment}.d1-migrations.toml`;
}

export function releaseWranglerBundleDir(environment) {
  return `deploy/cloudflare/.takos-release-bundle.${environment}`;
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
    wranglerAccountId,
    workerArtifact = false,
  } = {},
) {
  if (!ENVIRONMENTS.includes(environment)) {
    throw new Error(`Unknown environment "${environment}"`);
  }
  const accountId =
    typeof wranglerAccountId === "string" && wranglerAccountId.trim() !== ""
      ? wranglerAccountId.trim()
      : requireStringOutput(outputs, "cloudflare_account_id");
  const vectorizeIndexName = requireVectorIndexName(outputs);
  const vectorizeDimensions = requireVectorIndexDimensions(outputs);
  const vectorizeMetric = requireVectorIndexMetric(outputs);
  const wranglerEnvArgs = wranglerEnvironmentArgs(environment);
  const releaseSecretsFile = releaseSecretsFilePath(environment);
  const releaseWranglerConfig = releaseWranglerConfigPath(environment);
  const releaseD1WranglerConfig =
    releaseD1MigrationsWranglerConfigPath(environment);
  const renderArgs = [
    "bun",
    "scripts/control/render-wrangler-from-tofu.mjs",
    environment,
    "--out",
    releaseWranglerConfig,
    ...(zoneId ? ["--zone-id", zoneId] : []),
  ];
  const installArgs = [
    "bun",
    "install",
    "--frozen-lockfile",
    "--ignore-scripts",
  ];
  const buildArgs =
    debug && environment === "staging"
      ? ["bun", "run", "build", "--mode", "staging-debug"]
      : ["bun", "run", "build"];
  const containerBuildArgs = ["bun", "run", "containers:build"];
  const prebuiltContainerImages =
    normalizeReleaseContainerImages(containerImages);
  const missingPrebuiltContainerImages = [
    "TakosRuntimeContainer",
    "ExecutorContainerTier1",
    "ExecutorContainerTier2",
    "ExecutorContainerTier3",
  ].filter((name) => !prebuiltContainerImages[name]);
  if (requirePrebuiltContainerImages && missingPrebuiltContainerImages.length) {
    throw new Error(
      `TAKOS_REQUIRE_PREBUILT_CONTAINER_IMAGES is set, but prebuilt images are missing for: ${missingPrebuiltContainerImages.join(", ")}. Generate the service-side InstallConfig patch from the Git CI Worker artifact manifest.`,
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
          releaseD1WranglerConfig,
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
    ...(workerArtifact
      ? []
      : [commandLine(installArgs), commandLine(buildArgs)]),
    ...(Object.keys(prebuiltContainerImages).length === 0
      ? [commandLine(containerBuildArgs)]
      : []),
    ...migrationCommands,
    commandLine(ensureSecretsArgs),
    commandLine([
      "bunx",
      ...wranglerReleaseArtifactArgs(outputs, environment, {
        containersRollout,
        prebuiltWorker: workerArtifact,
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
    "takos-agent",
    "executor-tier1",
  ],
  ExecutorContainerTier2: [
    "ExecutorContainerTier2",
    "executor",
    "takos-agent",
    "executor-tier2",
  ],
  ExecutorContainerTier3: [
    "ExecutorContainerTier3",
    "executor",
    "takos-agent",
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

function isTakosumiVirtualCloudflareAccountId(value) {
  return typeof value === "string" && /^ts_acc_/u.test(value.trim());
}

function cloudflareRegistryAccountId(image) {
  if (typeof image !== "string") return undefined;
  const match = /^registry\.cloudflare\.com\/([^/]+)\//u.exec(image.trim());
  return match?.[1];
}

function releaseContainerImagesAccountId(env = process.env) {
  const images = normalizeReleaseContainerImages(
    env.TAKOS_RELEASE_CONTAINER_IMAGES_JSON,
  );
  const accountIds = new Set(
    Object.values(images)
      .map((image) => cloudflareRegistryAccountId(image))
      .filter((value) => typeof value === "string" && value.length > 0),
  );
  if (accountIds.size === 0) return undefined;
  if (accountIds.size > 1) {
    throw new Error(
      "TAKOS_RELEASE_CONTAINER_IMAGES_JSON must use one Cloudflare registry account when deriving Wrangler account id.",
    );
  }
  return [...accountIds][0];
}

function releaseOutputOrEnvCloudflareAccountId(outputs, env = process.env) {
  try {
    return requireStringOutput(outputs, "cloudflare_account_id");
  } catch {
    return (
      stringValue(env.CLOUDFLARE_ACCOUNT_ID) ?? stringValue(env.CF_ACCOUNT_ID)
    );
  }
}

export function isTakosumiManagedCloudflareTarget(outputs, env = process.env) {
  return isTakosumiVirtualCloudflareAccountId(
    releaseOutputOrEnvCloudflareAccountId(outputs, env),
  );
}

function takosumiManagedCloudflareAccountId(outputs, env = process.env) {
  const accountId = releaseOutputOrEnvCloudflareAccountId(outputs, env);
  return isTakosumiVirtualCloudflareAccountId(accountId)
    ? accountId
    : undefined;
}

export function releaseWranglerAccountId(outputs, env = process.env) {
  const explicit =
    stringValue(env.TAKOS_CLOUDFLARE_WRANGLER_ACCOUNT_ID) ??
    stringValue(env.TAKOS_CLOUDFLARE_REAL_ACCOUNT_ID) ??
    stringValue(env.TAKOSUMI_CLOUDFLARE_ACCOUNT_ID);
  if (explicit) return explicit;

  const outputAccountId = releaseOutputOrEnvCloudflareAccountId(outputs, env);
  if (isTakosumiVirtualCloudflareAccountId(outputAccountId)) {
    const imageAccountId = releaseContainerImagesAccountId(env);
    if (imageAccountId) return imageAccountId;
    throw new Error(
      "Takos release requires a real Cloudflare account id for native Wrangler operations when cloudflare_account_id is a Takosumi virtual account. Set TAKOS_CLOUDFLARE_WRANGLER_ACCOUNT_ID or TAKOSUMI_CLOUDFLARE_ACCOUNT_ID, and configure reviewed registry.cloudflare.com image refs in the service-side lifecycle action.",
    );
  }
  return outputAccountId;
}

function releaseCloudflareApiAccountId(outputs, env = process.env) {
  return (
    takosumiManagedCloudflareAccountId(outputs, env) ??
    releaseWranglerAccountId(outputs, env)
  );
}

export function isSupportedCloudflareContainerImageRef(image) {
  if (typeof image !== "string") return false;
  const trimmed = image.trim();
  if (trimmed !== image || trimmed.length === 0 || /\s/u.test(trimmed)) {
    return false;
  }
  const digest = "@sha256:[0-9a-f]{64}";
  const tag = ":[A-Za-z0-9_][A-Za-z0-9._-]{0,127}";
  const patterns = [
    new RegExp(
      `^registry\\.cloudflare\\.com/[A-Za-z0-9_-]+/[A-Za-z0-9._/-]+(?:${digest}|${tag})$`,
      "u",
    ),
    new RegExp(`^docker\\.io/[A-Za-z0-9._/-]+${digest}$`, "u"),
    new RegExp(
      `^[0-9]{12}\\.dkr\\.ecr\\.[A-Za-z0-9-]+\\.amazonaws\\.com/[A-Za-z0-9._/-]+${digest}$`,
      "u",
    ),
    new RegExp(
      `^[A-Za-z0-9-]+-docker\\.pkg\\.dev/[A-Za-z0-9._/-]+${digest}$`,
      "u",
    ),
  ];
  return patterns.some((pattern) => pattern.test(trimmed));
}

function wranglerEnvironmentArgs(environment) {
  return environment === "staging" ? ["--env", "staging"] : [];
}

function wranglerDeployEnvironmentArgs(environment) {
  return environment === "staging" ? ["--env", "staging"] : ["--env", ""];
}

function wranglerDeployArgs(
  outputs,
  environment,
  { containersRollout, prebuiltWorker = false } = {},
) {
  const workerName = requireStringOutput(outputs, "service_runtime_name");
  return [
    "wrangler",
    "deploy",
    "--config",
    releaseWranglerConfigPath(environment),
    "--name",
    workerName,
    "--secrets-file",
    releaseSecretsFilePath(environment),
    ...wranglerDeployEnvironmentArgs(environment),
    ...(prebuiltWorker ? ["--no-bundle"] : []),
    ...(containersRollout ? ["--containers-rollout", containersRollout] : []),
  ];
}

function wranglerBundleArgs(
  outputs,
  environment,
  { containersRollout, prebuiltWorker = false } = {},
) {
  return [
    ...wranglerDeployArgs(outputs, environment, {
      containersRollout,
      prebuiltWorker,
    }),
    "--dry-run",
    "--outdir",
    releaseWranglerBundleDir(environment),
  ];
}

function wranglerReleaseArtifactArgs(
  outputs,
  environment,
  { containersRollout, prebuiltWorker = false } = {},
) {
  return isTakosumiManagedCloudflareTarget(outputs)
    ? wranglerBundleArgs(outputs, environment, {
        containersRollout,
        prebuiltWorker,
      })
    : wranglerDeployArgs(outputs, environment, {
        containersRollout,
        prebuiltWorker,
      });
}

export function buildTakosumiDestroyCommands(outputs) {
  const workerName = requireStringOutput(outputs, "service_runtime_name");
  const vectorizeIndexName = requireVectorIndexName(outputs);
  const queues = [
    requireNestedStringOutput(outputs, "queues", "runs"),
    requireNestedStringOutput(outputs, "queues", "runs_dlq"),
    requireNestedStringOutput(outputs, "queues", "index_jobs"),
    requireNestedStringOutput(outputs, "queues", "index_jobs_dlq"),
    requireNestedStringOutput(outputs, "queues", "workflow"),
    requireNestedStringOutput(outputs, "queues", "workflow_dlq"),
    requireNestedStringOutput(outputs, "queues", "deployment"),
    requireNestedStringOutput(outputs, "queues", "deployment_dlq"),
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

async function run(command, env = process.env) {
  if (isBunInstallCommand(command)) {
    await runBunInstallCommand(command, env);
    return;
  }
  runCommandOnce(command, env);
}

function runCommandOnce(command, env = process.env) {
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

async function runBunInstallCommand(command, env = process.env) {
  const attempts = releaseBunInstallAttempts(env);
  const intervalMs = releaseBunInstallRetryIntervalMs(env);
  let lastResult;
  let lastOutput = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) {
      console.warn(`Retrying bun install (${attempt}/${attempts}).`);
    }
    const installEnv = bunInstallCommandEnv(env, attempt);
    console.log(`\n> ${command}\n`);
    const result = runShellCommand(command, installEnv);
    lastResult = result;
    lastOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${
      result.error instanceof Error ? result.error.message : ""
    }`;
    emitCommandOutput(result, installEnv);
    if (!result.error && result.status === 0) return;
    if (attempt >= attempts || !isRetryableBunInstallFailure(lastOutput)) {
      break;
    }
    if (intervalMs > 0) await wait(intervalMs);
  }
  if (lastResult?.error) throw lastResult.error;
  const error = new Error(`Command failed: ${command}`);
  error.status = lastResult?.status;
  error.signal = lastResult?.signal;
  throw error;
}

function isBunInstallCommand(command) {
  return command.includes("'bun' 'install'");
}

function bunInstallCommandEnv(env, attempt) {
  const cacheRoot =
    env.TAKOS_RELEASE_BUN_INSTALL_CACHE_DIR?.trim() ||
    resolve(".takos-release-cache", "bun-install");
  const tmpRoot =
    env.TAKOS_RELEASE_BUN_TMPDIR?.trim() ||
    resolve(".takos-release-cache", "tmp");
  const cacheDir = resolve(cacheRoot, `attempt-${attempt}`);
  const tmpDir = resolve(tmpRoot, `attempt-${attempt}`);
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });
  return {
    ...env,
    BUN_INSTALL_CACHE_DIR: cacheDir,
    TMPDIR: tmpDir,
  };
}

export function isRetryableBunInstallFailure(output) {
  return /Fail extracting tarball|failed extracting tarball|tarball|ECONNRESET|EAI_AGAIN|ETIMEDOUT|socket hang up|network connection|HTTP 429|HTTP 5\d\d|temporarily unavailable|unexpected end of file|integrity check/i.test(
    output,
  );
}

function releaseBunInstallAttempts(env) {
  const attempts = integerEnv(
    env,
    "TAKOS_RELEASE_BUN_INSTALL_ATTEMPTS",
    BUN_INSTALL_RETRY_ATTEMPTS,
  );
  return Math.max(1, attempts);
}

function releaseBunInstallRetryIntervalMs(env) {
  return integerEnv(
    env,
    "TAKOS_RELEASE_BUN_INSTALL_RETRY_INTERVAL_MS",
    BUN_INSTALL_RETRY_INTERVAL_MS,
  );
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
  const workerName = requireStringOutput(outputs, "service_runtime_name");
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
    const workerName = requireStringOutput(outputs, "service_runtime_name");
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

const RELEASE_CONTAINER_APPLICATIONS = [
  ["TakosRuntimeContainer", "runtime"],
  ["ExecutorContainerTier1", "executor-tier1"],
  ["ExecutorContainerTier2", "executor-tier2"],
  ["ExecutorContainerTier3", "executor-tier3"],
];

/**
 * Wait until Cloudflare's asynchronous Container rollout has materialized every
 * prebuilt image selected by the reviewed release manifest. The account-level
 * list response can retain an older summary image after the application detail
 * has advanced, so convergence is proved from each application's configuration
 * plus the versions of any live instances.
 */
export async function waitForReleaseContainerImages(
  outputs,
  environment,
  env = process.env,
) {
  if (env.TAKOS_WRANGLER_CONTAINERS_ROLLOUT?.trim() === "none") {
    return { skipped: true, reason: "container_rollout_disabled" };
  }

  const images = normalizeReleaseContainerImages(
    env.TAKOS_RELEASE_CONTAINER_IMAGES_JSON,
  );
  const workerName = requireStringOutput(outputs, "service_runtime_name");
  const expected = RELEASE_CONTAINER_APPLICATIONS.flatMap(
    ([className, suffix]) => {
      const image = images[className];
      return image
        ? [{ className, name: `${workerName}-${suffix}`, image }]
        : [];
    },
  );
  if (expected.length === 0) {
    return { skipped: true, reason: "no_prebuilt_container_images" };
  }

  const listCommand = commandLine([
    "bunx",
    "wrangler",
    "containers",
    "list",
    "--config",
    releaseWranglerConfigPath(environment),
    ...wranglerEnvironmentArgs(environment),
    "--json",
  ]);
  const attempts = Math.max(
    1,
    integerEnv(
      env,
      "TAKOS_RELEASE_CONTAINER_API_ATTEMPTS",
      RELEASE_CONTAINER_API_ATTEMPTS,
    ),
  );
  const intervalMs = integerEnv(
    env,
    "TAKOS_RELEASE_CONTAINER_API_INTERVAL_MS",
    RELEASE_CONTAINER_API_INTERVAL_MS,
  );
  let lastProblem = "container applications were not listed";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = runShellCommand(listCommand, env);
    if (!result.error && result.status === 0) {
      const parsed = parseWranglerJsonOutput(result.stdout ?? "");
      if (parsed.ok && Array.isArray(parsed.value)) {
        const applications = new Map(
          parsed.value
            .filter((entry) => entry && typeof entry === "object")
            .map((entry) => [entry.name, entry]),
        );
        const pending = [];
        for (const entry of expected) {
          const summary = applications.get(entry.name);
          const applicationId =
            typeof summary?.id === "string" ? summary.id : undefined;
          if (!applicationId) {
            pending.push(`${entry.name}: application is missing`);
            continue;
          }

          const infoResult = runShellCommand(
            commandLine([
              "bunx",
              "wrangler",
              "containers",
              "info",
              applicationId,
              "--config",
              releaseWranglerConfigPath(environment),
              ...wranglerEnvironmentArgs(environment),
            ]),
            env,
          );
          if (infoResult.error || infoResult.status !== 0) {
            pending.push(
              `${entry.name}: container info failed (${boundedCommandLog(
                `${infoResult.stdout ?? ""}\n${infoResult.stderr ?? ""}`.trim() ||
                  infoResult.error?.message ||
                  `exit ${infoResult.status ?? "unknown"}`,
                env,
              )})`,
            );
            continue;
          }
          const info = parseWranglerJsonOutput(infoResult.stdout ?? "");
          if (!info.ok || !info.value || typeof info.value !== "object") {
            pending.push(
              `${entry.name}: invalid container info (${info.ok ? "non-object JSON" : info.error})`,
            );
            continue;
          }
          const application = info.value;
          const actualImage = application.configuration?.image;
          const applicationVersion = application.version;
          const healthErrors = application.health?.errors;
          const failedInstances = application.health?.instances?.failed;
          if (actualImage !== entry.image) {
            pending.push(
              `${entry.name}: expected ${entry.image}, got ${actualImage ?? "missing"}`,
            );
            continue;
          }
          if (
            (Array.isArray(healthErrors) && healthErrors.length > 0) ||
            (typeof failedInstances === "number" && failedInstances > 0)
          ) {
            pending.push(`${entry.name}: application health reports a failure`);
            continue;
          }

          const instancesResult = runShellCommand(
            commandLine([
              "bunx",
              "wrangler",
              "containers",
              "instances",
              applicationId,
              "--config",
              releaseWranglerConfigPath(environment),
              ...wranglerEnvironmentArgs(environment),
              "--json",
            ]),
            env,
          );
          if (instancesResult.error || instancesResult.status !== 0) {
            pending.push(
              `${entry.name}: container instances failed (${boundedCommandLog(
                `${instancesResult.stdout ?? ""}\n${instancesResult.stderr ?? ""}`.trim() ||
                  instancesResult.error?.message ||
                  `exit ${instancesResult.status ?? "unknown"}`,
                env,
              )})`,
            );
            continue;
          }
          const instances = parseWranglerJsonOutput(
            instancesResult.stdout ?? "",
          );
          if (!instances.ok || !Array.isArray(instances.value)) {
            pending.push(
              `${entry.name}: invalid container instances (${instances.ok ? "non-array JSON" : instances.error})`,
            );
            continue;
          }
          const staleLiveInstances = instances.value.filter((instance) => {
            if (!instance || typeof instance !== "object") return true;
            const state =
              typeof instance.state === "string"
                ? instance.state.toLowerCase()
                : "";
            if (state === "inactive" || state === "stopped") return false;
            return (
              typeof applicationVersion !== "number" ||
              instance.version !== applicationVersion
            );
          });
          if (staleLiveInstances.length > 0) {
            pending.push(
              `${entry.name}: ${staleLiveInstances.length} live instance(s) have not reached application version ${
                typeof applicationVersion === "number"
                  ? applicationVersion
                  : "unknown"
              }`,
            );
          }
        }
        if (pending.length === 0) {
          console.log(
            `Verified ${expected.length} release container image(s) for ${workerName}.`,
          );
          return { skipped: false, containers: expected };
        }
        lastProblem = pending.join("; ");
      } else {
        lastProblem = parsed.ok
          ? "wrangler containers list returned a non-array JSON value"
          : parsed.error;
      }
    } else {
      lastProblem =
        `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim() ||
        result.error?.message ||
        `wrangler containers list exited ${result.status ?? "unknown"}`;
    }

    if (attempt < attempts && intervalMs > 0) await wait(intervalMs);
  }

  throw new Error(
    `Container rollout for ${workerName} did not converge after ${attempts} attempt(s): ${boundedCommandLog(
      lastProblem,
      env,
    )}`,
  );
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
  const managedAccountId = takosumiManagedCloudflareAccountId(outputs, env);
  if (managedAccountId) {
    const apiBase = releaseCloudflareApiBaseUrl(outputs, env);
    const apiToken = releaseApiToken(env);
    return {
      ...cloudflareCompatEnv(env, apiBase),
      CI: env.CI ?? "true",
      WRANGLER_SEND_METRICS: env.WRANGLER_SEND_METRICS ?? "false",
      TAKOS_CLOUDFLARE_TARGET_MODE: "managed_compat",
      ...(apiToken
        ? {
            CLOUDFLARE_API_TOKEN: apiToken,
            CF_API_TOKEN: apiToken,
          }
        : {}),
      CLOUDFLARE_ACCOUNT_ID: managedAccountId,
      CF_ACCOUNT_ID: managedAccountId,
    };
  }
  const wranglerAccountId = releaseWranglerAccountId(outputs, env);
  const apiToken = wranglerNativeApiToken(env);
  const nativeEnv = cloudflareNativeEnv(env);
  return {
    ...nativeEnv,
    CI: env.CI ?? "true",
    WRANGLER_SEND_METRICS: env.WRANGLER_SEND_METRICS ?? "false",
    ...(apiToken
      ? {
          CLOUDFLARE_API_TOKEN: apiToken,
          CF_API_TOKEN: env.CF_API_TOKEN ?? apiToken,
        }
      : {}),
    ...(wranglerAccountId
      ? {
          TAKOS_CLOUDFLARE_WRANGLER_ACCOUNT_ID: wranglerAccountId,
          CLOUDFLARE_ACCOUNT_ID: wranglerAccountId,
          CF_ACCOUNT_ID: wranglerAccountId,
        }
      : {}),
  };
}

function wranglerNativeApiToken(env = process.env) {
  return (
    stringValue(env.TAKOS_CLOUDFLARE_WRANGLER_DEPLOY_API_TOKEN) ??
    stringValue(env.CLOUDFLARE_CONTAINERS_API_TOKEN) ??
    stringValue(env.CLOUDFLARE_API_TOKEN) ??
    stringValue(env.CF_API_TOKEN)
  );
}

export function wranglerDeployEnv(env = process.env) {
  const deployToken = wranglerDeployToken(env);
  const next =
    env.TAKOS_CLOUDFLARE_TARGET_MODE === "managed_compat"
      ? cloudflareCompatEnv(env, customCloudflareApiBaseUrl(env))
      : cloudflareNativeEnv(env);
  if (!deployToken) return next;
  return {
    ...next,
    CLOUDFLARE_API_TOKEN: deployToken,
    CF_API_TOKEN: deployToken,
  };
}

// Durable Object migrations are the fresh Worker artifact lifecycle source of
// truth. Once a Worker already exists, Wrangler must not replay bootstrap
// `new_classes` / `new_sqlite_classes` migrations for classes Cloudflare has
// already materialized. The release command therefore probes the target Worker
// after rendering and strips only the deploy-time migration blocks for existing
// Workers. The checked-in wrangler.toml and OpenTofu module remain the source of
// truth for first deploys.
export function removeExistingWorkerMigrationsFromToml(toml, environment) {
  if (environment !== "production") {
    return { toml, removed: 0 };
  }
  const lines = toml.split("\n");
  const output = [];
  let removed = 0;
  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? "";
    if (/^\s*\[env\.[^\]]+\]\s*$/u.test(line)) {
      output.push(...lines.slice(index));
      break;
    }
    if (/^\s*\[\[migrations\]\]\s*$/u.test(line)) {
      removed += 1;
      index += 1;
      while (index < lines.length && !/^\s*\[/.test(lines[index] ?? "")) {
        index += 1;
      }
      continue;
    }
    output.push(line);
    index += 1;
  }
  return { toml: output.join("\n"), removed };
}

export function removeWranglerDurableObjectLifecycleFromToml(toml) {
  const routeStripped = stripGeneratedPublicRouteBlocks(toml);
  const lines = routeStripped.toml.split("\n");
  const output = [];
  let removedMigrations = 0;
  let removedExports = 0;
  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? "";
    if (/^\s*\[\[migrations\]\]\s*$/u.test(line)) {
      removedMigrations += 1;
      index += 1;
      while (index < lines.length && !/^\s*\[/.test(lines[index] ?? "")) {
        index += 1;
      }
      continue;
    }
    if (/^\s*\[exports\.[^\]]+\]\s*$/u.test(line)) {
      removedExports += 1;
      index += 1;
      while (index < lines.length && !/^\s*\[/.test(lines[index] ?? "")) {
        index += 1;
      }
      continue;
    }
    output.push(line);
    index += 1;
  }
  return {
    toml: output.join("\n"),
    removedMigrations,
    removedExports,
    removedRoutes: routeStripped.removedRoutes,
  };
}

function stripGeneratedPublicRouteBlocks(toml) {
  let removedRoutes = 0;
  const pattern = new RegExp(
    `\\n?${escapeRegExp(GENERATED_PUBLIC_ROUTE_BEGIN)}[\\s\\S]*?${escapeRegExp(
      GENERATED_PUBLIC_ROUTE_END,
    )}\\n?`,
    "gu",
  );
  return {
    toml: toml.replace(pattern, () => {
      removedRoutes += 1;
      return "\n";
    }),
    removedRoutes,
  };
}

export function removeWranglerQueueConsumerTriggersFromToml(toml) {
  const lines = toml.split("\n");
  const output = [];
  let removed = 0;
  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? "";
    if (
      /^\s*\[\[(?:env\.[A-Za-z0-9_-]+\.)?queues\.consumers\]\]\s*$/u.test(line)
    ) {
      removed += 1;
      index += 1;
      while (index < lines.length && !/^\s*\[/.test(lines[index] ?? "")) {
        index += 1;
      }
      continue;
    }
    output.push(line);
    index += 1;
  }
  return { toml: output.join("\n"), removed };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function writeD1MigrationsWranglerConfig(environment) {
  const sourcePath = releaseWranglerConfigPath(environment);
  const d1Path = releaseD1MigrationsWranglerConfigPath(environment);
  const source = readFileSync(sourcePath, "utf8");
  const result = removeWranglerDurableObjectLifecycleFromToml(source);
  writeFileSync(d1Path, result.toml);
  console.log(
    `Wrote D1 migrations wrangler config ${d1Path} without ${result.removedMigrations} Durable Object migration block(s), ${result.removedExports} export block(s), and ${result.removedRoutes} generated route block(s).`,
  );
  return { path: d1Path, ...result };
}

export function pruneWranglerQueueConsumersForRelease(environment) {
  const path = releaseWranglerConfigPath(environment);
  const source = readFileSync(path, "utf8");
  const result = removeWranglerQueueConsumerTriggersFromToml(source);
  if (result.removed === 0) {
    return { skipped: true, reason: "no_queue_consumers" };
  }
  writeFileSync(path, result.toml);
  console.log(
    `Pruned ${result.removed} Queue consumer trigger block(s) from ${path}; release activation reconciles them after Worker deploy.`,
  );
  return { skipped: false, removed: result.removed };
}

export async function pruneWranglerMigrationsForExistingWorker(
  outputs,
  environment,
  env = process.env,
  fetchImpl = globalThis.fetch,
) {
  const workerName = requireStringOutput(outputs, "service_runtime_name");
  const accountId = releaseCloudflareApiAccountId(outputs, env);
  const apiToken = wranglerDeployToken(env) ?? releaseApiToken(env);
  if (!accountId || !apiToken) {
    return { skipped: true, reason: "cloudflare_api_unavailable" };
  }
  const endpoint =
    `${releaseCloudflareApiBaseUrl(outputs, env)}/accounts/${encodeURIComponent(accountId)}` +
    `/workers/scripts/${encodeURIComponent(workerName)}`;
  const response = await fetchImpl(endpoint, {
    method: "GET",
    headers: { authorization: `Bearer ${apiToken}` },
  });
  if (response.status === 404) {
    return { skipped: true, reason: "worker_not_found", status: 404 };
  }
  if (!response.ok) {
    return {
      skipped: true,
      reason: "worker_probe_failed",
      status: response.status,
    };
  }
  const path = releaseWranglerConfigPath(environment);
  const current = readFileSync(path, "utf8");
  const result = removeExistingWorkerMigrationsFromToml(current, environment);
  if (result.removed === 0) {
    return { skipped: true, reason: "no_migrations", status: response.status };
  }
  writeFileSync(path, result.toml);
  console.log(
    `Pruned ${result.removed} Durable Object migration block(s) from ${path} for existing Worker ${workerName}.`,
  );
  return {
    skipped: false,
    status: response.status,
    removed: result.removed,
  };
}

function wranglerDeployToken(env = process.env) {
  const explicit = stringValue(env.TAKOS_CLOUDFLARE_WRANGLER_DEPLOY_API_TOKEN);
  if (explicit) return explicit;
  const providerToken =
    stringValue(env.CLOUDFLARE_API_TOKEN) ?? stringValue(env.CF_API_TOKEN);
  return providerToken ?? stringValue(env.CLOUDFLARE_CONTAINERS_API_TOKEN);
}

export async function preflightWranglerDeployAuth(
  outputs,
  env = process.env,
  fetchImpl = globalThis.fetch,
) {
  const deployToken = wranglerDeployToken(env);
  if (!deployToken) {
    return { skipped: true, reason: "deploy_token_not_configured" };
  }
  const workerName = requireStringOutput(outputs, "service_runtime_name");
  const accountId = releaseCloudflareApiAccountId(outputs, env);
  if (!accountId) {
    return { skipped: true, reason: "account_id_unavailable" };
  }
  const apiBase = releaseCloudflareApiBaseUrl(outputs, env);
  const checks = [
    ...wranglerDeployAuthChecks(accountId, workerName),
    ...wranglerDeployOutputAuthChecks(accountId, outputs),
  ];
  const results = [];
  for (const check of checks) {
    results.push(
      await preflightCloudflareApiAccess(
        check,
        env,
        deployToken,
        fetchImpl,
        apiBase,
      ),
    );
  }
  const failed = results.filter((result) => result.authenticated === false);
  if (failed.length > 0) {
    throw new Error(
      `Wrangler deploy token cannot access required Cloudflare resource APIs: ${failed
        .map((result) => result.name)
        .join(", ")}. ` +
        "Use TAKOS_CLOUDFLARE_WRANGLER_DEPLOY_API_TOKEN, or replace " +
        "CLOUDFLARE_CONTAINERS_API_TOKEN, with a single Cloudflare API token " +
        "that can deploy Workers scripts/assets, read/update KV, R2, D1, Queues, " +
        "Vectorize, and roll out Cloudflare Containers.",
    );
  }
  return {
    skipped: false,
    checks: results.map((result) => ({
      name: result.name,
      status: result.status,
      success: result.success,
    })),
  };
}

function wranglerDeployAuthChecks(accountId, workerName) {
  const encodedAccountId = encodeURIComponent(accountId);
  return [
    {
      name: "Workers Services",
      path: `/accounts/${encodedAccountId}/workers/services/${encodeURIComponent(workerName)}`,
      authorizedStatuses: new Set([200, 404]),
    },
    {
      name: "R2 Buckets",
      path: `/accounts/${encodedAccountId}/r2/buckets`,
      authorizedStatuses: new Set([200]),
    },
    {
      name: "D1 Databases",
      path: `/accounts/${encodedAccountId}/d1/database`,
      authorizedStatuses: new Set([200]),
    },
    {
      name: "KV Namespaces",
      path: `/accounts/${encodedAccountId}/storage/kv/namespaces`,
      authorizedStatuses: new Set([200]),
    },
    {
      name: "Queues",
      path: `/accounts/${encodedAccountId}/queues`,
      authorizedStatuses: new Set([200]),
    },
    {
      name: "Vectorize Indexes",
      path: `/accounts/${encodedAccountId}/vectorize/v2/indexes`,
      authorizedStatuses: new Set([200]),
    },
  ];
}

function wranglerDeployOutputAuthChecks(accountId, outputs) {
  const encodedAccountId = encodeURIComponent(accountId);
  const bucketMap = optionalObjectOutput(outputs, "object_buckets");
  const seenBuckets = new Set();
  const checks = [];
  for (const [key, value] of Object.entries(bucketMap ?? {})) {
    if (typeof value !== "string" || value.trim() === "") continue;
    const bucket = value.trim();
    if (seenBuckets.has(bucket)) continue;
    seenBuckets.add(bucket);
    checks.push({
      name: `R2 Bucket ${key}`,
      path:
        `/accounts/${encodedAccountId}/r2/buckets/` +
        encodeURIComponent(bucket),
      authorizedStatuses: new Set([200]),
    });
  }
  return checks;
}

async function preflightCloudflareApiAccess(
  check,
  env,
  apiToken,
  fetchImpl,
  apiBase = CLOUDFLARE_API_BASE,
) {
  const response = await fetchImpl(`${apiBase}${check.path}`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${apiToken}`,
      accept: "application/json",
    },
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { success: false, errors: [{ message: text }] };
  }
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  const hasAuthError = errors.some((error) => {
    const code = typeof error?.code === "number" ? error.code : undefined;
    const message = typeof error?.message === "string" ? error.message : "";
    return code === 10000 || /authentication error/i.test(message);
  });
  return {
    name: check.name,
    status: response.status,
    success: payload?.success === true,
    authenticated:
      check.authorizedStatuses.has(response.status) && !hasAuthError,
  };
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function customCloudflareApiBaseUrl(env = process.env) {
  return (
    stringValue(env.TAKOS_CLOUDFLARE_API_BASE_URL) ??
    stringValue(env.CLOUDFLARE_API_BASE_URL) ??
    stringValue(env.CF_API_BASE_URL) ??
    stringValue(env.CLOUDFLARE_BASE_URL)
  );
}

function normalizeCloudflareApiBaseUrl(value) {
  return value.replace(/\/+$/u, "");
}

function releaseCloudflareApiBaseUrl(outputs, env = process.env) {
  if (!isTakosumiManagedCloudflareTarget(outputs, env)) {
    return CLOUDFLARE_API_BASE;
  }
  const custom = customCloudflareApiBaseUrl(env);
  if (!custom) {
    throw new Error(
      "Takosumi managed Cloudflare targets require TAKOS_CLOUDFLARE_API_BASE_URL or CLOUDFLARE_API_BASE_URL so release helpers use the compatibility API.",
    );
  }
  return normalizeCloudflareApiBaseUrl(custom);
}

function cloudflareNativeEnv(env = process.env) {
  const nativeEnv = { ...env };
  delete nativeEnv.TAKOS_CLOUDFLARE_API_BASE_URL;
  delete nativeEnv.CLOUDFLARE_API_BASE_URL;
  delete nativeEnv.CF_API_BASE_URL;
  delete nativeEnv.CLOUDFLARE_BASE_URL;
  delete nativeEnv.TAKOS_CLOUDFLARE_TARGET_MODE;
  return nativeEnv;
}

function cloudflareCompatEnv(env = process.env, apiBase) {
  const compatEnv = { ...env };
  const normalizedApiBase = apiBase
    ? normalizeCloudflareApiBaseUrl(apiBase)
    : customCloudflareApiBaseUrl(env);
  delete compatEnv.TAKOS_CLOUDFLARE_WRANGLER_ACCOUNT_ID;
  delete compatEnv.TAKOS_CLOUDFLARE_REAL_ACCOUNT_ID;
  delete compatEnv.TAKOSUMI_CLOUDFLARE_ACCOUNT_ID;
  if (normalizedApiBase) {
    compatEnv.TAKOS_CLOUDFLARE_API_BASE_URL = normalizedApiBase;
    compatEnv.CLOUDFLARE_API_BASE_URL = normalizedApiBase;
    compatEnv.CF_API_BASE_URL = normalizedApiBase;
    compatEnv.CLOUDFLARE_BASE_URL = normalizedApiBase;
  }
  return compatEnv;
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
  const workerName = requireStringOutput(outputs, "service_runtime_name");
  const accountId = releaseCloudflareApiAccountId(outputs, env);
  const apiToken = env.CF_API_TOKEN ?? env.CLOUDFLARE_API_TOKEN;
  if (typeof apiToken !== "string" || apiToken.trim() === "") {
    console.warn(
      `Skipped workers.dev API enablement for ${workerName}: CF_API_TOKEN or CLOUDFLARE_API_TOKEN is not available.`,
    );
    return { skipped: true, reason: "api_token_unavailable" };
  }

  const url = `${releaseCloudflareApiBaseUrl(outputs, env)}/accounts/${encodeURIComponent(
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

function cloudflareZoneNameCandidates(hostname) {
  const labels = hostname.toLowerCase().split(".").filter(Boolean);
  return labels.length < 2
    ? []
    : labels.slice(0, -1).map((_, index) => labels.slice(index).join("."));
}

/** Reconciles the public route emitted by the OpenTofu module after a managed
 * compatibility upload. Native Wrangler deploys reconcile `routes` directly;
 * the managed upload path must perform the equivalent standard Cloudflare API
 * calls because it uploads an already-built Worker bundle. */
export async function ensureManagedCompatPublicRoute(
  outputs,
  env = process.env,
  fetchImpl = globalThis.fetch,
) {
  if (env.TAKOS_CLOUDFLARE_TARGET_MODE !== "managed_compat") {
    return { skipped: true, reason: "not_managed_compat" };
  }
  const launchUrl = releaseLaunchUrl(outputs);
  if (!launchUrl) return { skipped: true, reason: "no_launch_url" };
  const parsed = new URL(launchUrl);
  if (parsed.hostname.endsWith(".workers.dev")) {
    return { skipped: true, reason: "workers_dev_url" };
  }
  const apiToken = releaseApiToken(env) ?? wranglerDeployToken(env);
  if (!apiToken) {
    throw new Error(
      "Managed public route sync requires a Cloudflare API token.",
    );
  }
  const apiBase = releaseCloudflareApiBaseUrl(outputs, env);
  const headers = {
    authorization: `Bearer ${apiToken}`,
    accept: "application/json",
  };
  let zone;
  for (const candidate of cloudflareZoneNameCandidates(parsed.hostname)) {
    const response = await fetchImpl(
      `${apiBase}/zones?name=${encodeURIComponent(candidate)}`,
      { headers },
    );
    const payload = await cloudflareApiPayload(response);
    if (!response.ok || payload?.success === false) {
      throw new Error(
        `Managed public route zone discovery failed: HTTP ${response.status} ${JSON.stringify(payload?.errors ?? payload)}`,
      );
    }
    zone = Array.isArray(payload?.result)
      ? payload.result.find((entry) => entry?.id && entry?.name === candidate)
      : undefined;
    if (zone) break;
  }
  if (!zone?.id) {
    throw new Error(
      `Managed public route zone was not found for ${parsed.hostname}.`,
    );
  }
  const workerName = requireStringOutput(outputs, "service_runtime_name");
  const pattern = `${parsed.hostname}/*`;
  const response = await fetchImpl(
    `${apiBase}/zones/${encodeURIComponent(zone.id)}/workers/routes`,
    {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ pattern, script: workerName }),
    },
  );
  const payload = await cloudflareApiPayload(response);
  if (!response.ok || payload?.success === false) {
    throw new Error(
      `Managed public route sync failed: HTTP ${response.status} ${JSON.stringify(payload?.errors ?? payload)}`,
    );
  }
  console.log(`Reconciled managed public route ${pattern} -> ${workerName}.`);
  return { skipped: false, pattern, workerName, result: payload?.result };
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
  const workerName = requireStringOutput(outputs, "service_runtime_name");
  const accountId = releaseCloudflareApiAccountId(outputs, env);
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
    apiBase: releaseCloudflareApiBaseUrl(outputs, env),
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

export async function deployManagedCompatWorker(
  outputs,
  environment,
  env = process.env,
  fetchImpl = globalThis.fetch,
) {
  const workerName = requireStringOutput(outputs, "service_runtime_name");
  const accountId = releaseCloudflareApiAccountId(outputs, env);
  const apiToken = releaseApiToken(env) ?? wranglerDeployToken(env);
  if (!apiToken) {
    throw new Error(
      "Takosumi managed Worker upload requires CLOUDFLARE_API_TOKEN or CF_API_TOKEN for the compatibility API.",
    );
  }

  const apiBase = releaseCloudflareApiBaseUrl(outputs, env);
  const configPath = releaseWranglerConfigPath(environment);
  const bundlePath = join(releaseWranglerBundleDir(environment), "index.js");
  if (!existsSync(bundlePath)) {
    throw new Error(
      `Wrangler dry-run bundle was not found at ${bundlePath}; run the managed compat bundle step before upload.`,
    );
  }

  const targetConfig = readReleaseWranglerTargetConfig(environment);
  const secrets = readManagedCompatReleaseSecrets(environment);
  const assets = await uploadManagedCompatAssets({
    accountId,
    workerName,
    apiBase,
    apiToken,
    configPath,
    targetConfig,
    assetManifestPath: env.TAKOS_RELEASE_ASSET_MANIFEST_PATH,
    fetchImpl,
  });
  const metadata = managedCompatWorkerUploadMetadata(targetConfig, {
    mainModule: "index.js",
    assets,
    secrets,
  });
  const form = new FormData();
  form.set(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" }),
  );
  form.set(
    "index.js",
    new Blob([readFileSync(bundlePath)], {
      type: "application/javascript+module",
    }),
    "index.js",
  );
  const response = await fetchImpl(
    `${apiBase}/accounts/${encodeURIComponent(
      accountId,
    )}/workers/scripts/${encodeURIComponent(workerName)}`,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${apiToken}`,
      },
      body: form,
    },
  );
  const payload = await cloudflareApiPayload(response);
  if (!response.ok || payload?.success === false) {
    throw new Error(
      `Takosumi managed Worker upload failed for ${workerName}: HTTP ${response.status} ${JSON.stringify(
        payload?.errors ?? payload,
      )}`,
    );
  }
  console.log(
    `Uploaded Takos Worker ${workerName} through Takosumi Cloud compatibility API.`,
  );
  return {
    workerName,
    status: response.status,
    result: payload?.result,
    assets:
      assets?.jwt && assets.manifestEntryCount > 0
        ? {
            uploaded: assets.uploadedCount,
            manifestEntries: assets.manifestEntryCount,
          }
        : undefined,
  };
}

function readReleaseWranglerTargetConfig(environment) {
  const parsed = Bun.TOML.parse(
    readFileSync(releaseWranglerConfigPath(environment), "utf8"),
  );
  return wranglerTargetConfig(parsed, environment);
}

function wranglerTargetConfig(parsed, environment) {
  if (environment === "production") return parsed;
  const envConfig = parsed?.env?.[environment];
  if (!envConfig || typeof envConfig !== "object" || Array.isArray(envConfig)) {
    throw new Error(`wrangler config is missing [env.${environment}]`);
  }
  return {
    ...parsed,
    ...envConfig,
    vars: {
      ...(isPlainObject(parsed.vars) ? parsed.vars : {}),
      ...(isPlainObject(envConfig.vars) ? envConfig.vars : {}),
    },
    durable_objects: {
      ...(isPlainObject(parsed.durable_objects) ? parsed.durable_objects : {}),
      ...(isPlainObject(envConfig.durable_objects)
        ? envConfig.durable_objects
        : {}),
      bindings:
        envConfig.durable_objects?.bindings ??
        parsed.durable_objects?.bindings ??
        [],
    },
    queues: {
      ...(isPlainObject(parsed.queues) ? parsed.queues : {}),
      ...(isPlainObject(envConfig.queues) ? envConfig.queues : {}),
      producers: envConfig.queues?.producers ?? parsed.queues?.producers ?? [],
      consumers: envConfig.queues?.consumers ?? parsed.queues?.consumers ?? [],
    },
    migrations: envConfig.migrations ?? parsed.migrations ?? [],
    assets: envConfig.assets ?? parsed.assets,
    observability: envConfig.observability ?? parsed.observability,
  };
}

function managedCompatWorkerUploadMetadata(
  targetConfig,
  { mainModule, assets, secrets },
) {
  return dropUndefined({
    main_module: mainModule,
    bindings: wranglerMetadataBindings(targetConfig, secrets),
    containers: Array.isArray(targetConfig.containers)
      ? targetConfig.containers.map((container) => ({
          class_name: container.class_name,
        }))
      : undefined,
    compatibility_date: targetConfig.compatibility_date,
    compatibility_flags: targetConfig.compatibility_flags,
    migrations: wranglerMigrationsMetadata(targetConfig.migrations),
    assets: assets?.jwt
      ? {
          jwt: assets.jwt,
          config: managedCompatAssetsConfig(targetConfig.assets),
        }
      : undefined,
    observability: targetConfig.observability,
    placement: targetConfig.placement,
    limits: targetConfig.limits,
  });
}

function readManagedCompatReleaseSecrets(environment) {
  const path = resolve(releaseSecretsFilePath(environment));
  if (!existsSync(path)) {
    throw new Error(
      `Takosumi managed Worker upload requires the generated release secrets file at ${path}.`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(
      `Takosumi managed Worker release secrets file is not valid JSON: ${path}`,
    );
  }
  if (!isPlainObject(parsed) || Object.keys(parsed).length === 0) {
    throw new Error(
      `Takosumi managed Worker release secrets file must be a non-empty JSON object: ${path}`,
    );
  }
  for (const [name, value] of Object.entries(parsed)) {
    if (!/^[A-Z][A-Z0-9_]*$/u.test(name)) {
      throw new Error(
        `Takosumi managed Worker release secret has an invalid binding name: ${name}`,
      );
    }
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(
        `Takosumi managed Worker release secret ${name} must be a non-empty string.`,
      );
    }
  }
  return parsed;
}

function wranglerMetadataBindings(targetConfig, secrets = {}) {
  const bindings = [];
  const secretNames = new Set(Object.keys(secrets));
  for (const [name, value] of Object.entries(
    isPlainObject(targetConfig.vars) ? targetConfig.vars : {},
  )) {
    if (secretNames.has(name)) continue;
    bindings.push(
      typeof value === "string"
        ? { name, type: "plain_text", text: value }
        : { name, type: "json", json: value },
    );
  }
  for (const [name, text] of Object.entries(secrets)) {
    bindings.push({ name, type: "secret_text", text });
  }
  for (const binding of arrayValue(targetConfig.kv_namespaces)) {
    bindings.push({
      name: binding.binding,
      type: "kv_namespace",
      namespace_id: binding.id,
    });
  }
  for (const binding of arrayValue(targetConfig.durable_objects?.bindings)) {
    bindings.push(
      dropUndefined({
        name: binding.name,
        type: "durable_object_namespace",
        class_name: binding.class_name,
        script_name: binding.script_name,
        environment: binding.environment,
      }),
    );
  }
  for (const binding of arrayValue(targetConfig.queues?.producers)) {
    bindings.push(
      dropUndefined({
        name: binding.binding,
        type: "queue",
        queue_name: binding.queue,
        delivery_delay: binding.delivery_delay,
      }),
    );
  }
  for (const binding of arrayValue(targetConfig.r2_buckets)) {
    bindings.push(
      dropUndefined({
        name: binding.binding,
        type: "r2_bucket",
        bucket_name: binding.bucket_name,
        jurisdiction: binding.jurisdiction,
      }),
    );
  }
  for (const binding of arrayValue(targetConfig.d1_databases)) {
    bindings.push(
      dropUndefined({
        name: binding.binding,
        type: "d1",
        id: binding.database_id,
        internalEnv: binding.database_internal_env,
      }),
    );
  }
  for (const binding of arrayValue(targetConfig.vectorize)) {
    bindings.push({
      name: binding.binding,
      type: "vectorize",
      index_name: binding.index_name,
    });
  }
  for (const binding of arrayValue(targetConfig.services)) {
    bindings.push(
      dropUndefined({
        name: binding.binding,
        type: "service",
        service: binding.service,
        environment: binding.environment,
        entrypoint: binding.entrypoint,
        props: binding.props,
      }),
    );
  }
  if (targetConfig.ai?.binding) {
    bindings.push(
      dropUndefined({
        name: targetConfig.ai.binding,
        type: "ai",
        staging: targetConfig.ai.staging,
        raw: targetConfig.ai.raw,
      }),
    );
  }
  if (targetConfig.assets?.binding) {
    bindings.push({ name: targetConfig.assets.binding, type: "assets" });
  }
  return bindings.filter((binding) => binding.name);
}

function wranglerMigrationsMetadata(migrations) {
  const entries = arrayValue(migrations);
  if (entries.length === 0) return undefined;
  const last = entries.at(-1);
  if (!last?.tag) return undefined;
  return {
    new_tag: last.tag,
    steps: entries.map(({ tag: _tag, ...step }) => step),
  };
}

async function uploadManagedCompatAssets({
  accountId,
  workerName,
  apiBase,
  apiToken,
  configPath,
  targetConfig,
  assetManifestPath,
  fetchImpl,
}) {
  const assetsConfig = targetConfig.assets;
  const directory = stringValue(assetsConfig?.directory);
  if (!directory) return undefined;
  const assetDirectory = resolve(dirname(configPath), directory);
  if (!existsSync(assetDirectory)) return undefined;
  const manifest = buildManagedCompatAssetManifest(
    assetDirectory,
    assetManifestPath,
  );
  const sessionResponse = await fetchImpl(
    `${apiBase}/accounts/${encodeURIComponent(
      accountId,
    )}/workers/scripts/${encodeURIComponent(workerName)}/assets-upload-session`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ manifest }),
    },
  );
  const session = cloudflareResult(await cloudflareApiPayload(sessionResponse));
  if (!sessionResponse.ok || !session?.jwt) {
    throw new Error(
      `Takosumi managed assets upload session failed for ${workerName}: HTTP ${sessionResponse.status} ${JSON.stringify(
        session,
      )}`,
    );
  }
  const uploadBuckets = arrayValue(session.buckets)
    .map((bucket) => arrayValue(bucket))
    .filter((bucket) => bucket.length > 0);
  const filesToUpload = uploadBuckets.flat();
  const manifestByHash = new Map(
    Object.entries(manifest).map(([path, entry]) => [
      entry.hash,
      { path, entry },
    ]),
  );
  let completionJwt = filesToUpload.length === 0 ? session.jwt : undefined;
  let uploadedCount = 0;
  if (filesToUpload.length > 0) {
    if (isSingleAssetUploadMode(session.jwt)) {
      for (const [index, hash] of filesToUpload.entries()) {
        const manifestEntry = manifestByHash.get(hash);
        if (!manifestEntry) {
          throw new Error(`Assets upload requested unknown hash ${hash}`);
        }
        const filePath = join(assetDirectory, manifestEntry.path.slice(1));
        const response = await fetchImpl(
          `${apiBase}/accounts/${encodeURIComponent(
            accountId,
          )}/workers/assets/upload/${encodeURIComponent(hash)}`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${apiToken}`,
              [ASSET_UPLOAD_AUTHORIZATION_HEADER]: `Bearer ${session.jwt}`,
              "content-type": contentTypeForPath(filePath),
            },
            body: readFileSync(filePath),
          },
        );
        const payload = cloudflareResult(await cloudflareApiPayload(response));
        const finalUpload = index === filesToUpload.length - 1;
        if (
          !response.ok ||
          (!payload?.jwt && (finalUpload || response.status !== 202))
        ) {
          throw new Error(
            `Takosumi managed asset upload failed for ${hash}: HTTP ${response.status} ${JSON.stringify(
              payload,
            )}`,
          );
        }
        if (payload?.jwt) completionJwt = payload.jwt;
        uploadedCount += 1;
      }
    } else {
      for (const [index, bucket] of uploadBuckets.entries()) {
        const form = new FormData();
        for (const hash of arrayValue(bucket)) {
          const manifestEntry = manifestByHash.get(hash);
          if (!manifestEntry) {
            throw new Error(`Assets upload requested unknown hash ${hash}`);
          }
          const filePath = join(assetDirectory, manifestEntry.path.slice(1));
          form.set(
            hash,
            new Blob([readFileSync(filePath).toString("base64")], {
              type: contentTypeForPath(filePath),
            }),
            hash,
          );
          uploadedCount += 1;
        }
        const response = await fetchImpl(
          `${apiBase}/accounts/${encodeURIComponent(
            accountId,
          )}/workers/assets/upload?base64=true`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${apiToken}`,
              [ASSET_UPLOAD_AUTHORIZATION_HEADER]: `Bearer ${session.jwt}`,
            },
            body: form,
          },
        );
        const payload = cloudflareResult(await cloudflareApiPayload(response));
        const finalUpload = index === uploadBuckets.length - 1;
        if (
          !response.ok ||
          (!payload?.jwt && (finalUpload || response.status !== 202))
        ) {
          throw new Error(
            `Takosumi managed bulk asset upload failed: HTTP ${response.status} ${JSON.stringify(
              payload,
            )}`,
          );
        }
        if (payload?.jwt) completionJwt = payload.jwt;
      }
    }
  }
  if (!completionJwt) {
    throw new Error(
      `Takosumi managed asset upload completed without a completion JWT for ${workerName}`,
    );
  }
  return {
    jwt: completionJwt,
    uploadedCount,
    manifestEntryCount: Object.keys(manifest).length,
  };
}

function buildManagedCompatAssetManifest(assetDirectory, assetManifestPath) {
  if (typeof assetManifestPath === "string" && assetManifestPath.trim()) {
    const parsed = JSON.parse(readFileSync(assetManifestPath, "utf8"));
    if (!isPlainObject(parsed)) {
      throw new Error("Takos release asset manifest must be an object.");
    }
    return parsed;
  }
  const manifest = {};
  for (const filePath of walkFiles(assetDirectory)) {
    const key = `/${relative(assetDirectory, filePath).split(sep).join("/")}`;
    const stat = statSync(filePath);
    manifest[key] = {
      hash: managedCompatAssetHash(filePath),
      size: stat.size,
    };
  }
  return manifest;
}

function walkFiles(directory) {
  const output = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      output.push(...walkFiles(path));
    } else if (entry.isFile()) {
      output.push(path);
    }
  }
  return output.sort();
}

function managedCompatAssetHash(filePath) {
  const base64Contents = readFileSync(filePath).toString("base64");
  const extension = extname(filePath).slice(1);
  return loadBlake3()
    .hash(base64Contents + extension)
    .toString("hex")
    .slice(0, 32);
}

function loadBlake3() {
  blake3Module ??= require("blake3-wasm");
  return blake3Module;
}

function managedCompatAssetsConfig(assetsConfig) {
  if (!assetsConfig) return undefined;
  return dropUndefined({
    html_handling: assetsConfig.html_handling,
    not_found_handling: assetsConfig.not_found_handling,
    run_worker_first: assetsConfig.run_worker_first,
    _redirects: assetsConfig._redirects,
    _headers: assetsConfig._headers,
  });
}

async function cloudflareApiPayload(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { success: false, errors: [{ message: text }] };
  }
}

function cloudflareResult(payload) {
  return payload?.result ?? payload;
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function dropUndefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

function isSingleAssetUploadMode(jwt) {
  try {
    const payload = JSON.parse(
      Buffer.from(String(jwt).split(".")[1] ?? "", "base64").toString("utf8"),
    );
    return payload?.wrangler_single_asset_uploads === true;
  } catch {
    return false;
  }
}

function contentTypeForPath(filePath) {
  const extension = extname(filePath).toLowerCase();
  switch (extension) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
    case ".map":
      return "application/json";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    case ".txt":
      return "text/plain; charset=utf-8";
    default:
      return "application/null";
  }
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

function cleanupReleaseD1MigrationsWranglerConfig(environment) {
  const path = resolve(releaseD1MigrationsWranglerConfigPath(environment));
  if (!existsSync(path)) return;
  unlinkSync(path);
}

function cleanupReleaseWranglerBundleDir(environment) {
  const path = resolve(releaseWranglerBundleDir(environment));
  if (!existsSync(path)) return;
  rmSync(path, { recursive: true, force: true });
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const { environment, debug, destroy } = parseReleaseArgs(argv);
  const timings = [];
  const releaseStartedAt = Date.now();
  let releaseStatus = "succeeded";
  const outputs = readReleaseOutputs(env);
  const childEnv = releaseChildEnv(outputs, env);
  const workerArtifact = destroy ? undefined : workerReleaseArtifactConfig(env);
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
        if (!workerArtifact) {
          ensureTakosumiSourceModule(takosumiRepoDir, {
            repoUrl: takosumiRepoUrl,
            ref: takosumiRef,
          });
        }
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
          wranglerAccountId: childEnv.TAKOS_CLOUDFLARE_WRANGLER_ACCOUNT_ID,
          workerArtifact: Boolean(workerArtifact),
        });
      })();
  let preparedWorkerArtifact;
  try {
    let releaseEnv = childEnv;
    {
      const commandsToRun = destroy ? commands : commands.slice(0, -1);
      for (const command of commandsToRun) {
        const stepName = releaseCommandStepName(command);
        await timeReleaseStep(timings, stepName, () =>
          destroy
            ? runDestroyCommand(command, releaseEnv)
            : run(command, releaseEnv),
        );
        if (!destroy && stepName === "render-wrangler-config") {
          if (workerArtifact) {
            preparedWorkerArtifact = await timeReleaseStep(
              timings,
              "worker-release-artifact",
              () =>
                prepareWorkerReleaseArtifact({
                  config: workerArtifact,
                  environment,
                  wranglerConfigPath: releaseWranglerConfigPath(environment),
                }),
            );
            releaseEnv = {
              ...releaseEnv,
              TAKOS_RELEASE_ASSET_MANIFEST_PATH:
                preparedWorkerArtifact.assetManifestPath,
            };
          }
          await timeReleaseStep(
            timings,
            "existing-worker-migration-prune",
            () =>
              pruneWranglerMigrationsForExistingWorker(
                outputs,
                environment,
                releaseEnv,
              ),
          );
          await timeReleaseStep(timings, "queue-consumer-trigger-prune", () =>
            pruneWranglerQueueConsumersForRelease(environment),
          );
          await timeReleaseStep(timings, "d1-wrangler-config", () =>
            writeD1MigrationsWranglerConfig(environment),
          );
        }
      }
      if (!destroy) {
        const deployEnv = wranglerDeployEnv(releaseEnv);
        const managedCompat =
          releaseEnv.TAKOS_CLOUDFLARE_TARGET_MODE === "managed_compat";
        await timeReleaseStep(timings, "wrangler-deploy-auth-preflight", () =>
          preflightWranglerDeployAuth(outputs, deployEnv),
        );
        if (managedCompat) {
          await timeReleaseStep(timings, "wrangler-bundle", () =>
            runFile(
              "bunx",
              wranglerBundleArgs(outputs, environment, {
                containersRollout: env.TAKOS_WRANGLER_CONTAINERS_ROLLOUT,
                prebuiltWorker: Boolean(preparedWorkerArtifact),
              }),
              deployEnv,
            ),
          );
          await timeReleaseStep(timings, "takosumi-managed-worker-upload", () =>
            deployManagedCompatWorker(outputs, environment, deployEnv),
          );
          await timeReleaseStep(timings, "managed-public-route-sync", () =>
            ensureManagedCompatPublicRoute(outputs, deployEnv),
          );
        } else {
          await timeReleaseStep(timings, "wrangler-deploy", () =>
            runFile(
              "bunx",
              wranglerDeployArgs(outputs, environment, {
                containersRollout: env.TAKOS_WRANGLER_CONTAINERS_ROLLOUT,
                prebuiltWorker: Boolean(preparedWorkerArtifact),
              }),
              deployEnv,
            ),
          );
        }
        await timeReleaseStep(timings, "queue-consumers-sync", () =>
          runFile(
            "bun",
            [
              "scripts/control/ensure-queue-consumers.mjs",
              environment,
              "--config",
              releaseWranglerConfigPath(environment),
            ],
            deployEnv,
          ),
        );
        await timeReleaseStep(timings, "wrangler-deployment-status", () =>
          waitForWranglerDeploymentBestEffort(outputs, environment, deployEnv),
        );
        if (!managedCompat) {
          await timeReleaseStep(timings, "container-image-rollout", () =>
            waitForReleaseContainerImages(outputs, environment, deployEnv),
          );
        }
        await timeReleaseStep(timings, "worker-content-verification", () =>
          verifyCloudflareWorkerContent(outputs, environment, deployEnv),
        );
        await timeReleaseStep(timings, "workers-dev-enable", () =>
          ensureWorkersDevSubdomain(outputs, deployEnv),
        );
        await timeReleaseStep(timings, "public-health-check", () =>
          verifyReleaseHealth(outputs, deployEnv),
        );
      }
    }
  } catch (error) {
    releaseStatus = "failed";
    throw error;
  } finally {
    if (!destroy) {
      cleanupReleaseSecretsFile(environment);
      cleanupReleaseWranglerConfig(environment);
      cleanupReleaseD1MigrationsWranglerConfig(environment);
      cleanupReleaseWranglerBundleDir(environment);
      cleanupWorkerReleaseArtifact(environment);
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
