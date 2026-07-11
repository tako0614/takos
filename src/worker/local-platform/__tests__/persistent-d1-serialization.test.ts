import { test } from "bun:test";
import { assert, assertEquals } from "@takos/test/assert";

import { createSerializationGate } from "../persistent-d1.ts";
import {
  normalizePostgresSql,
  normalizePostgresStatement,
} from "../d1-shared.ts";

test("createSerializationGate serializes acquirers FIFO and excludes until released", async () => {
  const gate = createSerializationGate();
  const order: string[] = [];

  // First acquirer (acts like an open transaction holding the gate).
  const releaseA = await gate.acquire();
  order.push("a-acquired");

  let bAcquired = false;
  const bPromise = (async () => {
    const releaseB = await gate.acquire();
    bAcquired = true;
    order.push("b-acquired");
    releaseB();
  })();

  // While A holds the gate, B must NOT have acquired it. This is the invariant
  // that prevents a concurrent caller's queries from running while another
  // caller's transaction is open.
  await Promise.resolve();
  await Promise.resolve();
  assertEquals(bAcquired, false);

  // Releasing A lets B proceed.
  releaseA();
  await bPromise;
  assert(bAcquired);
  assertEquals(order, ["a-acquired", "b-acquired"]);
});

test("createSerializationGate preserves request order across many waiters", async () => {
  const gate = createSerializationGate();
  const order: number[] = [];
  const tasks: Promise<void>[] = [];

  for (let i = 0; i < 5; i += 1) {
    tasks.push(
      (async () => {
        const release = await gate.acquire();
        order.push(i);
        // Yield to prove the next waiter cannot jump ahead while held.
        await Promise.resolve();
        release();
      })(),
    );
  }

  await Promise.all(tasks);
  assertEquals(order, [0, 1, 2, 3, 4]);
});

test("normalizePostgresSql collapses BEGIN modes only as a whole statement", () => {
  assertEquals(normalizePostgresSql("BEGIN IMMEDIATE"), "BEGIN");
  assertEquals(normalizePostgresSql("BEGIN IMMEDIATE;"), "BEGIN");
  assertEquals(normalizePostgresSql("  begin   exclusive  "), "BEGIN");
});

test("normalizePostgresSql does not mutate BEGIN-mode tokens inside literals or bodies", () => {
  // String literal containing the token sequence must be preserved verbatim.
  const literal = "INSERT INTO t (v) VALUES ('BEGIN IMMEDIATE')";
  assertEquals(normalizePostgresSql(literal), literal);

  // PL/pgSQL dollar-quoted body must be preserved verbatim.
  const body = "DO $$ BEGIN IMMEDIATE END $$";
  assertEquals(normalizePostgresSql(body), body);
});

test("Postgres identity inserts turn Drizzle's literal null id into DEFAULT", () => {
  const normalized = normalizePostgresStatement(
    'insert into "run_events" ("id", "run_id", "type", "data") values (null, ?, ?, ?) returning "id"',
    ["run-1", "started", "{}"],
  );
  assertEquals(
    normalized.query,
    'insert into "run_events" ("id", "run_id", "type", "data") values (DEFAULT, $1, $2, $3) returning "id"',
  );
  assertEquals(normalized.values, ["run-1", "started", "{}"]);
});

test("Postgres identity inserts also normalize a bound null id", () => {
  const normalized = normalizePostgresStatement(
    'insert into "deployment_events" ("id", "deployment_id", "event_type") values (?, ?, ?)',
    [null, "deployment-1", "started"],
  );
  assertEquals(normalized, {
    query:
      'insert into "deployment_events" ("id", "deployment_id", "event_type") values (DEFAULT, $1, $2)',
    values: ["deployment-1", "started"],
  });
});

test("Postgres identity normalization preserves explicit ids and non-identity tables", () => {
  const explicit = normalizePostgresStatement(
    'insert into "run_events" ("id", "run_id") values (?, ?)',
    [42, "run-1"],
  );
  assertEquals(explicit, {
    query: 'insert into "run_events" ("id", "run_id") values ($1, $2)',
    values: [42, "run-1"],
  });

  const ordinary = normalizePostgresStatement(
    'insert into "runs" ("id", "status") values (?, ?)',
    [null, "queued"],
  );
  assertEquals(ordinary, {
    query: 'insert into "runs" ("id", "status") values ($1, $2)',
    values: [null, "queued"],
  });
});
