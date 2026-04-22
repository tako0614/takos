import { Hono } from "hono";
import { z } from "zod";

import {
  BadRequestError,
  InternalError,
  NotFoundError,
} from "takos-common/errors";

import {
  type AppContext,
  type AuthenticatedRouteEnv,
  requireSpaceAccess,
} from "../route-auth.ts";
import {
  hasPublicInternalField,
  stripPublicInternalFields,
} from "../response-utils.ts";
import { zValidator } from "../zod-validator.ts";
import {
  deletePublicationByName,
  getPublicationByName,
  listPublicationKinds,
  listPublications,
  type PublicationRecord,
  resolvePublicationRef,
  upsertApiPublication,
} from "../../../application/services/platform/service-publications.ts";
import type { AppPublication } from "../../../application/services/source/app-manifest-types.ts";
import { logError } from "../../../shared/utils/logger.ts";

async function resolveSpaceId(
  c: AppContext,
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
  const publication = stripPublicInternalFields(record.publication);
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
    publisher: publication.publisher,
    type: publication.type,
    publication,
    outputs: record.outputs,
    resolved,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

const publicationBodySchema = z.object({
  name: z.string().optional(),
  publisher: z.literal("takos"),
  type: z.enum(["api-key", "oauth-client"]),
  spec: z.record(z.unknown()).optional(),
}).strict().refine((body) => !hasPublicInternalField(body), {
  message: "publication must not contain internal fields",
});

const TAKOS_API_KEY_SPEC_FIELDS = new Set([
  "scopes",
]);

const TAKOS_OAUTH_SPEC_FIELDS = new Set([
  "clientName",
  "redirectUris",
  "scopes",
  "metadata",
]);

const TAKOS_OAUTH_METADATA_FIELDS = new Set([
  "logoUri",
  "tosUri",
  "policyUri",
]);

function assertAllowedSpecFields(
  spec: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  field: string,
): void {
  for (const key of Object.keys(spec)) {
    if (allowed.has(key)) continue;
    throw new Error(
      `${field}.${key} is not supported for Takos publication specs`,
    );
  }
}

export function assertTakosGrantSpecShape(
  publication: Pick<AppPublication, "name" | "publisher" | "type" | "spec">,
): void {
  if (publication.publisher !== "takos" || publication.spec == null) return;
  const spec = publication.spec;
  if (typeof spec !== "object" || Array.isArray(spec)) {
    throw new Error(`publication '${publication.name}'.spec must be an object`);
  }
  if (publication.type === "api-key") {
    assertAllowedSpecFields(spec, TAKOS_API_KEY_SPEC_FIELDS, "spec");
    return;
  }
  if (publication.type !== "oauth-client") return;
  assertAllowedSpecFields(spec, TAKOS_OAUTH_SPEC_FIELDS, "spec");
  const metadata = spec.metadata;
  if (
    metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata)
  ) {
    assertAllowedSpecFields(
      metadata as Record<string, unknown>,
      TAKOS_OAUTH_METADATA_FIELDS,
      "spec.metadata",
    );
  }
}

export function assertGrantPublicationDeleteAllowed(
  record: PublicationRecord,
): void {
  if (record.publication.publisher === "takos") return;
  throw new BadRequestError(
    "Route publications cannot be deleted through DELETE /api/publications/:name. Manage route publications by deploying a manifest with publish[].",
  );
}

const app = new Hono<AuthenticatedRouteEnv>()
  .get("/kinds", async (c) => {
    const user = c.get("user");
    await resolveSpaceId(c, user.id);
    return c.json({
      kinds: listPublicationKinds(),
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
  .get("/resolve", async (c) => {
    const user = c.get("user");
    const spaceId = await resolveSpaceId(c, user.id);
    const ref = c.req.query("ref")?.trim();
    const consumerGroupId = c.req.query("consumerGroupId")?.trim() || null;
    if (!ref) {
      throw new BadRequestError("query parameter 'ref' is required");
    }

    try {
      const publication = await resolvePublicationRef(c.env, {
        spaceId,
        ref,
        consumerGroupId,
      });
      if (!publication) {
        throw new NotFoundError("Publication");
      }
      return c.json({ publication: toPublicPublication(publication) });
    } catch (err) {
      if (err instanceof NotFoundError || err instanceof BadRequestError) {
        throw err;
      }
      logError("Failed to resolve publication", err, {
        module: "routes/publications",
      });
      throw new InternalError("Failed to resolve publication");
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
      if (err instanceof NotFoundError || err instanceof BadRequestError) {
        throw err;
      }
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
        assertTakosGrantSpecShape({
          ...body,
          name,
        });
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
      assertGrantPublicationDeleteAllowed(existing);
      await deletePublicationByName(c.env, {
        spaceId,
        name,
      });
      return c.json({ success: true });
    } catch (err) {
      if (err instanceof NotFoundError || err instanceof BadRequestError) {
        throw err;
      }
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
