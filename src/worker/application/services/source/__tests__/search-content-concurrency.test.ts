import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import type { ObjectStoreBinding } from "../../../../shared/types/bindings.ts";
import type { SqlDatabaseLike } from "../../../../infra/db/index.ts";
import { searchContent } from "../search.ts";

/**
 * Guards the bounded-concurrency batching of searchContent. The old loop issued
 * one sequential R2 GET per candidate (up to 100 round-trips end-to-end on a
 * single user-facing request). The batched version must read with bounded
 * concurrency while preserving result order and the `limit` cap.
 */

function fileRow(i: number) {
  return {
    id: `f${i}`,
    accountId: "space_1",
    path: `f${i}.ts`,
    kind: "source",
    mimeType: "text/plain",
    size: 100,
    sha256: null,
    origin: "user",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  };
}

function dbWith(rows: unknown[]): SqlDatabaseLike {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    all: async () => rows,
  };
  return {
    select: () => chain,
    insert: () => ({ values: () => ({ run: async () => ({}) }) }),
    update: () => ({ set: () => ({ where: async () => ({}) }) }),
    delete: () => ({ where: async () => ({}) }),
    prepare: () => ({}),
  } as unknown as SqlDatabaseLike;
}

test("searchContent reads with bounded concurrency, preserving order and limit", async () => {
  const rows = Array.from({ length: 25 }, (_, i) => fileRow(i));

  let active = 0;
  let maxActive = 0;
  const storage = {
    get: async (key: string) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
      const id = key.split("/").pop() ?? "";
      return { text: async () => `hello match in ${id}` };
    },
  } as unknown as ObjectStoreBinding;

  const results = await searchContent(
    dbWith(rows),
    storage,
    "space_1",
    "match",
    undefined,
    20,
  );

  // limit respected, order preserved (updatedAt-desc order = insertion order).
  assertEquals(results.length, 20);
  assertEquals(results[0].file.id, "f0");
  assertEquals(results[19].file.id, "f19");
  // Parallelised (old code was strictly sequential => maxActive 1) but capped.
  assertEquals(maxActive > 1, true);
  assertEquals(maxActive <= 10, true);
});
