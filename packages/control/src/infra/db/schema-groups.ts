import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { timestamps } from './schema-utils';

export const groups = sqliteTable('groups', {
  id: text('id').primaryKey(),
  spaceId: text('space_id').notNull(),
  name: text('name').notNull(),
  appVersion: text('app_version'),
  provider: text('provider'),
  env: text('env'),
  manifestJson: text('manifest_json'),
  ...timestamps,
}, (table) => ({
  uniqSpaceName: uniqueIndex('idx_groups_space_name').on(table.spaceId, table.name),
}));

export const groupEntities = sqliteTable('group_entities', {
  id: text('id').primaryKey(),
  groupId: text('group_id').notNull(),
  category: text('category').notNull(),
  name: text('name').notNull(),
  config: text('config').notNull().default('{}'),
  ...timestamps,
}, (table) => ({
  uniqGroupCategoryName: uniqueIndex('idx_group_entities_unique').on(table.groupId, table.category, table.name),
  idxGroup: index('idx_group_entities_group').on(table.groupId),
  idxCategory: index('idx_group_entities_category').on(table.groupId, table.category),
}));
