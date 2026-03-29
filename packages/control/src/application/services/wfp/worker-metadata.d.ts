/**
 * Pure helper functions shared across WFP (Workers for Platforms) submodules.
 *
 * Contains utilities that have no side effects and no dependency on the
 * Cloudflare API client: SQL table-name sanitisation, D1 result extraction,
 * and worker metadata assembly for dispatch namespace deployments.
 */
import type { D1QueryResult } from './wfp-contracts';
/**
 * Sanitize a SQL table name to prevent injection.
 * Strips all characters except alphanumerics and underscores.
 */
export declare function sanitizeTableName(name: string): string;
/**
 * Extract the results array from a D1 query response.
 * D1 returns Array<{ results: T[] }> -- this unwraps the first element.
 */
export declare function extractD1Results<T>(raw: D1QueryResult<T>[]): T[];
/**
 * Build worker metadata for Cloudflare dispatch namespace deployment.
 * Shared between createWorker and createWorkerWithWasm.
 */
export declare function buildWorkerMetadata(options: {
    bindings: Array<Record<string, unknown>>;
    compatibility_date?: string;
    compatibility_flags?: string[];
    limits?: {
        cpu_ms?: number;
        subrequests?: number;
    };
    assetsJwt?: string;
}): Record<string, unknown>;
//# sourceMappingURL=worker-metadata.d.ts.map