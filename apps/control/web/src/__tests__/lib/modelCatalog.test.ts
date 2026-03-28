import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MODEL_ID,
  FALLBACK_MODELS,
  MODEL_OPTIONS,
  getModelLabel,
} from '../../lib/modelCatalog';

describe('frontend model catalog', () => {
  it('keeps fallback options on OpenAI models only', () => {
    expect(DEFAULT_MODEL_ID).toBe('gpt-5.4-nano');
    expect(FALLBACK_MODELS.map((model) => model.id)).toEqual(['gpt-5.4-nano', 'gpt-5.4-mini', 'gpt-5.4']);
  });

  it('lists all supported models', () => {
    expect(MODEL_OPTIONS.map((m) => m.id)).toEqual(['gpt-5.4-nano', 'gpt-5.4-mini', 'gpt-5.4']);
  });

  it('returns model labels', () => {
    expect(getModelLabel('gpt-5.4-nano')).toBe('GPT-5.4 Nano');
    expect(getModelLabel('gpt-5.4-mini')).toBe('GPT-5.4 Mini');
    expect(getModelLabel('gpt-5.4')).toBe('GPT-5.4');
    expect(getModelLabel('unknown-model')).toBe('unknown-model');
  });
});
