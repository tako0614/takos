/**
 * MCP custom tools
 *
 * mcp_add_server    - Register an external MCP server (starts OAuth flow if needed)
 * mcp_list_servers  - List registered MCP servers for the current space
 * mcp_update_server - Update an existing registered MCP server
 * mcp_remove_server - Remove a registered MCP server
 */

import type { ToolDefinition, ToolHandler } from "../tool-definitions.ts";
import {
  deleteMcpServer,
  listMcpServers,
  registerExternalMcpServer,
  updateMcpServer,
} from "../../services/platform/mcp.ts";
import { getDb, mcpServers } from "../../../infra/db/index.ts";
import { and, eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// mcp_add_server
// ---------------------------------------------------------------------------

export const MCP_ADD_SERVER: ToolDefinition = {
  name: "mcp_add_server",
  description:
    "Register an external MCP (Model Context Protocol) server so its tools become available in this space. " +
    "If the server requires OAuth authentication, this tool will return an auth_url that the user must visit to grant access. " +
    "Once authorized, the server's tools will be available in the next conversation turn.",
  category: "mcp",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The base URL of the MCP server (must be HTTPS)",
      },
      name: {
        type: "string",
        description:
          "A short identifier for this server (alphanumeric + underscore, max 64 chars)",
      },
      scope: {
        type: "string",
        description: "Optional OAuth scope(s) to request (space-separated)",
      },
    },
    required: ["url", "name"],
  },
};

export const mcpAddServerHandler: ToolHandler = async (args, context) => {
  const url = args.url as string;
  const name = args.name as string;
  const scope = args.scope as string | undefined;
  const result = await registerExternalMcpServer(context.db, context.env, {
    spaceId: context.spaceId,
    name,
    url,
    scope,
  });

  return JSON.stringify(
    {
      status: result.status,
      auth_url: result.authUrl,
      message: result.message,
      name: result.name,
      url: result.url,
    },
    null,
    2,
  );
};

// ---------------------------------------------------------------------------
// mcp_list_servers
// ---------------------------------------------------------------------------

export const MCP_LIST_SERVERS: ToolDefinition = {
  name: "mcp_list_servers",
  description:
    "List all registered MCP servers for this space, including their status.",
  category: "mcp",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
};

export const mcpListServersHandler: ToolHandler = async (_args, context) => {
  const servers = await listMcpServers(context.db, context.spaceId);
  return JSON.stringify(
    {
      servers: servers.map((s) => ({
        id: s.id,
        name: s.name,
        url: s.url,
        transport: s.transport,
        enabled: s.enabled,
        source_type: s.sourceType === "worker" ? "service" : s.sourceType,
        auth_mode: s.authMode,
        service_id: s.serviceId,
        bundle_deployment_id: s.bundleDeploymentId,
        managed: s.sourceType !== "external",
        scope: s.oauthScope,
        token_expires_at: s.oauthTokenExpiresAt,
        created_at: s.createdAt,
      })),
      count: servers.length,
    },
    null,
    2,
  );
};

// ---------------------------------------------------------------------------
// mcp_remove_server
// ---------------------------------------------------------------------------

export const MCP_REMOVE_SERVER: ToolDefinition = {
  name: "mcp_remove_server",
  description:
    "Remove a registered MCP server from this space by id. The legacy name field remains accepted for compatibility.",
  category: "mcp",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The MCP server id to remove (preferred)",
      },
      name: {
        type: "string",
        description: "Deprecated legacy fallback name for the MCP server",
      },
    },
    required: [],
  },
};

export const mcpRemoveServerHandler: ToolHandler = async (args, context) => {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const serverId = id || null;

  const db = getDb(context.db);
  const server = serverId
    ? await db.select({ id: mcpServers.id, name: mcpServers.name })
      .from(mcpServers).where(
        and(
          eq(mcpServers.accountId, context.spaceId),
          eq(mcpServers.id, serverId),
        ),
      ).get()
    : name
    ? await db.select({ id: mcpServers.id, name: mcpServers.name })
      .from(mcpServers).where(
        and(
          eq(mcpServers.accountId, context.spaceId),
          eq(mcpServers.name, name),
        ),
      ).get()
    : null;

  if (!server) {
    const identifier = serverId || name || "";
    return JSON.stringify(
      {
        status: "not_found",
        message: `MCP server "${identifier}" not found`,
      },
      null,
      2,
    );
  }

  await deleteMcpServer(context.db, context.spaceId, server.id);

  return JSON.stringify(
    {
      status: "removed",
      message: `MCP server "${server.name}" has been removed.`,
      name: server.name,
    },
    null,
    2,
  );
};

// ---------------------------------------------------------------------------
// mcp_update_server
// ---------------------------------------------------------------------------

export const MCP_UPDATE_SERVER: ToolDefinition = {
  name: "mcp_update_server",
  description: "Rename or enable/disable a registered MCP server.",
  category: "mcp",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "MCP server ID",
      },
      name: {
        type: "string",
        description: "Optional new server name",
      },
      enabled: {
        type: "boolean",
        description: "Optional enabled status",
      },
    },
    required: ["id"],
  },
};

export const mcpUpdateServerHandler: ToolHandler = async (args, context) => {
  const serverId = String(args.id || "").trim();
  if (!serverId) {
    throw new Error("id is required");
  }

  const updated = await updateMcpServer(context.db, context.spaceId, serverId, {
    enabled: typeof args.enabled === "boolean" ? args.enabled : undefined,
    name: typeof args.name === "string" ? args.name : undefined,
  });

  if (!updated) {
    throw new Error(`MCP server not found: ${serverId}`);
  }

  return JSON.stringify(
    {
      data: {
        id: updated.id,
        name: updated.name,
        url: updated.url,
        transport: updated.transport,
        enabled: updated.enabled,
        source_type: updated.sourceType === "worker"
          ? "service"
          : updated.sourceType,
        auth_mode: updated.authMode,
        service_id: updated.serviceId,
        bundle_deployment_id: updated.bundleDeploymentId,
        managed: updated.sourceType !== "external",
        scope: updated.oauthScope,
        issuer_url: updated.oauthIssuerUrl,
        token_expires_at: updated.oauthTokenExpiresAt,
        created_at: updated.createdAt,
        updated_at: updated.updatedAt,
      },
    },
    null,
    2,
  );
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const MCP_TOOLS: ToolDefinition[] = [
  MCP_ADD_SERVER,
  MCP_LIST_SERVERS,
  MCP_UPDATE_SERVER,
  MCP_REMOVE_SERVER,
];

export const MCP_HANDLERS: Record<string, ToolHandler> = {
  mcp_add_server: mcpAddServerHandler,
  mcp_list_servers: mcpListServersHandler,
  mcp_update_server: mcpUpdateServerHandler,
  mcp_remove_server: mcpRemoveServerHandler,
};
