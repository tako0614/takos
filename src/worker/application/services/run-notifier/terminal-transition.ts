import type {
  SqlDatabaseBinding,
  ObjectStoreBinding,
  SqlPreparedStatementBinding,
  SqlResultBinding,
  SqlTransactionSessionBinding,
} from "../../../shared/types/bindings.ts";
import { affectedRowCount } from "../../../shared/utils/affected-row-count.ts";
import { computeSHA256 } from "../../../shared/utils/hash.ts";
import { logWarn } from "../../../shared/utils/logger.ts";
import { buildTerminalIndexOutboxStatements } from "./index-outbox.ts";

export type ControlTerminalStatus = "failed" | "cancelled";
export type ActiveRunStatus = "pending" | "queued" | "running";

export interface ControlTerminalTransitionInput {
  runId: string;
  status: ControlTerminalStatus;
  expectedStatuses: ActiveRunStatus[];
  expectedServiceId?: string;
  expectedLeaseVersion?: number;
  completedAt: string;
  error?: string | null;
  output?: string | null;
  eventType: string;
  terminalEvent: Record<string, unknown>;
}

export interface ControlTerminalTransitionResult {
  committed: boolean;
  eventId: number | null;
  completionKey: string;
}

export interface ControlTerminalTransitionOptions {
  offloadBucket?: ObjectStoreBinding;
}

type StatementFactory =
  | Pick<SqlDatabaseBinding, "prepare">
  | Pick<SqlTransactionSessionBinding, "prepare">;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

async function transitionKey(
  input: ControlTerminalTransitionInput,
): Promise<string> {
  const digest = await computeSHA256(JSON.stringify(canonicalize(input)));
  return `control-terminal:${digest}`;
}

function buildStatements(
  factory: StatementFactory,
  input: ControlTerminalTransitionInput,
  completionKey: string,
  expectedEngineCheckpoint: string | null,
): SqlPreparedStatementBinding[] {
  if (input.expectedStatuses.length === 0) {
    throw new Error("terminal transition requires an expected active status");
  }
  const setClauses = [
    '"status" = ?',
    '"completed_at" = ?',
    '"completion_key" = ?',
    '"engine_checkpoint" = NULL',
    '"engine_checkpoint_updated_at" = NULL',
  ];
  const updateArgs: unknown[] = [
    input.status,
    input.completedAt,
    completionKey,
  ];
  if (Object.hasOwn(input, "error")) {
    setClauses.push('"error" = ?');
    updateArgs.push(input.error ?? null);
  }
  if (Object.hasOwn(input, "output")) {
    setClauses.push('"output" = ?');
    updateArgs.push(input.output ?? null);
  }

  const where = [
    '"id" = ?',
    `"status" IN (${input.expectedStatuses.map(() => "?").join(", ")})`,
  ];
  updateArgs.push(input.runId, ...input.expectedStatuses);
  if (input.expectedServiceId !== undefined) {
    where.push('"service_id" = ?');
    updateArgs.push(input.expectedServiceId);
  }
  if (input.expectedLeaseVersion !== undefined) {
    where.push('"lease_version" = ?');
    updateArgs.push(input.expectedLeaseVersion);
  }
  if (expectedEngineCheckpoint === null) {
    where.push('"engine_checkpoint" IS NULL');
  } else {
    where.push('"engine_checkpoint" = ?');
    updateArgs.push(expectedEngineCheckpoint);
  }

  const eventKey = `run:${input.runId}:control:${completionKey}:terminal-status:${input.status}`;
  const statements: SqlPreparedStatementBinding[] = [
    factory
      .prepare(
        `UPDATE "runs"
         SET ${setClauses.join(", ")}
         WHERE ${where.join(" AND ")}`,
      )
      .bind(...updateArgs),
  ];
  const committedPredicate =
    'r."id" = ? AND r."status" = ? AND r."completion_key" = ?';
  const committedPredicateArgs = [input.runId, input.status, completionKey];
  statements.push(
    ...buildTerminalIndexOutboxStatements(factory, {
      completionKey,
      createdAt: input.completedAt,
      runPredicateSql: committedPredicate,
      runPredicateArgs: committedPredicateArgs,
    }),
  );
  statements.push(
    factory
      .prepare(
        `INSERT INTO "run_events"
           ("run_id", "type", "event_key", "data", "created_at")
         SELECT r."id", ?, ?, ?, ?
         FROM "runs" r
         WHERE r."id" = ? AND r."status" = ? AND r."completion_key" = ?
         ON CONFLICT ("event_key") DO NOTHING
         RETURNING "id"`,
      )
      .bind(
        input.eventType,
        eventKey,
        JSON.stringify(input.terminalEvent),
        input.completedAt,
        input.runId,
        input.status,
        completionKey,
      ),
  );
  return statements;
}

async function execute(
  db: SqlDatabaseBinding,
  input: ControlTerminalTransitionInput,
  completionKey: string,
  expectedEngineCheckpoint: string | null,
): Promise<SqlResultBinding<Record<string, unknown>>[]> {
  if (db.withTransaction) {
    return await db.withTransaction(
      async (tx) =>
        await tx.batch<Record<string, unknown>>(
          buildStatements(tx, input, completionKey, expectedEngineCheckpoint),
        ),
    );
  }
  return await db.batch<Record<string, unknown>>(
    buildStatements(db, input, completionKey, expectedEngineCheckpoint),
  );
}

function activeRunPredicate(input: ControlTerminalTransitionInput): {
  sql: string;
  args: unknown[];
} {
  if (input.expectedStatuses.length === 0) {
    throw new Error("terminal transition requires an expected active status");
  }
  const where = [
    '"id" = ?',
    `"status" IN (${input.expectedStatuses.map(() => "?").join(", ")})`,
  ];
  const args: unknown[] = [input.runId, ...input.expectedStatuses];
  if (input.expectedServiceId !== undefined) {
    where.push('"service_id" = ?');
    args.push(input.expectedServiceId);
  }
  if (input.expectedLeaseVersion !== undefined) {
    where.push('"lease_version" = ?');
    args.push(input.expectedLeaseVersion);
  }
  return { sql: where.join(" AND "), args };
}

async function readActiveEngineCheckpoint(
  db: SqlDatabaseBinding,
  input: ControlTerminalTransitionInput,
): Promise<{ found: boolean; checkpoint: string | null }> {
  const predicate = activeRunPredicate(input);
  const row = await db
    .prepare(
      `SELECT "engine_checkpoint" AS "engineCheckpoint"
       FROM "runs"
       WHERE ${predicate.sql}
       LIMIT 1`,
    )
    .bind(...predicate.args)
    .first<{ engineCheckpoint: unknown }>();
  if (!row) return { found: false, checkpoint: null };
  if (
    row.engineCheckpoint !== null &&
    typeof row.engineCheckpoint !== "string"
  ) {
    throw new Error("run engine checkpoint pointer must be text or null");
  }
  return {
    found: true,
    checkpoint: row.engineCheckpoint as string | null,
  };
}

function engineCheckpointObjectKey(stored: string | null): string | null {
  if (!stored?.startsWith("r2:")) return null;
  return stored.slice("r2:".length) || null;
}

export async function transitionRunTerminalAtomically(
  db: SqlDatabaseBinding,
  input: ControlTerminalTransitionInput,
  options: ControlTerminalTransitionOptions = {},
): Promise<ControlTerminalTransitionResult> {
  const completionKey = await transitionKey(input);
  const current = await readActiveEngineCheckpoint(db, input);
  if (!current.found) {
    return { committed: false, eventId: null, completionKey };
  }
  const results = await execute(db, input, completionKey, current.checkpoint);
  const eventIdValue = results.at(-1)?.results[0]?.id;
  const eventId =
    typeof eventIdValue === "number"
      ? eventIdValue
      : typeof eventIdValue === "string" && /^\d+$/u.test(eventIdValue)
        ? Number(eventIdValue)
        : null;
  const committed = affectedRowCount(results[0]) > 0;
  const checkpointObjectKey = engineCheckpointObjectKey(current.checkpoint);
  if (committed && checkpointObjectKey && options.offloadBucket) {
    await options.offloadBucket.delete(checkpointObjectKey).catch((error) => {
      logWarn("Terminal engine checkpoint cleanup failed", {
        module: "terminal-transition",
        runId: input.runId,
        error: String(error),
      });
    });
  }
  return {
    committed,
    eventId,
    completionKey,
  };
}
