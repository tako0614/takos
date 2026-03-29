export declare function splitSqlStatements(sql: string): string[];
export declare function stripLeadingSqlComments(statement: string): string;
export declare function isRecoverableSqliteSchemaDuplication(error: unknown, normalizedStatement: string): boolean;
export declare function normalizeMigrationSql(fileName: string, sql: string): string;
export declare function rewriteInsertOrIgnoreForPostgres(statement: string): string;
export declare function normalizePostgresMigrationSql(fileName: string, sql: string): string;
//# sourceMappingURL=d1-sql-rewrite.d.ts.map