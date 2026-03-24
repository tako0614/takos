import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MODEL_ID,
  FALLBACK_MODELS,
  TIER_CONFIG,
  getTierFromModel,
} from '../../lib/modelCatalog';

describe('frontend model catalog', () => {
  it('keeps fallback options on OpenAI models only', () => {
    expect(DEFAULT_MODEL_ID).toBe('gpt-5.4-nano');
    expect(FALLBACK_MODELS.map((model) => model.id)).toEqual(['gpt-5.4-nano', 'gpt-5.4-mini']);
  });

  it('maps both selectable tiers to OpenAI models', () => {
    expect(TIER_CONFIG.takos.model).toBe('gpt-5.4-mini');
    expect(TIER_CONFIG['takos-lite'].model).toBe('gpt-5.4-nano');
    expect(getTierFromModel('gpt-5.4-mini')).toBe('takos');
    expect(getTierFromModel('gpt-5.4-nano')).toBe('takos-lite');
  });
});
