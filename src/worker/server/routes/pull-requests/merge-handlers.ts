import { Hono } from "hono";
import { z } from "zod";
import { type AuthenticatedRouteEnv, parseJsonBody } from "../route-auth.ts";
import { zValidator } from "../zod-validator.ts";
import { checkRepoAccess } from "../../../application/services/source/repos.ts";
import {
  checkConflicts,
  ConflictCheckError,
  type Resolution,
  resolveConflictsAndMerge,
} from "../../../application/services/pull-requests/merge-resolution.ts";

import { buildPullRequestDtoFull } from "./dto.ts";
import {
  jsonErrorWithStatus,
  performPullRequestMerge,
  validateConflictResolutionPath,
} from "./merge.ts";
import { toGitBucket } from "../../../application/services/takos-git/index.ts";
import { logError } from "../../../shared/utils/logger.ts";
import {
  AppError,
  BadRequestError,
  InternalError,
  NotFoundError,
} from "@takos/worker-platform-utils/errors";
import { findPullRequest } from "./read-model.ts";

// ---------------------------------------------------------------------------
// Merge, Conflicts & Resolve routes
// ---------------------------------------------------------------------------

export default new Hono<AuthenticatedRouteEnv>()
  .post(
    "/repos/:repoId/pulls/:prNumber/merge",
    zValidator(
      "json",
      z.object({
        merge_method: z.enum(["merge", "squash", "rebase"]).optional(),
        commit_message: z.string().optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const repoId = c.req.param("repoId");
      const prNumber = parseInt(c.req.param("prNumber"));
      const body = c.req.valid("json");

      const mergeMethodRaw = body.merge_method;
      const mergeMethod: "merge" | "squash" | "rebase" =
        mergeMethodRaw === "merge" || mergeMethodRaw === "squash" ||
          mergeMethodRaw === "rebase"
          ? mergeMethodRaw
          : "merge";

      if (mergeMethodRaw !== undefined && mergeMethod !== mergeMethodRaw) {
        throw new BadRequestError("Invalid merge_method");
      }

      const commitMessage = typeof body.commit_message === "string"
        ? body.commit_message.trim()
        : "";

      const repoAccess = await checkRepoAccess(c.env, repoId, user.id);
      if (!repoAccess) {
        throw new NotFoundError("Repository");
      }

      const found = await findPullRequest(c.env.DB, repoId, prNumber);
      if (!found) {
        throw new NotFoundError("Pull request");
      }
      const { db, pullRequest } = found;

      if (pullRequest.status !== "open") {
        throw new BadRequestError("Pull request is already closed or merged");
      }

      try {
        const mergeResult = await performPullRequestMerge({
          env: c.env,
          db,
          repoId,
          pullRequest,
          mergeMethod,
          commitMessage,
          user,
        });

        if (!mergeResult.success) {
          return jsonErrorWithStatus(mergeResult.body, mergeResult.status);
        }

        return c.json({
          pull_request: await buildPullRequestDtoFull(
            db,
            mergeResult.pullRequest,
          ),
          merge_commit: mergeResult.mergeCommit,
        });
      } catch (err: unknown) {
        logError("Failed to merge", err, {
          module: "routes/pull-requests/base",
        });
        throw new InternalError("Failed to perform merge");
      }
    },
  )
  .get("/repos/:repoId/pulls/:prNumber/conflicts", async (c) => {
    const user = c.get("user");
    const repoId = c.req.param("repoId");
    const prNumber = parseInt(c.req.param("prNumber"));

    const repoAccess = await checkRepoAccess(
      c.env,
      repoId,
      user?.id,
      { allowPublicRead: true },
    );
    if (!repoAccess) {
      throw new NotFoundError("Repository");
    }

    const found = await findPullRequest(c.env.DB, repoId, prNumber);
    if (!found) {
      throw new NotFoundError("Pull request");
    }
    const { pullRequest } = found;

    if (pullRequest.status !== "open") {
      throw new BadRequestError("Pull request is not open");
    }

    const bucketBinding = c.env.GIT_OBJECTS;
    if (!bucketBinding) throw new InternalError("Git storage not configured");
    const bucket = toGitBucket(bucketBinding);

    try {
      const result = await checkConflicts(
        c.env.DB,
        bucket,
        repoId,
        pullRequest.baseBranch,
        pullRequest.headBranch,
      );

      if (result.message) {
        return c.json({
          conflicts: result.conflicts,
          merge_base: result.merge_base,
          message: result.message,
        }, 409);
      }

      return c.json(result);
    } catch (err: unknown) {
      if (err instanceof ConflictCheckError) {
        throw new AppError(err.message, undefined, err.status);
      }
      throw err;
    }
  })
  .post("/repos/:repoId/pulls/:prNumber/resolve", async (c) => {
    const user = c.get("user");
    const repoId = c.req.param("repoId");
    const prNumber = parseInt(c.req.param("prNumber"));
    const body = await parseJsonBody<{
      resolutions: Array<{ path: string; content: string; delete?: boolean }>;
      commit_message?: string;
    }>(c, { resolutions: [] });

    if (!body || !body.resolutions || !Array.isArray(body.resolutions)) {
      throw new BadRequestError("resolutions array is required");
    }

    const repoAccess = await checkRepoAccess(c.env, repoId, user.id);
    if (!repoAccess) {
      throw new NotFoundError("Repository");
    }

    const found = await findPullRequest(c.env.DB, repoId, prNumber);
    if (!found) {
      throw new NotFoundError("Pull request");
    }
    const { db, pullRequest } = found;

    if (pullRequest.status !== "open") {
      throw new BadRequestError("Pull request is not open");
    }

    const bucketBinding = c.env.GIT_OBJECTS;
    if (!bucketBinding) throw new InternalError("Git storage not configured");
    const bucket = toGitBucket(bucketBinding);

    // Validate and normalize resolutions in the route layer (early return on bad input)
    const normalizedResolutions: Resolution[] = [];
    const seenResolutionPaths = new Set<string>();
    for (const resolution of body.resolutions) {
      const normalizedPath = validateConflictResolutionPath(resolution.path);
      if (!normalizedPath) {
        throw new BadRequestError("Invalid resolution path");
      }
      if (seenResolutionPaths.has(normalizedPath)) {
        throw new BadRequestError(
          `Duplicate resolution path: ${normalizedPath}`,
        );
      }
      seenResolutionPaths.add(normalizedPath);

      const isDelete = resolution.delete === true;
      if (!isDelete && typeof resolution.content !== "string") {
        throw new BadRequestError(
          `Resolution content must be a string for path: ${normalizedPath}`,
        );
      }

      normalizedResolutions.push({
        path: normalizedPath,
        content: isDelete ? "" : resolution.content,
        delete: isDelete,
      });
    }

    try {
      const result = await resolveConflictsAndMerge({
        db: c.env.DB,
        bucket,
        repoId,
        pullRequestId: pullRequest.id,
        baseBranch: pullRequest.baseBranch,
        headBranch: pullRequest.headBranch,
        resolutions: normalizedResolutions,
        commitMessage: body.commit_message,
        user,
      });

      if (!result.success) {
        return jsonErrorWithStatus(result.body, result.status);
      }

      return c.json({
        pull_request: await buildPullRequestDtoFull(db, result.pullRequest),
        merge_commit: result.mergeCommit,
      });
    } catch (err: unknown) {
      logError("Failed to resolve conflicts", err, {
        module: "routes/pull-requests/base",
      });
      throw new InternalError("Failed to resolve conflicts");
    }
  });
