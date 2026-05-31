import { assertEquals, assertFalse } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import {
  __remoteToolExecutorHasForTesting,
  __remoteToolExecutorsSizeForTesting,
  __resetRemoteToolExecutorsForTesting,
  __setRemoteToolExecutorForTesting,
  handleToolCatalog,
  handleToolCleanup,
} from "../executor-control-rpc.ts";

/**
 * Builds an Env whose DB layer throws on every operation. This forces
 * `getRunBootstrap` (and therefore `createRemoteToolExecutor`) to reject,
 * exercising the error path inside `getOrCreateRemoteToolExecutor`.
 */
function envWithBrokenDb(): Record<string, unknown> {
  return {
    DB: {
      prepare() {
        throw new Error("db unavailable");
      },
      batch() {
        throw new Error("db unavailable");
      },
      exec() {
        throw new Error("db unavailable");
      },
      dump() {
        throw new Error("db unavailable");
      },
    },
    TAKOS_OFFLOAD: undefined,
  };
}

Deno.test(
  "handleToolCatalog evicts remoteToolExecutors entry when bootstrap fails",
  async () => {
    __resetRemoteToolExecutorsForTesting();
    const runId = `run-broken-${crypto.randomUUID()}`;
    const env = envWithBrokenDb();

    const response = await handleToolCatalog({ runId }, env as never);
    // The error path returns a 4xx/5xx response; the contract is that the
    // cache entry must not leak regardless of status code.
    assertFalse(response.ok, "expected error response from broken DB");
    assertFalse(
      __remoteToolExecutorHasForTesting(runId),
      "executor entry must be evicted on bootstrap failure",
    );
    assertEquals(__remoteToolExecutorsSizeForTesting(), 0);

    __resetRemoteToolExecutorsForTesting();
  },
);

Deno.test(
  "handleToolCatalog evicts entry on repeated bootstrap failure (no replay leak)",
  async () => {
    __resetRemoteToolExecutorsForTesting();
    const runId = `run-broken-${crypto.randomUUID()}`;
    const env = envWithBrokenDb();

    await handleToolCatalog({ runId }, env as never);
    await handleToolCatalog({ runId }, env as never);
    await handleToolCatalog({ runId }, env as never);

    assertEquals(__remoteToolExecutorsSizeForTesting(), 0);
    __resetRemoteToolExecutorsForTesting();
  },
);

Deno.test(
  "remoteToolExecutors TTL safety net reaps stale entries after one hour",
  async () => {
    __resetRemoteToolExecutorsForTesting();
    const time = new FakeTime("2026-01-01T00:00:00Z");
    try {
      const env = envWithBrokenDb();
      const sentinelRunId = `run-stale-${crypto.randomUUID()}`;
      let cleanupCalls = 0;
      __setRemoteToolExecutorForTesting(
        sentinelRunId,
        {
          cleanup() {
            cleanupCalls++;
          },
        } as never,
        Date.now(),
      );
      assertEquals(__remoteToolExecutorsSizeForTesting(), 1);

      // The next catalog request drives the reap loop.
      time.tick(2 * 60 * 60 * 1000); // 2 hours

      const otherRunId = `run-other-${crypto.randomUUID()}`;
      await handleToolCatalog({ runId: otherRunId }, env as never);
      await Promise.resolve();
      assertFalse(__remoteToolExecutorHasForTesting(sentinelRunId));
      assertEquals(
        __remoteToolExecutorsSizeForTesting(),
        0,
        "no leaked entries after TTL window",
      );
      assertEquals(cleanupCalls, 1);
    } finally {
      time.restore();
      __resetRemoteToolExecutorsForTesting();
    }
  },
);

Deno.test(
  "handleToolCleanup is a no-op for unknown runIds and never throws",
  async () => {
    __resetRemoteToolExecutorsForTesting();
    const response = await handleToolCleanup({
      runId: `run-unknown-${crypto.randomUUID()}`,
    });
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body, { success: true });
    __resetRemoteToolExecutorsForTesting();
  },
);
