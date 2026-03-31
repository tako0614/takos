import type { D1Database } from '../../../shared/types/bindings.ts';
import { getDb, accountMemberships } from '../../../infra/db/index.ts';
import { eq, and } from 'drizzle-orm';

/**
 * Resolve all account IDs accessible to a user via memberships.
 *
 * Always includes the userId itself in the returned array (the user's
 * personal account). An optional `activeOnly` flag restricts the query
 * to memberships with status = 'active'.
 */
export async function resolveAccessibleAccountIds(
  db: D1Database,
  userId: string,
  opts?: { activeOnly?: boolean },
): Promise<string[]> {
  const drizzle = getDb(db);
  const conditions = [eq(accountMemberships.memberId, userId)];
  if (opts?.activeOnly) {
    conditions.push(eq(accountMemberships.status, 'active'));
  }
  const memberships = await drizzle
    .select({ accountId: accountMemberships.accountId })
    .from(accountMemberships)
    .where(and(...conditions))
    .all();
  return Array.from(new Set([userId, ...memberships.map((m) => m.accountId)]));
}
