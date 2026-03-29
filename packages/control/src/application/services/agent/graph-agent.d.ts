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
import { BaseMessage } from '@langchain/core/messages';
export { extractMessageText, toolParameterToZod, stringifyToolResult, anySignal, throwIfAborted, generateToolCallId, createLangChainTool, type LangGraphEvent, type CreateAgentOptions, } from './graph-tools';
export { AgentState, type AgentStateType, createLangGraphAgent, } from './agent-graph';
export { D1CheckpointSaver } from './graph-checkpointer';
import { type LangGraphEvent } from './graph-tools';
import { createLangGraphAgent } from './agent-graph';
import type { DbMessageOutput } from './message-utils';
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
export declare function runLangGraph(options: RunLangGraphOptions): Promise<{
    response: string;
    messages: BaseMessage[];
    iterations: number;
}>;
/** Shape of a persisted message row from the database. */
interface DbMessageRow {
    role: string;
    content: string;
    tool_calls?: string | null;
    tool_call_id?: string | null;
}
export declare function dbMessagesToLangChain(messages: DbMessageRow[]): BaseMessage[];
export declare function langChainMessageToDb(msg: BaseMessage): DbMessageOutput;
//# sourceMappingURL=graph-agent.d.ts.map