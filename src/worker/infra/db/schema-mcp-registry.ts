import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { accounts } from "./schema-accounts.ts";
import { timestamps } from "./schema-utils.ts";

/**
 * Workspace-scoped MCP Registry discovery sources and source preferences.
 *
 * `source_kind` records provenance only. It is deliberately independent from
 * connector verification or security-review state; being listed by any
 * registry, including the Official MCP Registry, is not a safety assertion.
 * The Official source definition remains built in; a row with its canonical
 * base URL stores only that Workspace's enabled preference.
 */
export const mcpRegistrySources = sqliteTable(
  "mcp_registry_sources",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    name: text("name").notNull(),
    baseUrl: text("base_url").notNull(),
    sourceKind: text("source_kind").notNull().default("custom"),
    authType: text("auth_type").notNull().default("none"),
    authHeaderName: text("auth_header_name"),
    authSecret: text("auth_secret"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    priority: integer("priority").notNull().default(0),
    ...timestamps,
  },
  (table) => ({
    uniqAccountBaseUrl: uniqueIndex(
      "idx_mcp_registry_sources_account_base_url",
    ).on(table.accountId, table.baseUrl),
    idxAccountEnabledPriority: index(
      "idx_mcp_registry_sources_account_enabled_priority",
    ).on(table.accountId, table.enabled, table.priority),
  }),
);
