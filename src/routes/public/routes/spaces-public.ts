import type { Hono } from "hono";
import {
  type InternalSpaceRequest,
  TAKOSUMI_INTERNAL_PATHS,
} from "takosumi-contract-v2/internal/api";
import { actorFromAuthenticatedRequest, requireDbAndActor } from "../shared/api/auth.ts";
import type { ApiBindings } from "../shared/api/bindings.ts";
import {
  commonError,
  isJsonObject,
  isRecord,
  parsePositiveLimit,
  parsePositiveOffset,
  readJsonBody,
  resolveRequestId,
} from "../shared/api/common.ts";
import { forwardTakosumiInternalRequest } from "../shared/api/forwarding.ts";
import { parseCreateThreadInput } from "../shared/api/input-parsers.ts";
import { readSpaceMembershipRole } from "../shared/spaces/access.ts";
import { createSpaceThread } from "../shared/threads/mutations.ts";
import { listSpaceThreads } from "../shared/threads/read-model.ts";
import { searchSpaceThreads } from "../shared/threads/search.ts";
import { getCustomTool, listCustomTools } from "../shared/tools/catalog.ts";

export function registerSpacesPublicRoutes(
  app: Hono<{ Bindings: ApiBindings }>,
): void {
  app.get("/api/spaces/:spaceId/tools", async (c) => {
    const spaceId = c.req.param("spaceId");
    const resolved = await requireDbAndActor(c, spaceId);
    if (!resolved.ok) return resolved.response;
    const { db, actor } = resolved;

    const role = await readSpaceMembershipRole(
      db,
      spaceId,
      actor.actorAccountId,
    );
    if (!role) {
      return c.json(commonError("NOT_FOUND", "Space not found"), {
        status: 404,
      });
    }

    return c.json({ data: listCustomTools() });
  });

  app.get("/api/spaces/:spaceId/tools/:toolName", async (c) => {
    const spaceId = c.req.param("spaceId");
    const resolved = await requireDbAndActor(c, spaceId);
    if (!resolved.ok) return resolved.response;
    const { db, actor } = resolved;

    const role = await readSpaceMembershipRole(
      db,
      spaceId,
      actor.actorAccountId,
    );
    if (!role) {
      return c.json(commonError("NOT_FOUND", "Space not found"), {
        status: 404,
      });
    }

    const tool = getCustomTool(c.req.param("toolName"));
    if (!tool) {
      return c.json(commonError("NOT_FOUND", "Custom tool not found"), {
        status: 404,
      });
    }

    return c.json({ data: tool });
  });

  app.get("/api/spaces/:spaceId/threads", async (c) => {
    const spaceId = c.req.param("spaceId");
    const resolved = await requireDbAndActor(c, spaceId);
    if (!resolved.ok) return resolved.response;
    const { db, actor } = resolved;

    const threads = await listSpaceThreads(
      db,
      spaceId,
      actor.actorAccountId,
      { status: c.req.query("status") ?? undefined },
    );
    if (!threads) {
      return c.json(commonError("NOT_FOUND", "Space not found"), {
        status: 404,
      });
    }

    return c.json({ threads });
  });

  app.get("/api/spaces/:spaceId/threads/search", async (c) => {
    const db = c.env?.DB;
    if (!db) {
      return c.json(
        commonError("INTERNAL_ERROR", "database is not configured"),
        { status: 500 },
      );
    }
    const q = c.req.query("q")?.trim() || "";
    if (!q) {
      return c.json(commonError("INVALID_ARGUMENT", "q is required"), {
        status: 400,
      });
    }
    const spaceId = c.req.param("spaceId");
    const actorResult = await actorFromAuthenticatedRequest(
      c.req.raw,
      resolveRequestId(c.req),
      spaceId,
      { env: c.env },
    );
    if (!actorResult.ok) return actorResult.response;

    const result = await searchSpaceThreads(
      {
        DB: db,
        AI: c.env?.AI,
        VECTORIZE: c.env?.VECTORIZE,
      },
      spaceId,
      actorResult.actor.actorAccountId,
      {
        query: q,
        type: c.req.query("type")?.toLowerCase() || "all",
        limit: parsePositiveLimit(c.req.query("limit"), 20, 100),
        offset: parsePositiveOffset(c.req.query("offset")),
      },
    );
    if (!result) {
      return c.json(commonError("NOT_FOUND", "Space not found"), {
        status: 404,
      });
    }

    return c.json(result);
  });

  app.post("/api/spaces/:spaceId/threads", async (c) => {
    const db = c.env?.DB;
    if (!db) {
      return c.json(
        commonError("INTERNAL_ERROR", "database is not configured"),
        { status: 500 },
      );
    }
    const body = await readJsonBody(c.req);
    const input = parseCreateThreadInput(body);
    if (!input.ok) {
      return c.json(commonError("INVALID_ARGUMENT", input.message), {
        status: 400,
      });
    }
    const spaceId = c.req.param("spaceId");
    const actorResult = await actorFromAuthenticatedRequest(
      c.req.raw,
      resolveRequestId(c.req),
      spaceId,
      { env: c.env },
    );
    if (!actorResult.ok) return actorResult.response;

    const thread = await createSpaceThread(
      db,
      spaceId,
      actorResult.actor.actorAccountId,
      input.value,
    );
    if (!thread) {
      return c.json(
        commonError("NOT_FOUND", "Space not found or insufficient permissions"),
        { status: 404 },
      );
    }

    return c.json({ thread }, 201);
  });

  app.get("/api/spaces", async (c) => {
    // Defense in depth: the downstream takosumi-contract internal endpoint
    // already filters by membership using the signed actor context, but we
    // also resolve the actor here so an unauthenticated caller never reaches
    // the upstream and so the signed `actorAccountId` is forwarded verbatim
    // — preventing trusted-header callers from omitting the actor and
    // receiving a cross-tenant list.
    const actorResult = await actorFromAuthenticatedRequest(
      c.req.raw,
      resolveRequestId(c.req),
      { env: c.env },
    );
    if (!actorResult.ok) return actorResult.response;
    const response = await forwardTakosumiInternalRequest({
      request: c.req.raw,
      method: "GET",
      path: TAKOSUMI_INTERNAL_PATHS.spaces,
      body: "",
      actor: actorResult.actor,
    });
    return response;
  });

  app.post("/api/spaces", async (c) => {
    const body = await readJsonBody(c.req);
    if (!isRecord(body)) {
      return c.json(
        commonError("INVALID_ARGUMENT", "request body must be a JSON object"),
        400,
      );
    }
    const name = typeof body.name === "string" ? body.name : undefined;
    const actorResult = await actorFromAuthenticatedRequest(
      c.req.raw,
      resolveRequestId(c.req),
      { env: c.env },
    );
    if (!actorResult.ok) return actorResult.response;
    const actor = actorResult.actor;
    const payload: InternalSpaceRequest = {
      actor,
      name,
      metadata: isJsonObject(body.metadata) ? body.metadata : undefined,
    };
    const response = await forwardTakosumiInternalRequest({
      request: c.req.raw,
      method: "POST",
      path: TAKOSUMI_INTERNAL_PATHS.spaces,
      body: JSON.stringify(payload),
      actor,
    });
    return response;
  });
}
