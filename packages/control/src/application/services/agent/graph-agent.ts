/**
 * LangGraph Agent for Cloudflare Workers
 *
 * Uses @langchain/langgraph/web for Workers/Edge compatibility.
 * Implements a ReAct-style agent with tool calling.
 *
 * This file is the backward-compatible facade. Implementation is split into:
 *   - graph-tools.ts        : shared helpers, tool creation, public types
 *   - agent-graph.ts        : state definition, graph construction, agent factory
 *   - graph-checkpointer.ts : D1 checkpoint persistence
 */

import {
  BaseMessage,
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { RunCancelledError } from './run-lifecycle';
import { logWarn } from '../../../shared/utils/logger';

// Re-export everything from the split modules for backward compatibility
export {
  extractMessageText,
  toolParameterToZod,
  stringifyToolResult,
  anySignal,
  throwIfAborted,
  generateToolCallId,
  createLangChainTool,
  type LangGraphEvent,
  type CreateAgentOptions,
} from './graph-tools';

export {
  AgentState,
  type AgentStateType,
  createLangGraphAgent,
} from './agent-graph';

export { D1CheckpointSaver } from './graph-checkpointer';

// Import what we need for the functions that remain in this file
import { extractMessageText, throwIfAborted, type LangGraphEvent } from './graph-tools';
import { createLangGraphAgent, type AgentStateType } from './agent-graph';
import type { DbMessageOutput } from './message-utils';

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
              logWarn('tool_calls is not an array, skipping', { module: 'services/agent/graph-agent' });
            } else {
              aiMsg.tool_calls = parsed.map((tc: SerializedToolCall) => ({
                id: tc.id || '',
                name: tc.name,
                args: tc.arguments || tc.args || {},
                type: 'tool_call' as const,
              }));
            }
          } catch {
            logWarn('Failed to parse tool_calls JSON', { module: 'services/agent/graph-agent' });
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
