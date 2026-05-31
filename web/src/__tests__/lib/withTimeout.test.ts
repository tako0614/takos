import { deepStrictEqual as assertEquals, rejects as assertRejects } from "node:assert/strict";
import { TimeoutError, withTimeout } from "../../lib/withTimeout.ts";
import { test } from "bun:test";


test("withTimeout - resolves when the promise settles in time", async () => {
  const result = await withTimeout(Promise.resolve("ok"), 1000, "Timed out");
  assertEquals(result, "ok");
});

test("withTimeout - rejects with TimeoutError after the deadline", async () => {
  const pending = new Promise<string>(() => {});

  await assertRejects(
    () => withTimeout(pending, 10, "Timed out"),
    TimeoutError,
    "Timed out",
  );
});

test("withTimeout - aborts factory requests on timeout", async () => {
  let aborted = false;

  await assertRejects(
    () =>
      withTimeout(
        (signal) => {
          signal.addEventListener("abort", () => {
            aborted = true;
          }, { once: true });
          return new Promise<string>(() => {});
        },
        10,
        "Timed out",
      ),
    TimeoutError,
    "Timed out",
  );
  assertEquals(aborted, true);
});
