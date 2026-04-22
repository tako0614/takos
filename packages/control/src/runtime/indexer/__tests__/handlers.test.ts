import { assertEquals, assertRejects } from "jsr:@std/assert";

import { handleIndexJobDlq } from "../handlers.ts";

function makeDb(insertRun: (row: Record<string, unknown>) => Promise<void>) {
  return {
    select: () => ({}),
    update: () => ({}),
    delete: () => ({}),
    insert: () => ({
      values: (row: Record<string, unknown>) => ({
        run: () => insertRun(row),
      }),
    }),
  };
}

Deno.test("handleIndexJobDlq persists the actual queue name", async () => {
  const persisted: Record<string, unknown>[] = [];
  await handleIndexJobDlq(
    { jobId: "job_1" },
    {
      DB: makeDb(async (row) => {
        persisted.push(row);
      }),
    } as never,
    3,
    "takos-private-index-jobs-dlq-staging",
  );

  const row = persisted[0];
  if (!row) throw new Error("expected DLQ row to be persisted");
  assertEquals(row.queue, "takos-private-index-jobs-dlq-staging");
  assertEquals(row.retryCount, 3);
});

Deno.test("handleIndexJobDlq retries through caller when persistence fails", async () => {
  await assertRejects(
    () =>
      handleIndexJobDlq(
        { jobId: "job_1" },
        {
          DB: makeDb(async () => {
            throw new Error("db unavailable");
          }),
        } as never,
        2,
      ),
    Error,
    "db unavailable",
  );
});
