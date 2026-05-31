import { type Database, workflowRuns } from "../../../infra/db/index.ts";
import { and, eq, isNull, max } from "drizzle-orm";
import { logError } from "../../../shared/utils/logger.ts";

/**
 * Shared run-number / run-attempt collision tolerance for workflow run inserts.
 *
 * The idx_workflow_runs_repo_path_number_attempt unique index (migration 0079)
 * over (repo_id, workflow_path, run_number, run_attempt) turns what used to be a
 * cosmetic duplicate under concurrent inserts into a hard UNIQUE constraint
 * violation. Every insert path that derives run_number/run_attempt from a
 * read-MAX must tolerate that violation by re-deriving and retrying, otherwise
 * a recoverable race drops a legitimate run (fresh dispatch / event trigger) or
 * 500s a rerun. These helpers centralize that retry so all creation sites share
 * identical semantics.
 */

const MAX_INSERT_ATTEMPTS = 5;

export function isUniqueConstraintViolation(err: unknown): boolean {
  return String(err).includes("UNIQUE constraint");
}

/**
 * Insert a workflow run with an atomically-retried run_number.
 *
 * run_number is derived as MAX(run_number)+1 per (repo_id, workflow_path).
 * Under concurrent fresh dispatch / event triggers two callers can read the
 * same MAX and collide; the unique index (migration 0079) rejects the loser. We
 * catch that UNIQUE constraint violation, re-derive MAX, and retry with the
 * next free number. The caller supplies every insert column except run_number,
 * which is owned here. Returns the run_number that was successfully inserted.
 */
export async function insertRunWithDerivedRunNumber(options: {
  db: Database;
  repoId: string;
  workflowPath: string;
  insertValues: Omit<typeof workflowRuns.$inferInsert, "runNumber">;
}): Promise<number> {
  const { db, repoId, workflowPath, insertValues } = options;
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt++) {
    const lastRun = await db.select({
      maxRunNumber: max(workflowRuns.runNumber),
    })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.repoId, repoId),
          eq(workflowRuns.workflowPath, workflowPath),
        ),
      )
      .get();
    const runNumber = (lastRun?.maxRunNumber || 0) + 1;
    try {
      await db.insert(workflowRuns)
        .values({ ...insertValues, runNumber })
        .run();
      return runNumber;
    } catch (err) {
      if (isUniqueConstraintViolation(err)) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  logError("Exhausted run_number derivation retries", lastErr, {
    module: "services/workflow-runs/run-number",
    repoId,
    workflowPath,
  });
  throw lastErr;
}

/**
 * Insert a rerun of an existing run with an atomically-retried run_attempt.
 *
 * Reruns intentionally REUSE the original run_number and increment run_attempt,
 * so the retry axis here is run_attempt (not run_number): on a UNIQUE
 * constraint collision we re-derive MAX(run_attempt)+1 for the
 * (repo_id, workflow_path, run_number) tuple and retry. The caller supplies
 * every insert column except run_attempt (owned here); run_number is taken from
 * the originating run (nullable on legacy rows, so the MAX query matches the
 * NULL bucket via IS NULL). Returns the run_attempt that was inserted.
 */
export async function insertRerunWithDerivedRunAttempt(options: {
  db: Database;
  repoId: string;
  workflowPath: string;
  runNumber: number | null;
  insertValues: Omit<typeof workflowRuns.$inferInsert, "runAttempt">;
}): Promise<number> {
  const { db, repoId, workflowPath, runNumber, insertValues } = options;
  const runNumberFilter = runNumber === null
    ? isNull(workflowRuns.runNumber)
    : eq(workflowRuns.runNumber, runNumber);
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt++) {
    const lastAttempt = await db.select({
      maxRunAttempt: max(workflowRuns.runAttempt),
    })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.repoId, repoId),
          eq(workflowRuns.workflowPath, workflowPath),
          runNumberFilter,
        ),
      )
      .get();
    const runAttempt = (lastAttempt?.maxRunAttempt || 0) + 1;
    try {
      await db.insert(workflowRuns)
        .values({ ...insertValues, runAttempt })
        .run();
      return runAttempt;
    } catch (err) {
      if (isUniqueConstraintViolation(err)) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  logError("Exhausted run_attempt derivation retries", lastErr, {
    module: "services/workflow-runs/run-number",
    repoId,
    workflowPath,
    runNumber,
  });
  throw lastErr;
}
