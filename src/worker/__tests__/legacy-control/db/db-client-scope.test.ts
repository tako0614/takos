import type { SqlDatabaseBinding } from "@/shared/types/bindings.ts";

import { assertEquals, assertNotEquals } from "@std/assert";

import { getDb } from "@/infra/db/client.ts";
import { asTestSqlDatabaseBinding } from "@test/db-stubs";

function createDbBinding(label: string): SqlDatabaseBinding {
  return asTestSqlDatabaseBinding({ label });
}

Deno.test("getDb caches the client for the same SQL database binding", () => {
  const db = createDbBinding("same-binding");

  const first = getDb(db);
  const second = getDb(db);

  assertEquals(first, second);
});

Deno.test("getDb creates distinct clients for different SQL database bindings", () => {
  const firstDb = createDbBinding("first-binding");
  const secondDb = createDbBinding("second-binding");

  const first = getDb(firstDb);
  const second = getDb(secondDb);

  assertNotEquals(first, second);
});
