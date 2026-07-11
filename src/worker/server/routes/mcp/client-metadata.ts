import { Hono } from "hono";
import { getMcpClientMetadataDocument } from "../../../application/services/platform/mcp/authorization.ts";
import type { SpaceAccessRouteEnv } from "../route-auth.ts";

/**
 * Public deployment-specific Client ID Metadata Document (MCP SEP-991).
 * Mounted by `mcp/index.ts` at GET /api/mcp/client.json.
 */
const clientMetadataRoutes = new Hono<SpaceAccessRouteEnv>();

clientMetadataRoutes.get("/client.json", (c) => {
  const document = getMcpClientMetadataDocument(c.env);
  return c.json(document, 200, {
    "Cache-Control": "public, max-age=300",
  });
});

export default clientMetadataRoutes;
