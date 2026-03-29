/**
 * Pure helper functions shared across WFP (Workers for Platforms) submodules.
 *
 * Contains utilities that have no side effects and no dependency on the
 * Cloudflare API client: SQL table-name sanitisation, D1 result extraction,
 * and worker metadata assembly for dispatch namespace deployments.
 */

import { CF_COMPATIBILITY_DATE } from '../../../shared/constants';
import type { D1QueryResult } from './wfp-contracts';

/**
 * Sanitize a SQL table name to prevent injection.
 * Strips all characters except alphanumerics and underscores.
 */
export function sanitizeTableName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '');
}

/**
 * Extract the results array from a D1 query response.
 * D1 returns Array<{ results: T[] }> -- this unwraps the first element.
 */
export function extractD1Results<T>(raw: D1QueryResult<T>[]): T[] {
  return raw?.[0]?.results ?? [];
}

/**
 * Build worker metadata for Cloudflare dispatch namespace deployment.
 * Shared between createWorker and createWorkerWithWasm.
 */
export function buildWorkerMetadata(options: {
  bindings: Array<Record<string, unknown>>;
  compatibility_date?: string;
  compatibility_flags?: string[];
  limits?: { cpu_ms?: number; subrequests?: number };
  assetsJwt?: string;
}): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    main_module: 'worker.js',
    bindings: options.bindings,
    compatibility_date: options.compatibility_date || CF_COMPATIBILITY_DATE,
  };

  if (options.compatibility_flags?.length) {
    metadata.compatibility_flags = options.compatibility_flags;
  }

  if (options.limits) {
    metadata.limits = options.limits;
  }

  if (options.assetsJwt) {
    metadata.assets = { jwt: options.assetsJwt };
  }

  return metadata;
}
