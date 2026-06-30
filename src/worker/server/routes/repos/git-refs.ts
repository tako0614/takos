import { Hono } from "hono";
import { z } from "zod";
import { parseJsonBody } from "../route-auth.ts";
import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import { zValidator } from "../zod-validator.ts";
import * as gitStore from "../../../application/services/takos-git/index.ts";
import { toGitBucket } from "./routes.ts";
import {
  AuthorizationError,
  BadRequestError,
  ConflictError,
  InternalError,
  isAppError,
  NotFoundError,
} from "@takos/worker-platform-utils/errors";
import { logError } from "../../../shared/utils/logger.ts";
import {
  getCommitSha,
  requireRepoRead,
  requireRepoWrite,
  sigTimestampToIso,
} from "./git-shared.ts";

const gitRefs = new Hono<AuthenticatedRouteEnv>()
  .get(
    "/repos/:repoId/branches",
    zValidator(
      "query",
      z.object({
        include_commits: z.string().optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const repoId = c.req.param("repoId");
      const { include_commits } = c.req.valid("query");
      const includeCommits = include_commits === "true";

      const repoAccess = await requireRepoRead(c.env, repoId, user?.id, {
        allowPublicRead: true,
      });

      try {
        const branches = await gitStore.listBranches(c.env.DB, repoId);
        const defaultBranch = await gitStore.getDefaultBranch(c.env.DB, repoId);
        const bucket = c.env.GIT_OBJECTS
          ? toGitBucket(c.env.GIT_OBJECTS)
          : undefined;

        // Resolve each branch head's commit in ONE batched (chunked) index
        // query instead of one getCommit per branch, then fall back to the
        // object store only for index misses with bounded concurrency. This
        // turns a per-branch N+1 (N D1 + up to N R2 subrequests, which exhausts
        // the per-request subrequest cap on repos with many branches) into
        // ceil(N/90) D1 reads plus a small, capped R2 tail.
        const commitsBySha = includeCommits && bucket
          ? await gitStore.getCommitsFromIndex(
            c.env.DB,
            repoId,
            branches.map((b) => b.commit_sha).filter((sha): sha is string =>
              !!sha
            ),
          )
          : new Map<
            string,
            NonNullable<Awaited<ReturnType<typeof gitStore.getCommit>>>
          >();

        if (includeCommits && bucket) {
          const missing = [
            ...new Set(
              branches
                .map((b) => b.commit_sha)
                .filter((sha): sha is string => !!sha && !commitsBySha.has(sha)),
            ),
          ];
          const R2_FALLBACK_CONCURRENCY = 10;
          for (let i = 0; i < missing.length; i += R2_FALLBACK_CONCURRENCY) {
            const batch = missing.slice(i, i + R2_FALLBACK_CONCURRENCY);
            const resolved = await Promise.all(
              batch.map(async (sha) => {
                try {
                  // Branch heads are repo-bound SHAs, so the object-store
                  // fallthrough in getCommit is safe here.
                  return [sha, await gitStore.getCommit(
                    c.env.DB,
                    bucket,
                    repoId,
                    sha,
                  )] as const;
                } catch {
                  return [sha, null] as const;
                }
              }),
            );
            for (const [sha, commit] of resolved) {
              if (commit) commitsBySha.set(sha, commit);
            }
          }
        }

        const branchesWithCommits = branches.map((b) => {
          const result: {
            name: string;
            is_default: boolean;
            is_protected: boolean;
            commit_sha: string;
            latest_commit?: {
              sha: string;
              message: string;
              author_name: string;
              date: string;
            };
          } = {
            name: b.name,
            is_default: b.is_default,
            is_protected: b.is_protected,
            commit_sha: b.commit_sha,
          };

          if (includeCommits && b.commit_sha) {
            const commit = commitsBySha.get(b.commit_sha);
            if (commit) {
              result.latest_commit = {
                sha: getCommitSha(commit),
                message: commit.message,
                author_name: commit.author.name,
                date: sigTimestampToIso(commit.author.timestamp),
              };
            }
          }

          return result;
        });

        return c.json({
          branches: branchesWithCommits,
          default_branch: defaultBranch?.name || repoAccess.repo.default_branch,
        });
      } catch (err) {
        if (isAppError(err)) throw err;
        logError("Failed to list branches", err, {
          module: "routes/repos/git",
        });
        throw new InternalError("Failed to list branches");
      }
    },
  )
  .post("/repos/:repoId/branches", async (c) => {
    const user = c.get("user");
    const repoId = c.req.param("repoId");
    const body = await parseJsonBody<{
      name: string;
      source: string;
    }>(c);

    if (!body) {
      throw new BadRequestError("Invalid JSON body");
    }

    await requireRepoWrite(c.env, repoId, user.id);

    if (typeof body.name !== "string" || typeof body.source !== "string") {
      throw new BadRequestError("name and source are required");
    }

    const branchName = body.name.startsWith("refs/heads/")
      ? body.name.slice("refs/heads/".length).trim()
      : body.name.trim();
    const sourceRef = body.source.trim();

    if (!branchName || !sourceRef) {
      throw new BadRequestError("name and source are required");
    }
    if (!gitStore.isValidRefName(branchName)) {
      throw new BadRequestError("Invalid branch name");
    }
    if (!gitStore.isValidRefName(sourceRef)) {
      throw new BadRequestError("Invalid source ref");
    }

    try {
      const sourceSha = await gitStore.resolveRef(c.env.DB, repoId, sourceRef);
      if (!sourceSha) {
        throw new NotFoundError("Source ref");
      }

      const result = await gitStore.createBranch(
        c.env.DB,
        repoId,
        branchName,
        sourceSha,
        false,
      );
      if (!result.success) {
        throw new ConflictError(result.error || "Failed to create branch", {
          current: result.current,
        });
      }

      return c.json({
        success: true,
        branch: {
          name: branchName,
          commit_sha: sourceSha,
        },
      }, 201);
    } catch (err) {
      if (isAppError(err)) throw err;
      logError("Failed to create branch", err, { module: "routes/repos/git" });
      throw new InternalError("Failed to create branch");
    }
  })
  .delete("/repos/:repoId/branches/:branchName", async (c) => {
    const user = c.get("user");
    const repoId = c.req.param("repoId");
    const branchName = c.req.param("branchName");

    const repoAccess = await requireRepoRead(c.env, repoId, user.id);

    if (repoAccess.role !== "owner" && repoAccess.role !== "admin") {
      throw new AuthorizationError("Admin access required");
    }
    if (!gitStore.isValidRefName(branchName)) {
      throw new BadRequestError("Invalid branch name");
    }

    try {
      const result = await gitStore.deleteBranch(c.env.DB, repoId, branchName);
      if (!result.success) {
        throw new BadRequestError(result.error || "Failed to delete branch");
      }
      return c.json({ success: true });
    } catch (err) {
      if (isAppError(err)) throw err;
      logError("Failed to delete branch", err, { module: "routes/repos/git" });
      throw new InternalError("Failed to delete branch");
    }
  })
  .post("/repos/:repoId/branches/:branchName/default", async (c) => {
    const user = c.get("user");
    const repoId = c.req.param("repoId");
    const branchName = c.req.param("branchName");

    const repoAccess = await requireRepoRead(c.env, repoId, user.id);

    if (repoAccess.role !== "owner" && repoAccess.role !== "admin") {
      throw new AuthorizationError("Admin access required");
    }
    if (!gitStore.isValidRefName(branchName)) {
      throw new BadRequestError("Invalid branch name");
    }

    try {
      const result = await gitStore.setDefaultBranch(
        c.env.DB,
        repoId,
        branchName,
      );
      if (!result.success) {
        throw new BadRequestError(
          result.error || "Failed to set default branch",
        );
      }
      return c.json({ success: true });
    } catch (err) {
      if (isAppError(err)) throw err;
      logError("Failed to set default branch", err, {
        module: "routes/repos/git",
      });
      throw new InternalError("Failed to set default branch");
    }
  });

export default gitRefs;
