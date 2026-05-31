import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
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

// 54. ModerationAuditLog
export const moderationAuditLogs = sqliteTable("moderation_audit_logs", {
  id: text("id").primaryKey(),
  actorAccountId: text("actor_account_id").references(() => accounts.id),
  reportId: text("report_id"),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  targetLabel: text("target_label"),
  actionType: text("action_type").notNull(),
  reason: text("reason"),
  details: text("details").notNull().default("{}"),
  ...createdAtColumn,
}, (table) => ({
  idxTargetTypeId: index("idx_moderation_audit_logs_target_type_id").on(
    table.targetType,
    table.targetId,
  ),
  idxReport: index("idx_moderation_audit_logs_report_id").on(table.reportId),
  idxCreatedAt: index("idx_moderation_audit_logs_created_at").on(
    table.createdAt,
  ),
  idxActor: index("idx_moderation_audit_logs_actor_account_id").on(
    table.actorAccountId,
  ),
  idxActionType: index("idx_moderation_audit_logs_action_type").on(
    table.actionType,
  ),
}));

// 78. Report
export const reports = sqliteTable("reports", {
  id: text("id").primaryKey(),
  reporterAccountId: text("reporter_account_id").notNull().references(() =>
    accounts.id
  ),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  targetLabel: text("target_label"),
  category: text("category").notNull(),
  description: text("description"),
  evidence: text("evidence").notNull().default("{}"),
  status: text("status").notNull().default("open"),
  autoFlagged: integer("auto_flagged", { mode: "boolean" }).notNull().default(
    false,
  ),
  internalNotes: text("internal_notes"),
  resolvedAt: text("resolved_at"),
  ...timestamps,
}, (table) => ({
  idxTargetTypeId: index("idx_reports_target_type_id").on(
    table.targetType,
    table.targetId,
  ),
  idxStatus: index("idx_reports_status").on(table.status),
  idxReporter: index("idx_reports_reporter_account_id").on(
    table.reporterAccountId,
  ),
  idxCreatedAt: index("idx_reports_created_at").on(table.createdAt),
  idxCategory: index("idx_reports_category").on(table.category),
  idxAutoFlagged: index("idx_reports_auto_flagged").on(table.autoFlagged),
}));
