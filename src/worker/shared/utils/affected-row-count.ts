/**
 * Cross-driver accessor for the number of rows mutated by a SQL run result.
 *
 * Drizzle / Cloudflare / sqlite drivers each surface the affected-row count
 * on a different field of the run result:
 *
 * - **D1Result** (Cloudflare D1, runtime production driver): the count lives
 *   on `result.meta.changes`. D1's meta also carries `changed_db`,
 *   `last_row_id`, `rows_read`, `rows_written` etc., but the canonical mutation
 *   count is `meta.changes`.
 * - **libsql ResultSet** (`@libsql/client`, used by the local SQLite stack):
 *   the count lives on `result.rowsAffected` at the top level. There is no
 *   `meta` object.
 * - **better-sqlite3 RunResult** (`node:sqlite` / `better-sqlite3`, used by the
 *   persistent local backend and direct node-sqlite shims): the count lives on
 *   `result.changes` at the top level.
 *
 * Reading `meta.changes` directly works today only because the runtime
 * environment exclusively uses D1 (and an in-memory mock that mimics it). It
 * silently returns `undefined` (and, after `?? 0`, `0`) under libsql or
 * better-sqlite3. Centralising the lookup here keeps "did the row exist?"
 * guards correct across all three drivers.
 *
 * Returns `0` when no count field is present so callers can use it inside
 * `if (affectedRowCount(result) === 0)` guards without optional chaining.
 */
export type AffectedRowCountResult =
  | { meta?: { changes?: number | null } | null }
  | { rowsAffected?: number | null }
  | { changes?: number | null }
  | null
  | undefined
  | unknown;

export function affectedRowCount(result: AffectedRowCountResult): number {
  if (!result || typeof result !== "object") return 0;
  const record = result as {
    changes?: unknown;
    rowsAffected?: unknown;
    meta?: { changes?: unknown } | null;
  };
  const candidate = record.meta?.changes ?? record.changes ??
    record.rowsAffected;
  const value = Number(candidate ?? 0);
  return Number.isFinite(value) ? value : 0;
}
