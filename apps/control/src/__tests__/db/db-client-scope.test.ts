import type { D1Database } from "@cloudflare/workers-types";

import { assertEquals, assertNotEquals } from "jsr:@std/assert";

import { getDb } from "@/infra/db/client.ts";

function createDbBinding(label: string): D1Database {
  return { label } as unknown as D1Database;
}

Deno.test("getDb caches the client for the same D1 binding", () => {
  const db = createDbBinding("same-binding");

  const first = getDb(db);
  const second = getDb(db);

  assertEquals(first, second);
});

Deno.test("getDb creates distinct clients for different D1 bindings", () => {
  const firstDb = createDbBinding("first-binding");
  const secondDb = createDbBinding("second-binding");

  const first = getDb(firstDb);
  const second = getDb(secondDb);

  assertNotEquals(first, second);
});
