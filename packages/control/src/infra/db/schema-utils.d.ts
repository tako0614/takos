/** Reusable `created_at` column with ISO-8601 default. */
export declare const createdAtColumn: {
    createdAt: import("drizzle-orm").HasRuntimeDefault<import("drizzle-orm").HasDefault<import("drizzle-orm").NotNull<import("drizzle-orm/sqlite-core").SQLiteTextBuilderInitial<"created_at", [string, ...string[]], number | undefined>>>>;
};
/** Reusable `updated_at` column with ISO-8601 default and auto-update. */
export declare const updatedAtColumn: {
    updatedAt: import("drizzle-orm").HasDefault<import("drizzle-orm").HasRuntimeDefault<import("drizzle-orm").HasDefault<import("drizzle-orm").NotNull<import("drizzle-orm/sqlite-core").SQLiteTextBuilderInitial<"updated_at", [string, ...string[]], number | undefined>>>>>;
};
/** Reusable `created_at` + `updated_at` columns. Spread into any table definition. */
export declare const timestamps: {
    updatedAt: import("drizzle-orm").HasDefault<import("drizzle-orm").HasRuntimeDefault<import("drizzle-orm").HasDefault<import("drizzle-orm").NotNull<import("drizzle-orm/sqlite-core").SQLiteTextBuilderInitial<"updated_at", [string, ...string[]], number | undefined>>>>>;
    createdAt: import("drizzle-orm").HasRuntimeDefault<import("drizzle-orm").HasDefault<import("drizzle-orm").NotNull<import("drizzle-orm/sqlite-core").SQLiteTextBuilderInitial<"created_at", [string, ...string[]], number | undefined>>>>;
};
//# sourceMappingURL=schema-utils.d.ts.map