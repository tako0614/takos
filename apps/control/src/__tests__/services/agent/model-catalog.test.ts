import { describe, expect, it } from 'vitest';
import { AI_MODELS, DEFAULT_AI_MODEL } from '@/services/identity/user-settings';
import {
  DEFAULT_MODEL_ID,
  OPENAI_MODELS,
  SUPPORTED_MODEL_IDS,
  getModelTokenLimit,
  resolveHistoryTokenBudget,
} from '@/services/agent/model-catalog';

describe('model catalog guardrails', () => {
  it('keeps OpenAI models on gpt-5 catalog', () => {
    const openaiIds = OPENAI_MODELS.map((model) => model.id);
    expect(openaiIds).toEqual(['gpt-5.4-nano', 'gpt-5.4-mini', 'gpt-5.4']);
    expect(openaiIds.some((id) => id.includes('gpt-4o'))).toBe(false);
  });

  it('keeps canonical defaults aligned across services', () => {
    expect(DEFAULT_MODEL_ID).toBe('gpt-5.4-nano');
    expect(DEFAULT_AI_MODEL).toBe(DEFAULT_MODEL_ID);
    expect(SUPPORTED_MODEL_IDS).toEqual(['gpt-5.4-nano', 'gpt-5.4-mini', 'gpt-5.4']);
    expect(AI_MODELS).toEqual(SUPPORTED_MODEL_IDS);
  });

  it('returns correct token limits per model', () => {
    expect(getModelTokenLimit('gpt-5.4-nano')).toBe(32_768);
    expect(getModelTokenLimit('gpt-5.4-mini')).toBe(128_000);
    expect(getModelTokenLimit('gpt-5.4')).toBe(128_000);
    expect(getModelTokenLimit('unknown')).toBe(32_768);
  });

  it('resolves history budget from token limit minus reserved', () => {
    // gpt-5.4-nano: 32768 - 16000 = 16768
    expect(resolveHistoryTokenBudget('gpt-5.4-nano')).toBe(16_768);
    // gpt-5.4-mini: 128000 - 16000 = 112000
    expect(resolveHistoryTokenBudget('gpt-5.4-mini')).toBe(112_000);
  });

  it('applies env overrides to history budget', () => {
    const overrides = JSON.stringify({ 'gpt-5.4': 200_000 });
    // 200000 - 16000 = 184000
    expect(resolveHistoryTokenBudget('gpt-5.4', overrides)).toBe(184_000);
    // not overridden
    expect(resolveHistoryTokenBudget('gpt-5.4-nano', overrides)).toBe(16_768);
  });

  it('falls back to defaults when env override is invalid', () => {
    expect(resolveHistoryTokenBudget('gpt-5.4', 'not-json')).toBe(112_000);
    expect(resolveHistoryTokenBudget('gpt-5.4', null)).toBe(112_000);
    expect(resolveHistoryTokenBudget('gpt-5.4', undefined)).toBe(112_000);
  });
});
