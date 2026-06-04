import type { Context } from "hono";
import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import { getTreeFlattenLimitError, type RepoBucketBinding } from "./routes.ts";
import {
  InternalError,
  NotFoundError,
  PayloadTooLargeError,
} from "@takos/worker-platform-utils/errors";
import type * as gitStore from "../../../application/services/takos-git/index.ts";
import {
  checkRepoAccess,
  type CheckRepoAccessOptions,
  type RepoAccess,
} from "../../../application/services/source/repos.ts";
import type { Env } from "../../../shared/types/index.ts";
import { logWarn } from "../../../shared/utils/logger.ts";

export type RepoContext = Context<AuthenticatedRouteEnv>;

/**
 * Single source of truth for repo role policy. `WRITE_ROLES` gates
 * create/update operations; `ADMIN_ROLES` gates destructive/admin operations.
 * Read/write/admin policy changes are a one-line edit here.
 */
export const WRITE_ROLES = ["owner", "admin", "editor"] as const;
export const ADMIN_ROLES = ["owner", "admin"] as const;

/**
 * Resolve repo access for a read request, throwing `NotFoundError("Repository")`
 * when the caller has no access. Pass `{ allowPublicRead: true }` to permit
 * anonymous/public-read access.
 */
export async function requireRepoRead(
  env: Pick<Env, "DB">,
  repoId: string,
  userId: string | null | undefined,
  options?: CheckRepoAccessOptions,
): Promise<RepoAccess> {
  const access = await checkRepoAccess(env, repoId, userId, undefined, options);
  if (!access) {
    throw new NotFoundError("Repository");
  }
  return access;
}

/**
 * Resolve repo access for a write request (`WRITE_ROLES`), throwing
 * `NotFoundError("Repository")` when the caller lacks write access.
 */
export async function requireRepoWrite(
  env: Pick<Env, "DB">,
  repoId: string,
  userId: string | null | undefined,
): Promise<RepoAccess> {
  const access = await checkRepoAccess(env, repoId, userId, [...WRITE_ROLES]);
  if (!access) {
    throw new NotFoundError("Repository");
  }
  return access;
}

/**
 * Resolve repo access for an admin request (`ADMIN_ROLES`), throwing
 * `NotFoundError("Repository")` when the caller lacks admin access.
 */
export async function requireRepoAdmin(
  env: Pick<Env, "DB">,
  repoId: string,
  userId: string | null | undefined,
): Promise<RepoAccess> {
  const access = await checkRepoAccess(env, repoId, userId, [...ADMIN_ROLES]);
  if (!access) {
    throw new NotFoundError("Repository");
  }
  return access;
}

export function requireBucket(c: RepoContext): RepoBucketBinding {
  const bucket = c.env.GIT_OBJECTS;
  if (!bucket) {
    throw new InternalError("Git storage not configured");
  }
  return bucket;
}

export function sigTimestampToIso(
  timestamp: number | string | undefined,
): string {
  if (typeof timestamp === "number") {
    const millis = timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000;
    return new Date(millis).toISOString();
  }
  if (typeof timestamp === "string") {
    return new Date(timestamp).toISOString();
  }
  return new Date(0).toISOString();
}

export function getCommitSha(commit: { sha?: string; oid?: string }): string {
  return commit.sha ?? commit.oid ?? "";
}

export function getCommitParents(commit: { parents?: string[] }): string[] {
  return Array.isArray(commit.parents) ? commit.parents : [];
}

export function warnDegradedCommit(
  resolvedCommit: Extract<gitStore.ResolveReadableCommitResult, { ok: true }>,
  repoId: string,
  ref: string,
): void {
  if (resolvedCommit.degraded) {
    logWarn(
      `Falling back to readable commit ${resolvedCommit.resolvedCommitSha} for repo ${repoId} ref ${ref} (requested ${resolvedCommit.refCommitSha})`,
      { module: "git-readable-commit" },
    );
  }
}

export function throwIfTreeFlattenLimit(err: unknown, operation: string): void {
  const limitError = getTreeFlattenLimitError(err);
  if (limitError) {
    throw new PayloadTooLargeError(
      `Repository tree is too large to ${operation}`,
      {
        code: limitError.code,
        detail: limitError.detail,
      },
    );
  }
}
