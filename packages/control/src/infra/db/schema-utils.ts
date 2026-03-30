import { text } from 'drizzle-orm/sqlite-core';

// Extract column builders as standalone bindings so TypeScript can capture
// their exact types via `typeof`, preserving them through object spreads.
const _createdAt = text('created_at').notNull().$defaultFn(() => new Date().toISOString());
const _updatedAt = text('updated_at').notNull().$defaultFn(() => new Date().toISOString()).$onUpdateFn(() => new Date().toISOString());

/** Reusable `created_at` column with ISO-8601 default. */
export const createdAtColumn: { createdAt: typeof _createdAt } = {
  createdAt: _createdAt,
};

/** Reusable `updated_at` column with ISO-8601 default and auto-update. */
export const updatedAtColumn: { updatedAt: typeof _updatedAt } = {
  updatedAt: _updatedAt,
};

/** Reusable `created_at` + `updated_at` columns. Spread into any table definition. */
export const timestamps: { createdAt: typeof _createdAt; updatedAt: typeof _updatedAt } = {
  createdAt: _createdAt,
  updatedAt: _updatedAt,
};
