import { type Context, Hono } from "hono";
import type { RuntimeEnv } from "../../types/hono.d.ts";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { REPOS_BASE_DIR, WORKDIR_BASE_DIR } from "../../shared/config.ts";
import { runGitCommand } from "../../runtime/git.ts";
import {
  getRepoPath,
  verifyNoSymlinkPathComponents,
  verifyPathWithinAfterAccess,
} from "../../runtime/paths.ts";
import { getErrorMessage } from "takos-common/errors";
import { validateRef, validateTargetDir } from "./repo-validation.ts";
import { isBoundaryViolationError } from "../../shared/errors.ts";
import {
  badRequest,
  forbidden,
  internalError,
  notFound,
} from "takos-common/middleware/hono";
import { ErrorCodes } from "takos-common/errors";
import branchRoutes from "./branches.ts";
import contentRoutes from "./content.ts";

const app = new Hono<RuntimeEnv>();

const PUBLIC_CONTROL_REPO_ID_ROUTE_MESSAGE =
  "Runtime-service repo routes use /repos/:spaceId/:repoName/*. Public repoId routes are handled by the control API under /api/repos/:repoId/*.";

function publicControlRepoIdRoute(c: Context<RuntimeEnv>): Response {
  return badRequest(c, PUBLIC_CONTROL_REPO_ID_ROUTE_MESSAGE);
}

app.get("/repos/:repoId/export", publicControlRepoIdRoute);
app.get("/repos/:repoId/status", publicControlRepoIdRoute);
app.get("/repos/:repoId/log", publicControlRepoIdRoute);
app.get("/repos/:repoId/branches/*", publicControlRepoIdRoute);
app.get("/repos/:repoId/content/*", publicControlRepoIdRoute);

// ---------------------------------------------------------------------------
// base: init + clone
// ---------------------------------------------------------------------------

app.post("/repos/init", async (c) => {
  try {
    const { spaceId, repoName = "main" } = await c.req.json() as {
      spaceId: string;
      repoName?: string;
    };

    if (!spaceId) {
      return badRequest(c, "spaceId is required");
    }

    const gitPath = getRepoPath(spaceId, repoName);

    try {
      await fs.access(gitPath);
      return c.json({
        error: {
          code: ErrorCodes.CONFLICT,
          message: "Repository already exists",
          details: { gitPath },
        },
      }, 409);
    } catch {
      // Repository does not exist yet - proceed with creation.
    }

    await fs.mkdir(path.dirname(gitPath), { recursive: true });

    const { exitCode, output } = await runGitCommand([
      "init",
      "--bare",
      gitPath,
    ], REPOS_BASE_DIR);

    if (exitCode !== 0) {
      return internalError(c, "Failed to initialize repository", { output });
    }

    return c.json({
      success: true,
      gitPath,
      message: "Repository initialized successfully",
    });
  } catch (err) {
    return internalError(c, getErrorMessage(err));
  }
});

app.post("/repos/clone", async (c) => {
  try {
    const { spaceId, repoName, branch, targetDir } = await c.req.json() as {
      spaceId: string;
      repoName: string;
      branch?: string;
      targetDir: string;
    };

    if (!spaceId || !repoName || !targetDir) {
      return badRequest(c, "spaceId, repoName, and targetDir are required");
    }

    const targetDirResult = await validateTargetDir(c, targetDir);
    if ("error" in targetDirResult) return targetDirResult.error;
    const resolvedTargetDir = targetDirResult.resolved;

    const gitPath = getRepoPath(spaceId, repoName);

    try {
      await fs.access(gitPath);
    } catch {
      return notFound(c, "Repository not found", { gitPath });
    }

    const targetParentDir = path.dirname(resolvedTargetDir);
    await fs.mkdir(targetParentDir, { recursive: true });
    await verifyNoSymlinkPathComponents(
      WORKDIR_BASE_DIR,
      resolvedTargetDir,
      "targetDir",
    );
    await verifyPathWithinAfterAccess(
      WORKDIR_BASE_DIR,
      targetParentDir,
      "targetDir",
    );

    const cloneArgs = ["clone"];
    if (branch) {
      const refErr = validateRef(c, branch);
      if (refErr) return refErr;
      cloneArgs.push("--branch", branch);
    }
    cloneArgs.push(gitPath, resolvedTargetDir);

    const { exitCode, output } = await runGitCommand(cloneArgs, "/");

    if (exitCode !== 0) {
      return internalError(c, "Failed to clone repository", { output });
    }

    await verifyPathWithinAfterAccess(
      WORKDIR_BASE_DIR,
      resolvedTargetDir,
      "targetDir",
    );

    return c.json({
      success: true,
      targetDir: resolvedTargetDir,
      branch: branch || "default",
      message: "Repository cloned successfully",
    });
  } catch (err) {
    if (isBoundaryViolationError(err)) {
      return forbidden(c, "Path escapes workdir boundary");
    }
    return internalError(c, getErrorMessage(err));
  }
});

// Mount branch and content sub-routes
app.route("/", branchRoutes);
app.route("/", contentRoutes);

export default app;
