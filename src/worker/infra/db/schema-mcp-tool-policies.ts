import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { accounts } from "./schema-accounts.ts";
import { runs, threads } from "./schema-agents.ts";
import { mcpServers } from "./schema-oauth.ts";
import { createdAtColumn, timestamps } from "./schema-utils.ts";

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
 * Arguments are encrypted before storage. The keyed argument digest becomes
 * one input to the exact origin identity below; an approval is consumable only
 * after an explicit one-Run claim. `serverId` is an ownership-scoped identity
 * rather than a foreign key because
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

/**
 * Immutable origin identity for a confirmation request.
 *
 * Legacy confirmation rows intentionally have no identity row and therefore
 * cannot authorize a Run. The keyed identity hash binds the encrypted argument
 * digest to the exact origin Run revision and model-issued tool-call identity.
 */
export const mcpToolConfirmationIdentities = sqliteTable(
  "mcp_tool_confirmation_identities",
  {
    confirmationId: text("confirmation_id")
      .primaryKey()
      .references(() => mcpToolConfirmations.id, { onDelete: "cascade" }),
    identityVersion: integer("identity_version").notNull().default(1),
    principalId: text("principal_id")
      .notNull()
      .references(() => accounts.id),
    requestedRunId: text("requested_run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    requestedThreadId: text("requested_thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    runContextRevision: integer("run_context_revision").notNull(),
    runContextDigest: text("run_context_digest").notNull(),
    runGrantDigest: text("run_grant_digest").notNull(),
    identityExtensionVersion: integer("identity_extension_version"),
    activeContextRevision: integer("active_context_revision"),
    activeContextDigest: text("active_context_digest"),
    requestedToolCallId: text("requested_tool_call_id").notNull(),
    identityHash: text("identity_hash").notNull(),
    ...createdAtColumn,
  },
  (table) => ({
    uniqIdentityHash: uniqueIndex(
      "idx_mcp_tool_confirmation_identities_identity_hash",
    ).on(table.identityHash),
    idxOriginRun: index(
      "idx_mcp_tool_confirmation_identities_requested_run_id",
    ).on(table.requestedRunId),
  }),
);

/**
 * Atomic one-Run claim for an approved confirmation. The primary key prevents
 * two Runs from claiming one approval, while the unique Run id keeps the
 * current authority format intentionally limited to one confirmation grant.
 */
export const mcpConfirmationRunGrants = sqliteTable(
  "mcp_confirmation_run_grants",
  {
    confirmationId: text("confirmation_id")
      .primaryKey()
      .references(() => mcpToolConfirmations.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    principalId: text("principal_id")
      .notNull()
      .references(() => accounts.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => accounts.id),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id),
    runContextRevision: integer("run_context_revision").notNull(),
    runContextDigest: text("run_context_digest").notNull(),
    runGrantDigest: text("run_grant_digest").notNull(),
    originIdentityHash: text("origin_identity_hash").notNull(),
    consumedToolCallId: text("consumed_tool_call_id"),
    consumedAt: text("consumed_at"),
    ...createdAtColumn,
  },
  (table) => ({
    uniqRun: uniqueIndex("idx_mcp_confirmation_run_grants_run_id").on(
      table.runId,
    ),
    idxWorkspaceCreatedAt: index(
      "idx_mcp_confirmation_run_grants_workspace_created_at",
    ).on(table.workspaceId, table.createdAt),
  }),
);
