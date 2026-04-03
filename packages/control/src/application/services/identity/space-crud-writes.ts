import type { D1Database } from "../../../shared/types/bindings.ts";
import type { Env } from "../../../shared/types/index.ts";
import { generateId } from "../../../shared/utils/index.ts";
import {
  accountMemberships,
  accounts,
  getDb,
  repositories,
} from "../../../infra/db/index.ts";
import { and, eq } from "drizzle-orm";
import { spaceCrudDeps } from "./space-crud-deps.ts";

export async function generateUniqueSlug(
  db: D1Database,
  baseSlug: string,
  fallbackSuffix: string,
): Promise<string> {
  const drizzle = getDb(db);
  let slug = baseSlug;
  let suffix = 1;

  while (true) {
    const existing = await drizzle
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.slug, slug))
      .limit(1)
      .get();

    if (!existing) {
      return slug;
    }

    slug = `${baseSlug}-${suffix}`.slice(0, 32);
    suffix += 1;
    if (suffix > 100) {
      return `${baseSlug}-${fallbackSuffix}`.slice(0, 32);
    }
  }
}

export async function loadOwnerPrincipalId(
  db: D1Database,
  ownerUserId: string,
): Promise<string> {
  const principalId = await spaceCrudDeps.resolveUserPrincipalId(
    db,
    ownerUserId,
  );
  if (!principalId) {
    throw new Error(`Owner principal not found for user ${ownerUserId}`);
  }
  return principalId;
}

export async function createSpaceBundle(
  env: Env,
  params: {
    spaceId: string;
    kind: "user" | "team";
    name: string;
    slug: string;
    ownerUserId: string;
    ownerPrincipalId: string;
    description?: string | null;
    repoId: string;
    repoName: string;
    timestamp: string;
  },
): Promise<void> {
  const {
    spaceId,
    kind,
    name,
    slug,
    ownerUserId,
    ownerPrincipalId,
    description,
    repoId,
    repoName,
    timestamp,
  } = params;

  const drizzle = getDb(env.DB);

  await drizzle.insert(accounts).values({
    id: spaceId,
    type: kind,
    status: "active",
    name,
    slug,
    description: description || null,
    ownerAccountId: ownerUserId,
    aiModel: "gpt-5.4-nano",
    aiProvider: "openai",
    securityPosture: "standard",
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await drizzle.insert(accountMemberships).values({
    id: generateId(),
    accountId: spaceId,
    memberId: ownerPrincipalId,
    role: "owner",
    status: "active",
    updatedAt: timestamp,
    createdAt: timestamp,
  });

  await drizzle.insert(repositories).values({
    id: repoId,
    accountId: spaceId,
    name: repoName,
    description: `Default repository for ${name}`,
    visibility: "private",
    defaultBranch: "main",
    stars: 0,
    forks: 0,
    gitEnabled: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export async function ensureSelfMembership(
  db: D1Database,
  userId: string,
): Promise<void> {
  const principalId = await spaceCrudDeps.resolveUserPrincipalId(db, userId);
  if (!principalId) return;

  const drizzle = getDb(db);
  const existing = await drizzle.select({ id: accountMemberships.id })
    .from(accountMemberships)
    .where(
      and(
        eq(accountMemberships.accountId, userId),
        eq(accountMemberships.memberId, principalId),
      ),
    )
    .limit(1)
    .get();
  if (!existing) {
    const timestamp = new Date().toISOString();
    await drizzle.insert(accountMemberships).values({
      id: generateId(),
      accountId: userId,
      memberId: principalId,
      role: "owner",
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
}
