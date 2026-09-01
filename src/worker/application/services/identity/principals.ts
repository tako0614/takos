/**
 * Account-backed principal helpers.
 *
 * Principal identity is carried by the Account model directly in the current
 * identity model.
 */

import {
  accounts,
  getDb,
  type SqlDatabaseLike,
} from "../../../infra/db/index.ts";
import { and, eq } from "drizzle-orm";

/** Resolve a user principal id; the account id is the canonical value. */
export async function resolveUserPrincipalId(
  db: SqlDatabaseLike,
  userId: string,
): Promise<string | null> {
  const drizzle = getDb(db);
  const row = await drizzle.select({ id: accounts.id }).from(accounts).where(
    and(
      eq(accounts.id, userId),
      eq(accounts.type, "user"),
      eq(accounts.status, "active"),
    ),
  ).get();
  return row?.id || null;
}

/** Resolve the principal/actor id for a given actor. */
export async function resolveActorPrincipalId(
  db: SqlDatabaseLike,
  actorId: string,
): Promise<string | null> {
  const drizzle = getDb(db);
  const account = await drizzle.select({ id: accounts.id }).from(accounts)
    .where(and(eq(accounts.id, actorId), eq(accounts.status, "active"))).get();
  return account?.id || null;
}
