import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../../../shared/types/index.ts";
import {
  type BaseVariables,
  parseJsonBody,
  requireSpaceAccess,
  requireTenantSource,
} from "../route-auth.ts";
import { parsePagination } from "../../../shared/utils/index.ts";
import { GitService } from "../../../application/services/source/git.ts";
import {
  BadRequestError,
  InternalError,
  NotFoundError,
} from "takos-common/errors";
import { logError } from "../../../shared/utils/logger.ts";

const git = new Hono<{ Bindings: Env; Variables: BaseVariables }>();

function resolveGitService(
  c: Context<{ Bindings: Env; Variables: BaseVariables }>,
) {
  const tenantSource = requireTenantSource(c);

  return new GitService(
    c.env.DB,
    tenantSource,
  );
}

// Create a commit
git.post("/spaces/:spaceId/git/commit", async (c) => {
  const user = c.get("user");
  const spaceId = c.req.param("spaceId");
  const body = await parseJsonBody<{
    message: string;
    paths?: string[];
  }>(c);

  if (!body) {
    throw new BadRequestError("Invalid JSON body");
  }

  const access = await requireSpaceAccess(
    c,
    spaceId,
    user.id,
    ["owner", "admin", "editor"],
    "Workspace not found or insufficient permissions",
  );

  if (!body.message || body.message.trim().length === 0) {
    throw new BadRequestError("Commit message is required");
  }

  const gitService = resolveGitService(c);
  if (gitService instanceof Response) return gitService;

  try {
    const commit = await gitService.commit(
      access.space.id,
      body.message.trim(),
      user.id,
      user.name,
      body.paths,
    );

    return c.json({ commit }, 201);
  } catch (err) {
    logError("Git commit error", err, { module: "routes/git" });
    throw new InternalError("Commit failed");
  }
});

// Get commit history
git.get("/spaces/:spaceId/git/log", async (c) => {
  const user = c.get("user");
  const spaceId = c.req.param("spaceId");
  const path = c.req.query("path");
  const { limit, offset } = parsePagination(c.req.query(), {
    limit: 50,
    maxLimit: 100,
  });

  const access = await requireSpaceAccess(c, spaceId, user.id);

  const gitService = resolveGitService(c);
  if (gitService instanceof Response) return gitService;

  try {
    const commits = await gitService.log(access.space.id, {
      limit,
      offset,
      path,
    });

    return c.json({ commits });
  } catch (err) {
    logError("Git log error", err, { module: "routes/git" });
    throw new InternalError("Failed to get commit history");
  }
});

// Get a specific commit
git.get("/spaces/:spaceId/git/commits/:commitId", async (c) => {
  const user = c.get("user");
  const spaceId = c.req.param("spaceId");
  const commitId = c.req.param("commitId");

  const access = await requireSpaceAccess(c, spaceId, user.id);

  const gitService = resolveGitService(c);
  if (gitService instanceof Response) return gitService;

  try {
    const commit = await gitService.getCommit(commitId);
    if (!commit) {
      throw new NotFoundError("Commit");
    }

    if (commit.space_id !== access.space.id) {
      throw new NotFoundError("Commit");
    }

    const changes = await gitService.getCommitChanges(commitId);

    return c.json({ commit, changes });
  } catch (err) {
    logError("Git show error", err, { module: "routes/git" });
    throw new InternalError("Failed to get commit");
  }
});

// Get diff for a commit
git.get("/spaces/:spaceId/git/diff/:commitId", async (c) => {
  const user = c.get("user");
  const spaceId = c.req.param("spaceId");
  const commitId = c.req.param("commitId");

  const access = await requireSpaceAccess(c, spaceId, user.id);

  const gitService = resolveGitService(c);
  if (gitService instanceof Response) return gitService;

  try {
    const commit = await gitService.getCommit(commitId);
    if (!commit) {
      throw new NotFoundError("Commit");
    }

    if (commit.space_id !== access.space.id) {
      throw new NotFoundError("Commit");
    }

    const diffs = await gitService.diff(
      access.space.id,
      commit.parent_id,
      commitId,
    );

    return c.json({ commit, diffs });
  } catch (err) {
    logError("Git diff error", err, { module: "routes/git" });
    throw new InternalError("Failed to get diff");
  }
});

// Restore a file to a previous version
git.post("/spaces/:spaceId/git/restore", async (c) => {
  const user = c.get("user");
  const spaceId = c.req.param("spaceId");
  const body = await parseJsonBody<{
    commit_id: string;
    path: string;
  }>(c);

  if (!body) {
    throw new BadRequestError("Invalid JSON body");
  }

  const access = await requireSpaceAccess(
    c,
    spaceId,
    user.id,
    ["owner", "admin", "editor"],
    "Workspace not found or insufficient permissions",
  );

  if (!body.commit_id || !body.path) {
    throw new BadRequestError("commit_id and path are required");
  }

  const gitService = resolveGitService(c);
  if (gitService instanceof Response) return gitService;

  try {
    const result = await gitService.restore(
      access.space.id,
      body.commit_id,
      body.path,
    );

    if (!result.success) {
      throw new BadRequestError(result.message);
    }

    return c.json(result);
  } catch (err) {
    logError("Git restore error", err, { module: "routes/git" });
    throw new InternalError("Restore failed");
  }
});

// Get file history
git.get("/spaces/:spaceId/git/history/:path", async (c) => {
  const user = c.get("user");
  const spaceId = c.req.param("spaceId");
  const path = c.req.param("path");
  const { limit } = parsePagination(c.req.query());

  const access = await requireSpaceAccess(c, spaceId, user.id);

  const gitService = resolveGitService(c);
  if (gitService instanceof Response) return gitService;

  try {
    const commits = await gitService.log(access.space.id, {
      limit,
      path: decodeURIComponent(path),
    });

    return c.json({ path, commits });
  } catch (err) {
    logError("Git history error", err, { module: "routes/git" });
    throw new InternalError("Failed to get file history");
  }
});

export default git;
