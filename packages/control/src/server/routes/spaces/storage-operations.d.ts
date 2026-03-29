import type { MiddlewareHandler } from 'hono';
import type { Context } from 'hono';
import type { AuthenticatedRouteEnv } from '../route-auth';
import { MAX_BULK_OPERATION_ITEMS } from '../../../shared/config/limits';
export { MAX_BULK_OPERATION_ITEMS };
export declare const storageBulkLimiter: import("../../../shared/utils").InMemoryRateLimiter;
export declare const INLINE_SAFE_MIME_PREFIXES: string[];
export declare function requireOAuthScope(scope: string): MiddlewareHandler<AuthenticatedRouteEnv>;
export declare function handleStorageError(_c: Context, err: unknown): never;
//# sourceMappingURL=storage-operations.d.ts.map