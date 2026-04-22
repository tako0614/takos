import type { RegisteredTool, ToolDefinition } from "./tool-definitions.ts";
import type { Env, SpaceRole } from "../../shared/types/index.ts";
import { getDb, mcpServers } from "../../infra/db/index.ts";
import { and, eq } from "drizzle-orm";
import { McpClient } from "./mcp-client.ts";
import {
  assertAllowedMcpEndpointUrl,
  decryptAccessToken,
  getMcpEndpointUrlOptions,
  refreshMcpToken,
} from "../services/platform/mcp.ts";
import {
  readPublicationAuthSecretRef,
  resolvePublicationAuthToken,
} from "../services/platform/mcp/auth-secret.ts";
import type { D1Database } from "../../shared/types/bindings.ts";
import type { Database } from "../../infra/db/index.ts";
import { logError } from "../../shared/utils/logger.ts";
import {
  isPublicationType,
  listPublications,
  publicationResolvedUrl,
} from "../services/platform/service-publications.ts";

export interface McpLoadResult {
  tools: Map<string, RegisteredTool>;
  clients: Map<string, McpClient>;
  failedServers: string[];
}

interface McpServerLoadRecord {
  id: string;
  name: string;
  url: string;
  sourceType: string;
  authMode: string;
  serviceId: string | null;
  bundleDeploymentId: string | null;
  oauthAccessToken: string | null;
  oauthRefreshToken: string | null;
  oauthIssuerUrl: string | null;
  oauthTokenExpiresAt: string | Date | null;
  authSecretRef?: string | null;
}

const DYNAMIC_MCP_ALLOWED_ROLES: ReadonlySet<SpaceRole> = new Set<SpaceRole>([
  "owner",
  "admin",
  "editor",
]);

function assertDynamicMcpExecutionAllowed(
  server: McpServerLoadRecord,
  context: { role?: SpaceRole; capabilities?: string[] },
): void {
  const role = context.role;
  if (role && !DYNAMIC_MCP_ALLOWED_ROLES.has(role)) {
    throw new Error(
      `Permission denied for MCP tool execution on server "${server.name}": role "${role}" is not allowed`,
    );
  }

  if (server.sourceType === "external") {
    const capabilities = new Set(context.capabilities || []);
    if (!capabilities.has("egress.http")) {
      throw new Error(
        `Permission denied for MCP tool execution on server "${server.name}": missing capability "egress.http"`,
      );
    }
  }
}

/** Combine multiple AbortSignals — aborts when any one fires. */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), {
      once: true,
    });
  }
  return controller.signal;
}

/** Load MCP server tools, handling token refresh and namespace collisions. */
export async function loadMcpTools(
  db: D1Database,
  spaceId: string,
  env: Env,
  existingNames: Set<string>,
  exposureContext?: { role?: SpaceRole; capabilities?: string[] },
): Promise<McpLoadResult> {
  const tools = new Map<string, RegisteredTool>();
  const clients = new Map<string, McpClient>();
  const failedServers: string[] = [];
  const drizzle = getDb(db);

  let servers: McpServerLoadRecord[];

  try {
    const storedServers = await drizzle.select({
      id: mcpServers.id,
      name: mcpServers.name,
      url: mcpServers.url,
      sourceType: mcpServers.sourceType,
      authMode: mcpServers.authMode,
      serviceId: mcpServers.serviceId,
      bundleDeploymentId: mcpServers.bundleDeploymentId,
      oauthAccessToken: mcpServers.oauthAccessToken,
      oauthRefreshToken: mcpServers.oauthRefreshToken,
      oauthIssuerUrl: mcpServers.oauthIssuerUrl,
      oauthTokenExpiresAt: mcpServers.oauthTokenExpiresAt,
    }).from(mcpServers).where(
      and(eq(mcpServers.accountId, spaceId), eq(mcpServers.enabled, true)),
    ).all()
      .then((rows) => rows as McpServerLoadRecord[]);
    const publicationServers = (await listPublications({ DB: db }, spaceId))
      .filter((record) =>
        isPublicationType(record.publicationType, "takos.mcp-server.v1")
      )
      .map((record): McpServerLoadRecord | null => {
        const url = publicationResolvedUrl(record);
        if (!url) return null;
        const authSecretRef = readPublicationAuthSecretRef(record);
        return {
          id: `publication:${record.id}`,
          name: record.name,
          url,
          sourceType: "publication",
          authMode: authSecretRef ? "bearer_token" : "takos_oidc",
          serviceId: record.ownerServiceId,
          bundleDeploymentId: null,
          oauthAccessToken: null,
          oauthRefreshToken: null,
          oauthIssuerUrl: null,
          oauthTokenExpiresAt: null,
          authSecretRef,
        };
      })
      .filter((record): record is McpServerLoadRecord => record !== null);
    servers = [...publicationServers, ...storedServers];
  } catch (err) {
    logError("Failed to load MCP servers from DB", err, {
      module: "tools/mcp-tools",
    });
    failedServers.push("(all — DB query failed)");
    return { tools, clients, failedServers };
  }

  // Deterministic and contract-aligned ordering:
  // Takos custom tools are resolved first (outside this loader), then managed MCP, then external MCP.
  servers.sort((a, b) => {
    const sourceRank = (
      sourceType: string,
    ) => (sourceType === "external" ? 1 : 0);
    const rankDiff = sourceRank(a.sourceType) - sourceRank(b.sourceType);
    if (rankDiff !== 0) return rankDiff;
    const nameDiff = a.name.localeCompare(b.name);
    if (nameDiff !== 0) return nameDiff;
    return a.id.localeCompare(b.id);
  });

  const urlOptions = getMcpEndpointUrlOptions(env);

  for (const server of servers) {
    if (
      exposureContext?.role &&
      !DYNAMIC_MCP_ALLOWED_ROLES.has(exposureContext.role)
    ) {
      continue;
    }
    if (server.sourceType === "external") {
      const capabilities = new Set(exposureContext?.capabilities || []);
      if (exposureContext && !capabilities.has("egress.http")) {
        continue;
      }
    }

    try {
      // SSRF check: validate MCP server URL before connecting
      assertAllowedMcpEndpointUrl(server.url, urlOptions, "MCP server");

      const client = await createLoadClient(db, env, spaceId, drizzle, server);

      const mcpTools = await client.listTools();

      for (const { sdkTool, definition } of mcpTools) {
        const exposedName = pickUniqueMcpToolName(
          existingNames,
          server,
          definition.name,
        );
        existingNames.add(exposedName);

        const namespacedDef: ToolDefinition = {
          ...definition,
          namespace: "mcp",
          family: `mcp.${sanitizeMcpToolNamespace(server.name || server.id)}`,
          risk_level: server.sourceType === "external" ? "medium" : "low",
          side_effects: true,
          name: exposedName,
        };
        namespacedDef.required_roles = Array.from(DYNAMIC_MCP_ALLOWED_ROLES);
        if (server.sourceType === "external") {
          namespacedDef.required_capabilities = ["egress.http"];
        }
        const sdkToolName = sdkTool.name;

        tools.set(exposedName, {
          definition: namespacedDef,
          handler: async (args, ctx) => {
            assertDynamicMcpExecutionAllowed(server, ctx);

            // Apply timeout to MCP tool calls to prevent hung servers from blocking the agent
            const MCP_CALL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
            const timeoutController = new AbortController();
            const timer = setTimeout(
              () => timeoutController.abort(),
              MCP_CALL_TIMEOUT_MS,
            );

            // Combine user abort signal with timeout
            const signal = ctx.abortSignal
              ? anySignal([ctx.abortSignal, timeoutController.signal])
              : timeoutController.signal;

            try {
              if (server.sourceType === "external") {
                return await client.callTool(sdkToolName, args, signal);
              }

              const accessToken = await resolveMcpAccessToken(
                db,
                env,
                spaceId,
                drizzle,
                server,
              );
              const callClient = new McpClient(
                server.url,
                accessToken,
                server.name,
              );
              await callClient.connect();
              try {
                return await callClient.callTool(sdkToolName, args, signal);
              } finally {
                await callClient.close().catch((e) => {
                  logError("MCP call client close failed (non-critical)", e, {
                    module: "mcp",
                  });
                });
              }
            } finally {
              clearTimeout(timer);
            }
          },
          custom: false,
        });
      }

      if (server.sourceType === "external") {
        clients.set(server.name, client);
      } else {
        await client.close().catch((e) => {
          logError("MCP client close failed (non-critical)", e, {
            module: "mcp",
          });
        });
      }
    } catch (err) {
      logError(`Failed to load tools from server "${server.name}"`, err, {
        module: "mcp",
      });
      failedServers.push(server.name);
    }
  }

  return { tools, clients, failedServers };
}

function sanitizeMcpToolNamespace(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function pickUniqueMcpToolName(
  existingNames: Set<string>,
  server: McpServerLoadRecord,
  toolName: string,
): string {
  if (!existingNames.has(toolName)) return toolName;

  const serverName = sanitizeMcpToolNamespace(server.name || server.id);
  const serverId = sanitizeMcpToolNamespace(server.id);
  const candidates = [
    `${serverName}__${toolName}`,
    `${serverName}__${serverId}__${toolName}`,
    `${serverId}__${toolName}`,
  ];

  for (const candidate of candidates) {
    if (!existingNames.has(candidate)) return candidate;
  }

  let suffix = 2;
  while (
    existingNames.has(`${serverName}__${serverId}__${toolName}__${suffix}`)
  ) {
    suffix += 1;
  }
  return `${serverName}__${serverId}__${toolName}__${suffix}`;
}

async function createLoadClient(
  db: D1Database,
  env: Env,
  _spaceId: string,
  drizzle: Database,
  server: McpServerLoadRecord,
): Promise<McpClient> {
  const accessToken = await resolveMcpAccessToken(
    db,
    env,
    _spaceId,
    drizzle,
    server,
  );
  const client = new McpClient(server.url, accessToken, server.name);
  await client.connect();
  return client;
}

async function resolveMcpAccessToken(
  db: D1Database,
  env: Env,
  spaceId: string,
  drizzle: Database,
  server: McpServerLoadRecord,
): Promise<string | null> {
  if (server.sourceType === "external") {
    await refreshTokenIfNeeded(db, env, drizzle, server);
    return await decryptAccessToken(db, env, server);
  }

  if (server.sourceType === "publication") {
    return await resolvePublicationAuthToken(db, env, {
      spaceId,
      publicationName: server.name,
      ownerServiceId: server.serviceId,
      authSecretRef: server.authSecretRef ?? null,
    });
  }

  // Bearer token auth — decrypt the stored token and pass as access token.
  // Re-read from DB to pick up tokens rotated by re-deploy.
  if (server.authMode !== "bearer_token") return null;
  const freshRow = await drizzle.select({
    oauthAccessToken: mcpServers.oauthAccessToken,
  })
    .from(mcpServers).where(eq(mcpServers.id, server.id)).get();
  const tokenSource = freshRow?.oauthAccessToken
    ? { ...server, oauthAccessToken: freshRow.oauthAccessToken }
    : server;
  return await decryptAccessToken(db, env, tokenSource);
}

/** Refresh the OAuth token if it expires within 5 minutes. */
async function refreshTokenIfNeeded(
  db: D1Database,
  env: Env,
  drizzle: Database,
  server: McpServerLoadRecord,
): Promise<void> {
  if (!server.oauthTokenExpiresAt) return;

  const expiresAt = typeof server.oauthTokenExpiresAt === "string"
    ? new Date(server.oauthTokenExpiresAt)
    : server.oauthTokenExpiresAt;
  const fiveMinutes = 5 * 60 * 1000;

  if (expiresAt.getTime() - Date.now() >= fiveMinutes) return;

  await refreshMcpToken(db, env, server);

  const updated = await drizzle.select({
    oauthAccessToken: mcpServers.oauthAccessToken,
  })
    .from(mcpServers).where(eq(mcpServers.id, server.id)).get();
  if (updated) {
    server.oauthAccessToken = updated.oauthAccessToken;
  }
}
