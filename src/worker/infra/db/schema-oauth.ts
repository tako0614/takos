import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { createdAtColumn, timestamps } from "./schema-utils.ts";
import { accounts } from "./schema-accounts.ts";

/**
 * Index naming note.
 *
 * The applied baseline SQL and the Drizzle declarations do not always use the
 * same naming convention for equivalent indexes. Treat generated
 * index-name-only diffs as intentional schema-change candidates: either apply
 * the rename consistently to every environment or keep the generated migration
 * a no-op. New table declarations should choose explicit `.index()` names that
 * match their applied SQL so the drift set does not grow.
 */

// 50. McpOAuthPending
export const mcpOauthPending = sqliteTable("mcp_oauth_pending", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  serverName: text("server_name").notNull(),
  serverUrl: text("server_url").notNull(),
  state: text("state").notNull().unique(),
  codeVerifier: text("code_verifier").notNull(),
  issuerUrl: text("issuer_url").notNull(),
  tokenEndpoint: text("token_endpoint").notNull(),
  scope: text("scope"),
  expiresAt: text("expires_at").notNull(),
  ...createdAtColumn,
}, (table) => ({
  idxState: index("idx_mcp_oauth_pending_state").on(table.state),
  idxAccount: index("idx_mcp_oauth_pending_account_id").on(table.accountId),
}));

// 51. McpServer
const mcpServersTable = sqliteTable("mcp_servers", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => accounts.id),
  name: text("name").notNull(),
  url: text("url").notNull(),
  transport: text("transport").notNull().default("streamable-http"),
  sourceType: text("source_type").notNull().default("external"),
  authMode: text("auth_mode").notNull().default("oauth_pkce"),
  serviceId: text("service_id"),
  bundleDeploymentId: text("bundle_deployment_id"),
  oauthAccessToken: text("oauth_access_token"),
  oauthRefreshToken: text("oauth_refresh_token"),
  oauthTokenExpiresAt: text("oauth_token_expires_at"),
  oauthScope: text("oauth_scope"),
  oauthIssuerUrl: text("oauth_issuer_url"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, (table) => ({
  uniqAccountName: uniqueIndex("idx_mcp_servers_account_name").on(
    table.accountId,
    table.name,
  ),
  idxService: index("idx_mcp_servers_service_id").on(table.serviceId),
  idxBundleDeployment: index("idx_mcp_servers_bundle_deployment_id").on(
    table.bundleDeploymentId,
  ),
  idxAccount: index("idx_mcp_servers_account_id").on(table.accountId),
}));

export const mcpServers = Object.assign(mcpServersTable, {
  workerId: mcpServersTable.serviceId,
});
