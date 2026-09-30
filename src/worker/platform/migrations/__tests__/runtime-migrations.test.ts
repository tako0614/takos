import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSqliteSqlDatabase } from "../../../local-platform/persistent-d1.ts";
import type { ServerSqlDatabase } from "../../../local-platform/persistent-d1.ts";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import { EMBEDDED_MIGRATIONS } from "../migration-set.ts";
import {
  MIGRATION_LEDGER_TABLE,
  MIGRATION_LOCK_TABLE,
  SELF_HOST_LEDGER_TABLE,
  WRANGLER_LEDGER_TABLE,
  migrationStatements,
  normalizeMigrationStatementForBatch,
  readSchemaStatus,
  runPendingMigrations,
} from "../runtime-migrations.ts";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let directory: string;
let databases: ServerSqlDatabase[] = [];

async function openDatabase(name = "control.sqlite"): Promise<ServerSqlDatabase> {
  const db = await openSqliteSqlDatabase(join(directory, name));
  databases.push(db);
  return db;
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "takos-runtime-migrations-"));
  databases = [];
});

afterEach(async () => {
  for (const db of databases) {
    try {
      db.close();
    } catch {
      // The shim is already closed when a test closed it explicitly.
    }
  }
  await rm(directory, { force: true, recursive: true });
});

function digest(sql: string): string {
  return `sha256:${createHash("sha256").update(sql, "utf8").digest("hex")}`;
}

function migration(name: string, sql: string) {
  return { name, sha256: digest(sql), sql };
}

const FIXTURE = [
  migration(
    "0001_baseline.sql",
    'CREATE TABLE IF NOT EXISTS "alpha" ("id" TEXT PRIMARY KEY NOT NULL);',
  ),
  migration(
    "0002_beta.sql",
    'CREATE TABLE IF NOT EXISTS "beta" ("id" TEXT PRIMARY KEY NOT NULL);',
  ),
  migration(
    "0003_gamma.sql",
    'CREATE TABLE IF NOT EXISTS "gamma" ("id" TEXT PRIMARY KEY NOT NULL);',
  ),
] as const;

async function tableNames(db: SqlDatabaseBinding): Promise<string[]> {
  const result = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all<{ name: string }>();
  return result.results.map((row) => String(row.name));
}

async function ledgerNames(db: SqlDatabaseBinding): Promise<string[]> {
  const result = await db
    .prepare(`SELECT name FROM "${MIGRATION_LEDGER_TABLE}" ORDER BY name`)
    .all<{ name: string }>();
  return result.results.map((row) => String(row.name));
}

// ---------------------------------------------------------------------------
// Statement normalization
// ---------------------------------------------------------------------------

describe("statement normalization for the batch lane", () => {
  test("foreign_keys = OFF becomes the in-transaction equivalent", () => {
    expect(normalizeMigrationStatementForBatch("PRAGMA foreign_keys=OFF")).toBe(
      "PRAGMA defer_foreign_keys = ON",
    );
    expect(
      normalizeMigrationStatementForBatch("PRAGMA foreign_keys = off;"),
    ).toBe("PRAGMA defer_foreign_keys = ON");
  });

  test("the re-enable and the diagnostic check are dropped", () => {
    expect(normalizeMigrationStatementForBatch("PRAGMA foreign_keys=ON")).toBe(
      null,
    );
    expect(
      normalizeMigrationStatementForBatch("PRAGMA foreign_key_check"),
    ).toBe(null);
  });

  test("ordinary statements survive untouched", () => {
    const statement = 'CREATE TABLE "x" ("id" TEXT)';
    expect(normalizeMigrationStatementForBatch(statement)).toBe(statement);
  });

  test("a migration splits into statements with comments stripped", () => {
    expect(
      migrationStatements(
        '-- header\nPRAGMA foreign_keys=OFF;\nCREATE TABLE "x" ("id" TEXT);\nPRAGMA foreign_keys=ON;\n',
      ),
    ).toEqual([
      "PRAGMA defer_foreign_keys = ON",
      'CREATE TABLE "x" ("id" TEXT)',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Fresh, partial, idempotent
// ---------------------------------------------------------------------------

describe("runPendingMigrations", () => {
  test("applies every migration on a fresh database and records them", async () => {
    const db = await openDatabase();
    const status = await runPendingMigrations(db, { migrations: FIXTURE });

    expect(status.state).toBe("ready");
    expect(status.applied).toBe(3);
    expect(status.pending).toEqual([]);
    expect(status.ledgerTable).toBe(MIGRATION_LEDGER_TABLE);
    expect(await ledgerNames(db)).toEqual([
      "0001_baseline.sql",
      "0002_beta.sql",
      "0003_gamma.sql",
    ]);
    expect(await tableNames(db)).toEqual(
      expect.arrayContaining(["alpha", "beta", "gamma"]),
    );
  });

  test("is idempotent — a second run applies nothing", async () => {
    const db = await openDatabase();
    await runPendingMigrations(db, { migrations: FIXTURE });
    const again = await runPendingMigrations(db, { migrations: FIXTURE });

    expect(again.state).toBe("ready");
    expect(again.applied).toBe(3);
    const applied = await db
      .prepare(
        `SELECT applied_at FROM "${MIGRATION_LEDGER_TABLE}" ORDER BY name`,
      )
      .all<{ applied_at: string }>();
    expect(applied.results).toHaveLength(3);
  });

  test("resumes a partially migrated database without re-applying", async () => {
    const db = await openDatabase();
    await runPendingMigrations(db, { migrations: FIXTURE.slice(0, 1) });
    expect(await ledgerNames(db)).toEqual(["0001_baseline.sql"]);

    const status = await runPendingMigrations(db, { migrations: FIXTURE });
    expect(status.state).toBe("ready");
    expect(await ledgerNames(db)).toEqual([
      "0001_baseline.sql",
      "0002_beta.sql",
      "0003_gamma.sql",
    ]);
  });

  test("stops at the budget and leaves the rest pending", async () => {
    const db = await openDatabase();
    let tick = 0;
    // The budget is consulted before each migration, so a clock that jumps past
    // it after the first one leaves migrations 2 and 3 for the next caller.
    const status = await runPendingMigrations(db, {
      migrations: FIXTURE,
      budgetMs: 10,
      now: () => {
        tick += 1;
        return tick <= 2 ? 0 : 1_000;
      },
    });

    expect(status.state).toBe("pending");
    expect(status.applied).toBe(1);
    expect(status.pending).toEqual(["0002_beta.sql", "0003_gamma.sql"]);

    const finished = await runPendingMigrations(db, { migrations: FIXTURE });
    expect(finished.state).toBe("ready");
  });
});

// ---------------------------------------------------------------------------
// Failure
// ---------------------------------------------------------------------------

describe("a failing migration", () => {
  const broken = [
    FIXTURE[0],
    migration("0002_beta.sql", "THIS IS NOT SQL;"),
    FIXTURE[2],
  ];

  test("fails closed: no ledger row, and the failure is recorded", async () => {
    const db = await openDatabase();
    const status = await runPendingMigrations(db, { migrations: broken });

    expect(status.state).toBe("failed");
    expect(status.failedMigration).toBe("0002_beta.sql");
    expect(status.error).toContain("0002_beta.sql");
    // The first migration committed; the failing one is not recorded, and
    // nothing after it ran.
    expect(await ledgerNames(db)).toEqual(["0001_baseline.sql"]);
    expect(await tableNames(db)).not.toContain("gamma");

    const lock = await db
      .prepare(
        `SELECT holder, status, detail FROM "${MIGRATION_LOCK_TABLE}" WHERE id = 1`,
      )
      .first<{ holder: string | null; status: string; detail: string }>();
    expect(lock?.holder).toBe(null);
    expect(lock?.status).toBe("failed");
    expect(lock?.detail).toContain("0002_beta.sql");
  });

  test("is not retried by ordinary traffic during the cool-down", async () => {
    const db = await openDatabase();
    await runPendingMigrations(db, { migrations: broken });

    const repeat = await runPendingMigrations(db, {
      migrations: broken,
      failureRetryAfterMs: 600_000,
    });
    expect(repeat.state).toBe("failed");
    expect(repeat.pending).toEqual(["0002_beta.sql", "0003_gamma.sql"]);
  });

  test("the explicit trigger retries at once and can succeed after a fix", async () => {
    const db = await openDatabase();
    await runPendingMigrations(db, { migrations: broken });

    const repaired = await runPendingMigrations(db, {
      migrations: FIXTURE,
      failureRetryAfterMs: 600_000,
      retryFailed: true,
    });
    expect(repaired.state).toBe("ready");
    expect(await ledgerNames(db)).toEqual([
      "0001_baseline.sql",
      "0002_beta.sql",
      "0003_gamma.sql",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

describe("concurrent starters", () => {
  test("only one holder applies; the others report applying and never double-apply", async () => {
    const db = await openDatabase();
    const results = await Promise.all([
      runPendingMigrations(db, { migrations: FIXTURE, holder: "isolate-a" }),
      runPendingMigrations(db, { migrations: FIXTURE, holder: "isolate-b" }),
      runPendingMigrations(db, { migrations: FIXTURE, holder: "isolate-c" }),
    ]);

    // Every migration is recorded exactly once, whichever isolate won.
    expect(await ledgerNames(db)).toEqual([
      "0001_baseline.sql",
      "0002_beta.sql",
      "0003_gamma.sql",
    ]);
    expect(results.some((status) => status.state === "ready")).toBe(true);
    for (const status of results) {
      expect(["ready", "applying", "pending"]).toContain(status.state);
      expect(status.state).not.toBe("failed");
    }
  });

  test("a live lease blocks a second starter", async () => {
    const db = await openDatabase();
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    // An empty set bootstraps the ledger and lock tables without applying SQL.
    await runPendingMigrations(db, { migrations: [] });
    await db
      .prepare(
        `INSERT INTO "${MIGRATION_LOCK_TABLE}" (id, holder, lease_expires_at, status, detail, updated_at)
         VALUES (1, 'other-isolate', ?, 'applying', NULL, ?)
         ON CONFLICT(id) DO UPDATE SET
           holder = excluded.holder,
           lease_expires_at = excluded.lease_expires_at,
           status = 'applying',
           updated_at = excluded.updated_at`,
      )
      .bind(new Date(now + 30_000).toISOString(), new Date(now).toISOString())
      .run();

    const status = await runPendingMigrations(db, {
      migrations: FIXTURE,
      holder: "late-isolate",
      now: () => now,
    });
    expect(status.state).toBe("applying");
    expect(status.retryAfterSeconds).toBeGreaterThan(0);
    expect(await ledgerNames(db)).toEqual([]);
  });

  test("an expired lease is taken over", async () => {
    const db = await openDatabase();
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    await runPendingMigrations(db, { migrations: [] });
    await db
      .prepare(
        `INSERT INTO "${MIGRATION_LOCK_TABLE}" (id, holder, lease_expires_at, status, detail, updated_at)
         VALUES (1, 'crashed-isolate', ?, 'applying', NULL, ?)
         ON CONFLICT(id) DO UPDATE SET holder = excluded.holder, lease_expires_at = excluded.lease_expires_at, status = 'applying', updated_at = excluded.updated_at`,
      )
      .bind(
        new Date(now - 60_000).toISOString(),
        new Date(now - 90_000).toISOString(),
      )
      .run();

    const status = await runPendingMigrations(db, {
      migrations: FIXTURE,
      holder: "fresh-isolate",
      now: () => now,
    });
    expect(status.state).toBe("ready");
  });
});

// ---------------------------------------------------------------------------
// Prior ledgers
// ---------------------------------------------------------------------------

describe("prior install paths", () => {
  test("a bridge-migrated ledger is honoured without re-applying", async () => {
    const db = await openDatabase();
    // Exactly what scripts/takos-cloudflare-opentofu-bridge.ts writes.
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS "${MIGRATION_LEDGER_TABLE}" (name TEXT PRIMARY KEY NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)`,
      )
      .run();
    for (const entry of FIXTURE) {
      await db
        .prepare(
          `INSERT INTO "${MIGRATION_LEDGER_TABLE}" (name, checksum, applied_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
        )
        .bind(entry.name, entry.sha256)
        .run();
    }

    const status = await runPendingMigrations(db, { migrations: FIXTURE });
    expect(status.state).toBe("ready");
    expect(status.applied).toBe(3);
    expect(status.adoptedFrom).toBeUndefined();
    // No table was created, because nothing was re-applied.
    expect(await tableNames(db)).not.toContain("alpha");
  });

  test("a checksum that disagrees with the embedded set fails closed", async () => {
    const db = await openDatabase();
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS "${MIGRATION_LEDGER_TABLE}" (name TEXT PRIMARY KEY NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)`,
      )
      .run();
    await db
      .prepare(
        `INSERT INTO "${MIGRATION_LEDGER_TABLE}" (name, checksum, applied_at) VALUES (?, 'sha256:deadbeef', 'x')`,
      )
      .bind(FIXTURE[0].name)
      .run();

    const status = await runPendingMigrations(db, { migrations: FIXTURE });
    expect(status.state).toBe("failed");
    expect(status.error).toContain("migration_checksum_drift");
    expect(await tableNames(db)).not.toContain("alpha");
  });

  test("a ledger name outside the embedded set fails closed", async () => {
    const db = await openDatabase();
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS "${MIGRATION_LEDGER_TABLE}" (name TEXT PRIMARY KEY NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)`,
      )
      .run();
    await db
      .prepare(
        `INSERT INTO "${MIGRATION_LEDGER_TABLE}" (name, checksum, applied_at) VALUES ('9999_from_elsewhere.sql', 'sha256:x', 'x')`,
      )
      .run();

    const status = await runPendingMigrations(db, { migrations: FIXTURE });
    expect(status.state).toBe("failed");
    expect(status.error).toContain("migration_ledger_unknown");
  });

  test("a wrangler-migrated database is adopted, not re-applied", async () => {
    const db = await openDatabase();
    await db
      .prepare(
        `CREATE TABLE "${WRANGLER_LEDGER_TABLE}" (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT)`,
      )
      .run();
    for (const entry of FIXTURE.slice(0, 2)) {
      await db
        .prepare(
          `INSERT INTO "${WRANGLER_LEDGER_TABLE}" (name, applied_at) VALUES (?, 'x')`,
        )
        .bind(entry.name)
        .run();
    }

    const status = await runPendingMigrations(db, { migrations: FIXTURE });
    expect(status.adoptedFrom).toBe("wrangler");
    expect(status.state).toBe("ready");
    expect(await ledgerNames(db)).toEqual([
      "0001_baseline.sql",
      "0002_beta.sql",
      "0003_gamma.sql",
    ]);
    // Only the third migration ran; the adopted two were not re-applied.
    const tables = await tableNames(db);
    expect(tables).toContain("gamma");
    expect(tables).not.toContain("alpha");
  });

  test("a self-host node-platform ledger is adopted", async () => {
    const db = await openDatabase();
    await db
      .prepare(
        `CREATE TABLE "${SELF_HOST_LEDGER_TABLE}" ("name" TEXT NOT NULL PRIMARY KEY, "applied_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      )
      .run();
    for (const entry of FIXTURE) {
      await db
        .prepare(`INSERT INTO "${SELF_HOST_LEDGER_TABLE}" (name) VALUES (?)`)
        .bind(entry.name)
        .run();
    }

    const status = await runPendingMigrations(db, { migrations: FIXTURE });
    expect(status.adoptedFrom).toBe("self-host");
    expect(status.state).toBe("ready");
    expect(await tableNames(db)).not.toContain("alpha");
  });
});

// ---------------------------------------------------------------------------
// Status reads
// ---------------------------------------------------------------------------

describe("readSchemaStatus", () => {
  test("reports pending work on an untouched database", async () => {
    const db = await openDatabase();
    const status = await readSchemaStatus(db, { migrations: FIXTURE });
    expect(status.state).toBe("pending");
    expect(status.applied).toBe(0);
    expect(status.total).toBe(3);
    expect(status.pending).toHaveLength(3);
  });

  test("reports ready once the runner finished", async () => {
    const db = await openDatabase();
    await runPendingMigrations(db, { migrations: FIXTURE });
    const status = await readSchemaStatus(db, { migrations: FIXTURE });
    expect(status.state).toBe("ready");
    expect(status.retryAfterSeconds).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The real embedded set
// ---------------------------------------------------------------------------

describe("the embedded migration set", () => {
  test("is non-empty, ordered, and checksum-tagged", () => {
    expect(EMBEDDED_MIGRATIONS.length).toBeGreaterThan(0);
    const names = EMBEDDED_MIGRATIONS.map((entry) => entry.name);
    expect([...names].sort()).toEqual(names);
    for (const entry of EMBEDDED_MIGRATIONS) {
      expect(entry.name).toMatch(/^\d{4}_[A-Za-z0-9_-]+\.sql$/);
      expect(entry.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(entry.sql.length).toBeGreaterThan(0);
    }
  });

  test("applies end to end against the local shim from an empty database", async () => {
    const db = await openDatabase("real.sqlite");
    const status = await runPendingMigrations(db, { budgetMs: 120_000 });
    expect(status.error).toBeUndefined();
    expect(status.state).toBe("ready");
    expect(status.applied).toBe(EMBEDDED_MIGRATIONS.length);

    const tables = await tableNames(db);
    expect(tables).toContain("accounts");
    expect(tables).toContain(MIGRATION_LEDGER_TABLE);

    // Re-running is a no-op.
    const again = await runPendingMigrations(db);
    expect(again.state).toBe("ready");
    expect(again.applied).toBe(EMBEDDED_MIGRATIONS.length);
  });
});

// ---------------------------------------------------------------------------
// Non-SQLite catalogs
// ---------------------------------------------------------------------------

describe("the legacy-ledger probe on a database without sqlite_master", () => {
  test("falls back to information_schema instead of failing the deployment", async () => {
    // The node self-host profile can be Postgres, where `sqlite_master` does
    // not exist. The probe must not turn that into a failed schema.
    const seen: string[] = [];
    const results = new Map<string, Record<string, unknown>[]>();
    const stub = {
      prepare(query: string) {
        const statement = {
          bind: () => statement,
          async first() {
            seen.push(query);
            if (query.includes("sqlite_master")) {
              throw new Error('relation "sqlite_master" does not exist');
            }
            return (results.get(query) ?? [])[0] ?? null;
          },
          async run() {
            seen.push(query);
            return { results: [], success: true as const, meta: {} };
          },
          async all() {
            seen.push(query);
            return {
              results: results.get(query) ?? [],
              success: true as const,
              meta: {},
            };
          },
          async raw() {
            return [];
          },
        };
        return statement as unknown as ReturnType<
          SqlDatabaseBinding["prepare"]
        >;
      },
      async batch() {
        return [];
      },
      async exec() {
        return { count: 0, duration: 0 };
      },
      withSession() {
        throw new Error("not used");
      },
      async dump() {
        return new ArrayBuffer(0);
      },
    } as unknown as SqlDatabaseBinding;

    const status = await runPendingMigrations(stub, { migrations: [] });
    expect(status.state).toBe("ready");
    expect(seen.some((query) => query.includes("information_schema"))).toBe(
      true,
    );
  });
});
