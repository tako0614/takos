import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import {
  generateOperationKey,
  STALE_PENDING_THRESHOLD_MS,
} from "../idempotency.ts";

test("side-effect operation identity is run-scoped and argument-order stable", async () => {
  const first = await generateOperationKey("run-1", "write", {
    path: "a",
    options: { mode: "safe", force: false },
  });
  const reordered = await generateOperationKey("run-1", "write", {
    options: { force: false, mode: "safe" },
    path: "a",
  });
  assertEquals(first, reordered);
  assertEquals(
    first ===
      (await generateOperationKey("run-2", "write", {
        path: "a",
        options: { mode: "safe", force: false },
      })),
    false,
  );
});

test("pending side effects outlive the tool transport and lease grace", () => {
  assertEquals(STALE_PENDING_THRESHOLD_MS, 30 * 60 * 1000);
  assertEquals(STALE_PENDING_THRESHOLD_MS > 5 * 60 * 1000, true);
});
