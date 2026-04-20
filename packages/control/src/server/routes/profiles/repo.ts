import { Hono } from "hono";
import type { Context, Handler } from "hono";
import * as gitStore from "../../../application/services/git-smart/index.ts";
import type { OptionalAuthRouteEnv } from "../route-auth.ts";
import { parsePagination } from "../../../shared/utils/index.ts";
import { findRepoByUsernameAndName } from "./profile-queries.ts";
import { getDb } from "../../../infra/db/index.ts";
import {
  branches,
  repoForks,
  repoRemotes,
  repositories,
  repoStars,
  workflowSecrets,
} from "../../../infra/db/schema.ts";
import { and, eq, sql } from "drizzle-orm";
import { checkSpaceAccess } from "../../../application/services/identity/space-access.ts";
import { logError, logWarn } from "../../../shared/utils/logger.ts";
import {
  AuthenticationError,
  AuthorizationError,
  BadRequestError,
  InternalError,
  NotFoundError,
} from "takos-common/errors";
import { textDateNullable } from "../../../shared/utils/db-guards.ts";

const profilesRepo = new Hono<OptionalAuthRouteEnv>();
type ProfileRepoContext = Context<OptionalAuthRouteEnv>;
type ProfileRepoHandler = Handler<OptionalAuthRouteEnv>;

export const profilesRepoRouteDeps = {
  findRepoByUsernameAndName,
  getDb,
  checkSpaceAccess,
  listBranches: gitStore.listBranches,
  resolveReadableCommitFromRef: gitStore.resolveReadableCommitFromRef,
  listDirectory: gitStore.listDirectory,
  getBlobAtPath: gitStore.getBlobAtPath,
  getCommitsFromRef: gitStore.getCommitsFromRef,
  getDefaultBranch: gitStore.getDefaultBranch,
};

profilesRepo.get("/:username/:repoName", async (c) => {
  const user = c.get("user");
  const username = c.req.param("username");
  const repoName = c.req.param("repoName");

  if (["repos", "stars", "followers", "following"].includes(repoName)) {
    throw new NotFoundError();
  }

  const result = await profilesRepoRouteDeps.findRepoByUsernameAndName(
    c.env.DB,
    username,
    repoName,
    user?.id,
  );

  if (!result) {
    throw new NotFoundError("Repository");
  }

  const { repo, space, owner } = result;

  let branchCount = 0;
  try {
    const branchesList = await profilesRepoRouteDeps.listBranches(
      c.env.DB,
      repo.id,
    );
    branchCount = branchesList.length;
  } catch (err) {
    logError("Failed to get branch count", err, {
      module: "routes/profiles/repo",
    });
  }

  let starred = false;
  if (user) {
    const db = profilesRepoRouteDeps.getDb(c.env.DB);
    const star = await db.select({ accountId: repoStars.accountId })
      .from(repoStars)
      .where(and(
        eq(repoStars.accountId, user.id),
        eq(repoStars.repoId, repo.id),
      ))
      .get();
    starred = !!star;
  }

  return c.json({
    repository: {
      name: repo.name,
      description: repo.description,
      visibility: repo.visibility,
      default_branch: repo.default_branch,
      stars: repo.stars,
      forks: repo.forks,
      owner_username: owner.username,
      created_at: textDateNullable(repo.created_at),
      updated_at: textDateNullable(repo.updated_at),
    },
    space: {
      name: space.name,
    },
    owner: {
      name: owner.name,
      username: owner.username,
      avatar_url: owner.picture,
    },
    branch_count: branchCount,
    starred,
  });
});

function readableCommitErrorResponse(
  c: ProfileRepoContext,
  ref: string,
  result: Extract<gitStore.ResolveReadableCommitResult, { ok: false }>,
) {
  if (result.reason === "ref_not_found") {
    throw new NotFoundError("Ref");
  }

  if (result.reason === "commit_not_found") {
    return c.json({
      error: "Commit object missing",
      ref,
      commit_sha: result.refCommitSha || null,
    }, 409);
  }

  return c.json({
    error: "Commit tree missing",
    ref,
    commit_sha: result.refCommitSha || null,
  }, 409);
}

const handleProfileRepoTreeRequest: ProfileRepoHandler = async (c) => {
  const user = c.get("user");
  const username = c.req.param("username");
  const repoName = c.req.param("repoName");
  const ref = c.req.param("ref");
  if (!username || !repoName || !ref) {
    throw new BadRequestError("Missing required parameters");
  }
  const wildcardPath = c.req.param("*") || "";
  const queryPath = c.req.query("path") || "";
  const path = (wildcardPath || queryPath).replace(/^\/+/, "");

  const result = await profilesRepoRouteDeps.findRepoByUsernameAndName(
    c.env.DB,
    username,
    repoName,
    user?.id,
  );

  if (!result) {
    throw new NotFoundError("Repository");
  }

  const { repo } = result;

  try {
    const bucket = c.env.GIT_OBJECTS;
    if (!bucket) {
      throw new InternalError("Git storage not configured");
    }

    const resolvedCommit = await profilesRepoRouteDeps
      .resolveReadableCommitFromRef(c.env.DB, bucket, repo.id, ref);
    if (!resolvedCommit.ok) {
      return readableCommitErrorResponse(c, ref, resolvedCommit);
    }
    const commit = resolvedCommit.commit;

    if (resolvedCommit.degraded) {
      logWarn(
        `Falling back to readable commit ${resolvedCommit.resolvedCommitSha} for profile repo ${repo.id} ref ${ref} (requested ${resolvedCommit.refCommitSha})`,
        { module: "git_readable_commit" },
      );
    }

    const entries = await profilesRepoRouteDeps.listDirectory(
      bucket,
      commit.tree,
      path,
    );
    if (!entries) {
      throw new NotFoundError("Path");
    }

    return c.json({
      path,
      ref,
      resolved_commit_sha: resolvedCommit.resolvedCommitSha,
      ref_commit_sha: resolvedCommit.refCommitSha,
      entries: entries.map((e) => ({
        name: e.name,
        type: e.mode === gitStore.FILE_MODES.DIRECTORY ? "directory" : "file",
        mode: e.mode,
        oid: e.sha,
      })),
    });
  } catch (err) {
    logError("Failed to get tree", err, { module: "routes/profiles/repo" });
    throw new InternalError("Failed to get file tree");
  }
};

profilesRepo.get(
  "/:username/:repoName/tree/:ref/*",
  handleProfileRepoTreeRequest,
);
profilesRepo.get(
  "/:username/:repoName/tree/:ref",
  handleProfileRepoTreeRequest,
);

const handleProfileRepoBlobRequest: ProfileRepoHandler = async (c) => {
  const user = c.get("user");
  const username = c.req.param("username");
  const repoName = c.req.param("repoName");
  const ref = c.req.param("ref");
  if (!username || !repoName || !ref) {
    throw new BadRequestError("Missing required parameters");
  }
  const wildcardPath = c.req.param("*") || "";
  const queryPath = c.req.query("path") || "";
  const path = (wildcardPath || queryPath).replace(/^\/+/, "");

  if (!path) {
    throw new BadRequestError("File path is required");
  }

  const result = await profilesRepoRouteDeps.findRepoByUsernameAndName(
    c.env.DB,
    username,
    repoName,
    user?.id,
  );

  if (!result) {
    throw new NotFoundError("Repository");
  }

  const { repo } = result;

  try {
    const bucket = c.env.GIT_OBJECTS;
    if (!bucket) {
      throw new InternalError("Git storage not configured");
    }

    const resolvedCommit = await profilesRepoRouteDeps
      .resolveReadableCommitFromRef(c.env.DB, bucket, repo.id, ref);
    if (!resolvedCommit.ok) {
      return readableCommitErrorResponse(c, ref, resolvedCommit);
    }
    const commit = resolvedCommit.commit;

    if (resolvedCommit.degraded) {
      logWarn(
        `Falling back to readable commit ${resolvedCommit.resolvedCommitSha} for profile repo ${repo.id} ref ${ref} (requested ${resolvedCommit.refCommitSha})`,
        { module: "git_readable_commit" },
      );
    }

    const blob = await profilesRepoRouteDeps.getBlobAtPath(
      bucket,
      commit.tree,
      path,
    );
    if (!blob) {
      throw new NotFoundError("File");
    }

    const isBinary = blob.some((byte) => byte === 0);

    const base64Encode = (data: Uint8Array): string => {
      let binary = "";
      for (let i = 0; i < data.length; i++) {
        binary += String.fromCharCode(data[i]);
      }
      return btoa(binary);
    };

    return c.json({
      path,
      ref,
      resolved_commit_sha: resolvedCommit.resolvedCommitSha,
      ref_commit_sha: resolvedCommit.refCommitSha,
      content: isBinary ? base64Encode(blob) : new TextDecoder().decode(blob),
      size: blob.length,
      is_binary: isBinary,
      encoding: isBinary ? "base64" : "utf-8",
    });
  } catch (err) {
    logError("Failed to get blob", err, { module: "routes/profiles/repo" });
    throw new InternalError("Failed to get file content");
  }
};

profilesRepo.get(
  "/:username/:repoName/blob/:ref/*",
  handleProfileRepoBlobRequest,
);
profilesRepo.get(
  "/:username/:repoName/blob/:ref",
  handleProfileRepoBlobRequest,
);

profilesRepo.get("/:username/:repoName/commits", async (c) => {
  const user = c.get("user");
  const username = c.req.param("username");
  const repoName = c.req.param("repoName");
  const { limit } = parsePagination(c.req.query(), {
    limit: 50,
    maxLimit: 100,
  });
  const branch = c.req.query("branch");

  const result = await profilesRepoRouteDeps.findRepoByUsernameAndName(
    c.env.DB,
    username,
    repoName,
    user?.id,
  );

  if (!result) {
    throw new NotFoundError("Repository");
  }

  const { repo } = result;

  try {
    const bucket = c.env.GIT_OBJECTS;
    if (!bucket) {
      throw new InternalError("Git storage not configured");
    }

    const refName = branch || repo.default_branch || "main";
    const commits = await profilesRepoRouteDeps.getCommitsFromRef(
      c.env.DB,
      bucket,
      repo.id,
      refName,
      limit,
    );

    return c.json({
      commits: commits.map((commit) => ({
        hash: commit.sha,
        short_hash: commit.sha.slice(0, 7),
        author_name: commit.author.name,
        author_email: commit.author.email,
        date: commit.author.timestamp,
        message: commit.message,
      })),
    });
  } catch (err) {
    logError("Failed to get commits", err, { module: "routes/profiles/repo" });
    throw new InternalError("Failed to get commit history");
  }
});

profilesRepo.get("/:username/:repoName/branches", async (c) => {
  const user = c.get("user");
  const username = c.req.param("username");
  const repoName = c.req.param("repoName");

  const result = await profilesRepoRouteDeps.findRepoByUsernameAndName(
    c.env.DB,
    username,
    repoName,
    user?.id,
  );

  if (!result) {
    throw new NotFoundError("Repository");
  }

  const { repo } = result;

  try {
    const branchesList = await profilesRepoRouteDeps.listBranches(
      c.env.DB,
      repo.id,
    );
    const defaultBranch = await profilesRepoRouteDeps.getDefaultBranch(
      c.env.DB,
      repo.id,
    );

    return c.json({
      branches: branchesList.map((b) => ({
        name: b.name,
        is_head: b.is_default,
        commit_sha: b.commit_sha,
      })),
      default_branch: defaultBranch?.name || repo.default_branch,
    });
  } catch (err) {
    logError("Failed to list branches", err, {
      module: "routes/profiles/repo",
    });
    throw new InternalError("Failed to list branches");
  }
});

profilesRepo.delete("/:username/:repoName", async (c) => {
  const user = c.get("user");
  if (!user) {
    throw new AuthenticationError();
  }

  const username = c.req.param("username");
  const repoName = c.req.param("repoName");

  const result = await profilesRepoRouteDeps.findRepoByUsernameAndName(
    c.env.DB,
    username,
    repoName,
    user.id,
  );

  if (!result) {
    throw new NotFoundError("Repository");
  }

  const { repo, space } = result;

  const access = await profilesRepoRouteDeps.checkSpaceAccess(
    c.env.DB,
    space.id,
    user.id,
  );
  if (!access || !["owner", "admin"].includes(access.membership.role)) {
    throw new AuthorizationError("Insufficient permissions");
  }

  const db = profilesRepoRouteDeps.getDb(c.env.DB);

  await db.delete(branches).where(eq(branches.repoId, repo.id));
  await db.delete(repoForks).where(eq(repoForks.forkRepoId, repo.id));
  await db.delete(repoRemotes).where(eq(repoRemotes.repoId, repo.id));
  await db.delete(workflowSecrets).where(eq(workflowSecrets.repoId, repo.id));
  await db.delete(repositories).where(eq(repositories.id, repo.id));

  if (repo.forked_from_id) {
    await db.update(repositories)
      .set({ forks: sql`${repositories.forks} - 1` })
      .where(eq(repositories.id, repo.forked_from_id));
  }

  return c.json({ success: true });
});

export default profilesRepo;
