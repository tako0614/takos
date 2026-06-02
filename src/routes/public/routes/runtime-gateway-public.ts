import type { Context, Hono } from "hono";
import type { TakosumiActorContext } from "takosumi-contract-v2/internal/rpc";
import { TAKOSUMI_RUNTIME_INTERNAL_PATHS } from "takosumi-contract-v2/internal/api";
import { actorFromAuthenticatedRequest } from "../shared/api/auth.ts";
import type { ApiBindings } from "../shared/api/bindings.ts";
import { commonError, isRecord, readJsonBody } from "../shared/api/common.ts";
import {
  forwardRuntimeGatewayRequest,
  forwardRuntimeInternalRequest,
  normalizedRuntimeSearch,
  runtimeSpaceIdFromRequest,
} from "../shared/api/forwarding.ts";
import { readSpaceMembershipRole } from "../shared/spaces/access.ts";

/**
 * Authenticate the caller and verify they have at least viewer-level
 * membership in the target space. Used by `/api/spaces/:spaceId/*` runtime
 * gateway routes and by the non-spaced `/api/services|resources|sessions`
 * routes — without this gate any authenticated account could read or mutate
 * runtime state in spaces they don't belong to.
 */
async function requireSpaceMembership(
  c: Context<{ Bindings: ApiBindings }>,
  spaceId: string,
): Promise<
  | { ok: true; actor: TakosumiActorContext }
  | { ok: false; response: Response }
> {
  const actorResult = await actorFromAuthenticatedRequest(
    c.req.raw,
    crypto.randomUUID(),
    spaceId,
    { env: c.env },
  );
  if (!actorResult.ok) return { ok: false, response: actorResult.response };

  const db = c.env?.DB;
  if (!db) {
    return {
      ok: false,
      response: c.json(
        commonError("INTERNAL_ERROR", "database is not configured"),
        500,
      ),
    };
  }
  const role = await readSpaceMembershipRole(
    db,
    spaceId,
    actorResult.actor.actorAccountId,
  );
  if (!role) {
    return {
      ok: false,
      response: c.json(commonError("FORBIDDEN", "forbidden"), 403),
    };
  }
  return { ok: true, actor: actorResult.actor };
}

export function registerRuntimeGatewayPublicRoutes(
  app: Hono<{ Bindings: ApiBindings }>,
): void {
  for (
    const route of [
      {
        family: "services",
        publicPath: "/api/services",
        internalPath: TAKOSUMI_RUNTIME_INTERNAL_PATHS.services,
      },
      {
        family: "resources",
        publicPath: "/api/resources",
        internalPath: TAKOSUMI_RUNTIME_INTERNAL_PATHS.resources,
      },
      {
        family: "sessions",
        publicPath: "/api/sessions",
        internalPath: TAKOSUMI_RUNTIME_INTERNAL_PATHS.sessions,
      },
    ]
  ) {
    app.get(route.publicPath, async (c) => {
      // Non-spaced /api/services|resources|sessions routes used to accept a
      // spaceId from the query string with no membership check, which let
      // authenticated callers enumerate runtime objects across tenants. Now
      // require a spaceId AND verify membership before forwarding.
      const spaceId = runtimeSpaceIdFromRequest(c.req.raw)?.trim() || "";
      if (!spaceId) {
        return c.json(
          commonError("INVALID_ARGUMENT", "spaceId is required"),
          400,
        );
      }
      const auth = await requireSpaceMembership(c, spaceId);
      if (!auth.ok) return auth.response;
      const response = await forwardRuntimeInternalRequest({
        request: c.req.raw,
        method: "GET",
        path: route.internalPath,
        search: normalizedRuntimeSearch(c.req.raw, spaceId),
        body: "",
        actor: auth.actor,
        actorSpaceId: spaceId,
      });
      if (response instanceof Response) return response;
      return c.json(response, 500);
    });
    app.post(route.publicPath, async (c) => {
      const body = await readJsonBody(c.req);
      if (!isRecord(body)) {
        return c.json(
          commonError("INVALID_ARGUMENT", "request body must be a JSON object"),
          400,
        );
      }
      const spaceId =
        (typeof body.spaceId === "string" ? body.spaceId : "").trim() || "";
      if (!spaceId) {
        return c.json(
          commonError("INVALID_ARGUMENT", "spaceId is required"),
          400,
        );
      }
      const auth = await requireSpaceMembership(c, spaceId);
      if (!auth.ok) return auth.response;
      const actor = auth.actor;
      const response = await forwardRuntimeInternalRequest({
        request: c.req.raw,
        method: "POST",
        path: route.internalPath,
        body: JSON.stringify({
          actor,
          spaceId,
          payload: isRecord(body.payload) ? body.payload : undefined,
        }),
        actor,
      });
      if (response instanceof Response) return response;
      return c.json(response, 500);
    });
    app.all(`${route.publicPath}/*`, async (c) => {
      const spaceId = runtimeSpaceIdFromRequest(c.req.raw)?.trim() || "";
      if (!spaceId) {
        return c.json(
          commonError("INVALID_ARGUMENT", "spaceId is required"),
          400,
        );
      }
      const auth = await requireSpaceMembership(c, spaceId);
      if (!auth.ok) return auth.response;
      const response = await forwardRuntimeGatewayRequest(
        c,
        route.publicPath,
        route.internalPath,
        spaceId,
        auth.actor,
      );
      if (response instanceof Response) return response;
      return c.json(response, 500);
    });
  }

  app.get("/api/spaces/:spaceId/services", async (c) => {
    const spaceId = c.req.param("spaceId");
    const auth = await requireSpaceMembership(c, spaceId);
    if (!auth.ok) return auth.response;
    const response = await forwardRuntimeInternalRequest({
      request: c.req.raw,
      method: "GET",
      path: TAKOSUMI_RUNTIME_INTERNAL_PATHS.services,
      search: normalizedRuntimeSearch(c.req.raw, spaceId),
      body: "",
      actor: auth.actor,
      actorSpaceId: spaceId,
    });
    if (response instanceof Response) return response;
    return c.json(response, 500);
  });

  app.get("/api/spaces/:spaceId/sessions", async (c) => {
    const spaceId = c.req.param("spaceId");
    const auth = await requireSpaceMembership(c, spaceId);
    if (!auth.ok) return auth.response;
    const response = await forwardRuntimeInternalRequest({
      request: c.req.raw,
      method: "GET",
      path: TAKOSUMI_RUNTIME_INTERNAL_PATHS.sessions,
      search: normalizedRuntimeSearch(c.req.raw, spaceId),
      body: "",
      actor: auth.actor,
      actorSpaceId: spaceId,
    });
    if (response instanceof Response) return response;
    return c.json(response, 500);
  });

  app.get("/api/spaces/:spaceId/resources", async (c) => {
    const spaceId = c.req.param("spaceId");
    const auth = await requireSpaceMembership(c, spaceId);
    if (!auth.ok) return auth.response;
    const response = await forwardRuntimeInternalRequest({
      request: c.req.raw,
      method: "GET",
      path: TAKOSUMI_RUNTIME_INTERNAL_PATHS.resources,
      search: normalizedRuntimeSearch(c.req.raw, spaceId),
      body: "",
      actor: auth.actor,
      actorSpaceId: spaceId,
    });
    if (response instanceof Response) return response;
    return c.json(response, 500);
  });

  app.post("/api/spaces/:spaceId/resources", async (c) => {
    const spaceId = c.req.param("spaceId");
    const body = await readJsonBody(c.req);
    if (!isRecord(body)) {
      return c.json(
        commonError("INVALID_ARGUMENT", "request body must be a JSON object"),
        400,
      );
    }
    const auth = await requireSpaceMembership(c, spaceId);
    if (!auth.ok) return auth.response;
    const actor = auth.actor;
    const response = await forwardRuntimeInternalRequest({
      request: c.req.raw,
      method: "POST",
      path: TAKOSUMI_RUNTIME_INTERNAL_PATHS.resources,
      body: JSON.stringify({
        actor,
        spaceId,
        payload: isRecord(body.payload) ? body.payload : undefined,
      }),
      actor,
    });
    if (response instanceof Response) return response;
    return c.json(response, 500);
  });

  app.post("/api/spaces/:spaceId/sessions", async (c) => {
    const spaceId = c.req.param("spaceId");
    const body = await readJsonBody(c.req);
    if (!isRecord(body)) {
      return c.json(
        commonError("INVALID_ARGUMENT", "request body must be a JSON object"),
        400,
      );
    }
    const auth = await requireSpaceMembership(c, spaceId);
    if (!auth.ok) return auth.response;
    const actor = auth.actor;
    const response = await forwardRuntimeInternalRequest({
      request: c.req.raw,
      method: "POST",
      path: TAKOSUMI_RUNTIME_INTERNAL_PATHS.sessions,
      body: JSON.stringify({
        actor,
        spaceId,
        payload: isRecord(body.payload) ? body.payload : undefined,
      }),
      actor,
    });
    if (response instanceof Response) return response;
    return c.json(response, 500);
  });

  for (
    const route of [
      {
        family: "services",
        internalPath: TAKOSUMI_RUNTIME_INTERNAL_PATHS.services,
      },
      {
        family: "resources",
        internalPath: TAKOSUMI_RUNTIME_INTERNAL_PATHS.resources,
      },
      {
        family: "sessions",
        internalPath: TAKOSUMI_RUNTIME_INTERNAL_PATHS.sessions,
      },
    ]
  ) {
    app.all(`/api/spaces/:spaceId/${route.family}/*`, async (c) => {
      const spaceId = c.req.param("spaceId");
      const auth = await requireSpaceMembership(c, spaceId);
      if (!auth.ok) return auth.response;
      const response = await forwardRuntimeGatewayRequest(
        c,
        `/api/spaces/${spaceId}/${route.family}`,
        route.internalPath,
        spaceId,
        auth.actor,
      );
      if (response instanceof Response) return response;
      return c.json(response, 500);
    });
  }
}
