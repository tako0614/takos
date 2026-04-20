/**
 * External Git Repository Import Routes.
 *
 * POST /repos/import-external         — Import a repo from an external Git URL
 * POST /repos/:repoId/fetch-remote    — Re-fetch updates from the remote origin
 */

import { Hono } from "hono";
import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import {
  fetchRemoteUpdates,
  importExternalRepository,
} from "../../../application/services/source/external-import.ts";
import { buildAuthHeader } from "../../../application/services/source/external-import-utils.ts";
import { getDb, repositories } from "../../../infra/db/index.ts";
import { eq } from "drizzle-orm";
import { logError } from "../../../shared/utils/logger.ts";
import {
  AuthenticationError,
  BadRequestError,
  ConflictError,
  InternalError,
  isAppError,
  NotFoundError,
} from "takos-common/errors";

export default new Hono<AuthenticatedRouteEnv>()
  // ── Import external repository ──────────────────────────────────

  .post("/repos/import-external", async (c) => {
    const user = c.get("user");
    if (!user) throw new AuthenticationError();

    let body: {
      url?: string;
      space_id?: string;
      name?: string;
      auth?: { token?: string; username?: string; password?: string };
      description?: string;
      visibility?: string;
    };

    try {
      body = await c.req.json();
    } catch {
      // Request body is not valid JSON
      throw new BadRequestError("Invalid JSON body");
    }

    const { url, space_id, name, auth, description, visibility } = body;

    if (!url || typeof url !== "string") {
      throw new BadRequestError("url is required");
    }

    if (!space_id || typeof space_id !== "string") {
      throw new BadRequestError("space_id is required");
    }

    // Validate URL format
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      // URL constructor throws on malformed input
      throw new BadRequestError("Invalid URL format");
    }
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      throw new BadRequestError("Only https:// URLs are supported");
    }

    const bucket = c.env.GIT_OBJECTS;
    if (!bucket) {
      throw new InternalError("Git storage not configured");
    }

    const authHeader = buildAuthHeader(auth);

    try {
      const result = await importExternalRepository(c.env.DB, bucket, {
        accountId: space_id,
        url,
        name: typeof name === "string" ? name : undefined,
        authHeader,
        description: typeof description === "string" ? description : undefined,
        visibility: visibility === "public" ? "public" : "private",
      });

      return c.json({
        repository: {
          id: result.repositoryId,
          name: result.name,
          default_branch: result.defaultBranch,
          remote_clone_url: result.remoteUrl,
        },
        import_summary: {
          branches: result.branchCount,
          tags: result.tagCount,
          commits: result.commitCount,
        },
      }, 201);
    } catch (err) {
      if (isAppError(err)) throw err;
      const message = err instanceof Error ? err.message : "Import failed";
      logError("External import failed", err, {
        module: "routes/external-import",
      });

      if (message.includes("already exists")) {
        throw new ConflictError(message);
      }
      if (message.includes("HTTP 401") || message.includes("HTTP 403")) {
        throw new AuthenticationError(
          "Authentication failed: check your credentials",
        );
      }
      if (message.includes("HTTP 404")) {
        throw new NotFoundError("Repository");
      }

      throw new InternalError(message);
    }
  })
  // ── Fetch remote updates ────────────────────────────────────────

  .post("/repos/:repoId/fetch-remote", async (c) => {
    const user = c.get("user");
    if (!user) throw new AuthenticationError();

    const repoId = c.req.param("repoId");
    if (!repoId) throw new BadRequestError("repoId is required");

    const bucket = c.env.GIT_OBJECTS;
    if (!bucket) {
      throw new InternalError("Git storage not configured");
    }

    // Verify repo exists and has a remote URL
    const db = getDb(c.env.DB);
    const repo = await db.select({
      id: repositories.id,
      remoteCloneUrl: repositories.remoteCloneUrl,
      accountId: repositories.accountId,
    }).from(repositories)
      .where(eq(repositories.id, repoId))
      .get();

    if (!repo) {
      throw new NotFoundError("Repository");
    }

    if (!repo.remoteCloneUrl) {
      throw new BadRequestError("Repository does not have a remote origin");
    }

    try {
      const result = await fetchRemoteUpdates(c.env.DB, bucket, repoId);

      return c.json({
        new_commits: result.newCommits,
        updated_branches: result.updatedBranches,
        new_tags: result.newTags,
        up_to_date: result.newCommits === 0 &&
          result.updatedBranches.length === 0,
      });
    } catch (err) {
      if (isAppError(err)) throw err;
      const message = err instanceof Error ? err.message : "Fetch failed";
      logError("Remote fetch failed", err, {
        module: "routes/external-import",
      });
      throw new InternalError(message);
    }
  });
