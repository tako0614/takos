import { expect, test } from "bun:test";
import type { ScheduledEvent } from "../../../shared/types/bindings.ts";
import {
  runWorkerRuntimeScheduled,
  type WorkerRuntimeScheduledDeps,
} from "../runtime-factory.ts";
import type { WorkerEnv } from "../env.ts";

test("worker scheduled handler invokes stale-run recovery and executor warm pool", async () => {
  const calls: string[] = [];
  const event = {
    cron: "3,18,33,48 * * * *",
    scheduledTime: Date.now(),
    waitUntil() {},
  } satisfies ScheduledEvent;
  const env = {} as WorkerEnv;
  const deps: WorkerRuntimeScheduledDeps = {
    async loadRunner() {
      return {
        async scheduled(receivedEvent, receivedEnv) {
          expect(receivedEvent).toBe(event);
          expect(receivedEnv).toBe(env);
          calls.push("runner");
        },
      };
    },
    async loadExecutorHost() {
      return {
        async scheduled(receivedEvent, receivedEnv) {
          expect(receivedEvent).toBe(event);
          expect(receivedEnv).toBe(env);
          calls.push("executor-warm-pool");
        },
      };
    },
  };

  await runWorkerRuntimeScheduled(event, env, deps);

  expect(calls.sort()).toEqual(["executor-warm-pool", "runner"]);
});

test("worker scheduled handler starts both responsibilities before surfacing failure", async () => {
  const calls: string[] = [];
  const event = {
    cron: "5 * * * *",
    scheduledTime: Date.now(),
    waitUntil() {},
  } satisfies ScheduledEvent;
  const env = {} as WorkerEnv;

  await expect(
    runWorkerRuntimeScheduled(event, env, {
      async loadRunner() {
        return {
          async scheduled() {
            calls.push("runner");
            throw new Error("runner failed");
          },
        };
      },
      async loadExecutorHost() {
        return {
          async scheduled() {
            calls.push("executor-warm-pool");
          },
        };
      },
    }),
  ).rejects.toThrow("runner failed");

  expect(calls.sort()).toEqual(["executor-warm-pool", "runner"]);
});
