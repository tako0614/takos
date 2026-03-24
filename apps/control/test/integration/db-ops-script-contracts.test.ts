import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const scriptsRoot = resolve(import.meta.dirname, '../../scripts');
const offloadBackfill = readFileSync(resolve(scriptsRoot, 'offload-backfill.ts'), 'utf8');
const fixWorkerBindings = readFileSync(resolve(scriptsRoot, 'fix-worker-bindings.js'), 'utf8');
const createOAuthClientSql = readFileSync(resolve(scriptsRoot, 'create-oauth-client.sql'), 'utf8');

describe('DB ops script contract', () => {
  it('requires explicit environment selection for remote backfill and worker binding inspection', () => {
    expect(offloadBackfill).toContain('--remote requires --env staging|production');
    expect(offloadBackfill).toContain("const D1_TARGET = 'DB';");
    expect(offloadBackfill).toContain("staging: 'takos-offload-staging'");
    expect(offloadBackfill).toContain("production: 'takos-offload'");
    expect(offloadBackfill).not.toContain("const DB_NAME = 'takos-control-db'");

    expect(fixWorkerBindings).toContain(
      'Usage: node scripts/fix-worker-bindings.js <route-ref> [--local|--env staging|production]'
    );
    expect(fixWorkerBindings).toContain("'d1', 'execute', 'DB'");
    expect(fixWorkerBindings).toContain("'--remote', '--env', executionTarget.env");
    expect(fixWorkerBindings).not.toContain("'wrangler', 'd1', 'execute', 'takos-control-db', '--remote'");
  });

  it('keeps helper SQL aligned with the current spaces OAuth scope contract', () => {
    expect(createOAuthClientSql).toContain('spaces:read');
    expect(createOAuthClientSql).not.toContain('workspaces:read');
  });
});
