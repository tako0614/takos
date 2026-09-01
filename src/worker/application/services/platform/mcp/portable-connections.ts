import { and, asc, eq, inArray } from "drizzle-orm";
import {
  getDb,
  mcpServers,
  mcpToolPolicies,
  type SqlDatabaseLike,
} from "../../../../infra/db/index.ts";
import type { SqlDatabaseBinding } from "../../../../shared/types/bindings.ts";
import type { Env } from "../../../../shared/types/index.ts";
import {
  createMcpRegistrySource,
  listMcpRegistrySources,
  OFFICIAL_MCP_REGISTRY_SOURCE_ID,
  updateMcpRegistrySource,
} from "./registry-sources.ts";
import { registerExternalMcpServer, updateMcpServer } from "./crud.ts";
import {
  BadRequestError,
  PayloadTooLargeError,
  ServiceUnavailableError,
} from "@takos/worker-platform-utils/errors";
import {
  MAX_MCP_CONNECTIONS,
  MAX_MCP_CONNECTIONS_DOCUMENT_BYTES,
  MAX_MCP_CONNECTIONS_REGISTRY_SOURCES,
  MAX_MCP_CONNECTION_TOOL_POLICIES,
  MCP_CONNECTIONS_EXPORT_FORMAT,
  MCP_CONNECTIONS_EXPORT_VERSION,
  parseMcpConnectionsDocument,
  type McpConnectionsDocument,
} from "../../../../../contracts/public/mcp-connections.ts";

export type McpConnectionsExport = McpConnectionsDocument;

const encoder = new TextEncoder();

function assistedConnectionsExportError(
  reason:
    | "connection_count"
    | "registry_source_count"
    | "tool_policy_count"
    | "document_bytes",
): PayloadTooLargeError {
  return new PayloadTooLargeError(
    "This Connections export requires assisted processing",
    {
      assisted_processing: true,
      reason,
      max_connections: MAX_MCP_CONNECTIONS,
      max_registry_sources: MAX_MCP_CONNECTIONS_REGISTRY_SOURCES,
      max_tool_policies: MAX_MCP_CONNECTION_TOOL_POLICIES,
      max_document_bytes: MAX_MCP_CONNECTIONS_DOCUMENT_BYTES,
    },
  );
}

export async function exportMcpConnections(
  dbBinding: SqlDatabaseLike,
  accountId: string,
): Promise<McpConnectionsExport> {
  const db = getDb(dbBinding);
  const servers = await db
    .select()
    .from(mcpServers)
    .where(
      and(
        eq(mcpServers.accountId, accountId),
        eq(mcpServers.sourceType, "external"),
      ),
    )
    .orderBy(asc(mcpServers.name), asc(mcpServers.id))
    .limit(MAX_MCP_CONNECTIONS + 1)
    .all();
  if (servers.length > MAX_MCP_CONNECTIONS) {
    throw assistedConnectionsExportError("connection_count");
  }
  const registrySources = await listMcpRegistrySources(dbBinding, accountId);
  if (registrySources.length > MAX_MCP_CONNECTIONS_REGISTRY_SOURCES) {
    throw assistedConnectionsExportError("registry_source_count");
  }
  const policies = servers.length === 0
    ? []
    : await db
      .select()
      .from(mcpToolPolicies)
      .where(
        and(
          eq(mcpToolPolicies.accountId, accountId),
          inArray(
            mcpToolPolicies.serverId,
            servers.map((server) => server.id),
          ),
        ),
      )
      .orderBy(asc(mcpToolPolicies.serverId), asc(mcpToolPolicies.toolName))
      .limit(MAX_MCP_CONNECTION_TOOL_POLICIES + 1)
      .all();
  if (policies.length > MAX_MCP_CONNECTION_TOOL_POLICIES) {
    throw assistedConnectionsExportError("tool_policy_count");
  }
  const policiesByServer = new Map<string, typeof policies>();
  for (const policy of policies) {
    const current = policiesByServer.get(policy.serverId) ?? [];
    current.push(policy);
    policiesByServer.set(policy.serverId, current);
  }
  const connections = servers.map((server) => ({
    name: server.name,
    url: server.url,
    transport: "streamable-http" as const,
    enabled: server.enabled,
    scope: server.oauthScope ?? null,
    tools: (policiesByServer.get(server.id) ?? []).map((policy) => ({
      name: policy.toolName,
      schema_hash: policy.schemaHash,
      enabled: policy.enabled,
      invocation_policy: policy.invocationPolicy,
    })),
  }));
  const candidate = {
    format: MCP_CONNECTIONS_EXPORT_FORMAT,
    version: MCP_CONNECTIONS_EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    registry_sources: registrySources.map((source) => ({
      kind: source.sourceKind,
      name: source.name,
      base_url: source.baseUrl,
      enabled: source.enabled,
      priority: source.priority,
      auth_type: source.authType,
      auth_header_name: source.authHeaderName,
      credential_required: source.authType !== "none",
    })),
    connections,
  };
  let document: McpConnectionsExport;
  try {
    document = parseMcpConnectionsDocument(candidate);
  } catch {
    throw new ServiceUnavailableError(
      "Connections export contains invalid stored metadata",
    );
  }
  if (
    encoder.encode(JSON.stringify(document, null, 2)).byteLength >
      MAX_MCP_CONNECTIONS_DOCUMENT_BYTES
  ) {
    throw assistedConnectionsExportError("document_bytes");
  }
  return document;
}

export interface McpConnectionsImportResult {
  registrySources: Array<{
    baseUrl: string;
    status: "created" | "updated" | "credential_required" | "failed";
    message?: string;
  }>;
  connections: Array<{
    name: string;
    url: string;
    status: "registered" | "already_registered" | "pending_oauth" | "failed";
    authorizationUrl?: string;
    toolPoliciesRequireReview: number;
    message?: string;
  }>;
}

async function importRegistrySources(
  dbBinding: SqlDatabaseLike,
  env: Env,
  accountId: string,
  document: McpConnectionsExport,
): Promise<McpConnectionsImportResult["registrySources"]> {
  const results: McpConnectionsImportResult["registrySources"] = [];
  for (const source of document.registry_sources) {
    try {
      if (source.kind === "official") {
        await updateMcpRegistrySource(
          dbBinding,
          env,
          accountId,
          OFFICIAL_MCP_REGISTRY_SOURCE_ID,
          { enabled: source.enabled },
        );
        results.push({ baseUrl: source.base_url, status: "updated" });
        continue;
      }
      const current = await listMcpRegistrySources(dbBinding, accountId);
      const existing = current.find(
        (entry) => entry.baseUrl === source.base_url,
      );
      const enabled = source.credential_required ? false : source.enabled;
      if (existing) {
        await updateMcpRegistrySource(dbBinding, env, accountId, existing.id, {
          name: source.name,
          sourceKind: source.kind,
          enabled:
            source.credential_required && !existing.credentialConfigured
              ? false
              : source.enabled,
          priority: source.priority,
          authType: source.auth_type,
          authHeaderName: source.auth_header_name,
          allowMissingCredential: true,
        });
        results.push({
          baseUrl: source.base_url,
          status:
            source.credential_required && !existing.credentialConfigured
              ? "credential_required"
              : "updated",
        });
      } else {
        await createMcpRegistrySource(dbBinding, env, accountId, {
          name: source.name,
          baseUrl: source.base_url,
          sourceKind: source.kind,
          enabled,
          priority: source.priority,
          authType: source.auth_type,
          authHeaderName: source.auth_header_name ?? undefined,
          allowMissingCredential: source.credential_required,
        });
        results.push({
          baseUrl: source.base_url,
          status: source.credential_required
            ? "credential_required"
            : "created",
        });
      }
    } catch (error) {
      results.push({
        baseUrl: source.base_url,
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

async function stageImportedToolPolicies(
  dbBinding: SqlDatabaseLike,
  accountId: string,
  serverId: string,
  tools: McpConnectionsExport["connections"][number]["tools"],
): Promise<void> {
  const db = getDb(dbBinding);
  const now = new Date().toISOString();
  for (const tool of tools) {
    await db
      .insert(mcpToolPolicies)
      .values({
        accountId,
        serverId,
        toolName: tool.name,
        schemaHash: tool.schema_hash,
        enabled: false,
        invocationPolicy: tool.invocation_policy,
        firstSeenAt: now,
        lastSeenAt: now,
        reviewedAt: null,
      })
      .onConflictDoNothing({
        target: [
          mcpToolPolicies.accountId,
          mcpToolPolicies.serverId,
          mcpToolPolicies.toolName,
        ],
      });
  }
}

export async function importMcpConnections(
  dbBinding: SqlDatabaseBinding,
  env: Env,
  params: {
    accountId: string;
    userId: string;
    document: unknown;
  },
): Promise<McpConnectionsImportResult> {
  let parsed: McpConnectionsExport;
  try {
    parsed = parseMcpConnectionsDocument(params.document);
  } catch {
    throw new BadRequestError(
      "Connections import does not match takos.mcp.connections version 1",
    );
  }
  const registrySources = await importRegistrySources(
    dbBinding,
    env,
    params.accountId,
    parsed,
  );
  const connections: McpConnectionsImportResult["connections"] = [];
  const db = getDb(dbBinding);
  for (const connection of parsed.connections) {
    const before = await db
      .select({ id: mcpServers.id })
      .from(mcpServers)
      .where(
        and(
          eq(mcpServers.accountId, params.accountId),
          eq(mcpServers.name, connection.name),
          eq(mcpServers.sourceType, "external"),
        ),
      )
      .get();
    try {
      const registered = await registerExternalMcpServer(dbBinding, env, {
        spaceId: params.accountId,
        initiatorUserId: params.userId,
        name: connection.name,
        url: connection.url,
        scope: connection.scope ?? undefined,
      });
      const row = await db
        .select({ id: mcpServers.id })
        .from(mcpServers)
        .where(
          and(
            eq(mcpServers.accountId, params.accountId),
            eq(mcpServers.name, connection.name),
            eq(mcpServers.url, connection.url),
            eq(mcpServers.sourceType, "external"),
          ),
        )
        .get();
      if (row && !before) {
        await stageImportedToolPolicies(
          dbBinding,
          params.accountId,
          row.id,
          connection.tools,
        );
        if (!connection.enabled) {
          await updateMcpServer(dbBinding, params.accountId, row.id, {
            enabled: false,
          });
        }
      }
      connections.push({
        name: connection.name,
        url: connection.url,
        status: registered.status,
        ...(registered.authUrl ? { authorizationUrl: registered.authUrl } : {}),
        toolPoliciesRequireReview: connection.tools.filter(
          (tool) => tool.enabled,
        ).length,
        message: registered.message,
      });
    } catch (error) {
      connections.push({
        name: connection.name,
        url: connection.url,
        status: "failed",
        toolPoliciesRequireReview: connection.tools.filter(
          (tool) => tool.enabled,
        ).length,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { registrySources, connections };
}
