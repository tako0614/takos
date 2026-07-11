import { Hono } from "hono";
import { z } from "zod";
import {
  decryptAccessToken,
  getMcpServerWithTokens,
  refreshMcpToken,
  resolvePublicationMcpServerAccessToken,
} from "../../../application/services/platform/mcp.ts";
import {
  getMcpToolSupport,
  reconcileExternalMcpToolPolicies,
  snapshotMcpTools,
  updateExternalMcpToolPolicy,
  type McpToolPolicyRecord,
  type McpToolSnapshot,
} from "../../../application/services/platform/mcp/tool-policy.ts";
import { McpClient } from "../../../application/tools/mcp-client.ts";
import {
  deriveMcpToolExecutionPolicy,
  parseTrustedLocalMcpReadonlyServerIds,
} from "../../../application/tools/mcp-tools.ts";
import { getSpaceOperationPolicy } from "../../../application/tools/tool-policy.ts";
import type { Env } from "../../../shared/types/index.ts";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import { logError, logWarn } from "../../../shared/utils/logger.ts";
import {
  BadGatewayError,
  BadRequestError,
  ConflictError,
  GatewayTimeoutError,
  NotFoundError,
} from "@takos/worker-platform-utils/errors";
import { spaceAccess, type SpaceAccessRouteEnv } from "../route-auth.ts";
import { zValidator } from "../zod-validator.ts";

const updateToolPolicySchema = z
  .object({
    enabled: z.boolean(),
    schema_hash: z.string().regex(/^[a-f0-9]{64}$/),
    invocation_policy: z.enum(["automatic", "confirm_each_time"]),
  })
  .strict();

const MCP_LIST_ROLES = getSpaceOperationPolicy("mcp_server.list").allowed_roles;
const MCP_UPDATE_ROLES =
  getSpaceOperationPolicy("mcp_server.update").allowed_roles;

type McpServerWithTokens = NonNullable<
  Awaited<ReturnType<typeof getMcpServerWithTokens>>
>;

async function listCurrentServerTools(
  db: SqlDatabaseBinding,
  env: Env,
  spaceId: string,
  serverId: string,
) {
  const server = await getMcpServerWithTokens(db, spaceId, serverId);
  if (!server) throw new NotFoundError("MCP server");

  let accessToken: string | null = null;
  if (server.sourceType === "external") {
    accessToken = await decryptAccessToken(db, env, {
      id: server.id,
      oauthAccessToken: server.oauthAccessToken,
    });
    if (
      server.oauthTokenExpiresAt &&
      new Date(server.oauthTokenExpiresAt) < new Date()
    ) {
      await refreshMcpToken(db, env, server);
      const refreshed = await getMcpServerWithTokens(db, spaceId, serverId);
      if (refreshed) {
        accessToken = await decryptAccessToken(db, env, {
          id: refreshed.id,
          oauthAccessToken: refreshed.oauthAccessToken,
        });
      }
    }
  } else if (server.sourceType === "publication") {
    accessToken = await resolvePublicationMcpServerAccessToken(db, env, {
      spaceId,
      serverId,
    });
  }

  const client = new McpClient(
    server.url,
    accessToken,
    server.name,
    env.TAKOS_EGRESS,
    { spaceId, mode: "mcp-policy-review" },
    env.ENVIRONMENT === "development",
  );
  const signal = AbortSignal.timeout(30_000);
  try {
    await client.connect(signal);
    return { server, tools: await client.listTools(signal) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logError("MCP tool listing failed", error, { module: "mcp", serverId });
    if (detail.includes("timeout") || detail.includes("Timeout")) {
      throw new GatewayTimeoutError("MCP server connection timed out");
    }
    throw new BadGatewayError("Failed to connect to MCP server");
  } finally {
    await client.close().catch((error) => {
      logWarn("MCP client close failed (non-critical)", {
        module: "mcp",
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

function serializeTool(
  env: Env,
  server: McpServerWithTokens,
  snapshot: McpToolSnapshot,
  policy: McpToolPolicyRecord | undefined,
) {
  const external = server.sourceType === "external";
  const support = getMcpToolSupport(snapshot.tool);
  const matchingPolicy =
    external && policy?.schemaHash === snapshot.schemaHash ? policy : undefined;
  const executionPolicy = deriveMcpToolExecutionPolicy({
    serverId: server.id,
    sourceType: server.sourceType,
    annotations: snapshot.tool.annotations,
    trustedLocalReadonlyServerIds: parseTrustedLocalMcpReadonlyServerIds(
      env.TAKOS_TRUSTED_LOCAL_MCP_READONLY_SERVER_IDS,
    ),
  });

  return {
    name: snapshot.tool.name,
    description: snapshot.tool.description ?? "",
    inputSchema: snapshot.tool.inputSchema,
    annotations: snapshot.tool.annotations ?? null,
    execution: snapshot.tool.execution ?? null,
    supported: support.supported,
    unsupported_reason: support.unsupportedReason,
    enabled: support.supported
      ? external
        ? (matchingPolicy?.enabled ?? false)
        : true
      : false,
    invocation_policy: matchingPolicy?.invocationPolicy ?? "confirm_each_time",
    review_required:
      support.supported && external
        ? !matchingPolicy || matchingPolicy.reviewedAt === null
        : false,
    schema_hash: snapshot.schemaHash,
    policy_read_only: !external,
    reviewed_at: matchingPolicy?.reviewedAt ?? null,
    first_seen_at: matchingPolicy?.firstSeenAt ?? null,
    last_seen_at: matchingPolicy?.lastSeenAt ?? null,
    risk_level: executionPolicy.risk_level,
    side_effects: executionPolicy.side_effects,
  };
}

function selectObservedToolSnapshot(
  snapshots: readonly McpToolSnapshot[],
  toolName: string,
  observedSchemaHash: string,
): McpToolSnapshot {
  const snapshot = snapshots.find((entry) => entry.tool.name === toolName);
  if (!snapshot) throw new NotFoundError("MCP tool");
  if (snapshot.schemaHash !== observedSchemaHash) {
    throw new ConflictError(
      "MCP tool snapshot changed after it was reviewed; refresh the tool list before updating its exposure policy",
    );
  }
  return snapshot;
}

const mcpToolPolicyRoutes = new Hono<SpaceAccessRouteEnv>();

mcpToolPolicyRoutes.get(
  "/servers/:id/tools",
  spaceAccess({ roles: MCP_LIST_ROLES }),
  async (c) => {
    const spaceId = c.get("spaceId");
    const { server, tools } = await listCurrentServerTools(
      c.env.DB,
      c.env,
      spaceId,
      c.req.param("id"),
    );
    const snapshots = await snapshotMcpTools(
      tools.map((entry) => entry.sdkTool),
    );
    let policies = new Map<string, McpToolPolicyRecord>();
    if (server.sourceType === "external") {
      policies = await reconcileExternalMcpToolPolicies(c.env.DB, {
        accountId: spaceId,
        serverId: server.id,
        snapshots,
      });
    }

    return c.json({
      data: {
        tools: snapshots.map((snapshot) =>
          serializeTool(
            c.env,
            server,
            snapshot,
            policies.get(snapshot.tool.name),
          ),
        ),
      },
    });
  },
);

mcpToolPolicyRoutes.patch(
  "/servers/:id/tools/:toolName",
  spaceAccess({ roles: MCP_UPDATE_ROLES }),
  zValidator("json", updateToolPolicySchema),
  async (c) => {
    const spaceId = c.get("spaceId");
    const { server, tools } = await listCurrentServerTools(
      c.env.DB,
      c.env,
      spaceId,
      c.req.param("id"),
    );
    if (server.sourceType !== "external") {
      throw new BadRequestError(
        "Tool exposure policy is read-only for managed MCP servers",
      );
    }

    const snapshots = await snapshotMcpTools(
      tools.map((entry) => entry.sdkTool),
    );
    const body = c.req.valid("json");
    const snapshot = selectObservedToolSnapshot(
      snapshots,
      c.req.param("toolName"),
      body.schema_hash,
    );
    if (body.enabled && !getMcpToolSupport(snapshot.tool).supported) {
      throw new BadRequestError(
        "This MCP tool requires task-based execution, which this Takos runtime does not support yet",
      );
    }

    const policy = await updateExternalMcpToolPolicy(c.env.DB, {
      accountId: spaceId,
      serverId: server.id,
      toolName: snapshot.tool.name,
      schemaHash: body.schema_hash,
      enabled: body.enabled,
      invocationPolicy: body.invocation_policy,
    });
    if (!policy) {
      throw new ConflictError(
        "MCP tool snapshot is new or changed; refresh the tool list before updating its exposure policy",
      );
    }

    return c.json({
      data: serializeTool(c.env, server, snapshot, policy),
    });
  },
);

export {
  selectObservedToolSnapshot,
  serializeTool as serializeMcpToolPolicyView,
};
export default mcpToolPolicyRoutes;
