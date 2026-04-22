import { Hono } from "hono";
import { z } from "zod";

import { requireSpaceAccess } from "../route-auth.ts";
import {
  AppError,
  BadRequestError,
  ConflictError,
  ErrorCodes,
  InternalError,
  ValidationError,
} from "takos-common/errors";
import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import { zValidator } from "../zod-validator.ts";
import * as gitStore from "../../../application/services/git-smart/index.ts";
import {
  checkRepoAccess,
  createRepository,
  listRepositoriesBySpace,
  RepositoryCreationError,
} from "../../../application/services/source/repos.ts";
import { getDb } from "../../../infra/db/index.ts";
import {
  accounts,
  branches,
  repoForks,
  repoRemotes,
  repositories,
  repoStars,
  workflowSecrets,
} from "../../../infra/db/schema.ts";
import { and, eq, sql } from "drizzle-orm";
import { invalidateCacheOnMutation } from "../../middleware/cache.ts";
import { logError, logWarn } from "../../../shared/utils/logger.ts";
import { requireFound } from "../validation-utils.ts";
import { recordRepoDeleteActivity } from "../../../application/services/store-network/push-activities.ts";

// Re-export shared utilities so existing sibling imports (e.g. `from './routes.ts'`) keep working.
export {
  encodeBase64,
  generateExploreInvalidationUrls,
  getTreeFlattenLimitError,
  type GitBucket,
  hasWriteRole,
  readableCommitErrorResponse,
  type RepoBucketBinding,
  sanitizeRepoName,
  toGitBucket,
  type TreeFlattenLimitErrorCode,
} from "./shared.ts";

import { generateExploreInvalidationUrls } from "./shared.ts";
import {
  cleanupRepoGitObjects,
  collectCleanupCandidates,
  deleteR2Prefix,
  formatRepositoryResponse,
  resolveOwnerUsername,
} from "./repo-utils.ts";

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default new Hono<AuthenticatedRouteEnv>()
  .post(
    "/spaces/:spaceId/repos",
    invalidateCacheOnMutation([generateExploreInvalidationUrls]),
    zValidator(
      "json",
      z.object({
        name: z.string().min(1, "Repository name is required"),
        description: z.string().optional(),
        visibility: z.enum(["public", "private", "internal"]).optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const spaceIdentifier = c.req.param("spaceId");
      const body = c.req.valid("json");

      const access = await requireSpaceAccess(
        c,
        spaceIdentifier,
        user.id,
        ["owner", "admin", "editor"],
        "Workspace not found or insufficient permissions",
      );
      const spaceId = access.space.id;

      const db = getDb(c.env.DB);
      let createdRepository;
      try {
        createdRepository = await createRepository(
          c.env.DB,
          c.env.GIT_OBJECTS,
          {
            spaceId,
            name: body.name,
            description: body.description || null,
            visibility: body.visibility || "private",
            actorAccountId: user.id,
          },
        );
      } catch (err) {
        if (err instanceof RepositoryCreationError) {
          switch (err.code) {
            case "INVALID_NAME":
              throw new BadRequestError(err.message);
            case "SPACE_NOT_FOUND":
              throw new AppError(err.message, ErrorCodes.NOT_FOUND, 404);
            case "REPOSITORY_EXISTS":
              throw new ConflictError(err.message);
            case "GIT_STORAGE_NOT_CONFIGURED":
            case "INIT_FAILED":
              throw new InternalError(err.message);
          }
        }
        logError("Failed to create repository", err, {
          action: "createRepository",
          userId: user.id,
          spaceId,
        });
        // Handle database constraint errors inline (replaces handleDbError)
        const errStr = String(err);
        if (errStr.includes("UNIQUE constraint")) {
          throw new ConflictError(
            "workspace already exists",
          );
        }
        if (
          errStr.includes("FOREIGN KEY constraint")
        ) throw new BadRequestError("Referenced workspace does not exist");
        if (errStr.includes("NOT NULL constraint")) {
          throw new ValidationError(
            "Required field is missing",
          );
        }
        throw new InternalError("Database operation failed");
      }

      const ownerUsername = await resolveOwnerUsername(
        db,
        createdRepository.space_id,
      );

      const repositoryResponse = formatRepositoryResponse(
        {
          name: createdRepository.name,
          description: createdRepository.description,
          visibility: createdRepository.visibility,
          defaultBranch: createdRepository.default_branch,
          stars: createdRepository.stars,
          forks: createdRepository.forks,
          gitEnabled: createdRepository.git_enabled,
          createdAt: createdRepository.created_at,
          updatedAt: createdRepository.updated_at,
        },
        ownerUsername || user.username,
      );

      return c.json({ repository: repositoryResponse }, 201);
    },
  )
  .get("/spaces/:spaceId/repos", async (c) => {
    const user = c.get("user");
    const spaceIdentifier = c.req.param("spaceId");
    const db = getDb(c.env.DB);

    const access = await requireSpaceAccess(c, spaceIdentifier, user.id);
    const spaceId = access.space.id;

    const ownerUsername = await resolveOwnerUsername(db, spaceId);

    const reposData = await listRepositoriesBySpace(c.env.DB, spaceId);

    const reposList = reposData.map((repo) => ({
      id: repo.id,
      owner_username: ownerUsername,
      owner: ownerUsername ? { username: ownerUsername } : undefined,
      name: repo.name,
      description: repo.description,
      visibility: repo.visibility,
      default_branch: repo.default_branch,
      stars: repo.stars,
      forks: repo.forks,
      git_enabled: repo.git_enabled,
      created_at: repo.created_at,
      updated_at: repo.updated_at,
    }));

    return c.json({ repositories: reposList });
  })
  .get("/repos/:repoId", async (c) => {
    const user = c.get("user");
    const repoId = c.req.param("repoId");
    const db = getDb(c.env.DB);

    const repoAccess = requireFound(
      await checkRepoAccess(
        c.env,
        repoId,
        user?.id,
        undefined,
        { allowPublicRead: true },
      ),
      "Repository",
    );

    const repoResult = requireFound(
      await db.select().from(repositories).where(eq(repositories.id, repoId))
        .get(),
      "Repository",
    );

    const userRole = user?.id ? repoAccess.role : null;

    let branchCount = 0;
    try {
      const branchesList = await gitStore.listBranches(c.env.DB, repoId);
      branchCount = branchesList.length;
    } catch (err) {
      logError("Failed to get branch count", err, {
        action: "getRepo",
        repoId,
      });
    }

    const star = user?.id
      ? await db.select({ accountId: repoStars.accountId })
        .from(repoStars)
        .where(
          and(eq(repoStars.accountId, user.id), eq(repoStars.repoId, repoId)),
        )
        .get()
      : null;

    const workspaceData = await db.select({
      id: accounts.id,
      name: accounts.name,
      slug: accounts.slug,
      picture: accounts.picture,
    })
      .from(accounts)
      .where(eq(accounts.id, repoResult.accountId))
      .get();

    const ownerName = await resolveOwnerUsername(db, repoResult.accountId);

    const repository = formatRepositoryResponse(
      repoResult,
      ownerName || workspaceData?.id || "",
    );

    return c.json({
      repository,
      branch_count: branchCount,
      starred: !!star,
      user_role: userRole,
      workspace: workspaceData ? { name: workspaceData.name } : null,
      owner: workspaceData
        ? {
          name: workspaceData.name,
          picture: workspaceData.picture || null,
        }
        : null,
    });
  })
  .patch(
    "/repos/:repoId",
    invalidateCacheOnMutation([generateExploreInvalidationUrls]),
    zValidator(
      "json",
      z.object({
        name: z.string().min(1, "Repository name must not be empty").optional(),
        description: z.string().optional(),
        visibility: z.enum(["public", "private", "internal"]).optional(),
        default_branch: z.string().min(1, "default_branch must not be empty")
          .optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const repoId = c.req.param("repoId");
      const body = c.req.valid("json");

      const _repoAccess = requireFound(
        await checkRepoAccess(c.env, repoId, user.id, ["owner", "admin"]),
        "Repository",
      );

      const db = getDb(c.env.DB);
      const data: Record<string, string | number> = {};

      if (body.description !== undefined) {
        data.description = body.description;
      }

      if (body.visibility) {
        data.visibility = body.visibility;
      }

      if (body.default_branch !== undefined) {
        const nextDefaultBranch = body.default_branch.trim();
        if (!gitStore.isValidRefName(nextDefaultBranch)) {
          throw new BadRequestError("Invalid default_branch");
        }
        const existingBranch = await gitStore.getBranch(
          c.env.DB,
          repoId,
          nextDefaultBranch,
        );
        if (!existingBranch) {
          throw new BadRequestError("default_branch does not exist");
        }
        data.defaultBranch = nextDefaultBranch;
      }

      if (Object.keys(data).length === 0) {
        throw new BadRequestError("No valid updates provided");
      }

      const timestamp = new Date().toISOString();
      data.updatedAt = timestamp;

      const updatedRepoArr = await db.update(repositories)
        .set(data)
        .where(eq(repositories.id, repoId))
        .returning();
      const updatedRepo = updatedRepoArr[0];

      const updatedOwnerUsername = await resolveOwnerUsername(
        db,
        updatedRepo.accountId,
      );

      const repository = formatRepositoryResponse(
        updatedRepo,
        updatedOwnerUsername || updatedRepo.accountId,
      );

      return c.json({ repository });
    },
  )
  .delete(
    "/repos/:repoId",
    invalidateCacheOnMutation([generateExploreInvalidationUrls]),
    async (c) => {
      const user = c.get("user");
      const repoId = c.req.param("repoId");
      const db = getDb(c.env.DB);

      const repoAccess = requireFound(
        await checkRepoAccess(c.env, repoId, user.id, ["owner", "admin"]),
        "Repository",
      );

      const repoObjectCandidates = c.env.GIT_OBJECTS
        ? await collectCleanupCandidates(c.env.DB, c.env.GIT_OBJECTS, repoId)
        : null;

      // Record a delete event before the repo is removed so Store Network feeds
      // can expose the deletion after the repository row is gone.
      try {
        const [ownerSlug, defaultBranch] = await Promise.all([
          resolveOwnerUsername(db, repoAccess.repo.space_id),
          db.select({ commitSha: branches.commitSha }).from(branches)
            .where(and(
              eq(branches.repoId, repoId),
              eq(branches.name, repoAccess.repo.default_branch || "main"),
            ))
            .limit(1)
            .get(),
        ]);
        await recordRepoDeleteActivity(c.env.DB, {
          repoId,
          accountId: repoAccess.repo.space_id,
          repository: {
            ownerSlug: ownerSlug || repoAccess.repo.space_id,
            name: repoAccess.repo.name,
            summary: repoAccess.repo.description,
            visibility: repoAccess.repo.visibility,
            defaultBranch: repoAccess.repo.default_branch || "main",
            defaultBranchHash: defaultBranch?.commitSha ?? null,
            createdAt: repoAccess.repo.created_at,
            updatedAt: repoAccess.repo.updated_at,
          },
        });
      } catch (_err) {
        logWarn("Failed to record repo delete activity", {
          action: "deleteRepository",
          repoId,
        });
      }

      await db.delete(branches).where(eq(branches.repoId, repoId));
      await db.delete(repoForks).where(eq(repoForks.forkRepoId, repoId));
      await db.delete(repoRemotes).where(eq(repoRemotes.repoId, repoId));
      await db.delete(workflowSecrets).where(
        eq(workflowSecrets.repoId, repoId),
      );
      await db.delete(repositories).where(eq(repositories.id, repoId));

      if (repoAccess.repo.forked_from_id) {
        await db.update(repositories)
          .set({ forks: sql`${repositories.forks} - 1` })
          .where(eq(repositories.id, repoAccess.repo.forked_from_id));
      }

      const gitObjects = c.env.GIT_OBJECTS;
      if (gitObjects) {
        c.executionCtx.waitUntil((async () => {
          try {
            await deleteR2Prefix(gitObjects, `release-assets/${repoId}/`);
          } catch (_error) {
            logWarn("Failed to cleanup release assets", {
              action: "deleteRepository",
              repoId,
            });
          }

          if (!repoObjectCandidates || repoObjectCandidates.size === 0) {
            return;
          }

          try {
            await cleanupRepoGitObjects(
              db,
              c.env.DB,
              gitObjects,
              repoId,
              repoObjectCandidates,
            );
          } catch (_error) {
            logWarn("Failed to cleanup repo git objects", {
              action: "deleteRepository",
              repoId,
            });
          }
        })());
      }

      return c.json({ success: true });
    },
  );
