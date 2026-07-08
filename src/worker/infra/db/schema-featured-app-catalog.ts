import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { timestamps } from "./schema-utils.ts";

export const featuredAppCatalogConfig = sqliteTable(
  "featured_app_catalog_config",
  {
    id: text("id").primaryKey(),
    configured: integer("configured", { mode: "boolean" }).notNull()
      .default(false),
    ...timestamps,
  },
);

export const featuredAppCatalogEntries = sqliteTable(
  "featured_app_catalog_entries",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    title: text("title").notNull(),
    icon: text("icon"),
    repositoryUrl: text("repository_url").notNull(),
    ref: text("ref").notNull().default("main"),
    refType: text("ref_type").notNull().default("branch"),
    preinstall: integer("preinstall", { mode: "boolean" }).notNull()
      .default(false),
    backendName: text("backend_name"),
    envName: text("env_name"),
    position: integer("position").notNull().default(0),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (table) => ({
    uniqName: uniqueIndex("idx_featured_app_catalog_entries_name").on(
      table.name,
    ),
    idxEnabledPosition: index(
      "idx_featured_app_catalog_entries_enabled_position",
    ).on(table.enabled, table.position),
  }),
);

export const featuredAppPreinstallJobs = sqliteTable(
  "featured_app_preinstall_jobs",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id").notNull(),
    createdByAccountId: text("created_by_account_id"),
    catalogJson: text("catalog_json"),
    expectedGroupIdsJson: text("expected_group_ids_json"),
    applyQueuedAt: text("apply_queued_at"),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: text("next_attempt_at"),
    lockedAt: text("locked_at"),
    lastError: text("last_error"),
    ...timestamps,
  },
  (table) => ({
    idxStatusNextAttempt: index(
      "idx_featured_app_preinstall_jobs_status_next_attempt",
    ).on(table.status, table.nextAttemptAt),
    uniqSpace: uniqueIndex("uniq_featured_app_preinstall_jobs_space_id").on(
      table.spaceId,
    ),
  }),
);
