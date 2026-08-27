import { and, eq } from "drizzle-orm";

import {
  createWorkerWorkspaceCore,
  updateSqlWorkspaceModelSettings,
} from "../../../adapters/workspaces/index.ts";
import {
  accountMemberships,
  accounts,
  getDb,
  type SqlDatabaseLike,
} from "../../../infra/db/index.ts";
import type { Env, SecurityPosture, Space } from "../../../shared/types/index.ts";
import { generateId } from "../../../shared/utils/index.ts";
import { logWarn } from "../../../shared/utils/logger.ts";
import {
  enqueueFeaturedAppPreinstallJob,
  processFeaturedAppPreinstallJobs,
} from "../source/featured-app-catalog.ts";
import {
  coreWorkspaceToSpace,
  type SpaceListItem,
} from "./space-crud-shared.ts";

export const spaceCrudWriteDeps = {
  enqueueFeaturedAppPreinstallJob,
  processFeaturedAppPreinstallJobs,
};

async function processFeaturedAppsAfterCommit(
  env: Env,
  spaceId: string,
): Promise<void> {
  try {
    await spaceCrudWriteDeps.processFeaturedAppPreinstallJobs(env, {
      limit: 1,
      spaceId,
    });
  } catch (error) {
    logWarn("Featured app preinstall immediate processing failed", {
      module: "workspaces",
      spaceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function createWorkspace(
  env: Env,
  principalId: string,
  name: string,
  options?: {
    id?: string;
    description?: string;
    installFeaturedApps?: boolean;
  },
): Promise<Space> {
  const workspace = await createWorkerWorkspaceCore(env.DB).create(
    principalId,
    {
      id: options?.id,
      name,
      description: options?.description,
    },
  );

  let preinstallJobId: string | null = null;
  if (options?.installFeaturedApps ?? false) {
    try {
      preinstallJobId = await spaceCrudWriteDeps.enqueueFeaturedAppPreinstallJob(
        env,
        {
          spaceId: workspace.id,
          createdByAccountId: principalId,
          timestamp: workspace.createdAt,
        },
      );
    } catch (error) {
      logWarn("Failed to enqueue featured app preinstall job", {
        module: "workspaces",
        spaceId: workspace.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (preinstallJobId) {
    await processFeaturedAppsAfterCommit(env, workspace.id);
  }
  return coreWorkspaceToSpace(workspace);
}

export async function updateWorkspace(
  db: SqlDatabaseLike,
  principalId: string,
  spaceIdOrSlug: string,
  updates: {
    name?: string;
    description?: string | null;
    ai_model?: string;
    model_backend?: string;
    security_posture?: SecurityPosture;
  },
): Promise<Space | null> {
  const workspaces = createWorkerWorkspaceCore(db);
  let workspace = await workspaces.update(principalId, spaceIdOrSlug, {
    name: updates.name,
    description: updates.description,
    securityPosture: updates.security_posture,
  });
  if (!workspace) return null;

  if (updates.ai_model !== undefined || updates.model_backend !== undefined) {
    const updated = await updateSqlWorkspaceModelSettings(
      db,
      principalId,
      workspace.id,
      {
        model: updates.ai_model,
        backend: updates.model_backend,
        updatedAt: workspace.updatedAt,
      },
    );
    if (!updated) return null;
    workspace = await workspaces.resolve(principalId, workspace.id);
    if (!workspace) return null;
  }

  return coreWorkspaceToSpace(workspace);
}

export async function deleteWorkspace(
  env: Env,
  principalId: string,
  spaceIdOrSlug: string,
): Promise<boolean> {
  return await createWorkerWorkspaceCore(env.DB).delete(
    principalId,
    spaceIdOrSlug,
  );
}

async function ensureDefaultOwnershipWitness(
  db: SqlDatabaseLike,
  principalId: string,
): Promise<void> {
  const drizzle = getDb(db);
  const principal = await drizzle.select({ id: accounts.id }).from(accounts)
    .where(and(
      eq(accounts.id, principalId),
      eq(accounts.type, "user"),
      eq(accounts.status, "active"),
    )).limit(1).get();
  if (!principal) return;

  const existing = await drizzle.select({ id: accountMemberships.id })
    .from(accountMemberships).where(and(
      eq(accountMemberships.accountId, principalId),
      eq(accountMemberships.memberId, principalId),
      eq(accountMemberships.role, "owner"),
      eq(accountMemberships.status, "active"),
    )).limit(1).get();
  if (existing) return;

  const timestamp = new Date().toISOString();
  await drizzle.insert(accountMemberships).values({
    id: generateId(),
    accountId: principalId,
    memberId: principalId,
    role: "owner",
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
  }).onConflictDoNothing();
}

export async function getPersonalWorkspace(
  env: Env,
  principalId: string,
): Promise<SpaceListItem | null> {
  await ensureDefaultOwnershipWitness(env.DB, principalId);
  const workspace = await createWorkerWorkspaceCore(env.DB).resolve(
    principalId,
    "me",
  );
  return workspace ? coreWorkspaceToSpace(workspace) : null;
}

async function enqueuePersonalWorkspaceFeaturedApps(
  env: Env,
  principalId: string,
): Promise<void> {
  try {
    const preinstallJobId =
      await spaceCrudWriteDeps.enqueueFeaturedAppPreinstallJob(env, {
        spaceId: principalId,
        createdByAccountId: principalId,
        timestamp: new Date().toISOString(),
      });
    if (preinstallJobId) {
      await processFeaturedAppsAfterCommit(env, principalId);
    }
  } catch (error) {
    logWarn("Failed to enqueue personal featured app preinstall job", {
      module: "workspaces",
      spaceId: principalId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function getOrCreatePersonalWorkspace(
  env: Env,
  principalId: string,
): Promise<SpaceListItem | null> {
  const workspace = await getPersonalWorkspace(env, principalId);
  if (workspace) await enqueuePersonalWorkspaceFeaturedApps(env, principalId);
  return workspace;
}

export async function ensurePersonalWorkspace(
  env: Env,
  principalId: string,
): Promise<boolean> {
  await ensureDefaultOwnershipWitness(env.DB, principalId);
  return Boolean(
    await createWorkerWorkspaceCore(env.DB).resolve(principalId, "me"),
  );
}
