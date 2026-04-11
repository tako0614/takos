import { Hono } from "hono";
import { z } from "zod";

import {
  BadRequestError,
  InternalError,
  NotFoundError,
} from "takos-common/errors";

import {
  type AuthenticatedRouteEnv,
  requireSpaceAccess,
} from "../route-auth.ts";
import { zValidator } from "../zod-validator.ts";
import {
  deletePublicationByName,
  getPublicationByName,
  listPublicationProviders,
  listPublications,
  type PublicationRecord,
  upsertApiPublication,
} from "../../../application/services/platform/service-publications.ts";
import { logError } from "../../../shared/utils/logger.ts";

async function resolveSpaceId(
  // deno-lint-ignore no-explicit-any
  c: any,
  userId: string,
  roles?: Array<"owner" | "admin">,
): Promise<string> {
  const headerSpaceId = c.req.header("X-Takos-Space-Id");
  if (headerSpaceId) {
    const access = await requireSpaceAccess(c, headerSpaceId, userId, roles);
    return access.space.id;
  }
  const access = await requireSpaceAccess(c, "me", userId, roles);
  return access.space.id;
}

function toPublicPublication(record: PublicationRecord) {
  const publication = record.publication;
  const resolved = Object.fromEntries(
    record.outputs
      .filter((output) => output.secret === false)
      .map((output) => [output.name, record.resolved[output.name]])
      .filter(([, value]) => typeof value === "string" && value.length > 0),
  );
  return {
    name: record.name,
    sourceType: record.sourceType,
    groupId: record.groupId,
    ownerServiceId: record.ownerServiceId,
    provider: publication.provider ?? null,
    kind: publication.kind ?? null,
    type: publication.type ?? null,
    publication,
    outputs: record.outputs,
    resolved,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

const publicationBodySchema = z.object({}).catchall(z.unknown());

const app = new Hono<AuthenticatedRouteEnv>()
  .get("/providers", async (c) => {
    const user = c.get("user");
    await resolveSpaceId(c, user.id);
    return c.json({
      providers: listPublicationProviders(),
    });
  })
  .get("/", async (c) => {
    const user = c.get("user");
    const spaceId = await resolveSpaceId(c, user.id);

    try {
      const publications = await listPublications(c.env, spaceId);
      return c.json({
        publications: publications.map((record) => toPublicPublication(record)),
      });
    } catch (err) {
      logError("Failed to list publications", err, {
        module: "routes/publications",
      });
      throw new InternalError("Failed to list publications");
    }
  })
  .get("/:name", async (c) => {
    const user = c.get("user");
    const spaceId = await resolveSpaceId(c, user.id);
    const name = c.req.param("name");

    try {
      const publication = await getPublicationByName(c.env, spaceId, name);
      if (!publication) {
        throw new NotFoundError("Publication");
      }
      return c.json({ publication: toPublicPublication(publication) });
    } catch (err) {
      if (err instanceof NotFoundError) throw err;
      logError("Failed to get publication", err, {
        module: "routes/publications",
      });
      throw new InternalError("Failed to get publication");
    }
  })
  .put(
    "/:name",
    zValidator("json", publicationBodySchema),
    async (c) => {
      const user = c.get("user");
      const spaceId = await resolveSpaceId(c, user.id, ["owner", "admin"]);
      const name = c.req.param("name");
      const body = c.req.valid("json");

      try {
        if (typeof body.name === "string" && body.name !== name) {
          throw new Error("publication name in path/body must match");
        }
        const publication = await upsertApiPublication(c.env, {
          spaceId,
          publication: {
            ...body,
            name,
          },
        });
        return c.json({
          success: true,
          publication: toPublicPublication(publication),
        });
      } catch (err) {
        logError("Failed to upsert publication", err, {
          module: "routes/publications",
        });
        if (err instanceof Error) {
          throw new BadRequestError(err.message);
        }
        throw new InternalError("Failed to upsert publication");
      }
    },
  )
  .delete("/:name", async (c) => {
    const user = c.get("user");
    const spaceId = await resolveSpaceId(c, user.id, ["owner", "admin"]);
    const name = c.req.param("name");

    try {
      const existing = await getPublicationByName(c.env, spaceId, name);
      if (!existing) {
        throw new NotFoundError("Publication");
      }
      await deletePublicationByName(c.env, {
        spaceId,
        name,
      });
      return c.json({ success: true });
    } catch (err) {
      if (err instanceof NotFoundError) throw err;
      logError("Failed to delete publication", err, {
        module: "routes/publications",
      });
      if (err instanceof Error) {
        throw new BadRequestError(err.message);
      }
      throw new InternalError("Failed to delete publication");
    }
  });

export default app;
