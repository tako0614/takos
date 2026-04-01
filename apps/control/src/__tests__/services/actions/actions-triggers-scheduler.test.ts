import { assertEquals } from "jsr:@std/assert";

import { scheduleActionsAutoTrigger } from "../../../../../../packages/control/src/application/services/actions/actions-triggers.ts";

Deno.test("scheduleActionsAutoTrigger delegates to waitUntil when execution context is available", async () => {
  const waits: Promise<unknown>[] = [];
  let executed = false;

  scheduleActionsAutoTrigger(
    {
      waitUntil(promise) {
        waits.push(promise);
      },
    },
    async () => {
      executed = true;
    },
    "test-source",
  );

  assertEquals(waits.length, 1);
  await waits[0];
  assertEquals(executed, true);
});

Deno.test("scheduleActionsAutoTrigger still runs tasks without waitUntil", async () => {
  let executed = false;

  scheduleActionsAutoTrigger(
    undefined,
    async () => {
      executed = true;
    },
    "test-source",
  );

  await Promise.resolve();
  assertEquals(executed, true);
});
