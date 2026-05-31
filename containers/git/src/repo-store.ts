import type {
  GitCreateRepositoryRequest,
  GitListRefsResponse,
  GitRefSummary,
  GitRepositoryDetail,
  GitRepositorySummary,
} from "takos-git-contract";
import {
  canAccessRepositoryOwner,
  repositoryAccessDenied,
  type TakosGitInternalAuth,
} from "./auth.ts";
import {
  createConfiguredBareRepository,
  deleteConfiguredRepositoryMetadata,
  devInMemoryMetadataEnabled,
  type GitRepositoryMetadataRecord,
  isLiteralObjectId,
  readConfiguredGitRefs,
  readConfiguredRepositoryMetadata,
  repositoryNotFound,
  upsertConfiguredRepositoryMetadata,
  writeConfiguredRepositoryMetadata,
} from "./git.ts";
import { canonicalRefName } from "./response-builders.ts";

/**
 * Process-local mutex that serializes whole-set writeRepositories calls and the
 * dev in-memory map mutations. NOTE: this only serializes within one isolate;
 * it does NOT coordinate across processes/replicas. Cross-process safety for
 * the persistent store comes from the storage layer: targeted single-row
 * upsert/delete on the SQLite path, or a single-host advisory file lock on the
 * JSON fallback (see git.ts). Prefer {@link upsertRepository} /
 * {@link deleteRepository} over the whole-set {@link writeRepositories}, which
 * is retained only for the dev in-memory path and full-snapshot rewrites.
 */
let writeLock = Promise.resolve();

async function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = writeLock;
  let resolve: () => void;
  writeLock = new Promise<void>((r) => {
    resolve = r;
  });
  await prev;
  try {
    return await fn();
  } finally {
    resolve!();
  }
}

export interface StoredGitRepository {
  id: string;
  name: string;
  ownerSpaceId: string;
  defaultBranch: string;
  refs: Map<string, string>;
  createdAt: string;
  updatedAt: string;
}

const repositories = new Map<string, StoredGitRepository>();

export async function readRepositories(): Promise<StoredGitRepository[]> {
  const persisted = await readConfiguredRepositoryMetadata();
  if (persisted) return persisted.map(metadataToStoredRepository);
  if (!devInMemoryMetadataEnabled()) return [];
  return [...repositories.values()];
}

export async function findRepository(
  repositoryId: string,
): Promise<StoredGitRepository | undefined> {
  return (await readRepositories()).find((repository) =>
    repository.id === repositoryId
  );
}

export async function writeRepositories(
  updatedRepositories: StoredGitRepository[],
): Promise<void> {
  await withWriteLock(async () => {
    const persisted = await readConfiguredRepositoryMetadata();
    if (persisted) {
      await writeConfiguredRepositoryMetadata(
        updatedRepositories.map(storedRepositoryToMetadata),
      );
      return;
    }
    if (!devInMemoryMetadataEnabled()) return;
    repositories.clear();
    for (const repository of updatedRepositories) {
      repositories.set(repository.id, repository);
    }
  });
}

/**
 * Create or update a single repository. Persists via a targeted single-row
 * upsert (no whole-set reconciliation), so a concurrent request creating a
 * different repository cannot tombstone this one. Falls back to the dev
 * in-memory map when no persistent store is configured.
 */
export async function upsertRepository(
  repository: StoredGitRepository,
): Promise<void> {
  await withWriteLock(async () => {
    const persisted = await readConfiguredRepositoryMetadata();
    if (persisted) {
      await upsertConfiguredRepositoryMetadata(
        storedRepositoryToMetadata(repository),
      );
      return;
    }
    if (!devInMemoryMetadataEnabled()) return;
    repositories.set(repository.id, repository);
  });
}

/**
 * Soft-delete a single repository's metadata. Targets one row only. Returns
 * true when a record existed and was removed.
 */
export async function deleteRepository(repositoryId: string): Promise<boolean> {
  return await withWriteLock(async () => {
    const persisted = await readConfiguredRepositoryMetadata();
    if (persisted) {
      return await deleteConfiguredRepositoryMetadata(repositoryId);
    }
    if (!devInMemoryMetadataEnabled()) return false;
    return repositories.delete(repositoryId);
  });
}

export function canReadRepository(
  auth: TakosGitInternalAuth,
  repository: StoredGitRepository,
): boolean {
  return canAccessRepositoryOwner(auth, repository.ownerSpaceId, "read");
}

export function canWriteRepository(
  auth: TakosGitInternalAuth,
  repository: StoredGitRepository,
): boolean {
  return canAccessRepositoryOwner(auth, repository.ownerSpaceId, "write");
}

export async function requireRepositoryRead(
  auth: TakosGitInternalAuth,
  repositoryId: string,
): Promise<
  | { ok: true; repository: StoredGitRepository }
  | {
    ok: false;
    body: { error: string; code: string; repositoryId: string };
    status: 403 | 404;
  }
> {
  const repository = await findRepository(repositoryId);
  if (!repository) {
    return { ok: false, body: repositoryNotFound(repositoryId), status: 404 };
  }
  if (!canReadRepository(auth, repository)) {
    return {
      ok: false,
      body: repositoryAccessDenied(repositoryId),
      status: 403,
    };
  }
  return { ok: true, repository };
}

export async function requireRepositoryWrite(
  auth: TakosGitInternalAuth,
  repositoryId: string,
): Promise<
  | { ok: true; repository: StoredGitRepository }
  | {
    ok: false;
    body: { error: string; code: string; repositoryId: string };
    status: 403 | 404;
  }
> {
  const access = await requireRepositoryRead(auth, repositoryId);
  if (!access.ok) return access;
  if (!canWriteRepository(auth, access.repository)) {
    return {
      ok: false,
      body: repositoryAccessDenied(repositoryId),
      status: 403,
    };
  }
  return access;
}

export async function createRepositoryStorage(
  repositoryId: string,
  options: { defaultBranch: string; mode: "default" | "bare" },
): Promise<
  | { ok: true }
  | {
    ok: false;
    body: { error: string; code: string; repositoryId?: string };
    status: 400 | 404 | 409 | 422 | 500 | 501;
  }
> {
  const result = await createConfiguredBareRepository(repositoryId, options);
  if (result.ok) return { ok: true };
  if (
    result.status === 501 &&
    result.body.code === "git_repository_root_not_configured" &&
    devInMemoryMetadataEnabled()
  ) {
    return { ok: true };
  }
  return result;
}

function metadataToStoredRepository(
  repository: GitRepositoryMetadataRecord,
): StoredGitRepository {
  return {
    ...repository,
    refs: normalizeRefs(repository.refs)!,
  };
}

function storedRepositoryToMetadata(
  repository: StoredGitRepository,
): GitRepositoryMetadataRecord {
  return {
    ...repository,
    refs: repositoryRefs(repository),
  };
}

export async function listRepositoryRefs(
  repository: StoredGitRepository,
  prefix: "refs/heads/" | "refs/tags/",
): Promise<
  | { ok: true; response: GitListRefsResponse }
  | {
    ok: false;
    body: {
      error: string;
      code: string;
      repositoryId?: string;
    };
    status: 400 | 404 | 409 | 413 | 422 | 501;
  }
> {
  const configured = await readConfiguredGitRefs(repository.id);
  if (configured.ok) {
    return {
      ok: true,
      response: {
        repositoryId: repository.id,
        refs: configured.refs.filter((ref) => ref.name.startsWith(prefix)),
      },
    };
  }
  if (configured.status !== 501) return configured;
  return {
    ok: true,
    response: {
      repositoryId: repository.id,
      refs: repositoryRefs(repository).filter((ref) =>
        ref.name.startsWith(prefix)
      ),
    },
  };
}

export function normalizeRefs(
  refs: GitCreateRepositoryRequest["refs"],
): Map<string, string> | undefined {
  const normalized = new Map<string, string>();
  if (refs === undefined) return normalized;
  if (Array.isArray(refs)) {
    for (const ref of refs) {
      if (!isValidRefSummary(ref)) return undefined;
      normalized.set(canonicalRefName(ref.name), ref.target);
    }
    return normalized;
  }
  if (!refs || typeof refs !== "object") return undefined;
  for (const [name, target] of Object.entries(refs)) {
    if (
      typeof name !== "string" || name.trim().length === 0 ||
      typeof target !== "string" || !isLiteralObjectId(target)
    ) {
      return undefined;
    }
    normalized.set(canonicalRefName(name), target);
  }
  return normalized;
}

function isValidRefSummary(ref: unknown): ref is GitRefSummary {
  return !!ref && typeof ref === "object" &&
    typeof (ref as GitRefSummary).name === "string" &&
    (ref as GitRefSummary).name.trim().length > 0 &&
    typeof (ref as GitRefSummary).target === "string" &&
    isLiteralObjectId((ref as GitRefSummary).target);
}

export function resolveStoredRef(
  repository: StoredGitRepository,
  sourceRef: string,
): { name: string; target: string } | undefined {
  const candidates = refResolutionCandidates(repository, sourceRef);
  for (const candidate of candidates) {
    const target = repository.refs.get(candidate);
    if (target) return { name: candidate, target };
  }
}

function refResolutionCandidates(
  repository: StoredGitRepository,
  sourceRef: string,
): string[] {
  const trimmed = sourceRef.trim();
  const candidates = new Set<string>([trimmed]);
  if (!trimmed.startsWith("refs/")) {
    candidates.add(`refs/heads/${trimmed}`);
    candidates.add(`refs/tags/${trimmed}`);
  }
  if (trimmed === repository.defaultBranch) {
    candidates.add(`refs/heads/${repository.defaultBranch}`);
  }
  return [...candidates];
}

export function repositoryRefs(
  repository: StoredGitRepository,
): GitRefSummary[] {
  return [...repository.refs.entries()].map(([name, target]) => ({
    name,
    target,
  }));
}

export function repositorySummary(
  repository: StoredGitRepository,
): GitRepositorySummary {
  return {
    id: repository.id,
    name: repository.name,
    ownerSpaceId: repository.ownerSpaceId,
    defaultBranch: repository.defaultBranch,
  };
}

export function repositoryDetail(
  repository: StoredGitRepository,
): GitRepositoryDetail {
  return {
    ...repositorySummary(repository),
    refs: repositoryRefs(repository),
    createdAt: repository.createdAt,
    updatedAt: repository.updatedAt,
  };
}
