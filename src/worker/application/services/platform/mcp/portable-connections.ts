import { z } from "zod";
import { and, eq } from "drizzle-orm";
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
import { BadRequestError } from "@takos/worker-platform-utils/errors";

export const MCP_CONNECTIONS_EXPORT_FORMAT = "takos.mcp.connections";
export const MCP_CONNECTIONS_EXPORT_VERSION = 1;

const exportedToolSchema = z.object({
  name: z.string().min(1).max(256),
  schema_hash: z.string().regex(/^[a-f0-9]{64}$/),
  enabled: z.boolean(),
  invocation_policy: z.enum(["automatic", "confirm_each_time"]),
});

const exportedConnectionSchema = z.object({
  name: z.string().min(1).max(64),
  url: z.string().min(1).max(2048),
  transport: z.literal("streamable-http"),
  enabled: z.boolean(),
  scope: z.string().max(4096).nullable(),
  tools: z.array(exportedToolSchema).max(2048),
});

const exportedRegistrySourceSchema = z
  .object({
    kind: z.enum(["official", "organization", "community", "custom"]),
    name: z.string().min(1).max(120),
    base_url: z.string().min(1).max(2048),
    enabled: z.boolean(),
    priority: z.number().int().min(-1000).max(1000),
    auth_type: z.enum(["none", "bearer", "header"]),
    auth_header_name: z.string().min(1).max(128).nullable(),
    credential_required: z.boolean(),
  })
  .superRefine((source, context) => {
    if (
      source.kind === "official" &&
      (source.base_url !== "https://registry.modelcontextprotocol.io" ||
        source.auth_type !== "none")
    ) {
      context.addIssue({
        code: "custom",
        path: ["base_url"],
        message: "Official Registry source metadata is not portable",
      });
    }
    const valid =
      (source.auth_type === "none" &&
        source.auth_header_name === null &&
        !source.credential_required) ||
      (source.auth_type === "bearer" &&
        source.auth_header_name === null &&
        source.credential_required) ||
      (source.auth_type === "header" &&
        source.auth_header_name !== null &&
        source.credential_required);
    if (!valid) {
      context.addIssue({
        code: "custom",
        message: "Registry authentication metadata is inconsistent",
      });
    }
  });

export const mcpConnectionsExportSchema = z
  .object({
    format: z.literal(MCP_CONNECTIONS_EXPORT_FORMAT),
    version: z.literal(MCP_CONNECTIONS_EXPORT_VERSION),
    exported_at: z.string().datetime(),
    registry_sources: z.array(exportedRegistrySourceSchema).max(17),
    connections: z.array(exportedConnectionSchema).max(32),
  })
  .strict()
  .superRefine((document, context) => {
    const toolCount = document.connections.reduce(
      (count, connection) => count + connection.tools.length,
      0,
    );
    if (toolCount > 2048) {
      context.addIssue({
        code: "custom",
        path: ["connections"],
        message: "Connections import contains too many tool policies",
      });
    }
  });

export type McpConnectionsExport = z.infer<typeof mcpConnectionsExportSchema>;

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
    .all();
  const registrySources = await listMcpRegistrySources(dbBinding, accountId);
  const connections = await Promise.all(
    servers.map(async (server) => {
      const policies = await db
        .select()
        .from(mcpToolPolicies)
        .where(
          and(
            eq(mcpToolPolicies.accountId, accountId),
            eq(mcpToolPolicies.serverId, server.id),
          ),
        )
        .all();
      return {
        name: server.name,
        url: server.url,
        transport: "streamable-http" as const,
        enabled: server.enabled,
        scope: server.oauthScope ?? null,
        tools: policies.map((policy) => ({
          name: policy.toolName,
          schema_hash: policy.schemaHash,
          enabled: policy.enabled,
          invocation_policy:
            policy.invocationPolicy === "automatic"
              ? ("automatic" as const)
              : ("confirm_each_time" as const),
        })),
      };
    }),
  );
  return {
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
  const validated = mcpConnectionsExportSchema.safeParse(params.document);
  if (!validated.success) {
    throw new BadRequestError(
      "Connections import does not match takos.mcp.connections version 1",
    );
  }
  const parsed = validated.data;
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
