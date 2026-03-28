import type { AgentConfig } from './agent-models';
import type { Env } from '../../../shared/types';
import { BUILTIN_TOOLS } from '../../tools/builtin';
import { SYSTEM_PROMPTS } from './prompt-builder';
import { logWarn } from '../../../shared/utils/logger';
import {
  AGENT_ITERATION_TIMEOUT_MS,
  AGENT_TOTAL_TIMEOUT_MS,
  AGENT_TOOL_EXECUTION_TIMEOUT_MS,
  AGENT_LANGGRAPH_TIMEOUT_MS,
} from '../../../shared/config/timeouts';

const DEFAULT_MAX_ITERATIONS = 10000;
const DEFAULT_TEMPERATURE = 0.5;
// Default timeouts — these apply when running in CF Workers (15-min Queue consumer limit).
// When running inside a CF Container (executor), AGENT_TOTAL_TIMEOUT env var is set
// to 86400000 (24h) and the 15-min cap is not enforced.
export const DEFAULT_ITERATION_TIMEOUT = AGENT_ITERATION_TIMEOUT_MS;       // 2 min per LLM call
export const DEFAULT_TOTAL_TIMEOUT = AGENT_TOTAL_TIMEOUT_MS;           // 15 min total (CF Workers Queue limit)
const DEFAULT_TOOL_EXECUTION_TIMEOUT = AGENT_TOOL_EXECUTION_TIMEOUT_MS;  // 5 min per tool (e.g. build commands)
const DEFAULT_LANGGRAPH_TIMEOUT = AGENT_LANGGRAPH_TIMEOUT_MS;       // 15 min for LangGraph (CF Workers)

export function getTimeoutConfig(env?: Env): {
  iterationTimeout: number;
  totalTimeout: number;
  toolExecutionTimeout: number;
  langGraphTimeout: number;
} {
  const parseTimeout = (value: string | undefined, defaultValue: number, min: number, max: number): number => {
    if (!value) return defaultValue;
    const parsed = parseInt(value, 10);
    if (isNaN(parsed) || parsed < min || parsed > max) {
      logWarn(`Invalid timeout value: ${value}, using default: ${defaultValue}`, { module: 'services/agent/runner-config' });
      return defaultValue;
    }
    return parsed;
  };

  const MIN_TIMEOUT = 1000;
  // In CF Container mode, AGENT_TOTAL_TIMEOUT env var sets a higher limit (up to 24h).
  // In CF Workers Queue mode, cap at 15 min (Queue consumer hard limit).
  const MAX_TIMEOUT = env?.AGENT_TOTAL_TIMEOUT
    ? Math.min(parseInt(env.AGENT_TOTAL_TIMEOUT, 10), 86400000)  // respect env, cap at 24h
    : 900000; // default cap: 15 min (CF Workers Queue consumer limit)

  return {
    iterationTimeout: parseTimeout(env?.AGENT_ITERATION_TIMEOUT, DEFAULT_ITERATION_TIMEOUT, MIN_TIMEOUT, MAX_TIMEOUT),
    totalTimeout: parseTimeout(env?.AGENT_TOTAL_TIMEOUT, DEFAULT_TOTAL_TIMEOUT, MIN_TIMEOUT, MAX_TIMEOUT),
    toolExecutionTimeout: parseTimeout(env?.TOOL_EXECUTION_TIMEOUT, DEFAULT_TOOL_EXECUTION_TIMEOUT, MIN_TIMEOUT, MAX_TIMEOUT),
    langGraphTimeout: parseTimeout(env?.LANGGRAPH_TIMEOUT, DEFAULT_LANGGRAPH_TIMEOUT, MIN_TIMEOUT, MAX_TIMEOUT),
  };
}

export function getAgentConfig(agentType: string, env?: Env): AgentConfig {
  const systemPrompt = SYSTEM_PROMPTS[agentType] || SYSTEM_PROMPTS.default;

  const tools = BUILTIN_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));

  const maxIterations = env?.MAX_AGENT_ITERATIONS
    ? parseInt(env.MAX_AGENT_ITERATIONS, 10)
    : DEFAULT_MAX_ITERATIONS;

  let temperature = DEFAULT_TEMPERATURE;
  if (env?.AGENT_TEMPERATURE) {
    const parsed = parseFloat(env.AGENT_TEMPERATURE);
    if (!isNaN(parsed)) {
      temperature = Math.max(0, Math.min(1, parsed));
    }
  }

  const rateLimit = env?.AGENT_RATE_LIMIT
    ? parseInt(env.AGENT_RATE_LIMIT, 10)
    : undefined;

  return {
    type: agentType,
    systemPrompt,
    tools,
    maxIterations,
    temperature,
    rateLimit,
  };
}
