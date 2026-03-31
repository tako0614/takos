/**
 * AgentRunnerIo - IO interface for the agent runner.
 *
 * Defines the contract for all external side-effects (DB reads/writes,
 * tool execution, event emission, etc.) that the AgentRunner depends on.
 * Extracted from runner.ts so that satellite modules (execute-run, skill-plan,
 * memory-manager) can import the type without pulling in the full runner.
 */

import type { RunStatus } from '../../../shared/types/index.ts';
import type { AgentEvent, AgentMessage } from './agent-models.ts';

export interface AgentRunnerIo {
  getRunBootstrap(input: {
    runId: string;
  }): Promise<{
    status: RunStatus | null;
    spaceId: string;
    sessionId: string | null;
    threadId: string;
    userId: string;
    agentType: string;
  }>;
  getRunRecord(input: {
    runId: string;
  }): Promise<{
    status: RunStatus | null;
    input: string | null;
    parentRunId: string | null;
  }>;
  getRunStatus(input: { runId: string }): Promise<RunStatus | null>;
  getConversationHistory(input: {
    runId: string;
    threadId: string;
    spaceId: string;
    aiModel: string;
  }): Promise<AgentMessage[]>;
  addMessage(input: {
    runId: string;
    threadId: string;
    message: AgentMessage;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  updateRunStatus(input: {
    runId: string;
    status: RunStatus;
    usage: { inputTokens: number; outputTokens: number };
    output?: string;
    error?: string;
  }): Promise<void>;
  getCurrentSessionId(input: { runId: string; spaceId: string }): Promise<string | null>;
  isCancelled(input: { runId: string }): Promise<boolean>;
  resolveSkillPlan(input: {
    runId: string;
    threadId: string;
    spaceId: string;
    agentType: string;
    history: AgentMessage[];
    availableToolNames: string[];
  }): Promise<import('./skills.ts').SkillLoadResult>;
  getMemoryActivation(input: { spaceId: string }): Promise<import('../memory-graph/graph-models.ts').ActivationResult>;
  finalizeMemoryOverlay(input: {
    runId: string;
    spaceId: string;
    claims: import('../memory-graph/graph-models.ts').Claim[];
    evidence: import('../memory-graph/graph-models.ts').Evidence[];
  }): Promise<void>;
  getToolCatalog(input: { runId: string }): Promise<{
    tools: import('../../tools/tool-definitions.ts').ToolDefinition[];
    mcpFailedServers: string[];
  }>;
  executeTool(input: {
    runId: string;
    toolCall: import('../../tools/tool-definitions.ts').ToolCall;
  }): Promise<import('../../tools/tool-definitions.ts').ToolResult>;
  cleanupToolExecutor(input: { runId: string }): Promise<void>;
  emitRunEvent(input: {
    runId: string;
    type: AgentEvent['type'];
    data: Record<string, unknown>;
    sequence: number;
    skipDb?: boolean;
  }): Promise<void>;
}
