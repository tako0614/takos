import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { createdAtColumn } from './schema-utils.ts';

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

// 114. DlqEntry
export const dlqEntries = sqliteTable('dlq_entries', {
  id: text('id').primaryKey(),
  queue: text('queue').notNull(),
  messageBody: text('message_body'),
  error: text('error'),
  retryCount: integer('retry_count'),
  ...createdAtColumn,
});
