import type { Context } from "hono";
import * as fsPromises from "node:fs/promises";
import path from "node:path";
import { badRequest, notFound } from "takos-common/middleware/hono";
import { REPOS_BASE_DIR } from "../../shared/config.ts";
import { isPathWithinBase } from "../../runtime/paths.ts";
import { validateGitName } from "../../runtime/validation.ts";
import { getLfsObjectPath, normalizeLfsOid } from "./lfs-policy.ts";
import type { RuntimeEnv } from "../../types/hono.d.ts";

export interface ValidatedRepoParams {
  spaceId: string;
  repoName: string;
}

export type ResolvedRepoGitDir = ValidatedRepoParams & { repoGitDir: string };

export interface ValidatedLfsObjectRequest {
  oid: string;
  objectPath: string;
  repo: ResolvedRepoGitDir;
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsPromises.access(filePath);
    return true;
  } catch (err) {
    const errCode = err instanceof Error && "code" in err
      ? (err as NodeJS.ErrnoException).code
      : undefined;
    if (errCode === "ENOENT") {
      return false;
    }
    throw err;
  }
}

export function validateRepoParams(
  c: Context<RuntimeEnv>,
): ValidatedRepoParams | { error: Response } {
  const spaceId = c.req.param("spaceId") ?? c.req.param("workspaceId") ?? "";
  const pathParts = c.req.path.split("/").filter(Boolean);
  const repoSegment = c.req.param("repoName") ?? pathParts[2] ?? "";
  const repoName = repoSegment.replace(/\.git$/i, "");
  const safeSpaceId = validateGitName(spaceId);
  const safeRepoName = validateGitName(repoName);

  if (!safeSpaceId || !safeRepoName) {
    return { error: badRequest(c, "Invalid space or repository name") };
  }

  return {
    spaceId: safeSpaceId,
    repoName: safeRepoName,
  };
}

export async function resolveRepoGitDir(
  c: Context<RuntimeEnv>,
): Promise<ResolvedRepoGitDir | { error: Response }> {
  const params = validateRepoParams(c);
  if ("error" in params) return params;

  const repoGitDir = path.resolve(
    REPOS_BASE_DIR,
    params.spaceId,
    `${params.repoName}.git`,
  );
  const resolvedBase = path.resolve(REPOS_BASE_DIR);

  if (!isPathWithinBase(resolvedBase, repoGitDir)) {
    return { error: badRequest(c, "Invalid space or repository name") };
  }

  try {
    const stats = await fsPromises.stat(repoGitDir);
    if (!stats.isDirectory()) {
      return { error: notFound(c, "Repository not found") };
    }
  } catch (err) {
    const errCode = err instanceof Error && "code" in err
      ? (err as NodeJS.ErrnoException).code
      : undefined;
    if (errCode === "ENOENT") {
      return { error: notFound(c, "Repository not found") };
    }
    throw err;
  }

  return {
    ...params,
    repoGitDir,
  };
}

export function validateLfsObjectOid(
  c: Context<RuntimeEnv>,
): string | { error: Response } {
  const normalizedOid = normalizeLfsOid(c.req.param("oid"));
  if (!normalizedOid) {
    return { error: badRequest(c, "Invalid LFS object id") };
  }
  return normalizedOid;
}

export async function validateLfsObjectRequest(
  c: Context<RuntimeEnv>,
  oid: string | null = null,
): Promise<ValidatedLfsObjectRequest | { error: Response }> {
  const normalizedOidResult = oid ?? validateLfsObjectOid(c);
  if (
    typeof normalizedOidResult === "object" && "error" in normalizedOidResult
  ) {
    return normalizedOidResult;
  }
  const normalizedOid = typeof normalizedOidResult === "string"
    ? normalizedOidResult
    : oid!;

  const repo = await resolveRepoGitDir(c);
  if ("error" in repo) {
    return repo;
  }

  const objectPath = getLfsObjectPath(repo.repoGitDir, normalizedOid);
  if (!isPathWithinBase(repo.repoGitDir, objectPath)) {
    return { error: badRequest(c, "Invalid LFS object path") };
  }

  return {
    oid: normalizedOid,
    objectPath,
    repo,
  };
}
