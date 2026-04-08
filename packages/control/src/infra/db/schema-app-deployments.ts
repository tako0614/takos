import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { timestamps } from "./schema-utils.ts";
import { accounts } from "./schema-accounts.ts";

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

export const appDeployments = sqliteTable("app_deployments", {
  id: text("id").primaryKey(),
  spaceId: text("space_id").notNull(),
  groupId: text("group_id").notNull(),
  groupNameSnapshot: text("group_name_snapshot"),
  createdByAccountId: text("created_by_account_id").references(() => accounts.id),
  sourceKind: text("source_kind").notNull(),
  sourceRepositoryUrl: text("source_repository_url"),
  sourceResolvedRepoId: text("source_resolved_repo_id"),
  sourceRepoId: text("source_repo_id"),
  sourceOwner: text("source_owner"),
  sourceRepoName: text("source_repo_name"),
  sourceVersion: text("source_version"),
  sourceRef: text("source_ref"),
  sourceRefType: text("source_ref_type"),
  sourceCommitSha: text("source_commit_sha"),
  sourceReleaseId: text("source_release_id"),
  sourceTag: text("source_tag"),
  status: text("status").notNull().default("applied"),
  manifestJson: text("manifest_json").notNull(),
  buildSourcesJson: text("build_sources_json"),
  hostnamesJson: text("hostnames_json"),
  snapshotR2Key: text("snapshot_r2_key"),
  snapshotSha256: text("snapshot_sha256"),
  snapshotSizeBytes: integer("snapshot_size_bytes"),
  snapshotFormat: text("snapshot_format"),
  resultJson: text("result_json"),
  rollbackOfAppDeploymentId: text("rollback_of_app_deployment_id"),
  ...timestamps,
}, (table) => ({
  idxSpaceCreated: index("idx_app_deployments_space_created").on(
    table.spaceId,
    table.createdAt,
  ),
  idxGroupCreated: index("idx_app_deployments_group_created").on(
    table.groupId,
    table.createdAt,
  ),
  idxStatus: index("idx_app_deployments_status").on(table.status),
  idxRollbackOf: index("idx_app_deployments_rollback_of").on(
    table.rollbackOfAppDeploymentId,
  ),
  idxSourceRepositoryUrl: index("idx_app_deployments_source_repository_url").on(
    table.sourceRepositoryUrl,
  ),
  idxSnapshotR2Key: index("idx_app_deployments_snapshot_r2_key").on(
    table.snapshotR2Key,
  ),
}));
