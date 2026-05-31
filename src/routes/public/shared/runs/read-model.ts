import type {
  Run,
  SpaceRole,
  SqlDatabaseBinding,
} from "takos-api-contract/shared/types";
import { asRunRow, runRowToApi } from "takos-api-contract/shared/types/runs";
import { readSpaceMembershipRole } from "../spaces/access.ts";

export type RunAccessResult = {
  run: Run;
  role: SpaceRole;
};

type RunRecord = Record<string, unknown>;

export async function readRunAccess(
  db: SqlDatabaseBinding,
  runId: string,
  actorAccountId: string,
  requiredRoles?: SpaceRole[],
): Promise<RunAccessResult | null> {
  const runRow = await db.prepare(`
    SELECT
      id,
      thread_id AS threadId,
      account_id AS spaceId,
      session_id AS sessionId,
      parent_run_id AS parentRunId,
      child_thread_id AS childThreadId,
      root_thread_id AS rootThreadId,
      root_run_id AS rootRunId,
      agent_type AS agentType,
      status,
      input,
      output,
      error,
      usage,
      service_id AS serviceId,
      service_heartbeat AS serviceHeartbeat,
      started_at AS startedAt,
      completed_at AS completedAt,
      created_at AS createdAt
    FROM runs
    WHERE id = ?
    LIMIT 1
  `).bind(runId).first<RunRecord>();
  if (!runRow) return null;

  const run = runRowToApi(asRunRow(runRow));
  const role = await readSpaceMembershipRole(
    db,
    run.space_id,
    actorAccountId,
    requiredRoles,
  );
  if (!role) return null;

  return { run, role };
}
