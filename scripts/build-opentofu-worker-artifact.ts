#!/usr/bin/env bun

/**
 * Build the Worker payload consumed by the ordinary OpenTofu module.
 *
 * The payload carries no SQL: the Worker embeds its own migration set and
 * applies it at runtime, so the module has nothing to migrate at Apply time.
 *
 * This command deliberately writes below deploy/opentofu/cloudflare.  A
 * Takosumi runner may materialise only that module during Apply, so a
 * lifecycle helper must not depend on the repository root or root
 * node_modules being present at that point.
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const MODULE_RELATIVE_PATH = "deploy/opentofu/cloudflare";
const WORKER_OUTPUT = ".takos-build/worker/index.js";
const ASSETS_OUTPUT = ".takos-build/assets";
const BRIDGE_OUTPUT =
  ".takos-build/bridge/takos-cloudflare-opentofu-bridge.ts";
const CONTAINER_CONFIG_OUTPUT = ".takos-build/container-desired.json";
const MANIFEST_OUTPUT = ".takos-build/manifest.json";

export interface BuildWorkerArtifactOptions {
  /** Repository root. Defaults to the directory containing this script. */
  readonly rootDirectory?: string;
  /** Test seam; normal callers always build the resolved repository source. */
  readonly sourceBuilder?: RepositorySourceBuilder;
}

export interface BuildWorkerArtifactResult {
  readonly rootDirectory: string;
  readonly moduleDirectory: string;
  readonly source: "repository-source";
  readonly workerPath: string;
  readonly assetsPath: string;
  readonly bridgePath: string;
  readonly containerDesiredConfigPath: string;
  readonly manifestPath: string;
  readonly workerSha256: string;
  readonly assetsSha256: string;
}

type FileEntry = {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
};

type RepositorySource = {
  readonly worker: string;
  readonly assets: string;
  readonly temporaryDirectory?: string;
};

export type RepositorySourceBuilder = (
  rootDirectory: string,
) => Promise<RepositorySource>;

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function hashFile(path: string): Promise<{ sha256: string; bytes: number }> {
  const bytes = await readFile(path);
  return { sha256: hashBytes(bytes), bytes: bytes.byteLength };
}

async function listFiles(directory: string): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];
  async function visit(current: string): Promise<void> {
    const children = (await readdir(current, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    );
    for (const child of children) {
      const path = join(current, child.name);
      if (child.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!child.isFile()) {
        throw new Error(`artifact contains unsupported filesystem entry: ${path}`);
      }
      const digest = await hashFile(path);
      entries.push({
        path: relative(directory, path).split(sep).join("/"),
        ...digest,
      });
    }
  }
  await visit(directory);
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

const SOURCE_ENTRYPOINT = "src/worker/cloudflare-entrypoint.ts";

function credentialFreeBuildEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    "BUN_INSTALL",
    "CI",
    "HOME",
    "LANG",
    "LC_ALL",
    "NODE_OPTIONS",
    "PATH",
    "SHELL",
    "TEMP",
    "TMP",
    "TMPDIR",
    "USER",
    "XDG_CACHE_HOME",
  ];
  const environment: NodeJS.ProcessEnv = {};
  for (const name of allowed) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  environment.CI = "1";
  environment.WRANGLER_SEND_METRICS = "false";
  return environment;
}

function runSourceBuild(
  rootDirectory: string,
  command: string,
  args: readonly string[],
): void {
  const result = spawnSync(command, [...args], {
    cwd: rootDirectory,
    env: credentialFreeBuildEnvironment(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
    timeout: 600_000,
  });
  if (result.error || result.status !== 0) {
    const detail = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim();
    throw new Error(
      `repository Worker source build failed (${command} ${args.join(" ")}): ${
        detail.slice(0, 16_384) || result.error?.message || "unknown failure"
      }`,
    );
  }
}

async function oneWorkerBundle(directory: string): Promise<string> {
  const candidates = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.(?:c|m)?js$/u.test(entry.name))
    .map((entry) => join(directory, entry.name))
    .sort();
  if (candidates.length !== 1) {
    throw new Error(
      `Wrangler source build must emit exactly one JavaScript entrypoint; found ${candidates.length}`,
    );
  }
  return candidates[0]!;
}

async function buildRepositorySource(
  rootDirectory: string,
): Promise<RepositorySource> {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "takos-opentofu-worker-source-"),
  );
  const bundleDirectory = join(temporaryDirectory, "worker");
  try {
    await mkdir(bundleDirectory, { recursive: true });
    runSourceBuild(rootDirectory, "bun", ["run", "web:build"]);
    runSourceBuild(rootDirectory, "bunx", [
      "wrangler",
      "deploy",
      "--config",
      "deploy/cloudflare/wrangler.toml",
      "--env=",
      "--dry-run",
      "--containers-rollout",
      "none",
      "--outdir",
      bundleDirectory,
    ]);
    const worker = await oneWorkerBundle(bundleDirectory);
    const assets = resolve(rootDirectory, "dist");
    if (!(await exists(assets))) {
      throw new Error("repository web build did not emit dist assets");
    }
    return { worker, assets, temporaryDirectory };
  } catch (error) {
    await rm(temporaryDirectory, { force: true, recursive: true });
    throw error;
  }
}

async function copyBridge(rootDirectory: string, destination: string): Promise<void> {
  const source = resolve(rootDirectory, "scripts/takos-cloudflare-opentofu-bridge.ts");
  if (!(await exists(source))) {
    throw new Error(`Cloudflare OpenTofu bridge is missing: ${source}`);
  }
  await cp(source, destination, { force: true });
}

async function writeContainerDesiredConfig(path: string): Promise<void> {
  // Names and capacities are resolved from the explicit bridge environment at
  // Apply time. Keeping this small template in the module means the generic
  // generated-root lane has a stable, hashable input without baking an
  // account, worker name, or secret into sourceBuild output.
  const template = {
    format: "takos-cloudflare-opentofu-container-desired/v1",
    applications: [
      {
        name: "${TAKOS_CLOUDFLARE_WORKER_NAME}-executor-tier1",
        durable_object_class: "ExecutorContainerTier1",
        image: "${TAKOS_CONTAINER_IMAGE}",
        instance_type: "lite",
        max_instances: "${TAKOS_EXECUTOR_TIER1_MAX_INSTANCES:-1}",
        rollout_active_grace_period: 900,
      },
      {
        name: "${TAKOS_CLOUDFLARE_WORKER_NAME}-executor-tier2",
        durable_object_class: "ExecutorContainerTier2",
        image: "${TAKOS_CONTAINER_IMAGE}",
        instance_type: "basic",
        max_instances: "${TAKOS_EXECUTOR_TIER2_MAX_INSTANCES:-1}",
        rollout_active_grace_period: 900,
      },
      {
        name: "${TAKOS_CLOUDFLARE_WORKER_NAME}-executor-tier3",
        durable_object_class: "ExecutorContainerTier3",
        image: "${TAKOS_CONTAINER_IMAGE}",
        instance_type: { vcpu: 1, memory_mib: 12288, disk_mb: 4000 },
        max_instances: "${TAKOS_EXECUTOR_TIER3_MAX_INSTANCES:-1}",
        rollout_active_grace_period: 900,
      },
    ],
  };
  await writeFile(path, `${stableJson(template)}\n`, "utf8");
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

export async function buildOpentofuWorkerArtifact(
  options: BuildWorkerArtifactOptions = {},
): Promise<BuildWorkerArtifactResult> {
  const rootDirectory = resolve(options.rootDirectory ?? DEFAULT_ROOT);
  const moduleDirectory = resolve(rootDirectory, MODULE_RELATIVE_PATH);
  const outputDirectory = resolve(moduleDirectory, ".takos-build");
  const workerOutput = resolve(moduleDirectory, WORKER_OUTPUT);
  const assetsOutput = resolve(moduleDirectory, ASSETS_OUTPUT);
  const bridgeOutput = resolve(moduleDirectory, BRIDGE_OUTPUT);
  const containerConfigOutput = resolve(moduleDirectory, CONTAINER_CONFIG_OUTPUT);
  const manifestOutput = resolve(moduleDirectory, MANIFEST_OUTPUT);
  const sourceBuilder = options.sourceBuilder ?? buildRepositorySource;

  await rm(outputDirectory, { force: true, recursive: true });
  await import("node:fs/promises").then(({ mkdir }) =>
    mkdir(dirname(workerOutput), { recursive: true }),
  );
  await import("node:fs/promises").then(({ mkdir }) =>
    mkdir(assetsOutput, { recursive: true }),
  );
  await import("node:fs/promises").then(({ mkdir }) =>
    mkdir(dirname(bridgeOutput), { recursive: true }),
  );
  await import("node:fs/promises").then(({ mkdir }) =>
    mkdir(dirname(containerConfigOutput), { recursive: true }),
  );

  const source = "repository-source" as const;
  const builtSource = await sourceBuilder(rootDirectory);
  const workerSource = builtSource.worker;
  const assetsSource = builtSource.assets;
  const temporaryDirectory = builtSource.temporaryDirectory;

  try {
    await cp(workerSource, workerOutput, { force: true });
    await cp(assetsSource, assetsOutput, { recursive: true, force: true });
    await copyBridge(rootDirectory, bridgeOutput);
    await writeContainerDesiredConfig(containerConfigOutput);
    const workerDigest = await hashFile(workerOutput);
    const assetFiles = await listFiles(assetsOutput);
    const bridgeDigest = await hashFile(bridgeOutput);
    const containerConfigDigest = await hashFile(containerConfigOutput);
    const assetsSha256 = hashBytes(
      new TextEncoder().encode(stableJson(assetFiles)),
    );
    const manifest = {
      format: "takos-opentofu-worker-artifact/v2",
      source,
      entrypoint: SOURCE_ENTRYPOINT,
      worker: {
        path: "worker/index.js",
        sha256: workerDigest.sha256,
        bytes: workerDigest.bytes,
      },
      assets: {
        path: "assets",
        sha256: assetsSha256,
        files: assetFiles,
      },
      bridge: {
        path: "bridge/takos-cloudflare-opentofu-bridge.ts",
        sha256: bridgeDigest.sha256,
        bytes: bridgeDigest.bytes,
      },
      containerDesiredConfig: {
        path: "container-desired.json",
        sha256: containerConfigDigest.sha256,
        bytes: containerConfigDigest.bytes,
      },
    };
    await writeFile(manifestOutput, `${stableJson(manifest)}\n`, "utf8");
    return {
      rootDirectory,
      moduleDirectory,
      source,
      workerPath: workerOutput,
      assetsPath: assetsOutput,
      bridgePath: bridgeOutput,
      containerDesiredConfigPath: containerConfigOutput,
      manifestPath: manifestOutput,
      workerSha256: workerDigest.sha256,
      assetsSha256,
    };
  } finally {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  }
}

if (import.meta.main) {
  await buildOpentofuWorkerArtifact();
}
