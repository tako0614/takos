/**
 * Utility to extract the select type from a Drizzle table.
 * Fields inferred as `never` (caused by TypeScript losing type info when
 * spreading complex Drizzle column builders) are recovered as `string`,
 * which matches the runtime value of text() columns in SQLite.
 */
export type SelectOf<T extends { $inferSelect: unknown }> = {
  [K in keyof T["$inferSelect"]]: T["$inferSelect"][K] extends never ? string
    : T["$inferSelect"][K];
};

/** Utility to extract the insert type from a Drizzle table */
export type InsertOf<T extends { $inferInsert: unknown }> = T["$inferInsert"];
