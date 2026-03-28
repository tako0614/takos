/** Strip markdown code fences from an LLM response and return the JSON body. */
export function extractJsonFromLLMResponse(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) return trimmed;
  return trimmed.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
}
