import { Hono } from "hono";
import type { RuntimeEnv } from "../../types/hono.d.ts";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { cloneAndCheckout, runGitCommand } from "../../runtime/git.ts";
import {
  resolvePathWithin,
  resolveRepoGitPath,
  verifyPathWithinAfterAccess,
} from "../../runtime/paths.ts";
import { writeFileWithinSpace } from "../../runtime/secure-fs.ts";
import {
  isValidSessionId,
  validateGitAuthorEmail,
  validateGitAuthorName,
  validateGitRef,
} from "../../runtime/validation.ts";
import { sessionStore } from "./storage.ts";
import {
  getSessionOwnerSub,
  parseRequiredSessionSpaceIds,
  parseRequiredSpaceId,
} from "./session-utils.ts";
import { OwnerBindingError } from "../../shared/errors.ts";
import {
  badRequest,
  forbidden,
  internalError,
  notFound,
} from "takos-common/middleware/hono";

const app = new Hono<RuntimeEnv>();

app.post("/sessions", async (c) => {
  try {
    const body = await c.req.json() as {
      session_id: string;
      space_id: string;
      files?: Array<{ path: string; content: string }>;
      repoGitPath?: string;
      branch?: string;
    };
    const ids = parseRequiredSessionSpaceIds(body);
    const { files, repoGitPath, branch } = body;

    if (!ids) {
      return badRequest(c, "session_id and space_id required");
    }

    const { sessionId: session_id, spaceId: space_id } = ids;

    if (!isValidSessionId(session_id)) {
      return badRequest(c, "Invalid session_id");
    }

    const ownerSub = getSessionOwnerSub(c);
    const proxyTokenHeader = c.req.header("x-takos-proxy-token");
    const workDir = await sessionStore.getSessionDir(
      session_id,
      space_id,
      ownerSub,
      proxyTokenHeader || undefined,
    );
    let fileCount = 0;
    let gitMode = false;
    let clonedBranch: string | undefined;

    if (repoGitPath) {
      let resolvedRepoGitPath: string;
      try {
        resolvedRepoGitPath = resolveRepoGitPath(repoGitPath);
      } catch {
        return badRequest(c, "Invalid repoGitPath");
      }

      try {
        await fs.access(resolvedRepoGitPath);
      } catch {
        return notFound(c, "Repository not found");
      }

      if (branch) {
        try {
          validateGitRef(branch);
        } catch {
          return badRequest(c, "Invalid branch name");
        }
      }

      const cloneResult = await cloneAndCheckout({
        repoUrl: resolvedRepoGitPath,
        targetDir: workDir,
        ref: branch,
        shallow: false,
      });

      if (!cloneResult.success) {
        const isBranchNotFound = branch &&
          (cloneResult.output.includes("Remote branch") ||
            cloneResult.output.includes("not found"));

        if (!isBranchNotFound) {
          return internalError(c, "Failed to clone repository", {
            output: cloneResult.output,
          });
        }

        // Branch not found on remote -- clone default branch, then create it locally
        const defaultResult = await cloneAndCheckout({
          repoUrl: resolvedRepoGitPath,
          targetDir: workDir,
          shallow: false,
        });
        if (!defaultResult.success) {
          return internalError(c, "Failed to clone repository", {
            output: defaultResult.output,
          });
        }

        const checkoutResult = await runGitCommand(
          ["checkout", "-b", branch],
          workDir,
        );
        if (checkoutResult.exitCode !== 0) {
          c.get("log")?.warn("Failed to create branch", {
            branch,
            output: checkoutResult.output,
          });
        }
      }

      await runGitCommand(["config", "user.email", "agent@takos.io"], workDir);
      await runGitCommand(["config", "user.name", "Takos Agent"], workDir);

      gitMode = true;

      const branchResult = await runGitCommand([
        "rev-parse",
        "--abbrev-ref",
        "HEAD",
      ], workDir);
      clonedBranch = branchResult.output.trim() || branch || "main";

      try {
        const items = await fs.readdir(workDir, {
          recursive: true,
          withFileTypes: true,
        });
        fileCount = items.filter((item) => item.isFile()).length;
      } catch {
        fileCount = 0;
      }

      c.get("log")?.info("Git clone completed", {
        repoGitPath: resolvedRepoGitPath,
        workDir,
        branch: clonedBranch,
      });
    } else if (files && files.length > 0) {
      for (const file of files) {
        const filePath = resolvePathWithin(workDir, file.path, "file");
        await writeFileWithinSpace(workDir, filePath, file.content, "utf-8");
        await verifyPathWithinAfterAccess(workDir, filePath, "file");
        fileCount++;
      }
    }

    const sessionInfoPath = resolvePathWithin(
      workDir,
      ".takos-session",
      "file",
    );
    await writeFileWithinSpace(
      workDir,
      sessionInfoPath,
      JSON.stringify({ session_id, space_id }, null, 2),
      "utf-8",
      0o600,
    );
    await verifyPathWithinAfterAccess(workDir, sessionInfoPath, "file");

    return c.json({
      success: true,
      session_id,
      work_dir: workDir,
      files_written: fileCount,
      git_mode: gitMode,
      branch: clonedBranch,
    });
  } catch (err) {
    if (err instanceof OwnerBindingError) {
      return forbidden(c, (err as Error).message);
    }
    c.get("log")?.error("Session creation error", { error: err as Error });
    return internalError(c, "Session creation failed");
  }
});

app.post("/sessions/:id/commit", async (c) => {
  try {
    const sessionId = c.req.param("id");
    const body = await c.req.json() as {
      space_id: string;
      message?: string;
      author?: { name: string; email: string };
    };
    const space_id = parseRequiredSpaceId(body);
    const { message, author } = body;

    if (!space_id) {
      return badRequest(c, "space_id required");
    }

    let session;
    try {
      session = sessionStore.getSessionWithValidation(
        sessionId,
        space_id,
        getSessionOwnerSub(c),
      );
    } catch (err) {
      if (err instanceof OwnerBindingError) {
        return forbidden(c, err.message);
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("not found")) {
          return notFound(c, "Session not found");
        } else if (msg.includes("does not belong")) {
          return forbidden(c, "Session does not belong to the specified space");
        } else {
          return badRequest(c, msg);
        }
      }
    }

    const workDir = session.workDir;

    try {
      await fs.access(path.join(workDir, ".git"));
    } catch {
      return c.json({
        success: true,
        git_mode: false,
        message: "Not a git repository, no commit needed",
      });
    }

    if (author) {
      validateGitAuthorName(author.name);
      validateGitAuthorEmail(author.email);
      await runGitCommand(["config", "user.email", author.email], workDir);
      await runGitCommand(["config", "user.name", author.name], workDir);
    }

    const statusResult = await runGitCommand(
      ["status", "--porcelain"],
      workDir,
    );
    if (!statusResult.output.trim()) {
      return c.json({
        success: true,
        git_mode: true,
        committed: false,
        message: "No changes to commit",
      });
    }

    const addResult = await runGitCommand(["add", "-A"], workDir);
    if (addResult.exitCode !== 0) {
      return internalError(c, "Failed to stage changes", {
        output: addResult.output,
      });
    }

    const commitMessage = message || `Session ${sessionId.slice(0, 8)} changes`;
    const commitResult = await runGitCommand(
      ["commit", "-m", commitMessage],
      workDir,
    );
    if (commitResult.exitCode !== 0) {
      return internalError(c, "Failed to commit changes", {
        output: commitResult.output,
      });
    }

    const hashResult = await runGitCommand(["rev-parse", "HEAD"], workDir);
    const commitHash = hashResult.output.trim();

    const branchResult = await runGitCommand([
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ], workDir);
    const branch = branchResult.output.trim() || "main";

    const pushResult = await runGitCommand(["push", "origin", branch], workDir);
    if (pushResult.exitCode !== 0) {
      const pushUpstreamResult = await runGitCommand([
        "push",
        "-u",
        "origin",
        branch,
      ], workDir);
      if (pushUpstreamResult.exitCode !== 0) {
        return internalError(c, "Failed to push changes", {
          committed: true,
          commitHash,
          output: pushUpstreamResult.output,
        });
      }
    }

    return c.json({
      success: true,
      git_mode: true,
      committed: true,
      commitHash,
      branch,
      message: "Changes committed and pushed successfully",
    });
  } catch (err) {
    c.get("log")?.error("Session commit error", { error: err as Error });
    return internalError(c, "Commit operation failed");
  }
});

export default app;
