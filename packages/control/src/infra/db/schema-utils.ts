import { text } from 'drizzle-orm/sqlite-core';

/** Reusable `created_at` column with ISO-8601 default. */
export const createdAtColumn = {
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
};

/** Reusable `updated_at` column with ISO-8601 default and auto-update. */
export const updatedAtColumn = {
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()).$onUpdateFn(() => new Date().toISOString()),
};

/** Reusable `created_at` + `updated_at` columns. Spread into any table definition. */
export const timestamps = {
  ...createdAtColumn,
  ...updatedAtColumn,
};
