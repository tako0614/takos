import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { createdAtColumn } from './schema-utils';

// 114. DlqEntry
export const dlqEntries = sqliteTable('dlq_entries', {
  id: text('id').primaryKey(),
  queue: text('queue').notNull(),
  messageBody: text('message_body'),
  error: text('error'),
  retryCount: integer('retry_count'),
  ...createdAtColumn,
});
