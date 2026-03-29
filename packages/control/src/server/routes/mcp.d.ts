/**
 * MCP Routes
 *
 * GET  /api/mcp/oauth/callback  - OAuth callback (no auth required, protected by state param)
 * GET  /api/mcp/servers         - List registered MCP servers (auth required)
 * DELETE /api/mcp/servers/:id   - Remove a registered MCP server (auth required)
 * PATCH  /api/mcp/servers/:id   - Update a registered MCP server (auth required)
 */
import { Hono } from 'hono';
import { type SpaceAccessRouteEnv } from './route-auth';
declare const mcpRoutes: Hono<SpaceAccessRouteEnv, import("hono/types").BlankSchema, "/">;
export default mcpRoutes;
//# sourceMappingURL=mcp.d.ts.map