import type { ToolDefinition, RegisteredTool } from './tool-definitions.ts';
import type { Env, SpaceRole } from '../../shared/types/index.ts';
import { getDb, mcpServers } from '../../infra/db/index.ts';
import { eq, and } from 'drizzle-orm';
import { McpClient } from './mcp-client.ts';
import { refreshMcpToken, decryptAccessToken, assertAllowedMcpEndpointUrl, getMcpEndpointUrlOptions } from '../services/platform/mcp.ts';
import type { D1Database } from '../../shared/types/bindings.ts';
import type { Database } from '../../infra/db/index.ts';
import { logError } from '../../shared/utils/logger.ts';

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
}

const DYNAMIC_MCP_ALLOWED_ROLES: ReadonlySet<SpaceRole> = new Set<SpaceRole>([
  'owner',
  'admin',
  'editor',
]);

function assertDynamicMcpExecutionAllowed(
  server: McpServerLoadRecord,
  context: { role?: SpaceRole; capabilities?: string[] },
): void {
  const role = context.role;
  if (role && !DYNAMIC_MCP_ALLOWED_ROLES.has(role)) {
    throw new Error(
      `Permission denied for MCP tool execution on server "${server.name}": role "${role}" is not allowed`
    );
  }

  if (server.sourceType === 'external') {
    const capabilities = new Set(context.capabilities || []);
    if (!capabilities.has('egress.http')) {
      throw new Error(
        `Permission denied for MCP tool execution on server "${server.name}": missing capability "egress.http"`
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
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
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
    servers = await drizzle.select({
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
    }).from(mcpServers).where(and(eq(mcpServers.accountId, spaceId), eq(mcpServers.enabled, true))).all()
      .then((rows) => rows as McpServerLoadRecord[]);
  } catch (err) {
    logError('Failed to load MCP servers from DB', err, { module: 'tools/mcp-tools' });
    failedServers.push('(all — DB query failed)');
    return { tools, clients, failedServers };
  }

  // Deterministic and contract-aligned ordering:
  // built-in tools are resolved first (outside this loader), then managed MCP, then external MCP.
  servers.sort((a, b) => {
    const sourceRank = (sourceType: string) => (sourceType === 'external' ? 1 : 0);
    const rankDiff = sourceRank(a.sourceType) - sourceRank(b.sourceType);
    if (rankDiff !== 0) return rankDiff;
    const nameDiff = a.name.localeCompare(b.name);
    if (nameDiff !== 0) return nameDiff;
    return a.id.localeCompare(b.id);
  });

  const urlOptions = getMcpEndpointUrlOptions(env);

  for (const server of servers) {
    if (exposureContext?.role && !DYNAMIC_MCP_ALLOWED_ROLES.has(exposureContext.role)) {
      continue;
    }
    if (server.sourceType === 'external') {
      const capabilities = new Set(exposureContext?.capabilities || []);
      if (exposureContext && !capabilities.has('egress.http')) {
        continue;
      }
    }

    try {
      // SSRF check: validate MCP server URL before connecting
      assertAllowedMcpEndpointUrl(server.url, urlOptions, 'MCP server');

      const client = await createLoadClient(db, env, spaceId, drizzle, server);

      const mcpTools = await client.listTools();

      for (const { sdkTool, definition } of mcpTools) {
        let exposedName = definition.name;
        if (existingNames.has(exposedName)) {
          exposedName = `${server.name}__${definition.name}`;
        }
        existingNames.add(exposedName);

        const namespacedDef: ToolDefinition = { ...definition, name: exposedName };
        namespacedDef.required_roles = Array.from(DYNAMIC_MCP_ALLOWED_ROLES);
        if (server.sourceType === 'external') {
          namespacedDef.required_capabilities = ['egress.http'];
        }
        const sdkToolName = sdkTool.name;

        tools.set(exposedName, {
          definition: namespacedDef,
          handler: async (args, ctx) => {
            assertDynamicMcpExecutionAllowed(server, ctx);

            // Apply timeout to MCP tool calls to prevent hung servers from blocking the agent
            const MCP_CALL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
            const timeoutController = new AbortController();
            const timer = setTimeout(() => timeoutController.abort(), MCP_CALL_TIMEOUT_MS);

            // Combine user abort signal with timeout
            const signal = ctx.abortSignal
              ? anySignal([ctx.abortSignal, timeoutController.signal])
              : timeoutController.signal;

            try {
              if (server.sourceType === 'external') {
                return await client.callTool(sdkToolName, args, signal);
              }

              const callClient = new McpClient(server.url, null, server.name);
              await callClient.connect();
              try {
                return await callClient.callTool(sdkToolName, args, signal);
              } finally {
                await callClient.close().catch((e) => {
                  logError('MCP call client close failed (non-critical)', e, { module: 'mcp' });
                });
              }
            } finally {
              clearTimeout(timer);
            }
          },
          builtin: false,
        });
      }

      if (server.sourceType === 'external') {
        clients.set(server.name, client);
      } else {
        await client.close().catch((e) => {
          logError('MCP client close failed (non-critical)', e, { module: 'mcp' });
        });
      }
    } catch (err) {
      logError(`Failed to load tools from server "${server.name}"`, err, { module: 'mcp' });
      failedServers.push(server.name);
    }
  }

  return { tools, clients, failedServers };
}

async function createLoadClient(
  db: D1Database,
  env: Env,
  spaceId: string,
  drizzle: Database,
  server: McpServerLoadRecord,
): Promise<McpClient> {
  if (server.sourceType === 'external') {
    await refreshTokenIfNeeded(db, env, drizzle, server);
    const accessToken = await decryptAccessToken(db, env, server);
    const client = new McpClient(server.url, accessToken, server.name);
    await client.connect();
    return client;
  }

  // Bearer token auth — decrypt the stored token and pass as access token.
  // Re-read from DB to pick up tokens rotated by re-deploy.
  if (server.authMode === 'bearer_token') {
    const freshRow = await drizzle.select({ oauthAccessToken: mcpServers.oauthAccessToken })
      .from(mcpServers).where(eq(mcpServers.id, server.id)).get();
    const tokenSource = freshRow?.oauthAccessToken ? { ...server, oauthAccessToken: freshRow.oauthAccessToken } : server;
    const accessToken = await decryptAccessToken(db, env, tokenSource);
    const client = new McpClient(server.url, accessToken, server.name);
    await client.connect();
    return client;
  }

  const client = new McpClient(server.url, null, server.name);
  await client.connect();
  return client;
}

/** Refresh the OAuth token if it expires within 5 minutes. */
async function refreshTokenIfNeeded(
  db: D1Database,
  env: Env,
  drizzle: Database,
  server: McpServerLoadRecord,
): Promise<void> {
  if (!server.oauthTokenExpiresAt) return;

  const expiresAt = typeof server.oauthTokenExpiresAt === 'string'
    ? new Date(server.oauthTokenExpiresAt)
    : server.oauthTokenExpiresAt;
  const fiveMinutes = 5 * 60 * 1000;

  if (expiresAt.getTime() - Date.now() >= fiveMinutes) return;

  await refreshMcpToken(db, env, server);

  const updated = await drizzle.select({ oauthAccessToken: mcpServers.oauthAccessToken })
    .from(mcpServers).where(eq(mcpServers.id, server.id)).get();
  if (updated) {
    server.oauthAccessToken = updated.oauthAccessToken;
  }
}
