import { and, asc, eq } from "drizzle-orm";
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import {
  getDb,
  mcpServers,
  mcpToolPolicies,
  type SqlDatabaseLike,
} from "../../../../infra/db/index.ts";
import type { SelectOf } from "../../../../shared/types/drizzle-utils.ts";
import { NotFoundError } from "@takos/worker-platform-utils/errors";

export interface McpToolPolicyRecord {
  accountId: string;
  serverId: string;
  toolName: string;
  schemaHash: string;
  enabled: boolean;
  invocationPolicy: McpToolInvocationPolicy;
  firstSeenAt: string;
  lastSeenAt: string;
  reviewedAt: string | null;
}

export type McpToolInvocationPolicy = "automatic" | "confirm_each_time";

export interface McpToolSnapshot {
  tool: McpTool;
  schemaHash: string;
}

export type McpToolSupport =
  | { supported: true; unsupportedReason: null }
  | {
      supported: false;
      unsupportedReason: "task_execution_required";
    };

/**
 * Takos currently executes MCP tools synchronously through tools/call.
 * A server that requires the MCP Tasks extension must therefore remain
 * unexposed until the runtime owns task creation, polling, cancellation, and
 * terminal-result recovery end to end.
 */
export function getMcpToolSupport(tool: McpTool): McpToolSupport {
  if (tool.execution?.taskSupport === "required") {
    return {
      supported: false,
      unsupportedReason: "task_execution_required",
    };
  }
  return { supported: true, unsupportedReason: null };
}

function mapPolicy(row: SelectOf<typeof mcpToolPolicies>): McpToolPolicyRecord {
  return {
    accountId: row.accountId,
    serverId: row.serverId,
    toolName: row.toolName,
    schemaHash: row.schemaHash,
    enabled: row.enabled,
    invocationPolicy:
      row.invocationPolicy === "automatic" ? "automatic" : "confirm_each_time",
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    reviewedAt: row.reviewedAt,
  };
}

/**
 * Canonical JSON used only for tool snapshot hashing. Object keys are sorted;
 * array order remains significant. MCP tools are already JSON-decoded values,
 * so unsupported JavaScript-only values are rejected rather than coerced.
 */
export function canonicalMcpJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("MCP tool snapshot contains a non-finite number");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalMcpJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalMcpJson(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new TypeError("MCP tool snapshot contains a non-JSON value");
}

/**
 * Fingerprint exactly the fields Takos currently exposes to the model or uses
 * for execution policy. Changes to descriptive text, accepted input, or MCP
 * behavior annotations, declared output, or execution contract therefore
 * require a fresh exposure review. SDK-only display metadata such as remote
 * icons is deliberately excluded.
 */
export async function fingerprintMcpTool(tool: McpTool): Promise<string> {
  const canonical = canonicalMcpJson({
    fingerprintVersion: 2,
    name: tool.name,
    description: tool.description ?? "",
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema ?? null,
    annotations: tool.annotations ?? null,
    execution: tool.execution ?? null,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function snapshotMcpTools(
  tools: readonly McpTool[],
): Promise<McpToolSnapshot[]> {
  const names = new Set<string>();
  const snapshots: McpToolSnapshot[] = [];
  for (const tool of tools) {
    if (names.has(tool.name)) {
      throw new Error(
        `MCP server advertised duplicate tool name "${tool.name}"`,
      );
    }
    names.add(tool.name);
    snapshots.push({ tool, schemaHash: await fingerprintMcpTool(tool) });
  }
  return snapshots;
}

async function assertExternalServerInWorkspace(
  dbBinding: SqlDatabaseLike,
  accountId: string,
  serverId: string,
): Promise<void> {
  const db = getDb(dbBinding);
  const server = await db
    .select({ id: mcpServers.id })
    .from(mcpServers)
    .where(
      and(
        eq(mcpServers.id, serverId),
        eq(mcpServers.accountId, accountId),
        eq(mcpServers.sourceType, "external"),
      ),
    )
    .get();
  if (!server) throw new NotFoundError("External MCP server");
}

export async function listMcpToolPolicies(
  dbBinding: SqlDatabaseLike,
  accountId: string,
  serverId: string,
): Promise<McpToolPolicyRecord[]> {
  const rows = await getDb(dbBinding)
    .select()
    .from(mcpToolPolicies)
    .where(
      and(
        eq(mcpToolPolicies.accountId, accountId),
        eq(mcpToolPolicies.serverId, serverId),
      ),
    )
    .orderBy(asc(mcpToolPolicies.toolName))
    .all();
  return rows.map(mapPolicy);
}

/**
 * Reconcile a tools/list response for a real external connection.
 *
 * New and changed snapshots are always written disabled and unreviewed.
 * Unchanged snapshots retain both the user's enabled choice and reviewed_at.
 * Removed tools are retained as historical rows but cannot be exposed because
 * neither the route nor the loader sees them in the current tools/list result.
 */
export async function reconcileExternalMcpToolPolicies(
  dbBinding: SqlDatabaseLike,
  params: {
    accountId: string;
    serverId: string;
    snapshots: readonly McpToolSnapshot[];
    observedAt?: string;
  },
): Promise<Map<string, McpToolPolicyRecord>> {
  await assertExternalServerInWorkspace(
    dbBinding,
    params.accountId,
    params.serverId,
  );
  const db = getDb(dbBinding);
  const observedAt = params.observedAt ?? new Date().toISOString();
  const existing = new Map(
    (
      await listMcpToolPolicies(dbBinding, params.accountId, params.serverId)
    ).map((policy) => [policy.toolName, policy]),
  );

  for (const snapshot of params.snapshots) {
    const policy = existing.get(snapshot.tool.name);
    if (!policy) {
      await db
        .insert(mcpToolPolicies)
        .values({
          accountId: params.accountId,
          serverId: params.serverId,
          toolName: snapshot.tool.name,
          schemaHash: snapshot.schemaHash,
          enabled: false,
          invocationPolicy: "confirm_each_time",
          firstSeenAt: observedAt,
          lastSeenAt: observedAt,
          reviewedAt: null,
        })
        .onConflictDoNothing({
          target: [
            mcpToolPolicies.accountId,
            mcpToolPolicies.serverId,
            mcpToolPolicies.toolName,
          ],
        });
      continue;
    }

    if (policy.schemaHash === snapshot.schemaHash) {
      await db
        .update(mcpToolPolicies)
        .set({ lastSeenAt: observedAt })
        .where(
          and(
            eq(mcpToolPolicies.accountId, params.accountId),
            eq(mcpToolPolicies.serverId, params.serverId),
            eq(mcpToolPolicies.toolName, snapshot.tool.name),
            eq(mcpToolPolicies.schemaHash, snapshot.schemaHash),
          ),
        );
      continue;
    }

    await db
      .update(mcpToolPolicies)
      .set({
        schemaHash: snapshot.schemaHash,
        enabled: false,
        invocationPolicy: "confirm_each_time",
        lastSeenAt: observedAt,
        reviewedAt: null,
      })
      .where(
        and(
          eq(mcpToolPolicies.accountId, params.accountId),
          eq(mcpToolPolicies.serverId, params.serverId),
          eq(mcpToolPolicies.toolName, snapshot.tool.name),
        ),
      );
  }

  const current = await listMcpToolPolicies(
    dbBinding,
    params.accountId,
    params.serverId,
  );
  return new Map(current.map((policy) => [policy.toolName, policy]));
}

/**
 * Record a user's exposure choice only when it targets the exact currently
 * observed snapshot. Missing or stale snapshots return null; callers must
 * obtain a fresh tools/list view before reviewing the changed tool.
 */
export async function updateExternalMcpToolPolicy(
  dbBinding: SqlDatabaseLike,
  params: {
    accountId: string;
    serverId: string;
    toolName: string;
    schemaHash: string;
    enabled: boolean;
    invocationPolicy: McpToolInvocationPolicy;
    reviewedAt?: string;
  },
): Promise<McpToolPolicyRecord | null> {
  await assertExternalServerInWorkspace(
    dbBinding,
    params.accountId,
    params.serverId,
  );
  const db = getDb(dbBinding);
  const reviewedAt = params.reviewedAt ?? new Date().toISOString();
  const exactSnapshot = await db
    .select({ schemaHash: mcpToolPolicies.schemaHash })
    .from(mcpToolPolicies)
    .where(
      and(
        eq(mcpToolPolicies.accountId, params.accountId),
        eq(mcpToolPolicies.serverId, params.serverId),
        eq(mcpToolPolicies.toolName, params.toolName),
        eq(mcpToolPolicies.schemaHash, params.schemaHash),
      ),
    )
    .get();
  if (!exactSnapshot) return null;

  await db
    .update(mcpToolPolicies)
    .set({
      enabled: params.enabled,
      invocationPolicy: params.invocationPolicy,
      reviewedAt,
      lastSeenAt: reviewedAt,
    })
    .where(
      and(
        eq(mcpToolPolicies.accountId, params.accountId),
        eq(mcpToolPolicies.serverId, params.serverId),
        eq(mcpToolPolicies.toolName, params.toolName),
        eq(mcpToolPolicies.schemaHash, params.schemaHash),
      ),
    );

  const updated = await db
    .select()
    .from(mcpToolPolicies)
    .where(
      and(
        eq(mcpToolPolicies.accountId, params.accountId),
        eq(mcpToolPolicies.serverId, params.serverId),
        eq(mcpToolPolicies.toolName, params.toolName),
        eq(mcpToolPolicies.schemaHash, params.schemaHash),
      ),
    )
    .get();
  return updated ? mapPolicy(updated) : null;
}

export function isMcpToolSnapshotEnabled(
  policy: McpToolPolicyRecord | undefined,
  schemaHash: string,
): boolean {
  return policy?.enabled === true && policy.schemaHash === schemaHash;
}
