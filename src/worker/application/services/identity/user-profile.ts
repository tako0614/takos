/**
 * User profile mutations (account-backed).
 *
 * Owns writes to the user's `accounts` row for profile fields such as the
 * username (stored as the account `slug`). Route handlers validate input shape
 * and authorization; this module owns the DB read/write boundary.
 */
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import { accounts, getDb } from "../../../infra/db/index.ts";
import { and, eq, ne } from "drizzle-orm";

export type UpdateUsernameResult =
  | { ok: true }
  | { ok: false; reason: "taken" };

/**
 * Set the username (account slug) for a user.
 *
 * Returns `{ ok: false, reason: "taken" }` when another account already uses
 * the slug, otherwise applies the update and returns `{ ok: true }`.
 */
export async function updateUsername(
  dbBinding: SqlDatabaseBinding,
  userId: string,
  username: string,
): Promise<UpdateUsernameResult> {
  const db = getDb(dbBinding);

  const existing = await db.select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.slug, username), ne(accounts.id, userId)))
    .limit(1)
    .get();

  if (existing) {
    return { ok: false, reason: "taken" };
  }

  await db.update(accounts).set({
    slug: username,
    updatedAt: new Date().toISOString(),
  }).where(eq(accounts.id, userId));

  return { ok: true };
}
