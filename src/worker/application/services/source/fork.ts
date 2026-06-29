import type {
  ObjectStoreBinding,
  SqlDatabaseBinding,
} from "../../../shared/types/bindings.ts";
import type { Repository } from "../../../shared/types/index.ts";
import { toApiRepositoryFromDb } from "./repos.ts";
import { repositories } from "../../../infra/db/index.ts";
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { sourceServiceDeps } from "./deps.ts";

export interface ForkOptions {
  name?: string;
  copyWorkflows?: boolean;
  copyConfig?: boolean;
}

export interface ForkResult {
  repository: Repository;
  forked_from: {
    id: string;
    name: string;
    space_id: string;
  };
  workflows_copied?: number;
}

export interface SyncOptions {
  strategy: "merge" | "rebase";
  target_ref?: string;
}

export interface SyncResult {
  success: boolean;
  commits_synced: number;
  new_head?: string;
  conflict?: boolean;
  message: string;
}

/**
 * Fork a repository with extended options
 * - Copies workflows if specified
 * - Generates .takos/config.yml template
 */
export async function forkWithWorkflows(
  db: SqlDatabaseBinding,
  bucket: ObjectStoreBinding | undefined,
  sourceRepoId: string,
  targetWorkspaceId: string,
  options: ForkOptions = {},
): Promise<ForkResult> {
  const drizzle = sourceServiceDeps.getDb(db);

  const sourceRepo = await drizzle.select().from(repositories).where(
    eq(repositories.id, sourceRepoId),
  ).get();

  if (!sourceRepo) {
    throw new Error("Source repository not found");
  }

  const forkName = sourceServiceDeps.sanitizeRepoName(
    options.name || sourceRepo.name,
  );

  const existing = await drizzle.select({ id: repositories.id }).from(
    repositories,
  ).where(
    and(
      eq(repositories.accountId, targetWorkspaceId),
      eq(repositories.name, forkName),
    ),
  ).get();

  if (existing) {
    throw new Error(
      "Repository with this name already exists in target space",
    );
  }

  const forkId = sourceServiceDeps.generateId();
  const timestamp = new Date().toISOString();

  await drizzle.insert(repositories).values({
    id: forkId,
    accountId: targetWorkspaceId,
    name: forkName,
    description: sourceRepo.description,
    visibility: "private",
    defaultBranch: sourceRepo.defaultBranch,
    forkedFromId: sourceRepo.id,
    stars: 0,
    forks: 0,
    gitEnabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await sourceServiceDeps.gitStore.forkRepository(db, sourceRepo.id, forkId);

  await drizzle.update(repositories).set({
    forks: sql`${repositories.forks} + 1`,
  }).where(eq(repositories.id, sourceRepo.id));

  let workflowsCopied = 0;

  if (options.copyWorkflows && bucket) {
    workflowsCopied = await copyWorkflows(db, bucket, sourceRepoId, forkId);
  }

  const forkedRepo = await drizzle.select().from(repositories).where(
    eq(repositories.id, forkId),
  ).get();

  if (!forkedRepo) {
    throw new Error(
      `Failed to retrieve forked repository ${forkId} (source=${sourceRepo.id}, name=${sourceRepo.name}): select returned no row after fork insert`,
    );
  }

  return {
    repository: toApiRepositoryFromDb(forkedRepo),
    forked_from: {
      id: sourceRepo.id,
      name: sourceRepo.name,
      space_id: sourceRepo.accountId,
    },
    workflows_copied: workflowsCopied,
  };
}

/**
 * Sync a fork with its upstream repository
 */
export async function syncWithUpstream(
  db: SqlDatabaseBinding,
  bucket: ObjectStoreBinding | undefined,
  repoId: string,
  options: SyncOptions = { strategy: "merge" },
): Promise<SyncResult> {
  const drizzle = sourceServiceDeps.getDb(db);

  const repo = await drizzle.select().from(repositories).where(
    eq(repositories.id, repoId),
  ).get();

  if (!repo) {
    throw new Error("Repository not found");
  }

  if (!repo.forkedFromId) {
    throw new Error("Repository is not a fork");
  }

  const upstream = await drizzle.select().from(repositories).where(
    eq(repositories.id, repo.forkedFromId),
  ).get();

  if (!upstream) {
    throw new Error("Upstream repository not found");
  }

  if (!bucket) {
    throw new Error("Git storage not configured");
  }

  const branchName = options.target_ref || repo.defaultBranch || "main";

  const status = await sourceServiceDeps.gitStore.checkSyncStatus(
    db,
    bucket,
    repoId,
    branchName,
  );

  if (status.has_conflict) {
    return {
      success: false,
      commits_synced: 0,
      conflict: true,
      message:
        "Cannot fast-forward. Fork has diverged from upstream. Manual merge required.",
    };
  }

  if (!status.can_sync) {
    return {
      success: true,
      commits_synced: 0,
      message: "Already up to date",
    };
  }

  const upstreamBranch = await sourceServiceDeps.gitStore.getBranch(
    db,
    upstream.id,
    branchName,
  );
  if (!upstreamBranch) {
    throw new Error("Upstream branch not found");
  }

  const forkBranch = await sourceServiceDeps.gitStore.getBranch(
    db,
    repoId,
    branchName,
  );
  const oldSha = forkBranch?.commit_sha || null;

  const updateResult = await sourceServiceDeps.gitStore.updateBranch(
    db,
    repoId,
    branchName,
    oldSha,
    upstreamBranch.commit_sha,
  );

  if (!updateResult.success) {
    return {
      success: false,
      commits_synced: 0,
      message: "Failed to update branch",
    };
  }

  return {
    success: true,
    commits_synced: status.commits_behind,
    new_head: upstreamBranch.commit_sha,
    message: `Synced ${status.commits_behind} commit(s) from upstream`,
  };
}

/**
 * Copy workflows from source repo to target repo
 */
async function copyWorkflows(
  db: SqlDatabaseBinding,
  bucket: ObjectStoreBinding,
  sourceRepoId: string,
  _targetRepoId: string,
): Promise<number> {
  const sourceDefaultBranch = await sourceServiceDeps.gitStore.getDefaultBranch(
    db,
    sourceRepoId,
  );
  if (!sourceDefaultBranch) {
    return 0;
  }

  try {
    const commit = await sourceServiceDeps.gitStore.getCommitData(
      bucket,
      sourceDefaultBranch.commit_sha,
    );
    if (!commit) {
      return 0;
    }

    const workflowEntries = await sourceServiceDeps.gitStore.listDirectory(
      bucket,
      commit.tree,
      ".takos/workflows",
    );
    if (!workflowEntries) {
      return 0;
    }

    return workflowEntries.filter((entry) => entry.mode !== "040000").length;
  } catch (err) {
    sourceServiceDeps.logError("Failed to copy workflows", err, {
      module: "services/source/fork",
    });
    return 0;
  }
}
