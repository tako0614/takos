import {
  deepStrictEqual as assertEquals,
  rejects as assertRejects,
} from "node:assert/strict";
import { createLatestRequest } from "../../lib/createLatestRequest.ts";
import { test } from "bun:test";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("createLatestRequest - returns the value of a single in-flight run", async () => {
  const latest = createLatestRequest();
  const value = await latest.run(() => Promise.resolve("a"));
  assertEquals(value, "a");
});

test("createLatestRequest - only the newest run commits its value", async () => {
  const latest = createLatestRequest();
  const first = deferred<string>();
  const second = deferred<string>();

  const firstRun = latest.run(() => first.promise);
  const secondRun = latest.run(() => second.promise);

  // Resolve the stale (first) call AFTER the newer one was started.
  first.resolve("stale");
  second.resolve("fresh");

  assertEquals(await firstRun, undefined);
  assertEquals(await secondRun, "fresh");
});

test("createLatestRequest - out-of-order settlement still keeps the latest", async () => {
  const latest = createLatestRequest();
  const first = deferred<string>();
  const second = deferred<string>();

  const firstRun = latest.run(() => first.promise);
  const secondRun = latest.run(() => second.promise);

  // Newest settles first, then the stale one — stale must still be dropped.
  second.resolve("fresh");
  first.resolve("stale");

  assertEquals(await secondRun, "fresh");
  assertEquals(await firstRun, undefined);
});

test("createLatestRequest - rejection of the latest run is re-thrown", async () => {
  const latest = createLatestRequest();
  await assertRejects(
    () => latest.run(() => Promise.reject(new Error("boom"))),
    /boom/,
  );
});

test("createLatestRequest - rejection of a stale run is swallowed", async () => {
  const latest = createLatestRequest();
  const first = deferred<string>();
  const second = deferred<string>();

  const firstRun = latest.run(() => first.promise);
  const secondRun = latest.run(() => second.promise);

  first.reject(new Error("stale-error"));
  second.resolve("fresh");

  // The stale rejection resolves to undefined rather than throwing.
  assertEquals(await firstRun, undefined);
  assertEquals(await secondRun, "fresh");
});

test("createLatestRequest - isCurrent snapshot guard drops a result", async () => {
  const latest = createLatestRequest();
  let current = "space-a";
  const run = latest.run(
    () => Promise.resolve("data"),
    { isCurrent: () => current === "space-a" },
  );
  // Source changed before the await settles.
  current = "space-b";
  assertEquals(await run, undefined);
});

test("createLatestRequest - isCurrent snapshot guard keeps a fresh result", async () => {
  const latest = createLatestRequest();
  const current = "space-a";
  const run = latest.run(
    () => Promise.resolve("data"),
    { isCurrent: () => current === "space-a" },
  );
  assertEquals(await run, "data");
});

test("createLatestRequest - next() invalidates an in-flight run", async () => {
  const latest = createLatestRequest();
  const pending = deferred<string>();
  const run = latest.run(() => pending.promise);
  // Bump the sequence the way `++requestSeq` used to on source change.
  latest.next();
  pending.resolve("ignored");
  assertEquals(await run, undefined);
});

test("createLatestRequest - claim().won() reflects the most recent claim", () => {
  const latest = createLatestRequest();
  const a = latest.claim();
  assertEquals(a.won(), true);
  const b = latest.claim();
  assertEquals(a.won(), false);
  assertEquals(b.won(), true);
});

test("createLatestRequest - claim().won() honours the source snapshot", () => {
  const latest = createLatestRequest();
  let current = "space-a";
  const token = latest.claim(() => current === "space-a");
  assertEquals(token.won(), true);
  current = "space-b";
  assertEquals(token.won(), false);
});
