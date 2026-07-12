import { test } from "bun:test";
import { assertEquals, assertFalse } from "@takos/test/assert";
import {
  handleToolCatalog,
  handleToolCleanup,
  handleToolExecute,
  type RemoteToolExecutorDependencies,
} from "../executor-control-rpc.ts";

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

test("tool catalog bootstrap failures do not leak request state", async () => {
  const runId = `run-broken-${crypto.randomUUID()}`;
  const env = envWithBrokenDb();

  const first = await handleToolCatalog({ runId }, env as never);
  const second = await handleToolCatalog({ runId }, env as never);

  assertFalse(first.ok, "expected error response from broken DB");
  assertFalse(second.ok, "a later request must fail independently");
});

test("tool catalog and execution use separate request-local executors", async () => {
  const signals: Array<AbortSignal | undefined> = [];
  const cleaned: string[] = [];
  let sequence = 0;
  const dependencies: RemoteToolExecutorDependencies = {
    async createExecutor(_runId, _env, signal) {
      sequence += 1;
      const id = `executor-${sequence}`;
      signals.push(signal);
      return {
        mcpFailedServers: [],
        getAvailableTools: () => [{ name: id }] as never,
        execute: async (toolCall) => ({
          tool_call_id: toolCall.id,
          output: id,
        }),
        cleanup: () => {
          cleaned.push(id);
        },
      };
    },
  };

  const catalog = await handleToolCatalog(
    { runId: "run-request-local" },
    {} as never,
    dependencies,
  );
  const execution = await handleToolExecute(
    {
      runId: "run-request-local",
      toolCall: { id: "call-1", name: "example", arguments: {} },
    },
    {} as never,
    dependencies,
  );

  assertEquals(catalog.status, 200);
  assertEquals(execution.status, 200);
  assertEquals(await execution.json(), {
    tool_call_id: "call-1",
    output: "executor-2",
  });
  assertEquals(sequence, 2);
  assertEquals(signals[0], undefined);
  assertEquals(signals[1]?.aborted, true);
  assertEquals(cleaned, ["executor-1", "executor-2"]);
});

test("every tool execution request gets an independent abort signal", async () => {
  const signals: AbortSignal[] = [];
  const dependencies: RemoteToolExecutorDependencies = {
    async createExecutor(_runId, _env, signal) {
      if (!signal) throw new Error("execution signal is required");
      signals.push(signal);
      return {
        mcpFailedServers: [],
        getAvailableTools: () => [],
        execute: async (toolCall) => ({
          tool_call_id: toolCall.id,
          output: "ok",
        }),
        cleanup() {},
      };
    },
  };

  for (const id of ["call-1", "call-2"]) {
    const response = await handleToolExecute(
      {
        runId: "run-request-local",
        toolCall: { id, name: "example", arguments: {} },
      },
      {} as never,
      dependencies,
    );
    assertEquals(response.status, 200);
  }

  assertEquals(signals.length, 2);
  assertFalse(signals[0] === signals[1]);
  assertEquals(signals.every((signal) => signal.aborted), true);
});

test("tool cleanup is an idempotent no-op for request-local executors", async () => {
  const response = await handleToolCleanup({ runId: "run-request-local" });
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { success: true });
});

test("in-flight tool polling aborts the request-local executor after lease loss", async () => {
  const lease = {
    runId: `run-poll-${crypto.randomUUID()}`,
    serviceId: "service-current",
    leaseVersion: 5,
  };
  let leaseReads = 0;
  let cleanupCalls = 0;
  let executionSignal: AbortSignal | undefined;
  const db = {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                get() {
                  leaseReads += 1;
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
  const dependencies: RemoteToolExecutorDependencies = {
    async createExecutor(_runId, _env, signal) {
      executionSignal = signal;
      return {
        mcpFailedServers: [],
        getAvailableTools: () => [],
        execute: () =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true },
            );
          }),
        cleanup: () => {
          cleanupCalls += 1;
        },
      } as never;
    },
  };

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
      dependencies,
    ),
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error("lease polling timed out")), 500),
    ),
  ]);

  assertEquals(response.status, 409);
  assertEquals(leaseReads >= 2, true);
  assertEquals(executionSignal?.aborted, true);
  assertEquals(cleanupCalls, 1);
});
