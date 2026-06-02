import type { SqlDatabaseBinding } from "../types/bindings.ts";

/**
 * D1 transaction semantics, summarized.
 *
 * Cloudflare D1 prepared statements are dispatched as stateless HTTP requests
 * to the underlying SQLite leader: each `db.prepare(...).run()` call is an
 * independent round-trip with no shared session, so the textual statements
 * `BEGIN IMMEDIATE`, `COMMIT`, `SAVEPOINT`, and `ROLLBACK` do NOT compose into
 * an atomic unit when issued sequentially against a real D1 binding. The
 * server happily executes each statement and acknowledges success, but a
 * subsequent failure between BEGIN and COMMIT does not roll the BEGIN'd work
 * back -- there is no transaction to roll back, because there was never a
 * sticky session in the first place.
 *
 * For real atomic batches against D1, callers must instead use the D1
 * `batch([statement1, statement2, ...])` API, which the platform guarantees
 * to execute atomically on the leader. For composite multi-step workflows
 * that cannot be expressed as a single static `batch(...)`, services must
 * implement explicit compensation in the application layer (e.g. write a
 * tombstone row + reconcile in a background job).
 *
 * To make this contract explicit, `D1TransactionManager` accepts an explicit
 * runtime `mode`:
 *   - `"local-sqlite"`: the underlying binding is stateful (libsql /
 *     `node:sqlite` / miniflare-backed local D1), so BEGIN/COMMIT/SAVEPOINT
 *     compose correctly and savepoint-based nesting is honoured. This is the
 *     mode used by the persistent local SQL adapter and by tests.
 *   - `"d1"`: the underlying binding is real Cloudflare D1.
 *     `runInTransaction` throws `transaction_unsupported` immediately so
 *     calling code surfaces the misuse rather than silently relying on
 *     non-atomic BEGIN/COMMIT. The chosen mitigation for D1 callers is
 *     service-layer compensation (or, where the work is static, the D1
 *     `batch()` API).
 *   - `"d1-compensated"`: the underlying binding is real Cloudflare D1 AND the
 *     caller has explicitly accepted that the wrapped writes are NOT atomic —
 *     consistency is provided by service-layer compensation (e.g. a reconcile
 *     queue / `syncState` healing), not by this manager. `runInTransaction`
 *     runs the callback directly with NO BEGIN/COMMIT/SAVEPOINT, so it makes no
 *     false atomicity claim. Use this only for write groups whose partial
 *     failures are detected and repaired by a background reconciler.
 *   - `"unknown"` (default): preserves the historical behaviour of issuing
 *     BEGIN/COMMIT/SAVEPOINT against the binding. This keeps existing
 *     in-memory and local-sqlite call sites working without a wire-up
 *     change. Operators wiring this against real D1 MUST pass `mode: "d1"`
 *     (hard guard) or, for reconcile-backed writes, `mode: "d1-compensated"`.
 */
export type D1TransactionMode =
  | "local-sqlite"
  | "d1"
  | "d1-compensated"
  | "unknown";

export type D1TransactionManagerOptions = {
  /**
   * Explicit runtime kind. When omitted, defaults to `"unknown"`, which
   * preserves backwards-compatible behaviour (BEGIN/COMMIT/SAVEPOINT issued
   * directly). Pass `"d1"` whenever the binding is a real Cloudflare D1
   * binding so misuse is detected.
   */
  mode?: D1TransactionMode;
};

/**
 * Thrown synchronously from `runInTransaction` when the manager is configured
 * for real D1 (`mode: "d1"`). Callers must switch to D1 `batch()` for static
 * atomic groups, or implement service-layer compensation.
 */
export class TransactionUnsupportedError extends Error {
  readonly code = "transaction_unsupported" as const;
  constructor(message?: string) {
    super(
      message ??
        "transaction_unsupported: D1TransactionManager.runInTransaction is not safe against real Cloudflare D1. Use D1 batch() for static atomic groups, or implement service-layer compensation.",
    );
    this.name = "TransactionUnsupportedError";
  }
}

/**
 * Manages nested SQL transactions using savepoints when the binding is a
 * stateful local SQLite (libsql / `node:sqlite` / miniflare-backed local D1).
 *
 * The first call to `runInTransaction` opens a real transaction (BEGIN
 * IMMEDIATE). Nested calls create savepoints so that inner failures roll back
 * only the inner scope. Transaction depth is tracked in a try/finally block
 * to ensure consistent state even when the callback throws.
 *
 * When constructed with `mode: "d1"`, `runInTransaction` instead throws
 * `TransactionUnsupportedError` to surface the fact that BEGIN/COMMIT do not
 * compose against real Cloudflare D1. With `mode: "d1-compensated"` it runs the
 * callback directly (no BEGIN/COMMIT) for reconcile-backed write groups. See
 * module JSDoc above for the rationale and the chosen mitigation (D1 `batch()`
 * or service-layer compensation).
 */
export class D1TransactionManager {
  private transactionDepth = 0;
  private savepointSeq = 0;
  private readonly mode: D1TransactionMode;

  constructor(
    private db: SqlDatabaseBinding,
    options: D1TransactionManagerOptions = {},
  ) {
    this.mode = options.mode ?? "unknown";
  }

  async runInTransaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.mode === "d1") {
      throw new TransactionUnsupportedError();
    }

    if (this.mode === "d1-compensated") {
      // No atomicity claim: run the writes directly. Consistency is the
      // caller's responsibility via service-layer compensation (reconcile).
      return await fn();
    }

    // Safe path (DQ1 fix): when the underlying binding exposes an explicit
    // transaction primitive (postgres / local-sqlite adapters), route through it
    // so the whole callback runs on one dedicated connection under an exclusive
    // gate. This avoids the flag-routed BEGIN/COMMIT path, which could leak
    // concurrent non-transactional queries into an open transaction. Real
    // Cloudflare D1 does not implement `withTransaction`, so it falls through to
    // the historical BEGIN/COMMIT/SAVEPOINT behaviour below (already guarded by
    // the `"d1"` / `"d1-compensated"` modes for production correctness).
    //
    // `fn` closes over the same binding, so its inner statements are routed onto
    // the transaction's dedicated client by the adapter; nesting is naturally a
    // no-op extra `withTransaction` (the gate is re-entrant-safe only across
    // distinct transactions, so we only delegate at the top level and keep
    // savepoint nesting for inner scopes).
    if (
      this.transactionDepth === 0 &&
      typeof this.db.withTransaction === "function"
    ) {
      this.transactionDepth += 1;
      try {
        return await this.db.withTransaction(() => fn());
      } finally {
        this.transactionDepth -= 1;
      }
    }

    if (this.transactionDepth === 0) {
      this.transactionDepth += 1;
      await this.db.prepare("BEGIN IMMEDIATE").run();
      try {
        const result = await fn();
        await this.db.prepare("COMMIT").run();
        return result;
      } catch (error) {
        try {
          await this.db.prepare("ROLLBACK").run();
        } catch {
          // Ignore rollback failures and rethrow the original error.
        }
        throw error;
      } finally {
        this.transactionDepth -= 1;
      }
    }

    const savepointName = `sp_${++this.savepointSeq}`;
    this.transactionDepth += 1;
    await this.db.prepare(`SAVEPOINT ${savepointName}`).run();
    try {
      const result = await fn();
      await this.db.prepare(`RELEASE SAVEPOINT ${savepointName}`).run();
      return result;
    } catch (error) {
      try {
        await this.db.prepare(`ROLLBACK TO SAVEPOINT ${savepointName}`).run();
        await this.db.prepare(`RELEASE SAVEPOINT ${savepointName}`).run();
      } catch {
        // Ignore rollback failures and rethrow the original error.
      }
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }
}
