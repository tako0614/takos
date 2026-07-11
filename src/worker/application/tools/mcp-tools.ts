import type { RegisteredTool, ToolDefinition } from "./tool-definitions.ts";
import type { Env, SpaceRole } from "../../shared/types/index.ts";
import { getDb, mcpServers, mcpToolPolicies } from "../../infra/db/index.ts";
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
import type { SqlDatabaseBinding } from "../../shared/types/bindings.ts";
import type { Database } from "../../infra/db/index.ts";
import { logError } from "../../shared/utils/logger.ts";
import {
  isPublicationType,
  listPublications,
  publicationResolvedUrl,
  RUNTIME_PROJECTION_CAPABILITIES,
} from "../services/platform/service-publications.ts";
import { combineSignals } from "@takos/worker-platform-utils/abort";
import {
  fingerprintMcpTool,
  getMcpToolSupport,
  isMcpToolSnapshotEnabled,
  listMcpToolPolicies,
  type McpToolPolicyRecord,
} from "../services/platform/mcp/tool-policy.ts";
import { computeSHA256 } from "../../shared/utils/hash.ts";
import { requireMcpToolInvocationConfirmation } from "../services/platform/mcp/tool-confirmation.ts";

export interface McpLoadResult {
  tools: Map<string, RegisteredTool>;
  failedServers: string[];
}

const MCP_CATALOG_TIMEOUT_MS = 20_000;
const MCP_CATALOG_CONCURRENCY = 8;
const MAX_MCP_SERVERS_PER_RUN = 64;
const MAX_MCP_RUNTIME_TOOLS = 2_048;
const MAX_MCP_RUNTIME_CATALOG_BYTES = 8 * 1024 * 1024;

function runtimeCatalogEntryBytes(
  sdkTool: unknown,
  definition: ToolDefinition,
): number {
  return new TextEncoder().encode(JSON.stringify({ sdkTool, definition }))
    .byteLength;
}

interface McpServerLoadRecord {
  id: string;
  accountId: string;
  name: string;
  url: string;
  sourceType: string;
  authMode: string;
  serviceId: string | null;
  bundleDeploymentId: string | null;
  oauthAccessToken: string | null;
  oauthRefreshToken: string | null;
  oauthIssuerUrl: string | null;
  oauthClientId: string | null;
  oauthClientSecret: string | null;
  oauthTokenEndpointAuthMethod: string | null;
  oauthResourceUri: string | null;
  oauthTokenExpiresAt: string | Date | null;
  authSecretRef?: string | null;
}

type LoadedMcpServerCatalog = {
  mcpTools: Awaited<ReturnType<McpClient["listTools"]>>;
  externalPolicies: Map<string, McpToolPolicyRecord> | null;
};

export function parseTrustedLocalMcpReadonlyServerIds(
  raw: string | undefined,
): ReadonlySet<string> {
  if (!raw?.trim()) return new Set();
  let values: unknown = raw.split(",");
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    values = parsed;
  } catch {
    // Comma-separated operator configuration remains supported.
  }
  if (!Array.isArray(values)) return new Set();
  return new Set(
    values
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0 && value.length <= 256)
      .slice(0, 256),
  );
}

export function deriveMcpToolExecutionPolicy(input: {
  serverId: string;
  sourceType: string;
  annotations?: ToolDefinition["annotations"];
  trustedLocalReadonlyServerIds?: ReadonlySet<string>;
}): Pick<ToolDefinition, "risk_level" | "side_effects"> {
  const explicitlyTrustedLocal =
    input.sourceType !== "external" &&
    input.trustedLocalReadonlyServerIds?.has(input.serverId) === true;
  const trustedReadOnly =
    explicitlyTrustedLocal &&
    input.annotations?.readOnlyHint === true &&
    input.annotations?.destructiveHint !== true;

  return {
    risk_level:
      input.annotations?.destructiveHint === true
        ? "high"
        : input.sourceType === "external"
          ? "medium"
          : "low",
    // MCP annotations are server assertions, not a security boundary. Every
    // tool is de-duplicated by default; only an operator-allowlisted local MCP
    // server may opt a read-only tool out of the side-effect path.
    side_effects: !trustedReadOnly,
  };
}

/**
 * Decide whether a single MCP invocation needs an explicit user decision.
 *
 * External connections retain their reviewed invocation policy. A destructive
 * annotation or a high-risk runtime classification always wins over
 * `automatic`, including for managed local and Capsule-published MCP servers.
 * Server annotations are untrusted, so they may raise the guard but can never
 * lower Takos's derived risk classification.
 */
export function requiresMcpToolInvocationConfirmation(input: {
  sourceType: string;
  invocationPolicy: McpToolPolicyRecord["invocationPolicy"];
  riskLevel: ToolDefinition["risk_level"];
  annotations?: ToolDefinition["annotations"];
}): boolean {
  if (
    input.riskLevel === "high" ||
    input.annotations?.destructiveHint === true
  ) {
    return true;
  }
  return (
    input.sourceType === "external" &&
    input.invocationPolicy === "confirm_each_time"
  );
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

/**
 * Revalidate a managed/local MCP tool immediately before consuming a high-risk
 * confirmation. A changed catalog snapshot must request a fresh decision
 * rather than inheriting approval for different code or arguments.
 */
export async function assertMcpToolRuntimeSnapshotStillMatches(params: {
  toolName: string;
  expectedSchemaHash: string;
  client: Pick<McpClient, "listTools">;
  signal?: AbortSignal;
}): Promise<void> {
  const currentTools = await params.client.listTools(params.signal);
  const currentMatches = currentTools.filter(
    ({ sdkTool }) => sdkTool.name === params.toolName,
  );
  if (currentMatches.length !== 1) {
    throw new Error(
      `MCP tool "${params.toolName}" is no longer available; refresh the runtime tool catalog`,
    );
  }
  const currentSchemaHash = await fingerprintMcpTool(
    currentMatches[0]!.sdkTool,
  );
  if (currentSchemaHash !== params.expectedSchemaHash) {
    throw new Error(
      `MCP tool "${params.toolName}" changed after catalog discovery; review its current snapshot before running it`,
    );
  }
}

/**
 * Fail closed if an external tool's reviewed snapshot or its parent connection
 * changed after this run's resolver was initialized. The live tools/list check
 * happens before the final joined DB read so a disable/delete/policy update is
 * observed as close as possible to callTool without holding a DB transaction
 * across an outbound request.
 */
export async function assertExternalMcpToolExecutionStillApproved(
  drizzle: Database,
  params: {
    spaceId: string;
    serverId: string;
    serverUrl: string;
    toolName: string;
    approvedSchemaHash: string;
    client: Pick<McpClient, "listTools">;
    signal?: AbortSignal;
  },
): Promise<void> {
  const currentTools = await params.client.listTools(params.signal);
  const currentMatches = currentTools.filter(
    ({ sdkTool }) => sdkTool.name === params.toolName,
  );
  if (currentMatches.length !== 1) {
    throw new Error(
      `MCP tool "${params.toolName}" is no longer approved; refresh the connection tool list`,
    );
  }

  const currentSchemaHash = await fingerprintMcpTool(
    currentMatches[0]!.sdkTool,
  );
  if (currentSchemaHash !== params.approvedSchemaHash) {
    throw new Error(
      `MCP tool "${params.toolName}" changed after approval; review its current snapshot before running it`,
    );
  }

  const approval = await drizzle
    .select({ serverId: mcpServers.id })
    .from(mcpServers)
    .innerJoin(
      mcpToolPolicies,
      and(
        eq(mcpToolPolicies.accountId, mcpServers.accountId),
        eq(mcpToolPolicies.serverId, mcpServers.id),
      ),
    )
    .where(
      and(
        eq(mcpServers.id, params.serverId),
        eq(mcpServers.accountId, params.spaceId),
        eq(mcpServers.sourceType, "external"),
        eq(mcpServers.enabled, true),
        eq(mcpServers.url, params.serverUrl),
        eq(mcpToolPolicies.toolName, params.toolName),
        eq(mcpToolPolicies.schemaHash, params.approvedSchemaHash),
        eq(mcpToolPolicies.enabled, true),
      ),
    )
    .get();
  if (!approval) {
    throw new Error(
      `MCP tool "${params.toolName}" or its connection is no longer enabled`,
    );
  }
}

/** Load MCP server tools, handling token refresh and namespace collisions. */
export async function loadMcpTools(
  db: SqlDatabaseBinding,
  spaceId: string,
  env: Env,
  existingNames: Set<string>,
  exposureContext?: { role?: SpaceRole; capabilities?: string[] },
): Promise<McpLoadResult> {
  const tools = new Map<string, RegisteredTool>();
  const failedServers: string[] = [];
  const drizzle = getDb(db);

  let servers: McpServerLoadRecord[];

  try {
    const storedServers = await drizzle
      .select({
        id: mcpServers.id,
        accountId: mcpServers.accountId,
        name: mcpServers.name,
        url: mcpServers.url,
        sourceType: mcpServers.sourceType,
        authMode: mcpServers.authMode,
        serviceId: mcpServers.serviceId,
        bundleDeploymentId: mcpServers.bundleDeploymentId,
        oauthAccessToken: mcpServers.oauthAccessToken,
        oauthRefreshToken: mcpServers.oauthRefreshToken,
        oauthIssuerUrl: mcpServers.oauthIssuerUrl,
        oauthClientId: mcpServers.oauthClientId,
        oauthClientSecret: mcpServers.oauthClientSecret,
        oauthTokenEndpointAuthMethod: mcpServers.oauthTokenEndpointAuthMethod,
        oauthResourceUri: mcpServers.oauthResourceUri,
        oauthTokenExpiresAt: mcpServers.oauthTokenExpiresAt,
      })
      .from(mcpServers)
      .where(
        and(eq(mcpServers.accountId, spaceId), eq(mcpServers.enabled, true)),
      )
      .all()
      .then((rows) => rows as McpServerLoadRecord[]);
    const publicationServers = (await listPublications({ DB: db }, spaceId))
      .filter((record) =>
        isPublicationType(
          record.publicationType,
          RUNTIME_PROJECTION_CAPABILITIES.mcpServer,
        ),
      )
      .map((record): McpServerLoadRecord | null => {
        const url = publicationResolvedUrl(record);
        if (!url) return null;
        const authSecretRef = readPublicationAuthSecretRef(record);
        return {
          id: `publication:${record.id}`,
          accountId: spaceId,
          name: record.name,
          url,
          sourceType: "publication",
          authMode: authSecretRef ? "bearer_token" : "takos_oidc",
          serviceId: record.ownerServiceId,
          bundleDeploymentId: null,
          oauthAccessToken: null,
          oauthRefreshToken: null,
          oauthIssuerUrl: null,
          oauthClientId: null,
          oauthClientSecret: null,
          oauthTokenEndpointAuthMethod: null,
          oauthResourceUri: null,
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
    return { tools, failedServers };
  }

  // Deterministic and contract-aligned ordering:
  // Takos custom tools are resolved first, then Capsule-projected MCP, then external MCP.
  servers.sort((a, b) => {
    const sourceRank = (sourceType: string) =>
      sourceType === "external" ? 1 : 0;
    const rankDiff = sourceRank(a.sourceType) - sourceRank(b.sourceType);
    if (rankDiff !== 0) return rankDiff;
    const nameDiff = a.name.localeCompare(b.name);
    if (nameDiff !== 0) return nameDiff;
    return a.id.localeCompare(b.id);
  });
  if (servers.length > MAX_MCP_SERVERS_PER_RUN) {
    for (const server of servers.slice(MAX_MCP_SERVERS_PER_RUN)) {
      failedServers.push(`${server.name} (server limit exceeded)`);
    }
    servers = servers.slice(0, MAX_MCP_SERVERS_PER_RUN);
  }

  const urlOptions = getMcpEndpointUrlOptions(env);
  const trustedLocalReadonlyServerIds = parseTrustedLocalMcpReadonlyServerIds(
    env.TAKOS_TRUSTED_LOCAL_MCP_READONLY_SERVER_IDS,
  );
  let runtimeCatalogBytes = 0;

  const serverIsEligible = (server: McpServerLoadRecord): boolean => {
    if (
      exposureContext?.role &&
      !DYNAMIC_MCP_ALLOWED_ROLES.has(exposureContext.role)
    ) {
      return false;
    }
    if (server.sourceType === "external") {
      const capabilities = new Set(exposureContext?.capabilities || []);
      if (exposureContext && !capabilities.has("egress.http")) return false;
    }
    return true;
  };

  // One aggregate deadline prevents N enabled connectors from multiplying Run
  // startup latency. Fetch independent catalogs concurrently with a small
  // fixed worker pool; failures remain per-server and do not hide healthy
  // tools. Live external approval is still revalidated immediately before a
  // selected tool executes.
  const eligibleServers = servers.filter(serverIsEligible);
  const catalogSignal = AbortSignal.timeout(MCP_CATALOG_TIMEOUT_MS);
  const loadedCatalogs = new Map<McpServerLoadRecord, LoadedMcpServerCatalog>();
  const catalogErrors = new Map<McpServerLoadRecord, unknown>();
  let nextServerIndex = 0;
  await Promise.all(
    Array.from(
      {
        length: Math.min(MCP_CATALOG_CONCURRENCY, eligibleServers.length),
      },
      async () => {
        while (true) {
          const index = nextServerIndex++;
          const server = eligibleServers[index];
          if (!server) return;
          try {
            assertAllowedMcpEndpointUrl(server.url, urlOptions, "MCP server");
            const client = await createLoadClient(
              db,
              env,
              spaceId,
              drizzle,
              server,
              catalogSignal,
            );
            let mcpTools: Awaited<ReturnType<McpClient["listTools"]>>;
            try {
              mcpTools = await client.listTools(catalogSignal);
            } finally {
              await client.close().catch((error) => {
                logError(
                  "MCP catalog client close failed (non-critical)",
                  error,
                  {
                    module: "mcp",
                  },
                );
              });
            }
            const externalPolicies =
              server.sourceType === "external"
                ? new Map(
                    (await listMcpToolPolicies(db, spaceId, server.id)).map(
                      (policy) => [policy.toolName, policy],
                    ),
                  )
                : null;
            loadedCatalogs.set(server, { mcpTools, externalPolicies });
          } catch (error) {
            catalogErrors.set(server, error);
          }
        }
      },
    ),
  );
  for (const server of eligibleServers) {
    const error = catalogErrors.get(server);
    if (!error) continue;
    logError(`Failed to load tools from server "${server.name}"`, error, {
      module: "mcp",
    });
    failedServers.push(server.name);
  }

  for (const server of servers) {
    if (!serverIsEligible(server)) continue;
    const loaded = loadedCatalogs.get(server);
    if (!loaded) continue;

    try {
      const { mcpTools, externalPolicies } = loaded;
      const stagedTools = new Map<string, RegisteredTool>();
      const reservedNames = new Set(existingNames);
      let stagedCatalogBytes = 0;

      for (const { sdkTool, definition } of mcpTools) {
        // The current runtime owns synchronous tools/call only. Do not expose
        // a required MCP Task as if it were a synchronous tool: doing so would
        // let the model select an operation that this run cannot recover or
        // cancel correctly.
        if (!getMcpToolSupport(sdkTool).supported) {
          continue;
        }
        const runtimeSchemaHash = await fingerprintMcpTool(sdkTool);
        let approvedExternalSchemaHash: string | null = null;
        let externalInvocationPolicy: McpToolPolicyRecord["invocationPolicy"] =
          "confirm_each_time";
        if (externalPolicies) {
          const externalPolicy = externalPolicies.get(sdkTool.name);
          if (!isMcpToolSnapshotEnabled(externalPolicy, runtimeSchemaHash)) {
            continue;
          }
          approvedExternalSchemaHash = runtimeSchemaHash;
          externalInvocationPolicy =
            externalPolicy?.invocationPolicy ?? "confirm_each_time";
        }
        const exposedName = await chooseMcpToolExposureName(reservedNames, {
          serverName: server.name,
          serverId: server.id,
          toolName: definition.name,
        });
        reservedNames.add(exposedName);

        const executionPolicy = deriveMcpToolExecutionPolicy({
          serverId: server.id,
          sourceType: server.sourceType,
          annotations: definition.annotations,
          trustedLocalReadonlyServerIds,
        });
        const namespacedDef: ToolDefinition = {
          ...definition,
          namespace: "mcp",
          family: `mcp.${sanitizeMcpToolNamespace(server.name || server.id)}`,
          ...executionPolicy,
          name: exposedName,
        };
        namespacedDef.required_roles = Array.from(DYNAMIC_MCP_ALLOWED_ROLES);
        if (server.sourceType === "external") {
          namespacedDef.required_capabilities = ["egress.http"];
        }
        const invocationNeedsConfirmation =
          requiresMcpToolInvocationConfirmation({
            sourceType: server.sourceType,
            invocationPolicy: externalInvocationPolicy,
            riskLevel: namespacedDef.risk_level,
            annotations: namespacedDef.annotations,
          });
        const entryBytes = runtimeCatalogEntryBytes(sdkTool, namespacedDef);
        if (
          tools.size + stagedTools.size >= MAX_MCP_RUNTIME_TOOLS ||
          runtimeCatalogBytes + stagedCatalogBytes + entryBytes >
            MAX_MCP_RUNTIME_CATALOG_BYTES
        ) {
          throw new Error(
            `Workspace MCP runtime catalog exceeds ${MAX_MCP_RUNTIME_TOOLS} tools or ${MAX_MCP_RUNTIME_CATALOG_BYTES} bytes`,
          );
        }
        const sdkToolName = sdkTool.name;

        stagedTools.set(exposedName, {
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
              ? combineSignals(ctx.abortSignal, timeoutController.signal)
              : timeoutController.signal;

            try {
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
                env.TAKOS_EGRESS,
                {
                  spaceId: ctx.spaceId,
                  runId: ctx.runId,
                  mode: "mcp-tool",
                },
                env.ENVIRONMENT === "development",
              );
              await callClient.connect(signal);
              try {
                if (server.sourceType === "external") {
                  if (!approvedExternalSchemaHash) {
                    throw new Error(
                      `MCP tool "${sdkToolName}" has no approved snapshot`,
                    );
                  }
                  await assertExternalMcpToolExecutionStillApproved(drizzle, {
                    spaceId,
                    serverId: server.id,
                    serverUrl: server.url,
                    toolName: sdkToolName,
                    approvedSchemaHash: approvedExternalSchemaHash,
                    client: callClient,
                    signal,
                  });
                } else if (invocationNeedsConfirmation) {
                  await assertMcpToolRuntimeSnapshotStillMatches({
                    toolName: sdkToolName,
                    expectedSchemaHash: runtimeSchemaHash,
                    client: callClient,
                    signal,
                  });
                }

                // Revalidate the live schema/policy before consuming a
                // one-time approval. A stale catalog must not burn the user's
                // decision without attempting the reviewed operation.
                if (invocationNeedsConfirmation) {
                  const confirmation =
                    await requireMcpToolInvocationConfirmation(db, env, {
                      accountId: spaceId,
                      userId: ctx.userId,
                      serverId: server.id,
                      serverName: server.name,
                      toolName: sdkToolName,
                      schemaHash: runtimeSchemaHash,
                      arguments: args,
                      runId: ctx.runId,
                      threadId: ctx.threadId,
                    });
                  if (confirmation.kind === "denied") {
                    throw new Error(
                      `MCP tool invocation denied by the user (confirmation ${confirmation.confirmationId})`,
                    );
                  }
                  if (confirmation.kind === "pending") {
                    throw new Error(
                      `MCP tool invocation requires one-time user confirmation ${confirmation.confirmationId}. Ask the user to approve it in Takos, then retry the exact call.`,
                    );
                  }
                }
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
        stagedCatalogBytes += entryBytes;
      }
      for (const [name, tool] of stagedTools) {
        tools.set(name, tool);
        existingNames.add(name);
      }
      runtimeCatalogBytes += stagedCatalogBytes;
    } catch (err) {
      logError(`Failed to load tools from server "${server.name}"`, err, {
        module: "mcp",
      });
      failedServers.push(server.name);
    }
  }

  return { tools, failedServers };
}

function sanitizeMcpToolNamespace(value: string): string {
  return (
    value
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "") || "tool"
  );
}

const PROVIDER_TOOL_NAME_MAX_LENGTH = 64;
const PROVIDER_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

function boundedHashedToolName(base: string, digest: string): string {
  const suffix = `__${digest.slice(0, 12)}`;
  return `${base.slice(0, PROVIDER_TOOL_NAME_MAX_LENGTH - suffix.length)}${suffix}`;
}

/**
 * Map an MCP name onto the OpenAI-compatible function-name contract without
 * losing the raw SDK name used for the actual call. Valid unique names stay
 * readable. Invalid, overlong, or colliding names receive a stable
 * server/tool hash so one connector cannot make the whole model request
 * invalid or silently shadow an existing tool.
 */
export async function chooseMcpToolExposureName(
  existingNames: Set<string>,
  input: { serverName: string; serverId: string; toolName: string },
): Promise<string> {
  if (
    PROVIDER_TOOL_NAME_PATTERN.test(input.toolName) &&
    !existingNames.has(input.toolName)
  ) {
    return input.toolName;
  }

  const server = sanitizeMcpToolNamespace(input.serverName || input.serverId);
  const tool = sanitizeMcpToolNamespace(input.toolName);
  const digest = await computeSHA256(
    `${input.serverId}\u0000${input.toolName}`,
  );
  const candidate = boundedHashedToolName(`${server}__${tool}`, digest);
  if (!existingNames.has(candidate)) return candidate;

  // A 48-bit prefix collision is exceptionally unlikely. The bounded counter
  // keeps the uniqueness guarantee total even under adversarial inputs.
  let counter = 2;
  while (true) {
    const suffix = `__${counter}`;
    const counted = `${candidate.slice(0, PROVIDER_TOOL_NAME_MAX_LENGTH - suffix.length)}${suffix}`;
    if (!existingNames.has(counted)) return counted;
    counter++;
  }
}

async function createLoadClient(
  db: SqlDatabaseBinding,
  env: Env,
  spaceId: string,
  drizzle: Database,
  server: McpServerLoadRecord,
  signal: AbortSignal,
): Promise<McpClient> {
  const accessToken = await resolveMcpAccessToken(
    db,
    env,
    spaceId,
    drizzle,
    server,
  );
  const client = new McpClient(
    server.url,
    accessToken,
    server.name,
    env.TAKOS_EGRESS,
    { spaceId, mode: "mcp-catalog" },
    env.ENVIRONMENT === "development",
  );
  await client.connect(signal);
  return client;
}

async function resolveMcpAccessToken(
  db: SqlDatabaseBinding,
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
  const freshRow = await drizzle
    .select({
      oauthAccessToken: mcpServers.oauthAccessToken,
    })
    .from(mcpServers)
    .where(eq(mcpServers.id, server.id))
    .get();
  const tokenSource = freshRow?.oauthAccessToken
    ? { ...server, oauthAccessToken: freshRow.oauthAccessToken }
    : server;
  return await decryptAccessToken(db, env, tokenSource);
}

/** Refresh the OAuth token if it expires within 5 minutes. */
async function refreshTokenIfNeeded(
  db: SqlDatabaseBinding,
  env: Env,
  drizzle: Database,
  server: McpServerLoadRecord,
): Promise<void> {
  if (!server.oauthTokenExpiresAt) return;

  const expiresAt =
    typeof server.oauthTokenExpiresAt === "string"
      ? new Date(server.oauthTokenExpiresAt)
      : server.oauthTokenExpiresAt;
  const fiveMinutes = 5 * 60 * 1000;

  if (expiresAt.getTime() - Date.now() >= fiveMinutes) return;

  await refreshMcpToken(db, env, server);

  const updated = await drizzle
    .select({
      oauthAccessToken: mcpServers.oauthAccessToken,
    })
    .from(mcpServers)
    .where(eq(mcpServers.id, server.id))
    .get();
  if (updated) {
    server.oauthAccessToken = updated.oauthAccessToken;
  }
}
