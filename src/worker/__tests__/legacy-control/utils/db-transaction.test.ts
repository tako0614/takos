import {
  D1TransactionManager,
  TransactionUnsupportedError,
} from "@/utils/db-transaction";
import { asTestSqlDatabaseBinding } from "@test/db-stubs";
import type { SqlPreparedStatementBinding } from "../../../shared/types/bindings.ts";

import { assert, assertEquals, assertRejects } from "@std/assert";

function createMockDb() {
  const executedStatements: string[] = [];
  const db = asTestSqlDatabaseBinding({
    batch: (stmts: SqlPreparedStatementBinding[]) =>
      Promise.all(stmts.map((s) => s.run())),
    prepare: (sql: string) => ({
      run: async () => {
        executedStatements.push(sql);
        return {
          success: true,
          meta: { changes: 0, last_row_id: 0, duration: 0 },
        };
      },
    }),
  });
  return { db, executed: executedStatements };
}

Deno.test("SQL transaction manager - wraps callback in BEGIN IMMEDIATE / COMMIT", async () => {
  const { db, executed } = createMockDb();
  const txn = new D1TransactionManager(db);

  const result = await txn.runInTransaction(async () => "hello");

  assertEquals(result, "hello");
  assert(executed.some((stmt) => stmt.includes("BEGIN IMMEDIATE")));
  assert(executed.some((stmt) => stmt.includes("COMMIT")));
});
Deno.test("SQL transaction manager - rolls back on callback error", async () => {
  const { db, executed } = createMockDb();
  const txn = new D1TransactionManager(db);

  await assertRejects(async () => {
    await txn.runInTransaction(async () => {
      throw new Error("callback failed");
    });
  }, "callback failed");

  assert(executed.some((stmt) => stmt.includes("BEGIN IMMEDIATE")));
  assert(executed.some((stmt) => stmt.includes("ROLLBACK")));
  assert(!executed.includes("COMMIT"));
});
Deno.test("SQL transaction manager - uses savepoints for nested transactions", async () => {
  const { db, executed } = createMockDb();
  const txn = new D1TransactionManager(db);

  await txn.runInTransaction(async () => {
    await txn.runInTransaction(async () => "inner");
    return "outer";
  });

  assert(executed.some((stmt) => stmt.includes("BEGIN IMMEDIATE")));
  assertEquals(executed.some((s) => s.startsWith("SAVEPOINT")), true);
  assertEquals(
    executed.some((s) => s.startsWith("RELEASE SAVEPOINT")),
    true,
  );
  assert(executed.some((stmt) => stmt.includes("COMMIT")));
});
Deno.test("SQL transaction manager - rolls back savepoint on inner failure without aborting outer", async () => {
  const { db, executed } = createMockDb();
  const txn = new D1TransactionManager(db);

  const result = await txn.runInTransaction(async () => {
    try {
      await txn.runInTransaction(async () => {
        throw new Error("inner failed");
      });
    } catch {
      // swallow inner error
    }
    return "outer ok";
  });

  assertEquals(result, "outer ok");
  assert(executed.some((stmt) => stmt.includes("COMMIT")));
  assertEquals(
    executed.some((s) => s.startsWith("ROLLBACK TO SAVEPOINT")),
    true,
  );
});
Deno.test("SQL transaction manager - resets depth after transaction completes", async () => {
  const { db, executed } = createMockDb();
  const txn = new D1TransactionManager(db);

  await txn.runInTransaction(async () => "first");
  await txn.runInTransaction(async () => "second");

  // Both should use BEGIN IMMEDIATE (not savepoints)
  const begins = executed.filter((s) => s === "BEGIN IMMEDIATE");
  assertEquals(begins.length, 2);
});
Deno.test("SQL transaction manager - resets depth after failed transaction", async () => {
  const { db, executed } = createMockDb();
  const txn = new D1TransactionManager(db);

  await assertRejects(async () => {
    await txn.runInTransaction(async () => {
      throw new Error("fail");
    });
  });

  // Second transaction should still use BEGIN IMMEDIATE
  await txn.runInTransaction(async () => "ok");
  const begins = executed.filter((s) => s === "BEGIN IMMEDIATE");
  assertEquals(begins.length, 2);
});
Deno.test("SQL transaction manager - mode 'd1' throws transaction_unsupported without issuing BEGIN", async () => {
  const { db, executed } = createMockDb();
  const txn = new D1TransactionManager(db, { mode: "d1" });

  let callbackInvoked = false;
  const error = await assertRejects(
    () =>
      txn.runInTransaction(async () => {
        callbackInvoked = true;
        return "should not run";
      }),
    TransactionUnsupportedError,
  );
  assertEquals(error.code, "transaction_unsupported");
  assertEquals(callbackInvoked, false);
  assertEquals(executed.length, 0);
});
Deno.test("SQL transaction manager - mode 'd1-compensated' runs the callback directly with no BEGIN/COMMIT", async () => {
  const { db, executed } = createMockDb();
  const txn = new D1TransactionManager(db, { mode: "d1-compensated" });

  let callbackInvoked = false;
  const result = await txn.runInTransaction(async () => {
    callbackInvoked = true;
    return "ran";
  });

  // The callback runs (no false atomicity claim), but no BEGIN/COMMIT/SAVEPOINT
  // statements are issued: consistency is the caller's via compensation.
  assertEquals(result, "ran");
  assertEquals(callbackInvoked, true);
  assertEquals(executed.length, 0);
});
