import type { AgentConfig } from "./agent-models.ts";
import type { Env } from "../../../shared/types/index.ts";
import { CUSTOM_TOOLS } from "../../tools/custom/index.ts";
import { SYSTEM_PROMPTS } from "./prompt-builder.ts";
import { logWarn } from "../../../shared/utils/logger.ts";
import { parseFloatValue, parseIntValue } from "takos-common/env-parse";
import {
  AGENT_ITERATION_TIMEOUT_MS,
  AGENT_LANGGRAPH_TIMEOUT_MS,
  AGENT_TOOL_EXECUTION_TIMEOUT_MS,
  AGENT_TOTAL_TIMEOUT_MS,
} from "../../../shared/config/timeouts.ts";

const DEFAULT_MAX_ITERATIONS = 10000;
const DEFAULT_TEMPERATURE = 0.5;
// Default timeouts — these apply when running in CF Workers (15-min Queue consumer limit).
// When running inside a CF Container (executor), AGENT_TOTAL_TIMEOUT env var is set
// to 86400000 (24h) and the 15-min cap is not enforced.
export const DEFAULT_ITERATION_TIMEOUT = AGENT_ITERATION_TIMEOUT_MS; // 2 min per LLM call
export const DEFAULT_TOTAL_TIMEOUT = AGENT_TOTAL_TIMEOUT_MS; // 15 min total (CF Workers Queue limit)
const DEFAULT_TOOL_EXECUTION_TIMEOUT = AGENT_TOOL_EXECUTION_TIMEOUT_MS; // 5 min per tool (e.g. build commands)
const DEFAULT_LANGGRAPH_TIMEOUT = AGENT_LANGGRAPH_TIMEOUT_MS; // 15 min for LangGraph (CF Workers)

export function getTimeoutConfig(env?: Env): {
  iterationTimeout: number;
  totalTimeout: number;
  toolExecutionTimeout: number;
  langGraphTimeout: number;
} {
  const warn = (msg: string) =>
    logWarn(msg, { module: "services/agent/runner-config" });

  const MIN_TIMEOUT = 1000;
  // In CF Container mode, AGENT_TOTAL_TIMEOUT env var sets a higher limit (up to 24h).
  // In CF Workers Queue mode, cap at 15 min (Queue consumer hard limit).
  const MAX_TIMEOUT = env?.AGENT_TOTAL_TIMEOUT
    ? Math.min(
      parseIntValue("AGENT_TOTAL_TIMEOUT", env.AGENT_TOTAL_TIMEOUT, 900000, {
        min: MIN_TIMEOUT,
        max: 86400000,
        warn,
      }),
      86400000,
    )
    : 900000; // default cap: 15 min (CF Workers Queue consumer limit)

  const parseOpts = { min: MIN_TIMEOUT, max: MAX_TIMEOUT, warn };

  return {
    iterationTimeout: parseIntValue(
      "AGENT_ITERATION_TIMEOUT",
      env?.AGENT_ITERATION_TIMEOUT,
      DEFAULT_ITERATION_TIMEOUT,
      parseOpts,
    ),
    totalTimeout: parseIntValue(
      "AGENT_TOTAL_TIMEOUT",
      env?.AGENT_TOTAL_TIMEOUT,
      DEFAULT_TOTAL_TIMEOUT,
      parseOpts,
    ),
    toolExecutionTimeout: parseIntValue(
      "TOOL_EXECUTION_TIMEOUT",
      env?.TOOL_EXECUTION_TIMEOUT,
      DEFAULT_TOOL_EXECUTION_TIMEOUT,
      parseOpts,
    ),
    langGraphTimeout: parseIntValue(
      "LANGGRAPH_TIMEOUT",
      env?.LANGGRAPH_TIMEOUT,
      DEFAULT_LANGGRAPH_TIMEOUT,
      parseOpts,
    ),
  };
}

export function getAgentConfig(agentType: string, env?: Env): AgentConfig {
  const warn = (msg: string) =>
    logWarn(msg, { module: "services/agent/runner-config" });

  const systemPrompt = SYSTEM_PROMPTS[agentType] || SYSTEM_PROMPTS.default;

  const tools = CUSTOM_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));

  const maxIterations = parseIntValue(
    "MAX_AGENT_ITERATIONS",
    env?.MAX_AGENT_ITERATIONS,
    DEFAULT_MAX_ITERATIONS,
    { min: 1, warn },
  );

  const temperature = parseFloatValue(
    "AGENT_TEMPERATURE",
    env?.AGENT_TEMPERATURE,
    DEFAULT_TEMPERATURE,
    { min: 0, max: 1, warn },
  );

  const rateLimitRaw = env?.AGENT_RATE_LIMIT
    ? parseIntValue("AGENT_RATE_LIMIT", env.AGENT_RATE_LIMIT, 0, {
      min: 1,
      warn,
    })
    : undefined;
  const rateLimit = rateLimitRaw && rateLimitRaw > 0 ? rateLimitRaw : undefined;

  return {
    type: agentType,
    systemPrompt,
    tools,
    maxIterations,
    temperature,
    rateLimit,
  };
}
