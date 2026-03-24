import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/agent/prompts', () => ({
  SYSTEM_PROMPTS: {
    default: 'Default system prompt',
    implementer: 'Implementer prompt',
    reviewer: 'Reviewer prompt',
  },
}));

vi.mock('@/tools/builtin', () => ({
  BUILTIN_TOOLS: [
    { name: 'file_read', description: 'Read a file', parameters: { type: 'object', properties: {} } },
    { name: 'web_search', description: 'Search the web', parameters: { type: 'object', properties: {} } },
  ],
}));

vi.mock('@/utils/logger', () => ({
  logWarn: vi.fn(),
}));

import {
  getTimeoutConfig,
  getAgentConfig,
  DEFAULT_ITERATION_TIMEOUT,
  DEFAULT_TOTAL_TIMEOUT,
} from '@/services/agent/runner-config';
import type { Env } from '@/types';

describe('getTimeoutConfig', () => {
  it('returns default timeouts when no env is provided', () => {
    const config = getTimeoutConfig();
    expect(config.iterationTimeout).toBe(DEFAULT_ITERATION_TIMEOUT);
    expect(config.totalTimeout).toBe(DEFAULT_TOTAL_TIMEOUT);
    expect(config.toolExecutionTimeout).toBe(300000);
    expect(config.langGraphTimeout).toBe(900000);
  });

  it('returns default timeouts for empty env', () => {
    const config = getTimeoutConfig({} as Env);
    expect(config.iterationTimeout).toBe(DEFAULT_ITERATION_TIMEOUT);
    expect(config.totalTimeout).toBe(DEFAULT_TOTAL_TIMEOUT);
  });

  it('parses custom timeouts from env', () => {
    const config = getTimeoutConfig({
      AGENT_ITERATION_TIMEOUT: '60000',
      AGENT_TOTAL_TIMEOUT: '600000',
      TOOL_EXECUTION_TIMEOUT: '180000',
      LANGGRAPH_TIMEOUT: '600000',
    } as unknown as Env);

    expect(config.iterationTimeout).toBe(60000);
    expect(config.totalTimeout).toBe(600000);
    expect(config.toolExecutionTimeout).toBe(180000);
    expect(config.langGraphTimeout).toBe(600000);
  });

  it('respects AGENT_TOTAL_TIMEOUT for higher max cap (container mode)', () => {
    const config = getTimeoutConfig({
      AGENT_TOTAL_TIMEOUT: '86400000', // 24h
    } as unknown as Env);

    expect(config.totalTimeout).toBe(86400000);
  });

  it('caps total timeout at 24h even with higher env value', () => {
    const config = getTimeoutConfig({
      AGENT_TOTAL_TIMEOUT: '100000000', // >24h
    } as unknown as Env);

    // Should be capped at the value itself (since it's within 24h max enforcement logic)
    // The MAX_TIMEOUT is min(100000000, 86400000) = 86400000
    // Then parseTimeout parses '100000000' but caps at MAX_TIMEOUT
    expect(config.totalTimeout).toBeLessThanOrEqual(86400000);
  });

  it('falls back to default for invalid timeout values', () => {
    const config = getTimeoutConfig({
      AGENT_ITERATION_TIMEOUT: 'not-a-number',
    } as unknown as Env);

    expect(config.iterationTimeout).toBe(DEFAULT_ITERATION_TIMEOUT);
  });

  it('falls back to default for values below minimum', () => {
    const config = getTimeoutConfig({
      AGENT_ITERATION_TIMEOUT: '500', // below 1000ms min
    } as unknown as Env);

    expect(config.iterationTimeout).toBe(DEFAULT_ITERATION_TIMEOUT);
  });
});

describe('getAgentConfig', () => {
  it('returns config for default agent type', () => {
    const config = getAgentConfig('default');
    expect(config.type).toBe('default');
    expect(config.systemPrompt).toBe('Default system prompt');
    expect(config.tools.length).toBe(2);
    expect(config.tools[0].name).toBe('file_read');
    expect(config.maxIterations).toBe(10000);
    expect(config.temperature).toBe(0.5);
  });

  it('returns specialized prompt for known agent types', () => {
    const implementer = getAgentConfig('implementer');
    expect(implementer.systemPrompt).toBe('Implementer prompt');

    const reviewer = getAgentConfig('reviewer');
    expect(reviewer.systemPrompt).toBe('Reviewer prompt');
  });

  it('falls back to default prompt for unknown agent types', () => {
    const config = getAgentConfig('unknown-type');
    expect(config.systemPrompt).toBe('Default system prompt');
  });

  it('parses MAX_AGENT_ITERATIONS from env', () => {
    const config = getAgentConfig('default', {
      MAX_AGENT_ITERATIONS: '500',
    } as unknown as Env);
    expect(config.maxIterations).toBe(500);
  });

  it('parses AGENT_TEMPERATURE from env and clamps to [0,1]', () => {
    const config1 = getAgentConfig('default', {
      AGENT_TEMPERATURE: '0.8',
    } as unknown as Env);
    expect(config1.temperature).toBe(0.8);

    const config2 = getAgentConfig('default', {
      AGENT_TEMPERATURE: '1.5',
    } as unknown as Env);
    expect(config2.temperature).toBe(1);

    const config3 = getAgentConfig('default', {
      AGENT_TEMPERATURE: '-0.5',
    } as unknown as Env);
    expect(config3.temperature).toBe(0);
  });

  it('ignores invalid AGENT_TEMPERATURE', () => {
    const config = getAgentConfig('default', {
      AGENT_TEMPERATURE: 'not-a-number',
    } as unknown as Env);
    expect(config.temperature).toBe(0.5);
  });

  it('parses AGENT_RATE_LIMIT from env', () => {
    const config = getAgentConfig('default', {
      AGENT_RATE_LIMIT: '100',
    } as unknown as Env);
    expect(config.rateLimit).toBe(100);
  });

  it('leaves rateLimit undefined when not set', () => {
    const config = getAgentConfig('default');
    expect(config.rateLimit).toBeUndefined();
  });
});

describe('exported timeout constants', () => {
  it('DEFAULT_ITERATION_TIMEOUT is 120 seconds', () => {
    expect(DEFAULT_ITERATION_TIMEOUT).toBe(120000);
  });

  it('DEFAULT_TOTAL_TIMEOUT is 15 minutes', () => {
    expect(DEFAULT_TOTAL_TIMEOUT).toBe(900000);
  });
});
