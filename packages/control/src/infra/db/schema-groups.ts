import { sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { timestamps } from './schema-utils';

export const groups = sqliteTable('groups', {
  id: text('id').primaryKey(),
  spaceId: text('space_id').notNull(),
  name: text('name').notNull(),
  appVersion: text('app_version'),
  provider: text('provider'),
  env: text('env'),
  desiredSpecJson: text('desired_spec_json'),
  providerStateJson: text('provider_state_json'),
  reconcileStatus: text('reconcile_status').notNull().default('idle'),
  lastAppliedAt: text('last_applied_at'),
  ...timestamps,
}, (table) => ({
  uniqSpaceName: uniqueIndex('idx_groups_space_name').on(table.spaceId, table.name),
}));
