import { test } from "bun:test";
import { assertEquals } from "../../../testing/assert.ts";
import { spy } from "../../../testing/mock.ts";

import deploymentRunner from "../deployment-runner.ts";
import type { MessageQueueBatch } from "../../../shared/types/bindings.ts";

test("retired deployment queue messages are acknowledged without touching lifecycle state", async () => {
  const ack = spy(() => {});
  const retry = spy(() => {});
  const batch = {
    queue: "takos-deployment-jobs",
    messages: [{
      id: "message-1",
      timestamp: new Date("2026-07-28T00:00:00.000Z"),
      attempts: 1,
      body: {
        version: 1,
        type: "deployment",
        deploymentId: "legacy-deployment-1",
        timestamp: 1,
      },
      ack,
      retry,
    }],
  } satisfies MessageQueueBatch<unknown>;

  await deploymentRunner.queue(batch);

  assertEquals(ack.calls.length, 1);
  assertEquals(retry.calls.length, 0);
});
