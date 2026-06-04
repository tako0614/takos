/**
 * Control RPC I/O adapter.
 *
 * Adapts a ControlRpcClient to the runIo interface expected by AgentRunner.
 * Also provides the fetchApiKeys helper used during run bootstrap.
 */

import type { ControlRpcClient } from "./control-rpc.ts";

// ---------------------------------------------------------------------------
// API key fetching
// ---------------------------------------------------------------------------

/** Fetch API keys from the gateway Worker proxy (keys never travel in the dispatch payload). */
export function fetchApiKeys(
  controlRpc: ControlRpcClient,
): ReturnType<ControlRpcClient["fetchApiKeys"]> {
  return controlRpc.fetchApiKeys();
}

// ---------------------------------------------------------------------------
// RunIo adapter
// ---------------------------------------------------------------------------

export interface ControlRpcRunIo {
  getRunBootstrap(
    input: { runId: string },
  ): ReturnType<ControlRpcClient["getRunBootstrap"]>;
  getRunRecord(
    input: { runId: string },
  ): ReturnType<ControlRpcClient["getRunRecord"]>;
  getRunStatus(
    input: { runId: string },
  ): ReturnType<ControlRpcClient["getRunStatus"]>;
  isCancelled(
    input: { runId: string },
  ): ReturnType<ControlRpcClient["isCancelled"]>;
  getToolCatalog(
    input: { runId: string },
  ): ReturnType<ControlRpcClient["getToolCatalog"]>;
  cleanupToolExecutor(
    input: { runId: string },
  ): ReturnType<ControlRpcClient["cleanupToolExecutor"]>;
  getConversationHistory(
    input: Parameters<ControlRpcClient["getConversationHistory"]>[0],
  ): ReturnType<ControlRpcClient["getConversationHistory"]>;
  resolveSkillPlan(
    input: Parameters<ControlRpcClient["resolveSkillPlan"]>[0],
  ): ReturnType<ControlRpcClient["resolveSkillPlan"]>;
  getMemoryActivation(
    input: Parameters<ControlRpcClient["getMemoryActivation"]>[0],
  ): ReturnType<ControlRpcClient["getMemoryActivation"]>;
  finalizeMemoryOverlay(
    input: Parameters<ControlRpcClient["finalizeMemoryOverlay"]>[0],
  ): ReturnType<ControlRpcClient["finalizeMemoryOverlay"]>;
  addMessage(
    input: Parameters<ControlRpcClient["addMessage"]>[0],
  ): ReturnType<ControlRpcClient["addMessage"]>;
  updateRunStatus(
    input: Parameters<ControlRpcClient["updateRunStatus"]>[0],
  ): ReturnType<ControlRpcClient["updateRunStatus"]>;
  getCurrentSessionId(
    input: Parameters<ControlRpcClient["getCurrentSessionId"]>[0],
  ): ReturnType<ControlRpcClient["getCurrentSessionId"]>;
  executeTool(
    input: Parameters<ControlRpcClient["executeTool"]>[0],
  ): ReturnType<ControlRpcClient["executeTool"]>;
  emitRunEvent(
    input: Parameters<ControlRpcClient["emitRunEvent"]>[0],
  ): ReturnType<ControlRpcClient["emitRunEvent"]>;
}

/**
 * Adapt a ControlRpcClient to the runIo interface expected by AgentRunner.
 *
 * Most methods are pure passthroughs. The handful that differ just unwrap
 * `{ runId }` into a plain string because ControlRpcClient takes `runId: string`
 * while AgentRunnerIo consistently uses `{ runId: string }` input objects.
 */
export function createControlRpcRunIo(
  controlRpc: ControlRpcClient,
): ControlRpcRunIo {
  return {
    // --- Methods that unwrap { runId } → plain string ---
    getRunBootstrap: (input: { runId: string }) =>
      controlRpc.getRunBootstrap(input.runId),
    getRunRecord: (input: { runId: string }) =>
      controlRpc.getRunRecord(input.runId),
    getRunStatus: (input: { runId: string }) =>
      controlRpc.getRunStatus(input.runId),
    isCancelled: (input: { runId: string }) =>
      controlRpc.isCancelled(input.runId),
    getToolCatalog: (input: { runId: string }) =>
      controlRpc.getToolCatalog(input.runId),
    cleanupToolExecutor: (input: { runId: string }) =>
      controlRpc.cleanupToolExecutor(input.runId),

    // --- Pure passthroughs (input shape matches ControlRpcClient) ---
    getConversationHistory: (
      input: Parameters<ControlRpcClient["getConversationHistory"]>[0],
    ) => controlRpc.getConversationHistory(input),
    resolveSkillPlan: (
      input: Parameters<ControlRpcClient["resolveSkillPlan"]>[0],
    ) => controlRpc.resolveSkillPlan(input),
    getMemoryActivation: (
      input: Parameters<ControlRpcClient["getMemoryActivation"]>[0],
    ) => controlRpc.getMemoryActivation(input),
    finalizeMemoryOverlay: (
      input: Parameters<ControlRpcClient["finalizeMemoryOverlay"]>[0],
    ) => controlRpc.finalizeMemoryOverlay(input),
    addMessage: (input: Parameters<ControlRpcClient["addMessage"]>[0]) =>
      controlRpc.addMessage(input),
    updateRunStatus: (
      input: Parameters<ControlRpcClient["updateRunStatus"]>[0],
    ) => controlRpc.updateRunStatus(input),
    getCurrentSessionId: (
      input: Parameters<ControlRpcClient["getCurrentSessionId"]>[0],
    ) => controlRpc.getCurrentSessionId(input),
    executeTool: (input: Parameters<ControlRpcClient["executeTool"]>[0]) =>
      controlRpc.executeTool(input),
    emitRunEvent: (input: Parameters<ControlRpcClient["emitRunEvent"]>[0]) =>
      controlRpc.emitRunEvent(input),
  };
}
