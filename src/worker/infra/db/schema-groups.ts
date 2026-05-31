import { sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { timestamps } from "./schema-utils.ts";

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
