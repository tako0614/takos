/**
 * Shared repo utilities used across git, git-advanced, sync, and other repo route files.
 */
import type { Context } from 'hono';
import type { ResolveReadableCommitResult } from '../../../application/services/git-smart';
export { sanitizeRepoName } from '../../../shared/utils';
export declare function readableCommitErrorResponse(c: Context, ref: string, result: Extract<ResolveReadableCommitResult, {
    ok: false;
}>): Response;
export declare function generateExploreInvalidationUrls(c: Context): string[];
export declare function encodeBase64(data: Uint8Array): string;
export declare function hasWriteRole(role: string | null | undefined): boolean;
export type TreeFlattenLimitErrorCode = 'TREE_FLATTEN_ENTRY_LIMIT_EXCEEDED' | 'TREE_FLATTEN_DEPTH_LIMIT_EXCEEDED';
/**
 * Check whether an error is a tree flatten limit error.
 * Shared across git, git-advanced, and sync routes.
 */
export declare function getTreeFlattenLimitError(err: unknown): {
    code: TreeFlattenLimitErrorCode;
    detail: string;
} | null;
//# sourceMappingURL=shared.d.ts.map