import { assertEquals } from "jsr:@std/assert";

import {
  resolveWorkerHeartbeatTtlMs,
  runLocalWorkerIteration,
} from "../worker.ts";

Deno.test("resolveWorkerHeartbeatTtlMs uses the default when the env var is missing", () => {
  const previous = Deno.env.get("TAKOS_LOCAL_WORKER_HEARTBEAT_TTL_MS");
  Deno.env.delete("TAKOS_LOCAL_WORKER_HEARTBEAT_TTL_MS");

  try {
    assertEquals(resolveWorkerHeartbeatTtlMs(), 120_000);
  } finally {
    if (previous === undefined) {
      Deno.env.delete("TAKOS_LOCAL_WORKER_HEARTBEAT_TTL_MS");
    } else {
      Deno.env.set("TAKOS_LOCAL_WORKER_HEARTBEAT_TTL_MS", previous);
    }
  }
});

Deno.test("resolveWorkerHeartbeatTtlMs honors a positive integer env override", () => {
  const previous = Deno.env.get("TAKOS_LOCAL_WORKER_HEARTBEAT_TTL_MS");
  Deno.env.set("TAKOS_LOCAL_WORKER_HEARTBEAT_TTL_MS", "300000");

  try {
    assertEquals(resolveWorkerHeartbeatTtlMs(), 300_000);
  } finally {
    if (previous === undefined) {
      Deno.env.delete("TAKOS_LOCAL_WORKER_HEARTBEAT_TTL_MS");
    } else {
      Deno.env.set("TAKOS_LOCAL_WORKER_HEARTBEAT_TTL_MS", previous);
    }
  }
});

Deno.test("runLocalWorkerIteration returns false when every queue is empty", async () => {
  const queue = {
    queueName: "takos-runs",
    async receive() {
      return null;
    },
  };

  const worked = await runLocalWorkerIteration({} as never, [queue as never]);

  assertEquals(worked, false);
});
