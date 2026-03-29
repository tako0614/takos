/**
 * Simple LLM loop and no-LLM fallback execution modes for the Agent Runner.
 *
 * These are fallback execution paths when LangGraph is unavailable or
 * when no LLM API key is configured.
 */
import type { AgentMessage, AgentConfig, AgentEvent } from './agent-models';
import type { RunTerminalPayload } from '../run-notifier';
import type { LLMClient } from './llm';
import type { ToolExecutorLike } from '../../tools/executor';
import type { ToolExecution } from './runner-utils';
import type { Env } from '../../../shared/types';
import type { RunStatus } from '../../../shared/types';
import type { AgentMemoryRuntime } from '../memory-graph/memory-graph-runtime';
import type { SkillCatalogEntry, SkillSelection, SkillContext } from './skills';
export interface SimpleLoopDeps {
    env: Env;
    config: AgentConfig;
    llmClient: LLMClient;
    toolExecutor: ToolExecutorLike | undefined;
    skillLocale: 'ja' | 'en';
    availableSkills: SkillCatalogEntry[];
    selectedSkills: SkillSelection[];
    activatedSkills: SkillContext[];
    spaceId: string;
    abortSignal?: AbortSignal;
    toolExecutions: ToolExecution[];
    totalUsage: {
        inputTokens: number;
        outputTokens: number;
    };
    toolCallCount: number;
    totalToolCalls: number;
    memoryRuntime?: AgentMemoryRuntime;
    throwIfCancelled: (context: string) => Promise<void>;
    emitEvent: (type: AgentEvent['type'], data: Record<string, unknown>) => Promise<void>;
    addMessage: (message: AgentMessage, metadata?: Record<string, unknown>) => Promise<void>;
    updateRunStatus: (status: RunStatus, output?: string, error?: string) => Promise<void>;
    buildTerminalEventPayload: (status: 'completed' | 'failed' | 'cancelled', details?: Record<string, unknown>) => RunTerminalPayload;
    getConversationHistory: () => Promise<AgentMessage[]>;
}
/**
 * Run with simple LLM loop (no LangGraph).
 */
export declare function runWithSimpleLoop(deps: SimpleLoopDeps): Promise<void>;
export interface NoLLMDeps {
    toolExecutor: ToolExecutorLike | undefined;
    emitEvent: (type: AgentEvent['type'], data: Record<string, unknown>) => Promise<void>;
    addMessage: (message: AgentMessage, metadata?: Record<string, unknown>) => Promise<void>;
    updateRunStatus: (status: RunStatus, output?: string, error?: string) => Promise<void>;
    buildTerminalEventPayload: (status: 'completed' | 'failed' | 'cancelled', details?: Record<string, unknown>) => RunTerminalPayload;
}
/**
 * Run without LLM (fallback mode).
 */
export declare function runWithoutLLM(deps: NoLLMDeps, history: AgentMessage[]): Promise<void>;
//# sourceMappingURL=simple-loop.d.ts.map