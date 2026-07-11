import { type Clock, systemClock } from "@takos/worker-platform-utils/clock";
import type { SqlDatabaseBinding } from "../../shared/types/bindings.ts";
import { getDb, runs, toolOperations } from "../../infra/db/index.ts";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { generateId } from "../../shared/utils/index.ts";
import { affectedRowCount } from "../../shared/utils/affected-row-count.ts";

// Longer than the 5-minute tool/MCP transport timeout and the lease-loss poll
// grace. Re-executing exactly at the transport boundary can duplicate a remote
// side effect when the handler ignored cancellation but is still completing.
export const STALE_PENDING_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * Generate a deterministic operation key for a tool call.
 * Key = SHA-256(runId + toolName + JSON.stringify(sortKeys(args))) truncated to 32 hex chars.
 */
export async function generateOperationKey(
  runId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const payload = runId + toolName + JSON.stringify(sortKeys(args));
  const encoded = new TextEncoder().encode(payload);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray.slice(0, 16), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

function sortKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = sortKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

export interface IdempotencyResult {
  /** 'execute' = proceed with execution, 'cached' = return cached result, 'in_progress' = another execution is running */
  action: "execute" | "cached" | "in_progress";
  cachedOutput?: string;
  cachedError?: string;
  operationId?: string;
  /** This caller must fail the Run instead of asking the model to continue. */
  outcomeUncertain?: boolean;
}

/**
 * Check idempotency guard before executing a side-effect tool.
 * Returns whether to execute, use cached result, or wait.
 */
export async function checkIdempotency(
  db: SqlDatabaseBinding,
  runId: string,
  toolName: string,
  args: Record<string, unknown>,
  clock: Clock = systemClock,
): Promise<IdempotencyResult> {
  const drizzleDb = getDb(db);
  const operationKey = await generateOperationKey(runId, toolName, args);

  const existing = await drizzleDb
    .select()
    .from(toolOperations)
    .where(
      and(
        eq(toolOperations.runId, runId),
        eq(toolOperations.operationKey, operationKey),
      ),
    )
    .get();

  if (existing) {
    if (existing.status === "completed") {
      return {
        action: "cached",
        cachedOutput: existing.resultOutput ?? undefined,
        cachedError: existing.resultError ?? undefined,
      };
    }

    if (existing.status === "uncertain") {
      return {
        action: "cached",
        cachedOutput: "",
        cachedError:
          existing.resultError ??
          `The previous ${toolName} call may have completed, but Takos could not confirm its outcome. Automatic replay is blocked to avoid duplicating a side effect. Verify the remote system and use a new explicit operation if needed.`,
        outcomeUncertain: true,
      };
    }

    if (existing.status === "failed") {
      // Delete failed record and allow re-execution
      await drizzleDb
        .delete(toolOperations)
        .where(eq(toolOperations.id, existing.id));
      // Fall through to create new pending record
    } else if (existing.status === "pending") {
      const createdAt = new Date(existing.createdAt).getTime();
      if (clock.now() - createdAt > STALE_PENDING_THRESHOLD_MS) {
        // The executor disappeared without recording whether dispatch occurred.
        // Treat the outcome as unknown; replaying after an arbitrary age can
        // duplicate a remote mutation that completed before the crash.
        const uncertainError =
          `The previous ${toolName} call lost its executor before an outcome was recorded. ` +
          "Automatic replay is blocked to avoid duplicating a side effect; verify the remote system before issuing a new operation.";
        await drizzleDb
          .update(toolOperations)
          .set({
            status: "uncertain",
            resultError: uncertainError,
            completedAt: new Date(clock.now()).toISOString(),
          })
          .where(eq(toolOperations.id, existing.id));
        return {
          action: "cached",
          cachedOutput: "",
          cachedError: uncertainError,
          outcomeUncertain: true,
        };
      } else {
        return { action: "in_progress" };
      }
    }
  }

  // Insert pending record with conflict guard to handle concurrent inserts
  const operationId = generateId();
  const now = new Date().toISOString();
  const insertResult = await drizzleDb.run(
    sql`INSERT OR IGNORE INTO tool_operations (id, run_id, operation_key, tool_name, status, created_at) VALUES (${operationId}, ${runId}, ${operationKey}, ${toolName}, 'pending', ${now})`,
  );

  if (affectedRowCount(insertResult) === 0) {
    // Another request inserted first — re-check status
    const raceCheck = await drizzleDb
      .select()
      .from(toolOperations)
      .where(
        and(
          eq(toolOperations.runId, runId),
          eq(toolOperations.operationKey, operationKey),
        ),
      )
      .get();
    if (raceCheck?.status === "completed") {
      return {
        action: "cached",
        cachedOutput: raceCheck.resultOutput ?? undefined,
        cachedError: raceCheck.resultError ?? undefined,
      };
    }
    if (raceCheck?.status === "uncertain") {
      return {
        action: "cached",
        cachedOutput: "",
        cachedError:
          raceCheck.resultError ??
          `The previous ${toolName} call has an unknown outcome; automatic replay is blocked.`,
        outcomeUncertain: true,
      };
    }
    return { action: "in_progress" };
  }

  return { action: "execute", operationId };
}

/**
 * Mark an operation as completed with its result.
 */
export async function completeOperation(
  db: SqlDatabaseBinding,
  operationId: string,
  output: string,
  error?: string,
): Promise<void> {
  const drizzleDb = getDb(db);
  await drizzleDb
    .update(toolOperations)
    .set({
      status: error ? "failed" : "completed",
      resultOutput: output,
      resultError: error ?? null,
      completedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(toolOperations.id, operationId),
        eq(toolOperations.status, "pending"),
      ),
    );
}

/** Permanently fence an operation whose remote commit outcome is unknown. */
export async function markOperationUncertain(
  db: SqlDatabaseBinding,
  operationId: string,
  error: string,
): Promise<void> {
  const drizzleDb = getDb(db);
  await drizzleDb
    .update(toolOperations)
    .set({
      status: "uncertain",
      resultOutput: "",
      resultError: error,
      completedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(toolOperations.id, operationId),
        eq(toolOperations.status, "pending"),
      ),
    );
}

/**
 * Fence side effects from a prior executor before a newly claimed lease can
 * dispatch. At this point no tool from the new lease exists yet, so every
 * pending row has an unknown pre-takeover outcome and must never be replayed.
 */
export async function fencePendingOperationsForClaimedRun(
  db: SqlDatabaseBinding,
  runId: string,
  clock: Clock = systemClock,
): Promise<number> {
  const result = await getDb(db)
    .update(toolOperations)
    .set({
      status: "uncertain",
      resultOutput: "",
      resultError:
        "The previous executor lost its Run lease before this side effect recorded an authoritative outcome. Automatic replay is blocked; verify the remote system before issuing a new operation.",
      completedAt: new Date(clock.now()).toISOString(),
    })
    .where(
      and(
        eq(toolOperations.runId, runId),
        eq(toolOperations.status, "pending"),
      ),
    );
  return affectedRowCount(result);
}

/**
 * Clean up old tool operations for terminal runs.
 * Called by cron handler.
 */
export async function cleanupStaleOperations(
  db: SqlDatabaseBinding,
  clock: Clock = systemClock,
): Promise<number> {
  const drizzleDb = getDb(db);
  const threshold = new Date(clock.now() - 24 * 60 * 60 * 1000).toISOString();
  const terminalRunIds = drizzleDb
    .select({ id: runs.id })
    .from(runs)
    .where(inArray(runs.status, ["completed", "failed", "cancelled"]));
  const result = await drizzleDb
    .delete(toolOperations)
    .where(
      and(
        lt(toolOperations.createdAt, threshold),
        inArray(toolOperations.runId, terminalRunIds),
      ),
    );
  return affectedRowCount(result);
}
