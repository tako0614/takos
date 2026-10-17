import { and, eq } from "drizzle-orm";
import { getDb } from "../../../infra/db/index.ts";
import { accounts, authIdentities } from "../../../infra/db/schema.ts";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";

/** The operator pins the only local account to one exact OIDC issuer/sub pair. */
export function configuredOwner(input: {
  issuer?: string | null;
  subject?: string | null;
}): { issuer: string; subject: string; providerSub: string } | null {
  const issuer = input.issuer;
  const subject = input.subject;
  if (
    typeof issuer !== "string" || !issuer || issuer !== issuer.trim() ||
    typeof subject !== "string" ||
    !/^[\x20-\x7e]{1,255}$/.test(subject) || subject !== subject.trim()
  ) return null;
  let normalizedIssuer: string;
  try {
    const url = new URL(issuer);
    if (
      url.username || url.password || url.search || url.hash ||
      !["https:", "http:"].includes(url.protocol)
    ) {
      return null;
    }
    normalizedIssuer = url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
  return { issuer: normalizedIssuer, subject, providerSub: `${normalizedIssuer}#${subject}` };
}

/** Reads the identity on every cookie request, including a cached-user hit. */
export async function isActiveOwnerAccount(
  dbBinding: SqlDatabaseBinding,
  owner: NonNullable<ReturnType<typeof configuredOwner>>,
  userId: string,
): Promise<boolean> {
  const db = getDb(dbBinding);
  const identity = await db.select({ userId: authIdentities.userId })
    .from(authIdentities)
    .where(and(
      eq(authIdentities.provider, "oidc"),
      eq(authIdentities.providerSub, owner.providerSub),
    )).get();
  if (identity?.userId !== userId) return false;
  const account = await db.select({ status: accounts.status }).from(accounts)
    .where(eq(accounts.id, userId)).get();
  return account?.status === "active";
}
