/**
 * Resolve the Takosumi OIDC subject for a Takos user.
 *
 * The Takosumi Accounts OIDC provider sub is stored as `<issuer>#<subject>` in
 * the `auth_identities` row for the user's `oidc` provider. App-installation
 * routes use the bare subject when proxying Installation plan/apply to the
 * Takosumi deploy control API on behalf of the user.
 */
import type { Env } from "../../../shared/types/index.ts";
import { authIdentities, getDb } from "../../../infra/db/index.ts";
import { and, desc, eq } from "drizzle-orm";

/** Extract the bare subject from a `<issuer>#<subject>` provider sub. */
export function subjectFromProviderSub(providerSub: string): string | null {
  const marker = providerSub.lastIndexOf("#");
  if (marker < 0 || marker === providerSub.length - 1) return null;
  return providerSub.slice(marker + 1);
}

/**
 * Resolve the most recently used Takosumi OIDC subject for a user, or `null`
 * when the user has no `oidc` identity (or the stored provider sub has no
 * subject component).
 */
export async function resolveTakosumiSubject(
  env: Env,
  userId: string,
): Promise<string | null> {
  const row = await getDb(env.DB).select({
    providerSub: authIdentities.providerSub,
  }).from(authIdentities)
    .where(and(
      eq(authIdentities.userId, userId),
      eq(authIdentities.provider, "oidc"),
    ))
    .orderBy(desc(authIdentities.lastLoginAt))
    .limit(1)
    .get();
  return row ? subjectFromProviderSub(row.providerSub) : null;
}
