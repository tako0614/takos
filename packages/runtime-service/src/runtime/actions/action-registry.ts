import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import type {
  ActionOutputDefinition,
  ActionRuns,
} from "./composite-executor.ts";
import { cloneAndCheckout } from "../git.ts";
import { createLogger } from "takos-common/logger";

const logger = createLogger({ service: "takos-runtime" });

// ===========================================================================
// --- Action metadata loading ---
// ===========================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActionInputDefinition {
  description?: string;
  required?: boolean;
  default?: unknown;
}

export interface ActionMetadata {
  name?: string;
  description?: string;
  inputs?: Record<string, ActionInputDefinition>;
  outputs?: Record<string, ActionOutputDefinition>;
  runs?: ActionRuns;
}

// ---------------------------------------------------------------------------
// Action metadata loading
// ---------------------------------------------------------------------------

const ALLOWED_ACTION_KEYS = new Set([
  "name",
  "author",
  "description",
  "branding",
  "inputs",
  "outputs",
  "runs",
]);

export async function loadActionMetadata(
  actionDir: string,
): Promise<ActionMetadata> {
  const actionYmlPath = path.join(actionDir, "action.yml");
  const actionYamlPath = path.join(actionDir, "action.yaml");

  let actionContent: string;
  try {
    actionContent = await fs.readFile(actionYmlPath, "utf-8");
  } catch {
    actionContent = await fs.readFile(actionYamlPath, "utf-8");
  }

  const parsed = parseYaml(actionContent);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid action.yml format: expected a YAML mapping");
  }

  const record = parsed as Record<string, unknown>;

  // Reject unexpected top-level keys to mitigate malicious YAML payloads
  for (const key of Object.keys(record)) {
    if (!ALLOWED_ACTION_KEYS.has(key)) {
      throw new Error(`Invalid action.yml: unexpected top-level key '${key}'`);
    }
  }

  // Validate runs structure
  if (record.runs !== undefined) {
    if (
      typeof record.runs !== "object" || record.runs === null ||
      Array.isArray(record.runs)
    ) {
      throw new Error('Invalid action.yml: "runs" must be an object');
    }
    const runs = record.runs as Record<string, unknown>;
    if (typeof runs.using !== "string") {
      throw new Error('Invalid action.yml: "runs.using" must be a string');
    }
  }

  // Validate inputs structure
  if (record.inputs !== undefined) {
    if (
      typeof record.inputs !== "object" || record.inputs === null ||
      Array.isArray(record.inputs)
    ) {
      throw new Error('Invalid action.yml: "inputs" must be an object');
    }
  }

  // Validate outputs structure
  if (record.outputs !== undefined) {
    if (
      typeof record.outputs !== "object" || record.outputs === null ||
      Array.isArray(record.outputs)
    ) {
      throw new Error('Invalid action.yml: "outputs" must be an object');
    }
  }

  return record as ActionMetadata;
}

// ---------------------------------------------------------------------------
// Action reference parsing
// ---------------------------------------------------------------------------

export function parseActionRef(
  action: string,
): { owner: string; repo: string; actionPath: string; ref: string } {
  const atIndex = action.indexOf("@");
  const refPart = atIndex >= 0 ? action.slice(atIndex + 1) : "main";
  const pathPart = atIndex >= 0 ? action.slice(0, atIndex) : action;
  const parts = pathPart.split("/");

  return {
    owner: parts[0] || "",
    repo: parts[1] || "",
    actionPath: parts.slice(2).join("/"),
    ref: refPart || "main",
  };
}

// ---------------------------------------------------------------------------
// Action component validation
// ---------------------------------------------------------------------------

export function validateActionComponent(value: string, label: string): void {
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error(`Invalid action ${label}: ${value}`);
  }
}

// ---------------------------------------------------------------------------
// Input resolution
// ---------------------------------------------------------------------------

function normalizeInputValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export function resolveInputs(
  definitions: Record<string, ActionInputDefinition> | undefined,
  provided: Record<string, unknown>,
): { resolvedInputs: Record<string, string>; missing: string[] } {
  const resolvedInputs: Record<string, string> = {};
  const missing: string[] = [];
  const providedMap = new Map<string, { key: string; value: unknown }>();

  for (const [key, value] of Object.entries(provided || {})) {
    providedMap.set(key.toLowerCase(), { key, value });
  }

  const definedKeys = new Set<string>();

  if (definitions) {
    for (const [name, def] of Object.entries(definitions)) {
      const normalized = name.toLowerCase();
      definedKeys.add(normalized);

      let value = providedMap.get(normalized)?.value;
      if (value === undefined) {
        if (def && Object.prototype.hasOwnProperty.call(def, "default")) {
          value = def.default;
        } else if (def?.required) {
          missing.push(name);
        }
      }

      if (value !== undefined) {
        resolvedInputs[name] = normalizeInputValue(value);
      }
    }
  }

  for (const [key, value] of Object.entries(provided || {})) {
    if (!definedKeys.has(key.toLowerCase())) {
      resolvedInputs[key] = normalizeInputValue(value);
    }
  }

  return { resolvedInputs, missing };
}

export function buildInputEnv(
  inputs: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(inputs)) {
    env[`INPUT_${key.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase()}`] = value;
  }
  return env;
}

// ===========================================================================
// --- Action cache & Store action fetching ---
// ===========================================================================

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ACTION_CACHE_DIR = path.join(os.tmpdir(), "takos-actions-cache");
const ACTION_CACHE_MAX_ENTRIES = 30;
const ACTION_CACHE_MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2GB
const GET_DIR_SIZE_MAX_DEPTH = 10;

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

const actionRepoCache = new Map<string, Promise<string>>();
/** Per-action mutex to prevent concurrent fetch race conditions. */
const actionFetchLocks = new Map<string, Promise<string>>();
let actionCachePrunePromise: Promise<void> | null = null;

// ---------------------------------------------------------------------------
// Symlink safety
// ---------------------------------------------------------------------------

async function removeEscapingSymlinks(
  dir: string,
  boundary: string,
): Promise<void> {
  const resolvedBoundary = path.resolve(boundary);
  let entries: Array<Dirent>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    try {
      const lstats = await fs.lstat(entryPath);
      if (lstats.isSymbolicLink()) {
        const target = await fs.realpath(entryPath).catch(() => null);
        const isWithinBoundary = target !== null &&
          (target === resolvedBoundary ||
            target.startsWith(resolvedBoundary + path.sep));
        if (!isWithinBoundary) {
          await fs.unlink(entryPath).catch((e) => {
            logger.warn("Failed to unlink escaping symlink (non-critical)", {
              module: "action-registry",
              path: entryPath,
              error: e,
            });
          });
        }
      } else if (lstats.isDirectory()) {
        await removeEscapingSymlinks(entryPath, boundary);
      }
    } catch (e) {
      logger.warn(
        "Failed to stat entry during symlink cleanup (non-critical)",
        { module: "action-registry", path: entryPath, error: e },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Cache size management
// ---------------------------------------------------------------------------

function evictActionRepoCache(): void {
  if (actionRepoCache.size <= ACTION_CACHE_MAX_ENTRIES) return;
  const toDelete = actionRepoCache.size - ACTION_CACHE_MAX_ENTRIES;
  let deleted = 0;
  for (const key of actionRepoCache.keys()) {
    if (deleted >= toDelete) break;
    actionRepoCache.delete(key);
    deleted++;
  }
}

async function getDirectorySize(
  targetPath: string,
  depth: number = 0,
  visited: Set<string> = new Set(),
): Promise<number> {
  if (depth >= GET_DIR_SIZE_MAX_DEPTH) {
    return 0;
  }

  let realPath: string;
  try {
    realPath = await fs.realpath(targetPath);
  } catch {
    return 0;
  }
  if (visited.has(realPath)) {
    return 0;
  }
  visited.add(realPath);

  let total = 0;
  let entries: Array<Dirent>;
  try {
    entries = await fs.readdir(targetPath, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    const entryPath = path.join(targetPath, entry.name);
    try {
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        total += await getDirectorySize(entryPath, depth + 1, visited);
      } else if (entry.isFile()) {
        const stats = await fs.stat(entryPath);
        total += stats.size;
      }
    } catch {
      // Ignore inaccessible entries
    }
  }

  return total;
}

async function pruneActionCache(keepPaths: string[] = []): Promise<void> {
  if (actionCachePrunePromise) {
    await actionCachePrunePromise;
    return;
  }

  actionCachePrunePromise = (async () => {
    let entries: Array<Dirent>;
    try {
      entries = await fs.readdir(ACTION_CACHE_DIR, { withFileTypes: true });
    } catch {
      return;
    }

    const cacheEntries: Array<{ path: string; mtime: number; size: number }> =
      [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const entryPath = path.join(ACTION_CACHE_DIR, entry.name);
      if (keepPaths.includes(entryPath)) {
        continue;
      }
      try {
        const stats = await fs.stat(entryPath);
        const size = await getDirectorySize(entryPath);
        cacheEntries.push({ path: entryPath, mtime: stats.mtimeMs, size });
      } catch {
        // Ignore entries we cannot stat
      }
    }

    if (cacheEntries.length === 0) return;

    cacheEntries.sort((a, b) => a.mtime - b.mtime);

    let totalSize = cacheEntries.reduce((sum, entry) => sum + entry.size, 0);
    let totalEntries = cacheEntries.length;

    for (const entry of cacheEntries) {
      if (
        totalEntries <= ACTION_CACHE_MAX_ENTRIES &&
        totalSize <= ACTION_CACHE_MAX_BYTES
      ) {
        break;
      }
      try {
        await fs.rm(entry.path, { recursive: true, force: true });
      } catch {
        // Ignore removal errors
      }
      totalEntries -= 1;
      totalSize -= entry.size;
    }
  })();

  try {
    await actionCachePrunePromise;
  } finally {
    actionCachePrunePromise = null;
  }
}

// ---------------------------------------------------------------------------
// Store action repo fetching
// ---------------------------------------------------------------------------

export interface ActionRefInfo {
  owner: string;
  repo: string;
  actionPath: string;
  ref: string;
}

export async function fetchStoreActionRepo(
  actionRef: ActionRefInfo,
  env: Record<string, string>,
): Promise<string> {
  const cacheKey = `${actionRef.owner}/${actionRef.repo}@${actionRef.ref}`;

  // Check if a resolved path is already cached
  const cachedPromise = actionRepoCache.get(cacheKey);
  if (cachedPromise) {
    return cachedPromise;
  }

  // Use a per-action mutex to prevent concurrent fetches of the same action
  // from racing on filesystem operations.
  const existingLock = actionFetchLocks.get(cacheKey);
  if (existingLock) {
    return existingLock;
  }

  const fetchPromise = (async () => {
    await fs.mkdir(ACTION_CACHE_DIR, { recursive: true });
    const hash = createHash("sha256").update(cacheKey).digest("hex").slice(
      0,
      16,
    );
    const repoDir = path.join(
      ACTION_CACHE_DIR,
      `${actionRef.owner}-${actionRef.repo}-${hash}`,
    );

    const gitDir = path.join(repoDir, ".git");
    const gitExists = await fs.stat(gitDir).then(() => true).catch(() => false);

    if (!gitExists) {
      await fs.rm(repoDir, { recursive: true, force: true });
      await fs.mkdir(repoDir, { recursive: true });

      const cloneResult = await cloneAndCheckout({
        repoUrl: `https://github.com/${actionRef.owner}/${actionRef.repo}.git`,
        targetDir: repoDir,
        ref: actionRef.ref,
        shallow: true,
        env,
      });

      if (!cloneResult.success) {
        await fs.rm(repoDir, { recursive: true, force: true });
        throw new Error(
          `Failed to fetch action ${cacheKey}: ${cloneResult.output}`,
        );
      }

      await removeEscapingSymlinks(repoDir, repoDir);
    }

    try {
      const now = new Date();
      await fs.utimes(repoDir, now, now);
    } catch {
      // Ignore utimes errors
    }

    await pruneActionCache([repoDir]);
    return repoDir;
  })();

  actionFetchLocks.set(cacheKey, fetchPromise);

  try {
    const result = await fetchPromise;
    // Cache the resolved path for future lookups
    actionRepoCache.set(cacheKey, Promise.resolve(result));
    evictActionRepoCache();
    return result;
  } catch (err) {
    // Don't cache failures — allow retry
    actionRepoCache.delete(cacheKey);
    throw err;
  } finally {
    // Always release the fetch lock
    actionFetchLocks.delete(cacheKey);
  }
}
