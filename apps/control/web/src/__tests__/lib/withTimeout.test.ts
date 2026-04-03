import { assertEquals, assertRejects } from "jsr:@std/assert";
import { FakeTime } from "jsr:@std/testing/time";
import { TimeoutError, withTimeout } from "../../lib/withTimeout.ts";

Deno.test("withTimeout - resolves when the promise settles in time", async () => {
  const result = await withTimeout(Promise.resolve("ok"), 1000, "Timed out");
  assertEquals(result, "ok");
});

Deno.test("withTimeout - rejects with TimeoutError after the deadline", async () => {
  const fakeTime = new FakeTime();
  const pending = new Promise<string>(() => {});

  const promise = withTimeout(pending, 100, "Timed out");
  fakeTime.tick(150);

  await assertRejects(
    async () => await promise,
    TimeoutError,
    "Timed out",
  );
  fakeTime.restore();
});

Deno.test("withTimeout - aborts factory requests on timeout", async () => {
  const fakeTime = new FakeTime();
  let aborted = false;

  const promise = withTimeout(
    (signal) => {
      signal.addEventListener("abort", () => {
        aborted = true;
      }, { once: true });
      return new Promise<string>(() => {});
    },
    100,
    "Timed out",
  );

  fakeTime.tick(150);

  await assertRejects(
    async () => await promise,
    TimeoutError,
    "Timed out",
  );
  assertEquals(aborted, true);
  fakeTime.restore();
});
