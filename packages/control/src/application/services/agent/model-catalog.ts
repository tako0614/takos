export type ModelProvider = 'openai' | 'anthropic' | 'google';

export type ModelOption = {
  id: string;
  name: string;
  description?: string;
};

export const OPENAI_MODELS: ReadonlyArray<ModelOption> = [
  { id: 'gpt-5.4-nano', name: 'GPT-5.4 Nano', description: 'Fast and affordable' },
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', description: 'Most capable OpenAI model' },
];

export const SUPPORTED_MODEL_IDS = ['gpt-5.4-nano', 'gpt-5.4-mini'] as const;
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

// --- Tier system ---

export type AgentTier = 'takos' | 'takos-lite';

export const TIER_CONFIG: Readonly<Record<AgentTier, {
  model: string;
  provider: ModelProvider;
  contextWindow: number;
  displayName: string;
}>> = {
  'takos':      { model: 'gpt-5.4-mini', provider: 'openai', contextWindow: 100, displayName: 'Takos 1.0' },
  'takos-lite': { model: 'gpt-5.4-nano', provider: 'openai', contextWindow: 50,  displayName: 'Takos 1.0 Lite' },
};

export function getTierFromModel(model: string): AgentTier {
  for (const [tier, config] of Object.entries(TIER_CONFIG) as [AgentTier, typeof TIER_CONFIG[AgentTier]][]) {
    if (config.model === model) return tier;
  }
  return 'takos-lite';
}

export function getContextWindowForModel(model: string): number {
  return TIER_CONFIG[getTierFromModel(model)].contextWindow;
}
