import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";
import {
  accountEnvVars,
  accountStorageFiles,
  accountMemberships,
  accountMetadata,
  accounts,
  agentTasks,
  apps,
  blobs,
  bundleDeployments,
  chunks,
  deployments,
  edges,
  featuredAppPreinstallJobs,
  files,
  getDb,
  groups,
  indexJobs,
  infoUnits,
  infraEndpoints,
  interfaceFileHandlers,
  mcpOauthPending,
  mcpRegistrySources,
  mcpServers,
  mcpToolConfirmations,
  mcpToolPolicies,
  memories,
  memoryClaimEdges,
  memoryClaims,
  memoryEvidence,
  memoryPaths,
  nodes,
  repositories,
  reminders,
  resources,
  runs,
  services,
  sessions,
  skills,
  snapshots,
  threads,
  uiExtensions,
  workspaceDeletionReceipts,
  type SqlDatabaseLike,
} from "../../../infra/db/index.ts";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import type {
  Env,
  SecurityPosture,
  Space,
} from "../../../shared/types/index.ts";
import {
  MAX_SPACE_DESCRIPTION_CHARACTERS,
  MAX_SPACE_NAME_CHARACTERS,
} from "../../../shared/types/index.ts";
import { generateId, slugifyName } from "../../../shared/utils/index.ts";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
} from "@takos/worker-platform-utils/errors";
import {
  accountToWorkspace,
  spaceCrudDeps,
  type SpaceListItem,
  toPersonalWorkspaceListItem,
} from "./space-crud-shared.ts";
import { loadSpaceById } from "./space-crud-read.ts";
import {
  enqueueFeaturedAppPreinstallJob,
  processFeaturedAppPreinstallJobs,
} from "../source/featured-app-catalog.ts";
import { logWarn } from "../../../shared/utils/logger.ts";
import { clientOperationRowId } from "../../../shared/utils/client-operation-id.ts";
import { CLIENT_OPERATION_ID_PATTERN } from "../../../shared/utils/client-operation-id.ts";
import { computeSHA256 } from "../../../shared/utils/hash.ts";
import { checkSpaceAccess } from "./space-access.ts";
import {
  listInstallableAppCapsules,
  resolveInstallableAppAccountsConfig,
} from "../source/installable-app-install.ts";

export const spaceCrudWriteDeps = {
  enqueueFeaturedAppPreinstallJob,
  processFeaturedAppPreinstallJobs,
  listInstallableAppCapsules,
  resolveInstallableAppAccountsConfig,
};

const WORKSPACE_CREATE_REQUEST_METADATA_KEY = "workspace.create_request";
// Existing databases store deletable category Workspaces with the historical
// `team` discriminator. It is a persistence tag only; Takos does not expose a
// team or membership model.
const CATEGORY_WORKSPACE_STORAGE_TYPE = "team" as const;

function normalizeWorkspaceName(name: string): string {
  const normalized = name.trim();
  if (!normalized || normalized.length > MAX_SPACE_NAME_CHARACTERS) {
    throw new BadRequestError("Invalid Workspace name");
  }
  return normalized;
}

function normalizeWorkspaceDescription(
  description: string | null | undefined,
): string | null | undefined {
  if (description === undefined) return undefined;
  if (description === null) return null;
  const normalized = description.trim();
  if (normalized.length > MAX_SPACE_DESCRIPTION_CHARACTERS) {
    throw new BadRequestError("Invalid Workspace description");
  }
  return normalized || null;
}

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
    name: string;
    slug: string;
    ownerUserId: string;
    ownerPrincipalId: string;
    description?: string | null;
    timestamp: string;
    idempotencySignature?: string;
  },
): Promise<void> {
  const {
    spaceId,
    name,
    slug,
    ownerUserId,
    ownerPrincipalId,
    description,
    timestamp,
    idempotencySignature,
  } = params;

  const drizzle = getDb(env.DB);

  // The two workspace rows (account + owner membership) are
  // a static write group with no intra-group reads, so we persist them with a
  // single drizzle `batch([...])`. On real Cloudflare D1 this maps to the
  // platform `batch()` API, which executes the statements atomically on the
  // leader — unlike sequential `BEGIN/COMMIT` prepared statements, which do NOT
  // compose against D1 (each is a stateless round-trip). On the local stateful
  // SQLite adapter the batch shim runs them sequentially within one client.
  await drizzle.batch([
    drizzle.insert(accounts).values({
      id: spaceId,
      type: CATEGORY_WORKSPACE_STORAGE_TYPE,
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
    ...(idempotencySignature
      ? [drizzle.insert(accountMetadata).values({
        accountId: spaceId,
        key: WORKSPACE_CREATE_REQUEST_METADATA_KEY,
        value: idempotencySignature,
        createdAt: timestamp,
        updatedAt: timestamp,
      })]
      : []),
  ]);
}

async function loadWorkspaceCreateRequestSignature(
  db: SqlDatabaseBinding,
  spaceId: string,
): Promise<string | null> {
  const row = await getDb(db).select({ value: accountMetadata.value })
    .from(accountMetadata)
    .where(
      and(
        eq(accountMetadata.accountId, spaceId),
        eq(accountMetadata.key, WORKSPACE_CREATE_REQUEST_METADATA_KEY),
      ),
    )
    .get();
  return row?.value ?? null;
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
      module: "spaces",
      spaceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function createWorkspace(
  env: Env,
  userId: string,
  name: string,
  options?: {
    id?: string;
    skipIdCheck?: boolean;
    description?: string;
    installFeaturedApps?: boolean;
    idempotencyKey?: string;
  },
): Promise<Space> {
  if (options?.id && options.idempotencyKey) {
    throw new BadRequestError(
      "Workspace id and idempotency key cannot both be supplied",
    );
  }
  const spaceId = options?.idempotencyKey
    ? clientOperationRowId("workspace", options.idempotencyKey)
    : options?.id || generateId();
  const timestamp = new Date().toISOString();
  const trimmedName = normalizeWorkspaceName(name);
  const description = normalizeWorkspaceDescription(options?.description);
  const ownerPrincipalId = await loadOwnerPrincipalId(env.DB, userId);
  const idempotencySignature = options?.idempotencyKey
    ? JSON.stringify({
      userId,
      kind: CATEGORY_WORKSPACE_STORAGE_TYPE,
      name: trimmedName,
      description: description ?? null,
      installFeaturedApps: options.installFeaturedApps ?? false,
    })
    : undefined;
  const isAcceptedReplay = (
    row: Awaited<ReturnType<typeof loadSpaceById>>,
    signature: string | null,
  ) =>
    Boolean(
      options?.idempotencyKey &&
        row && row.type === CATEGORY_WORKSPACE_STORAGE_TYPE &&
        row.ownerAccountId === userId && row.name === trimmedName &&
        row.description === (description ?? null) &&
        signature === idempotencySignature,
    );
  let existing = options?.skipIdCheck && !options.idempotencyKey
    ? undefined
    : await loadSpaceById(env.DB, spaceId);
  const existingSignature = existing && options?.idempotencyKey
    ? await loadWorkspaceCreateRequestSignature(env.DB, spaceId)
    : null;
  if (existing && !isAcceptedReplay(existing, existingSignature)) {
    throw new ConflictError(
      "Workspace operation key already belongs to another request",
    );
  }

  let preinstallJobId: string | null = null;
  const shouldInstallFeaturedApps = options?.installFeaturedApps ?? false;

  // Persist the workspace atomically (single D1 batch; see createSpaceBundle).
  // The featured-app preinstall job is intentionally a SEPARATE step rather than
  // part of the bundle write: it is enqueued with a deterministic id +
  // onConflictDoNothing, so it acts as idempotent service-layer compensation —
  // a failure here cannot corrupt the already-committed space, and a retry of
  // the whole call will not double-enqueue. This is the honest mitigation for
  // D1 (atomic batch for the static group, compensation for the follow-on job)
  // instead of a non-composing BEGIN/COMMIT that fakes atomicity.
  if (!existing) {
    const slug = await generateUniqueSlug(
      env.DB,
      slugifyName(trimmedName),
      spaceId.slice(0, 6),
    );
    try {
      await createSpaceBundle(env, {
        spaceId,
        name: trimmedName,
        slug,
        ownerUserId: userId,
        ownerPrincipalId,
        description: description ?? null,
        timestamp,
        idempotencySignature,
      });
    } catch (error) {
      const winner = options?.idempotencyKey
        ? await loadSpaceById(env.DB, spaceId)
        : undefined;
      const winnerSignature = winner
        ? await loadWorkspaceCreateRequestSignature(env.DB, spaceId)
        : null;
      if (!isAcceptedReplay(winner, winnerSignature)) throw error;
      existing = winner;
    }
  }

  if (shouldInstallFeaturedApps) {
    try {
      preinstallJobId = await spaceCrudWriteDeps.enqueueFeaturedAppPreinstallJob(
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
      logWarn("Failed to enqueue featured app preinstall job", {
        module: "spaces",
        spaceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (preinstallJobId) {
    await processFeaturedAppsAfterCommit(env, spaceId);
  }

  const space = await loadSpaceById(env.DB, spaceId);
  if (!space) {
    throw new Error(
      `Failed to load created space ${spaceId} (preinstallJobId=${
        preinstallJobId ?? "none"
      }): row not visible after commit; likely read-after-write replication delay`,
    );
  }

  return accountToWorkspace(space);
}

export async function updateWorkspace(
  db: SqlDatabaseLike,
  spaceId: string,
  updates: {
    name?: string;
    description?: string | null;
    ai_model?: string;
    model_backend?: string;
    security_posture?: SecurityPosture;
  },
): Promise<Space | null> {
  const current = await loadSpaceById(db, spaceId);
  if (!current) return null;

  const nextName = updates.name === undefined
    ? current.name
    : normalizeWorkspaceName(updates.name);
  const nextDescription = updates.description === undefined
    ? current.description
    : normalizeWorkspaceDescription(updates.description);
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
      description: nextDescription,
      aiModel: nextModel,
      modelBackend: nextModelBackend,
      securityPosture: nextSecurityPosture,
      updatedAt: timestamp,
    })
    .where(eq(accounts.id, spaceId));

  const updated = await loadSpaceById(db, spaceId);
  return updated ? accountToWorkspace(updated) : null;
}

export type WorkspaceDeletionReceipt = {
  operation_id: string;
  space_id: string;
  deleted_at: string;
};

export type WorkspaceDeletionReceiptPruneSummary = {
  cutoff: string;
  selected: number;
  deleted: number;
  hasMore: boolean;
};

export async function pruneWorkspaceDeletionReceipts(
  dbBinding: SqlDatabaseBinding,
  options: { maxAgeMs?: number; limit?: number } = {},
  now = Date.now(),
): Promise<WorkspaceDeletionReceiptPruneSummary> {
  const maxAgeMs = options.maxAgeMs ?? 30 * 24 * 60 * 60 * 1000;
  const limit = options.limit ?? 100;
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) {
    throw new TypeError("Invalid Workspace deletion receipt retention");
  }
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 1000) {
    throw new TypeError("Invalid Workspace deletion receipt prune limit");
  }
  const cutoff = new Date(now - maxAgeMs).toISOString();
  const db = getDb(dbBinding);
  const page = await db.select({
    operationId: workspaceDeletionReceipts.operationId,
  }).from(workspaceDeletionReceipts).where(
    lt(workspaceDeletionReceipts.deletedAt, cutoff),
  ).orderBy(
    asc(workspaceDeletionReceipts.deletedAt),
    asc(workspaceDeletionReceipts.operationId),
  ).limit(limit + 1).all();
  const selected = page.slice(0, limit);
  let deleted = 0;
  if (selected.length > 0) {
    const deletedRows = await db.delete(workspaceDeletionReceipts).where(
      inArray(
        workspaceDeletionReceipts.operationId,
        selected.map((row) => row.operationId),
      ),
    ).returning({ operationId: workspaceDeletionReceipts.operationId }).all();
    deleted = deletedRows.length;
  }
  return {
    cutoff,
    selected: selected.length,
    deleted,
    hasMore: page.length > limit,
  };
}

async function workspaceDeletionSignature(input: {
  userId: string;
  spaceId: string;
  workspaceName: string;
}): Promise<string> {
  return await computeSHA256(JSON.stringify({
    userId: input.userId,
    spaceId: input.spaceId,
    workspaceName: input.workspaceName,
  }));
}

async function loadWorkspaceDeletionReceipt(
  db: SqlDatabaseBinding,
  operationId: string,
): Promise<{
  operationId: string;
  workspaceId: string;
  requestedByUserId: string;
  requestSignature: string;
  deletedAt: string;
} | null> {
  return await getDb(db).select().from(workspaceDeletionReceipts).where(
    eq(workspaceDeletionReceipts.operationId, operationId),
  ).limit(1).get() ?? null;
}

async function findWorkspaceDeletionBlocker(
  dbBinding: SqlDatabaseBinding,
  spaceId: string,
): Promise<string | null> {
  const db = getDb(dbBinding);
  // One read proves every category. This keeps deletion preflight bounded even
  // as the fail-closed ownership set grows, and avoids paying one D1 round trip
  // per table. The migration trigger repeats the same set to close the race
  // between this descriptive preflight and the final account-row transition.
  const state = await db.select({
    chatsAndRuns: sql<number>`
      EXISTS (SELECT 1 FROM ${threads} WHERE ${threads.accountId} = ${spaceId}) OR
      EXISTS (SELECT 1 FROM ${runs} WHERE ${runs.accountId} = ${spaceId})
    `,
    agentState: sql<number>`
      EXISTS (SELECT 1 FROM ${agentTasks} WHERE ${agentTasks.accountId} = ${spaceId}) OR
      EXISTS (SELECT 1 FROM ${memories} WHERE ${memories.accountId} = ${spaceId}) OR
      EXISTS (SELECT 1 FROM ${memoryClaims} WHERE ${memoryClaims.accountId} = ${spaceId}) OR
      EXISTS (SELECT 1 FROM ${memoryEvidence} WHERE ${memoryEvidence.accountId} = ${spaceId}) OR
      EXISTS (SELECT 1 FROM ${memoryClaimEdges} WHERE ${memoryClaimEdges.accountId} = ${spaceId}) OR
      EXISTS (SELECT 1 FROM ${memoryPaths} WHERE ${memoryPaths.accountId} = ${spaceId}) OR
      EXISTS (SELECT 1 FROM ${reminders} WHERE ${reminders.accountId} = ${spaceId}) OR
      EXISTS (SELECT 1 FROM ${skills} WHERE ${skills.accountId} = ${spaceId})
    `,
    storage: sql<number>`
      EXISTS (SELECT 1 FROM ${accountStorageFiles} WHERE ${accountStorageFiles.accountId} = ${spaceId})
    `,
    sourceAndIndex: sql<number>`
      EXISTS (SELECT 1 FROM ${files} WHERE ${files.accountId} = ${spaceId}) OR
      EXISTS (SELECT 1 FROM ${chunks} WHERE ${chunks.accountId} = ${spaceId}) OR
      EXISTS (SELECT 1 FROM ${indexJobs} WHERE ${indexJobs.accountId} = ${spaceId}) OR
      EXISTS (SELECT 1 FROM ${infoUnits} WHERE ${infoUnits.accountId} = ${spaceId})
    `,
    connections: sql<number>`
      EXISTS (SELECT 1 FROM ${accountEnvVars} WHERE ${accountEnvVars.accountId} = ${spaceId}) OR
      EXISTS (SELECT 1 FROM ${mcpOauthPending} WHERE ${mcpOauthPending.accountId} = ${spaceId}) OR
      EXISTS (SELECT 1 FROM ${mcpRegistrySources} WHERE ${mcpRegistrySources.accountId} = ${spaceId}) OR
      EXISTS (SELECT 1 FROM ${mcpServers} WHERE ${mcpServers.accountId} = ${spaceId}) OR
      EXISTS (SELECT 1 FROM ${mcpToolConfirmations} WHERE ${mcpToolConfirmations.accountId} = ${spaceId}) OR
      EXISTS (SELECT 1 FROM ${mcpToolPolicies} WHERE ${mcpToolPolicies.accountId} = ${spaceId})
    `,
    git: sql<number>`
      EXISTS (SELECT 1 FROM ${repositories} WHERE ${repositories.accountId} = ${spaceId}) OR
      EXISTS (SELECT 1 FROM ${snapshots} WHERE ${snapshots.accountId} = ${spaceId}) OR
      EXISTS (SELECT 1 FROM ${blobs} WHERE ${blobs.accountId} = ${spaceId})
    `,
    sessions: sql<number>`
      EXISTS (SELECT 1 FROM ${sessions} WHERE ${sessions.accountId} = ${spaceId})
    `,
    installedApps: sql<number>`
      EXISTS (SELECT 1 FROM ${apps} WHERE ${apps.accountId} = ${spaceId}) OR
      EXISTS (SELECT 1 FROM ${services} WHERE ${services.accountId} = ${spaceId}) OR
      EXISTS (SELECT 1 FROM ${bundleDeployments} WHERE ${bundleDeployments.accountId} = ${spaceId}) OR
      EXISTS (SELECT 1 FROM ${deployments} WHERE ${deployments.accountId} = ${spaceId})
    `,
    managedResources: sql<number>`
      EXISTS (SELECT 1 FROM ${groups} WHERE ${groups.spaceId} = ${spaceId}) OR
      EXISTS (
        SELECT 1 FROM ${resources}
        WHERE ${resources.accountId} = ${spaceId} OR ${resources.ownerAccountId} = ${spaceId}
      ) OR
      EXISTS (SELECT 1 FROM ${edges} WHERE ${edges.accountId} = ${spaceId}) OR
      EXISTS (SELECT 1 FROM ${nodes} WHERE ${nodes.accountId} = ${spaceId}) OR
      EXISTS (SELECT 1 FROM ${infraEndpoints} WHERE ${infraEndpoints.accountId} = ${spaceId}) OR
      EXISTS (SELECT 1 FROM ${interfaceFileHandlers} WHERE ${interfaceFileHandlers.accountId} = ${spaceId}) OR
      EXISTS (SELECT 1 FROM ${uiExtensions} WHERE ${uiExtensions.accountId} = ${spaceId})
    `,
    featuredAppState: sql<number>`
      EXISTS (
        SELECT 1 FROM ${featuredAppPreinstallJobs}
        WHERE ${featuredAppPreinstallJobs.spaceId} = ${spaceId}
      )
    `,
  }).from(accounts).where(eq(accounts.id, spaceId)).limit(1).get();

  if (!state) {
    return "unverified Workspace state";
  }

  const orderedBlockers: Array<[keyof typeof state, string]> = [
    ["chatsAndRuns", "Chats and Runs"],
    ["agentState", "Agent tasks, Memories, Reminders, or Skills"],
    ["storage", "Storage files"],
    ["sourceAndIndex", "source files or search indexes"],
    ["connections", "Connections"],
    ["git", "Git repositories or objects"],
    ["sessions", "working sessions"],
    ["installedApps", "installed Apps"],
    ["managedResources", "managed resources"],
    ["featuredAppState", "featured App installation state"],
  ];
  for (const [key, label] of orderedBlockers) {
    if (state?.[key]) return label;
  }
  return null;
}

async function assertNoCanonicalCapsules(
  env: Env,
  spaceId: string,
): Promise<void> {
  const config = spaceCrudWriteDeps.resolveInstallableAppAccountsConfig(env);
  // Standalone Takos has no external canonical Capsule ledger to verify. Once
  // an integration is configured, however, deletion must fail closed if that
  // authority cannot prove the Workspace has no Capsules.
  if (!config) return;
  let result: Awaited<ReturnType<typeof listInstallableAppCapsules>>;
  try {
    result = await spaceCrudWriteDeps.listInstallableAppCapsules(
      spaceId,
      config,
    );
  } catch {
    throw new ServiceUnavailableError(
      "Workspace deletion could not verify canonical Capsule state",
    );
  }
  if (result.status < 200 || result.status >= 300) {
    throw new ServiceUnavailableError(
      "Workspace deletion could not verify canonical Capsule state",
    );
  }
  const capsules = result.body?.capsules;
  if (!Array.isArray(capsules)) {
    throw new ServiceUnavailableError(
      "Workspace deletion received invalid canonical Capsule state",
    );
  }
  if (capsules.length > 0 || result.body?.nextCursor) {
    throw new ConflictError(
      "Workspace must have all Capsules uninstalled before deletion",
    );
  }
}

export async function deleteWorkspace(
  env: Env,
  userId: string,
  spaceIdOrSlug: string,
  input: { workspaceName: string; idempotencyKey: string },
): Promise<WorkspaceDeletionReceipt> {
  if (!CLIENT_OPERATION_ID_PATTERN.test(input.idempotencyKey)) {
    throw new BadRequestError("Invalid Workspace deletion operation id");
  }

  const replay = await loadWorkspaceDeletionReceipt(
    env.DB,
    input.idempotencyKey,
  );
  if (replay) {
    const expected = await workspaceDeletionSignature({
      userId,
      spaceId: replay.workspaceId,
      workspaceName: input.workspaceName,
    });
    if (
      replay.requestedByUserId !== userId ||
      replay.requestSignature !== expected ||
      replay.workspaceId !== spaceIdOrSlug
    ) {
      throw new ConflictError(
        "Workspace deletion operation key belongs to another request",
      );
    }
    return {
      operation_id: replay.operationId,
      space_id: replay.workspaceId,
      deleted_at: replay.deletedAt,
    };
  }

  const access = await checkSpaceAccess(env.DB, spaceIdOrSlug, userId);
  if (!access || access.space.kind === "user") {
    throw new NotFoundError("Workspace");
  }
  const spaceId = access.space.id;
  if (spaceIdOrSlug !== spaceId) {
    throw new BadRequestError(
      "Workspace deletion requires the canonical Workspace id",
    );
  }
  if (input.workspaceName !== access.space.name) {
    throw new ConflictError("Workspace name confirmation does not match");
  }

  const blocker = await findWorkspaceDeletionBlocker(env.DB, spaceId);
  if (blocker) {
    throw new ConflictError(
      `Workspace cannot be safely deleted while it contains ${blocker}`,
    );
  }
  await assertNoCanonicalCapsules(env, spaceId);

  const deletedAt = new Date().toISOString();
  const signature = await workspaceDeletionSignature({
    userId,
    spaceId,
    workspaceName: input.workspaceName,
  });
  const db = getDb(env.DB);
  try {
    await db.batch([
      db.insert(workspaceDeletionReceipts).values({
        operationId: input.idempotencyKey,
        workspaceId: spaceId,
        requestedByUserId: userId,
        requestSignature: signature,
        deletedAt,
      }),
      db.delete(accounts).where(eq(accounts.id, spaceId)),
    ]);
  } catch (error) {
    const winner = await loadWorkspaceDeletionReceipt(
      env.DB,
      input.idempotencyKey,
    );
    if (
      !winner || winner.workspaceId !== spaceId ||
      winner.requestedByUserId !== userId ||
      winner.requestSignature !== signature
    ) throw error;
    return {
      operation_id: winner.operationId,
      space_id: winner.workspaceId,
      deleted_at: winner.deletedAt,
    };
  }

  return {
    operation_id: input.idempotencyKey,
    space_id: spaceId,
    deleted_at: deletedAt,
  };
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

  return toPersonalWorkspaceListItem(userAccount);
}

async function enqueuePersonalWorkspaceFeaturedApps(
  env: Env,
  userId: string,
): Promise<void> {
  try {
    const preinstallJobId =
      await spaceCrudWriteDeps.enqueueFeaturedAppPreinstallJob(env, {
        spaceId: userId,
        createdByAccountId: userId,
        timestamp: new Date().toISOString(),
      });
    if (preinstallJobId) {
      await processFeaturedAppsAfterCommit(env, userId);
    }
  } catch (error) {
    logWarn("Failed to enqueue personal featured app preinstall job", {
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
    await enqueuePersonalWorkspaceFeaturedApps(env, userId);
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
