/**
 * Private helpers for repo CRUD routes (format, cleanup, owner resolution).
 */
import type { RepositoryVisibility } from '../../../shared/types';
import type { AuthenticatedRouteEnv } from '../route-auth';
import * as gitStore from '../../../application/services/git-smart';
import { collectReachableObjectShas } from '../../../application/services/git-smart';
import type { Database } from '../../../infra/db';
import { accounts, repositories } from '../../../infra/db/schema';
import { eq, ne } from 'drizzle-orm';
import { logWarn } from '../../../shared/utils/logger';
import { MAX_REPO_OBJECT_CLEANUP_CANDIDATES } from '../../../shared/config/limits';
import { textDateNullable } from '../../../shared/utils/db-guards';

// ---------------------------------------------------------------------------
// Constants & type aliases
// ---------------------------------------------------------------------------

type GitObjectsBucket = NonNullable<AuthenticatedRouteEnv['Bindings']['GIT_OBJECTS']>;
type ReachableObjectsBucket = Parameters<typeof collectReachableObjectShas>[1];
type DeleteBucket = Parameters<typeof gitStore.deleteObject>[0];

export type RepositoryResponseSource = {
  name: string;
  description: string | null;
  visibility: string;
  defaultBranch: string;
  stars: number;
  forks: number;
  gitEnabled: number | boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
};

// ---------------------------------------------------------------------------
// Owner resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the display username for an account (workspace or user).
 * The account's own slug is the username -- no personal workspace indirection needed.
 */
export async function resolveOwnerUsername(db: Database, spaceId: string): Promise<string> {
  const workspace = await db.select({
    slug: accounts.slug,
  })
    .from(accounts)
    .where(eq(accounts.id, spaceId))
    .get();

  return workspace?.slug || '';
}

// ---------------------------------------------------------------------------
// Response formatting
// ---------------------------------------------------------------------------

export function formatRepositoryResponse(
  repository: RepositoryResponseSource,
  ownerUsername: string
) {
  return {
    owner_username: ownerUsername,
    name: repository.name,
    description: repository.description,
    visibility: repository.visibility as RepositoryVisibility,
    default_branch: repository.defaultBranch,
    stars: repository.stars,
    forks: repository.forks,
    git_enabled: repository.gitEnabled,
    created_at: textDateNullable(repository.createdAt),
    updated_at: textDateNullable(repository.updatedAt),
  };
}

// ---------------------------------------------------------------------------
// R2 / Git object cleanup
// ---------------------------------------------------------------------------

export async function deleteR2Prefix(
  bucket: GitObjectsBucket,
  prefix: string
): Promise<void> {
  let cursor: string | undefined;

  do {
    const listing = await bucket.list({ prefix, cursor });
    if (listing.objects.length > 0) {
      await Promise.all(listing.objects.map((object: { key: string }) => bucket.delete(object.key)));
    }
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);
}

export async function cleanupRepoGitObjects(
  db: Database,
  d1: AuthenticatedRouteEnv['Bindings']['DB'],
  bucket: GitObjectsBucket,
  deletedRepoId: string,
  candidateOids: Set<string>
): Promise<void> {
  if (candidateOids.size === 0) {
    return;
  }

  const candidateList = Array.from(candidateOids);
  const sharedOids = new Set<string>();
  const otherRepos = await db.select({ id: repositories.id })
    .from(repositories)
    .where(ne(repositories.id, deletedRepoId))
    .all();

  for (const repo of otherRepos) {
    if (sharedOids.size === candidateList.length) {
      break;
    }

    const reachable = await collectReachableObjectShas(
      d1,
      bucket as ReachableObjectsBucket,
      repo.id
    );
    for (const oid of candidateList) {
      if (!sharedOids.has(oid) && reachable.has(oid)) {
        sharedOids.add(oid);
      }
    }
  }

  const deletable = candidateList.filter((oid) => !sharedOids.has(oid));
  if (deletable.length === 0) {
    return;
  }

  const chunkSize = 100;
  for (let i = 0; i < deletable.length; i += chunkSize) {
    const chunk = deletable.slice(i, i + chunkSize);
    await Promise.allSettled(chunk.map((oid) => gitStore.deleteObject(bucket as DeleteBucket, oid)));
  }
}

/**
 * Collect reachable object SHAs for cleanup, with a safety cap.
 * Returns null if the candidate set is too large.
 */
export async function collectCleanupCandidates(
  d1: AuthenticatedRouteEnv['Bindings']['DB'],
  bucket: GitObjectsBucket,
  repoId: string,
): Promise<Set<string> | null> {
  try {
    const reachable = await collectReachableObjectShas(d1, bucket, repoId);
    if (reachable.size <= MAX_REPO_OBJECT_CLEANUP_CANDIDATES) {
      return reachable;
    }
    logWarn('Skipping git object cleanup due to oversized candidate set', {
      action: 'deleteRepository',
      repoId,
      size: reachable.size,
      max: MAX_REPO_OBJECT_CLEANUP_CANDIDATES,
    });
    return null;
  } catch {
    logWarn('Failed to collect reachable objects before repo deletion', { action: 'deleteRepository', repoId });
    return null;
  }
}
