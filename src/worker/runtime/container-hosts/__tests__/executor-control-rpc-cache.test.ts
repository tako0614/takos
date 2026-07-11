import { jest, test } from "bun:test";
import { assertEquals, assertFalse } from "@takos/test/assert";
import {
  __remoteToolExecutorAbortSignalForTesting,
  __remoteToolExecutorHasForTesting,
  __remoteToolExecutorsSizeForTesting,
  __resetRemoteToolExecutorsForTesting,
  __setRemoteToolExecutorForTesting,
  abortRemoteToolExecutorsForLease,
  abortRemoteToolExecutorsForRun,
  abortSupersededRemoteToolExecutors,
  handleToolCatalog,
  handleToolCleanup,
  handleToolExecute,
} from "../executor-control-rpc.ts";

function useFakeTime(now: string | number | Date) {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(now));
  return {
    tick(ms: number) {
      jest.advanceTimersByTime(ms);
    },
    restore() {
      jest.useRealTimers();
    },
  };
}

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

test("handleToolCatalog evicts remoteToolExecutors entry when bootstrap fails", async () => {
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
});

test("handleToolCatalog evicts entry on repeated bootstrap failure (no replay leak)", async () => {
  __resetRemoteToolExecutorsForTesting();
  const runId = `run-broken-${crypto.randomUUID()}`;
  const env = envWithBrokenDb();

  await handleToolCatalog({ runId }, env as never);
  await handleToolCatalog({ runId }, env as never);
  await handleToolCatalog({ runId }, env as never);

  assertEquals(__remoteToolExecutorsSizeForTesting(), 0);
  __resetRemoteToolExecutorsForTesting();
});

test("remoteToolExecutors TTL safety net reaps stale entries after one hour", async () => {
  __resetRemoteToolExecutorsForTesting();
  const time = useFakeTime("2026-01-01T00:00:00Z");
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
});

test("handleToolCleanup is a no-op for unknown runIds and never throws", async () => {
  __resetRemoteToolExecutorsForTesting();
  const response = await handleToolCleanup({
    runId: `run-unknown-${crypto.randomUUID()}`,
  });
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body, { success: true });
  __resetRemoteToolExecutorsForTesting();
});

test("old lease cleanup cannot remove the replacement lease executor", async () => {
  __resetRemoteToolExecutorsForTesting();
  const runId = `run-replaced-${crypto.randomUUID()}`;
  const oldLease = {
    runId,
    serviceId: "service-old",
    leaseVersion: 7,
  };
  const newLease = {
    runId,
    serviceId: "service-new",
    leaseVersion: 8,
  };
  let oldCleanupCalls = 0;
  let newCleanupCalls = 0;
  __setRemoteToolExecutorForTesting(
    oldLease,
    { cleanup: () => void oldCleanupCalls++ } as never,
    Date.now(),
  );
  __setRemoteToolExecutorForTesting(
    newLease,
    { cleanup: () => void newCleanupCalls++ } as never,
    Date.now(),
  );

  const oldResponse = await handleToolCleanup(oldLease);
  assertEquals(oldResponse.status, 200);
  assertFalse(__remoteToolExecutorHasForTesting(oldLease));
  assertEquals(__remoteToolExecutorHasForTesting(newLease), true);
  assertEquals(__remoteToolExecutorsSizeForTesting(), 1);
  assertEquals(oldCleanupCalls, 1);
  assertEquals(newCleanupCalls, 0);

  await handleToolCleanup(newLease);
  assertEquals(__remoteToolExecutorsSizeForTesting(), 0);
  assertEquals(newCleanupCalls, 1);
  __resetRemoteToolExecutorsForTesting();
});

test("old lease abort cannot cancel a fresh lease controller", () => {
  __resetRemoteToolExecutorsForTesting();
  const runId = `run-abort-race-${crypto.randomUUID()}`;
  const oldLease = { runId, serviceId: "service-old", leaseVersion: 2 };
  const freshLease = { runId, serviceId: "service-fresh", leaseVersion: 3 };
  __setRemoteToolExecutorForTesting(
    oldLease,
    { cleanup() {} } as never,
    Date.now(),
  );
  __setRemoteToolExecutorForTesting(
    freshLease,
    { cleanup() {} } as never,
    Date.now(),
  );
  const oldSignal = __remoteToolExecutorAbortSignalForTesting(oldLease);
  const freshSignal = __remoteToolExecutorAbortSignalForTesting(freshLease);

  assertEquals(abortRemoteToolExecutorsForLease(oldLease), 1);
  assertEquals(oldSignal?.aborted, true);
  assertEquals(freshSignal?.aborted, false);
  assertEquals(abortSupersededRemoteToolExecutors(freshLease), 0);
  assertEquals(freshSignal?.aborted, false);
  assertEquals(abortRemoteToolExecutorsForRun(runId), 1);
  assertEquals(freshSignal?.aborted, true);
  __resetRemoteToolExecutorsForTesting();
});

test("in-flight tool polling observes cross-isolate cancellation within the bound", async () => {
  __resetRemoteToolExecutorsForTesting();
  const lease = {
    runId: `run-poll-${crypto.randomUUID()}`,
    serviceId: "service-current",
    leaseVersion: 5,
  };
  let leaseReads = 0;
  const db = {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                get() {
                  leaseReads++;
                  return Promise.resolve({
                    serviceId: lease.serviceId,
                    leaseVersion: lease.leaseVersion,
                    status: leaseReads >= 2 ? "cancelled" : "running",
                  });
                },
              };
            },
          };
        },
      };
    },
    insert() {},
    update() {},
    delete() {},
  };
  __setRemoteToolExecutorForTesting(
    lease,
    {
      cleanup() {},
      execute() {
        const signal = __remoteToolExecutorAbortSignalForTesting(lease);
        return new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        });
      },
    } as never,
    Date.now(),
  );

  const response = await Promise.race([
    handleToolExecute(
      {
        ...lease,
        toolCall: { id: "tool-1", name: "slow_mcp", arguments: {} },
      },
      {
        DB: db,
        TAKOS_AGENT_RUN_LEASE_POLL_INTERVAL_MS: "10",
      } as never,
    ),
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error("lease polling timed out")), 500),
    ),
  ]);
  assertEquals(response.status, 409);
  assertEquals(leaseReads >= 2, true);
  assertEquals(__remoteToolExecutorAbortSignalForTesting(lease)?.aborted, true);
  __resetRemoteToolExecutorsForTesting();
});
