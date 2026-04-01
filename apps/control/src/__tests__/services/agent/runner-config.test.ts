// [Deno] vi.mock removed - manually stub imports from '@/services/agent/prompts'
// [Deno] vi.mock removed - manually stub imports from '@/tools/builtin'
// [Deno] vi.mock removed - manually stub imports from '@/utils/logger'
import {
  getTimeoutConfig,
  getAgentConfig,
  DEFAULT_ITERATION_TIMEOUT,
  DEFAULT_TOTAL_TIMEOUT,
} from '@/services/agent/runner-config';
import { BUILTIN_TOOLS } from '@/tools/builtin';
import type { Env } from '@/types';


import { assertEquals, assert, assertStringIncludes } from 'jsr:@std/assert';

  Deno.test('getTimeoutConfig - returns default timeouts when no env is provided', () => {
  const config = getTimeoutConfig();
    assertEquals(config.iterationTimeout, DEFAULT_ITERATION_TIMEOUT);
    assertEquals(config.totalTimeout, DEFAULT_TOTAL_TIMEOUT);
    assertEquals(config.toolExecutionTimeout, 300000);
    assertEquals(config.langGraphTimeout, 900000);
})
  Deno.test('getTimeoutConfig - returns default timeouts for empty env', () => {
  const config = getTimeoutConfig({} as Env);
    assertEquals(config.iterationTimeout, DEFAULT_ITERATION_TIMEOUT);
    assertEquals(config.totalTimeout, DEFAULT_TOTAL_TIMEOUT);
})
  Deno.test('getTimeoutConfig - parses custom timeouts from env', () => {
  const config = getTimeoutConfig({
      AGENT_ITERATION_TIMEOUT: '60000',
      AGENT_TOTAL_TIMEOUT: '600000',
      TOOL_EXECUTION_TIMEOUT: '180000',
      LANGGRAPH_TIMEOUT: '600000',
    } as unknown as Env);

    assertEquals(config.iterationTimeout, 60000);
    assertEquals(config.totalTimeout, 600000);
    assertEquals(config.toolExecutionTimeout, 180000);
    assertEquals(config.langGraphTimeout, 600000);
})
  Deno.test('getTimeoutConfig - respects AGENT_TOTAL_TIMEOUT for higher max cap (container mode)', () => {
  const config = getTimeoutConfig({
      AGENT_TOTAL_TIMEOUT: '86400000', // 24h
    } as unknown as Env);

    assertEquals(config.totalTimeout, 86400000);
})
  Deno.test('getTimeoutConfig - caps total timeout at 24h even with higher env value', () => {
  const config = getTimeoutConfig({
      AGENT_TOTAL_TIMEOUT: '100000000', // >24h
    } as unknown as Env);

    // Should be capped at the value itself (since it's within 24h max enforcement logic)
    // The MAX_TIMEOUT is min(100000000, 86400000) = 86400000
    // Then parseTimeout parses '100000000' but caps at MAX_TIMEOUT
    assert(config.totalTimeout <= 86400000);
})
  Deno.test('getTimeoutConfig - falls back to default for invalid timeout values', () => {
  const config = getTimeoutConfig({
      AGENT_ITERATION_TIMEOUT: 'not-a-number',
    } as unknown as Env);

    assertEquals(config.iterationTimeout, DEFAULT_ITERATION_TIMEOUT);
})
  Deno.test('getTimeoutConfig - falls back to default for values below minimum', () => {
  const config = getTimeoutConfig({
      AGENT_ITERATION_TIMEOUT: '500', // below 1000ms min
    } as unknown as Env);

    assertEquals(config.iterationTimeout, DEFAULT_ITERATION_TIMEOUT);
})

  Deno.test('getAgentConfig - returns config for default agent type', () => {
  const config = getAgentConfig('default');
    assertEquals(config.type, 'default');
    assertStringIncludes(config.systemPrompt, "You are Takos's universal agent.");
    assertStringIncludes(config.systemPrompt, '## Typical Use Cases');
    assertStringIncludes(config.systemPrompt, '## Response Guidelines');
    assertEquals(config.tools.map((tool) => tool.name), BUILTIN_TOOLS.map((tool) => tool.name));
    assertEquals(config.maxIterations, 10000);
    assertEquals(config.temperature, 0.5);
})
  Deno.test('getAgentConfig - returns specialized prompt for known agent types', () => {
  const implementer = getAgentConfig('implementer');
    assertStringIncludes(implementer.systemPrompt, '## Implementation Mode');

    const reviewer = getAgentConfig('reviewer');
    assertStringIncludes(reviewer.systemPrompt, '## Review Mode');
})
  Deno.test('getAgentConfig - falls back to default prompt for unknown agent types', () => {
  const config = getAgentConfig('unknown-type');
    assertStringIncludes(config.systemPrompt, "You are Takos's universal agent.");
})
  Deno.test('getAgentConfig - parses MAX_AGENT_ITERATIONS from env', () => {
  const config = getAgentConfig('default', {
      MAX_AGENT_ITERATIONS: '500',
    } as unknown as Env);
    assertEquals(config.maxIterations, 500);
})
  Deno.test('getAgentConfig - parses AGENT_TEMPERATURE from env and falls back to default when out of range', () => {
  const config1 = getAgentConfig('default', {
      AGENT_TEMPERATURE: '0.8',
    } as unknown as Env);
    assertEquals(config1.temperature, 0.8);

    const config2 = getAgentConfig('default', {
      AGENT_TEMPERATURE: '1.5',
    } as unknown as Env);
    assertEquals(config2.temperature, 0.5);

    const config3 = getAgentConfig('default', {
      AGENT_TEMPERATURE: '-0.5',
    } as unknown as Env);
    assertEquals(config3.temperature, 0.5);
})
  Deno.test('getAgentConfig - ignores invalid AGENT_TEMPERATURE', () => {
  const config = getAgentConfig('default', {
      AGENT_TEMPERATURE: 'not-a-number',
    } as unknown as Env);
    assertEquals(config.temperature, 0.5);
})
  Deno.test('getAgentConfig - parses AGENT_RATE_LIMIT from env', () => {
  const config = getAgentConfig('default', {
      AGENT_RATE_LIMIT: '100',
    } as unknown as Env);
    assertEquals(config.rateLimit, 100);
})
  Deno.test('getAgentConfig - leaves rateLimit undefined when not set', () => {
  const config = getAgentConfig('default');
    assertEquals(config.rateLimit, undefined);
})

  Deno.test('exported timeout constants - DEFAULT_ITERATION_TIMEOUT is 120 seconds', () => {
  assertEquals(DEFAULT_ITERATION_TIMEOUT, 120000);
})
  Deno.test('exported timeout constants - DEFAULT_TOTAL_TIMEOUT is 15 minutes', () => {
  assertEquals(DEFAULT_TOTAL_TIMEOUT, 900000);
})
