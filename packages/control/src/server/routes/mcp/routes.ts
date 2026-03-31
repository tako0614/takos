/**
 * MCP Routes
 *
 * GET  /api/mcp/oauth/callback  - OAuth callback (no auth required, protected by state param)
 * GET  /api/mcp/servers         - List registered MCP servers (auth required)
 * DELETE /api/mcp/servers/:id   - Remove a registered MCP server (auth required)
 * PATCH  /api/mcp/servers/:id   - Update a registered MCP server (auth required)
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../../shared/types/index.ts';
import {
  consumeMcpOAuthPending, completeMcpOAuthFlow, registerExternalMcpServer,
  listMcpServers, deleteMcpServer, updateMcpServer, getMcpServerWithTokens,
  decryptAccessToken, refreshMcpToken,
} from '../../../application/services/platform/mcp.ts';
import { McpClient } from '../../../application/tools/mcp-client.ts';
import { spaceAccess, type SpaceAccessRouteEnv } from '../route-auth.ts';
import { zValidator } from '../zod-validator.ts';
import { escapeHtml } from '../auth/html.ts';
import { logError, logWarn } from '../../../shared/utils/logger.ts';
import { BadRequestError, NotFoundError, BadGatewayError, GatewayTimeoutError } from 'takos-common/errors';
import { getSpaceOperationPolicy } from '../../../application/tools/tool-policy.ts';
import { ok } from '../response-utils.ts';

const createServerSchema = z.object({ name: z.string(), url: z.string(), scope: z.string().optional() });
const updateServerSchema = z.object({ enabled: z.boolean().optional(), name: z.string().optional() });

const mcpRoutes = new Hono<SpaceAccessRouteEnv>();

const MCP_LIST_ROLES = getSpaceOperationPolicy('mcp_server.list').allowed_roles;
const MCP_CREATE_ROLES = getSpaceOperationPolicy('mcp_server.create').allowed_roles;
const MCP_UPDATE_ROLES = getSpaceOperationPolicy('mcp_server.update').allowed_roles;
const MCP_DELETE_ROLES = getSpaceOperationPolicy('mcp_server.delete').allowed_roles;

function serializeMcpServer(server: Awaited<ReturnType<typeof listMcpServers>>[number]) {
  const sourceType = server.sourceType === 'worker' ? 'service' : server.sourceType;
  return {
    id: server.id, name: server.name, url: server.url, transport: server.transport,
    enabled: server.enabled, source_type: sourceType, auth_mode: server.authMode,
    service_id: server.serviceId, bundle_deployment_id: server.bundleDeploymentId,
    managed: server.sourceType !== 'external', scope: server.oauthScope,
    issuer_url: server.oauthIssuerUrl, token_expires_at: server.oauthTokenExpiresAt,
    created_at: server.createdAt, updated_at: server.updatedAt,
  };
}

mcpRoutes.get('/oauth/callback', async (c) => {
  const code = c.req.query('code'); const state = c.req.query('state'); const error = c.req.query('error');
  if (error) return c.html(errorPage(`OAuth authorization failed: ${error}`), 400);
  if (!code || !state) return c.html(errorPage('Missing code or state parameter'), 400);
  let pending: Awaited<ReturnType<typeof consumeMcpOAuthPending>>;
  try { pending = await consumeMcpOAuthPending(c.env.DB, c.env, state); }
  catch (err) { logError('consumeMcpOAuthPending error', err, { module: 'mcp-oauth' }); return c.html(errorPage('Internal error processing OAuth callback'), 500); }
  if (!pending) return c.html(errorPage('Invalid or expired OAuth state. Please try again.'), 400);
  const baseHostname = c.env.ADMIN_DOMAIN || c.env.TENANT_BASE_DOMAIN || 'localhost';
  const redirectUri = `https://${baseHostname}/api/mcp/oauth/callback`;
  try {
    await completeMcpOAuthFlow(c.env.DB, c.env, { spaceId: pending.spaceId, serverName: pending.serverName, serverUrl: pending.serverUrl, tokenEndpoint: pending.tokenEndpoint, code, codeVerifier: pending.codeVerifier, redirectUri, scope: pending.scope, issuerUrl: pending.issuerUrl ?? pending.serverUrl });
  } catch (err) { logError('completeMcpOAuthFlow error', err, { module: 'mcp-oauth' }); return c.html(errorPage('Failed to complete OAuth authorization. Please try again.'), 500); }
  return c.html(successPage(pending.serverName));
});

mcpRoutes.post('/servers', spaceAccess({ roles: MCP_CREATE_ROLES }), zValidator('json', createServerSchema), async (c) => {
  const spaceId = c.get('spaceId'); const body = c.req.valid('json');
  if (!body.name || !body.url) throw new BadRequestError('name and url are required');
  const result = await registerExternalMcpServer(c.env.DB, c.env, { spaceId, name: body.name, url: body.url, scope: body.scope });
  return c.json({ data: { status: result.status, name: result.name, url: result.url, auth_url: result.authUrl, message: result.message } });
});

mcpRoutes.get('/servers', spaceAccess({ roles: MCP_LIST_ROLES }), async (c) => {
  const servers = await listMcpServers(c.env.DB, c.get('spaceId'));
  return c.json({ data: servers.map(serializeMcpServer) });
});

mcpRoutes.delete('/servers/:id', spaceAccess({ roles: MCP_DELETE_ROLES }), async (c) => {
  const deleted = await deleteMcpServer(c.env.DB, c.get('spaceId'), c.req.param('id'));
  if (!deleted) throw new NotFoundError('MCP server');
  return ok(c);
});

mcpRoutes.patch('/servers/:id', spaceAccess({ roles: MCP_UPDATE_ROLES }), zValidator('json', updateServerSchema), async (c) => {
  const body = c.req.valid('json');
  const updated = await updateMcpServer(c.env.DB, c.get('spaceId'), c.req.param('id'), body);
  if (!updated) throw new NotFoundError('MCP server');
  return c.json({ data: serializeMcpServer(updated) });
});

mcpRoutes.get('/servers/:id/tools', spaceAccess({ roles: MCP_LIST_ROLES }), async (c) => {
  const spaceId = c.get('spaceId'); const serverId = c.req.param('id');
  const server = await getMcpServerWithTokens(c.env.DB, spaceId, serverId);
  if (!server) throw new NotFoundError('MCP server');
  let accessToken: string | null = null;
  if (server.sourceType === 'external') {
    accessToken = await decryptAccessToken(c.env.DB, c.env, { id: server.id, oauthAccessToken: server.oauthAccessToken });
    if (server.oauthTokenExpiresAt && new Date(server.oauthTokenExpiresAt) < new Date()) {
      await refreshMcpToken(c.env.DB, c.env, { id: server.id, oauthRefreshToken: server.oauthRefreshToken, oauthIssuerUrl: server.oauthIssuerUrl });
      const refreshed = await getMcpServerWithTokens(c.env.DB, spaceId, serverId);
      if (refreshed) accessToken = await decryptAccessToken(c.env.DB, c.env, { id: refreshed.id, oauthAccessToken: refreshed.oauthAccessToken });
    }
  }
  const client = new McpClient(server.url, accessToken, server.name);
  try {
    await client.connect(); const tools = await client.listTools();
    return c.json({ data: { tools: tools.map((t) => ({ name: t.sdkTool.name, description: t.sdkTool.description ?? '', inputSchema: t.sdkTool.inputSchema })) } });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logError('MCP tool listing failed', err, { module: 'mcp', serverId });
    if (detail.includes('timeout') || detail.includes('Timeout')) throw new GatewayTimeoutError('MCP server connection timed out');
    throw new BadGatewayError('Failed to connect to MCP server');
  } finally { await client.close().catch((e) => { logWarn('MCP client close failed (non-critical)', { module: 'mcp', error: e instanceof Error ? e.message : String(e) }); }); }
});

function successPage(serverName: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>MCP Server Connected</title><style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f0fdf4}.card{background:white;border-radius:12px;padding:2rem 3rem;box-shadow:0 4px 24px rgba(0,0,0,.08);text-align:center;max-width:400px}h1{color:#16a34a;margin-bottom:.5rem}p{color:#4b5563}</style></head><body><div class="card"><h1>✓ Connected</h1><p>MCP server <strong>${escapeHtml(serverName)}</strong> has been successfully authorized.</p><p>You can close this window and continue in the agent.</p></div></body></html>`;
}
function errorPage(message: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>MCP Authorization Error</title><style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#fef2f2}.card{background:white;border-radius:12px;padding:2rem 3rem;box-shadow:0 4px 24px rgba(0,0,0,.08);text-align:center;max-width:400px}h1{color:#dc2626;margin-bottom:.5rem}p{color:#4b5563}</style></head><body><div class="card"><h1>Authorization Failed</h1><p>${escapeHtml(message)}</p><p>Please close this window and try again.</p></div></body></html>`;
}

export default mcpRoutes;
