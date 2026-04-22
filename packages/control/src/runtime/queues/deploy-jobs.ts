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
  groupId?: string;
  groupName?: string;
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
      (m.groupId === undefined || typeof m.groupId === "string") &&
      (m.groupName === undefined || typeof m.groupName === "string") &&
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

function readDefaultAppBackendError(
  backendStateJson: string | null | undefined,
): string | null {
  if (!backendStateJson) return null;
  try {
    const state = JSON.parse(backendStateJson) as {
      defaultAppDistribution?: { error?: unknown };
    };
    const error = state.defaultAppDistribution?.error;
    return typeof error === "string" && error.trim() ? error.trim() : null;
  } catch {
    return null;
  }
}

function buildDefaultAppDlqError(
  existingGroup: typeof groups.$inferSelect | null | undefined,
): string {
  const dlqError =
    `DLQ: Group deployment snapshot failed permanently after max retries`;
  const previousError = readDefaultAppBackendError(
    existingGroup?.backendStateJson,
  );
  if (!previousError || previousError.startsWith("DLQ:")) return dlqError;
  return `${dlqError}; last error: ${previousError}`;
}

type CurrentGroupDeploymentSnapshot = {
  sourceKind: string | null;
  sourceRepositoryUrl: string | null;
  sourceRef: string | null;
  sourceRefType: string | null;
  status: string | null;
};

type ExpectedDefaultAppGroupSource = {
  name?: string;
  repositoryUrl: string;
  ref: string;
  refType: "branch" | "tag" | "commit";
};

function defaultAppPreinstallJobId(spaceId: string): string {
  return `default-app-preinstall:${spaceId}`;
}

function groupDeploymentJobLabel(
  message: GroupDeploymentSnapshotQueueMessage,
): string {
  return message.groupId ?? message.groupName ??
    `${message.repositoryUrl}@${message.ref}`;
}

function messageWithResolvedGroup(
  message: GroupDeploymentSnapshotQueueMessage,
  group: { id: string; name: string },
): GroupDeploymentSnapshotQueueMessage {
  return {
    ...message,
    groupId: group.id,
    groupName: group.name,
  };
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
  const entries = parseDefaultAppDistributionSources(distributionJson);
  if (entries === null) return !distributionJson;
  return entries.some((entry) =>
    defaultAppSourceMatchesMessage(entry, message)
  );
}

function parseDefaultAppDistributionSources(
  distributionJson: string | null | undefined,
): ExpectedDefaultAppGroupSource[] | null {
  if (!distributionJson) return null;
  try {
    const parsed = JSON.parse(distributionJson) as unknown;
    if (!Array.isArray(parsed)) return null;
    const entries: ExpectedDefaultAppGroupSource[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      if (record.preinstall === false) continue;
      if (
        typeof record.repositoryUrl !== "string" ||
        typeof record.ref !== "string" ||
        !["branch", "tag", "commit"].includes(record.refType as string)
      ) continue;
      entries.push({
        ...(typeof record.name === "string" ? { name: record.name } : {}),
        repositoryUrl: record.repositoryUrl,
        ref: record.ref,
        refType: record.refType as "branch" | "tag" | "commit",
      });
    }
    return entries;
  } catch {
    return null;
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
  return currentDeploymentSnapshotMatchesSource(snapshot, {
    repositoryUrl: message.repositoryUrl,
    ref: message.ref,
    refType: message.refType,
  });
}

function currentDeploymentSnapshotMatchesSource(
  snapshot: CurrentGroupDeploymentSnapshot | null | undefined,
  source: ExpectedDefaultAppGroupSource,
): boolean {
  return !!snapshot &&
    snapshot.status === "applied" &&
    snapshot.sourceKind === "git_ref" &&
    snapshot.sourceRepositoryUrl === source.repositoryUrl &&
    snapshot.sourceRef === source.ref &&
    snapshot.sourceRefType === source.refType;
}

function defaultAppGroupMatchesSource(
  group: typeof groups.$inferSelect,
  source: ExpectedDefaultAppGroupSource,
): boolean {
  return group.sourceKind === "git_ref" &&
    group.sourceRepositoryUrl === source.repositoryUrl &&
    group.sourceRef === source.ref &&
    group.sourceRefType === source.refType;
}

function defaultAppSourceMatchesMessage(
  source: ExpectedDefaultAppGroupSource,
  message: GroupDeploymentSnapshotQueueMessage,
): boolean {
  return source.repositoryUrl === message.repositoryUrl &&
    source.ref === message.ref &&
    source.refType === message.refType;
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

async function currentGroupDeploymentSnapshotMatchesSource(
  db: Database,
  group: typeof groups.$inferSelect,
  spaceId: string,
  source: ExpectedDefaultAppGroupSource,
): Promise<boolean> {
  if (!defaultAppGroupMatchesSource(group, source)) return false;
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
      eq(groupDeploymentSnapshots.spaceId, spaceId),
    ))
    .get() as CurrentGroupDeploymentSnapshot | null;
  return currentDeploymentSnapshotMatchesSource(snapshot, source);
}

function expectedDefaultAppSourceForGroup(
  group: typeof groups.$inferSelect,
  entries: ExpectedDefaultAppGroupSource[],
): ExpectedDefaultAppGroupSource | null {
  return entries.find((entry) => defaultAppGroupMatchesSource(group, entry)) ??
    null;
}

async function allDefaultAppPreinstallGroupsApplied(
  db: Database,
  message: GroupDeploymentSnapshotQueueMessage,
  expectedGroupIds: string[],
): Promise<boolean> {
  const distributionSources = parseDefaultAppDistributionSources(
    (await db.select().from(defaultAppPreinstallJobs)
      .where(
        eq(
          defaultAppPreinstallJobs.id,
          defaultAppPreinstallJobId(message.spaceId),
        ),
      )
      .get())?.distributionJson,
  );
  const shouldUseExpectedIds = expectedGroupIds.length > 0 &&
    (!distributionSources ||
      expectedGroupIds.length >= distributionSources.length);
  if (shouldUseExpectedIds) {
    for (const groupId of expectedGroupIds) {
      const group = await db.select().from(groups)
        .where(and(
          eq(groups.spaceId, message.spaceId),
          eq(groups.id, groupId),
        ))
        .get();
      if (!group) return false;
      if (distributionSources && distributionSources.length > 0) {
        const expected = expectedDefaultAppSourceForGroup(
          group,
          distributionSources,
        );
        if (!expected) return false;
        if (
          !await currentGroupDeploymentSnapshotMatchesSource(
            db,
            group,
            message.spaceId,
            expected,
          )
        ) return false;
      } else if (
        !await currentGroupDeploymentSnapshotMatchesMessage(db, group, message)
      ) {
        return false;
      }
    }
    return true;
  }

  const rows = await db.select().from(groups)
    .where(eq(groups.spaceId, message.spaceId))
    .all();
  const defaultAppGroups = rows.filter(isDefaultAppPreinstallGroup);
  if (distributionSources && distributionSources.length > 0) {
    return distributionSources.every((source) => {
      const group = defaultAppGroups.find((row) =>
        defaultAppGroupMatchesSource(row, source)
      );
      return !!group &&
        group.currentGroupDeploymentSnapshotId !== null &&
        group.currentGroupDeploymentSnapshotId !== undefined;
    }) &&
      (
        await Promise.all(
          distributionSources.map((source) => {
            const group = defaultAppGroups.find((row) =>
              defaultAppGroupMatchesSource(row, source)
            );
            if (!group) return Promise.resolve(false);
            return currentGroupDeploymentSnapshotMatchesSource(
              db,
              group,
              message.spaceId,
              source,
            );
          }),
        )
      ).every(Boolean);
  }
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
    message.groupId &&
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
    (message.groupName !== undefined && group.name !== message.groupName) ||
    group.sourceKind !== "git_ref" ||
    group.sourceRepositoryUrl !== message.repositoryUrl ||
    group.sourceRef !== message.ref ||
    group.sourceRefType !== message.refType;
}

async function findQueuedDeploymentGroup(
  db: Database,
  message: GroupDeploymentSnapshotQueueMessage,
): Promise<typeof groups.$inferSelect | null> {
  if (message.groupId) {
    return (await db.select().from(groups)
      .where(eq(groups.id, message.groupId))
      .get()) ?? null;
  }
  if (message.groupName) {
    return (await db.select().from(groups)
      .where(and(
        eq(groups.spaceId, message.spaceId),
        eq(groups.name, message.groupName),
      ))
      .get()) ?? null;
  }
  return null;
}

async function handleGroupDeploymentSnapshotJob(
  message: GroupDeploymentSnapshotQueueMessage,
  env: DeploymentEnv,
): Promise<void> {
  const label = groupDeploymentJobLabel(message);
  logInfo(`Processing group deployment snapshot ${label}`, {
    module: "deploy_queue",
  });

  const db = getDb(env.DB);
  const group = await findQueuedDeploymentGroup(db, message);
  if (message.groupId && !group) {
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
  if (group && isStaleGroupDeploymentJob(group, message)) {
    const resolvedMessage = messageWithResolvedGroup(message, group);
    await updateDefaultAppPreinstallJobOutcome(
      db,
      resolvedMessage,
      "failed",
      `Stale group deployment job ${group.id}`,
    );
    logWarn(`Stale group deployment job ${group.id}; dropping`, {
      module: "deploy_queue",
    });
    return;
  }
  if (
    group?.currentGroupDeploymentSnapshotId &&
    await currentGroupDeploymentSnapshotMatchesMessage(db, group, message)
  ) {
    const resolvedMessage = messageWithResolvedGroup(message, group);
    await db.update(groups).set({
      reconcileStatus: "ready",
      backendStateJson: defaultAppBackendState("completed", resolvedMessage),
      updatedAt: new Date().toISOString(),
    }).where(eq(groups.id, group.id)).run();
    await updateDefaultAppPreinstallJobOutcome(
      db,
      resolvedMessage,
      "completed",
    );
    logInfo(`Group ${group.id} already has an applied snapshot`, {
      module: "deploy_queue",
    });
    return;
  }
  if (group?.currentGroupDeploymentSnapshotId) {
    const resolvedMessage = messageWithResolvedGroup(message, group);
    await updateDefaultAppPreinstallJobOutcome(
      db,
      resolvedMessage,
      "failed",
      `Current snapshot for group ${group.id} does not match default app preinstall job`,
    );
    logWarn(
      `Group ${group.id} has a current snapshot that does not match the default app preinstall job; skipping completion`,
      { module: "deploy_queue" },
    );
    return;
  }

  if (group) {
    const resolvedMessage = messageWithResolvedGroup(message, group);
    const now = new Date().toISOString();
    const claimResult = await db.update(groups).set({
      reconcileStatus: "in_progress",
      backendStateJson: defaultAppBackendState("in_progress", resolvedMessage),
      updatedAt: now,
    }).where(
      and(
        eq(groups.id, group.id),
        eq(groups.spaceId, message.spaceId),
        ...(message.groupName ? [eq(groups.name, message.groupName)] : []),
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
        .where(eq(groups.id, group.id))
        .get();
      if (
        current?.currentGroupDeploymentSnapshotId &&
        await currentGroupDeploymentSnapshotMatchesMessage(db, current, message)
      ) {
        const currentMessage = messageWithResolvedGroup(message, current);
        await db.update(groups).set({
          reconcileStatus: "ready",
          backendStateJson: defaultAppBackendState("completed", currentMessage),
          updatedAt: new Date().toISOString(),
        }).where(eq(groups.id, current.id)).run();
        await updateDefaultAppPreinstallJobOutcome(
          db,
          currentMessage,
          "completed",
        );
        logInfo(`Group ${current.id} already has an applied snapshot`, {
          module: "deploy_queue",
        });
        return;
      }
      if (current?.currentGroupDeploymentSnapshotId) {
        const currentMessage = messageWithResolvedGroup(message, current);
        await updateDefaultAppPreinstallJobOutcome(
          db,
          currentMessage,
          "failed",
          `Current snapshot for group ${current.id} does not match default app preinstall job`,
        );
        logWarn(
          `Group ${current.id} already has a current snapshot but it does not match the default app preinstall job; skipping completion`,
          { module: "deploy_queue" },
        );
        return;
      }
      logInfo(`Group ${group.id} deployment snapshot already claimed`, {
        module: "deploy_queue",
      });
      return;
    }
  }

  try {
    const service = new GroupDeploymentSnapshotService(env as unknown as Env);
    const result = await service.deploy(
      message.spaceId,
      message.createdByAccountId,
      {
        ...(message.groupName ? { groupName: message.groupName } : {}),
        ...(message.backendName ? { backendName: message.backendName } : {}),
        ...(message.envName ? { envName: message.envName } : {}),
        source: {
          kind: "git_ref",
          repositoryUrl: message.repositoryUrl,
          ref: message.ref,
          refType: message.refType,
        },
      },
    );
    const completedMessage = messageWithResolvedGroup(
      message,
      result.groupDeploymentSnapshot.group,
    );
    if (result.groupDeploymentSnapshot.status !== "applied") {
      const error = new Error(
        `Group deployment snapshot ${result.groupDeploymentSnapshot.id} finished with status ${result.groupDeploymentSnapshot.status}`,
      );
      await db.update(groups).set({
        reconcileStatus: "degraded",
        backendStateJson: defaultAppBackendState(
          "failed",
          completedMessage,
          error,
        ),
        updatedAt: new Date().toISOString(),
      }).where(eq(groups.id, result.groupDeploymentSnapshot.group.id)).run();
      await updateDefaultAppPreinstallJobOutcome(
        db,
        completedMessage,
        "failed",
        error,
      );
      throw error;
    }
    logInfo(
      `Group deployment snapshot ${
        groupDeploymentJobLabel(completedMessage)
      } completed`,
      {
        module: "deploy_queue",
      },
    );
    await db.update(groups).set({
      reconcileStatus: "ready",
      backendStateJson: defaultAppBackendState("completed", completedMessage),
      updatedAt: new Date().toISOString(),
    }).where(eq(groups.id, result.groupDeploymentSnapshot.group.id)).run();
    await updateDefaultAppPreinstallJobOutcome(
      db,
      completedMessage,
      "completed",
    );
  } catch (error) {
    const failedMessage = group
      ? messageWithResolvedGroup(message, group)
      : message;
    if (failedMessage.groupId) {
      await db.update(groups).set({
        reconcileStatus: "degraded",
        backendStateJson: defaultAppBackendState(
          "failed",
          failedMessage,
          error,
        ),
        updatedAt: new Date().toISOString(),
      }).where(eq(groups.id, failedMessage.groupId)).run();
    }
    await updateDefaultAppPreinstallJobOutcome(
      db,
      failedMessage,
      "failed",
      error,
    );
    logError(
      `Group deployment snapshot ${label} failed`,
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
  queueName = "takos-deployment-jobs-dlq",
): Promise<void> {
  if (message.type === "group_deployment_snapshot") {
    const db = getDb(env.DB);
    const existingGroup = await findQueuedDeploymentGroup(db, message);
    const error = buildDefaultAppDlqError(existingGroup);
    const failedMessage = existingGroup
      ? messageWithResolvedGroup(message, existingGroup)
      : message;
    if (failedMessage.groupId) {
      await db.update(groups).set({
        reconcileStatus: "degraded",
        backendStateJson: defaultAppBackendState(
          "failed",
          failedMessage,
          error,
        ),
        updatedAt: new Date().toISOString(),
      }).where(eq(groups.id, failedMessage.groupId)).run();
    }
    await updateDefaultAppPreinstallJobOutcome(
      db,
      failedMessage,
      "failed",
      error,
    );
    logError(
      `CRITICAL: ${
        JSON.stringify({
          level: "CRITICAL",
          event: "GROUP_DEPLOYMENT_SNAPSHOT_DLQ_ENTRY",
          queue: queueName,
          groupId: failedMessage.groupId ?? null,
          groupName: failedMessage.groupName ?? null,
          repositoryUrl: failedMessage.repositoryUrl,
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
    queue: queueName,
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
