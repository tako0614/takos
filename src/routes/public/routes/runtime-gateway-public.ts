import type { Hono } from "hono";
import { TAKOSUMI_RUNTIME_INTERNAL_PATHS } from "takosumi-contract-v2/internal/api";
import type { ApiBindings } from "../shared/api/bindings.ts";
import { commonError, isRecord, readJsonBody } from "../shared/api/common.ts";
import {
  forwardRuntimeGatewayRequest,
  forwardRuntimeInternalRequest,
  normalizedRuntimeSearch,
  runtimeSpaceIdFromRequest,
} from "../shared/api/forwarding.ts";
import { requireSpaceMembership } from "../shared/spaces/access.ts";

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
      return response;
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
      return response;
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
      return response;
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
    return response;
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
    return response;
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
    return response;
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
    return response;
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
    return response;
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
      return response;
    });
  }
}
