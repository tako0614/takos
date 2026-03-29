import type { LLMClient } from '../agent';
/**
 * Parse a JSON array from an LLM response string.
 * The LLM may wrap the array in markdown fences or extra text,
 * so we extract the first `[...]` match.
 */
export declare function parseJsonArrayFromLLM<T>(text: string): T[] | null;
/**
 * Send a system+user prompt to the LLM and parse the response as a JSON array.
 * Returns null when the LLM is unavailable, the response is unparseable, or the call throws.
 */
export declare function chatAndParseJsonArray<T>(llmClient: LLMClient, systemPrompt: string, userPrompt: string): Promise<T[] | null>;
//# sourceMappingURL=llm-parser.d.ts.map