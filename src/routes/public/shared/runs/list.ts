import type { Run, SqlDatabaseBinding } from "takos-api-contract/shared/types";
import { asRunRow, runRowToApi } from "takos-api-contract/shared/types/runs";
import { readThreadAccess } from "../threads/read-model.ts";

const RUN_LIST_CURSOR_DELIMITER = ",";
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type ListThreadRunsOptions = {
  activeOnly: boolean;
  limit: number;
  cursor?: string;
};

export type ListThreadRunsResult = {
  runs: Run[];
  limit: number;
  active_only: boolean;
  cursor: string | null;
  next_cursor: string | null;
};

export class InvalidRunListCursorError extends Error {
  constructor() {
    super("Invalid cursor");
    this.name = "InvalidRunListCursorError";
  }
}

type ParsedRunListCursor = {
  createdAt: string;
  runId: string | null;
};

export async function listThreadRuns(
  db: SqlDatabaseBinding,
  threadId: string,
  actorAccountId: string,
  options: ListThreadRunsOptions,
): Promise<ListThreadRunsResult | null> {
  const access = await readThreadAccess(db, threadId, actorAccountId);
  if (!access) return null;

  let parsedCursor: ParsedRunListCursor | null = null;
  if (options.cursor) {
    parsedCursor = parseRunListCursor(options.cursor);
    if (!parsedCursor) throw new InvalidRunListCursorError();
  }

  const conditions = ["thread_id = ?"];
  const bindings: unknown[] = [threadId];
  if (options.activeOnly) {
    conditions.push("status IN ('pending', 'queued', 'running')");
  }
  if (parsedCursor?.createdAt) {
    if (parsedCursor.runId) {
      conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
      bindings.push(
        parsedCursor.createdAt,
        parsedCursor.createdAt,
        parsedCursor.runId,
      );
    } else {
      conditions.push("created_at < ?");
      bindings.push(parsedCursor.createdAt);
    }
  }
  bindings.push(options.limit);

  const rows = await db.prepare(`
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
    WHERE ${conditions.join(" AND ")}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).bind(...bindings).all<Record<string, unknown>>();

  const runRows = rows.results;
  const lastRow = runRows[runRows.length - 1];
  const nextCursor = runRows.length === options.limit && lastRow
    ? encodeRunListCursor(
      stringField(lastRow, "createdAt"),
      stringField(lastRow, "id"),
    )
    : null;
  const normalizedCursor = parsedCursor
    ? (parsedCursor.runId
      ? encodeRunListCursor(parsedCursor.createdAt, parsedCursor.runId)
      : parsedCursor.createdAt)
    : null;

  return {
    runs: runRows.map((row) => runRowToApi(asRunRow(row))),
    limit: options.limit,
    active_only: options.activeOnly,
    cursor: normalizedCursor,
    next_cursor: nextCursor,
  };
}

function encodeRunListCursor(createdAt: string, runId: string): string {
  return `${createdAt}${RUN_LIST_CURSOR_DELIMITER}${runId}`;
}

function parseRunListCursor(cursor: string): ParsedRunListCursor | null {
  const delimiterIndex = cursor.indexOf(RUN_LIST_CURSOR_DELIMITER);
  const hasCompositeToken = delimiterIndex >= 0;
  const rawCreatedAt = hasCompositeToken
    ? cursor.slice(0, delimiterIndex)
    : cursor;
  const rawRunId = hasCompositeToken ? cursor.slice(delimiterIndex + 1) : null;

  const ts = Date.parse(rawCreatedAt);
  if (!Number.isFinite(ts)) return null;
  if (rawRunId !== null && !OPAQUE_ID_PATTERN.test(rawRunId)) return null;

  return {
    createdAt: new Date(ts).toISOString(),
    runId: rawRunId,
  };
}

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  throw new TypeError(`Run row field ${key} must be a string`);
}
