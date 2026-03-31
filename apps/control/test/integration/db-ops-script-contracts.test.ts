import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { assert, assertStringIncludes } from 'jsr:@std/assert';

const scriptsRoot = resolve(import.meta.dirname, '../../scripts');
const offloadBackfill = readFileSync(resolve(scriptsRoot, 'offload-backfill.ts'), 'utf8');
const fixWorkerBindings = readFileSync(resolve(scriptsRoot, 'fix-worker-bindings.js'), 'utf8');
const createOAuthClientSql = readFileSync(resolve(scriptsRoot, 'create-oauth-client.sql'), 'utf8');


  Deno.test('DB ops script contract - requires explicit environment selection for remote backfill and worker binding inspection', () => {
  assertStringIncludes(offloadBackfill, '--remote requires --env staging|production');
    assertStringIncludes(offloadBackfill, "const D1_TARGET = 'DB';");
    assertStringIncludes(offloadBackfill, "staging: 'takos-offload-staging'");
    assertStringIncludes(offloadBackfill, "production: 'takos-offload'");
    assert(!(offloadBackfill).includes("const DB_NAME = 'takos-control-db'"));

    assertStringIncludes(fixWorkerBindings, 
      'Usage: node scripts/fix-worker-bindings.js <route-ref> [--local|--env staging|production]'
    );
    assertStringIncludes(fixWorkerBindings, "'d1', 'execute', 'DB'");
    assertStringIncludes(fixWorkerBindings, "'--remote', '--env', executionTarget.env");
    assert(!(fixWorkerBindings).includes("'wrangler', 'd1', 'execute', 'takos-control-db', '--remote'"));
})
  Deno.test('DB ops script contract - keeps helper SQL aligned with the current spaces OAuth scope contract', () => {
  assertStringIncludes(createOAuthClientSql, 'spaces:read');
    assert(!(createOAuthClientSql).includes('workspaces:read'));
})