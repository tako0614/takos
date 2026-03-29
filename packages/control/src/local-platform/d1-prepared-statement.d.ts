import type { Client } from '@libsql/client';
import type { D1PreparedStatement, D1Result } from '../shared/types/bindings.ts';
import { type PostgresRunner } from './d1-shared.ts';
export declare function createPreparedStatement(client: Client, query: string, boundArgs?: unknown[]): D1PreparedStatement;
export declare function createPostgresPreparedStatement(runner: PostgresRunner, query: string, boundArgs?: unknown[], servedBy?: string): D1PreparedStatement;
export declare function createSequentialBatch<T>(runStatement: (statement: D1PreparedStatement) => Promise<D1Result<T>>): (statements: D1PreparedStatement[]) => Promise<D1Result<T>[]>;
//# sourceMappingURL=d1-prepared-statement.d.ts.map