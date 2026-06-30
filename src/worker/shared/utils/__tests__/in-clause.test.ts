import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import {
  chunkForInClause,
  IN_CLAUSE_CHUNK_SIZE,
  selectInChunks,
} from "../in-clause.ts";

/**
 * Guards the D1 100-bound-parameter cap that getThreadHistory (and any other
 * inArray over a user-growable id set) must respect. drizzle does not chunk
 * inArray and the libsql test stack does not enforce the cap, so this verifies
 * the chunk boundary directly and via a harness that mimics D1's rejection.
 */

test("chunkForInClause keeps every batch within the D1 cap", () => {
  const ids = Array.from({ length: 250 }, (_, i) => `run_${i}`);
  const chunks = chunkForInClause(ids);
  assertEquals(chunks.length, 3); // 90 + 90 + 70
  for (const chunk of chunks) {
    assertEquals(chunk.length <= IN_CLAUSE_CHUNK_SIZE, true);
  }
  // No id is dropped or duplicated.
  assertEquals(chunks.flat(), ids);
});

test("chunkForInClause returns [] for an empty input", () => {
  assertEquals(chunkForInClause([]), []);
});

test("selectInChunks survives a D1-style >100-param cap and merges rows", async () => {
  const ids = Array.from({ length: 201 }, (_, i) => i);
  const rows = await selectInChunks(ids, async (chunk) => {
    // Mimic D1: throw if a single query binds more than 100 parameters.
    if (chunk.length > 100) {
      throw new Error("D1_ERROR: too many SQL variables");
    }
    return chunk.map((id) => ({ id }));
  });
  assertEquals(rows.length, 201);
  assertEquals(rows.map((r) => r.id), ids);
});

test("selectInChunks issues no query for an empty id set", async () => {
  let calls = 0;
  const rows = await selectInChunks([], async (chunk) => {
    calls++;
    return chunk;
  });
  assertEquals(rows, []);
  assertEquals(calls, 0);
});
