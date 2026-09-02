/**
 * Runtime D1 self-migration.
 *
 * Every Takos install path (wrangler, OpenTofu/Takosumi BYOC, the self-host
 * node platform) has to end up on the same control schema. The Cloudflare
 * OpenTofu provider cannot express D1 migration execution, and the helper
 * bridge that fills that gap only runs in disposable modes, so the Worker
 * converges the schema itself instead of depending on an out-of-band step.
 *
 * Invariants:
 *   - A migration is recorded applied only when its statements committed. Each
 *     file is applied as one `batch()`, and the ledger row is the last
 *     statement of that same batch. Real D1 rolls a failed batch back whole.
 *   - The ledger is the OpenTofu bridge's table, with the bridge's checksum
 *     format, so a bridge-migrated database is already recognised as migrated
 *     and neither side re-applies what the other applied.
 *   - Concurrent isolates cannot double-apply: a claim row with a lease is
 *     taken atomically, and its holder is read back before any SQL runs.
 *   - Failure is closed and visible: nothing is half-recorded, the failing
 *     migration name and error are persisted, and callers turn a non-ready
 *     schema into an explicit 503 rather than a confusing SQL error.
 */

import type {
  SqlDatabaseBinding,
  SqlPreparedStatementBinding,
} from "../../shared/types/bindings.ts";
import {
  splitSqlStatements,
  stripLeadingSqlComments,
} from "../../local-platform/d1-sql-rewrite.ts";
import { EMBEDDED_MIGRATIONS, type EmbeddedMigration } from "./migration-set.ts";

/**
 * The OpenTofu bridge's ledger table, reused verbatim
 * (`scripts/takos-cloudflare-opentofu-bridge.ts`). Same name, same columns,
 * same `sha256:<hex>` checksum format, so either writer's records are readable
 * — and valid — to the other.
 */
export const MIGRATION_LEDGER_TABLE = "_takos_opentofu_migrations";

/** Claim row used to serialize migration application across isolates. */
export const MIGRATION_LOCK_TABLE = "_takos_runtime_migration_lock";

/** Ledger written by `wrangler d1 migrations apply` (wrangler's default table). */
export const WRANGLER_LEDGER_TABLE = "d1_migrations";

/** Ledger written by the self-host node platform (`d1-migrations.ts`). */
export const SELF_HOST_LEDGER_TABLE = "_takos_self_host_migrations";

export type SchemaState =
  /** Every embedded migration is recorded applied. */
  | "ready"
  /** Migrations remain; nobody holds the claim right now. */
  | "pending"
  /** Another isolate holds an unexpired claim. */
  | "applying"
  /** A migration failed, or the ledger disagrees with the embedded set. */
  | "failed";

export type SchemaStatus = {
  readonly state: SchemaState;
  readonly total: number;
  readonly applied: number;
  readonly pending: readonly string[];
  readonly ledgerTable: string;
  /** Prior ledger this database's applied records were imported from, if any. */
  readonly adoptedFrom?: "wrangler" | "self-host";
  readonly failedMigration?: string;
  readonly error?: string;
  /** Seconds a caller should wait before retrying a request that needs the schema. */
  readonly retryAfterSeconds?: number;
};

export type MigrationClock = () => number;

export type RunMigrationsOptions = {
  readonly migrations?: readonly EmbeddedMigration[];
  readonly now?: MigrationClock;
  /** Claim lease length. A crashed holder's claim expires after this. */
  readonly leaseMs?: number;
  /** Wall-clock budget for one run. Remaining migrations stay pending. */
  readonly budgetMs?: number;
  /** Cool-down before a recorded failure is retried automatically. */
  readonly failureRetryAfterMs?: number;
  /** Retry a recorded failure immediately (the explicit operator trigger). */
  readonly retryFailed?: boolean;
  /** Claim holder id. Defaults to a random id. */
  readonly holder?: string;
};

const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_BUDGET_MS = 20_000;
const DEFAULT_FAILURE_RETRY_AFTER_MS = 60_000;
const RETRY_AFTER_SECONDS = 5;

const LOCK_STATUS_APPLYING = "applying";
const LOCK_STATUS_READY = "ready";
const LOCK_STATUS_PENDING = "pending";
const LOCK_STATUS_FAILED = "failed";

// ---------------------------------------------------------------------------
// Statement preparation
// ---------------------------------------------------------------------------

/**
 * Rewrite the foreign-key PRAGMAs so a migration keeps its meaning inside the
 * implicit transaction `batch()` opens.
 *
 * `PRAGMA foreign_keys` is a documented no-op inside a transaction, so the
 * table-rebuild migrations that open with `foreign_keys = OFF` would silently
 * run under enforcement. `defer_foreign_keys = ON` is the in-transaction
 * equivalent: constraints are checked once, at COMMIT. That also makes the
 * trailing `PRAGMA foreign_key_check` redundant — a violation now fails the
 * commit and rolls the whole migration back, instead of being reported in a
 * result set nobody can act on after the fact.
 */
export function normalizeMigrationStatementForBatch(
  statement: string,
): string | null {
  if (/^PRAGMA\s+foreign_keys\s*=\s*OFF\s*;?$/i.test(statement)) {
    return "PRAGMA defer_foreign_keys = ON";
  }
  if (/^PRAGMA\s+foreign_keys\s*=\s*ON\s*;?$/i.test(statement)) {
    return null;
  }
  if (/^PRAGMA\s+foreign_key_check\b/i.test(statement)) {
    return null;
  }
  return statement;
}

/** Split one migration file into the statements a single `batch()` will run. */
export function migrationStatements(sql: string): string[] {
  return splitSqlStatements(sql)
    .map(stripLeadingSqlComments)
    .filter((statement) => statement.length > 0)
    .map(normalizeMigrationStatementForBatch)
    .filter((statement): statement is string => statement !== null);
}

// ---------------------------------------------------------------------------
// Schema bootstrap
// ---------------------------------------------------------------------------

const LEDGER_DDL =
  `CREATE TABLE IF NOT EXISTS "${MIGRATION_LEDGER_TABLE}" (name TEXT PRIMARY KEY NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)`;

const LOCK_DDL = `CREATE TABLE IF NOT EXISTS "${MIGRATION_LOCK_TABLE}" (
  "id" INTEGER PRIMARY KEY,
  "holder" TEXT,
  "lease_expires_at" TEXT,
  "status" TEXT NOT NULL,
  "detail" TEXT,
  "updated_at" TEXT NOT NULL
)`;

export async function ensureMigrationTables(
  db: SqlDatabaseBinding,
): Promise<void> {
  await db.prepare(LEDGER_DDL).run();
  await db.prepare(LOCK_DDL).run();
}

async function tableExists(
  db: SqlDatabaseBinding,
  name: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    )
    .bind(name)
    .first<{ name: string }>();
  return row !== null;
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export type LedgerRecord = { readonly name: string; readonly checksum: string };

async function readLedger(
  db: SqlDatabaseBinding,
): Promise<Map<string, string>> {
  const result = await db
    .prepare(
      `SELECT name, checksum FROM "${MIGRATION_LEDGER_TABLE}" ORDER BY name`,
    )
    .all<LedgerRecord>();
  const ledger = new Map<string, string>();
  for (const row of result.results) {
    ledger.set(String(row.name), String(row.checksum));
  }
  return ledger;
}

class LedgerConflictError extends Error {
  constructor(
    readonly code: string,
    readonly migration: string | undefined,
  ) {
    super(migration ? `${code}: ${migration}` : code);
    this.name = "LedgerConflictError";
  }
}

/**
 * Compare the ledger with the embedded set the way the bridge does: every
 * recorded name must exist in the set, every recorded checksum must match, and
 * the applied names must form a contiguous prefix. Anything else means this
 * database came from a different migration lineage and must not be written to.
 */
function pendingAfterLedger(
  migrations: readonly EmbeddedMigration[],
  ledger: Map<string, string>,
): { applied: string[]; pending: EmbeddedMigration[] } {
  const known = new Set(migrations.map((migration) => migration.name));
  for (const name of ledger.keys()) {
    if (!known.has(name)) {
      throw new LedgerConflictError("migration_ledger_unknown", name);
    }
  }

  const applied: string[] = [];
  const pending: EmbeddedMigration[] = [];
  let encounteredPending = false;
  for (const migration of migrations) {
    const checksum = ledger.get(migration.name);
    if (checksum === undefined) {
      encounteredPending = true;
      pending.push(migration);
      continue;
    }
    if (checksum !== migration.sha256 && `sha256:${checksum}` !== migration.sha256) {
      throw new LedgerConflictError("migration_checksum_drift", migration.name);
    }
    if (encounteredPending) {
      throw new LedgerConflictError(
        "migration_ledger_out_of_order",
        migration.name,
      );
    }
    applied.push(migration.name);
  }
  return { applied, pending };
}

/**
 * Import an earlier install path's records so its database is recognised as
 * already migrated.
 *
 * Only runs when this ledger is empty, so it can never contradict a record the
 * bridge or an earlier run wrote. The imported checksum is the embedded file's
 * own digest: migration files are append-only and content-locked by
 * `bun run check:migration-set`, so a recorded name identifies exactly one
 * byte sequence.
 */
async function adoptForeignLedger(
  db: SqlDatabaseBinding,
  migrations: readonly EmbeddedMigration[],
  appliedAt: string,
): Promise<"wrangler" | "self-host" | undefined> {
  const sources = [
    { table: WRANGLER_LEDGER_TABLE, label: "wrangler" as const },
    { table: SELF_HOST_LEDGER_TABLE, label: "self-host" as const },
  ];
  const byName = new Map(
    migrations.map((migration) => [migration.name, migration] as const),
  );

  for (const source of sources) {
    if (!(await tableExists(db, source.table))) continue;
    const rows = await db
      .prepare(`SELECT name FROM "${source.table}" ORDER BY name`)
      .all<{ name: string }>();
    const names = rows.results
      .map((row) => String(row.name))
      .filter((name) => name.length > 0);
    if (names.length === 0) continue;

    const inserts: SqlPreparedStatementBinding[] = [];
    for (const name of names) {
      const migration = byName.get(name);
      if (!migration) {
        throw new LedgerConflictError("migration_ledger_unknown", name);
      }
      inserts.push(
        db
          .prepare(
            `INSERT INTO "${MIGRATION_LEDGER_TABLE}" (name, checksum, applied_at) VALUES (?, ?, ?)`,
          )
          .bind(migration.name, migration.sha256, appliedAt),
      );
    }
    await db.batch(inserts);
    return source.label;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Claim row
// ---------------------------------------------------------------------------

type LockRow = {
  readonly holder: string | null;
  readonly lease_expires_at: string | null;
  readonly status: string;
  readonly detail: string | null;
  readonly updated_at: string;
};

async function readLock(db: SqlDatabaseBinding): Promise<LockRow | null> {
  return await db
    .prepare(
      `SELECT holder, lease_expires_at, status, detail, updated_at FROM "${MIGRATION_LOCK_TABLE}" WHERE id = 1`,
    )
    .first<LockRow>();
}

/**
 * Take the claim atomically.
 *
 * D1 has no advisory locks, so the claim is a single conditional upsert: the
 * `DO UPDATE` only fires when the row is free or its lease has expired. The
 * holder is then read back, which is what actually decides the race — it does
 * not depend on how faithfully a driver reports `meta.changes`.
 */
async function acquireLock(
  db: SqlDatabaseBinding,
  holder: string,
  nowIso: string,
  expiresIso: string,
): Promise<boolean> {
  await db
    .prepare(
      `INSERT INTO "${MIGRATION_LOCK_TABLE}" (id, holder, lease_expires_at, status, detail, updated_at)
       VALUES (1, ?, ?, '${LOCK_STATUS_APPLYING}', NULL, ?)
       ON CONFLICT(id) DO UPDATE SET
         holder = excluded.holder,
         lease_expires_at = excluded.lease_expires_at,
         status = '${LOCK_STATUS_APPLYING}',
         detail = NULL,
         updated_at = excluded.updated_at
       WHERE "${MIGRATION_LOCK_TABLE}"."holder" IS NULL
          OR COALESCE("${MIGRATION_LOCK_TABLE}"."lease_expires_at", '') <= ?`,
    )
    .bind(holder, expiresIso, nowIso, nowIso)
    .run();

  const row = await readLock(db);
  return row?.holder === holder;
}

async function releaseLock(
  db: SqlDatabaseBinding,
  holder: string,
  status: string,
  detail: string | null,
  nowIso: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE "${MIGRATION_LOCK_TABLE}"
       SET holder = NULL, lease_expires_at = NULL, status = ?, detail = ?, updated_at = ?
       WHERE id = 1 AND holder = ?`,
    )
    .bind(status, detail, nowIso, holder)
    .run();
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

function statusFromLedger(
  migrations: readonly EmbeddedMigration[],
  ledger: Map<string, string>,
  lock: LockRow | null,
  nowIso: string,
): SchemaStatus {
  let applied: string[];
  let pending: EmbeddedMigration[];
  try {
    const split = pendingAfterLedger(migrations, ledger);
    applied = split.applied;
    pending = split.pending;
  } catch (error) {
    const conflict = error as LedgerConflictError;
    return {
      state: "failed",
      total: migrations.length,
      applied: ledger.size,
      pending: [],
      ledgerTable: MIGRATION_LEDGER_TABLE,
      ...(conflict.migration ? { failedMigration: conflict.migration } : {}),
      error: conflict.message,
    };
  }

  if (pending.length === 0) {
    return {
      state: "ready",
      total: migrations.length,
      applied: applied.length,
      pending: [],
      ledgerTable: MIGRATION_LEDGER_TABLE,
    };
  }

  const pendingNames = pending.map((migration) => migration.name);
  const leaseHeld = lock?.holder != null &&
    (lock.lease_expires_at ?? "") > nowIso;
  if (leaseHeld) {
    return {
      state: "applying",
      total: migrations.length,
      applied: applied.length,
      pending: pendingNames,
      ledgerTable: MIGRATION_LEDGER_TABLE,
      retryAfterSeconds: RETRY_AFTER_SECONDS,
    };
  }
  if (lock?.status === LOCK_STATUS_FAILED) {
    return {
      state: "failed",
      total: migrations.length,
      applied: applied.length,
      pending: pendingNames,
      ledgerTable: MIGRATION_LEDGER_TABLE,
      ...(lock.detail ? { error: lock.detail } : {}),
      ...(pendingNames[0] ? { failedMigration: pendingNames[0] } : {}),
    };
  }
  return {
    state: "pending",
    total: migrations.length,
    applied: applied.length,
    pending: pendingNames,
    ledgerTable: MIGRATION_LEDGER_TABLE,
    retryAfterSeconds: RETRY_AFTER_SECONDS,
  };
}

/** Read-only view of where this database sits against the embedded set. */
export async function readSchemaStatus(
  db: SqlDatabaseBinding,
  options: { readonly migrations?: readonly EmbeddedMigration[]; readonly now?: MigrationClock } = {},
): Promise<SchemaStatus> {
  const migrations = options.migrations ?? EMBEDDED_MIGRATIONS;
  const now = options.now ?? Date.now;
  await ensureMigrationTables(db);
  const ledger = await readLedger(db);
  const lock = await readLock(db);
  return statusFromLedger(
    migrations,
    ledger,
    lock,
    new Date(now()).toISOString(),
  );
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function migrationBatch(
  db: SqlDatabaseBinding,
  migration: EmbeddedMigration,
  appliedAt: string,
): SqlPreparedStatementBinding[] {
  const statements = migrationStatements(migration.sql).map((statement) =>
    db.prepare(statement)
  );
  // The ledger row is the last statement of the same batch, so "applied" and
  // "recorded" commit together or not at all.
  statements.push(
    db
      .prepare(
        `INSERT INTO "${MIGRATION_LEDGER_TABLE}" (name, checksum, applied_at) VALUES (?, ?, ?)`,
      )
      .bind(migration.name, migration.sha256, appliedAt),
  );
  return statements;
}

function randomHolder(): string {
  return `takos-worker-${crypto.randomUUID()}`;
}

/**
 * Apply every pending migration, in order, under the claim.
 *
 * Safe to call concurrently and repeatedly: only the claim holder applies, and
 * an already-recorded migration is never re-run. Returns the resulting status
 * rather than throwing, so callers can turn it into an operator-readable
 * response.
 */
export async function runPendingMigrations(
  db: SqlDatabaseBinding,
  options: RunMigrationsOptions = {},
): Promise<SchemaStatus> {
  const migrations = options.migrations ?? EMBEDDED_MIGRATIONS;
  const now = options.now ?? Date.now;
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const failureRetryAfterMs = options.failureRetryAfterMs ??
    DEFAULT_FAILURE_RETRY_AFTER_MS;
  const holder = options.holder ?? randomHolder();

  await ensureMigrationTables(db);

  const startedAt = now();
  const startedIso = new Date(startedAt).toISOString();
  let lock = await readLock(db);

  // A recorded failure is not retried by ordinary request traffic until the
  // cool-down elapses, so a permanently broken migration is reported once
  // instead of hammering the database. The explicit trigger retries at once.
  if (
    lock?.status === LOCK_STATUS_FAILED &&
    lock.holder === null &&
    !options.retryFailed &&
    Date.parse(lock.updated_at) + failureRetryAfterMs > startedAt
  ) {
    const ledger = await readLedger(db);
    return statusFromLedger(migrations, ledger, lock, startedIso);
  }

  let ledger = await readLedger(db);
  let adoptedFrom: "wrangler" | "self-host" | undefined;
  if (ledger.size === 0) {
    try {
      adoptedFrom = await adoptForeignLedger(db, migrations, startedIso);
    } catch (error) {
      const conflict = error as LedgerConflictError;
      await recordFailure(db, conflict.message, startedIso);
      return {
        state: "failed",
        total: migrations.length,
        applied: 0,
        pending: [],
        ledgerTable: MIGRATION_LEDGER_TABLE,
        error: conflict.message,
      };
    }
    if (adoptedFrom) ledger = await readLedger(db);
  }

  const initial = statusFromLedger(migrations, ledger, null, startedIso);
  if (initial.state === "failed") return withAdoption(initial, adoptedFrom);
  if (initial.state === "ready") {
    await releaseLock(db, holder, LOCK_STATUS_READY, null, startedIso);
    return withAdoption(initial, adoptedFrom);
  }

  const expiresIso = new Date(startedAt + leaseMs).toISOString();
  if (!(await acquireLock(db, holder, startedIso, expiresIso))) {
    lock = await readLock(db);
    return withAdoption(
      statusFromLedger(migrations, ledger, lock, startedIso),
      adoptedFrom,
    );
  }

  const pending = migrations.filter((migration) => !ledger.has(migration.name));
  let appliedCount = ledger.size;
  for (const migration of pending) {
    if (now() - startedAt >= budgetMs) break;
    const appliedAt = new Date(now()).toISOString();
    try {
      await db.batch(migrationBatch(db, migration, appliedAt));
    } catch (error) {
      const message = `${migration.name}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      await releaseLock(
        db,
        holder,
        LOCK_STATUS_FAILED,
        message,
        new Date(now()).toISOString(),
      );
      return withAdoption(
        {
          state: "failed",
          total: migrations.length,
          applied: appliedCount,
          pending: pending
            .slice(pending.indexOf(migration))
            .map((entry) => entry.name),
          ledgerTable: MIGRATION_LEDGER_TABLE,
          failedMigration: migration.name,
          error: message,
        },
        adoptedFrom,
      );
    }
    appliedCount += 1;
  }

  const finalLedger = await readLedger(db);
  const final = statusFromLedger(
    migrations,
    finalLedger,
    null,
    new Date(now()).toISOString(),
  );
  await releaseLock(
    db,
    holder,
    final.state === "ready" ? LOCK_STATUS_READY : LOCK_STATUS_PENDING,
    null,
    new Date(now()).toISOString(),
  );
  return withAdoption(final, adoptedFrom);
}

function withAdoption(
  status: SchemaStatus,
  adoptedFrom: "wrangler" | "self-host" | undefined,
): SchemaStatus {
  return adoptedFrom ? { ...status, adoptedFrom } : status;
}

async function recordFailure(
  db: SqlDatabaseBinding,
  detail: string,
  nowIso: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO "${MIGRATION_LOCK_TABLE}" (id, holder, lease_expires_at, status, detail, updated_at)
       VALUES (1, NULL, NULL, '${LOCK_STATUS_FAILED}', ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         holder = NULL,
         lease_expires_at = NULL,
         status = '${LOCK_STATUS_FAILED}',
         detail = excluded.detail,
         updated_at = excluded.updated_at`,
    )
    .bind(detail, nowIso)
    .run();
}
