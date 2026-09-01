import { test } from "bun:test";
import { assertEquals, assertFalse } from "@takos/test/assert";
import {
  handleToolCatalog,
  handleToolCleanup,
  handleToolExecute,
  type RemoteToolExecutorDependencies,
} from "../executor-control-rpc.ts";
import type { RunExecutionAuthority } from "../../../application/services/runs/run-authority.ts";
import type { ToolDefinition } from "../../../application/tools/tool-definitions.ts";
import { toolDescriptorSnapshot } from "../../../application/tools/tool-descriptor-revisions.ts";

const TEST_AUTHORITY: RunExecutionAuthority = {
  runId: "run-request-local",
  principalId: "user-a",
  workspaceId: "space-a",
  threadId: "thread-a",
  capabilities: ["storage.read"],
  confirmationGrantIds: [],
  budgets: { maxGraphSteps: 64, maxToolRounds: 8 },
  baseAttestation: {
    contextRevision: 1,
    contextDigest: `sha256:${"a".repeat(64)}`,
    runGrantDigest: `sha256:${"b".repeat(64)}`,
  },
  attestation: {
    contextRevision: 1,
    contextDigest: `sha256:${"a".repeat(64)}`,
    runGrantDigest: `sha256:${"b".repeat(64)}`,
  },
};

function authorityForRun(runId: string): RunExecutionAuthority {
  return { ...TEST_AUTHORITY, runId };
}

function resolveTestAuthority(runId: string): Promise<RunExecutionAuthority> {
  return Promise.resolve(authorityForRun(runId));
}

function testTool(name: string, sideEffects = false): ToolDefinition {
  return {
    name,
    description: `${name} description`,
    category: name === "toolbox" ? "space" : "web",
    namespace: name === "toolbox" ? "discovery" : "web",
    family: name === "toolbox" ? "discovery.toolbox" : "web.direct",
    risk_level: sideEffects ? "medium" : "none",
    side_effects: sideEffects,
    parameters: { type: "object", properties: {} },
  };
}

async function activateTestCatalog(
  _db: unknown,
  authority: RunExecutionAuthority,
  tools: readonly ToolDefinition[],
) {
  return {
    authority,
    descriptors: await Promise.all(tools.map(async (tool, index) => {
      const snapshot = await toolDescriptorSnapshot(
        authority.workspaceId,
        tool,
      );
      return {
        revisionId: `revision-${index}`,
        reference: {
          resourceKind: "tool_descriptor_revision" as const,
          resourceId: snapshot.resourceId,
          resourceDigest: `sha256:${String(index).padStart(64, "0")}`,
        },
        snapshot,
      };
    })),
  };
}

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
    resolveAuthority: resolveTestAuthority,
    async createExecutor(_runId, _env, _authority, signal) {
      sequence += 1;
      const id = `executor-${sequence}`;
      signals.push(signal);
      return {
        mcpFailedServers: [],
        getAvailableTools: () => [testTool("toolbox", true)],
        execute: async (toolCall) => ({
          tool_call_id: toolCall.id,
          output: id,
        }),
        cleanup: () => {
          cleaned.push(id);
        },
      };
    },
    activateToolCatalog: activateTestCatalog,
  };

  const catalog = await handleToolCatalog(
    { runId: "run-request-local" },
    {} as never,
    dependencies,
  );
  const execution = await handleToolExecute(
    {
      runId: "run-request-local",
      runAuthority: TEST_AUTHORITY.attestation,
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
    runAuthority: TEST_AUTHORITY.attestation,
  });
  assertEquals(sequence, 2);
  assertEquals(signals[0], undefined);
  assertEquals(signals[1]?.aborted, true);
  assertEquals(cleaned, ["executor-1", "executor-2"]);
});

test("tool catalog attests which side effects take the durable operation fence", async () => {
  const dependencies: RemoteToolExecutorDependencies = {
    resolveAuthority: resolveTestAuthority,
    async createExecutor() {
      return {
        mcpFailedServers: [],
        getAvailableTools: () => [
          testTool("toolbox", true),
          testTool("web_fetch", false),
        ],
        execute: async () => {
          throw new Error("not used");
        },
        cleanup() {},
      };
    },
    activateToolCatalog: activateTestCatalog,
  };

  const response = await handleToolCatalog(
    { runId: "run-catalog-fence" },
    {} as never,
    dependencies,
  );

  assertEquals(response.status, 200);
  const payload = await response.json() as {
    catalogVersion: number;
    sourceRunAuthority: typeof TEST_AUTHORITY.attestation;
    runAuthority: typeof TEST_AUTHORITY.attestation;
    tools: Array<{ name: string; durable_idempotency: boolean }>;
  };
  assertEquals(payload.catalogVersion, 2);
  assertEquals(payload.sourceRunAuthority, TEST_AUTHORITY.attestation);
  assertEquals(payload.runAuthority, TEST_AUTHORITY.attestation);
  assertEquals(payload.tools.map((tool) => ({
    name: tool.name,
    durable_idempotency: tool.durable_idempotency,
  })), [
    { name: "toolbox", durable_idempotency: true },
    { name: "web_fetch", durable_idempotency: false },
  ]);
});

test("tool execution rejects missing or stale catalog authority before executor creation", async () => {
  let createCalls = 0;
  const dependencies: RemoteToolExecutorDependencies = {
    resolveAuthority: resolveTestAuthority,
    async createExecutor() {
      createCalls += 1;
      throw new Error("must not create an executor for stale authority");
    },
  };
  const call = { id: "call-stale", name: "publish", arguments: {} };

  const missing = await handleToolExecute(
    { runId: "run-request-local", toolCall: call },
    {} as never,
    dependencies,
  );
  assertEquals(missing.status, 409);

  const stale = await handleToolExecute(
    {
      runId: "run-request-local",
      runAuthority: {
        ...TEST_AUTHORITY.attestation,
        contextDigest: `sha256:${"c".repeat(64)}`,
      },
      toolCall: call,
    },
    {} as never,
    dependencies,
  );
  assertEquals(stale.status, 409);
  assertEquals(createCalls, 0);
});

test("every tool execution request gets an independent abort signal", async () => {
  const signals: AbortSignal[] = [];
  const dependencies: RemoteToolExecutorDependencies = {
    resolveAuthority: resolveTestAuthority,
    async createExecutor(_runId, _env, _authority, signal) {
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
        runAuthority: TEST_AUTHORITY.attestation,
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

test("tool execution forwards the engine idempotency key to the durable executor", async () => {
  let receivedKey: string | undefined;
  const dependencies: RemoteToolExecutorDependencies = {
    resolveAuthority: resolveTestAuthority,
    async createExecutor() {
      return {
        mcpFailedServers: [],
        getAvailableTools: () => [],
        execute: async (toolCall, options) => {
          receivedKey = options?.idempotencyKey;
          return {
            tool_call_id: toolCall.id,
            output: "ok",
          };
        },
        cleanup() {},
      };
    },
  };

  const response = await handleToolExecute(
    {
      runId: "run-idempotent",
      runAuthority: TEST_AUTHORITY.attestation,
      idempotencyKey: "loop:loop-1:tool:1:0:publish",
      toolCall: { id: "call-1", name: "publish", arguments: { ref: "v1" } },
    },
    {} as never,
    dependencies,
  );

  assertEquals(response.status, 200);
  assertEquals(receivedKey, "loop:loop-1:tool:1:0:publish");
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
    resolveAuthority: resolveTestAuthority,
    async createExecutor(_runId, _env, _authority, signal) {
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
        runAuthority: authorityForRun(lease.runId).attestation,
        toolCall: { id: "tool-1", name: "slow_mcp", arguments: {} },
      },
      {
        DB: db,
        TAKOS_AGENT_RUN_LEASE_POLL_INTERVAL_MS: "10",
      } as never,
      dependencies,
    ),
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error("lease polling timed out")), 500)
    ),
  ]);

  assertEquals(response.status, 409);
  assertEquals(leaseReads >= 2, true);
  assertEquals(executionSignal?.aborted, true);
  assertEquals(cleanupCalls, 1);
});
