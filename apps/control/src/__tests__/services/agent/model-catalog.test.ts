import { describe, expect, it } from 'vitest';
import { AI_MODELS, DEFAULT_AI_MODEL } from '@/services/identity/user-settings';
import {
  DEFAULT_MODEL_ID,
  OPENAI_MODELS,
  TIER_CONFIG,
  SUPPORTED_MODEL_IDS,
} from '@/services/agent/model-catalog';

describe('model catalog guardrails', () => {
  it('keeps OpenAI models on gpt-5 catalog', () => {
    const openaiIds = OPENAI_MODELS.map((model) => model.id);
    expect(openaiIds).toEqual(['gpt-5.4-nano', 'gpt-5.4-mini']);
    expect(openaiIds.some((id) => id.includes('gpt-4o'))).toBe(false);
  });

  it('keeps canonical defaults aligned across services', () => {
    expect(DEFAULT_MODEL_ID).toBe('gpt-5.4-nano');
    expect(DEFAULT_AI_MODEL).toBe(DEFAULT_MODEL_ID);
    expect(SUPPORTED_MODEL_IDS).toEqual(['gpt-5.4-nano', 'gpt-5.4-mini']);
    expect(AI_MODELS).toEqual(SUPPORTED_MODEL_IDS);
  });

  it('keeps all selectable tiers on OpenAI models', () => {
    expect(TIER_CONFIG.takos).toMatchObject({
      model: 'gpt-5.4-mini',
      provider: 'openai',
      contextWindow: 100,
    });
    expect(TIER_CONFIG['takos-lite']).toMatchObject({
      model: 'gpt-5.4-nano',
      provider: 'openai',
      contextWindow: 50,
    });
  });
});
