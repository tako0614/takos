#!/usr/bin/env bun

/**
 * Build the Worker payload consumed by the ordinary OpenTofu module.
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
  lstat,
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

export const PINNED_WORKER_ARCHIVE_URL =
  "https://github.com/tako0614/takos/releases/download/v0.12.7/takos-worker-release.tar.gz";
export const PINNED_WORKER_ARCHIVE_SHA256 =
  "e8c1a39c4d36c23dd04b27dabf356a0826214551b057e4577ff955ccc0707687";
/** A fixed upper bound keeps sourceBuild memory-bounded if the pin is rotated. */
export const MAXIMUM_WORKER_ARCHIVE_BYTES = 64 * 1024 * 1024;

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const MODULE_RELATIVE_PATH = "deploy/opentofu/cloudflare";
const WORKER_OUTPUT = ".takos-build/worker/index.js";
const ASSETS_OUTPUT = ".takos-build/assets";
const BRIDGE_OUTPUT =
  ".takos-build/bridge/takos-cloudflare-opentofu-bridge.ts";
const MIGRATIONS_OUTPUT = ".takos-build/migrations";
const CONTAINER_CONFIG_OUTPUT = ".takos-build/container-desired.json";
const MANIFEST_OUTPUT = ".takos-build/manifest.json";

export interface BuildWorkerArtifactOptions {
  /** Repository root. Defaults to the directory containing this script. */
  readonly rootDirectory?: string;
  /** The source must be the repository-pinned immutable Worker archive. */
  readonly source?: "archive";
  readonly fetchImpl?: typeof fetch;
}

export interface BuildWorkerArtifactResult {
  readonly rootDirectory: string;
  readonly moduleDirectory: string;
  readonly source: "pinned-archive";
  readonly workerPath: string;
  readonly assetsPath: string;
  readonly bridgePath: string;
  readonly migrationsPath: string;
  readonly containerDesiredConfigPath: string;
  readonly manifestPath: string;
  readonly workerSha256: string;
  readonly assetsSha256: string;
  readonly migrationSha256: string;
}

type FileEntry = {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
};

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

async function assertNoSymlinks(directory: string): Promise<void> {
  async function visit(current: string): Promise<void> {
    const currentStat = await lstat(current);
    if (currentStat.isSymbolicLink()) {
      throw new Error(`artifact archive contains a symlink: ${current}`);
    }
    if (!currentStat.isDirectory()) return;
    const children = await readdir(current);
    for (const child of children) await visit(join(current, child));
  }
  await visit(directory);
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

async function downloadPinnedArchive(
  fetchImpl: typeof fetch,
  temporaryDirectory: string,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(PINNED_WORKER_ARCHIVE_URL, {
      redirect: "follow",
    });
  } catch {
    throw new Error("pinned Worker archive download failed");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error("pinned Worker archive download returned a non-success status");
  }
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 0 ||
      declaredLength > MAXIMUM_WORKER_ARCHIVE_BYTES
    ) {
      await response.body?.cancel().catch(() => {});
      throw new Error("pinned Worker archive is larger than the source-build bound");
    }
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  if (response.body === null) {
    chunks.push(new Uint8Array(await response.arrayBuffer()));
    totalBytes = chunks[0]!.byteLength;
  } else {
    const reader = response.body.getReader();
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        totalBytes += next.value.byteLength;
        if (totalBytes > MAXIMUM_WORKER_ARCHIVE_BYTES) {
          await reader.cancel().catch(() => {});
          throw new Error("pinned Worker archive is larger than the source-build bound");
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  if (totalBytes > MAXIMUM_WORKER_ARCHIVE_BYTES) {
    throw new Error("pinned Worker archive is larger than the source-build bound");
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (hashBytes(bytes) !== PINNED_WORKER_ARCHIVE_SHA256) {
    throw new Error("pinned Worker archive SHA-256 does not match the repository pin");
  }
  const archivePath = join(temporaryDirectory, "takos-worker-release.tar.gz");
  await writeFile(archivePath, bytes);
  return archivePath;
}

async function extractPinnedArchive(
  fetchImpl: typeof fetch,
): Promise<{ worker: string; assets: string; temporaryDirectory: string }> {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "takos-opentofu-worker-archive-"),
  );
  try {
    const archivePath = await downloadPinnedArchive(fetchImpl, temporaryDirectory);
    const extracted = join(temporaryDirectory, "extracted");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(extracted));
    const listing = spawnSync("tar", ["-tzf", archivePath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (listing.error || listing.status !== 0 || typeof listing.stdout !== "string") {
      throw new Error("pinned Worker archive listing failed");
    }
    for (const listed of listing.stdout.split("\n")) {
      const entry = listed.replace(/^\.\//u, "").replace(/\/+$/u, "");
      if (!entry) continue;
      if (
        entry.startsWith("/") ||
        entry.includes("\\") ||
        entry.split("/").some((segment) => segment === ".." || segment === "")
      ) {
        throw new Error("pinned Worker archive contains an unsafe path");
      }
    }
    const result = spawnSync(
      "tar",
      [
        "-xzf",
        archivePath,
        "--no-same-owner",
        "--no-same-permissions",
        "-C",
        extracted,
      ],
      { stdio: "pipe" },
    );
    if (result.error || result.status !== 0) {
      throw new Error("pinned Worker archive extraction failed");
    }
    // A pinned archive is still treated as untrusted input at the filesystem
    // boundary. Reject symlinks before any bytes are copied into the module;
    // this also prevents a future archive rotation from escaping the output
    // tree through a link.
    await assertNoSymlinks(extracted);
    const worker = join(extracted, "worker/index.js");
    const assets = join(extracted, "assets");
    if (!(await exists(worker)) || !(await exists(assets))) {
      throw new Error("pinned Worker archive lacks worker/index.js or assets");
    }
    return { worker, assets, temporaryDirectory };
  } catch (error) {
    await rm(temporaryDirectory, { force: true, recursive: true });
    throw error;
  }
}

async function copyMigrations(
  rootDirectory: string,
  destination: string,
): Promise<FileEntry[]> {
  const source = resolve(rootDirectory, "db/migrations-control/migrations");
  if (!(await exists(source))) {
    throw new Error(`D1 migration directory is missing: ${source}`);
  }
  const sourceFiles = await collectMigrationFiles(source);
  if (sourceFiles.length === 0) {
    throw new Error("D1 migration directory has no SQL files");
  }
  if (sourceFiles.some(({ path }) => !/^\d{4}_[^/]+\.sql$/u.test(path))) {
    throw new Error("D1 migration files must have a four-digit version prefix");
  }
  for (const { path } of sourceFiles) {
    const destinationPath = resolve(destination, path);
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(dirname(destinationPath), { recursive: true }),
    );
    await cp(resolve(source, path), destinationPath, { force: true });
  }
  const files = await listFiles(destination);
  return files;
}

/** Return the canonical, sorted SQL migration set used by the artifact. */
export async function collectMigrationFiles(
  source: string,
): Promise<readonly FileEntry[]> {
  const sourceFiles = (await listFiles(source)).filter(({ path }) =>
    path.endsWith(".sql"),
  );
  if (sourceFiles.length === 0) {
    throw new Error("D1 migration directory has no SQL files");
  }
  if (sourceFiles.some(({ path }) => !/^\d{4}_[^/]+\.sql$/u.test(path))) {
    throw new Error("D1 migration files must have a four-digit version prefix");
  }
  if (sourceFiles.some(({ bytes }) => bytes === 0)) {
    throw new Error("D1 migration files must not be empty");
  }
  return sourceFiles;
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
  const migrationsOutput = resolve(moduleDirectory, MIGRATIONS_OUTPUT);
  const containerConfigOutput = resolve(moduleDirectory, CONTAINER_CONFIG_OUTPUT);
  const manifestOutput = resolve(moduleDirectory, MANIFEST_OUTPUT);
  const sourcePreference = options.source ?? "archive";
  const fetchImpl = options.fetchImpl ?? fetch;

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
    mkdir(migrationsOutput, { recursive: true }),
  );
  await import("node:fs/promises").then(({ mkdir }) =>
    mkdir(dirname(containerConfigOutput), { recursive: true }),
  );

  let source: "pinned-archive";
  let workerSource: string;
  let assetsSource: string;
  let temporaryDirectory: string | undefined;
  if (sourcePreference !== "archive") {
    throw new Error("only the repository-pinned Worker archive is supported");
  }
  const archive = await extractPinnedArchive(fetchImpl);
  source = "pinned-archive";
  workerSource = archive.worker;
  assetsSource = archive.assets;
  temporaryDirectory = archive.temporaryDirectory;

  try {
    await cp(workerSource, workerOutput, { force: true });
    await cp(assetsSource, assetsOutput, { recursive: true, force: true });
    await copyBridge(rootDirectory, bridgeOutput);
    const migrationFiles = await copyMigrations(rootDirectory, migrationsOutput);
    await writeContainerDesiredConfig(containerConfigOutput);
    const workerDigest = await hashFile(workerOutput);
    const assetFiles = await listFiles(assetsOutput);
    const bridgeDigest = await hashFile(bridgeOutput);
    const containerConfigDigest = await hashFile(containerConfigOutput);
    const assetsSha256 = hashBytes(
      new TextEncoder().encode(stableJson(assetFiles)),
    );
    const migrationSha256 = hashBytes(
      new TextEncoder().encode(stableJson(migrationFiles)),
    );
    const manifest = {
      format: "takos-opentofu-worker-artifact/v1",
      source,
      ...(source === "pinned-archive"
        ? {
            archive: {
              url: PINNED_WORKER_ARCHIVE_URL,
              sha256: PINNED_WORKER_ARCHIVE_SHA256,
            },
          }
        : {}),
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
      migrations: {
        path: "migrations",
        sha256: migrationSha256,
        files: migrationFiles,
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
      migrationsPath: migrationsOutput,
      containerDesiredConfigPath: containerConfigOutput,
      manifestPath: manifestOutput,
      workerSha256: workerDigest.sha256,
      assetsSha256,
      migrationSha256,
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
