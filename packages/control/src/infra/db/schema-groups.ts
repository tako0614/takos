import { sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { timestamps } from "./schema-utils.ts";

/**
 * Index naming drift NOTE (Round 11 audit Finding #6).
 *
 * Drizzle declarations here use the `idx_<table>_<col>` prefix pattern.
 * The baseline migration (apps/control/db/migrations/0001_baseline.sql)
 * uses the legacy `<table>_<col>_idx` suffix pattern. Both names point at
 * the same physical index in the live D1 database (the one created by the
 * baseline migration). Drizzle-kit `generate` will see this as drift and
 * try to emit hundreds of rename statements. Do NOT run drizzle-kit
 * generate against this schema without first deciding whether to:
 *   (a) accept the rename migration and apply it to all environments, or
 *   (b) hand-edit the generated migration to a no-op.
 *
 * Newer tables (auth_identities, usage_events, service_runtimes,
 * memory_*) intentionally match the legacy suffix shape via explicit
 * .index() names so they don't add to the drift.
 */

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  spaceId: text("space_id").notNull(),
  name: text("name").notNull(),
  appVersion: text("app_version"),
  backend: text("backend"),
  env: text("env"),
  sourceKind: text("source_kind"),
  sourceRepositoryUrl: text("source_repository_url"),
  sourceRef: text("source_ref"),
  sourceRefType: text("source_ref_type"),
  sourceCommitSha: text("source_commit_sha"),
  currentGroupDeploymentSnapshotId: text(
    "current_group_deployment_snapshot_id",
  ),
  desiredSpecJson: text("desired_spec_json"),
  backendStateJson: text("backend_state_json"),
  reconcileStatus: text("reconcile_status").notNull().default("idle"),
  lastAppliedAt: text("last_applied_at"),
  ...timestamps,
}, (table) => ({
  uniqSpaceName: uniqueIndex("idx_groups_space_name").on(
    table.spaceId,
    table.name,
  ),
}));
