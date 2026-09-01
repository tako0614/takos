import type { SqlDatabaseLike } from "../../../infra/db/index.ts";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";

function isRawSqlBinding(value: SqlDatabaseLike): value is SqlDatabaseBinding {
  return typeof (value as SqlDatabaseBinding).prepare === "function";
}

export class ThreadMessageSequenceUnavailableError extends Error {
  constructor(threadId: string) {
    super(`thread message sequence reservation failed: ${threadId}`);
    this.name = "ThreadMessageSequenceUnavailableError";
  }
}

/**
 * Atomically reserve a contiguous range in a thread's DB-owned message
 * sequence. Production bindings always take this path. A null return is kept
 * only for drizzle-only unit-test doubles, whose unique-index retry remains a
 * deterministic fallback.
 */
export async function reserveThreadMessageSequence(
  db: SqlDatabaseLike,
  threadId: string,
  count = 1,
  options: { requireActive?: boolean } = {},
): Promise<number | null> {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error("message sequence reservation count must be positive");
  }
  if (!isRawSqlBinding(db)) return null;

  const statusPredicate = options.requireActive ? ` AND "status" = ?` : "";
  const row = await db
    .prepare(
      `UPDATE "threads"
       SET "next_message_sequence" = "next_message_sequence" + ?
       WHERE "id" = ?${statusPredicate}
       RETURNING "next_message_sequence" - ? AS "start_sequence"`,
    )
    .bind(
      count,
      threadId,
      ...(options.requireActive ? ["active"] : []),
      count,
    )
    .first<{ start_sequence?: number | string }>();
  const start = row?.start_sequence;
  const normalized =
    typeof start === "number"
      ? start
      : typeof start === "string" && /^\d+$/u.test(start)
        ? Number(start)
        : null;
  if (
    normalized === null ||
    !Number.isSafeInteger(normalized) ||
    normalized < 0
  ) {
    throw new ThreadMessageSequenceUnavailableError(threadId);
  }
  return normalized;
}
