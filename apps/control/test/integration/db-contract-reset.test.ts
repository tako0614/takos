import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { assert, assertStringIncludes } from 'jsr:@std/assert';

const docsCandidates = [
  process.env.TAKOS_DOCS_DIR ? resolve(process.env.TAKOS_DOCS_DIR, 'takos/reference/database.md') : null,
].filter((candidate): candidate is string => Boolean(candidate));

const docsDatabasePath = docsCandidates.find((candidate) => existsSync(candidate));
const docsDatabase = docsDatabasePath ? readFileSync(docsDatabasePath, 'utf8') : '';
const appRoot = resolve(import.meta.dirname, '../..');
const baselineSql = readFileSync(resolve(appRoot, 'db/migrations/0001_baseline.sql'), 'utf8');

const requiredTables = [
  'auth_sessions',
  'oauth_states',
  'thread_shares',
  'mcp_servers',
  'bundle_deployments',
  'bundle_deployment_events',
  'service_mcp_endpoints',
  'usage_rollups',
  'repo_release_assets',
  'billing_plan_rates',
  'billing_plan_quotas',
  'billing_plan_features',
  'file_handler_matchers',
];

/**
 * Tables that unified principals/users/spaces into accounts.
 * All sources now use the canonical new names.
 */
const unifiedAccountTables = [
  'accounts',
  'account_memberships',
  'account_metadata',
];

const docsInventoryTables = [
  'personal_access_tokens',
  'managed_takos_tokens',
  'service_runtimes',
  'infra_endpoints',
  'infra_endpoint_routes',
  'branches',
  'commits',
  'tags',
  'repo_remotes',
];

const forbiddenTables = [
  'projects',
  'space_builds',
  'tool_packages',
  'space_tools',
  'custom_tools',
  'space_installations',
  'usage_meters',
];

const criticalColumns: Record<string, string[]> = {
  managed_takos_tokens: [
    'subject_account_id',
    'subject_mode',
    'scopes_json',
    'token_encrypted',
  ],
  resources: [
    'owner_account_id',
    'account_id',
  ],
  oauth_clients: [
    'owner_account_id',
    'redirect_uris',
    'allowed_scopes',
  ],
  branches: [
    'commit_sha',
    'is_default',
    'is_protected',
  ],
  commits: [
    'tree_sha',
    'parent_shas',
    'author_date',
    'commit_date',
  ],
  tags: [
    'commit_sha',
    'tagger_name',
    'tagger_email',
  ],
  repo_remotes: [
    'upstream_repo_id',
  ],
  service_runtimes: [
    'cloudflare_service_ref',
    'bundle_deployment_id',
  ],
  infra_endpoints: [
    'target_service_ref',
    'timeout_ms',
    'bundle_deployment_id',
  ],
  infra_endpoint_routes: [
    'path_prefix',
    'methods_json',
    'position',
  ],
  deployments: [
    'runtime_config_snapshot_json',
    'bindings_snapshot_encrypted',
    'env_vars_snapshot_encrypted',
    'routing_status',
  ],
  deployment_events: [
    'deployment_id',
    'actor_account_id',
    'event_type',
  ],
};

function extractDocsTableBlock(source: string, table: string): string {
  const aliases = table === 'service_runtimes'
    ? ['service_runtimes', 'infra_workers']
    : table === 'service_mcp_endpoints'
      ? ['service_mcp_endpoints', 'worker_mcp_endpoints']
      : [table];
  for (const candidate of aliases) {
    const match = source.match(new RegExp(`CREATE TABLE ${candidate} \\(([\\s\\S]*?)\\n\\);`));
    if (match) {
      return match[1];
    }
  }
  throw new Error(`Missing docs table block for ${table}`);
}

function extractBaselineTableBlock(source: string, table: string): string {
  const aliases = table === 'service_runtimes'
    ? ['service_runtimes', 'infra_workers']
    : table === 'service_mcp_endpoints'
      ? ['service_mcp_endpoints', 'worker_mcp_endpoints']
      : [table];
  for (const candidate of aliases) {
    const match = source.match(new RegExp(`CREATE TABLE "${candidate}" \\(([\\s\\S]*?)\\n\\);`));
    if (match) {
      return match[1];
    }
  }
  throw new Error(`Missing baseline table block for ${table}`);
}

function expectDocsTable(table: string): void {
  if (table === 'service_runtimes') {
    assert(/CREATE TABLE (service_runtimes|infra_workers)\s*\(/.test(docsDatabase));
    return;
  }
  if (table === 'service_mcp_endpoints') {
    assert(/CREATE TABLE (service_mcp_endpoints|worker_mcp_endpoints)\s*\(/.test(docsDatabase));
    return;
  }
  assertStringIncludes(docsDatabase, new RegExp(`CREATE TABLE ${table}\\s*\\(`));
}

function expectBaselineTable(table: string): void {
  if (table === 'service_runtimes') {
    assert(/CREATE TABLE "(service_runtimes|infra_workers)"/.test(baselineSql));
    return;
  }
  if (table === 'service_mcp_endpoints') {
    assert(/CREATE TABLE "(service_mcp_endpoints|worker_mcp_endpoints)"/.test(baselineSql));
    return;
  }
  assertStringIncludes(baselineSql, `CREATE TABLE "${table}"`);
}

describe.skipIf(!docsDatabase)('DB contract reset canon', () => {
  Deno.test('keeps the reset-critical tables aligned across docs and baseline SQL', () => {
  for (const table of requiredTables) {
      expectDocsTable(table);
      expectBaselineTable(table);
    }
})
  Deno.test('keeps unified account tables present in all sources', () => {
  for (const table of unifiedAccountTables) {
      expectBaselineTable(table);
      expectDocsTable(table);
    }
})
  Deno.test('documents the canonical table inventory that previously drifted out of the database reference', () => {
  for (const table of docsInventoryTables) {
      expectDocsTable(table);
      expectBaselineTable(table);
    }
})
  Deno.test('removes legacy tables from docs and baseline SQL', () => {
  for (const table of forbiddenTables) {
      assert(!(baselineSql).includes(`CREATE TABLE "${table}"`));
      assert(!(new RegExp(`CREATE TABLE ${table}\\s*\\(`)).test(docsDatabase));
    }
})
  Deno.test('removes mixed-product schema text from Takos database docs', () => {
  assert(!(docsDatabase).includes('Yurucommu Schema'));
    assert(!(docsDatabase).includes('actors'));
    assert(!(docsDatabase).includes('likes'));
})
  Deno.test('uses snapshot deployment columns and normalized bundle asset references', () => {
  assertStringIncludes(baselineSql, '"runtime_config_snapshot_json"');
    assertStringIncludes(baselineSql, '"bindings_snapshot_encrypted"');
    assertStringIncludes(baselineSql, '"env_vars_snapshot_encrypted"');
    assert(!(baselineSql).includes('"completed_steps"'));
    assertStringIncludes(baselineSql, '"bundle_format"');
    assertStringIncludes(baselineSql, '"bundle_meta_json"');

    assertStringIncludes(docsDatabase, 'runtime_config_snapshot_json');
    assertStringIncludes(docsDatabase, 'bundle_format');
    assertStringIncludes(docsDatabase, 'bundle_meta_json');
})
  Deno.test('keeps critical column contracts aligned across docs and baseline SQL', () => {
  for (const [table, columns] of Object.entries(criticalColumns)) {
      const docsBlock = extractDocsTableBlock(docsDatabase, table);
      const baselineBlock = extractBaselineTableBlock(baselineSql, table);

      for (const column of columns) {
        assertStringIncludes(docsBlock, column);
        assertStringIncludes(baselineBlock, column);
      }
    }
})});
