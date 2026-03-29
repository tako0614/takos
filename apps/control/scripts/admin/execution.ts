/**
 * D1 execution helpers and API client utilities.
 */

import { CloudflareApiClient } from 'takos-control/core/cloudflare-api';

import type { D1Statement, ResolvedConfig } from './admin-types.ts';
import { VALID_USER_ID_PATTERN } from './constants.ts';
import { fail } from './cli-utils.ts';

// ---------------------------------------------------------------------------
// D1 execution helpers
// ---------------------------------------------------------------------------

export function requireD1DatabaseId(config: ResolvedConfig): string {
  if (!config.d1DatabaseId) {
    fail('D1 database_id is required (set TAKOS_D1_DATABASE_ID or configure wrangler.toml).');
  }
  return config.d1DatabaseId;
}

export function createClient(config: ResolvedConfig): CloudflareApiClient {
  return new CloudflareApiClient({
    accountId: config.accountId,
    apiToken: config.apiToken,
  });
}

export async function executeD1Sql(config: ResolvedConfig, sql: string): Promise<D1Statement[]> {
  const client = createClient(config);
  const databaseId = requireD1DatabaseId(config);
  return client.accountPost<D1Statement[]>(`/d1/database/${databaseId}/query`, { sql });
}

export function extractResults(statements: D1Statement[]): unknown[] {
  const first = statements[0] ?? {};
  return Array.isArray(first.results) ? first.results : [];
}

export function extractChangeCount(statements: D1Statement[]): number {
  const first = statements[0] ?? {};
  const changed = Number(first.meta?.changes ?? 0);
  if (Number.isFinite(changed) && changed > 0) {
    return changed;
  }
  return extractResults(statements).length;
}

// ---------------------------------------------------------------------------
// R2 bucket resolution
// ---------------------------------------------------------------------------

export function resolveBucketName(config: ResolvedConfig, input: string): string {
  const key = input.toLowerCase();
  return config.r2Buckets[key] || config.r2Buckets[input] || input;
}

// ---------------------------------------------------------------------------
// User validation helpers (shared between moderation and platform commands)
// ---------------------------------------------------------------------------

export function ensureValidUserId(userId: string, fieldName: string): void {
  if (!VALID_USER_ID_PATTERN.test(userId)) {
    fail(`Invalid ${fieldName}: ${userId}`);
  }
}
