import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { timestamps } from "./schema-utils.ts";

export const defaultAppDistributionConfig = sqliteTable(
  "default_app_distribution_config",
  {
    id: text("id").primaryKey(),
    configured: integer("configured", { mode: "boolean" }).notNull()
      .default(false),
    ...timestamps,
  },
);

export const defaultAppDistributionEntries = sqliteTable(
  "default_app_distribution_entries",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    title: text("title").notNull(),
    repositoryUrl: text("repository_url").notNull(),
    ref: text("ref").notNull().default("main"),
    refType: text("ref_type").notNull().default("branch"),
    preinstall: integer("preinstall", { mode: "boolean" }).notNull()
      .default(true),
    backendName: text("backend_name"),
    envName: text("env_name"),
    position: integer("position").notNull().default(0),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (table) => ({
    uniqName: uniqueIndex("idx_default_app_distribution_entries_name").on(
      table.name,
    ),
    idxEnabledPosition: index(
      "idx_default_app_distribution_entries_enabled_position",
    ).on(table.enabled, table.position),
  }),
);

export const defaultAppPreinstallJobs = sqliteTable(
  "default_app_preinstall_jobs",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id").notNull(),
    createdByAccountId: text("created_by_account_id"),
    distributionJson: text("distribution_json"),
    expectedGroupIdsJson: text("expected_group_ids_json"),
    deploymentQueuedAt: text("deployment_queued_at"),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: text("next_attempt_at"),
    lockedAt: text("locked_at"),
    lastError: text("last_error"),
    ...timestamps,
  },
  (table) => ({
    idxStatusNextAttempt: index(
      "idx_default_app_preinstall_jobs_status_next_attempt",
    ).on(table.status, table.nextAttemptAt),
    uniqSpace: uniqueIndex("uniq_default_app_preinstall_jobs_space_id").on(
      table.spaceId,
    ),
  }),
);
