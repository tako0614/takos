import { assert, assertEquals } from "@std/assert";
import { FakeTime } from "jsr:@std/testing/time";

import {
  bootstrapMemory,
  finalizeMemory,
  type MemoryManagerDeps,
  type MemoryState,
} from "../memory-manager.ts";
import {
  AGENT_MEMORY_BOOTSTRAP_TIMEOUT_MS,
  AGENT_MEMORY_FINALIZE_TIMEOUT_MS,
} from "../../../../shared/config/timeouts.ts";
import type { Env } from "../../../../shared/types/index.ts";
import type { SqlDatabaseBinding } from "../../../../shared/types/bindings.ts";
import type { AgentRunnerIo } from "../runner-io.ts";
import type { ToolExecutorLike } from "../../../tools/executor.ts";
import type { AgentMemoryRuntime } from "../../memory-graph/memory-graph-runtime.ts";

function createDeps(
  runIo: Pick<AgentRunnerIo, "getMemoryActivation" | "finalizeMemoryOverlay">,
): MemoryManagerDeps {
  return {
    db: {} as SqlDatabaseBinding,
    env: {} as Env,
    context: {
      runId: "run-1",
      threadId: "thread-1",
      spaceId: "space-1",
      userId: "user-1",
    },
    runIo: runIo as AgentRunnerIo,
  };
}

function createToolExecutor(): ToolExecutorLike & { observerSet: boolean } {
  return {
    observerSet: false,
    mcpFailedServers: [],
    execute: () => Promise.resolve({ output: "", tool_call_id: "tool-1" }),
    getAvailableTools: () => [],
    setObserver() {
      this.observerSet = true;
    },
    cleanup() {},
  };
}

Deno.test("bootstrapMemory installs observer after memory activation succeeds", async () => {
  let activationCalls = 0;
  const deps = createDeps({
    getMemoryActivation: async () => {
      activationCalls++;
      return { bundles: [], segment: "", hasContent: false };
    },
    finalizeMemoryOverlay: async () => {},
  });
  const state: MemoryState = { runtime: undefined };
  const toolExecutor = createToolExecutor();

  await bootstrapMemory(deps, state, toolExecutor);

  assert(state.runtime);
  assertEquals(toolExecutor.observerSet, true);
  assertEquals(activationCalls, 1);
});

Deno.test("bootstrapMemory returns without runtime when memory activation times out", async () => {
  const fakeTime = new FakeTime();
  try {
    const deps = createDeps({
      getMemoryActivation: () => new Promise(() => {}),
      finalizeMemoryOverlay: async () => {},
    });
    const state: MemoryState = { runtime: undefined };
    const toolExecutor = createToolExecutor();

    const promise = bootstrapMemory(deps, state, toolExecutor);
    await Promise.resolve();
    fakeTime.tick(AGENT_MEMORY_BOOTSTRAP_TIMEOUT_MS + 1);
    await promise;

    assertEquals(state.runtime, undefined);
    assertEquals(toolExecutor.observerSet, false);
  } finally {
    fakeTime.restore();
  }
});

Deno.test("finalizeMemory clears runtime when memory finalize times out", async () => {
  const fakeTime = new FakeTime();
  try {
    const state: MemoryState = {
      runtime: {
        finalize: () => new Promise(() => {}),
      } as unknown as AgentMemoryRuntime,
    };

    const promise = finalizeMemory(state);
    await Promise.resolve();
    fakeTime.tick(AGENT_MEMORY_FINALIZE_TIMEOUT_MS + 1);
    await promise;

    assertEquals(state.runtime, undefined);
  } finally {
    fakeTime.restore();
  }
});
