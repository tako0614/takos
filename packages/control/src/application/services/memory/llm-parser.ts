import { logError } from "../../../shared/utils/logger.ts";
import type { LLMClient } from "../agent/index.ts";

const JSON_ARRAY_PATTERN = /\[[\s\S]*\]/;

/**
 * Parse a JSON array from an LLM response string.
 * The LLM may wrap the array in markdown fences or extra text,
 * so we extract the first `[...]` match.
 */
export function parseJsonArrayFromLLM<T>(text: string): T[] | null {
  const match = text.match(JSON_ARRAY_PATTERN);
  if (!match) return null;

  try {
    return JSON.parse(match[0]) as T[];
  } catch {
    return null;
  }
}

/**
 * Send a system+user prompt to the LLM and parse the response as a JSON array.
 * Returns null when the LLM is unavailable, the response is unparseable, or the call throws.
 */
export async function chatAndParseJsonArray<T>(
  llmClient: LLMClient,
  systemPrompt: string,
  userPrompt: string,
): Promise<T[] | null> {
  try {
    const response = await llmClient.chat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      [],
    );
    return parseJsonArrayFromLLM<T>(response.content);
  } catch (error) {
    logError("LLM call failed", error, {
      module: "services/memory/llm-parser",
    });
    return null;
  }
}
