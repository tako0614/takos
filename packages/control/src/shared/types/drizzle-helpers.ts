/** Utility to extract the select type from a Drizzle table */
export type SelectOf<T extends { $inferSelect: unknown }> = T['$inferSelect'];

/** Utility to extract the insert type from a Drizzle table */
export type InsertOf<T extends { $inferInsert: unknown }> = T['$inferInsert'];
