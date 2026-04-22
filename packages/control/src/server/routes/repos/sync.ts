import { Hono } from "hono";
import { z } from "zod";
import { parseJsonBody, requireSpaceAccess } from "../route-auth.ts";
import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import { zValidator } from "../zod-validator.ts";
import * as gitStore from "../../../application/services/git-smart/index.ts";
import {
  checkRepoAccess,
  toApiRepositoryFromDb,
} from "../../../application/services/source/repos.ts";
import { getTreeFlattenLimitError } from "./routes.ts";
import { getDb } from "../../../infra/db/index.ts";
import { repositories } from "../../../infra/db/schema.ts";
import { eq } from "drizzle-orm";

import { logError } from "../../../shared/utils/logger.ts";
import {
  BadRequestError,
  ConflictError,
  InternalError,
  isAppError,
  NotFoundError,
  PayloadTooLargeError,
} from "takos-common/errors";

function normalizeBranchName(input: string): string {
  if (input.startsWith("refs/heads/")) {
    return input.slice("refs/heads/".length);
  }
  return input;
}

const repoSync = new Hono<AuthenticatedRouteEnv>()
  .post("/repos/:repoId/fetch", async (c) => {
    const user = c.get("user");
    const repoId = c.req.param("repoId");
    const body = await parseJsonBody<{
      remote?: string;
      branches?: string[];
    }>(c, { remote: "upstream" });
    const db = getDb(c.env.DB);

    if (body === null) {
      throw new BadRequestError("Invalid JSON body");
    }

    const remote = body.remote ?? "upstream";
    if (remote !== "upstream") {
      throw new BadRequestError(`Unsupported remote: ${remote}`);
    }

    if (body.branches !== undefined) {
      if (
        !Array.isArray(body.branches) ||
        body.branches.some((branch) => typeof branch !== "string")
      ) {
        throw new BadRequestError("branches must be an array of strings");
      }
    }

    const repoData = await db.select().from(repositories).where(
      eq(repositories.id, repoId),
    ).get();
    if (!repoData) {
      throw new NotFoundError("Repository");
    }

    const repo = toApiRepositoryFromDb(repoData);
    const access = await requireSpaceAccess(
      c,
      repo.space_id,
      user.id,
      ["owner", "admin", "editor"],
      "Permission denied",
      403,
    );
    if (access instanceof Response) {
      return access;
    }

    if (!repo.forked_from_id) {
      throw new BadRequestError("Repository is not a fork");
    }

    const upstreamData = await db.select().from(repositories).where(
      eq(repositories.id, repo.forked_from_id),
    ).get();
    if (!upstreamData) {
      throw new NotFoundError("Upstream repository");
    }

    const upstream = toApiRepositoryFromDb(upstreamData);

    try {
      const requestedBranches = body.branches
        ? Array.from(
          new Set(
            body.branches
              .map((branch) => normalizeBranchName(branch.trim()))
              .filter(Boolean),
          ),
        )
        : null;

      let targetBranches: string[] = [];
      let upstreamBranchMap: Map<
        string,
        NonNullable<Awaited<ReturnType<typeof gitStore.getBranch>>>
      >;
      if (requestedBranches !== null) {
        // Batch-fetch all requested branches from upstream in one query
        upstreamBranchMap = await gitStore.getBranchesByNames(
          c.env.DB,
          upstream.id,
          requestedBranches,
        );
        const missingBranches = requestedBranches.filter((name) =>
          !upstreamBranchMap.has(name)
        );

        if (missingBranches.length > 0) {
          throw new NotFoundError("Upstream branch", {
            missing_branches: missingBranches,
          });
        }

        targetBranches = requestedBranches.filter((name) =>
          upstreamBranchMap.has(name)
        );
      } else {
        const upstreamBranches = await gitStore.listBranches(
          c.env.DB,
          upstream.id,
        );
        targetBranches = upstreamBranches
          .map((branch) => branch.name)
          .filter((branchName) => !branchName.startsWith("remotes/"));
        upstreamBranchMap = new Map(upstreamBranches.map((b) => [b.name, b]));
      }

      const updated: Array<{
        ref: string;
        old: string | null;
        new: string;
      }> = [];

      // Batch-fetch all tracking branches for the fork repo in one query
      const trackingNames = targetBranches.map((b) => `remotes/${remote}/${b}`);
      const trackingBranchMap = trackingNames.length > 0
        ? await gitStore.getBranchesByNames(c.env.DB, repoId, trackingNames)
        : new Map();

      for (const branchName of targetBranches) {
        const upstreamBranch = upstreamBranchMap.get(branchName);
        if (!upstreamBranch) {
          continue;
        }

        const trackingName = `remotes/${remote}/${branchName}`;
        const currentTrackingBranch = trackingBranchMap.get(trackingName) ||
          null;
        const oldSha = currentTrackingBranch?.commit_sha || null;

        if (oldSha === upstreamBranch.commit_sha) {
          continue;
        }

        const refUpdateResult = currentTrackingBranch
          ? await gitStore.updateBranch(
            c.env.DB,
            repoId,
            trackingName,
            currentTrackingBranch.commit_sha,
            upstreamBranch.commit_sha,
          )
          : await gitStore.createBranch(
            c.env.DB,
            repoId,
            trackingName,
            upstreamBranch.commit_sha,
            false,
          );

        if (!refUpdateResult.success) {
          throw new ConflictError(
            refUpdateResult.error || "Failed to update remote-tracking branch",
            {
              current: refUpdateResult.current,
              ref: `refs/remotes/${remote}/${branchName}`,
            },
          );
        }

        updated.push({
          ref: `refs/remotes/${remote}/${branchName}`,
          old: oldSha,
          new: upstreamBranch.commit_sha,
        });
      }

      return c.json({ updated });
    } catch (err) {
      if (isAppError(err)) throw err;
      const limitError = getTreeFlattenLimitError(err);
      if (limitError) {
        throw new PayloadTooLargeError(
          "Repository tree is too large to fetch from upstream",
          {
            code: limitError.code,
            detail: limitError.detail,
          },
        );
      }
      logError("Failed to fetch remote branches", err, {
        module: "routes/repos/sync",
      });
      throw new InternalError("Failed to fetch from upstream");
    }
  })
  .post(
    "/repos/:repoId/sync",
    zValidator(
      "json",
      z.object({
        remote: z.string().optional(),
        branch: z.string().optional(),
        strategy: z.enum(["fast-forward", "merge"]).optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const repoId = c.req.param("repoId");
      const body = c.req.valid("json");
      const db = getDb(c.env.DB);

      const remote = body.remote ?? "upstream";
      if (remote !== "upstream") {
        throw new BadRequestError(`Unsupported remote: ${remote}`);
      }

      const repoData = await db.select().from(repositories).where(
        eq(repositories.id, repoId),
      ).get();

      if (!repoData) {
        throw new NotFoundError("Repository");
      }

      const repo = toApiRepositoryFromDb(repoData);

      const _access = await requireSpaceAccess(
        c,
        repo.space_id,
        user.id,
        ["owner", "admin", "editor"],
        "Permission denied",
        403,
      );

      if (!repo.forked_from_id) {
        throw new BadRequestError("Repository is not a fork");
      }

      const upstreamData = await db.select().from(repositories).where(
        eq(repositories.id, repo.forked_from_id),
      ).get();

      if (!upstreamData) {
        throw new NotFoundError("Upstream repository");
      }

      const upstream = toApiRepositoryFromDb(upstreamData);

      try {
        const bucket = c.env.GIT_OBJECTS;
        if (!bucket) {
          throw new InternalError("Git storage not configured");
        }

        const requestedBranch = typeof body.branch === "string"
          ? body.branch.trim()
          : "";
        const branchName = normalizeBranchName(
          requestedBranch || repo.default_branch || "main",
        );
        if (!branchName) {
          throw new BadRequestError("Invalid branch name");
        }

        const forkBranch = await gitStore.getBranch(
          c.env.DB,
          repoId,
          branchName,
        );
        if (!forkBranch) {
          throw new NotFoundError("Fork branch");
        }

        const upstreamBranch = await gitStore.getBranch(
          c.env.DB,
          upstream.id,
          branchName,
        );
        if (!upstreamBranch) {
          throw new NotFoundError("Upstream branch");
        }

        const { ahead, behind, has_merge_base } = await gitStore
          .countCommitsBetween(
            c.env.DB,
            bucket,
            repoId,
            upstreamBranch.commit_sha,
            forkBranch.commit_sha,
          );

        if (!has_merge_base) {
          throw new ConflictError("No merge base between fork and upstream", {
            synced: false,
            commits_behind: 0,
            commits_ahead: 0,
            new_commits: 0,
            conflict: true,
            has_merge_base: false,
            merge_base: null,
          });
        }

        const canSync = behind > 0;
        const canFastForward = ahead === 0 && behind > 0;

        if (!canSync) {
          return c.json({
            synced: false,
            commits_behind: 0,
            commits_ahead: ahead,
            new_commits: 0,
            conflict: false,
            has_merge_base: true,
            message: "Already up to date",
          });
        }

        if (!canFastForward && body.strategy !== "merge") {
          return c.json({
            synced: false,
            commits_behind: behind,
            commits_ahead: ahead,
            new_commits: 0,
            conflict: true,
            has_merge_base: true,
            message: "Cannot fast-forward. Fork has diverged from upstream.",
          });
        }

        if (canFastForward) {
          const updateResult = await gitStore.updateBranch(
            c.env.DB,
            repoId,
            branchName,
            forkBranch.commit_sha,
            upstreamBranch.commit_sha,
          );

          if (!updateResult.success) {
            throw new InternalError("Failed to update branch");
          }

          return c.json({
            synced: true,
            commits_behind: 0,
            commits_ahead: ahead,
            new_commits: behind,
            conflict: false,
            has_merge_base: true,
          });
        }

        const mergeBase = await gitStore.findMergeBase(
          c.env.DB,
          bucket,
          repoId,
          forkBranch.commit_sha,
          upstreamBranch.commit_sha,
        );

        if (!mergeBase) {
          throw new ConflictError("No merge base between fork and upstream", {
            status: "conflict",
            conflicts: [],
            merge_base: null,
            conflict: true,
            has_merge_base: false,
          });
        }

        const [baseCommit, localCommit, incomingCommit] = await Promise.all([
          gitStore.getCommitData(bucket, mergeBase),
          gitStore.getCommitData(bucket, forkBranch.commit_sha),
          gitStore.getCommitData(bucket, upstreamBranch.commit_sha),
        ]);

        if (!baseCommit || !localCommit || !incomingCommit) {
          throw new InternalError("Failed to load commits for merge");
        }

        const mergeResult = await gitStore.mergeTrees3Way(
          bucket,
          baseCommit.tree,
          localCommit.tree,
          incomingCommit.tree,
        );

        if (!mergeResult.tree_sha || mergeResult.conflicts.length > 0) {
          throw new ConflictError("Merge conflict", {
            status: "conflict",
            conflicts: mergeResult.conflicts,
            merge_base: mergeBase,
            conflict: true,
            has_merge_base: true,
          });
        }

        const timestamp = new Date().toISOString();
        const signature = {
          name: user.name || "User",
          email: user.email || "user@takos.jp",
          timestamp: Math.floor(new Date(timestamp).getTime() / 1000),
          tzOffset: "+0000",
        };
        const mergeCommit = await gitStore.createCommit(
          c.env.DB,
          bucket,
          repoId,
          {
            tree: mergeResult.tree_sha,
            parents: [forkBranch.commit_sha, upstreamBranch.commit_sha],
            message: `Merge upstream/${branchName} into ${branchName}`,
            author: signature,
            committer: signature,
          },
        );

        const updateResult = await gitStore.updateBranch(
          c.env.DB,
          repoId,
          branchName,
          forkBranch.commit_sha,
          mergeCommit.sha,
        );

        if (!updateResult.success) {
          throw new ConflictError("Failed to update branch after merge", {
            current: updateResult.current,
          });
        }

        return c.json({
          status: "merged",
          ref: `refs/heads/${branchName}`,
          merge_commit: mergeCommit.sha,
          parents: [forkBranch.commit_sha, upstreamBranch.commit_sha],
          conflict: false,
          has_merge_base: true,
        });
      } catch (err) {
        if (isAppError(err)) throw err;
        const limitError = getTreeFlattenLimitError(err);
        if (limitError) {
          throw new PayloadTooLargeError(
            "Repository tree is too large to sync with upstream",
            {
              code: limitError.code,
              detail: limitError.detail,
            },
          );
        }
        logError("Failed to sync fork", err, { module: "routes/repos/sync" });
        throw new InternalError("Failed to sync with upstream");
      }
    },
  )
  .get("/repos/:repoId/sync/status", async (c) => {
    const user = c.get("user");
    const repoId = c.req.param("repoId");
    const db = getDb(c.env.DB);

    const repoData = await db.select().from(repositories).where(
      eq(repositories.id, repoId),
    ).get();

    if (!repoData) {
      throw new NotFoundError("Repository");
    }

    const repo = toApiRepositoryFromDb(repoData);

    const access = await checkRepoAccess(c.env, repoId, user?.id, undefined, {
      allowPublicRead: true,
    });
    if (!access) {
      throw new NotFoundError("Repository");
    }

    if (!repo.forked_from_id) {
      throw new BadRequestError("Repository is not a fork");
    }

    const upstreamData = await db.select().from(repositories).where(
      eq(repositories.id, repo.forked_from_id),
    ).get();

    if (!upstreamData) {
      throw new NotFoundError("Upstream repository");
    }

    const upstream = toApiRepositoryFromDb(upstreamData);

    try {
      const bucket = c.env.GIT_OBJECTS;
      if (!bucket) {
        throw new InternalError("Git storage not configured");
      }

      const branchName = repo.default_branch || "main";
      const status = await gitStore.checkSyncStatus(
        c.env.DB,
        bucket,
        repoId,
        branchName,
      );

      return c.json({
        can_sync: status.can_sync,
        can_fast_forward: status.can_fast_forward,
        commits_behind: status.commits_behind,
        commits_ahead: status.commits_ahead,
        has_merge_base: status.has_merge_base,
        conflict: status.has_conflict,
        upstream: {
          id: upstream.id,
          name: upstream.name,
          space_id: upstream.space_id,
        },
      });
    } catch (err) {
      if (isAppError(err)) throw err;
      const limitError = getTreeFlattenLimitError(err);
      if (limitError) {
        throw new PayloadTooLargeError(
          "Repository tree is too large to evaluate sync status",
          {
            can_sync: false,
            can_fast_forward: false,
            commits_behind: 0,
            commits_ahead: 0,
            has_merge_base: true,
            conflict: false,
            code: limitError.code,
            detail: limitError.detail,
          },
        );
      }
      logError("Failed to check sync status", err, {
        module: "routes/repos/sync",
      });
      throw new InternalError("Failed to check sync status");
    }
  });

export default repoSync;
