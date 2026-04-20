import { and, eq } from "drizzle-orm";
import {
  accountMemberships,
  accounts,
  getDb,
  repositories,
} from "../../../infra/db/index.ts";
import type { D1Database } from "../../../shared/types/bindings.ts";
import type {
  Env,
  Repository,
  SecurityPosture,
  Space,
} from "../../../shared/types/index.ts";
import { generateId, slugifyName } from "../../../shared/utils/index.ts";
import {
  accountToWorkspace,
  spaceCrudDeps,
  type SpaceListItem,
  toPersonalWorkspaceListItem,
} from "./space-crud-shared.ts";
import {
  findLatestRepositoryBySpaceId,
  getRepositoryById,
  loadSpaceById,
} from "./space-crud-read.ts";
import { enqueueDefaultAppPreinstallJob } from "../source/default-app-distribution.ts";
import { logWarn } from "../../../shared/utils/logger.ts";

export const spaceCrudWriteDeps = {
  enqueueDefaultAppPreinstallJob,
};

async function generateUniqueSlug(
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

async function loadOwnerPrincipalId(
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

async function createSpaceBundle(
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
    modelBackend: "openai",
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

async function ensureSelfMembership(
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

export async function createWorkspaceWithDefaultRepo(
  env: Env,
  userId: string,
  name: string,
  options?: {
    id?: string;
    skipIdCheck?: boolean;
    kind?: "team";
    description?: string;
  },
): Promise<{ workspace: Space; repository: Repository | null }> {
  const spaceId = options?.id || generateId();
  const repoId = generateId();
  const timestamp = new Date().toISOString();
  const kind = options?.kind || "team";
  const trimmedName = name.trim();
  const slug = await generateUniqueSlug(
    env.DB,
    slugifyName(trimmedName),
    spaceId.slice(0, 6),
  );
  const ownerPrincipalId = await loadOwnerPrincipalId(env.DB, userId);

  if (!options?.skipIdCheck) {
    const drizzle = getDb(env.DB);
    const existing = await drizzle
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, spaceId))
      .limit(1)
      .get();
    if (existing) {
      throw new Error("Space ID already exists");
    }
  }

  await createSpaceBundle(env, {
    spaceId,
    kind,
    name: trimmedName,
    slug,
    ownerUserId: userId,
    ownerPrincipalId,
    description: options?.description ?? null,
    repoId,
    repoName: "main",
    timestamp,
  });
  try {
    await spaceCrudWriteDeps.enqueueDefaultAppPreinstallJob(env, {
      spaceId,
      createdByAccountId: userId,
      timestamp,
    });
  } catch (error) {
    logWarn("Failed to enqueue default app preinstall job", {
      module: "spaces",
      spaceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const space = await loadSpaceById(env.DB, spaceId);
  const repository = await getRepositoryById(env.DB, repoId);
  if (!space) {
    throw new Error("Failed to load created space");
  }

  return { workspace: accountToWorkspace(space), repository };
}

export async function updateWorkspace(
  db: D1Database,
  spaceId: string,
  updates: {
    name?: string;
    ai_model?: string;
    model_backend?: string;
    security_posture?: SecurityPosture;
  },
): Promise<Space | null> {
  const current = await loadSpaceById(db, spaceId);
  if (!current) return null;

  const nextName = updates.name ?? current.name;
  const nextModel = updates.ai_model ?? current.aiModel;
  const nextModelBackend = updates.model_backend ?? current.modelBackend;
  const nextSecurityPosture = updates.security_posture ??
    (current.securityPosture === "restricted_egress"
      ? "restricted_egress"
      : "standard");
  const timestamp = new Date().toISOString();

  const drizzle = getDb(db);
  await drizzle
    .update(accounts)
    .set({
      name: nextName,
      aiModel: nextModel,
      modelBackend: nextModelBackend,
      securityPosture: nextSecurityPosture,
      updatedAt: timestamp,
    })
    .where(eq(accounts.id, spaceId));

  const updated = await loadSpaceById(db, spaceId);
  return updated ? accountToWorkspace(updated) : null;
}

export async function deleteWorkspace(
  db: D1Database,
  spaceId: string,
): Promise<void> {
  const drizzle = getDb(db);
  await drizzle.delete(accounts).where(eq(accounts.id, spaceId));
}

export async function getPersonalWorkspace(
  env: Env,
  userId: string,
): Promise<SpaceListItem | null> {
  const drizzle = getDb(env.DB);
  const userAccount = await drizzle.select().from(accounts)
    .where(and(eq(accounts.id, userId), eq(accounts.type, "user")))
    .limit(1)
    .get();
  if (!userAccount) return null;

  await ensureSelfMembership(env.DB, userId);

  const repo = await findLatestRepositoryBySpaceId(env.DB, userId);
  return toPersonalWorkspaceListItem(userAccount, repo);
}

export async function getOrCreatePersonalWorkspace(
  env: Env,
  userId: string,
): Promise<SpaceListItem | null> {
  return getPersonalWorkspace(env, userId);
}

export async function ensurePersonalWorkspace(
  env: Env,
  userId: string,
): Promise<boolean> {
  await ensureSelfMembership(env.DB, userId);
  return true;
}
