/**
 * LangGraph Tool Helpers
 *
 * Shared utility functions, tool creation, and public types for the
 * LangGraph agent subsystem.
 */
import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
import type { BaseMessage } from '@langchain/core/messages';
import type { ToolExecutorLike } from '../../tools/executor';
import type { ToolDefinition, ToolParameter } from '../../tools/tool-definitions';
/** Extract string content from a BaseMessage's content field (string or structured parts). */
export declare function extractMessageText(content: BaseMessage['content']): string;
/** Convert a ToolParameter definition to a Zod schema type. */
export declare function toolParameterToZod(param: ToolParameter): z.ZodType;
/** Coerce an unknown tool invocation result into a string. */
export declare function stringifyToolResult(result: unknown): string;
export declare function anySignal(signals: AbortSignal[]): AbortSignal;
export { throwIfAborted } from 'takos-common/abort';
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
    db?: import('../../../shared/types/bindings.ts').SqlDatabaseBinding;
    maxIterations?: number;
    abortSignal?: AbortSignal;
}
/** Generate a unique tool-call ID using crypto random bytes. */
export declare function generateToolCallId(counter: number): string;
export declare function createLangChainTool(toolDef: ToolDefinition, executor: ToolExecutorLike): DynamicStructuredTool;
//# sourceMappingURL=graph-tools.d.ts.map