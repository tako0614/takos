import type { D1Database } from "../../shared/types/bindings.ts";
import { getDb, toolOperations } from "../../infra/db/index.ts";
import { and, eq, lt, sql } from "drizzle-orm";
import { generateId } from "../../shared/utils/index.ts";

const STALE_PENDING_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

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
  return Array.from(
    hashArray.slice(0, 16),
    (b) => b.toString(16).padStart(2, "0"),
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
}

/**
 * Check idempotency guard before executing a side-effect tool.
 * Returns whether to execute, use cached result, or wait.
 */
export async function checkIdempotency(
  db: D1Database,
  runId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<IdempotencyResult> {
  const drizzleDb = getDb(db);
  const operationKey = await generateOperationKey(runId, toolName, args);

  const existing = await drizzleDb.select()
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

    if (existing.status === "failed") {
      // Delete failed record and allow re-execution
      await drizzleDb.delete(toolOperations).where(
        eq(toolOperations.id, existing.id),
      );
      // Fall through to create new pending record
    } else if (existing.status === "pending") {
      const createdAt = new Date(existing.createdAt).getTime();
      if (Date.now() - createdAt > STALE_PENDING_THRESHOLD_MS) {
        // Stale pending — delete and allow re-execution
        await drizzleDb.delete(toolOperations).where(
          eq(toolOperations.id, existing.id),
        );
        // Fall through to create new pending record
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

  if (insertResult.meta.changes === 0) {
    // Another worker inserted first — re-check status
    const raceCheck = await drizzleDb.select()
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
    return { action: "in_progress" };
  }

  return { action: "execute", operationId };
}

/**
 * Mark an operation as completed with its result.
 */
export async function completeOperation(
  db: D1Database,
  operationId: string,
  output: string,
  error?: string,
): Promise<void> {
  const drizzleDb = getDb(db);
  await drizzleDb.update(toolOperations)
    .set({
      status: error ? "failed" : "completed",
      resultOutput: output,
      resultError: error ?? null,
      completedAt: new Date().toISOString(),
    })
    .where(eq(toolOperations.id, operationId));
}

/**
 * Clean up old tool operations for terminal runs.
 * Called by cron handler.
 */
export async function cleanupStaleOperations(db: D1Database): Promise<number> {
  const drizzleDb = getDb(db);
  const threshold = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const result = await drizzleDb.delete(toolOperations)
    .where(lt(toolOperations.createdAt, threshold));
  return result.meta.changes ?? 0;
}
