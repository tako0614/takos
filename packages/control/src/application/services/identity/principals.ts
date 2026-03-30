/**
 * principals.ts — thin delegation layer after the User/Workspace/Principal → Account migration.
 *
 * The dedicated `principal` table has been removed. All principal identity is
 * now carried by the `Account` model directly. This file keeps the existing
 * call-sites compiling by delegating to the `account` table.
 */

import type { D1Database } from '../../../shared/types/bindings.ts';
import type { Principal, PrincipalKind } from '../../../shared/types';
import { getDb, accounts } from '../../../infra/db';
import { eq } from 'drizzle-orm';
import { textDate } from '../../../shared/utils/db-guards';

const KNOWN_PRINCIPAL_KINDS = new Set(['user', 'space_agent', 'service', 'system', 'tenant_worker']);

function normalizePrincipalType(type: string | null | undefined): PrincipalKind {
  return KNOWN_PRINCIPAL_KINDS.has(type ?? '') ? (type as PrincipalKind) : 'service';
}

function accountToPrincipal(row: {
  id: string;
  type: string;
  name: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}): Principal {
  return {
    id: row.id,
    type: normalizePrincipalType(row.type),
    display_name: row.name,
    created_at: textDate(row.createdAt),
    updated_at: textDate(row.updatedAt),
  };
}

/**
 * Previously returned a separate principalId; now returns the account id directly.
 */
export async function resolveUserPrincipalId(
  db: D1Database,
  userId: string
): Promise<string | null> {
  const drizzle = getDb(db);
  const row = await drizzle.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, userId)).get();
  return row?.id || null;
}

/**
 * Resolve the principal/actor id for a given actor. Returns the account id
 * directly since the principal table no longer exists.
 */
export async function resolveActorPrincipalId(
  db: D1Database,
  actorId: string
): Promise<string | null> {
  const drizzle = getDb(db);
  const account = await drizzle.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, actorId)).get();
  return account?.id || null;
}

export async function getPrincipalById(
  db: D1Database,
  principalId: string
): Promise<Principal | null> {
  const drizzle = getDb(db);
  const row = await drizzle.select({
    id: accounts.id,
    type: accounts.type,
    name: accounts.name,
    createdAt: accounts.createdAt,
    updatedAt: accounts.updatedAt,
  }).from(accounts).where(eq(accounts.id, principalId)).get();

  return row ? accountToPrincipal(row) : null;
}
