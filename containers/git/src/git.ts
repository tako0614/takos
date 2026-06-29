// Bun migration: node:sqlite is unavailable in Bun 1.3.14 (and the node:
// prefix cannot be intercepted by tsconfig paths or Bun.plugin), so this
// import is redirected to a bun:sqlite-backed DatabaseSync shim that is
// behaviorally identical for the synchronous surface used here
// (new/close/exec/prepare->get/run/all). The shim re-exports the same
// DatabaseSync class name as the Node sqlite API.
import { DatabaseSync } from "../shims/node-sqlite.ts";
import {
  type CommandOutput,
  createNewFile,
  type DirEntry,
  getEnv,
  isAlreadyExistsError,
  isNotFoundError,
  makeDirectory,
  makeTempDirSync,
  pathStat,
  readDirEntries,
  readTextFile,
  readTextFileSync,
  removePath,
  spawnCommand,
  writeBytes,
  writeText,
} from "./runtime.ts";
import type {
  GitCreatePullRequestCommentRequest,
  GitCreatePullRequestRequest,
  GitCreatePullRequestReviewRequest,
  GitPullRequestComment,
  GitPullRequestDetail,
  GitPullRequestReview,
  GitPullRequestStatus,
  GitRefSummary,
  GitUpdatePullRequestRequest,
} from "takos-git-contract";
import type {
  TakosumiActorContext as TakosActorContext,
} from "takosumi-contract/internal/rpc";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
const INITIAL_COMMIT_ENV = {
  GIT_AUTHOR_NAME: "Takos Git",
  GIT_AUTHOR_EMAIL: "git@takos.local",
  GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
  GIT_COMMITTER_NAME: "Takos Git",
  GIT_COMMITTER_EMAIL: "git@takos.local",
  GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
};

// Bare-repo config entries we apply to every Takos-owned repository:
//   - receive.denyNonFastForwards: refuse non-fast-forward pushes
//   - receive.denyDeletes: refuse branch/tag deletion via push
//   - transfer.fsckObjects: validate object integrity on receive/fetch
//   - core.hooksPath: /dev/null routes hook lookups at a path that
//     contains no executables, so a poisoned object or template cannot
//     install a callable hook in this bare repo.
const HARDENED_BARE_REPO_CONFIG: ReadonlyArray<readonly [string, string]> = [
  ["receive.denyNonFastForwards", "true"],
  ["receive.denyDeletes", "true"],
  ["transfer.fsckObjects", "true"],
  ["core.hooksPath", "/dev/null"],
];

// Marker file dropped into a bare repo after the hardened config has
// been applied. Presence of this file lets the startup backfill skip
// re-running `git config` on every repo on every startup.
const HARDENING_MARKER_FILENAME = ".takos-hardening-applied";
let cachedDatabase:
  | { path: string; database: DatabaseSync; migratedJsonPath?: string }
  | undefined;

const SQLITE_MIGRATIONS: Array<{ version: number; sql: string }> = [{
  version: 1,
  sql: `
    CREATE TABLE IF NOT EXISTS repositories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_account_id TEXT NOT NULL, -- historical; API uses ownerSpaceId
      default_branch TEXT NOT NULL,
      refs_json TEXT NOT NULL DEFAULT '[]',
      state TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pull_requests (
      id TEXT PRIMARY KEY,
      repository_id TEXT NOT NULL REFERENCES repositories(id),
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      head_branch TEXT NOT NULL,
      base_branch TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      author_type TEXT NOT NULL DEFAULT 'user',
      author_id TEXT,
      run_id TEXT,
      merged_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(repository_id, number)
    );
    CREATE TABLE IF NOT EXISTS pr_comments (
      id TEXT PRIMARY KEY,
      pull_request_id TEXT NOT NULL REFERENCES pull_requests(id),
      author_type TEXT NOT NULL DEFAULT 'user',
      author_id TEXT,
      body TEXT NOT NULL,
      path TEXT,
      line INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pr_reviews (
      id TEXT PRIMARY KEY,
      pull_request_id TEXT NOT NULL REFERENCES pull_requests(id),
      reviewer_type TEXT NOT NULL DEFAULT 'user',
      reviewer_id TEXT,
      status TEXT NOT NULL,
      body TEXT,
      analysis TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS repository_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repository_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pull_requests_repository_status
      ON pull_requests(repository_id, status, number);
    CREATE INDEX IF NOT EXISTS idx_pr_comments_pull_request
      ON pr_comments(pull_request_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_pr_reviews_pull_request
      ON pr_reviews(pull_request_id, created_at);
  `,
}];

export type GitJsonError = {
  body: {
    error: string;
    code: string;
    repositoryId?: string;
    objectId?: string;
    pullRequestNumber?: number;
  };
  status: 400 | 404 | 409 | 422 | 501;
};

export type GitObjectTooLargeError = {
  body: {
    error: string;
    code: "git_object_too_large";
    objectId: string;
    size: number;
    maxBytes: number;
  };
  status: 413;
};

export interface GitRepositoryMetadataRecord {
  id: string;
  name: string;
  ownerSpaceId: string;
  defaultBranch: string;
  refs: GitRefSummary[];
  state?: "active" | "deleted" | "initializing" | "failed";
  createdAt: string;
  updatedAt: string;
}

export function isLiteralObjectId(value: string): boolean {
  return /^[0-9a-fA-F]{40}$/.test(value) ||
    /^[0-9a-fA-F]{64}$/.test(value);
}

export function configuredRepositoryPath(
  repositoryId: string,
): string | undefined {
  const root = configuredRepositoryRoot();
  if (!root) return undefined;
  const relative = repositoryId.endsWith(".git")
    ? repositoryId
    : `${repositoryId}.git`;
  return `${root}/${relative}`;
}

export function configuredMetadataPath(): string | undefined {
  const root = configuredRepositoryRoot();
  if (!root) return undefined;
  return `${root}/.takos/repositories.json`;
}

export function configuredDatabasePath(): string | undefined {
  const configured = getEnv("TAKOS_GIT_DATABASE_URL")?.trim();
  if (configured) {
    const prefix = "sqlite://";
    if (!configured.startsWith(prefix)) {
      throw new Error(
        "TAKOS_GIT_DATABASE_URL must use sqlite:// for takos-git Production v1",
      );
    }
    return configured.slice(prefix.length);
  }
  const root = configuredRepositoryRoot();
  if (!root) return undefined;
  return `${root}/.takos/containers/git.sqlite`;
}

export function configuredRepositoryRoot(): string | undefined {
  const root = getEnv("TAKOS_GIT_REPOSITORY_ROOT")?.trim();
  if (!root) return undefined;
  return root.replace(/\/+$/, "") || "/";
}

export function devInMemoryMetadataEnabled(): boolean {
  return getEnv("TAKOS_GIT_DEV_IN_MEMORY_METADATA") === "true";
}

export function configuredStorageReady(): boolean {
  return devInMemoryMetadataEnabled() || !!configuredRepositoryRoot();
}

export function isSafeRepositoryId(repositoryId: string): boolean {
  return repositoryId.length > 0 &&
    !repositoryId.startsWith("/") &&
    repositoryId.split("/").every(isSafePathSegment);
}

export function isSafeSmartHttpPath(pathname: string): boolean {
  if (!pathname.startsWith("/") || !pathname.includes(".git")) return false;
  return pathname.slice(1).split("/").every(isSafePathSegment);
}

export function isSafeRefInput(ref: string): boolean {
  return ref.length > 0 &&
    !ref.includes("\0") &&
    !ref.includes("..") &&
    !ref.includes("@{") &&
    !ref.includes("\\") &&
    !ref.startsWith("/") &&
    !ref.endsWith("/") &&
    // Reject a leading '-' so a ref name can never be parsed as a git option
    // flag (e.g. `-d`, `--stdin`) when passed as a positional argument.
    !ref.startsWith("-") &&
    /^[A-Za-z0-9._/-]+$/.test(ref);
}

export async function readConfiguredGitRefs(
  repositoryId: string,
): Promise<
  | { ok: true; refs: GitRefSummary[]; repositoryPath: string }
  | ({ ok: false } & GitJsonError)
> {
  const repositoryPath = configuredRepositoryPath(repositoryId);
  if (!repositoryPath) {
    return {
      ok: false,
      status: 501,
      body: notImplemented("git_repository_root_not_configured"),
    };
  }
  if (!isSafeRepositoryId(repositoryId)) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "repositoryId must be a safe relative bare repository path",
        code: "invalid_git_repository_id",
        repositoryId,
      },
    };
  }
  const active = await configuredRepositoryIsActive(repositoryId);
  if (active === false) {
    return {
      ok: false,
      status: 404,
      body: repositoryNotFound(repositoryId),
    };
  }
  if (!(await directoryExists(repositoryPath))) {
    return {
      ok: false,
      status: 404,
      body: repositoryNotFound(repositoryId),
    };
  }

  const output = await runGit([
    "--git-dir",
    repositoryPath,
    "for-each-ref",
    "--format=%(refname)%00%(objectname)",
  ]);
  if (!output.success) {
    return {
      ok: false,
      status: 404,
      body: repositoryNotFound(repositoryId),
    };
  }

  const refs = textDecoder.decode(output.stdout).trimEnd().split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, target] = line.split("\0");
      return { name, target };
    });
  return { ok: true, refs, repositoryPath };
}

export async function createConfiguredBareRepository(
  repositoryId: string,
  options: { defaultBranch?: string; mode?: "default" | "bare" } = {},
): Promise<
  | { ok: true; repositoryPath: string }
  | ({ ok: false } & GitJsonError)
  | {
    ok: false;
    status: 409 | 500;
    body: { error: string; code: string; repositoryId: string };
  }
> {
  const repositoryPath = configuredRepositoryPath(repositoryId);
  if (!repositoryPath) {
    return {
      ok: false,
      status: 501,
      body: notImplemented("git_repository_root_not_configured"),
    };
  }
  if (!isSafeRepositoryId(repositoryId)) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "repositoryId must be a safe relative bare repository path",
        code: "invalid_git_repository_id",
        repositoryId,
      },
    };
  }
  if (await exists(repositoryPath)) {
    return {
      ok: false,
      status: 409,
      body: {
        error: "repository already exists",
        code: "git_repository_already_exists",
        repositoryId,
      },
    };
  }

  await makeDirectory(parentDirectory(repositoryPath), { recursive: true });
  const output = await runGit(["init", "--bare", repositoryPath]);
  if (!output.success) {
    return {
      ok: false,
      status: 500,
      body: {
        error: "failed to initialize bare repository",
        code: "git_repository_init_failed",
        repositoryId,
      },
    };
  }
  // Harden the new bare repository before any push can land. See
  // HARDENED_BARE_REPO_CONFIG for what each entry does.
  for (const [key, value] of HARDENED_BARE_REPO_CONFIG) {
    const configResult = await runGit([
      "--git-dir",
      repositoryPath,
      "config",
      key,
      value,
    ]);
    if (!configResult.success) {
      await removeDirectoryIfExists(repositoryPath);
      return {
        ok: false,
        status: 500,
        body: {
          error: "failed to harden bare repository config",
          code: "git_repository_init_failed",
          repositoryId,
        },
      };
    }
  }
  // Mark this repo as already-hardened so the startup backfill can skip
  // it on subsequent runs.
  await writeHardeningMarker(repositoryPath).catch(() => {});
  if (options.mode !== "bare") {
    const initialized = await initializeDefaultBranch(
      repositoryPath,
      options.defaultBranch ?? "main",
    );
    if (!initialized.ok) {
      await removeDirectoryIfExists(repositoryPath);
      return {
        ok: false,
        status: 500,
        body: {
          error: initialized.error,
          code: "git_repository_init_failed",
          repositoryId,
        },
      };
    }
  }
  return { ok: true, repositoryPath };
}

export async function readConfiguredRepositoryMetadata(): Promise<
  GitRepositoryMetadataRecord[] | undefined
> {
  const database = await configuredDatabase();
  if (database) {
    return readDatabaseRepositoryMetadata(database).filter((repository) =>
      repository.state === "active"
    );
  }

  const metadataPath = configuredMetadataPath();
  if (!metadataPath) return undefined;
  try {
    const parsed = JSON.parse(await readTextFile(metadataPath));
    if (!Array.isArray(parsed.repositories)) return [];
    return parsed.repositories.filter(isRepositoryMetadataRecord);
  } catch (error) {
    if (isNotFoundError(error)) return [];
    throw error;
  }
}

export async function writeConfiguredRepositoryMetadata(
  repositories: GitRepositoryMetadataRecord[],
): Promise<void> {
  const database = await configuredDatabase();
  if (database) {
    writeDatabaseRepositoryMetadata(database, repositories);
    return;
  }

  const metadataPath = configuredMetadataPath();
  if (!metadataPath) return;
  await makeDirectory(parentDirectory(metadataPath), { recursive: true });
  await writeBytes(
    metadataPath,
    textEncoder.encode(
      `${JSON.stringify({ repositories }, null, 2)}\n`,
    ),
  );
}

/**
 * Create or update a single repository's metadata without read-modify-write of
 * the whole repository set. On the SQLite path this is a targeted row upsert in
 * its own transaction, so two concurrent requests creating different
 * repositories cannot tombstone each other (the bug whole-set replacement had).
 * On the JSON-file fallback path it still rewrites the file, but under a
 * single-host advisory file lock so concurrent writers serialize instead of
 * clobbering each other; that fallback remains single-host only (a shared
 * filesystem across replicas is NOT supported — use sqlite:// there).
 */
export async function upsertConfiguredRepositoryMetadata(
  repository: GitRepositoryMetadataRecord,
): Promise<void> {
  const database = await configuredDatabase();
  if (database) {
    upsertDatabaseRepositoryRecord(database, repository);
    return;
  }
  const metadataPath = configuredMetadataPath();
  if (!metadataPath) return;
  await withJsonMetadataLock(metadataPath, async () => {
    const existing = await readJsonRepositoryMetadata(metadataPath);
    const next = existing.filter((entry) => entry.id !== repository.id);
    next.push(repository);
    await writeJsonRepositoryMetadata(metadataPath, next);
  });
}

/**
 * Soft-delete a single repository's metadata. Targets one row (SQLite) or
 * rewrites the JSON file under the single-host lock (JSON fallback). Returns
 * true when an active record existed and was tombstoned/removed.
 */
export async function deleteConfiguredRepositoryMetadata(
  repositoryId: string,
): Promise<boolean> {
  const database = await configuredDatabase();
  if (database) {
    return deleteDatabaseRepositoryRecord(database, repositoryId);
  }
  const metadataPath = configuredMetadataPath();
  if (!metadataPath) return false;
  return await withJsonMetadataLock(metadataPath, async () => {
    const existing = await readJsonRepositoryMetadata(metadataPath);
    const next = existing.filter((entry) => entry.id !== repositoryId);
    if (next.length === existing.length) return false;
    await writeJsonRepositoryMetadata(metadataPath, next);
    return true;
  });
}

async function readJsonRepositoryMetadata(
  metadataPath: string,
): Promise<GitRepositoryMetadataRecord[]> {
  try {
    const parsed = JSON.parse(await readTextFile(metadataPath));
    if (!Array.isArray(parsed.repositories)) return [];
    return parsed.repositories.filter(isRepositoryMetadataRecord);
  } catch (error) {
    if (isNotFoundError(error)) return [];
    throw error;
  }
}

async function writeJsonRepositoryMetadata(
  metadataPath: string,
  repositories: GitRepositoryMetadataRecord[],
): Promise<void> {
  await makeDirectory(parentDirectory(metadataPath), { recursive: true });
  await writeBytes(
    metadataPath,
    textEncoder.encode(`${JSON.stringify({ repositories }, null, 2)}\n`),
  );
}

/**
 * Single-host advisory file lock for the JSON-metadata fallback. Serializes the
 * read-modify-write of the whole repositories.json on one host by atomically
 * creating a `<path>.lock` file (createNew), retrying briefly on contention,
 * and reclaiming a stale lock left by a crashed writer. This is a single-host
 * guard only; it does NOT coordinate across machines that share the file over a
 * network filesystem. Multi-replica deployments must use the SQLite path.
 */
const JSON_METADATA_LOCK_TIMEOUT_MS = 5_000;
const JSON_METADATA_LOCK_STALE_MS = 30_000;

async function withJsonMetadataLock<T>(
  metadataPath: string,
  fn: () => Promise<T>,
): Promise<T> {
  await makeDirectory(parentDirectory(metadataPath), { recursive: true });
  const lockPath = `${metadataPath}.lock`;
  const deadline = Date.now() + JSON_METADATA_LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const handle = await createNewFile(lockPath);
      handle.close();
      break;
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
      if (await reclaimStaleLock(lockPath)) continue;
      if (Date.now() >= deadline) {
        throw new Error(
          `timed out acquiring git metadata lock: ${lockPath}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  try {
    return await fn();
  } finally {
    await removePath(lockPath).catch(() => {});
  }
}

async function reclaimStaleLock(lockPath: string): Promise<boolean> {
  try {
    const stat = await pathStat(lockPath);
    const mtime = stat.mtime?.getTime() ?? 0;
    if (Date.now() - mtime <= JSON_METADATA_LOCK_STALE_MS) return false;
    // Older than the stale threshold: a previous writer likely crashed without
    // releasing. Remove it so we (or another waiter) can re-acquire.
    await removePath(lockPath);
    return true;
  } catch {
    return false;
  }
}

export async function readConfiguredRepositoryRecord(
  repositoryId: string,
): Promise<GitRepositoryMetadataRecord | undefined> {
  const database = await configuredDatabase();
  if (database) return readDatabaseRepositoryRecord(database, repositoryId);
  return (await readConfiguredRepositoryMetadata())?.find((repository) =>
    repository.id === repositoryId
  );
}

export async function configuredRepositoryIsActive(
  repositoryId: string,
): Promise<boolean | undefined> {
  const database = await configuredDatabase();
  if (!database && !configuredMetadataPath()) return undefined;
  const record = await readConfiguredRepositoryRecord(repositoryId);
  return record?.state === "active" || !!record && record.state === undefined;
}

export async function writeConfiguredGitRefs(
  repositoryId: string,
  refs: GitRefSummary[],
): Promise<
  | { ok: true }
  | ({ ok: false } & GitJsonError)
> {
  const repository = await readConfiguredGitRepository(repositoryId);
  if (!repository.ok) return repository;
  for (const ref of refs) {
    if (!isSafeRefInput(ref.name) || !isLiteralObjectId(ref.target)) {
      return {
        ok: false,
        status: 400,
        body: {
          error: "refs must contain safe ref names and literal object ids",
          code: "invalid_repository_refs",
          repositoryId,
        },
      };
    }
    const output = await runGit([
      "--git-dir",
      repository.repositoryPath,
      "update-ref",
      // Defense-in-depth: stop git from interpreting a user-controlled ref name
      // as an option flag even if isSafeRefInput is ever loosened/bypassed.
      "--end-of-options",
      ref.name,
      ref.target,
    ]);
    if (!output.success) {
      return {
        ok: false,
        status: 422,
        body: {
          error: "ref target was not found in repository",
          code: "git_ref_target_not_found",
          repositoryId,
          objectId: ref.target,
        },
      };
    }
  }
  return { ok: true };
}

export async function verifyConfiguredGitCommit(
  repositoryId: string,
  objectId: string,
): Promise<{ ok: true; commit: string } | ({ ok: false } & GitJsonError)> {
  const repository = await readConfiguredGitRepository(repositoryId);
  if (!repository.ok) return repository;

  const output = await runGit([
    "--git-dir",
    repository.repositoryPath,
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${objectId}^{commit}`,
  ]);
  if (!output.success) {
    return {
      ok: false,
      status: 422,
      body: {
        error: "literal commit id was not found in repository",
        code: "git_commit_not_found",
        repositoryId,
        objectId,
      },
    };
  }
  return { ok: true, commit: textDecoder.decode(output.stdout).trim() };
}

export async function readConfiguredGitPrettyObject(
  repositoryId: string,
  objectId: string,
  maxBytes?: number,
): Promise<
  | {
    ok: true;
    objectId: string;
    type: string;
    size: number;
    prettyContent: Uint8Array;
  }
  | ({ ok: false } & GitObjectTooLargeError)
  | ({ ok: false } & GitJsonError)
> {
  const repository = await readConfiguredGitRepository(repositoryId);
  if (!repository.ok) return repository;
  if (!isLiteralObjectId(objectId)) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "objectId must be a literal SHA-1 or SHA-256 object id",
        code: "invalid_git_object_id",
        repositoryId,
        objectId,
      },
    };
  }

  const baseArgs = ["--git-dir", repository.repositoryPath] as const;
  const type = await runGit([...baseArgs, "cat-file", "-t", objectId]);
  if (!type.success) return gitObjectNotFound(repositoryId, objectId);
  const size = await runGit([...baseArgs, "cat-file", "-s", objectId]);
  if (!size.success) return gitObjectNotFound(repositoryId, objectId);
  const objectSize = Number(textDecoder.decode(size.stdout).trim());
  // Short-circuit BEFORE materializing the object: when a byte cap is
  // supplied and the object header size already exceeds it, return 413
  // without buffering the whole object into memory via cat-file -p.
  if (maxBytes !== undefined && objectSize > maxBytes) {
    return gitObjectTooLargeError(objectId, objectSize, maxBytes);
  }
  const prettyContent = await runGit([...baseArgs, "cat-file", "-p", objectId]);
  if (!prettyContent.success) return gitObjectNotFound(repositoryId, objectId);
  return {
    ok: true,
    objectId,
    type: textDecoder.decode(type.stdout).trim(),
    size: objectSize,
    prettyContent: prettyContent.stdout,
  };
}

export async function readConfiguredGitRawObject(
  repositoryId: string,
  objectId: string,
  maxBytes?: number,
): Promise<
  | {
    ok: true;
    objectId: string;
    type: string;
    size: number;
    content: Uint8Array;
  }
  | ({ ok: false } & GitObjectTooLargeError)
  | ({ ok: false } & GitJsonError)
> {
  const repository = await readConfiguredGitRepository(repositoryId);
  if (!repository.ok) return repository;
  if (!isLiteralObjectId(objectId)) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "objectId must be a literal SHA-1 or SHA-256 object id",
        code: "invalid_git_object_id",
        repositoryId,
        objectId,
      },
    };
  }

  const baseArgs = ["--git-dir", repository.repositoryPath] as const;
  const type = await runGit([...baseArgs, "cat-file", "-t", objectId]);
  if (!type.success) return gitObjectNotFound(repositoryId, objectId);
  const objectType = textDecoder.decode(type.stdout).trim();
  const size = await runGit([...baseArgs, "cat-file", "-s", objectId]);
  if (!size.success) return gitObjectNotFound(repositoryId, objectId);
  const objectSize = Number(textDecoder.decode(size.stdout).trim());
  // Short-circuit BEFORE materializing the object: when a byte cap is
  // supplied and the object header size already exceeds it, return 413
  // without buffering the whole object into memory via cat-file <type>.
  if (maxBytes !== undefined && objectSize > maxBytes) {
    return gitObjectTooLargeError(objectId, objectSize, maxBytes);
  }
  const content = await runGit([
    ...baseArgs,
    "cat-file",
    objectType,
    objectId,
  ]);
  if (!content.success) return gitObjectNotFound(repositoryId, objectId);
  return {
    ok: true,
    objectId,
    type: objectType,
    size: objectSize,
    content: content.stdout,
  };
}

export async function createConfiguredPullRequest(
  repositoryId: string,
  request: GitCreatePullRequestRequest,
  actor: TakosActorContext,
): Promise<
  | { ok: true; pullRequest: GitPullRequestDetail }
  | ({ ok: false } & GitJsonError)
> {
  const database = await configuredDatabase();
  if (!database) {
    return {
      ok: false,
      status: 501,
      body: notImplemented("git_pull_request_metadata_not_configured"),
    };
  }
  const repository = await readDatabaseRepositoryRecord(database, repositoryId);
  if (!repository || repository.state === "deleted") {
    return { ok: false, status: 404, body: repositoryNotFound(repositoryId) };
  }

  const duplicate = database.prepare(`
    SELECT id FROM pull_requests
    WHERE repository_id = ? AND head_branch = ? AND base_branch = ? AND status = 'open'
  `).get(repositoryId, request.headBranch, request.baseBranch);
  if (duplicate) {
    return {
      ok: false,
      status: 409,
      body: {
        error: "open pull request already exists for head and base branches",
        code: "git_pull_request_already_exists",
        repositoryId,
      },
    };
  }

  const now = new Date().toISOString();
  const nextNumber = nextPullRequestNumber(database, repositoryId);
  const id = `pr_${crypto.randomUUID()}`;
  database.prepare(`
    INSERT INTO pull_requests (
      id, repository_id, number, title, description, head_branch, base_branch,
      status, author_type, author_id, run_id, merged_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', 'account', ?, ?, NULL, ?, ?)
  `).run(
    id,
    repositoryId,
    nextNumber,
    request.title,
    request.description ?? null,
    request.headBranch,
    request.baseBranch,
    actor.actorAccountId,
    request.runId ?? null,
    now,
    now,
  );
  const pullRequest = readDatabasePullRequestDetailByNumber(
    database,
    repositoryId,
    nextNumber,
  );
  if (!pullRequest) {
    throw new Error("created pull request could not be read back");
  }
  return { ok: true, pullRequest };
}

export async function readConfiguredPullRequests(
  repositoryId: string,
  status?: GitPullRequestStatus,
): Promise<
  | { ok: true; pullRequests: GitPullRequestDetail[] }
  | ({ ok: false } & GitJsonError)
> {
  const database = await configuredDatabase();
  if (!database) {
    return {
      ok: false,
      status: 501,
      body: notImplemented("git_pull_request_metadata_not_configured"),
    };
  }
  const repository = await readDatabaseRepositoryRecord(database, repositoryId);
  if (!repository || repository.state === "deleted") {
    return { ok: false, status: 404, body: repositoryNotFound(repositoryId) };
  }
  const rows = status
    ? database.prepare(`
      SELECT id, repository_id, number, title, description, head_branch,
        base_branch, status, author_id, run_id, merged_at, created_at, updated_at
      FROM pull_requests
      WHERE repository_id = ? AND status = ?
      ORDER BY number DESC
    `).all(repositoryId, status)
    : database.prepare(`
      SELECT id, repository_id, number, title, description, head_branch,
        base_branch, status, author_id, run_id, merged_at, created_at, updated_at
      FROM pull_requests
      WHERE repository_id = ?
      ORDER BY number DESC
    `).all(repositoryId);
  return {
    ok: true,
    pullRequests: rows.map((row) => databasePullRequestDetail(database, row)),
  };
}

export async function readConfiguredPullRequest(
  repositoryId: string,
  number: number,
): Promise<
  | { ok: true; pullRequest: GitPullRequestDetail }
  | ({ ok: false } & GitJsonError)
> {
  const database = await configuredDatabase();
  if (!database) {
    return {
      ok: false,
      status: 501,
      body: notImplemented("git_pull_request_metadata_not_configured"),
    };
  }
  const pullRequest = readDatabasePullRequestDetailByNumber(
    database,
    repositoryId,
    number,
  );
  if (!pullRequest) return pullRequestNotFound(repositoryId, number);
  return { ok: true, pullRequest };
}

export async function updateConfiguredPullRequest(
  repositoryId: string,
  number: number,
  request: GitUpdatePullRequestRequest,
): Promise<
  | { ok: true; pullRequest: GitPullRequestDetail }
  | ({ ok: false } & GitJsonError)
> {
  const database = await configuredDatabase();
  if (!database) {
    return {
      ok: false,
      status: 501,
      body: notImplemented("git_pull_request_metadata_not_configured"),
    };
  }
  const existing = readDatabasePullRequestDetailByNumber(
    database,
    repositoryId,
    number,
  );
  if (!existing) return pullRequestNotFound(repositoryId, number);
  const nextStatus = request.status ?? existing.status;
  const mergedAt = nextStatus === "merged"
    ? existing.mergedAt ?? new Date().toISOString()
    : existing.mergedAt;
  database.prepare(`
    UPDATE pull_requests
    SET title = ?, description = ?, status = ?, merged_at = ?, updated_at = ?
    WHERE repository_id = ? AND number = ?
  `).run(
    request.title ?? existing.title,
    request.description ?? existing.description ?? null,
    nextStatus,
    mergedAt ?? null,
    new Date().toISOString(),
    repositoryId,
    number,
  );
  const pullRequest = readDatabasePullRequestDetailByNumber(
    database,
    repositoryId,
    number,
  );
  if (!pullRequest) return pullRequestNotFound(repositoryId, number);
  return { ok: true, pullRequest };
}

export async function createConfiguredPullRequestComment(
  repositoryId: string,
  number: number,
  request: GitCreatePullRequestCommentRequest,
  actor: TakosActorContext,
): Promise<
  | { ok: true; comment: GitPullRequestComment }
  | ({ ok: false } & GitJsonError)
> {
  const database = await configuredDatabase();
  if (!database) {
    return {
      ok: false,
      status: 501,
      body: notImplemented("git_pull_request_metadata_not_configured"),
    };
  }
  const pullRequest = readDatabasePullRequestRowByNumber(
    database,
    repositoryId,
    number,
  );
  if (!pullRequest) return pullRequestNotFound(repositoryId, number);
  const now = new Date().toISOString();
  const id = `prc_${crypto.randomUUID()}`;
  database.prepare(`
    INSERT INTO pr_comments (
      id, pull_request_id, author_type, author_id, body, path, line, created_at
    ) VALUES (?, ?, 'account', ?, ?, ?, ?, ?)
  `).run(
    id,
    pullRequest.id,
    actor.actorAccountId,
    request.body,
    request.path ?? null,
    request.line ?? null,
    now,
  );
  return {
    ok: true,
    comment: {
      id,
      pullRequestId: pullRequest.id,
      authorAccountId: actor.actorAccountId,
      body: request.body,
      path: request.path,
      line: request.line,
      createdAt: now,
    },
  };
}

export async function createConfiguredPullRequestReview(
  repositoryId: string,
  number: number,
  request: GitCreatePullRequestReviewRequest,
  actor: TakosActorContext,
): Promise<
  | { ok: true; review: GitPullRequestReview }
  | ({ ok: false } & GitJsonError)
> {
  const database = await configuredDatabase();
  if (!database) {
    return {
      ok: false,
      status: 501,
      body: notImplemented("git_pull_request_metadata_not_configured"),
    };
  }
  const pullRequest = readDatabasePullRequestRowByNumber(
    database,
    repositoryId,
    number,
  );
  if (!pullRequest) return pullRequestNotFound(repositoryId, number);
  const now = new Date().toISOString();
  const id = `prr_${crypto.randomUUID()}`;
  database.prepare(`
    INSERT INTO pr_reviews (
      id, pull_request_id, reviewer_type, reviewer_id, status, body, analysis, created_at
    ) VALUES (?, ?, 'account', ?, ?, ?, ?, ?)
  `).run(
    id,
    pullRequest.id,
    actor.actorAccountId,
    request.status,
    request.body ?? null,
    request.analysis ?? null,
    now,
  );
  return {
    ok: true,
    review: {
      id,
      pullRequestId: pullRequest.id,
      reviewerAccountId: actor.actorAccountId,
      status: request.status,
      body: request.body,
      analysis: request.analysis,
      createdAt: now,
    },
  };
}

export async function runGit(
  args: string[],
  stdin?: Uint8Array,
  env?: Record<string, string>,
): Promise<CommandOutput> {
  const scrubbedEnv = buildScrubbedGitEnv(env);
  if (!stdin) {
    return await spawnCommand("git", {
      args,
      stdout: "pipe",
      stderr: "pipe",
      env: scrubbedEnv,
    }).output();
  }

  const child = spawnCommand("git", {
    args,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: scrubbedEnv,
  });
  await child.stdin.write(stdin);
  child.stdin.end();
  return await child.output();
}

/**
 * Run a `git` invocation while bounding how large `gitDir` may grow on disk.
 *
 * Used by external import / fetch so a hostile or runaway remote cannot fill
 * the disk via an unbounded pack: while git streams the pack into the bare
 * repo, we poll the directory's apparent size every `pollIntervalMs` (default
 * 500ms) and, once a sample exceeds `maxBytes`, SIGTERM the process and report
 * `exceededSizeCap`. This is a periodic SOFT cap, not an instantaneous one: a
 * fetch can overshoot `maxBytes` by up to roughly one poll interval of write
 * throughput before the next sample fires, so size `maxBytes` to leave that
 * headroom. It fails closed — the partial repo is left for the caller to clean
 * up. Normal repos under the cap are unaffected (the poll just observes a size
 * below the cap and the command completes exactly as `runGit` would). The same
 * scrubbed env / protocol-allowlist hardening as `runGit` is applied.
 */
export async function runGitWithDirectorySizeCap(
  args: string[],
  gitDir: string,
  maxBytes: number,
  options: { pollIntervalMs?: number } = {},
): Promise<{ output: CommandOutput; exceededSizeCap: boolean }> {
  const scrubbedEnv = buildScrubbedGitEnv(undefined);
  const child = spawnCommand("git", {
    args,
    stdout: "pipe",
    stderr: "pipe",
    env: scrubbedEnv,
  });

  let exceededSizeCap = false;
  let stopped = false;
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const poll = (async () => {
    while (!stopped) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      if (stopped) break;
      const size = await directoryApparentSize(gitDir);
      if (size !== undefined && size > maxBytes) {
        exceededSizeCap = true;
        try {
          child.kill("SIGTERM");
        } catch (_error) {
          // process may already have exited
        }
        break;
      }
    }
  })();

  const output = await child.output();
  stopped = true;
  await poll.catch(() => {});
  return { output, exceededSizeCap };
}

/**
 * Apparent on-disk byte size of `path` via `du -sb`. Returns undefined when the
 * measurement cannot be taken (e.g. the directory does not yet exist or `du`
 * fails), so the caller treats an unmeasurable size as "not over the cap" and
 * relies on the next poll / process exit rather than aborting a healthy fetch.
 */
async function directoryApparentSize(path: string): Promise<number | undefined> {
  try {
    const result = await spawnCommand("du", {
      args: ["-sb", path],
      stdout: "pipe",
      stderr: "pipe",
    }).output();
    if (!result.success) return undefined;
    const first = textDecoder.decode(result.stdout).trimStart().split(/\s+/, 1)[0];
    const parsed = Number(first);
    return Number.isFinite(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Apply HARDENED_BARE_REPO_CONFIG to an existing bare repository.
 *
 * Used by the startup backfill migration so that bare repositories
 * that were created before the hardening config existed pick up the
 * same `receive.deny*` / `transfer.fsckObjects` / `core.hooksPath`
 * settings as freshly-created repositories. Idempotent: writing a
 * config key that already has the desired value is a no-op for git.
 *
 * Returns true if the config was applied (or already had been). A
 * false return means at least one `git config` invocation failed and
 * the caller should log the path for follow-up.
 */
export async function applyHardenedConfigToExistingRepo(
  repoPath: string,
): Promise<boolean> {
  if (await hardeningMarkerExists(repoPath)) return true;
  for (const [key, value] of HARDENED_BARE_REPO_CONFIG) {
    const result = await runGit([
      "--git-dir",
      repoPath,
      "config",
      key,
      value,
    ]);
    if (!result.success) return false;
  }
  await writeHardeningMarker(repoPath).catch(() => {});
  return true;
}

async function writeHardeningMarker(repoPath: string): Promise<void> {
  await writeText(
    `${repoPath}/${HARDENING_MARKER_FILENAME}`,
    `${new Date().toISOString()}\n`,
  );
}

async function hardeningMarkerExists(repoPath: string): Promise<boolean> {
  try {
    await pathStat(`${repoPath}/${HARDENING_MARKER_FILENAME}`);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

/**
 * Startup migration: walk every bare repository under
 * `TAKOS_GIT_REPOSITORY_ROOT` and ensure it has the hardened receive /
 * transfer / hooks config. This is intended to run once at server boot
 * (via `runRepositoryHardeningBackfillOnce`) so that any repositories
 * that pre-date `HARDENED_BARE_REPO_CONFIG` get retro-fixed. Each repo
 * gets a `.takos-hardening-applied` marker file so the walk skips
 * already-fixed repos on subsequent restarts.
 *
 * Subdirectories named ending in `.git` are treated as bare repos.
 * Errors are returned per-repo so the caller can log them without
 * aborting boot.
 */
export async function runRepositoryHardeningBackfill(
  options: { root?: string } = {},
): Promise<{
  scanned: number;
  applied: number;
  skipped: number;
  failed: Array<{ path: string }>;
}> {
  const root = options.root ?? configuredRepositoryRoot();
  const summary = {
    scanned: 0,
    applied: 0,
    skipped: 0,
    failed: [] as Array<{ path: string }>,
  };
  if (!root) return summary;
  try {
    await pathStat(root);
  } catch (error) {
    if (isNotFoundError(error)) return summary;
    throw error;
  }
  for await (const candidate of walkBareRepositories(root)) {
    summary.scanned += 1;
    if (await hardeningMarkerExists(candidate)) {
      summary.skipped += 1;
      continue;
    }
    const ok = await applyHardenedConfigToExistingRepo(candidate);
    if (ok) summary.applied += 1;
    else summary.failed.push({ path: candidate });
  }
  return summary;
}

let hardeningBackfillPromise: Promise<unknown> | undefined;

/**
 * Run the hardening backfill exactly once per process. Subsequent
 * callers receive the same promise so we do not race when multiple
 * request handlers fire in parallel during cold start.
 */
export function runRepositoryHardeningBackfillOnce(): Promise<unknown> {
  if (hardeningBackfillPromise) return hardeningBackfillPromise;
  hardeningBackfillPromise = runRepositoryHardeningBackfill().catch((error) => {
    console.error(
      "takos-git: repository hardening backfill failed",
      error instanceof Error ? error.message : error,
    );
  });
  return hardeningBackfillPromise;
}

async function* walkBareRepositories(root: string): AsyncIterable<string> {
  // We only descend through `<owner>/<name>.git` style layouts. Any
  // directory whose name ends in `.git` is treated as a candidate bare
  // repository. We do not follow symlinks to avoid escaping the root.
  const queue: Array<{ path: string; depth: number }> = [{
    path: root,
    depth: 0,
  }];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth > 4) continue;
    let entries: DirEntry[];
    try {
      entries = await collectDirEntries(current.path);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymlink) continue;
      const childPath = `${current.path}/${entry.name}`;
      if (!entry.isDirectory) continue;
      if (entry.name.endsWith(".git")) {
        // Treat as a bare repo iff it has a `HEAD` file at the top
        // level (cheap sanity check that we are looking at git data).
        if (await fileExists(`${childPath}/HEAD`)) {
          yield childPath;
        }
        continue;
      }
      queue.push({ path: childPath, depth: current.depth + 1 });
    }
  }
}

async function collectDirEntries(path: string): Promise<DirEntry[]> {
  return await readDirEntries(path);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const stat = await pathStat(path);
    return stat.isFile;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

/**
 * Build a minimal environment for `git` subprocess invocations.
 *
 * The parent process inherits whatever `GIT_*`, `SSH_*`, `LD_*`,
 * `XDG_*`, and other env vars are present in its launch environment.
 * Many of those are dangerous for `git`:
 *   - `GIT_DIR`, `GIT_WORK_TREE`, `GIT_CONFIG_*` redirect git at our
 *     intended bare repo and let an attacker swap in a hostile config.
 *   - `GIT_SSH_COMMAND`, `SSH_AUTH_SOCK`, `SSH_*` change how SSH-shorthand
 *     URLs authenticate and which keys they use.
 *   - `LD_PRELOAD`, `LD_LIBRARY_PATH` can swap shared libraries under git.
 *   - `HTTP_PROXY` / `HTTPS_PROXY` can redirect outbound traffic.
 *
 * We pass a closed-shape env containing only PATH (constrained to known
 * system dirs), HOME (a dedicated temp dir so git cannot pick up an
 * operator's ~/.gitconfig), LANG=C / LC_ALL=C for deterministic output,
 * and whatever explicit overrides the caller asked for. The caller's
 * env wins, so per-invocation overrides (e.g. INITIAL_COMMIT_ENV) still
 * work.
 */
function buildScrubbedGitEnv(
  caller: Record<string, string> | undefined,
): Record<string, string> {
  // Restrict PATH to system locations that are expected to hold `git`.
  // If the operator's git lives elsewhere we let TAKOS_GIT_PATH override.
  const overridePath = getEnv("TAKOS_GIT_PATH")?.trim();
  const path = overridePath && overridePath.length > 0
    ? overridePath
    : "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
  const home = takosGitTempHome();
  const base: Record<string, string> = {
    PATH: path,
    HOME: home,
    LANG: "C",
    LC_ALL: "C",
    // Prevent git from prompting interactively if a fetch hits an
    // auth-required remote; we want it to fail fast.
    GIT_TERMINAL_PROMPT: "0",
  };
  if (!caller) return base;
  // Caller-supplied env overrides (e.g. GIT_AUTHOR_* for the initial
  // commit) are applied on top of the scrubbed base. Caller cannot
  // re-introduce SSH / LD vars unless they explicitly choose to.
  return { ...base, ...caller };
}

let cachedTakosGitTempHome: string | undefined;

function takosGitTempHome(): string {
  if (cachedTakosGitTempHome !== undefined) return cachedTakosGitTempHome;
  try {
    cachedTakosGitTempHome = makeTempDirSync("takos-git-home-");
  } catch {
    // Fallback for permission-restricted runtimes: use /tmp directly.
    cachedTakosGitTempHome = "/tmp";
  }
  return cachedTakosGitTempHome;
}

export function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

export function repositoryNotFound(repositoryId: string) {
  return {
    error: "repository not found",
    code: "git_repository_not_found",
    repositoryId,
  };
}

export function notImplemented(code: string) {
  return {
    error: "not implemented or not configured in takos-git",
    code,
  };
}

async function readConfiguredGitRepository(
  repositoryId: string,
): Promise<
  | { ok: true; repositoryPath: string }
  | ({ ok: false } & GitJsonError)
> {
  const repositoryPath = configuredRepositoryPath(repositoryId);
  if (!repositoryPath) {
    return {
      ok: false,
      status: 501,
      body: notImplemented("git_repository_root_not_configured"),
    };
  }
  if (!isSafeRepositoryId(repositoryId)) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "repositoryId must be a safe relative bare repository path",
        code: "invalid_git_repository_id",
        repositoryId,
      },
    };
  }
  const active = await configuredRepositoryIsActive(repositoryId);
  if (active === false) {
    return {
      ok: false,
      status: 404,
      body: repositoryNotFound(repositoryId),
    };
  }
  if (!(await directoryExists(repositoryPath))) {
    return {
      ok: false,
      status: 404,
      body: repositoryNotFound(repositoryId),
    };
  }
  return { ok: true, repositoryPath };
}

async function configuredDatabase(): Promise<DatabaseSync | undefined> {
  const path = configuredDatabasePath();
  if (!path) return undefined;
  if (cachedDatabase?.path === path) return cachedDatabase.database;
  cachedDatabase?.database.close();

  await makeDirectory(parentDirectory(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  runSqliteMigrations(database);
  cachedDatabase = { path, database };
  migrateJsonMetadataToDatabase(database);
  return database;
}

function runSqliteMigrations(database: DatabaseSync): void {
  const hasMigration = database.prepare(
    "SELECT 1 FROM schema_migrations WHERE version = ?",
  );
  const insertMigration = database.prepare(
    "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
  );
  for (const migration of SQLITE_MIGRATIONS) {
    if (hasMigration.get(migration.version)) continue;
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      insertMigration.run(migration.version, new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

function migrateJsonMetadataToDatabase(database: DatabaseSync): void {
  const jsonPath = configuredMetadataPath();
  if (!jsonPath || cachedDatabase?.migratedJsonPath === jsonPath) return;
  const existing = database.prepare(
    "SELECT COUNT(*) AS count FROM repositories",
  )
    .get() as { count: number };
  if (existing.count > 0) {
    cachedDatabase = cachedDatabase
      ? { ...cachedDatabase, migratedJsonPath: jsonPath }
      : cachedDatabase;
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readTextFileSync(jsonPath));
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }
  if (!parsed || typeof parsed !== "object") return;
  const repositories = (parsed as { repositories?: unknown }).repositories;
  if (!Array.isArray(repositories)) return;
  writeDatabaseRepositoryMetadata(
    database,
    repositories.filter(isRepositoryMetadataRecord),
  );
  cachedDatabase = cachedDatabase
    ? { ...cachedDatabase, migratedJsonPath: jsonPath }
    : cachedDatabase;
}

function readDatabaseRepositoryMetadata(
  database: DatabaseSync,
): GitRepositoryMetadataRecord[] {
  return database.prepare(
    `SELECT id, name, owner_account_id, default_branch, refs_json, state, created_at, updated_at
     FROM repositories
     ORDER BY updated_at DESC, id ASC`,
  ).all().map(databaseRepositoryRecord);
}

function readDatabaseRepositoryRecord(
  database: DatabaseSync,
  repositoryId: string,
): GitRepositoryMetadataRecord | undefined {
  const row = database.prepare(
    `SELECT id, name, owner_account_id, default_branch, refs_json, state, created_at, updated_at
     FROM repositories
     WHERE id = ?`,
  ).get(repositoryId);
  return row ? databaseRepositoryRecord(row) : undefined;
}

function writeDatabaseRepositoryMetadata(
  database: DatabaseSync,
  repositories: GitRepositoryMetadataRecord[],
): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    const activeRows = database.prepare(
      "SELECT id FROM repositories WHERE state = 'active'",
    ).all() as Array<{ id: string }>;
    const nextIds = new Set(repositories.map((repository) => repository.id));
    for (const row of activeRows) {
      if (!nextIds.has(row.id)) {
        database.prepare(
          "UPDATE repositories SET state = 'deleted', updated_at = ? WHERE id = ?",
        ).run(new Date().toISOString(), row.id);
      }
    }
    const upsert = database.prepare(`
      INSERT INTO repositories (
        id, name, owner_account_id, default_branch, refs_json, state, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        owner_account_id = excluded.owner_account_id,
        default_branch = excluded.default_branch,
        refs_json = excluded.refs_json,
        state = excluded.state,
        updated_at = excluded.updated_at
    `);
    for (const repository of repositories) {
      upsert.run(
        repository.id,
        repository.name,
        repository.ownerSpaceId,
        repository.defaultBranch,
        JSON.stringify(repository.refs),
        repository.state ?? "active",
        repository.createdAt,
        repository.updatedAt,
      );
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

/**
 * Upsert a single repository row without touching any other row. Unlike
 * {@link writeDatabaseRepositoryMetadata}, this never reconciles (tombstones)
 * rows that are absent from a caller's snapshot, so two concurrent requests
 * each creating a different repository cannot delete each other's row.
 */
function upsertDatabaseRepositoryRecord(
  database: DatabaseSync,
  repository: GitRepositoryMetadataRecord,
): void {
  database.prepare(`
    INSERT INTO repositories (
      id, name, owner_account_id, default_branch, refs_json, state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      owner_account_id = excluded.owner_account_id,
      default_branch = excluded.default_branch,
      refs_json = excluded.refs_json,
      state = excluded.state,
      updated_at = excluded.updated_at
  `).run(
    repository.id,
    repository.name,
    repository.ownerSpaceId,
    repository.defaultBranch,
    JSON.stringify(repository.refs),
    repository.state ?? "active",
    repository.createdAt,
    repository.updatedAt,
  );
}

/**
 * Soft-delete a single repository row (state = 'deleted'). Returns true when an
 * active row was found and tombstoned. Targets one row only.
 */
function deleteDatabaseRepositoryRecord(
  database: DatabaseSync,
  repositoryId: string,
): boolean {
  const row = database.prepare(
    "SELECT 1 FROM repositories WHERE id = ? AND state = 'active'",
  ).get(repositoryId);
  if (!row) return false;
  database.prepare(
    "UPDATE repositories SET state = 'deleted', updated_at = ? WHERE id = ?",
  ).run(new Date().toISOString(), repositoryId);
  return true;
}

function databaseRepositoryRecord(row: unknown): GitRepositoryMetadataRecord {
  const record = row as {
    id: string;
    name: string;
    owner_account_id: string;
    default_branch: string;
    refs_json: string;
    state: GitRepositoryMetadataRecord["state"];
    created_at: string;
    updated_at: string;
  };
  return {
    id: record.id,
    name: record.name,
    ownerSpaceId: record.owner_account_id, // historical column name
    defaultBranch: record.default_branch,
    refs: parseRefsJson(record.refs_json),
    state: record.state,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

function nextPullRequestNumber(
  database: DatabaseSync,
  repositoryId: string,
): number {
  const row = database.prepare(
    "SELECT COALESCE(MAX(number), 0) + 1 AS next_number FROM pull_requests WHERE repository_id = ?",
  ).get(repositoryId) as { next_number: number };
  return row.next_number;
}

function readDatabasePullRequestDetailByNumber(
  database: DatabaseSync,
  repositoryId: string,
  number: number,
): GitPullRequestDetail | undefined {
  const row = database.prepare(`
    SELECT id, repository_id, number, title, description, head_branch,
      base_branch, status, author_id, run_id, merged_at, created_at, updated_at
    FROM pull_requests
    WHERE repository_id = ? AND number = ?
  `).get(repositoryId, number);
  return row ? databasePullRequestDetail(database, row) : undefined;
}

function readDatabasePullRequestRowByNumber(
  database: DatabaseSync,
  repositoryId: string,
  number: number,
): PullRequestRow | undefined {
  const row = database.prepare(`
    SELECT id, repository_id, number, title, description, head_branch,
      base_branch, status, author_id, run_id, merged_at, created_at, updated_at
    FROM pull_requests
    WHERE repository_id = ? AND number = ?
  `).get(repositoryId, number);
  return row ? pullRequestRow(row) : undefined;
}

function databasePullRequestDetail(
  database: DatabaseSync,
  row: unknown,
): GitPullRequestDetail {
  const pullRequest = pullRequestRow(row);
  const comments = database.prepare(`
    SELECT id, pull_request_id, author_id, body, path, line, created_at
    FROM pr_comments
    WHERE pull_request_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(pullRequest.id).map(databasePullRequestComment);
  const reviews = database.prepare(`
    SELECT id, pull_request_id, reviewer_id, status, body, analysis, created_at
    FROM pr_reviews
    WHERE pull_request_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(pullRequest.id).map(databasePullRequestReview);
  return {
    id: pullRequest.id,
    repositoryId: pullRequest.repositoryId,
    number: pullRequest.number,
    title: pullRequest.title,
    description: pullRequest.description ?? undefined,
    headBranch: pullRequest.headBranch,
    baseBranch: pullRequest.baseBranch,
    status: pullRequest.status,
    authorAccountId: pullRequest.authorId ?? undefined,
    runId: pullRequest.runId ?? undefined,
    mergedAt: pullRequest.mergedAt ?? undefined,
    createdAt: pullRequest.createdAt,
    updatedAt: pullRequest.updatedAt,
    comments,
    reviews,
  };
}

type PullRequestRow = {
  id: string;
  repositoryId: string;
  number: number;
  title: string;
  description?: string;
  headBranch: string;
  baseBranch: string;
  status: GitPullRequestStatus;
  authorId?: string;
  runId?: string;
  mergedAt?: string;
  createdAt: string;
  updatedAt: string;
};

function pullRequestRow(row: unknown): PullRequestRow {
  const record = row as {
    id: string;
    repository_id: string;
    number: number;
    title: string;
    description: string | null;
    head_branch: string;
    base_branch: string;
    status: GitPullRequestStatus;
    author_id: string | null;
    run_id: string | null;
    merged_at: string | null;
    created_at: string;
    updated_at: string;
  };
  return {
    id: record.id,
    repositoryId: record.repository_id,
    number: record.number,
    title: record.title,
    description: record.description ?? undefined,
    headBranch: record.head_branch,
    baseBranch: record.base_branch,
    status: record.status,
    authorId: record.author_id ?? undefined,
    runId: record.run_id ?? undefined,
    mergedAt: record.merged_at ?? undefined,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

function databasePullRequestComment(row: unknown): GitPullRequestComment {
  const record = row as {
    id: string;
    pull_request_id: string;
    author_id: string | null;
    body: string;
    path: string | null;
    line: number | null;
    created_at: string;
  };
  return {
    id: record.id,
    pullRequestId: record.pull_request_id,
    authorAccountId: record.author_id ?? undefined,
    body: record.body,
    path: record.path ?? undefined,
    line: record.line ?? undefined,
    createdAt: record.created_at,
  };
}

function databasePullRequestReview(row: unknown): GitPullRequestReview {
  const record = row as {
    id: string;
    pull_request_id: string;
    reviewer_id: string | null;
    status: GitPullRequestReview["status"];
    body: string | null;
    analysis: string | null;
    created_at: string;
  };
  return {
    id: record.id,
    pullRequestId: record.pull_request_id,
    reviewerAccountId: record.reviewer_id ?? undefined,
    status: record.status,
    body: record.body ?? undefined,
    analysis: record.analysis ?? undefined,
    createdAt: record.created_at,
  };
}

function pullRequestNotFound(
  repositoryId: string,
  pullRequestNumber: number,
): { ok: false } & GitJsonError {
  return {
    ok: false,
    status: 404,
    body: {
      error: "pull request not found",
      code: "git_pull_request_not_found",
      repositoryId,
      pullRequestNumber,
    },
  };
}

function parseRefsJson(value: string): GitRefSummary[] {
  try {
    const refs: unknown = JSON.parse(value);
    if (!Array.isArray(refs)) return [];
    return refs.filter((ref): ref is GitRefSummary =>
      ref && typeof ref === "object" &&
      typeof (ref as GitRefSummary).name === "string" &&
      typeof (ref as GitRefSummary).target === "string"
    );
  } catch {
    return [];
  }
}

function gitObjectNotFound(
  repositoryId: string,
  objectId: string,
): { ok: false } & GitJsonError {
  return {
    ok: false,
    status: 404,
    body: {
      error: "git object not found",
      code: "git_object_not_found",
      repositoryId,
      objectId,
    },
  };
}

// Produces the same 413 envelope shape as response-builders.gitObjectTooLarge
// (error/code/objectId/size/maxBytes). Defined locally here so git.ts does not
// need to import from response-builders.ts (which already imports from git.ts),
// avoiding an import cycle.
function gitObjectTooLargeError(
  objectId: string,
  size: number,
  maxBytes: number,
): { ok: false } & GitObjectTooLargeError {
  return {
    ok: false,
    status: 413,
    body: {
      error: "git object exceeds configured response size limit",
      code: "git_object_too_large",
      objectId,
      size,
      maxBytes,
    },
  };
}

async function initializeDefaultBranch(
  repositoryPath: string,
  defaultBranch: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSafeRefInput(defaultBranch) || defaultBranch.startsWith("refs/")) {
    return { ok: false, error: "invalid default branch" };
  }
  const emptyTree = await runGit([
    "--git-dir",
    repositoryPath,
    "mktree",
  ], new Uint8Array());
  if (!emptyTree.success) {
    return { ok: false, error: "failed to create empty tree" };
  }
  const treeId = textDecoder.decode(emptyTree.stdout).trim();
  const commit = await runGit(
    [
      "--git-dir",
      repositoryPath,
      "commit-tree",
      treeId,
      "-m",
      "Initial commit",
    ],
    undefined,
    INITIAL_COMMIT_ENV,
  );
  if (!commit.success) {
    return { ok: false, error: "failed to create initial commit" };
  }
  const commitId = textDecoder.decode(commit.stdout).trim();
  const ref = `refs/heads/${defaultBranch}`;
  const update = await runGit([
    "--git-dir",
    repositoryPath,
    "update-ref",
    ref,
    commitId,
  ]);
  if (!update.success) {
    return { ok: false, error: "failed to update default branch" };
  }
  const head = await runGit([
    "--git-dir",
    repositoryPath,
    "symbolic-ref",
    "HEAD",
    ref,
  ]);
  if (!head.success) return { ok: false, error: "failed to update HEAD" };
  return { ok: true };
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await pathStat(path)).isDirectory;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await pathStat(path);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

async function removeDirectoryIfExists(path: string): Promise<void> {
  try {
    await removePath(path, { recursive: true });
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }
}

function parentDirectory(path: string): string {
  const normalized = path.replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return "/";
  return normalized.slice(0, index);
}

function isRepositoryMetadataRecord(
  value: unknown,
): value is GitRepositoryMetadataRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<GitRepositoryMetadataRecord>;
  return typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.ownerSpaceId === "string" &&
    typeof record.defaultBranch === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string" &&
    Array.isArray(record.refs) &&
    record.refs.every((ref) =>
      ref && typeof ref === "object" &&
      typeof (ref as GitRefSummary).name === "string" &&
      typeof (ref as GitRefSummary).target === "string"
    );
}

function isSafePathSegment(segment: string): boolean {
  return segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    !segment.includes("\\") &&
    // Reject leading-dot segments: prevents `.git`, `..` traversal,
    // hidden-directory tricks, and `.something/` paths in repository
    // ids or smart HTTP routes.
    /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(segment);
}
