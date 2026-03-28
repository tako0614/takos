export type ModelProvider = 'openai' | 'anthropic' | 'google';

export type ModelOption = {
  id: string;
  name: string;
  description?: string;
};

export const OPENAI_MODELS: ReadonlyArray<ModelOption> = [
  { id: 'gpt-5.4-nano', name: 'GPT-5.4 Nano', description: 'Fast and affordable' },
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', description: 'Balanced performance' },
  { id: 'gpt-5.4', name: 'GPT-5.4', description: 'Most capable OpenAI model' },
];

export const SUPPORTED_MODEL_IDS = ['gpt-5.4-nano', 'gpt-5.4-mini', 'gpt-5.4'] as const;
export type SupportedModelId = (typeof SUPPORTED_MODEL_IDS)[number];

export const DEFAULT_MODEL_ID = OPENAI_MODELS[0].id;

export function normalizeModelId(model?: string | null): string | null {
  if (!model) return null;
  const normalized = model.toLowerCase().trim();
  return (SUPPORTED_MODEL_IDS as readonly string[]).includes(normalized) ? normalized : null;
}

export function getModelProvider(model: string): ModelProvider {
  if (model.startsWith('gpt-')) {
    return 'openai';
  }
  if (model.startsWith('claude-')) {
    return 'anthropic';
  }
  if (model.startsWith('gemini-')) {
    return 'google';
  }
  return 'openai';
}

// --- Model token limits ---

/** Max input token limits per model (used to dynamically size conversation history) */
export const MODEL_TOKEN_LIMITS: Readonly<Record<string, number>> = {
  'gpt-5.4-nano': 32_768,
  'gpt-5.4-mini': 128_000,
  'gpt-5.4': 128_000,
};

const DEFAULT_TOKEN_LIMIT = 32_768;

/** Reserved tokens: system prompt + tool definitions + completion + safety margin */
const RESERVED_TOKENS = 16_000;

export function getModelTokenLimit(model: string): number {
  return MODEL_TOKEN_LIMITS[model] ?? DEFAULT_TOKEN_LIMIT;
}

/**
 * Resolve the token budget available for conversation history.
 * `envOverrides` is a JSON string like `{"gpt-5.4":200000}` from env var MODEL_CONTEXT_WINDOWS.
 */
export function resolveHistoryTokenBudget(model: string, envOverrides?: string | null): number {
  let limit = MODEL_TOKEN_LIMITS[model] ?? DEFAULT_TOKEN_LIMIT;
  if (envOverrides) {
    try {
      const overrides = JSON.parse(envOverrides) as Record<string, unknown>;
      const val = overrides[model];
      if (typeof val === 'number' && val > 0) limit = val;
    } catch { /* ignore parse errors */ }
  }
  return Math.max(limit - RESERVED_TOKENS, 4_000);
}
