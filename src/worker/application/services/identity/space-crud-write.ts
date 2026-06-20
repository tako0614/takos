import { and, eq } from "drizzle-orm";
import {
  accountMemberships,
  accounts,
  getDb,
  repositories,
} from "../../../infra/db/index.ts";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import type {
  Env,
  Repository,
  SecurityPosture,
  Space,
} from "../../../shared/types/index.ts";
import { generateId, slugifyName } from "../../../shared/utils/index.ts";
import { ConflictError } from "@takos/worker-platform-utils/errors";
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
import {
  enqueueDefaultAppPreinstallJob,
  processDefaultAppPreinstallJobs,
} from "../source/default-app-distribution.ts";
import { ensureServiceGraphExports } from "../platform/service-graph-exports.ts";
import { logWarn } from "../../../shared/utils/logger.ts";

export const spaceCrudWriteDeps = {
  enqueueDefaultAppPreinstallJob,
  ensureServiceGraphExports,
  processDefaultAppPreinstallJobs,
};

async function generateUniqueSlug(
  db: SqlDatabaseBinding,
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
  db: SqlDatabaseBinding,
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

  // The three space-bundle rows (account + owner membership + default repo) are
  // a static write group with no intra-group reads, so we persist them with a
  // single drizzle `batch([...])`. On real Cloudflare D1 this maps to the
  // platform `batch()` API, which executes the statements atomically on the
  // leader — unlike sequential `BEGIN/COMMIT` prepared statements, which do NOT
  // compose against D1 (each is a stateless round-trip). On the local stateful
  // SQLite adapter the batch shim runs them sequentially within one client.
  await drizzle.batch([
    drizzle.insert(accounts).values({
      id: spaceId,
      type: kind,
      status: "active",
      name,
      slug,
      description: description || null,
      ownerAccountId: ownerUserId,
      aiModel: "gpt-5.5",
      modelBackend: "openai",
      securityPosture: "standard",
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
    drizzle.insert(accountMemberships).values({
      id: generateId(),
      accountId: spaceId,
      memberId: ownerPrincipalId,
      role: "owner",
      status: "active",
      updatedAt: timestamp,
      createdAt: timestamp,
    }),
    drizzle.insert(repositories).values({
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
    }),
  ]);
}

async function ensureSelfMembership(
  db: SqlDatabaseBinding,
  userId: string,
): Promise<void> {
  const principalId = await spaceCrudDeps.resolveUserPrincipalId(db, userId);
  if (!principalId) return;

  const drizzle = getDb(db);
  const existing = await drizzle
    .select({ id: accountMemberships.id })
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

async function processDefaultAppsAfterCommit(
  env: Env,
  spaceId: string,
): Promise<void> {
  try {
    await spaceCrudWriteDeps.processDefaultAppPreinstallJobs(env, {
      limit: 1,
      spaceId,
    });
  } catch (error) {
    logWarn("Default app preinstall immediate processing failed", {
      module: "spaces",
      spaceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function ensureServiceGraphExportsAfterCommit(
  env: Env,
  spaceId: string,
): Promise<void> {
  try {
    await spaceCrudWriteDeps.ensureServiceGraphExports(env, {
      spaceId,
    });
  } catch (error) {
    logWarn("Failed to seed service graph exports", {
      module: "spaces",
      spaceId,
      error: error instanceof Error ? error.message : String(error),
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
    installDefaultApps?: boolean;
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
      throw new ConflictError("Space ID already exists");
    }
  }

  let preinstallJobId: string | null = null;
  const shouldInstallDefaultApps = options?.installDefaultApps ?? true;

  // Persist the space bundle atomically (single D1 batch; see createSpaceBundle).
  // The default-app preinstall job is intentionally a SEPARATE step rather than
  // part of the bundle write: it is enqueued with a deterministic id +
  // onConflictDoNothing, so it acts as idempotent service-layer compensation —
  // a failure here cannot corrupt the already-committed space, and a retry of
  // the whole call will not double-enqueue. This is the honest mitigation for
  // D1 (atomic batch for the static group, compensation for the follow-on job)
  // instead of a non-composing BEGIN/COMMIT that fakes atomicity.
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

  await ensureServiceGraphExportsAfterCommit(env, spaceId);

  if (shouldInstallDefaultApps) {
    try {
      preinstallJobId = await spaceCrudWriteDeps.enqueueDefaultAppPreinstallJob(
        env,
        {
          spaceId,
          createdByAccountId: userId,
          timestamp,
        },
      );
    } catch (error) {
      // The space bundle is already durably committed; a failed preinstall
      // enqueue is recoverable (idempotent re-enqueue on next access), so log
      // and continue rather than tearing down a valid space.
      logWarn("Failed to enqueue default app preinstall job", {
        module: "spaces",
        spaceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (preinstallJobId) {
    await processDefaultAppsAfterCommit(env, spaceId);
  }

  const space = await loadSpaceById(env.DB, spaceId);
  const repository = await getRepositoryById(env.DB, repoId);
  if (!space) {
    throw new Error(
      `Failed to load created space ${spaceId} (repoId=${repoId}, preinstallJobId=${
        preinstallJobId ?? "none"
      }): row not visible after commit; likely read-after-write replication delay`,
    );
  }

  return { workspace: accountToWorkspace(space), repository };
}

export async function updateWorkspace(
  db: SqlDatabaseBinding,
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
  const nextSecurityPosture =
    updates.security_posture ??
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
  env: Env,
  spaceId: string,
): Promise<void> {
  const drizzle = getDb(env.DB);
  await drizzle.delete(accounts).where(eq(accounts.id, spaceId));
}

export async function getPersonalWorkspace(
  env: Env,
  userId: string,
): Promise<SpaceListItem | null> {
  const drizzle = getDb(env.DB);
  const userAccount = await drizzle
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, userId), eq(accounts.type, "user")))
    .limit(1)
    .get();
  if (!userAccount) return null;

  await ensureSelfMembership(env.DB, userId);

  const repo = await findLatestRepositoryBySpaceId(env.DB, userId);
  return toPersonalWorkspaceListItem(userAccount, repo);
}

async function enqueuePersonalWorkspaceDefaultApps(
  env: Env,
  userId: string,
): Promise<void> {
  try {
    const preinstallJobId =
      await spaceCrudWriteDeps.enqueueDefaultAppPreinstallJob(env, {
        spaceId: userId,
        createdByAccountId: userId,
        timestamp: new Date().toISOString(),
      });
    if (preinstallJobId) {
      await processDefaultAppsAfterCommit(env, userId);
    }
  } catch (error) {
    logWarn("Failed to enqueue personal default app preinstall job", {
      module: "spaces",
      spaceId: userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function getOrCreatePersonalWorkspace(
  env: Env,
  userId: string,
): Promise<SpaceListItem | null> {
  const workspace = await getPersonalWorkspace(env, userId);
  if (workspace) {
    await ensureServiceGraphExportsAfterCommit(env, userId);
    await enqueuePersonalWorkspaceDefaultApps(env, userId);
  }
  return workspace;
}

export async function ensurePersonalWorkspace(
  env: Env,
  userId: string,
): Promise<boolean> {
  await ensureSelfMembership(env.DB, userId);
  return true;
}
