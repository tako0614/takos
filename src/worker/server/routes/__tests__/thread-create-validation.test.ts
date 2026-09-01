import { expect, test } from "bun:test";
import { threadCreateSchema } from "../threads/space.ts";
import { threadUpdateSchema } from "../threads/thread.ts";
import { MAX_CLIENT_THREAD_TITLE_CHARACTERS } from "../../../shared/utils/client-thread.ts";

test("public thread creation is strict, bounded, and replayable", () => {
  expect(threadCreateSchema.safeParse({
    title: "New conversation",
    locale: "ja",
    idempotency_key: "ab".repeat(16),
  }).success).toBe(true);
  expect(threadCreateSchema.safeParse({
    title: "x".repeat(MAX_CLIENT_THREAD_TITLE_CHARACTERS + 1),
  }).success).toBe(false);
  expect(threadCreateSchema.safeParse({ idempotency_key: "predictable" }).success)
    .toBe(false);
  expect(threadCreateSchema.safeParse({ trusted: true }).success).toBe(false);
});

test("public Thread updates are strict, bounded, and normalized", () => {
  expect(threadUpdateSchema.parse({ title: "  Renamed  " })).toEqual({
    title: "Renamed",
  });
  expect(threadUpdateSchema.safeParse({
    title: "x".repeat(MAX_CLIENT_THREAD_TITLE_CHARACTERS + 1),
  }).success).toBe(false);
  expect(threadUpdateSchema.safeParse({ context_window: 19 }).success).toBe(
    false,
  );
  expect(threadUpdateSchema.safeParse({ status: "deleted" }).success).toBe(
    false,
  );
  expect(threadUpdateSchema.safeParse({ unknown: true }).success).toBe(false);
});
