import type { Context, Hono } from "hono";
import {
  actorFromAuthenticatedRequest,
  optionalActorAccountId,
} from "../shared/api/auth.ts";
import type { ApiBindings } from "../shared/api/bindings.ts";
import {
  commonError,
  parsePositiveLimit,
  resolveRequestId,
} from "../shared/api/common.ts";
import {
  ExploreCatalogInputError,
  listExploreCatalog,
} from "../shared/explore/catalog.ts";
import {
  ExploreDiscoveryInputError,
  ExploreDiscoveryNotFoundError,
  listExploreRepoNew,
  listExploreRepoRecent,
  listExploreRepoSearch,
  listExploreRepoTrend,
  listExploreUsers,
  readExploreRepoById,
  readExploreRepoByName,
  readExploreUser,
} from "../shared/explore/discovery.ts";
import {
  ExplorePackageInputError,
  ExplorePackageNotFoundError,
  listExplorePackages,
  readExplorePackageReviews,
  readExplorePackageVersions,
  readLatestExplorePackage,
  suggestExplorePackages,
} from "../shared/explore/packages.ts";
import { buildCatalogSuggestions } from "../shared/explore/suggestions.ts";
import { readSpaceMembershipRole } from "../shared/spaces/access.ts";

async function handleExploreSuggest(c: Context<{ Bindings: ApiBindings }>) {
  const db = c.env?.DB;
  if (!db) {
    return c.json(commonError("INTERNAL_ERROR", "database is not configured"), {
      status: 500,
    });
  }
  const q = c.req.query("q")?.trim() || "";
  const limit = parsePositiveLimit(c.req.query("limit"), 8, 20);
  if (!q) {
    return c.json({ users: [], repos: [] });
  }
  return c.json(await buildCatalogSuggestions(db, q, limit));
}

export function registerExplorePublicRoutes(
  app: Hono<{ Bindings: ApiBindings }>,
): void {
  app.get("/api/explore/suggest", (c) => handleExploreSuggest(c));

  app.get("/api/explore/catalog/suggest", (c) => handleExploreSuggest(c));

  app.get("/api/explore/catalog", async (c) => {
    const db = c.env?.DB;
    if (!db) {
      return c.json(
        commonError("INTERNAL_ERROR", "database is not configured"),
        { status: 500 },
      );
    }

    const spaceId = c.req.query("space_id")?.trim();
    let userId: string | undefined;
    if (spaceId) {
      const actorResult = await actorFromAuthenticatedRequest(
        c.req.raw,
        resolveRequestId(c.req),
        { env: c.env },
      );
      if (!actorResult.ok) return actorResult.response;
      const role = await readSpaceMembershipRole(
        db,
        spaceId,
        actorResult.actor.actorAccountId,
      );
      if (!role) {
        return c.json(
          commonError("PERMISSION_DENIED", "Workspace access denied"),
          { status: 403 },
        );
      }
      userId = actorResult.actor.actorAccountId;
    }

    try {
      return c.json(
        await listExploreCatalog(
          { ...c.env, DB: db },
          c.req.raw.url,
          {
            ...(spaceId ? { spaceId } : {}),
            ...(userId ? { userId } : {}),
          },
        ),
      );
    } catch (error) {
      if (error instanceof ExploreCatalogInputError) {
        return c.json(commonError("INVALID_ARGUMENT", error.message), {
          status: 400,
        });
      }
      throw error;
    }
  });

  app.get("/api/explore/users", async (c) => {
    const db = c.env?.DB;
    if (!db) {
      return c.json(
        commonError("INTERNAL_ERROR", "database is not configured"),
        { status: 500 },
      );
    }
    return c.json(await listExploreUsers(db, c.req.raw.url));
  });

  app.get("/api/explore/users/:username", async (c) => {
    const db = c.env?.DB;
    if (!db) {
      return c.json(
        commonError("INTERNAL_ERROR", "database is not configured"),
        { status: 500 },
      );
    }
    const actor = await optionalActorAccountId(c.req.raw, resolveRequestId(c.req), {
      env: c.env,
    });
    try {
      return c.json(
        await readExploreUser(
          db,
          c.req.param("username"),
          actor.actorAccountId,
        ),
      );
    } catch (error) {
      if (error instanceof ExploreDiscoveryNotFoundError) {
        return c.json(commonError("NOT_FOUND", error.message), { status: 404 });
      }
      throw error;
    }
  });

  app.get("/api/explore/repos", async (c) => {
    const db = c.env?.DB;
    if (!db) {
      return c.json(
        commonError("INTERNAL_ERROR", "database is not configured"),
        { status: 500 },
      );
    }
    const actor = await optionalActorAccountId(c.req.raw, resolveRequestId(c.req), {
      env: c.env,
    });
    try {
      return c.json(
        await listExploreRepoSearch(db, c.req.raw.url, actor.actorAccountId),
      );
    } catch (error) {
      if (error instanceof ExploreDiscoveryInputError) {
        return c.json(commonError("INVALID_ARGUMENT", error.message), {
          status: 400,
        });
      }
      throw error;
    }
  });

  app.get("/api/explore/repos/trending", async (c) => {
    const db = c.env?.DB;
    if (!db) {
      return c.json(
        commonError("INTERNAL_ERROR", "database is not configured"),
        { status: 500 },
      );
    }
    const actor = await optionalActorAccountId(c.req.raw, resolveRequestId(c.req), {
      env: c.env,
    });
    try {
      return c.json(
        await listExploreRepoTrend(db, c.req.raw.url, actor.actorAccountId),
      );
    } catch (error) {
      if (error instanceof ExploreDiscoveryInputError) {
        return c.json(commonError("INVALID_ARGUMENT", error.message), {
          status: 400,
        });
      }
      throw error;
    }
  });

  app.get("/api/explore/repos/new", async (c) => {
    const db = c.env?.DB;
    if (!db) {
      return c.json(
        commonError("INTERNAL_ERROR", "database is not configured"),
        { status: 500 },
      );
    }
    const actor = await optionalActorAccountId(c.req.raw, resolveRequestId(c.req), {
      env: c.env,
    });
    try {
      return c.json(
        await listExploreRepoNew(db, c.req.raw.url, actor.actorAccountId),
      );
    } catch (error) {
      if (error instanceof ExploreDiscoveryInputError) {
        return c.json(commonError("INVALID_ARGUMENT", error.message), {
          status: 400,
        });
      }
      throw error;
    }
  });

  app.get("/api/explore/repos/recent", async (c) => {
    const db = c.env?.DB;
    if (!db) {
      return c.json(
        commonError("INTERNAL_ERROR", "database is not configured"),
        { status: 500 },
      );
    }
    const actor = await optionalActorAccountId(c.req.raw, resolveRequestId(c.req), {
      env: c.env,
    });
    try {
      return c.json(
        await listExploreRepoRecent(db, c.req.raw.url, actor.actorAccountId),
      );
    } catch (error) {
      if (error instanceof ExploreDiscoveryInputError) {
        return c.json(commonError("INVALID_ARGUMENT", error.message), {
          status: 400,
        });
      }
      throw error;
    }
  });

  app.get("/api/explore/repos/by-name/:username/:repoName", async (c) => {
    const db = c.env?.DB;
    if (!db) {
      return c.json(
        commonError("INTERNAL_ERROR", "database is not configured"),
        { status: 500 },
      );
    }
    const actor = await optionalActorAccountId(c.req.raw, resolveRequestId(c.req), {
      env: c.env,
    });
    try {
      return c.json(
        await readExploreRepoByName(
          { ...c.env, DB: db },
          c.req.param("username"),
          c.req.param("repoName"),
          actor.actorAccountId,
        ),
      );
    } catch (error) {
      if (error instanceof ExploreDiscoveryNotFoundError) {
        return c.json(commonError("NOT_FOUND", error.message), { status: 404 });
      }
      throw error;
    }
  });

  app.get("/api/explore/repos/:id", async (c) => {
    const db = c.env?.DB;
    if (!db) {
      return c.json(
        commonError("INTERNAL_ERROR", "database is not configured"),
        { status: 500 },
      );
    }
    const actor = await optionalActorAccountId(c.req.raw, resolveRequestId(c.req), {
      env: c.env,
    });
    try {
      return c.json(
        await readExploreRepoById(db, c.req.param("id"), actor.actorAccountId),
      );
    } catch (error) {
      if (error instanceof ExploreDiscoveryNotFoundError) {
        return c.json(commonError("NOT_FOUND", error.message), { status: 404 });
      }
      throw error;
    }
  });

  app.get("/api/explore/packages", async (c) => {
    const db = c.env?.DB;
    if (!db) {
      return c.json(
        commonError("INTERNAL_ERROR", "database is not configured"),
        { status: 500 },
      );
    }
    try {
      return c.json(await listExplorePackages(db, c.req.raw.url));
    } catch (error) {
      if (error instanceof ExplorePackageInputError) {
        return c.json(commonError("INVALID_ARGUMENT", error.message), {
          status: 400,
        });
      }
      throw error;
    }
  });

  app.get("/api/explore/packages/suggest", async (c) => {
    const db = c.env?.DB;
    if (!db) {
      return c.json(
        commonError("INTERNAL_ERROR", "database is not configured"),
        { status: 500 },
      );
    }
    try {
      return c.json(await suggestExplorePackages(db, c.req.raw.url));
    } catch (error) {
      if (error instanceof ExplorePackageInputError) {
        return c.json(commonError("INVALID_ARGUMENT", error.message), {
          status: 400,
        });
      }
      throw error;
    }
  });

  app.get("/api/explore/packages/:username/:repoName/latest", async (c) => {
    const db = c.env?.DB;
    if (!db) {
      return c.json(
        commonError("INTERNAL_ERROR", "database is not configured"),
        { status: 500 },
      );
    }
    try {
      return c.json(
        await readLatestExplorePackage(
          { ...c.env, DB: db },
          c.req.param("username"),
          c.req.param("repoName"),
        ),
      );
    } catch (error) {
      if (error instanceof ExplorePackageNotFoundError) {
        return c.json(commonError("NOT_FOUND", error.message), { status: 404 });
      }
      throw error;
    }
  });

  app.get("/api/explore/packages/:username/:repoName/versions", async (c) => {
    const db = c.env?.DB;
    if (!db) {
      return c.json(
        commonError("INTERNAL_ERROR", "database is not configured"),
        { status: 500 },
      );
    }
    try {
      return c.json(
        await readExplorePackageVersions(
          { ...c.env, DB: db },
          c.req.param("username"),
          c.req.param("repoName"),
        ),
      );
    } catch (error) {
      if (error instanceof ExplorePackageNotFoundError) {
        return c.json(commonError("NOT_FOUND", error.message), { status: 404 });
      }
      throw error;
    }
  });

  app.get("/api/explore/packages/by-repo/:repoId/reviews", async (c) => {
    const db = c.env?.DB;
    if (!db) {
      return c.json(
        commonError("INTERNAL_ERROR", "database is not configured"),
        { status: 500 },
      );
    }
    try {
      return c.json(
        await readExplorePackageReviews(db, c.req.param("repoId")),
      );
    } catch (error) {
      if (error instanceof ExplorePackageNotFoundError) {
        return c.json(commonError("NOT_FOUND", error.message), { status: 404 });
      }
      throw error;
    }
  });
}
