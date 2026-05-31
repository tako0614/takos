import type {
  SpaceRole,
  SqlDatabaseBinding,
  Thread,
  ThreadStatus,
} from "takos-api-contract/shared/types";
import { readSpaceMembershipRole } from "../spaces/access.ts";

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type ThreadAccessResult = {
  thread: Thread;
  role: SpaceRole;
};

export type ListSpaceThreadsOptions = {
  status?: string;
};

type ThreadRow = {
  id: string;
  spaceId: string;
  title: string | null;
  locale: string | null;
  status: string;
  summary: string | null;
  keyPoints: string | null;
  retrievalIndex: number | null;
  contextWindow: number | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export async function readThreadAccess(
  db: SqlDatabaseBinding,
  threadId: string,
  actorAccountId: string,
  requiredRoles?: SpaceRole[],
): Promise<ThreadAccessResult | null> {
  if (!isValidOpaqueId(threadId) || !isValidOpaqueId(actorAccountId)) {
    return null;
  }
  const row = await db.prepare(`
    SELECT
      id,
      account_id AS spaceId,
      title,
      locale,
      status,
      summary,
      key_points AS keyPoints,
      retrieval_index AS retrievalIndex,
      context_window AS contextWindow,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM threads
    WHERE id = ?
    LIMIT 1
  `).bind(threadId).first<Record<string, unknown>>();
  if (!row) return null;

  const thread = threadRowToApi(asThreadRow(row));
  const role = await readSpaceMembershipRole(
    db,
    thread.space_id,
    actorAccountId,
    requiredRoles,
  );
  if (!role) return null;

  return { thread, role };
}

export async function listSpaceThreads(
  db: SqlDatabaseBinding,
  spaceId: string,
  actorAccountId: string,
  options: ListSpaceThreadsOptions = {},
): Promise<Thread[] | null> {
  const role = await readSpaceMembershipRole(db, spaceId, actorAccountId);
  if (!role) return null;

  const conditions = ["account_id = ?"];
  const bindings: unknown[] = [spaceId];
  if (options.status) {
    conditions.push("status = ?");
    bindings.push(options.status);
  } else {
    conditions.push("status != 'deleted'");
  }

  const rows = await db.prepare(`
    SELECT
      id,
      account_id AS spaceId,
      title,
      locale,
      status,
      summary,
      key_points AS keyPoints,
      retrieval_index AS retrievalIndex,
      context_window AS contextWindow,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM threads
    WHERE ${conditions.join(" AND ")}
    ORDER BY updated_at DESC
  `).bind(...bindings).all<Record<string, unknown>>();

  return rows.results.map((row) => threadRowToApi(asThreadRow(row)));
}

function threadRowToApi(row: ThreadRow): Thread {
  return {
    id: row.id,
    space_id: row.spaceId,
    title: row.title,
    locale: row.locale === "ja" || row.locale === "en" ? row.locale : null,
    status: row.status as ThreadStatus,
    summary: row.summary,
    key_points: row.keyPoints ?? "[]",
    retrieval_index: row.retrievalIndex ?? -1,
    context_window: row.contextWindow ?? 50,
    created_at: toIsoString(row.createdAt),
    updated_at: toIsoString(row.updatedAt),
  };
}

function asThreadRow(row: Record<string, unknown>): ThreadRow {
  return {
    id: stringField(row, "id"),
    spaceId: stringField(row, "spaceId"),
    title: nullableStringField(row, "title"),
    locale: nullableStringField(row, "locale"),
    status: stringField(row, "status"),
    summary: nullableStringField(row, "summary"),
    keyPoints: nullableStringField(row, "keyPoints"),
    retrievalIndex: nullableNumberField(row, "retrievalIndex"),
    contextWindow: nullableNumberField(row, "contextWindow"),
    createdAt: dateField(row, "createdAt"),
    updatedAt: dateField(row, "updatedAt"),
  };
}

function isValidOpaqueId(value: string): boolean {
  const normalized = value.trim();
  return Boolean(normalized) && OPAQUE_ID_PATTERN.test(normalized);
}

function stringField(
  row: Record<string, unknown>,
  key: keyof ThreadRow,
): string {
  const value = row[key];
  if (typeof value === "string") return value;
  throw new TypeError(`Thread row field ${String(key)} must be a string`);
}

function nullableStringField(
  row: Record<string, unknown>,
  key: keyof ThreadRow,
): string | null {
  const value = row[key];
  if (value == null) return null;
  if (typeof value === "string") return value;
  throw new TypeError(
    `Thread row field ${String(key)} must be a string or null`,
  );
}

function nullableNumberField(
  row: Record<string, unknown>,
  key: keyof ThreadRow,
): number | null {
  const value = row[key];
  if (value == null) return null;
  if (typeof value === "number") return value;
  throw new TypeError(
    `Thread row field ${String(key)} must be a number or null`,
  );
}

function dateField(
  row: Record<string, unknown>,
  key: keyof ThreadRow,
): string | Date {
  const value = row[key];
  if (typeof value === "string" || value instanceof Date) return value;
  throw new TypeError(`Thread row field ${String(key)} must be a date`);
}

function toIsoString(value: string | Date): string {
  return typeof value === "string" ? value : value.toISOString();
}
