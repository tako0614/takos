import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSqliteSqlDatabase } from "../../../local-platform/persistent-d1.ts";
import type { ServerSqlDatabase } from "../../../local-platform/persistent-d1.ts";
import type { EmbeddedMigration } from "../migration-set.ts";
import {
  SCHEMA_FAILED_ERROR_CODE,
  SCHEMA_GATE_EXEMPT_PATHS,
  SCHEMA_PENDING_ERROR_CODE,
  ensureSchemaReady,
  guardRequestSchema,
  isSchemaGateExemptPath,
  resetSchemaGate,
  schemaUnavailableResponse,
} from "../schema-gate.ts";

let directory: string;
let databases: ServerSqlDatabase[] = [];

async function openDatabase(): Promise<ServerSqlDatabase> {
  const db = await openSqliteSqlDatabase(join(directory, "control.sqlite"));
  databases.push(db);
  return db;
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "takos-schema-gate-"));
  databases = [];
});

afterEach(async () => {
  for (const db of databases) {
    resetSchemaGate(db);
    try {
      db.close();
    } catch {
      // Already closed by the test.
    }
  }
  await rm(directory, { force: true, recursive: true });
});

function migration(name: string, sql: string): EmbeddedMigration {
  return {
    name,
    sha256: `sha256:${createHash("sha256").update(sql, "utf8").digest("hex")}`,
    sql,
  };
}

const FIXTURE: EmbeddedMigration[] = [
  migration(
    "0001_baseline.sql",
    'CREATE TABLE IF NOT EXISTS "alpha" ("id" TEXT PRIMARY KEY NOT NULL);',
  ),
];

const BROKEN: EmbeddedMigration[] = [migration("0001_baseline.sql", "NOT SQL;")];

describe("exempt paths", () => {
  test("cover liveness and the two operator endpoints", () => {
    expect([...SCHEMA_GATE_EXEMPT_PATHS]).toEqual([
      "/health",
      "/internal/runtime/status",
      "/internal/runtime/migrate",
    ]);
    expect(isSchemaGateExemptPath("/health")).toBe(true);
    expect(isSchemaGateExemptPath("/api/spaces")).toBe(false);
  });
});

describe("guardRequestSchema", () => {
  test("lets a request through once the schema converged", async () => {
    const db = await openDatabase();
    const blocked = await guardRequestSchema(db, "/api/spaces", {
      migrations: FIXTURE,
    });
    expect(blocked).toBe(null);
  });

  test("never blocks an exempt path, even before migration ran", async () => {
    const db = await openDatabase();
    expect(
      await guardRequestSchema(db, "/internal/runtime/status", {
        migrations: BROKEN,
      }),
    ).toBe(null);
  });

  test("answers 503 with a stable code and a retry hint while pending", async () => {
    const response = schemaUnavailableResponse({
      state: "pending",
      total: 3,
      applied: 1,
      pending: ["0002_beta.sql"],
      ledgerTable: "_takos_opentofu_migrations",
      retryAfterSeconds: 5,
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("5");
    const body = (await response.json()) as {
      error: { code: string; details: { applied: number; total: number } };
    };
    expect(body.error.code).toBe(SCHEMA_PENDING_ERROR_CODE);
    expect(body.error.details.applied).toBe(1);
    expect(body.error.details.total).toBe(3);
  });

  test("answers 503 without a retry hint after a failure", async () => {
    const db = await openDatabase();
    const blocked = await guardRequestSchema(db, "/api/spaces", {
      migrations: BROKEN,
    });
    expect(blocked).not.toBe(null);
    expect(blocked?.status).toBe(503);
    expect(blocked?.headers.get("Retry-After")).toBe(null);
    const body = (await blocked!.json()) as {
      error: { code: string; details: { failedMigration?: string } };
    };
    expect(body.error.code).toBe(SCHEMA_FAILED_ERROR_CODE);
    expect(body.error.details.failedMigration).toBe("0001_baseline.sql");
  });
});

describe("ensureSchemaReady", () => {
  test("memoizes a ready schema so later calls do no work", async () => {
    const db = await openDatabase();
    const first = await ensureSchemaReady(db, { migrations: FIXTURE });
    expect(first.state).toBe("ready");

    // A second call with a *different* set would find pending work if it
    // actually ran; the memoized ready answer proves it did not.
    const second = await ensureSchemaReady(db, {
      migrations: [...FIXTURE, migration("0002_beta.sql", "SELECT 1;")],
    });
    expect(second.state).toBe("ready");
    expect(second.total).toBe(1);
  });

  test("resetting the gate makes the next call read the database again", async () => {
    const db = await openDatabase();
    await ensureSchemaReady(db, { migrations: FIXTURE });
    resetSchemaGate(db);

    const after = await ensureSchemaReady(db, {
      migrations: [
        ...FIXTURE,
        migration(
          "0002_beta.sql",
          'CREATE TABLE IF NOT EXISTS "beta" ("id" TEXT);',
        ),
      ],
    });
    expect(after.state).toBe("ready");
    expect(after.total).toBe(2);
    expect(after.applied).toBe(2);
  });

  test("a burst of concurrent first requests drives one migration", async () => {
    const db = await openDatabase();
    const statuses = await Promise.all([
      ensureSchemaReady(db, { migrations: FIXTURE }),
      ensureSchemaReady(db, { migrations: FIXTURE }),
      ensureSchemaReady(db, { migrations: FIXTURE }),
    ]);
    // All three share the single in-flight run, so they see the same object.
    expect(statuses[1]).toBe(statuses[0]);
    expect(statuses[2]).toBe(statuses[0]);
    expect(statuses[0].state).toBe("ready");
  });

  test("does not cache a failure, so a repaired database recovers", async () => {
    const db = await openDatabase();
    const failed = await ensureSchemaReady(db, { migrations: BROKEN });
    expect(failed.state).toBe("failed");

    const repaired = await ensureSchemaReady(db, {
      migrations: FIXTURE,
      retryFailed: true,
    });
    expect(repaired.state).toBe("ready");
  });
});
