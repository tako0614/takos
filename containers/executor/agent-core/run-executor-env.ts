/**
 * Environment building logic for run execution.
 *
 * Constructs the canonical env record passed to AgentRunner and provides
 * the no-LLM fallback fast path for runs that lack API keys.
 */

import type { ControlRpcClient } from "./control-rpc.ts";
import type {
  RunExecutorExecutionEnv,
  RunExecutorOptions,
  RunExecutorRuntimeConfig,
  StartPayload,
} from "./run-executor.ts";

// ---------------------------------------------------------------------------
// Default timeout constants (milliseconds)
// ---------------------------------------------------------------------------

/** Default timeout values for agent execution (milliseconds). */
export const DEFAULT_AGENT_ITERATION_TIMEOUT = "120000"; // 2 minutes
export const DEFAULT_AGENT_TOTAL_TIMEOUT = "86400000"; // 24 hours
export const DEFAULT_TOOL_EXECUTION_TIMEOUT = "300000"; // 5 minutes
export const DEFAULT_LANGGRAPH_TIMEOUT = "86400000"; // 24 hours

// ---------------------------------------------------------------------------
// Environment builder
// ---------------------------------------------------------------------------

export function buildCanonicalRemoteExecutionEnv(apiKeys: {
  openai?: string;
  anthropic?: string;
  google?: string;
}, executionEnv?: RunExecutorExecutionEnv): Record<string, unknown> {
  return {
    OPENAI_API_KEY: apiKeys.openai,
    ANTHROPIC_API_KEY: apiKeys.anthropic,
    GOOGLE_API_KEY: apiKeys.google,
    ADMIN_DOMAIN: executionEnv?.ADMIN_DOMAIN,
    TENANT_BASE_DOMAIN: executionEnv?.TENANT_BASE_DOMAIN,
    MAX_AGENT_ITERATIONS: executionEnv?.MAX_AGENT_ITERATIONS,
    AGENT_TEMPERATURE: executionEnv?.AGENT_TEMPERATURE,
    AGENT_RATE_LIMIT: executionEnv?.AGENT_RATE_LIMIT,
    AGENT_ITERATION_TIMEOUT: executionEnv?.AGENT_ITERATION_TIMEOUT ??
      DEFAULT_AGENT_ITERATION_TIMEOUT,
    AGENT_TOTAL_TIMEOUT: executionEnv?.AGENT_TOTAL_TIMEOUT ??
      DEFAULT_AGENT_TOTAL_TIMEOUT,
    TOOL_EXECUTION_TIMEOUT: executionEnv?.TOOL_EXECUTION_TIMEOUT ??
      DEFAULT_TOOL_EXECUTION_TIMEOUT,
    LANGGRAPH_TIMEOUT: executionEnv?.LANGGRAPH_TIMEOUT ??
      DEFAULT_LANGGRAPH_TIMEOUT,
    SERPER_API_KEY: executionEnv?.SERPER_API_KEY,
  };
}

// ---------------------------------------------------------------------------
// No-LLM fallback
// ---------------------------------------------------------------------------

export function isNoLlmFallbackAllowed(
  runtimeConfig?: RunExecutorRuntimeConfig,
): boolean {
  return runtimeConfig?.allowNoLlmFallback === true;
}

export function buildNoLlmFallbackResponse(query: string): string {
  return `I understand you're asking about: "${query}"\n\n` +
    `I'm an AI agent that can help you with:\n` +
    `- Reading and writing files\n` +
    `- Searching your workspace\n` +
    `- Deploying workers\n` +
    `- Running build commands\n` +
    `- Working with repositories and containers\n` +
    `- Remembering information\n` +
    `- Creating code and documentation\n\n` +
    `Try asking me to "list files" or "read file 'path/to/file'".\n\n` +
    `Note: LLM API key not configured. Running in limited mode.`;
}

export async function runNoLlmFastPath(
  controlRpc: ControlRpcClient,
  payload: Pick<StartPayload, "runId" | "workerId" | "serviceId">,
  logger: RunExecutorOptions["logger"],
  tag: string,
): Promise<void> {
  const context = await controlRpc.getRunContext(payload.runId);
  const query = context.lastUserMessage || "No message provided";
  const response = buildNoLlmFallbackResponse(query);
  logger.info(`[${tag}] Completing run ${payload.runId} via no-LLM fast path`);
  await controlRpc.completeNoLlmRun({
    runId: payload.runId,
    serviceId: payload.serviceId,
    workerId: payload.workerId,
    response,
  });
}
