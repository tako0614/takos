import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { assertEquals, assert, assertStringIncludes } from 'jsr:@std/assert';

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


  Deno.test('reset DB inventory - keeps reset-db.js aligned with the canonical baseline SQL table inventory', () => {
  const baselineTables = parseBaselineTables(baselineSql);
    const resetTables = parseQuotedArray(resetDbScript, 'TABLES');

    assertStringIncludes(resetDbScript, "const ACCOUNT_TABLE = 'accounts';");
    assert(!(resetTables).includes('accounts'));
    assertEquals(resetTables.length, new Set(resetTables).size);

    const fullInventory = [...resetTables, 'accounts'].sort();
    assertEquals(fullInventory, baselineTables);
})
  Deno.test('reset DB inventory - preserves only accounts by default', () => {
  assertStringIncludes(resetDbScript, 'This will DELETE all data except accounts rows.');
    assert(!(resetDbScript).includes('users'));
    assert(!(resetDbScript).includes('principals'));
})
  Deno.test('reset DB inventory - keeps db:reset on the Drizzle-managed local path and remote via reset-db.js', () => {
  assertEquals(packageJson.scripts?.['db:reset'], 'pnpm db:rebuild:local');
    assertEquals(packageJson.scripts?.['db:reset:local'], 'pnpm db:rebuild:local');
    assertEquals(packageJson.scripts?.['db:reset:staging'], 'node scripts/reset-db.js --env staging');
    assertEquals(packageJson.scripts?.['db:reset:prod'], 'node scripts/reset-db.js --env production');

    assertStringIncludes(resetDbScript, 'Usage: node scripts/reset-db.js --env <staging|production> [--include-accounts]');
    assertStringIncludes(resetDbScript, 'For local reset, use: pnpm db:reset');
    assertStringIncludes(resetDbShellScript, 'node "$SCRIPT_DIR/reset-db.js" "$@"');
})
  Deno.test('reset DB inventory - requires explicit remote environment selection for maintenance helpers', () => {
  assertStringIncludes(offloadBackfillScript, '--remote requires --env staging|production');
    assertStringIncludes(offloadBackfillScript, "const D1_TARGET = 'DB';");
    assert(!(offloadBackfillScript).includes('takos-control-db'));
    assertStringIncludes(fixWorkerBindingsScript, '--env staging|production');
    assertStringIncludes(fixWorkerBindingsScript, "'DB'");
    assert(!(fixWorkerBindingsScript).includes('takos-control-db'));
})
  Deno.test('reset DB inventory - keeps OAuth seed SQL aligned with the canonical scope contract', () => {
  assertStringIncludes(createOauthClientSql, 'spaces:read');
    assert(!(createOauthClientSql).includes('workspaces:read'));
})
  Deno.test('reset DB inventory - keeps drop_all.sql aligned with the canonical baseline SQL table inventory', () => {
  const baselineTables = parseBaselineTables(baselineSql);
    const dropTables = parseDropTables(dropAllSql);

    assertEquals(dropTables.length, new Set(dropTables).size);
    assertStringIncludes(dropTables, 'd1_migrations');

    const dropTablesWithoutMigrations = dropTables
      .filter((table) => table !== 'd1_migrations')
      .sort();
    assertEquals(dropTablesWithoutMigrations, baselineTables);
})