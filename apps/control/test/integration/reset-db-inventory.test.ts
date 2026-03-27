import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appRoot = resolve(import.meta.dirname, '../..');
const baselineSql = readFileSync(resolve(appRoot, 'db/migrations/0001_baseline.sql'), 'utf8');
const resetDbScript = readFileSync(resolve(appRoot, 'scripts/reset-db.js'), 'utf8');
const resetDbShellScript = readFileSync(resolve(appRoot, 'scripts/reset-db.sh'), 'utf8');
const offloadBackfillScript = readFileSync(resolve(appRoot, 'scripts/offload-backfill.ts'), 'utf8');
const fixWorkerBindingsScript = readFileSync(resolve(appRoot, 'scripts/fix-worker-bindings.js'), 'utf8');
const createOauthClientSql = readFileSync(resolve(appRoot, 'scripts/create-oauth-client.sql'), 'utf8');
const dropAllSql = readFileSync(resolve(appRoot, 'drop_all.sql'), 'utf8');
const packageJson = JSON.parse(readFileSync(resolve(appRoot, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};

function parseBaselineTables(source: string): string[] {
  return [...new Set([...source.matchAll(/CREATE TABLE "([^"]+)"/g)].map((match) => match[1]))].sort();
}

function parseQuotedArray(source: string, constName: string): string[] {
  const match = source.match(new RegExp(`const ${constName} = \\[([\\s\\S]*?)\\n\\];`));
  if (!match) {
    throw new Error(`Could not find ${constName}`);
  }

  return [...match[1].matchAll(/'([^']+)'/g)].map((arrayMatch) => arrayMatch[1]);
}

function parseDropTables(source: string): string[] {
  return [...source.matchAll(/DROP TABLE IF EXISTS ([a-z0-9_]+);/g)].map((match) => match[1]);
}

describe('reset DB inventory', () => {
  it('keeps reset-db.js aligned with the canonical baseline SQL table inventory', () => {
    const baselineTables = parseBaselineTables(baselineSql);
    const resetTables = parseQuotedArray(resetDbScript, 'TABLES');

    expect(resetDbScript).toContain("const ACCOUNT_TABLE = 'accounts';");
    expect(resetTables).not.toContain('accounts');
    expect(resetTables).toHaveLength(new Set(resetTables).size);

    const fullInventory = [...resetTables, 'accounts'].sort();
    expect(fullInventory).toEqual(baselineTables);
  });

  it('preserves only accounts by default', () => {
    expect(resetDbScript).toContain('This will DELETE all data except accounts rows.');
    expect(resetDbScript).not.toContain('users');
    expect(resetDbScript).not.toContain('principals');
  });

  it('keeps db:reset on the Drizzle-managed local path and remote via reset-db.js', () => {
    expect(packageJson.scripts?.['db:reset']).toBe('pnpm db:rebuild:local');
    expect(packageJson.scripts?.['db:reset:local']).toBe('pnpm db:rebuild:local');
    expect(packageJson.scripts?.['db:reset:staging']).toBe('node scripts/reset-db.js --env staging');
    expect(packageJson.scripts?.['db:reset:prod']).toBe('node scripts/reset-db.js --env production');

    expect(resetDbScript).toContain('Usage: node scripts/reset-db.js --env <staging|production> [--include-accounts]');
    expect(resetDbScript).toContain('For local reset, use: pnpm db:reset');
    expect(resetDbShellScript).toContain('node "$SCRIPT_DIR/reset-db.js" "$@"');
  });

  it('requires explicit remote environment selection for maintenance helpers', () => {
    expect(offloadBackfillScript).toContain('--remote requires --env staging|production');
    expect(offloadBackfillScript).toContain("const D1_TARGET = 'DB';");
    expect(offloadBackfillScript).not.toContain('takos-control-db');
    expect(fixWorkerBindingsScript).toContain('--env staging|production');
    expect(fixWorkerBindingsScript).toContain("'DB'");
    expect(fixWorkerBindingsScript).not.toContain('takos-control-db');
  });

  it('keeps OAuth seed SQL aligned with the canonical scope contract', () => {
    expect(createOauthClientSql).toContain('spaces:read');
    expect(createOauthClientSql).not.toContain('workspaces:read');
  });

  it('keeps drop_all.sql aligned with the canonical baseline SQL table inventory', () => {
    const baselineTables = parseBaselineTables(baselineSql);
    const dropTables = parseDropTables(dropAllSql);

    expect(dropTables).toHaveLength(new Set(dropTables).size);
    expect(dropTables).toContain('d1_migrations');

    const dropTablesWithoutMigrations = dropTables
      .filter((table) => table !== 'd1_migrations')
      .sort();
    expect(dropTablesWithoutMigrations).toEqual(baselineTables);
  });
});
