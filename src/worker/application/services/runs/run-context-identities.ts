import { stringifyCanonicalJson } from "../../../shared/utils/canonical-json.ts";
import { computeSHA256 } from "../../../shared/utils/hash.ts";

async function digest(value: string): Promise<string> {
  return `sha256:${await computeSHA256(value)}`;
}

function canonicalJson(value: unknown): string {
  const serialized = stringifyCanonicalJson(value);
  if (serialized === undefined) {
    throw new TypeError("Run context identity is not JSON serializable");
  }
  return serialized;
}

export async function computeRunInputRevision(
  runInputJson: string,
): Promise<string> {
  return await digest(runInputJson);
}

export async function computeSystemPromptRevision(
  systemPrompt: string,
): Promise<string> {
  return await digest(systemPrompt);
}

export async function computeModelRevision(modelId: string): Promise<string> {
  return await digest(canonicalJson({ modelId }));
}

export async function computeAgentProfileRevision(input: {
  agentType: string;
  systemPromptRevision: string;
  temperature: number | undefined;
  budgets: { maxGraphSteps: number; maxToolRounds: number };
}): Promise<string> {
  return await digest(canonicalJson({
    agentType: input.agentType,
    systemPromptRevision: input.systemPromptRevision,
    temperature: input.temperature,
    budgets: input.budgets,
  }));
}
