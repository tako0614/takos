import { Hono } from "hono";
import type { RuntimeEnv } from "../../types/hono.d.ts";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  badRequest,
  forbidden,
  internalError,
} from "takos-common/middleware/hono";
import { getRepoPath } from "../../runtime/paths.ts";
import { generateTempSuffix } from "../../shared/temp-id.ts";
import { runGitCommand } from "../../runtime/git.ts";
import { validateNameParam } from "../../runtime/validation.ts";
import {
  hasSpaceScopeMismatch,
  SPACE_SCOPE_MISMATCH_ERROR,
} from "../../middleware/space-scope.ts";

async function execGit(args: string[], cwd: string): Promise<void> {
  const { exitCode, output } = await runGitCommand(args, cwd);
  if (exitCode !== 0) {
    throw new Error(`Git command exited with code ${exitCode}: ${output}`);
  }
}

const app = new Hono<RuntimeEnv>();

app.post("/git/init", async (c) => {
  try {
    const { space_id, repo_name, git_path } = await c.req.json() as {
      space_id: string;
      repo_name: string;
      git_path?: string;
    };

    const spaceError = validateNameParam(space_id, "space_id");
    if (spaceError) return badRequest(c, spaceError);

    if (hasSpaceScopeMismatch(c, space_id)) {
      return forbidden(c, SPACE_SCOPE_MISMATCH_ERROR);
    }

    const repoError = validateNameParam(repo_name, "repo_name");
    if (repoError) return badRequest(c, repoError);

    let safeGitPath: string;
    try {
      safeGitPath = getRepoPath(space_id, repo_name);
    } catch (error) {
      return badRequest(
        c,
        error instanceof Error ? error.message : "Invalid repository path",
      );
    }

    if (typeof git_path === "string" && git_path.trim().length > 0) {
      if (path.resolve(git_path) !== safeGitPath) {
        return badRequest(
          c,
          "git_path does not match expected repository path",
        );
      }
    }

    await fs.mkdir(path.dirname(safeGitPath), { recursive: true });

    try {
      await fs.access(safeGitPath);
      return c.json({
        success: true,
        git_path: safeGitPath,
        message: "Repository already exists",
        created: false,
      });
    } catch {
      // Repository does not exist yet; continue to create it.
    }

    await execGit(["init", "--bare", safeGitPath], path.dirname(safeGitPath));

    const tempDir = `/tmp/git-init-${generateTempSuffix()}`;
    try {
      await fs.mkdir(tempDir, { recursive: true });
      await execGit(["clone", safeGitPath, tempDir], "/tmp");

      const safeRepoName = repo_name.replace(/[^a-zA-Z0-9_\-\s]/g, "");
      await fs.writeFile(
        path.join(tempDir, "README.md"),
        `# ${safeRepoName}\n\nCreated by Takos Agent.\n`,
      );

      await execGit(["add", "."], tempDir);
      await execGit(
        [
          "-c",
          "user.name=Takos",
          "-c",
          "user.email=agent@takos.local",
          "commit",
          "-m",
          "Initial commit",
        ],
        tempDir,
      );
      await execGit(["push", "origin", "main"], tempDir);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }

    c.get("log")?.info("Initialized bare git repository", {
      git_path: safeGitPath,
    });
    return c.json({
      success: true,
      git_path: safeGitPath,
      message: "Repository initialized successfully",
      created: true,
    });
  } catch (err) {
    c.get("log")?.error("Failed to initialize git repository", {
      error: err as Error,
    });
    return internalError(c, "Failed to initialize repository");
  }
});

export default app;
