import { and, eq, inArray, sql } from "drizzle-orm";

import {
  agentResourceTombstones,
  getDb,
  runContextResourceRefs,
  runs,
  type SqlDatabaseLike,
} from "../../../infra/db/index.ts";
import type {
  ObjectStoreBinding,
  SqlDatabaseBinding,
} from "../../../shared/types/bindings.ts";
import { transitionRunTerminalAtomically } from "../run-notifier/terminal-transition.ts";
import type { AgentResourceTombstoneIdentity } from "../agent/resource-deletion.ts";

const ACTIVE_RUN_STATUSES = ["pending", "queued", "running"] as const;
const MAX_RUNS_PER_PASS = 100;
export const RUN_CONTEXT_REVOKED_ERROR =
  "This Run stopped because a referenced resource was deleted. Start a new Run to continue with fresh context.";
export const RUN_CONTEXT_INVALID_ERROR =
  "This Run stopped because its saved execution context could not be verified. Start a new Run to continue with fresh context.";

export type InvalidRunContextStage =
  | "model_input"
  | "skill_context"
  | "model_call_begin"
  | "tool_catalog"
  | "tool_execute"
  | "checkpoint_save"
  | "checkpoint_load"
  | "terminal_commit";

export type InvalidRunContextCode =
  | "authority_record_invalid"
  | "model_input_record_invalid"
  | "skill_revision_invalid"
  | "model_call_record_invalid"
  | "checkpoint_envelope_invalid"
  | "checkpoint_authority_missing"
  | "checkpoint_authority_invalid";

export type InvalidRunContextEvidence = {
  stage: InvalidRunContextStage;
  code: InvalidRunContextCode;
  checkpointContextRevision?: number;
};

export type RevokedRunContextEvidence = {
  tombstoneId: string;
  workspaceId: string;
  resourceKind: string;
  resourceId: string;
  resourceDigest: string;
  contextRevision: number;
};

async function findRevokedContextEvidence(
  dbBinding: SqlDatabaseLike,
  runId: string,
): Promise<RevokedRunContextEvidence | null> {
  const row = await getDb(dbBinding).select({
    tombstoneId: agentResourceTombstones.id,
    workspaceId: runContextResourceRefs.workspaceId,
    resourceKind: runContextResourceRefs.resourceKind,
    resourceId: runContextResourceRefs.resourceId,
    resourceDigest: runContextResourceRefs.resourceDigest,
    contextRevision: runContextResourceRefs.contextRevision,
  }).from(runs)
    .innerJoin(
      runContextResourceRefs,
      and(
        eq(runContextResourceRefs.runId, runs.id),
        eq(
          runContextResourceRefs.contextRevision,
          runs.currentContextRevision,
        ),
      ),
    )
    .innerJoin(
      agentResourceTombstones,
      and(
        eq(
          agentResourceTombstones.accountId,
          runContextResourceRefs.workspaceId,
        ),
        eq(
          agentResourceTombstones.resourceKind,
          runContextResourceRefs.resourceKind,
        ),
        eq(
          agentResourceTombstones.resourceId,
          runContextResourceRefs.resourceId,
        ),
      ),
    )
    .where(eq(runs.id, runId))
    .orderBy(
      runContextResourceRefs.resourceKind,
      runContextResourceRefs.resourceId,
    )
    .limit(1)
    .get();
  return row ?? null;
}

export async function cancelRunForRevokedContext(
  dbBinding: SqlDatabaseBinding,
  runId: string,
  offloadBucket?: ObjectStoreBinding,
): Promise<{ revoked: boolean; cancelled: boolean }> {
  const evidence = await findRevokedContextEvidence(dbBinding, runId);
  if (!evidence) return { revoked: false, cancelled: false };
  const completedAt = new Date().toISOString();
  const transition = await transitionRunTerminalAtomically(
    dbBinding,
    {
      runId,
      status: "cancelled",
      expectedStatuses: [...ACTIVE_RUN_STATUSES],
      completedAt,
      terminalReason: "context_revoked",
      error: RUN_CONTEXT_REVOKED_ERROR,
      eventType: "cancelled",
      terminalEvent: {
        status: "cancelled",
        reason: "context_revoked",
        message: RUN_CONTEXT_REVOKED_ERROR,
        evidence,
      },
    },
    { offloadBucket },
  );
  return { revoked: true, cancelled: transition.committed };
}

/**
 * Fail one authority-bearing Run when Worker-owned context/checkpoint
 * integrity can no longer be proved.
 *
 * Caller-supplied stale attestations are authorization failures and must not
 * use this transition. This is only for a failed verification of durable
 * Worker authority or a checkpoint previously accepted into the Run ledger.
 * Legacy Runs without a context pointer remain distinguishable and are not
 * rewritten as corruption. A tombstone is checked first so deletion retains
 * the more precise `context_revoked` terminal reason.
 */
export async function failRunForInvalidContext(
  dbBinding: SqlDatabaseBinding,
  runId: string,
  evidence: InvalidRunContextEvidence,
  offloadBucket?: ObjectStoreBinding,
): Promise<{
  invalid: boolean;
  failed: boolean;
  legacy: boolean;
  revoked: boolean;
}> {
  const revocation = await cancelRunForRevokedContext(
    dbBinding,
    runId,
    offloadBucket,
  );
  if (revocation.revoked) {
    return {
      invalid: false,
      failed: false,
      legacy: false,
      revoked: true,
    };
  }
  const run = await getDb(dbBinding).select({
    status: runs.status,
    currentContextRevision: runs.currentContextRevision,
    terminalReason: runs.terminalReason,
  }).from(runs).where(eq(runs.id, runId)).get();
  if (!run) {
    return {
      invalid: false,
      failed: false,
      legacy: false,
      revoked: false,
    };
  }
  if (run.currentContextRevision === null) {
    return {
      invalid: false,
      failed: false,
      legacy: true,
      revoked: false,
    };
  }
  if (!ACTIVE_RUN_STATUSES.includes(
    run.status as (typeof ACTIVE_RUN_STATUSES)[number],
  )) {
    return {
      invalid: run.terminalReason === "context_invalid",
      failed: false,
      legacy: false,
      revoked: run.terminalReason === "context_revoked",
    };
  }

  const currentContextRevision = Number.isSafeInteger(
      run.currentContextRevision,
    ) && Number(run.currentContextRevision) >= 1
    ? Number(run.currentContextRevision)
    : null;
  const completedAt = new Date().toISOString();
  const transition = await transitionRunTerminalAtomically(
    dbBinding,
    {
      runId,
      status: "failed",
      expectedStatuses: [...ACTIVE_RUN_STATUSES],
      completedAt,
      terminalReason: "context_invalid",
      error: RUN_CONTEXT_INVALID_ERROR,
      eventType: "error",
      terminalEvent: {
        status: "failed",
        reason: "context_invalid",
        message: RUN_CONTEXT_INVALID_ERROR,
        evidence: {
          ...evidence,
          currentContextRevision,
        },
      },
    },
    { offloadBucket },
  );
  return {
    invalid: true,
    failed: transition.committed,
    legacy: false,
    revoked: false,
  };
}

/**
 * Durable deletion convergence: cancel a bounded set of active Runs whose
 * current revision contains this exact resource identity. The caller retries
 * the outbox row until the final `remaining` check reaches zero.
 */
export async function cancelRunsReferencingAgentResource(
  dbBinding: SqlDatabaseBinding,
  tombstone: AgentResourceTombstoneIdentity,
  offloadBucket?: ObjectStoreBinding,
): Promise<{ selected: number; cancelled: number; remaining: boolean }> {
  const db = getDb(dbBinding);
  const rows = await db.select({ id: runs.id }).from(runs)
    .innerJoin(
      runContextResourceRefs,
      and(
        eq(runContextResourceRefs.runId, runs.id),
        eq(
          runContextResourceRefs.contextRevision,
          runs.currentContextRevision,
        ),
      ),
    )
    .where(and(
      eq(runs.accountId, tombstone.accountId),
      inArray(runs.status, [...ACTIVE_RUN_STATUSES]),
      eq(runContextResourceRefs.workspaceId, tombstone.accountId),
      eq(runContextResourceRefs.resourceKind, tombstone.resourceKind),
      eq(runContextResourceRefs.resourceId, tombstone.resourceId),
    ))
    .orderBy(runs.createdAt, runs.id)
    .limit(MAX_RUNS_PER_PASS)
    .all();
  let cancelled = 0;
  for (const row of rows) {
    const outcome = await cancelRunForRevokedContext(
      dbBinding,
      row.id,
      offloadBucket,
    );
    if (outcome.cancelled) cancelled++;
  }
  const remainingRow = await db.select({ count: sql<number>`count(*)` })
    .from(runs)
    .innerJoin(
      runContextResourceRefs,
      and(
        eq(runContextResourceRefs.runId, runs.id),
        eq(
          runContextResourceRefs.contextRevision,
          runs.currentContextRevision,
        ),
      ),
    )
    .where(and(
      eq(runs.accountId, tombstone.accountId),
      inArray(runs.status, [...ACTIVE_RUN_STATUSES]),
      eq(runContextResourceRefs.workspaceId, tombstone.accountId),
      eq(runContextResourceRefs.resourceKind, tombstone.resourceKind),
      eq(runContextResourceRefs.resourceId, tombstone.resourceId),
    ))
    .get();
  return {
    selected: rows.length,
    cancelled,
    remaining: Number(remainingRow?.count ?? 0) > 0,
  };
}
