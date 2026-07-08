/**
 * External Git Repository Import Service (worker-native).
 *
 * Imports a repository from any Git HTTPS server directly into the Takos
 * R2-backed object store: the worker speaks git-upload-pack to the remote,
 * unpacks the received packfile, ingests every object into R2, indexes commits,
 * and mirrors branch/tag metadata into D1. There is no separate filesystem git
 * store — the same object store then serves browse, fork, agent access, and
 * read-only `git clone`.
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
import type {
  ObjectStoreBinding,
  SqlDatabaseBinding,
} from "../../../shared/types/bindings.ts";
import {
  fetchRemoteRepository,
  ingestObjects,
  type RemoteRef,
} from "../takos-git/local/remote-fetch.ts";
import { indexCommit } from "../takos-git/index.ts";
import { decodeCommit } from "../takos-git/local/core/object.ts";
import type { UnpackedObject } from "../takos-git/local/core/pack-reader.ts";
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

// ── Import ──────────────────────────────────────────────────────────

function resolveDefaultBranch(
  refs: readonly RemoteRef[],
  advertised: string | null,
): string {
  if (advertised) return advertised;
  const heads = refs
    .filter((ref) => ref.name.startsWith("refs/heads/"))
    .map((ref) => ref.name.slice("refs/heads/".length));
  if (heads.includes("main")) return "main";
  if (heads.includes("master")) return "master";
  return heads[0] ?? "main";
}

function countBranches(refs: readonly RemoteRef[]): number {
  return refs.filter((ref) => ref.name.startsWith("refs/heads/")).length;
}

function countTags(refs: readonly RemoteRef[]): number {
  return refs.filter(
    (ref) => ref.name.startsWith("refs/tags/") && !ref.name.endsWith("^{}"),
  ).length;
}

/**
 * Index every commit object from the fetched pack into the D1 commit index so
 * history/log views work without re-reading the object store. Returns the count
 * of commits newly added to the index.
 */
async function indexCommitObjects(
  dbBinding: SqlDatabaseLike,
  repoId: string,
  objects: readonly UnpackedObject[],
): Promise<number> {
  let indexed = 0;
  for (const object of objects) {
    if (object.type !== "commit") continue;
    try {
      const commit = decodeCommit(object.content);
      commit.sha = object.sha;
      await indexCommit(dbBinding as SqlDatabaseBinding, repoId, commit);
      indexed += 1;
    } catch (err) {
      logError("Failed to index imported commit", err, {
        module: "external-import",
        sha: object.sha,
      });
    }
  }
  return indexed;
}

/**
 * Import an external Git repository into the Takos store.
 */
export async function importExternalRepository(
  dbBinding: SqlDatabaseLike,
  bucket: ObjectStoreBinding,
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

  const fetched = await fetchRemoteRepository({
    url: gitUrl,
    authHeader: input.authHeader ?? null,
  });
  const defaultBranch = resolveDefaultBranch(
    fetched.refs,
    fetched.defaultBranch,
  );

  const repoId = generateId();
  const timestamp = new Date().toISOString();

  // Ingest objects into R2 before writing metadata so a repo row never points
  // at objects that failed to land.
  await ingestObjects(bucket, fetched.objects);

  await db.insert(repositories).values({
    id: repoId,
    accountId: input.accountId,
    name: localName,
    description: input.description || `Imported from ${gitUrl}`,
    visibility: input.visibility || "private",
    defaultBranch,
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
      fetched.refs,
      defaultBranch,
      timestamp,
    );
    await indexCommitObjects(dbBinding, repoId, fetched.objects);

    await db.insert(repoRemotes).values({
      id: generateId(),
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

  const branchCount = countBranches(fetched.refs);
  const tagCount = countTags(fetched.refs);
  const commitCount = fetched.objects.filter((o) => o.type === "commit").length;

  logInfo(
    `Import complete: ${localName} - ${branchCount} branches, ${tagCount} tags, ${commitCount} commits`,
    { module: "external-import" },
  );

  return {
    repositoryId: repoId,
    name: localName,
    defaultBranch,
    branchCount,
    tagCount,
    commitCount,
    remoteUrl: gitUrl,
  };
}

// ── Re-fetch ────────────────────────────────────────────────────────

/**
 * Fetch updates from the remote origin for an already-imported repository.
 * Re-ingests reachable objects (idempotent) and replaces stored refs.
 */
export async function fetchRemoteUpdates(
  dbBinding: SqlDatabaseLike,
  bucket: ObjectStoreBinding,
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

  const existingBranches = await db.select({
    name: branches.name,
    commitSha: branches.commitSha,
  }).from(branches).where(eq(branches.repoId, repoId)).all();
  const beforeBranch = new Map(
    existingBranches.map((b) => [b.name, b.commitSha]),
  );
  const existingTags = await db.select({ name: tags.name })
    .from(tags).where(eq(tags.repoId, repoId)).all();
  const beforeTags = new Set(existingTags.map((t) => t.name));

  const remote = await db.select({
    id: repoRemotes.id,
  }).from(repoRemotes)
    .where(and(eq(repoRemotes.repoId, repoId), eq(repoRemotes.name, "origin")))
    .get();

  const fetched = await fetchRemoteRepository({
    url: repo.remoteCloneUrl,
    authHeader: null,
  });
  const defaultBranch = resolveDefaultBranch(
    fetched.refs,
    fetched.defaultBranch,
  );
  const timestamp = new Date().toISOString();

  await ingestObjects(bucket, fetched.objects);
  const newCommits = await indexCommitObjects(dbBinding, repoId, fetched.objects);

  await replaceStoredRefs(dbBinding, repoId, fetched.refs, defaultBranch, timestamp);
  await db.update(repositories)
    .set({ defaultBranch, updatedAt: timestamp })
    .where(eq(repositories.id, repoId));

  if (remote) {
    await db.update(repoRemotes)
      .set({ lastFetchedAt: timestamp })
      .where(eq(repoRemotes.id, remote.id));
  }

  const updatedBranches: string[] = [];
  for (const ref of fetched.refs) {
    if (!ref.name.startsWith("refs/heads/")) continue;
    const name = ref.name.slice("refs/heads/".length);
    if (beforeBranch.get(name) !== ref.target) updatedBranches.push(name);
  }
  const newTags: string[] = [];
  for (const ref of fetched.refs) {
    if (!ref.name.startsWith("refs/tags/") || ref.name.endsWith("^{}")) continue;
    const name = ref.name.slice("refs/tags/".length);
    if (!beforeTags.has(name)) newTags.push(name);
  }

  return { newCommits, updatedBranches, newTags };
}

// ── Helpers ─────────────────────────────────────────────────────────

async function replaceStoredRefs(
  dbBinding: SqlDatabaseLike,
  repoId: string,
  refs: readonly RemoteRef[],
  defaultBranch: string,
  timestamp: string,
): Promise<void> {
  const db = getDb(dbBinding);
  const branchRefs = refs.filter((ref) => ref.name.startsWith("refs/heads/"));
  const tagRefs = refs.filter((ref) =>
    ref.name.startsWith("refs/tags/") && !ref.name.endsWith("^{}")
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
