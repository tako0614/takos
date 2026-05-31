import {
  index,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { createdAtColumn, updatedAtColumn } from "./schema-utils.ts";

// App-local metering owned by Takos. Commercial billing and payment ownership
// lives in Takosumi Accounts/Cloud.
export const appUsageEvents = sqliteTable("app_usage_events", {
  id: text("id").primaryKey(),
  idempotencyKey: text("idempotency_key").unique(
    "idx_app_usage_events_idempotency_key",
  ),
  ownerAccountId: text("owner_account_id").notNull(),
  scopeType: text("scope_type").notNull().default("space"),
  spaceId: text("space_id"),
  meterType: text("meter_type").notNull(),
  units: real("units").notNull(),
  referenceId: text("reference_id"),
  referenceType: text("reference_type"),
  metadata: text("metadata").notNull().default("{}"),
  ...createdAtColumn,
}, (table) => ({
  idxOwnerAccount: index("idx_app_usage_events_owner_account_id").on(
    table.ownerAccountId,
  ),
  idxSpace: index("idx_app_usage_events_space_id").on(table.spaceId),
  idxMeterType: index("idx_app_usage_events_meter_type").on(table.meterType),
  idxReference: index("idx_app_usage_events_reference_id").on(
    table.referenceId,
  ),
  idxCreatedAt: index("idx_app_usage_events_created_at").on(table.createdAt),
}));

export const appUsageRollups = sqliteTable("app_usage_rollups", {
  id: text("id").primaryKey(),
  ownerAccountId: text("owner_account_id").notNull(),
  scopeType: text("scope_type").notNull(),
  scopeId: text("scope_id").notNull(),
  spaceId: text("space_id"),
  meterType: text("meter_type").notNull(),
  periodStart: text("period_start").notNull(),
  units: real("units").notNull().default(0),
  ...updatedAtColumn,
}, (table) => ({
  uniqScope: uniqueIndex("idx_app_usage_rollups_scope").on(
    table.ownerAccountId,
    table.scopeType,
    table.scopeId,
    table.meterType,
    table.periodStart,
  ),
  idxOwnerAccount: index("idx_app_usage_rollups_owner_account_id").on(
    table.ownerAccountId,
  ),
  idxSpace: index("idx_app_usage_rollups_space_id").on(table.spaceId),
  idxMeterType: index("idx_app_usage_rollups_meter_type").on(table.meterType),
  idxPeriodStart: index("idx_app_usage_rollups_period_start").on(
    table.periodStart,
  ),
}));
