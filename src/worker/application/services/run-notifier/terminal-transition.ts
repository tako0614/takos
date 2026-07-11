import type {
  SqlDatabaseBinding,
  SqlPreparedStatementBinding,
  SqlResultBinding,
  SqlTransactionSessionBinding,
} from "../../../shared/types/bindings.ts";
import { affectedRowCount } from "../../../shared/utils/affected-row-count.ts";
import { computeSHA256 } from "../../../shared/utils/hash.ts";
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
): Promise<SqlResultBinding<Record<string, unknown>>[]> {
  if (db.withTransaction) {
    return await db.withTransaction(
      async (tx) =>
        await tx.batch<Record<string, unknown>>(
          buildStatements(tx, input, completionKey),
        ),
    );
  }
  return await db.batch<Record<string, unknown>>(
    buildStatements(db, input, completionKey),
  );
}

export async function transitionRunTerminalAtomically(
  db: SqlDatabaseBinding,
  input: ControlTerminalTransitionInput,
): Promise<ControlTerminalTransitionResult> {
  const completionKey = await transitionKey(input);
  const results = await execute(db, input, completionKey);
  const eventIdValue = results.at(-1)?.results[0]?.id;
  const eventId =
    typeof eventIdValue === "number"
      ? eventIdValue
      : typeof eventIdValue === "string" && /^\d+$/u.test(eventIdValue)
        ? Number(eventIdValue)
        : null;
  return {
    committed: affectedRowCount(results[0]) > 0,
    eventId,
    completionKey,
  };
}
