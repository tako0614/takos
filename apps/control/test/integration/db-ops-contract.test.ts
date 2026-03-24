import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appRoot = resolve(import.meta.dirname, '../..');
const packageJson = JSON.parse(readFileSync(resolve(appRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};
const resetDbScript = readFileSync(resolve(appRoot, 'scripts/reset-db.js'), 'utf8');
const resetDbShell = readFileSync(resolve(appRoot, 'scripts/reset-db.sh'), 'utf8');
const offloadBackfill = readFileSync(resolve(appRoot, 'scripts/offload-backfill.ts'), 'utf8');
const fixWorkerBindings = readFileSync(resolve(appRoot, 'scripts/fix-worker-bindings.js'), 'utf8');
const createOauthClientSql = readFileSync(resolve(appRoot, 'scripts/create-oauth-client.sql'), 'utf8');

describe('DB ops contract', () => {
  it('keeps db reset package scripts fail-safe and environment-explicit', () => {
    expect(packageJson.scripts['db:reset']).toBe('pnpm db:rebuild:local');
    expect(packageJson.scripts['db:reset:local']).toBe('pnpm db:rebuild:local');
    expect(packageJson.scripts['db:reset:staging']).toBe('node scripts/reset-db.js --env staging');
    expect(packageJson.scripts['db:reset:prod']).toBe('node scripts/reset-db.js --env production');
  });

  it('routes shell reset through the canonical JS implementation', () => {
    expect(resetDbShell).toContain('node "$SCRIPT_DIR/reset-db.js" "$@"');
  });

  it('makes remote DB maintenance scripts require explicit environments', () => {
    expect(resetDbScript).toContain('--env <staging|production>');
    expect(resetDbScript).toContain('For local reset, use: pnpm db:reset');
    expect(resetDbScript).toContain("'DB'");
    expect(resetDbScript).not.toContain('takos-control-db ${mode}');

    expect(offloadBackfill).toContain('--remote requires --env staging|production');
    expect(offloadBackfill).toContain("const D1_TARGET = 'DB'");
    expect(offloadBackfill).toContain("staging: 'takos-offload-staging'");
    expect(offloadBackfill).toContain("production: 'takos-offload'");

    expect(fixWorkerBindings).toContain(
      'Usage: node scripts/fix-worker-bindings.js <route-ref> [--local|--env staging|production]'
    );
    expect(fixWorkerBindings).toContain("'d1', 'execute', 'DB'");
    expect(fixWorkerBindings).toContain("'--remote', '--env', executionTarget.env");
  });

  it('keeps helper OAuth seed data aligned with the current public scope contract', () => {
    expect(createOauthClientSql).toContain('spaces:read');
    expect(createOauthClientSql).not.toContain('workspaces:read');
  });
});
