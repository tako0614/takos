/**
 * Memory Manager - Handles memory runtime integration and memory graph processing.
 *
 * Extracted from runner.ts to separate memory concerns from the core run loop.
 */

import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import type { Env } from "../../../shared/types/index.ts";
import type { AgentContext } from "./agent-models.ts";
import type { AgentRunnerIo } from "./runner-io.ts";
import type { ToolExecutorLike } from "../../tools/executor.ts";
import {
  type AgentMemoryBackend,
  AgentMemoryRuntime,
} from "../memory-graph/memory-graph-runtime.ts";
import {
  AGENT_MEMORY_BOOTSTRAP_TIMEOUT_MS,
  AGENT_MEMORY_FINALIZE_TIMEOUT_MS,
} from "../../../shared/config/timeouts.ts";
import { logWarn } from "../../../shared/utils/logger.ts";
import { withTimeout } from "../../../shared/utils/with-timeout.ts";

export interface MemoryManagerDeps {
  db: SqlDatabaseBinding;
  env: Env;
  context: AgentContext;
  runIo: AgentRunnerIo;
}

export interface MemoryState {
  runtime: AgentMemoryRuntime | undefined;
}

/**
 * Initialize and bootstrap the memory runtime, wiring the tool observer into the
 * provided tool executor. Silently degrades if initialization fails.
 */
export async function bootstrapMemory(
  deps: MemoryManagerDeps,
  state: MemoryState,
  toolExecutor: ToolExecutorLike | undefined,
): Promise<void> {
  try {
    const backend = createMemoryBackend(deps);
    const runtime = new AgentMemoryRuntime(
      deps.db,
      deps.context,
      deps.env,
      backend,
    );
    await withTimeout(
      runtime.bootstrap(),
      AGENT_MEMORY_BOOTSTRAP_TIMEOUT_MS,
      `Memory runtime bootstrap timed out after ${
        AGENT_MEMORY_BOOTSTRAP_TIMEOUT_MS / 1000
      } seconds`,
    );
    state.runtime = runtime;
    if (toolExecutor) {
      const observer = state.runtime.createToolObserver();
      toolExecutor.setObserver(observer);
    }
  } catch (err) {
    logWarn("Memory runtime initialization failed, continuing without memory", {
      module: "services/agent/memory-manager",
      detail: err,
    });
    state.runtime = undefined;
  }
}

/**
 * Finalize the memory runtime (flush overlay claims to DB).
 * Safe to call even if runtime was never initialized.
 */
export async function finalizeMemory(state: MemoryState): Promise<void> {
  const runtime = state.runtime;
  if (!runtime) return;
  try {
    await withTimeout(
      runtime.finalize(),
      AGENT_MEMORY_FINALIZE_TIMEOUT_MS,
      `Memory runtime finalize timed out after ${
        AGENT_MEMORY_FINALIZE_TIMEOUT_MS / 1000
      } seconds`,
    );
  } catch (err) {
    logWarn("Memory runtime finalize failed during cleanup", {
      module: "services/agent/memory-manager",
      detail: err,
    });
  } finally {
    state.runtime = undefined;
  }
}

function createMemoryBackend(
  deps: MemoryManagerDeps,
): AgentMemoryBackend | undefined {
  return {
    bootstrap: () =>
      deps.runIo.getMemoryActivation({ spaceId: deps.context.spaceId }),
    finalize: ({ claims, evidence }) =>
      deps.runIo.finalizeMemoryOverlay({
        runId: deps.context.runId,
        spaceId: deps.context.spaceId,
        claims,
        evidence,
      }),
  };
}
