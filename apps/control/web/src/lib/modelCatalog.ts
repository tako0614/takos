export type ModelSelectOption = {
  id: string;
  label: string;
  description?: string;
  contextMessages?: number;
};

const OPENAI_MODEL_OPTIONS: ReadonlyArray<ModelSelectOption> = [
  { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano', contextMessages: 50 },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', contextMessages: 100 },
];

export const DEFAULT_MODEL_ID = OPENAI_MODEL_OPTIONS[0].id;

export const FALLBACK_MODELS: ReadonlyArray<ModelSelectOption> = OPENAI_MODEL_OPTIONS;

// --- Tier system ---

export type AgentTier = 'takos' | 'takos-lite';

export const TIER_CONFIG: Record<AgentTier, { model: string; label: string; description: string }> = {
  'takos':      { model: 'gpt-5.4-mini', label: 'Takos 1.0', description: '高精度（100msg）' },
  'takos-lite': { model: 'gpt-5.4-nano', label: 'Takos 1.0 Lite', description: '高速・軽量（50msg）' },
};

export function getTierFromModel(model: string): AgentTier {
  for (const [tier, cfg] of Object.entries(TIER_CONFIG) as [AgentTier, typeof TIER_CONFIG[AgentTier]][]) {
    if (cfg.model === model) return tier;
  }
  return 'takos-lite';
}
