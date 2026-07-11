import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { accounts } from "./schema-accounts.ts";
import { mcpServers } from "./schema-oauth.ts";
import { timestamps } from "./schema-utils.ts";

/**
 * User-reviewed exposure snapshots for tools advertised by external MCP
 * connections. The server FK deliberately excludes virtual publication IDs;
 * application logic additionally requires the referenced row to have
 * `source_type = external`.
 */
export const mcpToolPolicies = sqliteTable(
  "mcp_tool_policies",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    serverId: text("server_id")
      .notNull()
      .references(() => mcpServers.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    toolName: text("tool_name").notNull(),
    schemaHash: text("schema_hash").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    invocationPolicy: text("invocation_policy")
      .notNull()
      .default("confirm_each_time"),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    reviewedAt: text("reviewed_at"),
  },
  (table) => ({
    uniqAccountServerTool: uniqueIndex(
      "idx_mcp_tool_policies_account_server_tool",
    ).on(table.accountId, table.serverId, table.toolName),
    idxAccountServerEnabled: index(
      "idx_mcp_tool_policies_account_server_enabled",
    ).on(table.accountId, table.serverId, table.enabled),
  }),
);

/**
 * One-time user decisions for an exact MCP tool invocation.
 *
 * Arguments are encrypted before storage. A keyed argument identity is used
 * only to match a short-lived approval to the same Workspace, user, server,
 * tool, reviewed schema, and canonical arguments on a later retry. `serverId`
 * is an ownership-scoped identity rather than a foreign key because
 * Capsule-published MCP servers use virtual `publication:<id>` identities and
 * do not have an `mcp_servers` row.
 */
export const mcpToolConfirmations = sqliteTable(
  "mcp_tool_confirmations",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: text("user_id")
      .notNull()
      .references(() => accounts.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    serverId: text("server_id").notNull(),
    serverName: text("server_name").notNull(),
    toolName: text("tool_name").notNull(),
    schemaHash: text("schema_hash").notNull(),
    argumentsHash: text("arguments_hash").notNull(),
    argumentsCiphertext: text("arguments_ciphertext").notNull(),
    requestedRunId: text("requested_run_id").notNull(),
    requestedThreadId: text("requested_thread_id").notNull(),
    consumedRunId: text("consumed_run_id"),
    status: text("status").notNull().default("pending"),
    expiresAt: text("expires_at").notNull(),
    decidedAt: text("decided_at"),
    consumedAt: text("consumed_at"),
    ...timestamps,
  },
  (table) => ({
    idxAccountUserStatusExpiry: index(
      "idx_mcp_tool_confirmations_account_user_status_expiry",
    ).on(table.accountId, table.userId, table.status, table.expiresAt),
    idxInvocationMatch: index("idx_mcp_tool_confirmations_invocation_match").on(
      table.accountId,
      table.userId,
      table.serverId,
      table.toolName,
      table.schemaHash,
      table.argumentsHash,
    ),
  }),
);
