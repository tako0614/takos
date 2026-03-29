import type { D1Database } from '../../../shared/types/bindings.ts';
/**
 * Resolve all account IDs accessible to a user via memberships.
 *
 * Always includes the userId itself in the returned array (the user's
 * personal account). An optional `activeOnly` flag restricts the query
 * to memberships with status = 'active'.
 */
export declare function resolveAccessibleAccountIds(db: D1Database, userId: string, opts?: {
    activeOnly?: boolean;
}): Promise<string[]>;
//# sourceMappingURL=membership-resolver.d.ts.map