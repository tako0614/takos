import { expect, test } from "bun:test";
import {
  isValidRunQueueMessage,
  RUN_QUEUE_MESSAGE_VERSION,
} from "../../../shared/types/index.ts";
import { DEFAULT_EXECUTOR_LOGICAL_RUN_CAPACITY } from "../../container-hosts/executor-capacity.ts";
import {
  CLOUDFLARE_QUEUE_MAX_CONCURRENCY,
  DLQ_TERMINALIZABLE_RUN_STATUSES,
  nextRunQueueBackpressureCount,
  RUN_QUEUE_MAX_CONCURRENCY,
  runQueueBackpressureDelaySeconds,
  runQueueRetryDelaySeconds,
} from "../run-queue-policy.ts";

test("a lease-less DLQ delivery cannot terminalize a running owner", () => {
  expect(DLQ_TERMINALIZABLE_RUN_STATUSES).toEqual(["pending", "queued"]);
  expect(DLQ_TERMINALIZABLE_RUN_STATUSES).not.toContain("running");
});

test("run queue concurrency follows executor capacity and the platform limit", () => {
  expect(DEFAULT_EXECUTOR_LOGICAL_RUN_CAPACITY).toBe(5);
  expect(RUN_QUEUE_MAX_CONCURRENCY).toBe(
    Math.min(
      DEFAULT_EXECUTOR_LOGICAL_RUN_CAPACITY,
      CLOUDFLARE_QUEUE_MAX_CONCURRENCY,
    ),
  );
  expect(RUN_QUEUE_MAX_CONCURRENCY).toBe(5);
});

test("run queue retry delay uses bounded exponential backoff", () => {
  expect(runQueueRetryDelaySeconds(1)).toBe(5);
  expect(runQueueRetryDelaySeconds(2)).toBe(10);
  expect(runQueueRetryDelaySeconds(3)).toBe(20);
  expect(runQueueRetryDelaySeconds(7)).toBe(300);
  expect(runQueueRetryDelaySeconds(100)).toBe(300);
  expect(runQueueRetryDelaySeconds(Number.NaN)).toBe(5);
});

test("executor backpressure requeue delay is bounded without a terminal count", () => {
  expect(nextRunQueueBackpressureCount(undefined)).toBe(1);
  expect(nextRunQueueBackpressureCount(0)).toBe(1);
  expect(nextRunQueueBackpressureCount(7)).toBe(8);
  expect(nextRunQueueBackpressureCount(Number.MAX_SAFE_INTEGER)).toBe(
    Number.MAX_SAFE_INTEGER,
  );
  expect(runQueueBackpressureDelaySeconds(1)).toBe(5);
  expect(runQueueBackpressureDelaySeconds(2)).toBe(10);
  expect(runQueueBackpressureDelaySeconds(3)).toBe(20);
  expect(runQueueBackpressureDelaySeconds(7)).toBe(300);
  expect(runQueueBackpressureDelaySeconds(Number.MAX_SAFE_INTEGER)).toBe(300);
});

test("run queue messages accept only safe non-negative backpressure counters", () => {
  const message = {
    version: RUN_QUEUE_MESSAGE_VERSION,
    runId: "run_backpressure_guard",
    timestamp: Date.now(),
  };
  expect(isValidRunQueueMessage(message)).toBe(true);
  expect(isValidRunQueueMessage({ ...message, backpressureCount: 12 })).toBe(
    true,
  );
  expect(isValidRunQueueMessage({ ...message, backpressureCount: -1 })).toBe(
    false,
  );
  expect(isValidRunQueueMessage({ ...message, backpressureCount: 1.5 })).toBe(
    false,
  );
  expect(
    isValidRunQueueMessage({
      ...message,
      backpressureCount: Number.MAX_SAFE_INTEGER + 1,
    }),
  ).toBe(false);
});
