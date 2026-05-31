/**
 * Account-backed principal helpers.
 *
 * Principal identity is carried by the Account model directly in the current
 * identity model.
 */

import type { Principal, PrincipalKind } from "../../../shared/types/index.ts";
import {
  accounts,
  getDb,
  type SqlDatabaseLike,
} from "../../../infra/db/index.ts";
import { eq } from "drizzle-orm";
import { textDate } from "../../../shared/utils/db-guards.ts";

export const principalsDeps = {
  getDb,
};

const KNOWN_PRINCIPAL_KINDS = new Set([
  "user",
  "space_agent",
  "service",
  "system",
  "tenant_worker",
]);

function normalizePrincipalType(
  type: string | null | undefined,
): PrincipalKind {
  return KNOWN_PRINCIPAL_KINDS.has(type ?? "")
    ? (type as PrincipalKind)
    : "service";
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

/** Resolve a user principal id; the account id is the canonical value. */
export async function resolveUserPrincipalId(
  db: SqlDatabaseLike,
  userId: string,
): Promise<string | null> {
  const drizzle = principalsDeps.getDb(db);
  const row = await drizzle.select({ id: accounts.id }).from(accounts).where(
    eq(accounts.id, userId),
  ).get();
  return row?.id || null;
}

/** Resolve the principal/actor id for a given actor. */
export async function resolveActorPrincipalId(
  db: SqlDatabaseLike,
  actorId: string,
): Promise<string | null> {
  const drizzle = principalsDeps.getDb(db);
  const account = await drizzle.select({ id: accounts.id }).from(accounts)
    .where(eq(accounts.id, actorId)).get();
  return account?.id || null;
}

export async function getPrincipalById(
  db: SqlDatabaseLike,
  principalId: string,
): Promise<Principal | null> {
  const drizzle = principalsDeps.getDb(db);
  const row = await drizzle.select({
    id: accounts.id,
    type: accounts.type,
    name: accounts.name,
    createdAt: accounts.createdAt,
    updatedAt: accounts.updatedAt,
  }).from(accounts).where(eq(accounts.id, principalId)).get();

  return row ? accountToPrincipal(row) : null;
}
