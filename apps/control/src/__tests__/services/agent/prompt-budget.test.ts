import { describe, expect, it } from 'vitest';

import {
  estimateTokens,
  buildBudgetedSystemPrompt,
  LANE_PRIORITY,
  LANE_MAX_TOKENS,
  type PromptLane,
} from '@/services/agent/prompt-budget';

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns 0 for falsy input', () => {
    expect(estimateTokens(undefined as unknown as string)).toBe(0);
  });

  it('counts English words with subword multiplier', () => {
    const tokens = estimateTokens('Hello world');
    // 2 words * 1.3 = 2.6 → ceil = 3
    expect(tokens).toBe(3);
  });

  it('counts CJK characters individually', () => {
    const tokens = estimateTokens('こんにちは');
    // 5 CJK characters
    expect(tokens).toBe(5);
  });

  it('handles mixed CJK and English text', () => {
    const tokens = estimateTokens('Hello こんにちは world');
    // 5 CJK + ceil(2 * 1.3) = 5 + 3 = 8
    expect(tokens).toBe(8);
  });

  it('handles punctuation and special characters', () => {
    const tokens = estimateTokens('Hello, world! How are you?');
    // Words: Hello, world, How, are, you → 5 words * 1.3 = 6.5 → 7
    expect(tokens).toBeGreaterThan(0);
  });

  it('gives reasonable estimates for longer text', () => {
    const text = 'The quick brown fox jumps over the lazy dog.';
    const tokens = estimateTokens(text);
    // 9 words * 1.3 = 11.7 → 12
    expect(tokens).toBeGreaterThan(5);
    expect(tokens).toBeLessThan(30);
  });
});

describe('buildBudgetedSystemPrompt', () => {
  it('includes all lanes when budget allows', () => {
    const lanes: PromptLane[] = [
      { priority: 0, name: 'base', content: 'Base prompt content', maxTokens: 500 },
      { priority: 1, name: 'tools', content: 'Tool catalog', maxTokens: 500 },
      { priority: 2, name: 'memory', content: 'Memory content', maxTokens: 500 },
    ];

    const result = buildBudgetedSystemPrompt(lanes, { totalBudget: 5000 });
    expect(result).toContain('Base prompt content');
    expect(result).toContain('Tool catalog');
    expect(result).toContain('Memory content');
  });

  it('respects priority ordering (lower number = higher priority)', () => {
    const lanes: PromptLane[] = [
      { priority: 2, name: 'low', content: 'Low priority', maxTokens: 500 },
      { priority: 0, name: 'high', content: 'High priority', maxTokens: 500 },
      { priority: 1, name: 'mid', content: 'Mid priority', maxTokens: 500 },
    ];

    const result = buildBudgetedSystemPrompt(lanes, { totalBudget: 5000 });
    const highIdx = result.indexOf('High priority');
    const midIdx = result.indexOf('Mid priority');
    const lowIdx = result.indexOf('Low priority');
    expect(highIdx).toBeLessThan(midIdx);
    expect(midIdx).toBeLessThan(lowIdx);
  });

  it('drops lower-priority lanes when budget is exceeded', () => {
    const lanes: PromptLane[] = [
      { priority: 0, name: 'base', content: 'Base prompt with enough words to fill budget', maxTokens: 5000 },
      { priority: 1, name: 'dropped', content: 'This should be dropped', maxTokens: 5000 },
    ];

    const result = buildBudgetedSystemPrompt(lanes, { totalBudget: 5 });
    // With a very tight budget, the second lane should be truncated or dropped
    expect(result).toContain('[... truncated]');
  });

  it('uses default totalBudget of 8000 when not specified', () => {
    const lanes: PromptLane[] = [
      { priority: 0, name: 'base', content: 'Short content', maxTokens: 500 },
    ];

    const result = buildBudgetedSystemPrompt(lanes);
    expect(result).toContain('Short content');
  });

  it('skips lanes with empty content', () => {
    const lanes: PromptLane[] = [
      { priority: 0, name: 'base', content: 'Real content', maxTokens: 500 },
      { priority: 1, name: 'empty', content: '', maxTokens: 500 },
      { priority: 2, name: 'also-real', content: 'More content', maxTokens: 500 },
    ];

    const result = buildBudgetedSystemPrompt(lanes, { totalBudget: 5000 });
    expect(result).toContain('Real content');
    expect(result).toContain('More content');
  });

  it('truncates individual lanes to their maxTokens', () => {
    const longContent = Array(200).fill('word').join(' ');
    const lanes: PromptLane[] = [
      { priority: 0, name: 'limited', content: longContent, maxTokens: 5 },
    ];

    const result = buildBudgetedSystemPrompt(lanes, { totalBudget: 5000 });
    expect(result).toContain('[... truncated]');
    expect(result.length).toBeLessThan(longContent.length);
  });

  it('joins parts with double newlines', () => {
    const lanes: PromptLane[] = [
      { priority: 0, name: 'a', content: 'Part A', maxTokens: 500 },
      { priority: 1, name: 'b', content: 'Part B', maxTokens: 500 },
    ];

    const result = buildBudgetedSystemPrompt(lanes, { totalBudget: 5000 });
    expect(result).toBe('Part A\n\nPart B');
  });
});

describe('LANE_PRIORITY constants', () => {
  it('has correct priority ordering', () => {
    expect(LANE_PRIORITY.BASE_PROMPT).toBe(0);
    expect(LANE_PRIORITY.TOOL_CATALOG).toBe(1);
    expect(LANE_PRIORITY.MEMORY_ACTIVATION).toBe(2);
    expect(LANE_PRIORITY.SKILL_INSTRUCTIONS).toBe(3);
    expect(LANE_PRIORITY.THREAD_CONTEXT).toBe(4);
  });
});

describe('LANE_MAX_TOKENS constants', () => {
  it('has reasonable token limits', () => {
    expect(LANE_MAX_TOKENS.BASE_PROMPT).toBe(2000);
    expect(LANE_MAX_TOKENS.TOOL_CATALOG).toBe(2500);
    expect(LANE_MAX_TOKENS.MEMORY_ACTIVATION).toBe(800);
    expect(LANE_MAX_TOKENS.SKILL_INSTRUCTIONS).toBe(2000);
    expect(LANE_MAX_TOKENS.THREAD_CONTEXT).toBe(1500);
  });
});
