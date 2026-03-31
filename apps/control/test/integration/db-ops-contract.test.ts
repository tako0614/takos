import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { assertEquals, assert, assertStringIncludes } from 'jsr:@std/assert';

const appRoot = resolve(import.meta.dirname, '../..');
const packageJson = JSON.parse(readFileSync(resolve(appRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};
const resetDbScript = readFileSync(resolve(appRoot, 'scripts/reset-db.js'), 'utf8');
const resetDbShell = readFileSync(resolve(appRoot, 'scripts/reset-db.sh'), 'utf8');
const offloadBackfill = readFileSync(resolve(appRoot, 'scripts/offload-backfill.ts'), 'utf8');
const fixWorkerBindings = readFileSync(resolve(appRoot, 'scripts/fix-worker-bindings.js'), 'utf8');
const createOauthClientSql = readFileSync(resolve(appRoot, 'scripts/create-oauth-client.sql'), 'utf8');


  Deno.test('DB ops contract - keeps db reset package scripts fail-safe and environment-explicit', () => {
  assertEquals(packageJson.scripts['db:reset'], 'pnpm db:rebuild:local');
    assertEquals(packageJson.scripts['db:reset:local'], 'pnpm db:rebuild:local');
    assertEquals(packageJson.scripts['db:reset:staging'], 'node scripts/reset-db.js --env staging');
    assertEquals(packageJson.scripts['db:reset:prod'], 'node scripts/reset-db.js --env production');
})
  Deno.test('DB ops contract - routes shell reset through the canonical JS implementation', () => {
  assertStringIncludes(resetDbShell, 'node "$SCRIPT_DIR/reset-db.js" "$@"');
})
  Deno.test('DB ops contract - makes remote DB maintenance scripts require explicit environments', () => {
  assertStringIncludes(resetDbScript, '--env <staging|production>');
    assertStringIncludes(resetDbScript, 'For local reset, use: pnpm db:reset');
    assertStringIncludes(resetDbScript, "'DB'");
    assert(!(resetDbScript).includes('takos-control-db ${mode}'));

    assertStringIncludes(offloadBackfill, '--remote requires --env staging|production');
    assertStringIncludes(offloadBackfill, "const D1_TARGET = 'DB'");
    assertStringIncludes(offloadBackfill, "staging: 'takos-offload-staging'");
    assertStringIncludes(offloadBackfill, "production: 'takos-offload'");

    assertStringIncludes(fixWorkerBindings, 
      'Usage: node scripts/fix-worker-bindings.js <route-ref> [--local|--env staging|production]'
    );
    assertStringIncludes(fixWorkerBindings, "'d1', 'execute', 'DB'");
    assertStringIncludes(fixWorkerBindings, "'--remote', '--env', executionTarget.env");
})
  Deno.test('DB ops contract - keeps helper OAuth seed data aligned with the current public scope contract', () => {
  assertStringIncludes(createOauthClientSql, 'spaces:read');
    assert(!(createOauthClientSql).includes('workspaces:read'));
})