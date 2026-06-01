import { deleteEnv, envObject, getEnv, setEnv } from "@takos/worker-platform-utils/runtime-env";
import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";

import {
  resolveWorkerHeartbeatTtlMs,
  runLocalWorkerIteration,
} from "../worker.ts";

test("resolveWorkerHeartbeatTtlMs uses the default when the env var is missing", () => {
  const previous = getEnv("TAKOS_LOCAL_WORKER_HEARTBEAT_TTL_MS");
  deleteEnv("TAKOS_LOCAL_WORKER_HEARTBEAT_TTL_MS");

  try {
    assertEquals(resolveWorkerHeartbeatTtlMs(), 120_000);
  } finally {
    if (previous === undefined) {
      deleteEnv("TAKOS_LOCAL_WORKER_HEARTBEAT_TTL_MS");
    } else {
      setEnv("TAKOS_LOCAL_WORKER_HEARTBEAT_TTL_MS", previous);
    }
  }
});

test("resolveWorkerHeartbeatTtlMs honors a positive integer env override", () => {
  const previous = getEnv("TAKOS_LOCAL_WORKER_HEARTBEAT_TTL_MS");
  setEnv("TAKOS_LOCAL_WORKER_HEARTBEAT_TTL_MS", "300000");

  try {
    assertEquals(resolveWorkerHeartbeatTtlMs(), 300_000);
  } finally {
    if (previous === undefined) {
      deleteEnv("TAKOS_LOCAL_WORKER_HEARTBEAT_TTL_MS");
    } else {
      setEnv("TAKOS_LOCAL_WORKER_HEARTBEAT_TTL_MS", previous);
    }
  }
});

test("runLocalWorkerIteration returns false when every message queue is empty", async () => {
  const queue = {
    queueName: "takos-runs",
    async receive() {
      return null;
    },
  };

  const worked = await runLocalWorkerIteration({} as never, [queue as never]);

  assertEquals(worked, false);
});
