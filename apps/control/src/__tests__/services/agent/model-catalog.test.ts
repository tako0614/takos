import { AI_MODELS, DEFAULT_AI_MODEL } from '@/services/identity/user-settings';
import {
  DEFAULT_MODEL_ID,
  OPENAI_MODELS,
  SUPPORTED_MODEL_IDS,
  getModelTokenLimit,
  resolveHistoryTokenBudget,
} from '@/services/agent/model-catalog';


import { assertEquals } from 'jsr:@std/assert';

  Deno.test('model catalog guardrails - keeps OpenAI models on gpt-5 catalog', () => {
  const openaiIds = OPENAI_MODELS.map((model) => model.id);
    assertEquals(openaiIds, ['gpt-5.4-nano', 'gpt-5.4-mini', 'gpt-5.4']);
    assertEquals(openaiIds.some((id) => id.includes('gpt-4o')), false);
})
  Deno.test('model catalog guardrails - keeps canonical defaults aligned across services', () => {
  assertEquals(DEFAULT_MODEL_ID, 'gpt-5.4-nano');
    assertEquals(DEFAULT_AI_MODEL, DEFAULT_MODEL_ID);
    assertEquals(SUPPORTED_MODEL_IDS, ['gpt-5.4-nano', 'gpt-5.4-mini', 'gpt-5.4']);
    assertEquals(AI_MODELS, SUPPORTED_MODEL_IDS);
})
  Deno.test('model catalog guardrails - returns correct token limits per model', () => {
  assertEquals(getModelTokenLimit('gpt-5.4-nano'), 32_768);
    assertEquals(getModelTokenLimit('gpt-5.4-mini'), 128_000);
    assertEquals(getModelTokenLimit('gpt-5.4'), 128_000);
    assertEquals(getModelTokenLimit('unknown'), 32_768);
})
  Deno.test('model catalog guardrails - resolves history budget from token limit minus reserved', () => {
  // gpt-5.4-nano: 32768 - 16000 = 16768
    assertEquals(resolveHistoryTokenBudget('gpt-5.4-nano'), 16_768);
    // gpt-5.4-mini: 128000 - 16000 = 112000
    assertEquals(resolveHistoryTokenBudget('gpt-5.4-mini'), 112_000);
})
  Deno.test('model catalog guardrails - applies env overrides to history budget', () => {
  const overrides = JSON.stringify({ 'gpt-5.4': 200_000 });
    // 200000 - 16000 = 184000
    assertEquals(resolveHistoryTokenBudget('gpt-5.4', overrides), 184_000);
    // not overridden
    assertEquals(resolveHistoryTokenBudget('gpt-5.4-nano', overrides), 16_768);
})
  Deno.test('model catalog guardrails - falls back to defaults when env override is invalid', () => {
  assertEquals(resolveHistoryTokenBudget('gpt-5.4', 'not-json'), 112_000);
    assertEquals(resolveHistoryTokenBudget('gpt-5.4', null), 112_000);
    assertEquals(resolveHistoryTokenBudget('gpt-5.4', undefined), 112_000);
})