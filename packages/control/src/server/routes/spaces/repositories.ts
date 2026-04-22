import { Hono } from "hono";
import {
  type AuthenticatedRouteEnv,
  requireSpaceAccess,
} from "../route-auth.ts";
import { getRepositoryById } from "../../../application/services/identity/spaces.ts";
import { getDb } from "../../../infra/db/index.ts";
import { desc, eq } from "drizzle-orm";
import { repositories } from "../../../infra/db/schema.ts";
import { generateId } from "../../../shared/utils/index.ts";
import { logError } from "../../../shared/utils/logger.ts";
import { InternalError } from "takos-common/errors";

export default new Hono<AuthenticatedRouteEnv>()
  .post("/:spaceId/init-repo", async (c) => {
    const user = c.get("user");
    const spaceIdentifier = c.req.param("spaceId");

    const access = await requireSpaceAccess(
      c,
      spaceIdentifier,
      user.id,
      ["owner", "admin"],
      "Workspace not found or insufficient permissions",
    );

    const spaceId = access.space.id;

    const db = getDb(c.env.DB);

    const existingRepo = await db.select()
      .from(repositories)
      .where(eq(repositories.accountId, spaceId))
      .orderBy(desc(repositories.updatedAt))
      .get() ?? null;

    if (existingRepo) {
      const repository = await getRepositoryById(c.env.DB, existingRepo.id);
      return c.json({
        message: "Repository already exists",
        skipped: true,
        repository,
      });
    }

    const repoId = generateId();
    const timestamp = new Date().toISOString();

    try {
      await db.insert(repositories).values({
        id: repoId,
        accountId: spaceId,
        name: "main",
        description: "Default repository for workspace",
        visibility: "private",
        defaultBranch: "main",
        stars: 0,
        forks: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      const repository = await getRepositoryById(c.env.DB, repoId);

      return c.json({
        message: "Repository initialized successfully",
        repository,
      }, 201);
    } catch (err) {
      logError(`Failed to init repo for workspace ${spaceId}`, err, {
        module: "routes/spaces/repositories",
      });
      throw new InternalError(
        err instanceof Error ? err.message : "Failed to initialize repository",
      );
    }
  });
