import type { Env, RunStatus } from '../../../shared/types';
import type { SqlDatabaseBinding } from '../../../shared/types/bindings.ts';
import type { ToolExecutorLike } from '../../tools/executor';
import type { AgentContext, AgentConfig, AgentEvent, AgentMessage } from './agent-models';
import type { ToolExecution } from './runner-types';
import type { LLMClient, ModelProvider } from './llm';
import {
  buildSkillEnhancedPrompt,
  type ResolvedSkillPlan,
} from './skills';
import {
  createLangGraphAgent,
  runLangGraph,
  dbMessagesToLangChain,
  langChainMessageToDb,
  type LangGraphEvent,
} from './langgraph-agent';
import { getTimeoutConfig } from './runner-config';
import { RunCancelledError } from './run-lifecycle';
import { withTimeout } from '../../../shared/utils/with-timeout';
import { buildTerminalPayload, type RunTerminalPayload } from '../run-notifier';
import { runWithSimpleLoop, runWithoutLLM } from './simple-loop';
import { throwIfAborted } from 'takos-common/abort';
import type { AgentMemoryRuntime } from '../memory-graph/memory-graph-runtime';

type ToolExecutionRecord = {
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  error?: string;
  startedAt: number;
  duration_ms?: number;
};

type LangGraphRunOptions = {
  apiKey: string;
  model: string;
  systemPrompt: string;
  skillPlan: ResolvedSkillPlan;
  history: AgentMessage[];
  threadId: string;
  runId: string;
  sessionId?: string;
  toolExecutor: ToolExecutorLike;
  db: SqlDatabaseBinding;
  maxIterations: number;
  temperature: number;
  toolExecutions: ToolExecutionRecord[];
  emitEvent: (type: AgentEvent['type'], data: Record<string, unknown>) => Promise<void>;
  addMessage: (message: AgentMessage, metadata?: Record<string, unknown>) => Promise<void>;
  updateRunStatus: (status: RunStatus, output?: string, error?: string) => Promise<void>;
  env?: Env;
  spaceId?: string;
  shouldCancel?: () => boolean | Promise<boolean>;
  abortSignal?: AbortSignal;
  memoryRuntime?: AgentMemoryRuntime;
};

export async function runLangGraphRunner(options: LangGraphRunOptions): Promise<void> {
  throwIfAborted(options.abortSignal, 'langgraph-start');
  if (options.shouldCancel && await options.shouldCancel()) {
    throw new RunCancelledError();
  }

  // Include active memory in the enhanced prompt.
  // Note: LangGraph bakes the system prompt at graph creation time, so memory
  // is only refreshed once at the start of the run (not per-iteration like
  // the Simple Loop path). This is a known limitation — the observer still
  // accumulates overlay claims for finalize() and future runs.
  let memorySegment = '';
  if (options.memoryRuntime) {
    const activation = options.memoryRuntime.beforeModel();
    if (activation.hasContent) {
      memorySegment = `\n\n[ACTIVE_MEMORY]\n${activation.segment}`;
    }
  }

  const enhancedPrompt = buildSkillEnhancedPrompt(
    options.systemPrompt,
    options.skillPlan,
    options.spaceId,
  ) + memorySegment;

  const lastUserMessage = options.history.filter((message) => message.role === 'user').pop();
  const input = lastUserMessage?.content || '';

  const historyForGraph = options.history.slice(0, -1);
  const historyForDb = historyForGraph.map((message) => ({
    role: message.role,
    content: message.content,
    tool_calls: message.tool_calls ? JSON.stringify(message.tool_calls) : null,
    tool_call_id: message.tool_call_id || null,
  }));
  const langChainHistory = dbMessagesToLangChain(historyForDb);

  const availableTools = options.toolExecutor.getAvailableTools();

  const baseTemperature = Number.isFinite(options.temperature) ? options.temperature : 0.7;
  const temperature = options.model.startsWith('gpt-5') ? 1 : baseTemperature;

  const agent = createLangGraphAgent({
    apiKey: options.apiKey,
    model: options.model,
    temperature,
    systemPrompt: enhancedPrompt,
    tools: availableTools,
    toolExecutor: options.toolExecutor,
    db: options.db,
    maxIterations: options.maxIterations || 10,
    abortSignal: options.abortSignal,
  });

  const timeoutConfig = getTimeoutConfig(options.env);
  const langGraphTimeoutMs = timeoutConfig.langGraphTimeout;

  const result = await withTimeout(
    runLangGraph({
      agent,
      threadId: options.threadId,
      input,
      history: langChainHistory,
      shouldCancel: options.shouldCancel,
      abortSignal: options.abortSignal,
      onEvent: async (event: LangGraphEvent) => {
        if (event.type === 'completed') return;
        await options.emitEvent(event.type, event.data);
      },
      onMessage: async (message) => {
        const dbMsg = langChainMessageToDb(message);

        let messageMetadata: Record<string, unknown> | undefined;
        if (dbMsg.role === 'assistant' && !dbMsg.tool_calls && options.toolExecutions.length > 0) {
          messageMetadata = {
            tool_executions: options.toolExecutions.map((exec) => ({
              name: exec.name,
              arguments: exec.arguments,
              result: exec.result
                ? exec.result.length > 500
                  ? exec.result.slice(0, 500) + '...'
                  : exec.result
                : undefined,
              error: exec.error,
              duration_ms: exec.duration_ms,
            })),
          };
          options.toolExecutions.length = 0;
        }

        let parsedToolCalls:
          | Array<{ id: string; name: string; arguments: Record<string, unknown> }>
          | undefined;
        if (dbMsg.tool_calls) {
          try {
            const parsed = JSON.parse(dbMsg.tool_calls);
            if (Array.isArray(parsed) && parsed.length > 0) {
              parsedToolCalls = parsed;
            }
          } catch {
            // Malformed tool_calls - skip
          }
        }

        await options.addMessage(
          {
            role: dbMsg.role as AgentMessage['role'],
            content: dbMsg.content,
            tool_calls: parsedToolCalls,
            tool_call_id: dbMsg.tool_call_id,
          },
          messageMetadata
        );
      },
    }),
    langGraphTimeoutMs,
    `LangGraph agent execution timed out after ${langGraphTimeoutMs / 1000 / 60} minutes`
  );

  throwIfAborted(options.abortSignal, 'langgraph-complete');
  if (options.shouldCancel && await options.shouldCancel()) {
    throw new RunCancelledError();
  }

  await options.updateRunStatus(
    'completed',
    JSON.stringify({
      response: result.response,
      iterations: result.iterations,
      engine: 'langgraph',
    })
  );
  await options.emitEvent('completed', {
    ...buildTerminalPayload(
      options.runId,
      'completed',
      {
        success: true,
        iterations: result.iterations,
      },
      options.sessionId ?? null,
    ),
  });
}

// ---------------------------------------------------------------------------
// Engine dispatch (merged from engine-dispatcher.ts)
// ---------------------------------------------------------------------------

export interface EngineDispatchDeps {
  env: Env;
  db: SqlDatabaseBinding;
  context: AgentContext;
  config: AgentConfig;
  toolExecutor: ToolExecutorLike | undefined;
  llmClient?: LLMClient;
  modelProvider: ModelProvider;
  aiModel: string;
  openAiKey?: string;
  abortSignal?: AbortSignal;
  toolExecutions: ToolExecution[];
  totalUsage: { inputTokens: number; outputTokens: number };
  toolCallCount: number;
  totalToolCalls: number;

  skillPlan: ResolvedSkillPlan;
  memoryRuntime?: AgentMemoryRuntime;

  throwIfCancelled: (ctx: string) => Promise<void>;
  checkCancellation: () => boolean | Promise<boolean>;
  emitEvent: (type: AgentEvent['type'], data: Record<string, unknown>) => Promise<void>;
  addMessage: (msg: AgentMessage, meta?: Record<string, unknown>) => Promise<void>;
  updateRunStatus: (status: RunStatus, output?: string, error?: string) => Promise<void>;
  buildTerminalEventPayload: (status: 'completed' | 'failed' | 'cancelled', details?: Record<string, unknown>) => RunTerminalPayload;
  getConversationHistory: () => Promise<AgentMessage[]>;
}

export type EngineType = 'langgraph' | 'simple' | 'none';

export async function dispatchEngine(
  deps: EngineDispatchDeps,
  history: AgentMessage[],
): Promise<void> {
  const engine = selectEngine(deps);

  if (engine === 'none') {
    await runWithoutLLM(
      {
        toolExecutor: deps.toolExecutor,
        emitEvent: deps.emitEvent,
        addMessage: deps.addMessage,
        updateRunStatus: deps.updateRunStatus,
        buildTerminalEventPayload: deps.buildTerminalEventPayload,
      },
      history,
    );
    return;
  }

  if (engine === 'simple') {
    await deps.emitEvent('thinking', { message: 'Using simple mode for selected model', engine: 'simple' });
    await dispatchSimpleLoop(deps);
    return;
  }

  await executeLangGraphEngine(deps, history);
}

function selectEngine(deps: EngineDispatchDeps): EngineType {
  if (!deps.llmClient) return 'none';
  if (deps.modelProvider === 'openai' && deps.openAiKey) return 'langgraph';
  return 'simple';
}

async function executeLangGraphEngine(
  deps: EngineDispatchDeps,
  history: AgentMessage[],
): Promise<void> {
  await runLangGraphRunner({
    apiKey: deps.openAiKey!,
    model: deps.aiModel,
    systemPrompt: deps.config.systemPrompt,
    skillPlan: deps.skillPlan,
    history,
    threadId: deps.context.threadId,
    runId: deps.context.runId,
    sessionId: deps.context.sessionId,
    toolExecutor: deps.toolExecutor!,
    db: deps.db,
    maxIterations: deps.config.maxIterations || 10,
    temperature: deps.config.temperature ?? 0.7,
    toolExecutions: deps.toolExecutions,
    emitEvent: deps.emitEvent,
    addMessage: deps.addMessage,
    updateRunStatus: deps.updateRunStatus,
    env: deps.env,
    spaceId: deps.context.spaceId,
    shouldCancel: deps.checkCancellation,
    abortSignal: deps.abortSignal,
    memoryRuntime: deps.memoryRuntime,
  });
}

async function dispatchSimpleLoop(deps: EngineDispatchDeps): Promise<void> {
  await runWithSimpleLoop({
    env: deps.env,
    config: deps.config,
    llmClient: deps.llmClient!,
    toolExecutor: deps.toolExecutor,
    skillLocale: deps.skillPlan.locale,
    availableSkills: deps.skillPlan.availableSkills,
    selectedSkills: deps.skillPlan.selectedSkills,
    activatedSkills: deps.skillPlan.activatedSkills,
    spaceId: deps.context.spaceId,
    abortSignal: deps.abortSignal,
    toolExecutions: deps.toolExecutions,
    totalUsage: deps.totalUsage,
    toolCallCount: deps.toolCallCount,
    totalToolCalls: deps.totalToolCalls,
    memoryRuntime: deps.memoryRuntime,
    throwIfCancelled: deps.throwIfCancelled,
    emitEvent: deps.emitEvent,
    addMessage: deps.addMessage,
    updateRunStatus: deps.updateRunStatus,
    buildTerminalEventPayload: deps.buildTerminalEventPayload,
    getConversationHistory: deps.getConversationHistory,
  });
}
