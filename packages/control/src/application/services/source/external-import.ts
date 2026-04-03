/**
 * External Git Repository Import Service.
 *
 * Imports a repository from any Git HTTPS server into the Takos store.
 * Uses the Git Smart HTTP client to fetch refs and packfiles, then stores
 * objects in R2 and indexes metadata in D1 — the same storage format used
 * by locally created repositories.
 *
 * After import, the repository is fully browsable, forkable, and
 * accessible by agents through the standard Takos APIs.
 */

import type { D1Database, R2Bucket } from "../../../shared/types/bindings.ts";
import {
  fetchRemoteRefs,
  type RemoteRef,
} from "../git-smart/client/fetch-refs.ts";
import { fetchPackFromRemote } from "../git-smart/client/fetch-pack.ts";
import { readPackfileAsync } from "../git-smart/protocol/packfile-reader.ts";
import { getCommit, indexCommit } from "../git-smart/core/commit-index.ts";
import { createBranch, createTag } from "../git-smart/core/refs.ts";
import { getDb, repoRemotes, repositories } from "../../../infra/db/index.ts";
import { and, eq } from "drizzle-orm";
import { generateId } from "../../../shared/utils/index.ts";
import { logError, logInfo } from "../../../shared/utils/logger.ts";
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

// ── Limits ──────────────────────────────────────────────────────────

const MAX_IMPORT_PACKFILE_BYTES = 100 * 1024 * 1024; // 100 MB
const MAX_IMPORT_OBJECTS = 500_000;
const MAX_IMPORT_INFLATED_TOTAL = 1024 * 1024 * 1024; // 1 GB
const MAX_IMPORT_OBJECT_INFLATED = 256 * 1024 * 1024; // 256 MB
const MAX_IMPORT_DELTA_RESULT = 64 * 1024 * 1024; // 64 MB
const MAX_IMPORT_DELTA_CHAIN_DEPTH = 50;
const MAX_COMMIT_INDEX_DEPTH = 500;

// ── Import ──────────────────────────────────────────────────────────

/**
 * Import an external Git repository into the Takos store.
 *
 * 1. Fetches refs from the remote server
 * 2. Downloads all objects via packfile
 * 3. Unpacks objects into R2
 * 4. Creates a local repository record
 * 5. Creates branches and tags
 * 6. Indexes commits
 */
export async function importExternalRepository(
  dbBinding: D1Database,
  bucket: R2Bucket,
  input: ImportExternalRepoInput,
): Promise<ImportExternalRepoResult> {
  const gitUrl = normalizeGitUrl(input.url);
  const localName = sanitizeImportName(input.name || inferRepoName(input.url));

  if (!localName) {
    throw new Error("Could not determine a valid repository name from the URL");
  }

  // Check for duplicate name in this workspace
  const db = getDb(dbBinding);
  const existing = await db.select({ id: repositories.id })
    .from(repositories)
    .where(and(
      eq(repositories.accountId, input.accountId),
      eq(repositories.name, localName),
    ))
    .get();

  if (existing) {
    throw new Error(
      `Repository "${localName}" already exists in this workspace`,
    );
  }

  logInfo(`Starting import from ${gitUrl} as "${localName}"`, {
    module: "external-import",
  });

  // Step 1: Fetch remote refs
  const {
    refs,
    headTarget,
    capabilities,
  } = await fetchRemoteRefs(gitUrl, input.authHeader ?? null);

  if (refs.length === 0) {
    throw new Error("Remote repository has no refs (empty repository)");
  }

  const branchRefs = refs.filter((r) => r.name.startsWith("refs/heads/"));
  const tagRefs = refs.filter((r) => r.name.startsWith("refs/tags/"));

  if (branchRefs.length === 0) {
    throw new Error("Remote repository has no branches");
  }

  // Determine default branch
  const defaultBranch = resolveDefaultBranch(branchRefs, headTarget);

  // Step 2: Fetch all objects
  const wantShas = deduplicateWants(refs);

  logInfo(
    `Fetching ${wantShas.length} refs (${branchRefs.length} branches, ${tagRefs.length} tags)`,
    {
      module: "external-import",
    },
  );

  const packfile = await fetchPackFromRemote(
    gitUrl,
    input.authHeader ?? null,
    wantShas,
    [], // haves = empty for initial import
    {
      maxPackfileBytes: MAX_IMPORT_PACKFILE_BYTES,
      advertisedCapabilities: capabilities,
    },
  );

  logInfo(`Received packfile: ${packfile.length} bytes`, {
    module: "external-import",
  });

  // Step 3: Unpack objects into R2
  const storedShas = await readPackfileAsync(packfile, bucket, {
    maxObjectCount: MAX_IMPORT_OBJECTS,
    maxInflatedTotal: MAX_IMPORT_INFLATED_TOTAL,
    maxObjectInflated: MAX_IMPORT_OBJECT_INFLATED,
    maxDeltaResultInflated: MAX_IMPORT_DELTA_RESULT,
    maxDeltaChainDepth: MAX_IMPORT_DELTA_CHAIN_DEPTH,
  });

  logInfo(`Unpacked ${storedShas.length} objects into R2`, {
    module: "external-import",
  });

  // Step 4: Create repository record
  const repoId = generateId();
  const timestamp = new Date().toISOString();

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

  // Step 5: Create branches and tags
  let commitCount = 0;

  try {
    for (const ref of branchRefs) {
      const branchName = ref.name.replace("refs/heads/", "");
      const isDefault = branchName === defaultBranch;
      await createBranch(dbBinding, repoId, branchName, ref.sha, isDefault);
    }

    for (const ref of tagRefs) {
      const tagName = ref.name.replace("refs/tags/", "");
      await createTag(dbBinding, repoId, tagName, ref.sha);
    }

    // Step 6: Index commits (walk from each branch tip)
    const indexedShas = new Set<string>();
    for (const ref of branchRefs) {
      if (indexedShas.has(ref.sha)) continue;
      commitCount += await indexCommitsFromSha(
        dbBinding,
        bucket,
        repoId,
        ref.sha,
        indexedShas,
      );
    }

    // Create a remote entry for future re-fetches
    const remoteId = generateId();
    await db.insert(repoRemotes).values({
      id: remoteId,
      repoId,
      name: "origin",
      upstreamRepoId: "", // empty for external remotes
      url: gitUrl,
      lastFetchedAt: timestamp,
      createdAt: timestamp,
    });
  } catch (err) {
    // Clean up on failure
    logError("Import failed during indexing, cleaning up", err, {
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
    `Import complete: ${localName} — ${branchRefs.length} branches, ${tagRefs.length} tags, ${commitCount} commits`,
    { module: "external-import" },
  );

  return {
    repositoryId: repoId,
    name: localName,
    defaultBranch,
    branchCount: branchRefs.length,
    tagCount: tagRefs.length,
    commitCount,
    remoteUrl: gitUrl,
  };
}

// ── Re-fetch ────────────────────────────────────────────────────────

/**
 * Fetch updates from the remote origin for an already-imported repository.
 *
 * Compares local refs against remote refs and fetches only the delta.
 */
export async function fetchRemoteUpdates(
  dbBinding: D1Database,
  bucket: R2Bucket,
  repoId: string,
): Promise<FetchRemoteResult> {
  const db = getDb(dbBinding);

  // Get the repository and its remote URL
  const repo = await db.select({
    remoteCloneUrl: repositories.remoteCloneUrl,
  }).from(repositories)
    .where(eq(repositories.id, repoId))
    .get();

  if (!repo?.remoteCloneUrl) {
    throw new Error("Repository does not have a remote clone URL");
  }

  // Get stored auth from remote entry (if any)
  const remote = await db.select({
    id: repoRemotes.id,
  }).from(repoRemotes)
    .where(and(eq(repoRemotes.repoId, repoId), eq(repoRemotes.name, "origin")))
    .get();

  const gitUrl = repo.remoteCloneUrl;

  // Fetch remote refs
  const { refs: remoteRefs, capabilities } = await fetchRemoteRefs(
    gitUrl,
    null,
  );

  // Get local branch SHAs for have negotiation
  const localBranches = await import("../git-smart/core/refs.ts").then(
    (m) => m.listBranches(dbBinding, repoId),
  );

  const haveShas = localBranches.map((b) => b.commit_sha);
  const remoteBranches = remoteRefs.filter((r) =>
    r.name.startsWith("refs/heads/")
  );
  const remoteTags = remoteRefs.filter((r) => r.name.startsWith("refs/tags/"));

  // Determine what's new
  const localBranchMap = new Map(
    localBranches.map((b) => [b.name, b.commit_sha]),
  );
  const wantShas: string[] = [];
  const updatedBranches: string[] = [];

  for (const ref of remoteBranches) {
    const branchName = ref.name.replace("refs/heads/", "");
    const localSha = localBranchMap.get(branchName);
    if (localSha !== ref.sha) {
      wantShas.push(ref.sha);
      updatedBranches.push(branchName);
    }
  }

  // Check for new tags
  const localTags = await import("../git-smart/core/refs.ts").then(
    (m) => m.listTags(dbBinding, repoId),
  );
  const localTagMap = new Map(localTags.map((t) => [t.name, t.commit_sha]));
  const newTags: string[] = [];

  for (const ref of remoteTags) {
    const tagName = ref.name.replace("refs/tags/", "");
    if (!localTagMap.has(tagName)) {
      wantShas.push(ref.sha);
      newTags.push(tagName);
    }
  }

  if (wantShas.length === 0) {
    // Already up to date
    if (remote) {
      await db.update(repoRemotes)
        .set({ lastFetchedAt: new Date().toISOString() })
        .where(eq(repoRemotes.id, remote.id));
    }
    return { newCommits: 0, updatedBranches: [], newTags: [] };
  }

  // Fetch delta packfile
  const uniqueWants = Array.from(new Set(wantShas));
  const packfile = await fetchPackFromRemote(
    gitUrl,
    null,
    uniqueWants,
    haveShas,
    {
      maxPackfileBytes: MAX_IMPORT_PACKFILE_BYTES,
      advertisedCapabilities: capabilities,
    },
  );

  // Unpack
  await readPackfileAsync(packfile, bucket, {
    maxObjectCount: MAX_IMPORT_OBJECTS,
    maxInflatedTotal: MAX_IMPORT_INFLATED_TOTAL,
    maxObjectInflated: MAX_IMPORT_OBJECT_INFLATED,
    maxDeltaResultInflated: MAX_IMPORT_DELTA_RESULT,
    maxDeltaChainDepth: MAX_IMPORT_DELTA_CHAIN_DEPTH,
  });

  // Update branches
  const { updateBranch, createBranch: createBr } = await import(
    "../git-smart/core/refs.ts"
  );
  for (const ref of remoteBranches) {
    const branchName = ref.name.replace("refs/heads/", "");
    if (localBranchMap.has(branchName)) {
      const oldSha = localBranchMap.get(branchName)!;
      await updateBranch(dbBinding, repoId, branchName, oldSha, ref.sha);
    } else {
      await createBr(dbBinding, repoId, branchName, ref.sha, false);
      updatedBranches.push(branchName);
    }
  }

  // Create new tags
  const { createTag: createTg } = await import("../git-smart/core/refs.ts");
  for (const ref of remoteTags) {
    const tagName = ref.name.replace("refs/tags/", "");
    if (!localTagMap.has(tagName)) {
      await createTg(dbBinding, repoId, tagName, ref.sha);
    }
  }

  // Index new commits
  let newCommits = 0;
  const indexedShas = new Set<string>();
  for (const sha of uniqueWants) {
    newCommits += await indexCommitsFromSha(
      dbBinding,
      bucket,
      repoId,
      sha,
      indexedShas,
    );
  }

  // Update last_fetched_at
  if (remote) {
    await db.update(repoRemotes)
      .set({ lastFetchedAt: new Date().toISOString() })
      .where(eq(repoRemotes.id, remote.id));
  }

  return { newCommits, updatedBranches, newTags };
}

// ── Helpers ─────────────────────────────────────────────────────────

function resolveDefaultBranch(
  branchRefs: RemoteRef[],
  headTarget: string | null,
): string {
  if (headTarget) {
    const branchName = headTarget.replace("refs/heads/", "");
    if (branchRefs.some((r) => r.name === headTarget)) {
      return branchName;
    }
  }

  // Fallback: prefer main > master > first branch
  const names = branchRefs.map((r) => r.name.replace("refs/heads/", ""));
  if (names.includes("main")) return "main";
  if (names.includes("master")) return "master";
  return names[0];
}

function deduplicateWants(refs: RemoteRef[]): string[] {
  const seen = new Set<string>();
  const wants: string[] = [];

  for (const ref of refs) {
    // Skip HEAD (it points to the same SHA as the default branch)
    if (ref.name === "HEAD") continue;
    // Skip peeled tag refs (e.g., refs/tags/v1.0^{})
    if (ref.name.includes("^{}")) continue;

    if (!seen.has(ref.sha)) {
      seen.add(ref.sha);
      wants.push(ref.sha);
    }
  }

  return wants;
}

async function indexCommitsFromSha(
  db: D1Database,
  bucket: R2Bucket,
  repoId: string,
  startSha: string,
  visited: Set<string>,
): Promise<number> {
  const queue = [startSha];
  let indexed = 0;

  while (queue.length > 0 && indexed < MAX_COMMIT_INDEX_DEPTH) {
    const sha = queue.shift()!;
    if (visited.has(sha)) continue;
    visited.add(sha);

    const commit = await getCommit(db, bucket, repoId, sha);
    if (!commit) continue;

    await indexCommit(db, repoId, commit);
    indexed++;

    for (const parent of commit.parents) {
      if (!visited.has(parent)) {
        queue.push(parent);
      }
    }
  }

  return indexed;
}
