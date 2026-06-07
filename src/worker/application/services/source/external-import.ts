/**
 * External Git Repository Import Service.
 *
 * Imports a repository from any Git HTTPS server into the Takos store.
 * Delegates remote clone/fetch and Git object ownership to takos-git, then
 * mirrors repository metadata needed by the Takos app database.
 *
 * After import, the repository is fully browsable, forkable, and
 * accessible by agents through the standard Takos APIs.
 */

import {
  branches,
  getDb,
  repoRemotes,
  repositories,
  type SqlDatabaseLike,
  tags,
} from "../../../infra/db/index.ts";
import { and, eq } from "drizzle-orm";
import { ConflictError } from "@takos/worker-platform-utils/errors";
import { generateId } from "../../../shared/utils/index.ts";
import { logError, logInfo } from "../../../shared/utils/logger.ts";
import type { TakosGitClient } from "../takos-git/client.ts";
import {
  inferRepoName,
  normalizeGitUrl,
  sanitizeImportName,
} from "./external-import-utils.ts";

// ── Types ───────────────────────────────────────────────────────────

export interface ImportExternalRepoInput {
  accountId: string;
  url: string;
  name?: string;
  authHeader?: string | null;
  description?: string;
  visibility?: "public" | "private";
}

export interface ImportExternalRepoResult {
  repositoryId: string;
  name: string;
  defaultBranch: string;
  branchCount: number;
  tagCount: number;
  commitCount: number;
  remoteUrl: string;
}

export interface FetchRemoteResult {
  newCommits: number;
  updatedBranches: string[];
  newTags: string[];
}

type ImportedGitRef = {
  name: string;
  target: string;
};

// ── Import ──────────────────────────────────────────────────────────

/**
 * Import an external Git repository into the Takos store.
 *
 * 1. Asks takos-git to clone/fetch and ingest the remote repository
 * 2. Creates the app repository record
 * 3. Mirrors branch, tag, and origin metadata for app-side list views
 */
export async function importExternalRepository(
  dbBinding: SqlDatabaseLike,
  gitClient: TakosGitClient,
  input: ImportExternalRepoInput,
): Promise<ImportExternalRepoResult> {
  const gitUrl = normalizeGitUrl(input.url);
  const localName = sanitizeImportName(input.name || inferRepoName(input.url));

  if (!localName) {
    throw new Error(
      `Could not determine a valid repository name from the URL (url=${gitUrl}, providedName=${
        input.name ?? "<none>"
      }): inferRepoName/sanitizeImportName produced empty result`,
    );
  }

  const db = getDb(dbBinding);
  const existing = await db.select({ id: repositories.id })
    .from(repositories)
    .where(and(
      eq(repositories.accountId, input.accountId),
      eq(repositories.name, localName),
    ))
    .get();

  if (existing) {
    throw new ConflictError(
      `Repository "${localName}" already exists in this space`,
    );
  }

  logInfo(`Starting import from ${gitUrl} as "${localName}"`, {
    module: "external-import",
  });

  const repoId = generateId();
  const imported = await gitClient.importExternalRepository({
    id: repoId,
    name: localName,
    ownerSpaceId: input.accountId,
    remoteUrl: gitUrl,
    authHeader: input.authHeader ?? null,
    initialization: { mode: "bare" },
  });

  const timestamp = new Date().toISOString();
  await db.insert(repositories).values({
    id: repoId,
    accountId: input.accountId,
    name: localName,
    description: input.description || `Imported from ${gitUrl}`,
    visibility: input.visibility || "private",
    defaultBranch: imported.defaultBranch,
    remoteCloneUrl: gitUrl,
    gitEnabled: true,
    stars: 0,
    forks: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  try {
    await replaceStoredRefs(
      dbBinding,
      repoId,
      imported.repository.refs,
      imported.defaultBranch,
      timestamp,
    );

    const remoteId = generateId();
    await db.insert(repoRemotes).values({
      id: remoteId,
      repoId,
      name: "origin",
      upstreamRepoId: "",
      url: gitUrl,
      lastFetchedAt: timestamp,
      createdAt: timestamp,
    });
  } catch (err) {
    logError("Import failed while writing app metadata, cleaning up", err, {
      module: "external-import",
    });
    await db.delete(repositories).where(eq(repositories.id, repoId)).catch(
      (cleanupErr) => {
        logError(
          "Failed to clean up repository after import failure (non-critical)",
          cleanupErr,
          { module: "external-import" },
        );
      },
    );
    throw err;
  }

  logInfo(
    `Import complete: ${localName} - ${imported.branchCount} branches, ${imported.tagCount} tags, ${imported.commitCount} commits`,
    { module: "external-import" },
  );

  return {
    repositoryId: repoId,
    name: localName,
    defaultBranch: imported.defaultBranch,
    branchCount: imported.branchCount,
    tagCount: imported.tagCount,
    commitCount: imported.commitCount,
    remoteUrl: gitUrl,
  };
}

// ── Re-fetch ────────────────────────────────────────────────────────

/**
 * Fetch updates from the remote origin for an already-imported repository.
 */
export async function fetchRemoteUpdates(
  dbBinding: SqlDatabaseLike,
  gitClient: TakosGitClient,
  repoId: string,
): Promise<FetchRemoteResult> {
  const db = getDb(dbBinding);

  const repo = await db.select({
    remoteCloneUrl: repositories.remoteCloneUrl,
  }).from(repositories)
    .where(eq(repositories.id, repoId))
    .get();

  if (!repo?.remoteCloneUrl) {
    throw new Error("Repository does not have a remote clone URL");
  }

  const remote = await db.select({
    id: repoRemotes.id,
  }).from(repoRemotes)
    .where(and(eq(repoRemotes.repoId, repoId), eq(repoRemotes.name, "origin")))
    .get();

  const result = await gitClient.fetchExternalRepository({
    repositoryId: repoId,
    request: { remoteUrl: repo.remoteCloneUrl, authHeader: null },
  });
  const timestamp = new Date().toISOString();

  await replaceStoredRefs(
    dbBinding,
    repoId,
    result.refs,
    result.defaultBranch,
    timestamp,
  );
  await db.update(repositories)
    .set({ defaultBranch: result.defaultBranch, updatedAt: timestamp })
    .where(eq(repositories.id, repoId));

  if (remote) {
    await db.update(repoRemotes)
      .set({ lastFetchedAt: timestamp })
      .where(eq(repoRemotes.id, remote.id));
  }

  return {
    newCommits: result.newCommits,
    updatedBranches: result.updatedBranches,
    newTags: result.newTags,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

async function replaceStoredRefs(
  dbBinding: SqlDatabaseLike,
  repoId: string,
  refs: ImportedGitRef[],
  defaultBranch: string,
  timestamp: string,
): Promise<void> {
  const db = getDb(dbBinding);
  const branchRefs = refs.filter((ref) => ref.name.startsWith("refs/heads/"));
  const tagRefs = refs.filter((ref) =>
    ref.name.startsWith("refs/tags/") && !ref.name.includes("^{}")
  );

  await db.delete(branches).where(eq(branches.repoId, repoId));
  await db.delete(tags).where(eq(tags.repoId, repoId));

  for (const ref of branchRefs) {
    const branchName = ref.name.slice("refs/heads/".length);
    await db.insert(branches).values({
      id: generateId(),
      repoId,
      name: branchName,
      commitSha: ref.target,
      isDefault: branchName === defaultBranch,
      isProtected: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  for (const ref of tagRefs) {
    await db.insert(tags).values({
      id: generateId(),
      repoId,
      name: ref.name.slice("refs/tags/".length),
      commitSha: ref.target,
      message: null,
      taggerName: null,
      taggerEmail: null,
      createdAt: timestamp,
    });
  }
}
