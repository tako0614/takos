/**
 * MCP Routes
 *
 * GET  /api/mcp/oauth/callback  - OAuth callback (no auth required, protected by state param)
 * GET  /api/mcp/servers         - List registered MCP servers (auth required)
 * DELETE /api/mcp/servers/:id   - Remove a registered MCP server (auth required)
 * PATCH  /api/mcp/servers/:id   - Update a registered MCP server (auth required)
 */

import { Hono } from "hono";
import { z } from "zod";
import {
  assertAllowedMcpEndpointUrl,
  completeMcpOAuthFlow,
  consumeMcpOAuthPending,
  deleteMcpServer,
  getMcpEndpointUrlOptions,
  getMcpOAuthPendingForStart,
  listMcpServers,
  McpOAuthBrowserBindingError,
  McpOAuthPendingUpgradeRequiredError,
  reauthorizeExternalMcpServer,
  registerExternalMcpServer,
  updateMcpServer,
} from "../../../application/services/platform/mcp.ts";
import { spaceAccess, type SpaceAccessRouteEnv } from "../route-auth.ts";
import { zValidator } from "../zod-validator.ts";
import { escapeHtml } from "../auth/html.ts";
import { logError } from "../../../shared/utils/logger.ts";
import {
  BadRequestError,
  NotFoundError,
} from "@takos/worker-platform-utils/errors";
import { getSpaceOperationPolicy } from "../../../application/tools/tool-policy.ts";
import { ok } from "../response-utils.ts";
import registrySourceRoutes from "./registry-sources.ts";
import mcpToolPolicyRoutes from "./tool-policies.ts";
import mcpToolConfirmationRoutes from "./tool-confirmations.ts";
import mcpServerCardRoutes from "./server-cards.ts";
import portableConnectionRoutes from "./portable-connections.ts";

const createServerSchema = z.object({
  name: z.string(),
  url: z.string(),
  scope: z.string().optional(),
});
const updateServerSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().optional(),
});

const mcpRoutes = new Hono<SpaceAccessRouteEnv>();
const MCP_OAUTH_STATE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const MCP_OAUTH_BROWSER_NONCE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const MCP_OAUTH_COOKIE_PATH = "/api/mcp/oauth";
const MCP_OAUTH_PENDING_TTL_SECONDS = 10 * 60;

const MCP_LIST_ROLES = getSpaceOperationPolicy("mcp_server.list").allowed_roles;
const MCP_CREATE_ROLES =
  getSpaceOperationPolicy("mcp_server.create").allowed_roles;
const MCP_UPDATE_ROLES =
  getSpaceOperationPolicy("mcp_server.update").allowed_roles;
const MCP_DELETE_ROLES =
  getSpaceOperationPolicy("mcp_server.delete").allowed_roles;

mcpRoutes.route("/", registrySourceRoutes);
mcpRoutes.route("/", mcpToolPolicyRoutes);
mcpRoutes.route("/", mcpToolConfirmationRoutes);
mcpRoutes.route("/", mcpServerCardRoutes);
mcpRoutes.route("/", portableConnectionRoutes);

function serializeMcpServer(
  server: Awaited<ReturnType<typeof listMcpServers>>[number],
) {
  const sourceType =
    server.sourceType === "worker" ? "service" : server.sourceType;
  return {
    id: server.id,
    name: server.name,
    url: server.url,
    transport: server.transport,
    enabled: server.enabled,
    source_type: sourceType,
    auth_mode: server.authMode,
    service_id: server.serviceId,
    bundle_deployment_id: server.bundleDeploymentId,
    managed: server.sourceType !== "external",
    scope: server.oauthScope,
    issuer_url: server.oauthIssuerUrl,
    registration_mode: server.oauthRegistrationMode,
    authorization_status: server.authorizationStatus,
    token_expires_at: server.oauthTokenExpiresAt,
    created_at: server.createdAt,
    updated_at: server.updatedAt,
  };
}

function mcpOAuthBrowserCookieName(state: string): string {
  return `__Secure-takos_mcp_oauth_${state}`;
}

function readCookie(
  cookieHeader: string | undefined,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const cookie = part.trim();
    const separator = cookie.indexOf("=");
    if (separator <= 0 || cookie.slice(0, separator) !== name) continue;
    return cookie.slice(separator + 1);
  }
  return null;
}

function setMcpOAuthBrowserCookie(
  state: string,
  nonce: string,
  maxAgeSeconds: number,
): string {
  return `${mcpOAuthBrowserCookieName(state)}=${nonce}; Path=${MCP_OAUTH_COOKIE_PATH}; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function clearMcpOAuthBrowserCookie(state: string): string {
  return `${mcpOAuthBrowserCookieName(state)}=; Path=${MCP_OAUTH_COOKIE_PATH}; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
}

mcpRoutes.get("/oauth/start", async (c) => {
  const state = c.req.query("state") ?? "";
  if (!MCP_OAUTH_STATE_PATTERN.test(state)) {
    return c.html(errorPage("Invalid OAuth state"), 400);
  }
  let pending: Awaited<ReturnType<typeof getMcpOAuthPendingForStart>>;
  try {
    pending = await getMcpOAuthPendingForStart(c.env.DB, c.env, state);
  } catch (error) {
    if (error instanceof McpOAuthPendingUpgradeRequiredError) {
      return c.html(errorPage(error.message), 400);
    }
    throw error;
  }
  if (!pending) {
    return c.html(errorPage("Invalid or expired OAuth state"), 400);
  }
  if (pending.initiatorUserId !== c.get("user").id) {
    return c.html(errorPage("OAuth request belongs to another user"), 403);
  }
  if (!MCP_OAUTH_BROWSER_NONCE_PATTERN.test(pending.browserNonce)) {
    return c.html(errorPage("Invalid OAuth browser binding"), 400);
  }
  const authorizationUrl = assertAllowedMcpEndpointUrl(
    pending.authorizationUrl,
    getMcpEndpointUrlOptions(c.env),
    "OAuth authorization endpoint",
  );
  const remainingSeconds = Math.max(
    1,
    Math.min(
      MCP_OAUTH_PENDING_TTL_SECONDS,
      Math.ceil((new Date(pending.expiresAt).getTime() - Date.now()) / 1000),
    ),
  );
  c.header(
    "Set-Cookie",
    setMcpOAuthBrowserCookie(state, pending.browserNonce, remainingSeconds),
  );
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  return c.redirect(authorizationUrl.href, 302);
});

mcpRoutes.get("/oauth/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const issuer = c.req.query("iss");
  const error = c.req.query("error");
  if (!state || !issuer) {
    return c.html(errorPage("Missing state or issuer parameter"), 400);
  }
  if (!MCP_OAUTH_STATE_PATTERN.test(state)) {
    return c.html(errorPage("Invalid OAuth state"), 400);
  }
  const browserNonce = readCookie(
    c.req.header("Cookie"),
    mcpOAuthBrowserCookieName(state),
  );
  if (!browserNonce || !MCP_OAUTH_BROWSER_NONCE_PATTERN.test(browserNonce)) {
    return c.html(errorPage("Missing OAuth browser binding"), 400);
  }
  let pending: Awaited<ReturnType<typeof consumeMcpOAuthPending>>;
  try {
    pending = await consumeMcpOAuthPending(c.env.DB, c.env, {
      state,
      browserNonce,
      issuer,
    });
  } catch (err) {
    if (
      err instanceof McpOAuthBrowserBindingError ||
      err instanceof McpOAuthPendingUpgradeRequiredError
    ) {
      return c.html(errorPage(err.message), 400);
    }
    logError("consumeMcpOAuthPending error", err, { module: "mcp-oauth" });
    return c.html(errorPage("Internal error processing OAuth callback"), 500);
  }
  if (!pending) {
    c.header("Set-Cookie", clearMcpOAuthBrowserCookie(state));
    return c.html(
      errorPage("Invalid or expired OAuth state. Please try again."),
      400,
    );
  }
  c.header("Set-Cookie", clearMcpOAuthBrowserCookie(state));
  if (error) {
    return c.html(errorPage(`OAuth authorization failed: ${error}`), 400);
  }
  if (!code) {
    return c.html(errorPage("Missing authorization code"), 400);
  }
  try {
    await completeMcpOAuthFlow(c.env.DB, c.env, {
      spaceId: pending.spaceId,
      serverName: pending.serverName,
      serverUrl: pending.serverUrl,
      issuerUrl: pending.issuerUrl,
      authorizationEndpoint: pending.authorizationEndpoint,
      tokenEndpoint: pending.tokenEndpoint,
      redirectUri: pending.redirectUri,
      resourceUri: pending.resourceUri,
      resourceMetadataUrl: pending.resourceMetadataUrl,
      clientId: pending.clientId,
      clientSecret: pending.clientSecret,
      clientIdIssuedAt: pending.clientIdIssuedAt,
      clientSecretExpiresAt: pending.clientSecretExpiresAt,
      registrationMode: pending.registrationMode,
      tokenEndpointAuthMethod: pending.tokenEndpointAuthMethod,
      code,
      codeVerifier: pending.codeVerifier,
      scope: pending.scope,
    });
  } catch (err) {
    logError("completeMcpOAuthFlow error", err, { module: "mcp-oauth" });
    return c.html(
      errorPage(
        "Failed to exchange OAuth authorization code. Please try again.",
      ),
      500,
    );
  }
  return c.html(successPage(pending.serverName));
});

mcpRoutes.post(
  "/servers",
  spaceAccess({ roles: MCP_CREATE_ROLES }),
  zValidator("json", createServerSchema),
  async (c) => {
    const spaceId = c.get("spaceId");
    const body = c.req.valid("json");
    if (!body.name || !body.url) {
      throw new BadRequestError("name and url are required");
    }
    const result = await registerExternalMcpServer(c.env.DB, c.env, {
      spaceId,
      initiatorUserId: c.get("user").id,
      name: body.name,
      url: body.url,
      scope: body.scope,
    });
    return c.json({
      data: {
        status: result.status,
        name: result.name,
        url: result.url,
        auth_url: result.authUrl,
        message: result.message,
      },
    });
  },
);

mcpRoutes.post(
  "/servers/:id/reauthorize",
  spaceAccess({ roles: MCP_CREATE_ROLES }),
  async (c) => {
    const result = await reauthorizeExternalMcpServer(c.env.DB, c.env, {
      spaceId: c.get("spaceId"),
      serverId: c.req.param("id"),
      initiatorUserId: c.get("user").id,
    });
    return c.json({
      data: {
        status: result.status,
        name: result.name,
        url: result.url,
        auth_url: result.authUrl,
        message: result.message,
      },
    });
  },
);

mcpRoutes.get("/servers", spaceAccess({ roles: MCP_LIST_ROLES }), async (c) => {
  const servers = await listMcpServers(c.env.DB, c.get("spaceId"));
  return c.json({ data: servers.map(serializeMcpServer) });
});

mcpRoutes.delete(
  "/servers/:id",
  spaceAccess({ roles: MCP_DELETE_ROLES }),
  async (c) => {
    const deleted = await deleteMcpServer(
      c.env.DB,
      c.get("spaceId"),
      c.req.param("id"),
    );
    if (!deleted) throw new NotFoundError("MCP server");
    return ok(c);
  },
);

mcpRoutes.patch(
  "/servers/:id",
  spaceAccess({ roles: MCP_UPDATE_ROLES }),
  zValidator("json", updateServerSchema),
  async (c) => {
    const body = c.req.valid("json");
    const updated = await updateMcpServer(
      c.env.DB,
      c.get("spaceId"),
      c.req.param("id"),
      body,
    );
    if (!updated) throw new NotFoundError("MCP server");
    return c.json({ data: serializeMcpServer(updated) });
  },
);

function successPage(serverName: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>MCP Server Connected</title><style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f0fdf4}.card{background:white;border-radius:12px;padding:2rem 3rem;box-shadow:0 4px 24px rgba(0,0,0,.08);text-align:center;max-width:400px}h1{color:#16a34a;margin-bottom:.5rem}p{color:#4b5563}</style></head><body><div class="card"><h1>✓ Connected</h1><p>MCP server <strong>${escapeHtml(
    serverName,
  )}</strong> has been successfully authorized.</p><p>You can close this window and continue in the agent.</p></div></body></html>`;
}
function errorPage(message: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>MCP Authorization Error</title><style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#fef2f2}.card{background:white;border-radius:12px;padding:2rem 3rem;box-shadow:0 4px 24px rgba(0,0,0,.08);text-align:center;max-width:400px}h1{color:#dc2626;margin-bottom:.5rem}p{color:#4b5563}</style></head><body><div class="card"><h1>Authorization Failed</h1><p>${escapeHtml(
    message,
  )}</p><p>Please close this window and try again.</p></div></body></html>`;
}

export default mcpRoutes;
