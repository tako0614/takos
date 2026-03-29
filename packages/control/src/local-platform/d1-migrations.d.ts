import type { Client } from '@libsql/client';
import type { Pool } from 'pg';
export declare function ensureServerMigrations(client: Client, migrationsDir: string): Promise<void>;
export declare function ensureServerPostgresMigrations(pool: Pool, migrationsDir: string): Promise<void>;
export declare function ensureSqliteServicesTableShape(client: Client): Promise<void>;
export declare function ensureSqliteAccountsTableShape(client: Client): Promise<void>;
export declare function ensurePostgresServicesTableShape(pool: Pool): Promise<void>;
export declare function ensurePostgresAccountsTableShape(pool: Pool): Promise<void>;
//# sourceMappingURL=d1-migrations.d.ts.map