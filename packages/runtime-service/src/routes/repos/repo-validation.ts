import type { Context } from "hono";
import type { RuntimeEnv } from "../../types/hono.d.ts";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { WORKDIR_BASE_DIR } from "../../shared/config.ts";
import {
  getRepoPath,
  resolveWorkDirPath,
  verifyNoSymlinkPathComponents,
  verifyPathWithinAfterAccess,
  verifyPathWithinBeforeCreate,
} from "../../runtime/paths.ts";
import { validateGitPath, validateGitRef } from "../../runtime/validation.ts";
import { getErrorMessage } from "takos-common/errors";
import { isBoundaryViolationError } from "../../shared/errors.ts";
import { badRequest, forbidden, notFound } from "takos-common/middleware/hono";

// --- getVerifiedRepoPath ---

export async function getVerifiedRepoPath(
  c: Context<RuntimeEnv>,
  spaceId: string,
  repoName: string,
): Promise<{ gitPath: string } | { error: Response }> {
  const gitPath = getRepoPath(spaceId, repoName);

  try {
    await fs.access(gitPath);
    return { gitPath };
  } catch {
    return { error: notFound(c, "Repository not found", { gitPath }) };
  }
}

/**
 * Validate that a git ref is well-formed.
 * Returns null on success, or a Response on failure.
 */
export function validateRef(
  c: Context<RuntimeEnv>,
  ref: string,
): Response | null {
  try {
    validateGitRef(ref);
    return null;
  } catch (err) {
    return badRequest(c, getErrorMessage(err));
  }
}

/**
 * Validate that a git path is well-formed.
 * Returns null on success, or a Response on failure.
 */
export function validatePathParam(
  c: Context<RuntimeEnv>,
  filePath: string,
): Response | null {
  try {
    validateGitPath(filePath);
    return null;
  } catch (err) {
    return badRequest(c, getErrorMessage(err));
  }
}

/**
 * Validate that spaceId and repoName are present.
 * Returns null on success, or a Response on failure.
 */
export function requireRepoParams(
  c: Context<RuntimeEnv>,
  spaceId: string | undefined,
  repoName: string | undefined,
): Response | null {
  if (!spaceId || !repoName) {
    return badRequest(c, "spaceId and repoName are required");
  }
  return null;
}

/**
 * Resolve and validate a target directory for repo operations (clone, init).
 * Checks: path resolution, symlink safety, boundary containment before creation.
 * Returns the resolved path on success, or an error Response.
 */
export async function validateTargetDir(
  c: Context<RuntimeEnv>,
  targetDir: string,
): Promise<{ resolved: string } | { error: Response }> {
  let resolved: string;
  try {
    resolved = resolveWorkDirPath(targetDir, "targetDir");
  } catch {
    return { error: badRequest(c, "Invalid targetDir") };
  }

  try {
    await verifyNoSymlinkPathComponents(
      WORKDIR_BASE_DIR,
      resolved,
      "targetDir",
    );
    await verifyPathWithinBeforeCreate(WORKDIR_BASE_DIR, resolved, "targetDir");
  } catch (err) {
    if (isBoundaryViolationError(err)) {
      return { error: forbidden(c, "Path escapes workdir boundary") };
    }
    return { error: badRequest(c, "Invalid targetDir") };
  }

  try {
    const stats = await fs.lstat(resolved);
    if (stats.isSymbolicLink()) {
      return { error: forbidden(c, "Path escapes workdir boundary") };
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  return { resolved };
}

/**
 * Resolve and validate a working directory for git operations (commit, push).
 * Checks: path resolution, symlink safety, boundary containment, .git presence.
 * Returns the resolved path on success, or an error Response.
 */
export async function resolveAndValidateWorkDir(
  c: Context<RuntimeEnv>,
  workDir: string,
): Promise<{ resolved: string } | { error: Response }> {
  let resolved: string;
  try {
    resolved = resolveWorkDirPath(workDir, "workDir");
  } catch (err) {
    return { error: badRequest(c, getErrorMessage(err)) };
  }

  try {
    await verifyNoSymlinkPathComponents(WORKDIR_BASE_DIR, resolved, "workDir");
    await verifyPathWithinAfterAccess(WORKDIR_BASE_DIR, resolved, "workDir");
  } catch (err) {
    if (isBoundaryViolationError(err)) {
      return { error: forbidden(c, "Path escapes workdir boundary") };
    }
    throw err;
  }

  try {
    await fs.access(path.join(resolved, ".git"));
  } catch {
    return {
      error: badRequest(c, "Not a git repository", { workDir: resolved }),
    };
  }

  return { resolved };
}
