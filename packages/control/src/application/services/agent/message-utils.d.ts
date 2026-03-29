/**
 * Agent Message Utilities.
 *
 * Extracted from graph-agent.ts to provide reusable message
 * handling functions across agent execution engines.
 */
import type { BaseMessage } from '@langchain/core/messages';
/**
 * Extract string content from a BaseMessage's content field.
 *
 * Handles plain strings, structured content parts (text blocks),
 * and arbitrary values by falling back to JSON serialization.
 */
export declare function extractMessageText(content: BaseMessage['content']): string;
/**
 * Coerce an unknown tool invocation result into a string.
 *
 * Returns the value as-is when it is already a string, an empty string
 * for null/undefined, and a JSON representation for everything else.
 */
export declare function stringifyToolResult(result: unknown): string;
/** Shape of a persisted message row from the database. */
export interface DbMessageRow {
    role: string;
    content: string;
    tool_calls?: string | null;
    tool_call_id?: string | null;
}
/** Shape of a message row to be written back to the database. */
export interface DbMessageOutput {
    role: string;
    content: string;
    tool_calls?: string;
    tool_call_id?: string;
}
/**
 * Convert an array of persisted database message rows into LangChain
 * BaseMessage instances suitable for agent consumption.
 */
export declare function dbMessagesToLangChain(messages: DbMessageRow[]): BaseMessage[];
/**
 * Convert a LangChain BaseMessage into a plain object suitable for
 * database persistence.
 */
export declare function langChainMessageToDb(msg: BaseMessage): DbMessageOutput;
//# sourceMappingURL=message-utils.d.ts.map