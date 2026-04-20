import {
  type DeploymentEnv,
  DeploymentService,
} from "../../application/services/deployment/index.ts";
import { GroupDeploymentSnapshotService } from "../../application/services/platform/group-deployment-snapshots.ts";
import type { GroupBackendName } from "../../application/services/groups/records.ts";
import {
  type Database,
  defaultAppPreinstallJobs,
  deployments,
  getDb,
  groupDeploymentSnapshots,
  groups,
} from "../../infra/db/index.ts";
import { and, eq, isNull, ne, notInArray } from "drizzle-orm";
import { logError, logInfo, logWarn } from "../../shared/utils/logger.ts";
import type { Env } from "../../shared/types/index.ts";

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

export interface WorkerDeploymentQueueMessage {
  version: number;
  type: "deployment";
  deploymentId: string;
  timestamp: number;
}

export interface GroupDeploymentSnapshotQueueMessage {
  version: number;
  type: "group_deployment_snapshot";
  spaceId: string;
  groupId: string;
  groupName: string;
  repositoryUrl: string;
  ref: string;
  refType: "branch" | "tag" | "commit";
  createdByAccountId: string;
  backendName?: GroupBackendName;
  envName?: string;
  reason?: "default_app_preinstall";
  timestamp: number;
}

export type DeploymentQueueMessage =
  | WorkerDeploymentQueueMessage
  | GroupDeploymentSnapshotQueueMessage;

export function isValidDeploymentQueueMessage(
  msg: unknown,
): msg is DeploymentQueueMessage {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  if (m.version !== 1) return false;
  if (m.type === "deployment") {
    return typeof m.deploymentId === "string" &&
      typeof m.timestamp === "number";
  }
  if (m.type === "group_deployment_snapshot") {
    return typeof m.spaceId === "string" &&
      typeof m.groupId === "string" &&
      typeof m.groupName === "string" &&
      typeof m.repositoryUrl === "string" &&
      typeof m.ref === "string" &&
      ["branch", "tag", "commit"].includes(m.refType as string) &&
      typeof m.createdByAccountId === "string" &&
      (m.backendName === undefined ||
        ["cloudflare", "local", "aws", "gcp", "k8s"].includes(
          m.backendName as string,
        )) &&
      (m.envName === undefined || typeof m.envName === "string") &&
      (m.reason === undefined || m.reason === "default_app_preinstall") &&
      typeof m.timestamp === "number";
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main job handler
// ---------------------------------------------------------------------------

export async function handleDeploymentJob(
  message: DeploymentQueueMessage,
  env: DeploymentEnv,
): Promise<void> {
  if (message.type === "group_deployment_snapshot") {
    await handleGroupDeploymentSnapshotJob(message, env);
    return;
  }

  const { deploymentId } = message;
  logInfo(`Processing deployment ${deploymentId}`, { module: "deploy_queue" });

  const deploymentService = new DeploymentService(env);

  try {
    await deploymentService.executeDeployment(deploymentId);
    logInfo(`Deployment ${deploymentId} completed successfully`, {
      module: "deploy_queue",
    });
  } catch (error) {
    logError(`Deployment ${deploymentId} failed`, error, {
      module: "deploy_queue",
    });
    throw error; // Let the queue retry mechanism handle it
  }
}

function defaultAppBackendState(
  status: "in_progress" | "completed" | "failed",
  message: GroupDeploymentSnapshotQueueMessage,
  error?: unknown,
): string {
  return JSON.stringify({
    defaultAppDistribution: {
      preinstalled: true,
      repositoryUrl: message.repositoryUrl,
      ref: message.ref,
      refType: message.refType,
      deployJob: message,
      deployJobStatus: status,
      ...(error
        ? { error: error instanceof Error ? error.message : String(error) }
        : {}),
    },
  });
}

type CurrentGroupDeploymentSnapshot = {
  sourceKind: string | null;
  sourceRepositoryUrl: string | null;
  sourceRef: string | null;
  sourceRefType: string | null;
  status: string | null;
};

function defaultAppPreinstallJobId(spaceId: string): string {
  return `default-app-preinstall:${spaceId}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function changedRows(result: unknown): number | null {
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  const changes = record.changes ?? (record.meta as Record<string, unknown>)
    ?.changes ??
    record.rowsAffected;
  return typeof changes === "number" ? changes : null;
}

function parseExpectedGroupIds(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string =>
        typeof item === "string" && item.length > 0
      )
      : [];
  } catch {
    return [];
  }
}

function distributionContainsMessage(
  distributionJson: string | null | undefined,
  message: GroupDeploymentSnapshotQueueMessage,
): boolean {
  if (!distributionJson) return true;
  try {
    const parsed = JSON.parse(distributionJson) as unknown;
    if (!Array.isArray(parsed)) return false;
    return parsed.some((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const record = entry as Record<string, unknown>;
      return record.name === message.groupName &&
        record.repositoryUrl === message.repositoryUrl &&
        record.ref === message.ref &&
        record.refType === message.refType;
    });
  } catch {
    return false;
  }
}

function isDefaultAppPreinstallGroup(
  group: typeof groups.$inferSelect,
): boolean {
  if (!group.backendStateJson) return false;
  try {
    const state = JSON.parse(group.backendStateJson) as {
      defaultAppDistribution?: { preinstalled?: unknown };
    };
    return state.defaultAppDistribution?.preinstalled === true;
  } catch {
    return false;
  }
}

function currentDeploymentSnapshotMatches(
  snapshot: CurrentGroupDeploymentSnapshot | null | undefined,
  message: GroupDeploymentSnapshotQueueMessage,
): boolean {
  return !!snapshot &&
    snapshot.status === "applied" &&
    snapshot.sourceKind === "git_ref" &&
    snapshot.sourceRepositoryUrl === message.repositoryUrl &&
    snapshot.sourceRef === message.ref &&
    snapshot.sourceRefType === message.refType;
}

async function currentGroupDeploymentSnapshotMatchesMessage(
  db: Database,
  group: typeof groups.$inferSelect,
  message: GroupDeploymentSnapshotQueueMessage,
): Promise<boolean> {
  if (!group.currentGroupDeploymentSnapshotId) return false;
  const snapshot = await db.select({
    sourceKind: groupDeploymentSnapshots.sourceKind,
    sourceRepositoryUrl: groupDeploymentSnapshots.sourceRepositoryUrl,
    sourceRef: groupDeploymentSnapshots.sourceRef,
    sourceRefType: groupDeploymentSnapshots.sourceRefType,
    status: groupDeploymentSnapshots.status,
  }).from(groupDeploymentSnapshots)
    .where(and(
      eq(
        groupDeploymentSnapshots.id,
        group.currentGroupDeploymentSnapshotId,
      ),
      eq(groupDeploymentSnapshots.groupId, group.id),
      eq(groupDeploymentSnapshots.spaceId, message.spaceId),
    ))
    .get() as CurrentGroupDeploymentSnapshot | null;
  return currentDeploymentSnapshotMatches(snapshot, message);
}

async function allDefaultAppPreinstallGroupsApplied(
  db: Database,
  message: GroupDeploymentSnapshotQueueMessage,
  expectedGroupIds: string[],
): Promise<boolean> {
  if (expectedGroupIds.length > 0) {
    for (const groupId of expectedGroupIds) {
      const group = await db.select().from(groups)
        .where(and(
          eq(groups.spaceId, message.spaceId),
          eq(groups.id, groupId),
        ))
        .get();
      if (
        !group ||
        !await currentGroupDeploymentSnapshotMatchesMessage(db, group, message)
      ) return false;
    }
    return true;
  }

  const rows = await db.select().from(groups)
    .where(eq(groups.spaceId, message.spaceId))
    .all();
  const defaultAppGroups = rows.filter(isDefaultAppPreinstallGroup);
  return defaultAppGroups.length > 0 &&
    (
      await Promise.all(
        defaultAppGroups.map((group) =>
          currentGroupDeploymentSnapshotMatchesMessage(db, group, message)
        ),
      )
    ).every(Boolean);
}

async function updateDefaultAppPreinstallJobOutcome(
  db: Database,
  message: GroupDeploymentSnapshotQueueMessage,
  outcome: "completed" | "failed",
  lastError?: unknown,
): Promise<void> {
  if (message.reason !== "default_app_preinstall") return;

  const job = await db.select().from(defaultAppPreinstallJobs)
    .where(
      eq(
        defaultAppPreinstallJobs.id,
        defaultAppPreinstallJobId(message.spaceId),
      ),
    )
    .get();
  if (!job) return;
  const expectedGroupIds = parseExpectedGroupIds(job.expectedGroupIdsJson);
  if (
    expectedGroupIds.length > 0 &&
    !expectedGroupIds.includes(message.groupId)
  ) {
    return;
  }
  if (!distributionContainsMessage(job.distributionJson, message)) {
    return;
  }

  const now = new Date().toISOString();
  if (
    outcome === "completed" &&
    !(await allDefaultAppPreinstallGroupsApplied(db, message, expectedGroupIds))
  ) {
    return;
  }
  const values = outcome === "completed"
    ? {
      status: "completed",
      nextAttemptAt: null,
      lockedAt: null,
      lastError: null,
      updatedAt: now,
    }
    : {
      status: "failed",
      nextAttemptAt: null,
      lockedAt: null,
      lastError: lastError === undefined ? null : errorMessage(lastError),
      updatedAt: now,
    };

  await db.update(defaultAppPreinstallJobs).set(values)
    .where(
      eq(
        defaultAppPreinstallJobs.id,
        defaultAppPreinstallJobId(message.spaceId),
      ),
    )
    .run();
}

function isStaleGroupDeploymentJob(
  group: typeof groups.$inferSelect,
  message: GroupDeploymentSnapshotQueueMessage,
): boolean {
  return group.spaceId !== message.spaceId ||
    group.name !== message.groupName ||
    group.sourceKind !== "git_ref" ||
    group.sourceRepositoryUrl !== message.repositoryUrl ||
    group.sourceRef !== message.ref ||
    group.sourceRefType !== message.refType;
}

async function handleGroupDeploymentSnapshotJob(
  message: GroupDeploymentSnapshotQueueMessage,
  env: DeploymentEnv,
): Promise<void> {
  logInfo(`Processing group deployment snapshot ${message.groupId}`, {
    module: "deploy_queue",
  });

  const db = getDb(env.DB);
  const group = await db.select().from(groups)
    .where(eq(groups.id, message.groupId))
    .get();
  if (!group) {
    await updateDefaultAppPreinstallJobOutcome(
      db,
      message,
      "failed",
      `Group ${message.groupId} not found`,
    );
    logWarn(`Group ${message.groupId} not found; dropping deployment job`, {
      module: "deploy_queue",
    });
    return;
  }
  if (isStaleGroupDeploymentJob(group, message)) {
    await updateDefaultAppPreinstallJobOutcome(
      db,
      message,
      "failed",
      `Stale group deployment job ${message.groupId}`,
    );
    logWarn(`Stale group deployment job ${message.groupId}; dropping`, {
      module: "deploy_queue",
    });
    return;
  }
  if (
    group.currentGroupDeploymentSnapshotId &&
    await currentGroupDeploymentSnapshotMatchesMessage(db, group, message)
  ) {
    await db.update(groups).set({
      reconcileStatus: "ready",
      backendStateJson: defaultAppBackendState("completed", message),
      updatedAt: new Date().toISOString(),
    }).where(eq(groups.id, message.groupId)).run();
    await updateDefaultAppPreinstallJobOutcome(db, message, "completed");
    logInfo(`Group ${message.groupId} already has an applied snapshot`, {
      module: "deploy_queue",
    });
    return;
  }
  if (group.currentGroupDeploymentSnapshotId) {
    await updateDefaultAppPreinstallJobOutcome(
      db,
      message,
      "failed",
      `Current snapshot for group ${message.groupId} does not match default app preinstall job`,
    );
    logWarn(
      `Group ${message.groupId} has a current snapshot that does not match the default app preinstall job; skipping completion`,
      { module: "deploy_queue" },
    );
    return;
  }

  const now = new Date().toISOString();
  const claimResult = await db.update(groups).set({
    reconcileStatus: "in_progress",
    backendStateJson: defaultAppBackendState("in_progress", message),
    updatedAt: now,
  }).where(
    and(
      eq(groups.id, message.groupId),
      eq(groups.spaceId, message.spaceId),
      eq(groups.name, message.groupName),
      eq(groups.sourceKind, "git_ref"),
      eq(groups.sourceRepositoryUrl, message.repositoryUrl),
      eq(groups.sourceRef, message.ref),
      eq(groups.sourceRefType, message.refType),
      isNull(groups.currentGroupDeploymentSnapshotId),
      ne(groups.reconcileStatus, "in_progress"),
    ),
  ).run();
  const claimedRows = changedRows(claimResult);
  if (claimedRows !== null && claimedRows === 0) {
    const current = await db.select().from(groups)
      .where(eq(groups.id, message.groupId))
      .get();
    if (
      current?.currentGroupDeploymentSnapshotId &&
      await currentGroupDeploymentSnapshotMatchesMessage(db, current, message)
    ) {
      await db.update(groups).set({
        reconcileStatus: "ready",
        backendStateJson: defaultAppBackendState("completed", message),
        updatedAt: new Date().toISOString(),
      }).where(eq(groups.id, message.groupId)).run();
      await updateDefaultAppPreinstallJobOutcome(db, message, "completed");
      logInfo(`Group ${message.groupId} already has an applied snapshot`, {
        module: "deploy_queue",
      });
      return;
    }
    if (current?.currentGroupDeploymentSnapshotId) {
      await updateDefaultAppPreinstallJobOutcome(
        db,
        message,
        "failed",
        `Current snapshot for group ${message.groupId} does not match default app preinstall job`,
      );
      logWarn(
        `Group ${message.groupId} already has a current snapshot but it does not match the default app preinstall job; skipping completion`,
        { module: "deploy_queue" },
      );
      return;
    }
    logInfo(`Group ${message.groupId} deployment snapshot already claimed`, {
      module: "deploy_queue",
    });
    return;
  }

  try {
    const service = new GroupDeploymentSnapshotService(env as unknown as Env);
    await service.deploy(message.spaceId, message.createdByAccountId, {
      groupName: message.groupName,
      ...(message.backendName ? { backendName: message.backendName } : {}),
      ...(message.envName ? { envName: message.envName } : {}),
      source: {
        kind: "git_ref",
        repositoryUrl: message.repositoryUrl,
        ref: message.ref,
        refType: message.refType,
      },
    });
    logInfo(`Group deployment snapshot ${message.groupId} completed`, {
      module: "deploy_queue",
    });
    await db.update(groups).set({
      reconcileStatus: "ready",
      backendStateJson: defaultAppBackendState("completed", message),
      updatedAt: new Date().toISOString(),
    }).where(eq(groups.id, message.groupId)).run();
    await updateDefaultAppPreinstallJobOutcome(db, message, "completed");
  } catch (error) {
    await db.update(groups).set({
      reconcileStatus: "degraded",
      backendStateJson: defaultAppBackendState("failed", message, error),
      updatedAt: new Date().toISOString(),
    }).where(eq(groups.id, message.groupId)).run();
    await updateDefaultAppPreinstallJobOutcome(
      db,
      message,
      "failed",
      error,
    );
    logError(
      `Group deployment snapshot ${message.groupId} failed`,
      error,
      { module: "deploy_queue" },
    );
    throw error;
  }
}

// ---------------------------------------------------------------------------
// DLQ handler
// ---------------------------------------------------------------------------

export async function handleDeploymentJobDlq(
  message: DeploymentQueueMessage,
  env: DeploymentEnv,
  attempts: number,
): Promise<void> {
  if (message.type === "group_deployment_snapshot") {
    const db = getDb(env.DB);
    const error =
      `DLQ: Group deployment snapshot failed permanently after max retries`;
    await db.update(groups).set({
      reconcileStatus: "degraded",
      backendStateJson: defaultAppBackendState("failed", message, error),
      updatedAt: new Date().toISOString(),
    }).where(eq(groups.id, message.groupId)).run();
    await updateDefaultAppPreinstallJobOutcome(
      db,
      message,
      "failed",
      error,
    );
    logError(
      `CRITICAL: ${
        JSON.stringify({
          level: "CRITICAL",
          event: "GROUP_DEPLOYMENT_SNAPSHOT_DLQ_ENTRY",
          groupId: message.groupId,
          timestamp: new Date().toISOString(),
          retryCount: attempts,
          originalTimestamp: message.timestamp,
        })
      }`,
      undefined,
      { module: "deploy_dlq" },
    );
    return;
  }

  const { deploymentId } = message;

  const dlqEntry = {
    level: "CRITICAL",
    event: "DEPLOYMENT_DLQ_ENTRY",
    deploymentId,
    timestamp: new Date().toISOString(),
    retryCount: attempts,
    originalTimestamp: message.timestamp,
  };
  logError(`CRITICAL: ${JSON.stringify(dlqEntry)}`, undefined, {
    module: "deploy_dlq",
  });

  // Mark deployment as failed if still in progress
  try {
    const deploymentService = new DeploymentService(env);
    const deployment = await deploymentService.getDeploymentById(deploymentId);
    if (
      deployment && deployment.status !== "success" &&
      deployment.status !== "rolled_back"
    ) {
      const db = getDb(env.DB);
      const now = new Date().toISOString();
      await db.update(deployments).set({
        status: "failed",
        deployState: "failed",
        stepError: `DLQ: Deployment failed permanently after max retries`,
        updatedAt: now,
      }).where(
        and(
          eq(deployments.id, deploymentId),
          notInArray(deployments.status, ["success", "rolled_back"]),
        ),
      ).run();
    }
  } catch (err) {
    logError(`Failed to update deployment status`, err, {
      module: "deploy_dlq",
    });
    throw err;
  }
}
