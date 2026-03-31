/**
 * LangGraph Graph Construction and State Management
 *
 * Defines the agent state, builds the StateGraph with agent/tool nodes,
 * and exports the createLangGraphAgent factory.
 */

import {
  START,
  END,
  StateGraph,
  Annotation,
  messagesStateReducer,
} from '@langchain/langgraph/web';
import { ChatOpenAI } from '@langchain/openai';
import { ServiceUnavailableError } from 'takos-common/errors';
import {
  BaseMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import type { ToolDefinition } from '../../tools/tool-definitions.ts';
import type { ToolExecutorLike } from '../../tools/executor.ts';
import { DEFAULT_MODEL_ID } from './model-catalog.ts';
import { estimateTokens } from './prompt-budget.ts';
import { withTimeout } from '../../../shared/utils/with-timeout.ts';
import { logWarn } from '../../../shared/utils/logger.ts';
import type { SqlDatabaseBinding } from '../../../shared/types/bindings.ts';
import { D1CheckpointSaver } from './graph-checkpointer.ts';
import {
  extractMessageText,
  stringifyToolResult,
  createLangChainTool,
  generateToolCallId,
  anySignal,
  throwIfAborted,
  type CreateAgentOptions,
} from './graph-tools.ts';

// ── Message limits for Workers memory safety (128MB heap) ───────────────

const MAX_MESSAGES_IN_MEMORY = 500;
const MAX_ESTIMATED_TOKENS = 100000;
const MAX_CONSECUTIVE_ERRORS = 10;

function estimateMessageTokens(msg: BaseMessage): number {
  return estimateTokens(extractMessageText(msg.content));
}

export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (existing, incoming) => {
      const merged = messagesStateReducer(existing, incoming);
      if (!merged || merged.length === 0) return [];

      let totalTokens = 0;
      for (const msg of merged) {
        totalTokens += estimateMessageTokens(msg);
      }

      const needsTruncation = merged.length > MAX_MESSAGES_IN_MEMORY ||
                              totalTokens > MAX_ESTIMATED_TOKENS;

      if (!needsTruncation) return merged;

      // Always preserve the first system message (initial instructions)
      const firstSystemMsg = merged.find(m => m instanceof SystemMessage) ?? null;

      let keepCount = MAX_MESSAGES_IN_MEMORY;
      if (totalTokens > MAX_ESTIMATED_TOKENS) {
        const ratio = MAX_ESTIMATED_TOKENS / totalTokens;
        keepCount = Math.max(10, Math.floor(merged.length * ratio));
      }

      if (firstSystemMsg) {
        const recentMsgs = merged.slice(-(keepCount - 1));
        const recentWithoutFirstSystem = recentMsgs.filter(
          msg => msg !== firstSystemMsg
        );
        return [firstSystemMsg, ...recentWithoutFirstSystem];
      }

      return merged.slice(-keepCount);
    },
    default: () => [],
  }),
  iteration: Annotation<number>({
    reducer: (_, b) => b,
    default: () => 0,
  }),
  maxIterations: Annotation<number>({
    reducer: (_, b) => b,
    default: () => 10,
  }),
  consecutiveErrors: Annotation<number>({
    reducer: (_, b) => b,
    default: () => 0,
  }),
  lastToolResultHash: Annotation<string>({
    reducer: (_, b) => b,
    default: () => '',
  }),
  consecutiveSameResults: Annotation<number>({
    reducer: (_, b) => b,
    default: () => 0,
  }),
});

export type AgentStateType = typeof AgentState.State;

// ── Agent factory ───────────────────────────────────────────────────────

export function createLangGraphAgent(options: CreateAgentOptions) {
  const {
    apiKey,
    model = DEFAULT_MODEL_ID,
    temperature = 0.7,
    systemPrompt,
    tools,
    toolExecutor,
    db,
    maxIterations = 10,
    abortSignal,
  } = options;

  const langChainTools = tools.map(t => createLangChainTool(t, toolExecutor));

  const llm = new ChatOpenAI({
    openAIApiKey: apiKey,
    modelName: model,
    temperature,
    configuration: {
      apiKey: apiKey,
    },
  }).bindTools(langChainTools);

  const LLM_MAX_RETRIES = 3;
  const LLM_INITIAL_DELAY = 1000;
  const LLM_MAX_DELAY = 30000;
  const LLM_CALL_TIMEOUT_MS = 2 * 60 * 1000; // 2 min per LLM invocation

  const agentNode = async (state: AgentStateType) => {
    throwIfAborted(abortSignal, 'langgraph-agent-node');
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < LLM_MAX_RETRIES; attempt++) {
      try {
        const response = await withTimeout(
          (timeoutSignal) => {
            const signal = abortSignal && timeoutSignal
              ? anySignal([abortSignal, timeoutSignal])
              : abortSignal || timeoutSignal;
            return llm.invoke(state.messages, signal ? { signal } : undefined);
          },
          LLM_CALL_TIMEOUT_MS,
          `LLM call timed out after ${LLM_CALL_TIMEOUT_MS / 1000}s`,
        );
        return {
          messages: [response],
          iteration: state.iteration + 1,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const errorMsg = lastError.message.toLowerCase();

        // Don't retry on certain errors (auth, invalid request)
        if (errorMsg.includes('401') ||
            errorMsg.includes('403') ||
            errorMsg.includes('invalid_api_key') ||
            errorMsg.includes('invalid_request')) {
          throw lastError;
        }

        if (attempt < LLM_MAX_RETRIES - 1) {
          // Use longer base delay for 429 rate-limit responses
          const is429 = errorMsg.includes('429') ||
            errorMsg.includes('rate_limit') ||
            errorMsg.includes('too many requests');
          const baseDelay = is429 ? LLM_INITIAL_DELAY * 5 : LLM_INITIAL_DELAY;
          const exponential = Math.min(baseDelay * Math.pow(2, attempt), LLM_MAX_DELAY);
          // Full jitter (0–100% of exponential) to prevent thundering-herd across concurrent runs
          const delay = Math.floor(Math.random() * exponential);
          logWarn(`LLM API error (attempt ${attempt + 1}/${LLM_MAX_RETRIES}${is429 ? ', rate-limited' : ''}), retrying in ${delay}ms`, { module: 'services/agent/graph-agent' });
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw new ServiceUnavailableError(`LLM API failed after ${LLM_MAX_RETRIES} retries: ${lastError?.message || 'Unknown error'}`);
  };

  let toolCallCounter = 0;

  const MAX_TOOL_RESULT_SIZE = 1024 * 1024;
  const MAX_ERROR_MESSAGE_SIZE = 10000;
  const MAX_CONSECUTIVE_SAME_RESULTS = 5;

  // FNV-1a 32-bit hash with length suffix to reduce collisions.
  // Sampling head+tail for long strings (faster than scanning 10k chars).
  const simpleHash = (str: string): string => {
    const sample = str.length > 10000
      ? str.slice(0, 5000) + str.slice(-5000)
      : str;
    let h = 2166136261; // FNV-1a offset basis
    for (let i = 0; i < sample.length; i++) {
      h ^= sample.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0; // FNV prime, keep unsigned 32-bit
    }
    // Append length so strings of different lengths never collide
    return (h >>> 0).toString(36) + '_' + str.length.toString(36);
  };

  const truncateContent = (content: string, maxSize: number, label: string): string => {
    if (content.length <= maxSize) return content;
    return content.slice(0, maxSize) + `\n\n[${label} truncated: ${content.length} chars -> ${maxSize} chars]`;
  };

  const toolNode = async (state: AgentStateType) => {
    const lastMessage = state.messages[state.messages.length - 1];
    if (!lastMessage || !('tool_calls' in lastMessage)) {
      return { messages: [], consecutiveErrors: 0, consecutiveSameResults: 0 };
    }

    const aiMessage = lastMessage as AIMessage;
    const toolCalls = aiMessage.tool_calls || [];
    if (!Array.isArray(toolCalls)) {
      logWarn('tool_calls is not an array, skipping tool execution', { module: 'services/agent/graph-agent' });
      return { messages: [], consecutiveErrors: state.consecutiveErrors + 1, consecutiveSameResults: 0 };
    }

    const toolMessages: ToolMessage[] = [];
    let hasError = false;
    const resultContents: string[] = [];

    for (const toolCall of toolCalls) {
      toolCallCounter = (toolCallCounter + 1) % 10000;

      const toolCallId = toolCall.id && toolCall.id.trim() !== ''
        ? toolCall.id
        : generateToolCallId(toolCallCounter);

      if (!toolCallId) {
        logWarn('Failed to generate tool call ID, skipping this tool call', { module: 'services/agent/graph-agent' });
        hasError = true;
        continue;
      }

      const tool = langChainTools.find(t => t.name === toolCall.name);
      if (tool) {
        try {
          const result = await tool.invoke(toolCall.args);
          const content = truncateContent(
            stringifyToolResult(result),
            MAX_TOOL_RESULT_SIZE,
            'Output'
          );
          resultContents.push(content);
          toolMessages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              content,
            })
          );
        } catch (error) {
          hasError = true;
          const truncatedError = truncateContent(String(error), MAX_ERROR_MESSAGE_SIZE, 'Error');
          toolMessages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              content: `Error executing tool "${toolCall.name}": ${truncatedError}`,
            })
          );
        }
      } else {
        hasError = true;
        const availableToolNames = langChainTools.map(t => t.name).join(', ');
        toolMessages.push(
          new ToolMessage({
            tool_call_id: toolCallId,
            content: `Error: Tool "${toolCall.name}" not found. Available tools: ${availableToolNames}`,
          })
        );
      }
    }

    const newConsecutiveErrors = hasError ? state.consecutiveErrors + 1 : 0;

    const combinedResultHash = simpleHash(resultContents.join('|'));
    let newConsecutiveSameResults = 0;

    if (!hasError && resultContents.length > 0) {
      if (combinedResultHash === state.lastToolResultHash) {
        newConsecutiveSameResults = state.consecutiveSameResults + 1;
        if (newConsecutiveSameResults >= MAX_CONSECUTIVE_SAME_RESULTS) {
          logWarn(`Stopping agent: ${MAX_CONSECUTIVE_SAME_RESULTS} consecutive identical tool results detected (stuck loop)`, { module: 'services/agent/graph-agent' });
        }
      } else {
        newConsecutiveSameResults = 0;
      }
    }

    return {
      messages: toolMessages,
      consecutiveErrors: newConsecutiveErrors,
      lastToolResultHash: combinedResultHash,
      consecutiveSameResults: newConsecutiveSameResults,
    };
  };

  const shouldContinue = (state: AgentStateType): 'tools' | '__end__' => {
    if (state.iteration >= state.maxIterations) {
      return '__end__';
    }

    if (state.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      logWarn(`Stopping agent: ${MAX_CONSECUTIVE_ERRORS} consecutive tool errors detected`, { module: 'services/agent/graph-agent' });
      return '__end__';
    }

    if (state.consecutiveSameResults >= MAX_CONSECUTIVE_SAME_RESULTS) {
      logWarn(`Stopping agent: ${MAX_CONSECUTIVE_SAME_RESULTS} consecutive identical results (no progress)`, { module: 'services/agent/graph-agent' });
      return '__end__';
    }

    const lastMessage = state.messages[state.messages.length - 1];

    if (lastMessage && 'tool_calls' in lastMessage) {
      const aiMessage = lastMessage as AIMessage;

      if (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
        return 'tools';
      }
    }

    return '__end__';
  };

  const graph = new StateGraph(AgentState)
    .addNode('agent', agentNode)
    .addNode('tools', toolNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', shouldContinue, {
      tools: 'tools',
      __end__: END,
    })
    .addEdge('tools', 'agent');

  const checkpointer = db ? new D1CheckpointSaver(db) : undefined;
  const compiledGraph = graph.compile(checkpointer ? { checkpointer } : undefined);

  return {
    graph: compiledGraph,
    systemPrompt,
    maxIterations,
  };
}
