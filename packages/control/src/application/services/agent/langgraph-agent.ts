/**
 * LangGraph Agent for Cloudflare Workers
 *
 * Uses @langchain/langgraph/web for Workers/Edge compatibility.
 * Implements a ReAct-style agent with tool calling.
 */

import {
  START,
  END,
  StateGraph,
  Annotation,
  messagesStateReducer,
} from '@langchain/langgraph/web';
import { ChatOpenAI } from '@langchain/openai';
import {
  BaseMessage,
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
  type PendingWrite,
  type ChannelVersions,
} from '@langchain/langgraph-checkpoint';
import type { RunnableConfig } from '@langchain/core/runnables';
import { z } from 'zod';
import type { ToolExecutorLike } from '../../tools/executor';
import { getDb, lgCheckpoints, lgWrites } from '../../../infra/db';
import { eq, and, lt, desc } from 'drizzle-orm';
import { toIsoString } from '../../../shared/utils';
import type { ToolDefinition, ToolParameter } from '../../tools/types';
import { RunCancelledError } from './run-lifecycle';
import { DEFAULT_MODEL_ID } from './model-catalog';
import { estimateTokens } from './prompt-budget';
import { withTimeout } from '../../../shared/utils/with-timeout';
import { logError, logInfo, logWarn } from '../../../shared/utils/logger';
import type { SqlDatabaseBinding } from '../../../shared/types/bindings.ts';

// ── Shared helpers ──────────────────────────────────────────────────────

/** Extract string content from a BaseMessage's content field (string or structured parts). */
function extractMessageText(content: BaseMessage['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) {
          return (part as { text: string }).text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (content !== null && content !== undefined) {
    try { return JSON.stringify(content); } catch { return String(content); }
  }
  return '';
}

/** Convert a ToolParameter definition to a Zod schema type. */
function toolParameterToZod(param: ToolParameter): z.ZodType {
  let zodType: z.ZodType;

  switch (param.type) {
    case 'string':
      zodType = param.enum
        ? z.enum(param.enum as [string, ...string[]])
        : z.string();
      break;
    case 'number':
      zodType = z.number();
      break;
    case 'boolean':
      zodType = z.boolean();
      break;
    case 'array': {
      const itemType = param.items ? toolParameterToZod(param.items) : z.string();
      zodType = z.array(itemType);
      break;
    }
    case 'object':
      zodType = z.record(z.string(), z.unknown());
      break;
    default:
      zodType = z.unknown();
  }

  if (param.description) {
    zodType = zodType.describe(param.description);
  }

  return zodType;
}

/** Coerce an unknown tool invocation result into a string. */
function stringifyToolResult(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result === null || result === undefined) return '';
  try { return JSON.stringify(result); } catch { return String(result); }
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

function throwIfAborted(signal: AbortSignal | undefined, context: string): void {
  if (!signal?.aborted) {
    return;
  }

  const reason = signal.reason;
  const message = reason instanceof Error
    ? reason.message
    : typeof reason === 'string'
      ? reason
      : 'Run aborted';
  throw new Error(`${message} (${context})`);
}

// ── Message limits for Workers memory safety (128MB heap) ───────────────

const MAX_MESSAGES_IN_MEMORY = 500;
const MAX_ESTIMATED_TOKENS = 100000;
const MAX_CONSECUTIVE_ERRORS = 10;

function estimateMessageTokens(msg: BaseMessage): number {
  return estimateTokens(extractMessageText(msg.content));
}

const AgentState = Annotation.Root({
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

type AgentStateType = typeof AgentState.State;

// ── ToolParameter → LangChain DynamicStructuredTool conversion ──────────

function createLangChainTool(
  toolDef: ToolDefinition,
  executor: ToolExecutorLike
): DynamicStructuredTool {
  const schemaProps: Record<string, z.ZodTypeAny> = {};
  const required = toolDef.parameters.required || [];

  for (const [key, param] of Object.entries(toolDef.parameters.properties)) {
    let zodType = toolParameterToZod(param);

    if (!required.includes(key)) {
      zodType = zodType.optional();
    }

    schemaProps[key] = zodType;
  }

  const schema = z.object(schemaProps);
  return new DynamicStructuredTool({
    name: toolDef.name,
    description: toolDef.description,
     
    schema: schema as z.ZodObject<Record<string, z.ZodTypeAny>>,
    func: async (args: Record<string, unknown>) => {
      const result = await executor.execute({
        id: generateToolCallId(0),
        name: toolDef.name,
        arguments: args,
      });

      if (result.error) {
        return `Error: ${result.error}`;
      }
      return result.output;
    },
  });
}

// ── Public types ────────────────────────────────────────────────────────

export interface LangGraphEvent {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'message' | 'completed' | 'error' | 'progress';
  data: Record<string, unknown>;
}

export interface CreateAgentOptions {
  apiKey: string;
  model?: string;
  temperature?: number;
  systemPrompt: string;
  tools: ToolDefinition[];
  toolExecutor: ToolExecutorLike;
  db?: SqlDatabaseBinding;
  maxIterations?: number;
  abortSignal?: AbortSignal;
}

/** Generate a unique tool-call ID using crypto random bytes. */
function generateToolCallId(counter: number): string {
  const idBytes = new Uint8Array(8);
  crypto.getRandomValues(idBytes);
  return `call_${Date.now()}_${counter}_${Array.from(idBytes, b => b.toString(16).padStart(2, '0')).join('')}`;
}

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
          logWarn(`LLM API error (attempt ${attempt + 1}/${LLM_MAX_RETRIES}${is429 ? ', rate-limited' : ''}), retrying in ${delay}ms`, { module: 'services/agent/langgraph-agent' });
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(`LLM API failed after ${LLM_MAX_RETRIES} retries: ${lastError?.message || 'Unknown error'}`);
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
      logWarn('tool_calls is not an array, skipping tool execution', { module: 'services/agent/langgraph-agent' });
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
        logError('Failed to generate tool call ID, skipping this tool call', undefined, { module: 'services/agent/langgraph-agent' });
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
          logWarn(`Stopping agent: ${MAX_CONSECUTIVE_SAME_RESULTS} consecutive identical tool results detected (stuck loop)`, { module: 'services/agent/langgraph-agent' });
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
      logWarn(`Stopping agent: ${MAX_CONSECUTIVE_ERRORS} consecutive tool errors detected`, { module: 'services/agent/langgraph-agent' });
      return '__end__';
    }

    if (state.consecutiveSameResults >= MAX_CONSECUTIVE_SAME_RESULTS) {
      logWarn(`Stopping agent: ${MAX_CONSECUTIVE_SAME_RESULTS} consecutive identical results (no progress)`, { module: 'services/agent/langgraph-agent' });
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

// ── Runner ──────────────────────────────────────────────────────────────

export interface RunLangGraphOptions {
  agent: ReturnType<typeof createLangGraphAgent>;
  threadId: string;
  input: string;
  history?: BaseMessage[];
  onEvent?: (event: LangGraphEvent) => void | Promise<void>;
  /** Called for each new message during the stream - allows incremental message persistence */
  onMessage?: (message: BaseMessage) => void | Promise<void>;
  shouldCancel?: () => boolean | Promise<boolean>;
  abortSignal?: AbortSignal;
}

export async function runLangGraph(options: RunLangGraphOptions): Promise<{
  response: string;
  messages: BaseMessage[];
  iterations: number;
}> {
  const { agent, threadId, input, history = [], onEvent, onMessage, shouldCancel, abortSignal } = options;

  const messages: BaseMessage[] = [
    new SystemMessage(agent.systemPrompt),
    ...history,
    new HumanMessage(input),
  ];

  const initialState = {
    messages,
    iteration: 0,
    maxIterations: agent.maxIterations,
  };

  const config = {
    configurable: {
      thread_id: threadId,
    },
  };

  let finalState = initialState;
  let lastIteration = 0;

  const calculatedLimit = (agent.maxIterations * 2) + 5;
  const recursionLimit = Math.min(calculatedLimit, 1000);

  for await (const event of await agent.graph.stream(initialState, {
    ...config,
    streamMode: 'updates' as const,
    recursionLimit,
  })) {
    throwIfAborted(abortSignal, 'langgraph-stream');
    if (shouldCancel && await shouldCancel()) {
      throw new RunCancelledError();
    }
    for (const [nodeName, nodeOutput] of Object.entries(event)) {
      const output = nodeOutput as Partial<AgentStateType>;

      if (nodeName === 'agent' && output.messages) {
        const lastMsg = output.messages[output.messages.length - 1];

        if (lastMsg && 'tool_calls' in lastMsg) {
          const aiMsg = lastMsg as AIMessage;
          if (aiMsg.tool_calls && aiMsg.tool_calls.length > 0) {
            for (const tc of aiMsg.tool_calls) {
              await onEvent?.({
                type: 'tool_call',
                data: { tool: tc.name, arguments: tc.args, tool_call_id: tc.id },
              });
            }
          } else if (aiMsg.content) {
            await onEvent?.({
              type: 'message',
              data: { content: aiMsg.content },
            });
          }
        }

        await onEvent?.({
          type: 'thinking',
          data: {
            iteration: output.iteration ?? lastIteration + 1,
            message: `Thinking (step ${output.iteration ?? lastIteration + 1})...`,
          },
        });
        lastIteration = output.iteration ?? lastIteration + 1;
      }

      if (nodeName === 'tools' && output.messages) {
        for (const msg of output.messages) {
          if (msg instanceof ToolMessage) {
            await onEvent?.({
              type: 'tool_result',
              data: {
                tool_call_id: msg.tool_call_id,
                output: msg.content,
              },
            });
          }
        }
      }

      if (output.messages) {
        for (const msg of output.messages) {
          await onMessage?.(msg);
        }
      }

      if (output) {
        finalState = {
          ...finalState,
          ...output,
          messages: [
            ...finalState.messages,
            ...(output.messages || []),
          ],
        };
      }
    }
  }

  const lastMessage = finalState.messages[finalState.messages.length - 1];
  const response = lastMessage && 'content' in lastMessage
    ? extractMessageText(lastMessage.content)
    : '';

  await onEvent?.({
    type: 'completed',
    data: {
      status: 'completed',
      success: true,
      iterations: lastIteration,
    },
  });

  return {
    response,
    messages: finalState.messages,
    iterations: lastIteration,
  };
}

// ── DB ↔ LangChain message conversion ──────────────────────────────────

/** Shape of a persisted message row from the database. */
interface DbMessageRow {
  role: string;
  content: string;
  tool_calls?: string | null;
  tool_call_id?: string | null;
}

/** Shape of a serialized tool call stored in the database. */
interface SerializedToolCall {
  id?: string;
  name: string;
  arguments?: Record<string, unknown>;
  args?: Record<string, unknown>;
}

export function dbMessagesToLangChain(messages: DbMessageRow[]): BaseMessage[] {
  return messages.map(msg => {
    switch (msg.role) {
      case 'system':
        return new SystemMessage(msg.content);
      case 'user':
      default:
        return new HumanMessage(msg.content);
      case 'assistant': {
        const aiMsg = new AIMessage(msg.content);
        if (msg.tool_calls) {
          try {
            const parsed = JSON.parse(msg.tool_calls);
            if (!Array.isArray(parsed)) {
              logWarn('tool_calls is not an array, skipping', { module: 'services/agent/langgraph-agent' });
            } else {
              aiMsg.tool_calls = parsed.map((tc: SerializedToolCall) => ({
                id: tc.id || '',
                name: tc.name,
                args: tc.arguments || tc.args || {},
                type: 'tool_call' as const,
              }));
            }
          } catch {
            logWarn('Failed to parse tool_calls JSON', { module: 'services/agent/langgraph-agent' });
          }
        }
        return aiMsg;
      }
      case 'tool':
        return new ToolMessage({
          content: msg.content,
          tool_call_id: msg.tool_call_id || '',
        });
    }
  });
}

/** Shape of a message row to be written back to the database. */
interface DbMessageOutput {
  role: string;
  content: string;
  tool_calls?: string;
  tool_call_id?: string;
}

export function langChainMessageToDb(msg: BaseMessage): DbMessageOutput {
  const content = extractMessageText(msg.content);

  if (msg instanceof SystemMessage) {
    return { role: 'system', content };
  }

  if (msg instanceof HumanMessage) {
    return { role: 'user', content };
  }

  if (msg instanceof AIMessage) {
    const result: DbMessageOutput = {
      role: 'assistant',
      content,
    };
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      const normalizedToolCalls = msg.tool_calls.map(tc => ({
        id: tc.id || '',
        name: tc.name,
        arguments: tc.args || {},
      }));
      result.tool_calls = JSON.stringify(normalizedToolCalls);
    }
    return result;
  }

  if (msg instanceof ToolMessage) {
    return {
      role: 'tool',
      content,
      tool_call_id: msg.tool_call_id,
    };
  }

  return { role: 'user', content };
}

// ── D1 Checkpointer (merged from d1-checkpointer.ts) ──────────

/** Extract a human-readable message from an unknown error. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const MIN_CHECKPOINT_LIMIT = 1;
const MAX_CHECKPOINT_LIMIT = 1000;
const DEFAULT_CHECKPOINT_LIMIT = 50;

/** Validate and bound the limit parameter to a safe integer range. */
function validateLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isInteger(limit) || !Number.isFinite(limit)) {
    return DEFAULT_CHECKPOINT_LIMIT;
  }
  return Math.max(MIN_CHECKPOINT_LIMIT, Math.min(MAX_CHECKPOINT_LIMIT, limit));
}

interface LangGraphConfigurable {
  thread_id?: string;
  checkpoint_ns?: string;
  checkpoint_id?: string;
  session_id?: string;
  snapshot_id?: string;
}

interface ConfigurableRunnableConfig extends RunnableConfig {
  configurable?: LangGraphConfigurable;
}

function hasConfigurable(config: RunnableConfig): config is ConfigurableRunnableConfig {
  return config != null && typeof config === 'object' && 'configurable' in config;
}

function getConfigurable(config: RunnableConfig): LangGraphConfigurable {
  if (hasConfigurable(config) && config.configurable) {
    return config.configurable;
  }
  return {};
}

function toBase64(u8: Uint8Array): string {
  let s = '';
  for (const c of u8) s += String.fromCharCode(c);
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

function getThreadConfig(config: RunnableConfig): {
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string | null;
  session_id: string | null;
  snapshot_id: string | null;
} {
  const c = getConfigurable(config);
  const thread_id = c.thread_id;
  if (!thread_id) throw new Error('configurable.thread_id is required');
  const checkpoint_ns = c.checkpoint_ns ?? '';
  const checkpoint_id = c.checkpoint_id ?? null;
  const session_id = c.session_id ?? null;
  const snapshot_id = c.snapshot_id ?? null;
  return { thread_id, checkpoint_ns, checkpoint_id, session_id, snapshot_id };
}

/**
 * D1 Checkpoint Saver for LangGraph
 */
export class D1CheckpointSaver extends BaseCheckpointSaver<number> {
  constructor(private db: SqlDatabaseBinding) {
    super();
  }

  /** Delete all checkpoints and writes for a thread. */
  async deleteThread(threadId: string): Promise<void> {
    try {
      const db = getDb(this.db);
      await db.delete(lgWrites).where(eq(lgWrites.threadId, threadId));
      await db.delete(lgCheckpoints).where(eq(lgCheckpoints.threadId, threadId));
    } catch (error) {
      const errorMsg = errorMessage(error);
      throw new Error(`Failed to delete thread checkpoints: ${errorMsg}`);
    }
  }

  /**
   * Attempt to recover from checkpoint corruption.
   * Identifies and removes corrupted pending writes, or resets to parent checkpoint
   * if the core checkpoint data itself is corrupted.
   */
  async recoverCorruptedCheckpoint(
    threadId: string,
    checkpointNs: string = '',
    checkpointId?: string
  ): Promise<{
    recovered: boolean;
    cleanedWrites: number;
    resetToParent: boolean;
    error?: string;
  }> {
    try {
      const db = getDb(this.db);

      const row = checkpointId
        ? await db.select().from(lgCheckpoints).where(
            and(
              eq(lgCheckpoints.threadId, threadId),
              eq(lgCheckpoints.checkpointNs, checkpointNs),
              eq(lgCheckpoints.checkpointId, checkpointId),
            )
          ).get()
        : await db.select().from(lgCheckpoints).where(
            and(
              eq(lgCheckpoints.threadId, threadId),
              eq(lgCheckpoints.checkpointNs, checkpointNs),
            )
          ).orderBy(desc(lgCheckpoints.ts)).get();

      if (!row) {
        return { recovered: false, cleanedWrites: 0, resetToParent: false, error: 'Checkpoint not found' };
      }

      try {
        await this.serde.loadsTyped(row.checkpointType, fromBase64(row.checkpointData));
      } catch {
        logError(`Core checkpoint ${row.checkpointId} is corrupted, resetting to parent`, undefined, { module: 'd1checkpointer' });

        if (row.parentCheckpointId) {
          // Delete this corrupted checkpoint and its writes
          await db.delete(lgWrites).where(
            and(
              eq(lgWrites.threadId, threadId),
              eq(lgWrites.checkpointId, row.checkpointId),
            )
          );
          await db.delete(lgCheckpoints).where(
            and(
              eq(lgCheckpoints.threadId, threadId),
              eq(lgCheckpoints.checkpointNs, checkpointNs),
              eq(lgCheckpoints.checkpointId, row.checkpointId),
            )
          );

          return {
            recovered: true,
            cleanedWrites: 0,
            resetToParent: true,
            error: `Corrupted checkpoint deleted, will resume from parent: ${row.parentCheckpointId}`,
          };
        } else {
          return {
            recovered: false,
            cleanedWrites: 0,
            resetToParent: false,
            error: 'Root checkpoint is corrupted and cannot be recovered',
          };
        }
      }

      const writes = await db.select({
        taskId: lgWrites.taskId,
        channel: lgWrites.channel,
        valueType: lgWrites.valueType,
        valueData: lgWrites.valueData,
      }).from(lgWrites).where(
        and(
          eq(lgWrites.threadId, threadId),
          eq(lgWrites.checkpointNs, checkpointNs),
          eq(lgWrites.checkpointId, row.checkpointId),
        )
      ).all();

      const corruptedWrites: Array<{ taskId: string; channel: string }> = [];

      for (const w of writes) {
        try {
          await this.serde.loadsTyped(w.valueType, fromBase64(w.valueData));
        } catch {
          corruptedWrites.push({ taskId: w.taskId, channel: w.channel });
        }
      }

      if (corruptedWrites.length === 0) {
        return { recovered: true, cleanedWrites: 0, resetToParent: false };
      }

      for (const write of corruptedWrites) {
        await db.delete(lgWrites).where(
          and(
            eq(lgWrites.threadId, threadId),
            eq(lgWrites.checkpointNs, checkpointNs),
            eq(lgWrites.checkpointId, row.checkpointId),
            eq(lgWrites.taskId, write.taskId),
            eq(lgWrites.channel, write.channel),
          )
        );
      }

      logInfo(`Recovered checkpoint ${row.checkpointId}: ` +
        `deleted ${corruptedWrites.length} corrupted writes from channels: ${corruptedWrites.map(w => w.channel).join(', ')}`, { module: 'd1checkpointer' });

      return {
        recovered: true,
        cleanedWrites: corruptedWrites.length,
        resetToParent: false,
      };
    } catch (error) {
      const errorMsg = errorMessage(error);
      return {
        recovered: false,
        cleanedWrites: 0,
        resetToParent: false,
        error: `Recovery failed: ${errorMsg}`,
      };
    }
  }

  /** Validate that the parent checkpoint exists and belongs to the same thread. */
  private async validateAncestry(
    threadId: string,
    checkpointNs: string,
    parentCheckpointId: string | null
  ): Promise<{ valid: boolean; error?: string }> {
    if (!parentCheckpointId) return { valid: true };

    try {
      const db = getDb(this.db);
      const parent = await db.select({
        checkpointId: lgCheckpoints.checkpointId,
        threadId: lgCheckpoints.threadId,
        checkpointNs: lgCheckpoints.checkpointNs,
      }).from(lgCheckpoints).where(
        and(
          eq(lgCheckpoints.threadId, threadId),
          eq(lgCheckpoints.checkpointNs, checkpointNs),
          eq(lgCheckpoints.checkpointId, parentCheckpointId),
        )
      ).get();

      if (!parent) {
        return {
          valid: false,
          error: `Parent checkpoint ${parentCheckpointId} not found for thread ${threadId}`,
        };
      }

      if (parent.threadId !== threadId || parent.checkpointNs !== checkpointNs) {
        return {
          valid: false,
          error: `Parent checkpoint ${parentCheckpointId} belongs to different thread/namespace`,
        };
      }

      return { valid: true };
    } catch (error) {
      const errorMsg = errorMessage(error);
      return { valid: false, error: `Ancestry validation failed: ${errorMsg}` };
    }
  }

  /** Save a checkpoint. Validates ancestry before saving. */
  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions
  ): Promise<RunnableConfig<Record<string, any>>> {
    const { thread_id, checkpoint_ns, session_id, snapshot_id } = getThreadConfig(config);
    const configurable = getConfigurable(config);
    const parent_checkpoint_id = configurable.checkpoint_id ?? null;

    try {
      const db = getDb(this.db);

      const ancestryResult = await this.validateAncestry(thread_id, checkpoint_ns, parent_checkpoint_id);
      if (!ancestryResult.valid) {
        logWarn(`Ancestry validation warning: ${ancestryResult.error}`, { module: 'd1checkpointer' });
      }

      const [ckType, ckBytes] = await this.serde.dumpsTyped(checkpoint);
      const [mdType, mdBytes] = await this.serde.dumpsTyped(metadata);

      const data = {
        threadId: thread_id,
        checkpointNs: checkpoint_ns,
        checkpointId: checkpoint.id,
        parentCheckpointId: parent_checkpoint_id,
        ts: checkpoint.ts,
        checkpointType: ckType,
        checkpointData: toBase64(new Uint8Array(ckBytes)),
        metadataType: mdType,
        metadataData: toBase64(new Uint8Array(mdBytes)),
        sessionId: session_id,
        snapshotId: snapshot_id,
      };

      await db.insert(lgCheckpoints).values(data).onConflictDoUpdate({
        target: [lgCheckpoints.threadId, lgCheckpoints.checkpointNs, lgCheckpoints.checkpointId],
        set: {
          parentCheckpointId: parent_checkpoint_id,
          ts: checkpoint.ts,
          checkpointType: ckType,
          checkpointData: toBase64(new Uint8Array(ckBytes)),
          metadataType: mdType,
          metadataData: toBase64(new Uint8Array(mdBytes)),
          sessionId: session_id,
          snapshotId: snapshot_id,
        },
      });

      return {
        ...config,
        configurable: {
          ...configurable,
          thread_id,
          checkpoint_ns,
          checkpoint_id: checkpoint.id,
          session_id,
          snapshot_id,
        },
      };
    } catch (error) {
      const errorMsg = errorMessage(error);
      throw new Error(`Failed to save checkpoint: ${errorMsg}`);
    }
  }

  /** Save pending writes for a checkpoint. */
  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const { thread_id, checkpoint_ns, checkpoint_id } = getThreadConfig(config);
    if (!checkpoint_id) throw new Error('configurable.checkpoint_id is required for putWrites');

    try {
      const db = getDb(this.db);

      for (const [channel, value] of writes) {
        const [vType, vBytes] = await this.serde.dumpsTyped(value);

        await db.insert(lgWrites).values({
          threadId: thread_id,
          checkpointNs: checkpoint_ns,
          checkpointId: checkpoint_id,
          taskId,
          channel: String(channel),
          valueType: vType,
          valueData: toBase64(new Uint8Array(vBytes)),
        }).onConflictDoUpdate({
          target: [lgWrites.threadId, lgWrites.checkpointNs, lgWrites.checkpointId, lgWrites.taskId, lgWrites.channel],
          set: {
            valueType: vType,
            valueData: toBase64(new Uint8Array(vBytes)),
          },
        });
      }
    } catch (error) {
      const errorMsg = errorMessage(error);
      throw new Error(`Failed to save pending writes: ${errorMsg}`);
    }
  }

  /** Get a checkpoint tuple by config. */
  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const { thread_id, checkpoint_ns, checkpoint_id } = getThreadConfig(config);

    try {
      const db = getDb(this.db);

      const row = checkpoint_id
        ? await db.select().from(lgCheckpoints).where(
            and(
              eq(lgCheckpoints.threadId, thread_id),
              eq(lgCheckpoints.checkpointNs, checkpoint_ns),
              eq(lgCheckpoints.checkpointId, checkpoint_id),
            )
          ).get()
        : await db.select().from(lgCheckpoints).where(
            and(
              eq(lgCheckpoints.threadId, thread_id),
              eq(lgCheckpoints.checkpointNs, checkpoint_ns),
            )
          ).orderBy(desc(lgCheckpoints.ts)).get();

      if (!row) return undefined;

      const checkpoint = await this.serde.loadsTyped(
        row.checkpointType,
        fromBase64(row.checkpointData)
      ) as Checkpoint;

      const metadata = row.metadataType && row.metadataData
        ? (await this.serde.loadsTyped(row.metadataType, fromBase64(row.metadataData)) as CheckpointMetadata)
        : undefined;

      const writes = await db.select({
        taskId: lgWrites.taskId,
        channel: lgWrites.channel,
        valueType: lgWrites.valueType,
        valueData: lgWrites.valueData,
      }).from(lgWrites).where(
        and(
          eq(lgWrites.threadId, thread_id),
          eq(lgWrites.checkpointNs, checkpoint_ns),
          eq(lgWrites.checkpointId, checkpoint.id),
        )
      ).all();

      const pendingWrites: [string, string, unknown][] = [];
      let corruptedWriteCount = 0;
      const corruptedChannels: string[] = [];

      for (const w of writes) {
        try {
          const val = await this.serde.loadsTyped(w.valueType, fromBase64(w.valueData));
          pendingWrites.push([w.taskId, w.channel, val]);
        } catch (writeError) {
          corruptedWriteCount++;
          corruptedChannels.push(w.channel);
          logWarn(`Failed to deserialize pending write for channel ${w.channel}`, { module: 'services/agent/d1-checkpointer', detail: writeError });
        }
      }

      if (corruptedWriteCount > 0) {
        logError(`Checkpoint ${checkpoint.id} has ${corruptedWriteCount} corrupted pending writes. ` +
          `Affected channels: ${corruptedChannels.join(', ')}. ` +
          `This may indicate data corruption and could affect agent state consistency.`, undefined, { module: 'd1checkpointer' });
      }

      const configurable = getConfigurable(config);

      const enhancedMetadata = corruptedWriteCount > 0
        ? {
            ...metadata,
            _checkpointWarning: {
              corruptedWriteCount,
              corruptedChannels,
              message: 'Some pending writes could not be deserialized',
            },
          }
        : metadata;

      return {
        checkpoint,
        config: {
          ...config,
          configurable: {
            ...configurable,
            thread_id,
            checkpoint_ns,
            checkpoint_id: checkpoint.id,
          },
        },
        metadata: enhancedMetadata as CheckpointMetadata,
        parentConfig: row.parentCheckpointId
          ? { configurable: { thread_id, checkpoint_ns, checkpoint_id: row.parentCheckpointId } }
          : undefined,
        pendingWrites,
      };
    } catch (error) {
      const errorMsg = errorMessage(error);
      throw new Error(`Failed to get checkpoint tuple: ${errorMsg}`);
    }
  }

  /** List checkpoints for a thread. The limit parameter is validated and bounded. */
  async *list(
    config: RunnableConfig,
    options?: { limit?: number; before?: RunnableConfig }
  ): AsyncGenerator<CheckpointTuple> {
    const { thread_id, checkpoint_ns } = getThreadConfig(config);
    const limit = validateLimit(options?.limit);

    try {
      const db = getDb(this.db);

      let beforeTs: string | undefined;

      if (options?.before) {
        const beforeConfig = getThreadConfig(options.before);
        if (beforeConfig.checkpoint_id) {
          const beforeRow = await db.select({
            ts: lgCheckpoints.ts,
          }).from(lgCheckpoints).where(
            and(
              eq(lgCheckpoints.threadId, thread_id),
              eq(lgCheckpoints.checkpointNs, checkpoint_ns),
              eq(lgCheckpoints.checkpointId, beforeConfig.checkpoint_id),
            )
          ).get();

          if (beforeRow) {
            beforeTs = toIsoString(beforeRow.ts) ?? undefined;
          }
        }
      }

      const conditions = [
        eq(lgCheckpoints.threadId, thread_id),
        eq(lgCheckpoints.checkpointNs, checkpoint_ns),
      ];
      if (beforeTs) {
        conditions.push(lt(lgCheckpoints.ts, beforeTs));
      }

      const rows = await db.select().from(lgCheckpoints)
        .where(and(...conditions))
        .orderBy(desc(lgCheckpoints.ts))
        .limit(limit)
        .all();

      for (const row of rows) {
        try {
          const tuple = await this.getTuple({
            configurable: { thread_id, checkpoint_ns, checkpoint_id: row.checkpointId },
          } as RunnableConfig);
          if (tuple) yield tuple;
        } catch (tupleError) {
          logWarn(`Failed to get tuple for checkpoint ${row.checkpointId}`, { module: 'services/agent/d1-checkpointer', detail: tupleError });
        }
      }
    } catch (error) {
      const errorMsg = errorMessage(error);
      throw new Error(`Failed to list checkpoints: ${errorMsg}`);
    }
  }
}
