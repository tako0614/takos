import { Hono } from "hono";
import {
  exportMcpConnections,
  importMcpConnections,
} from "../../../application/services/platform/mcp/portable-connections.ts";
import { getSpaceOperationPolicy } from "../../../application/tools/tool-policy.ts";
import { spaceAccess, type SpaceAccessRouteEnv } from "../route-auth.ts";
import { BadRequestError } from "@takos/worker-platform-utils/errors";

const roles = getSpaceOperationPolicy("mcp_server.update").allowed_roles;
const routes = new Hono<SpaceAccessRouteEnv>();

routes.get("/connections/export", spaceAccess({ roles }), async (c) => {
  const document = await exportMcpConnections(c.env.DB, c.get("spaceId"));
  c.header(
    "Content-Disposition",
    'attachment; filename="takos-connections.json"',
  );
  c.header("Cache-Control", "no-store");
  return c.json({ data: document });
});

routes.post("/connections/import", spaceAccess({ roles }), async (c) => {
  let document: unknown;
  try {
    document = await c.req.json();
  } catch {
    throw new BadRequestError("Connections import must be valid JSON");
  }
  const result = await importMcpConnections(c.env.DB, c.env, {
    accountId: c.get("spaceId"),
    userId: c.get("user").id,
    document,
  });
  return c.json({
    data: {
      registry_sources: result.registrySources.map((source) => ({
        base_url: source.baseUrl,
        status: source.status,
        message: source.message,
      })),
      connections: result.connections.map((connection) => ({
        name: connection.name,
        url: connection.url,
        status: connection.status,
        authorization_url: connection.authorizationUrl,
        tool_policies_require_review: connection.toolPoliciesRequireReview,
        message: connection.message,
      })),
    },
  });
});

export default routes;
