import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAtColumn } from "./schema-utils.ts";

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

// 114. DlqEntry
export const dlqEntries = sqliteTable("dlq_entries", {
  id: text("id").primaryKey(),
  queue: text("queue").notNull(),
  messageBody: text("message_body"),
  error: text("error"),
  retryCount: integer("retry_count"),
  ...createdAtColumn,
});
